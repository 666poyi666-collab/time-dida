// 凭证存储 - 安全保存 OAuth token
// 不存 localStorage。生产环境推荐 keytar（OS keychain）。
// 这里使用 JsonStore 加密文件作为可运行兜底，接口预留 keytar 替换。
import { JsonStore } from './jsonStore.js';
import { logger } from './logger.js';

interface CredentialEntry {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  extra?: Record<string, unknown>;
}

const credStore = new JsonStore<Record<string, CredentialEntry>>({
  name: 'focuslink-credentials',
  defaults: {},
  encryptionKey: 'focuslink-cred-v1',
});

export class CredentialsStore {
  set(service: string, entry: CredentialEntry): void {
    credStore.set(service, entry);
    logger.info('credentials', `saved token for ${service}`);
  }

  get(service: string): CredentialEntry | null {
    return credStore.get(service) ?? null;
  }

  delete(service: string): void {
    credStore.delete(service);
    logger.info('credentials', `deleted token for ${service}`);
  }

  has(service: string): boolean {
    return credStore.has(service);
  }
}

export const credentials = new CredentialsStore();
