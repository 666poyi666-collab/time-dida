import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';

interface StoredDeviceSyncCredential {
  version: 1;
  encryptedToken: string;
}

function credentialPath(): string {
  return path.join(app.getPath('userData'), 'focuslink-device-sync-credential.json');
}

export function hasDeviceSyncToken(): boolean {
  try {
    return getDeviceSyncToken() !== null;
  } catch {
    return false;
  }
}

export function getDeviceSyncToken(): string | null {
  const filePath = credentialPath();
  if (!fs.existsSync(filePath)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全凭据存储当前不可用');
  }
  try {
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredDeviceSyncCredential;
    if (stored.version !== 1 || typeof stored.encryptedToken !== 'string') {
      throw new Error('凭据文件格式无效');
    }
    const value = safeStorage.decryptString(Buffer.from(stored.encryptedToken, 'base64')).trim();
    return value || null;
  } catch (error) {
    logger.warn('deviceSync', 'failed to read protected credential', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('跨设备同步凭据无法读取，请重新配置');
  }
}

export function setDeviceSyncToken(token: string | null): void {
  const filePath = credentialPath();
  if (!token?.trim()) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch (error) {
      logger.warn('deviceSync', 'failed to remove protected credential', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('无法清除跨设备同步凭据');
    }
    return;
  }
  if (token.length > 4096) throw new Error('访问令牌过长');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全凭据存储不可用，未保存访问令牌');
  }

  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = `${filePath}.tmp`;
  const stored: StoredDeviceSyncCredential = {
    version: 1,
    encryptedToken: safeStorage.encryptString(token.trim()).toString('base64'),
  };
  try {
    fs.writeFileSync(tempPath, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
    logger.info('deviceSync', 'protected access token saved');
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Keep the original error.
    }
    throw new Error(
      `无法保存跨设备同步凭据：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
