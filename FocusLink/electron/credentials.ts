import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { JsonStore } from './jsonStore.js';
import { logger } from './logger.js';

interface CredentialEntry {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  extra?: Record<string, unknown>;
}

type CredentialMap = Record<string, CredentialEntry>;

interface ProtectedCredentialFile {
  version: 2;
  encryptedPayload: string;
}

const LEGACY_NAME = 'focuslink-credentials';
const PROTECTED_NAME = 'focuslink-credentials-v2.json';
let cache: CredentialMap | null = null;
let migrationAttempted = false;

function protectedPath(): string {
  return path.join(app.getPath('userData'), PROTECTED_NAME);
}

function legacyPath(): string {
  return path.join(app.getPath('userData'), `${LEGACY_NAME}.json`);
}

function requireSafeStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全凭据存储不可用，未读取或保存 OAuth 凭据');
  }
}

function readProtected(): CredentialMap {
  requireSafeStorage();
  const file = protectedPath();
  if (!fs.existsSync(file)) return {};
  const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as ProtectedCredentialFile;
  if (
    stored.version !== 2 ||
    typeof stored.encryptedPayload !== 'string' ||
    stored.encryptedPayload.length < 1
  ) {
    throw new Error('安全凭据文件格式无效');
  }
  const plaintext = safeStorage.decryptString(Buffer.from(stored.encryptedPayload, 'base64'));
  return validateCredentialMap(JSON.parse(plaintext) as unknown);
}

function persistProtected(value: CredentialMap): void {
  requireSafeStorage();
  const file = protectedPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stored: ProtectedCredentialFile = {
    version: 2,
    encryptedPayload: safeStorage.encryptString(JSON.stringify(value)).toString('base64'),
  };
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 });
    const descriptor = fs.openSync(temporary, 'r');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, file);
    const verified = readProtected();
    if (JSON.stringify(verified) !== JSON.stringify(value)) {
      throw new Error('安全凭据写入后校验失败');
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function migrateLegacyIfNeeded(): void {
  if (migrationAttempted || fs.existsSync(protectedPath())) return;
  migrationAttempted = true;
  const oldPath = legacyPath();
  if (!fs.existsSync(oldPath)) return;
  requireSafeStorage();
  const legacy = new JsonStore<CredentialMap>({
    name: LEGACY_NAME,
    defaults: {},
    encryptionKey: 'focuslink-cred-v1',
  });
  const value = validateCredentialMap(legacy.store);
  persistProtected(value);
  // Delete the reversible-XOR source only after decrypting the new protected
  // file succeeded.  Failure leaves the original available for recovery.
  fs.rmSync(oldPath, { force: true });
  logger.info('credentials', 'migrated OAuth credentials to OS protected storage');
}

function load(): CredentialMap {
  if (cache) return cache;
  migrateLegacyIfNeeded();
  cache = readProtected();
  return cache;
}

function validateCredentialMap(value: unknown): CredentialMap {
  if (!isRecord(value)) throw new Error('安全凭据内容必须是对象');
  const result: CredentialMap = {};
  for (const [service, candidate] of Object.entries(value)) {
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(service) || !isRecord(candidate)) {
      throw new Error('安全凭据包含无效服务记录');
    }
    if (
      typeof candidate.accessToken !== 'string' ||
      candidate.accessToken.length < 1 ||
      candidate.accessToken.length > 16_384 ||
      (candidate.refreshToken !== undefined &&
        (typeof candidate.refreshToken !== 'string' || candidate.refreshToken.length > 16_384)) ||
      (candidate.expiresAt !== undefined &&
        (typeof candidate.expiresAt !== 'number' || !Number.isFinite(candidate.expiresAt))) ||
      (candidate.extra !== undefined && !isRecord(candidate.extra))
    ) {
      throw new Error('安全凭据记录格式无效');
    }
    result[service] = candidate as unknown as CredentialEntry;
  }
  return result;
}

export class CredentialsStore {
  set(service: string, entry: CredentialEntry): void {
    const next = { ...load(), [service]: validateCredentialMap({ [service]: entry })[service] };
    persistProtected(next);
    cache = next;
    logger.info('credentials', `saved protected token for ${service}`);
  }

  get(service: string): CredentialEntry | null {
    try {
      return load()[service] ?? null;
    } catch (error) {
      logger.warn('credentials', 'protected credential is unavailable', {
        service,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  delete(service: string): void {
    const next = { ...load() };
    delete next[service];
    persistProtected(next);
    cache = next;
    logger.info('credentials', `deleted protected token for ${service}`);
  }

  has(service: string): boolean {
    return this.get(service) !== null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const credentials = new CredentialsStore();
