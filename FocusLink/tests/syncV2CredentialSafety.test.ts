import { describe, expect, it } from 'vitest';

import config from '../capacitor.config';
import {
  SyncV2ClientError,
  classifySyncV2Error,
  safeSyncV2Error,
} from '../shared/sync/v2ClientError';

describe('canonical Sync v2 credential safety', () => {
  it('disables Capacitor bridge argument logging', () => {
    expect(config.loggingBehavior).toBe('none');
  });

  it('reduces arbitrary credential-bearing exceptions to fixed codes', () => {
    const token = `fl2_account_device_${'x'.repeat(48)}`;
    const safe = safeSyncV2Error(
      new Error(`Authorization: Bearer ${token}; Cookie=session-secret; upstream body=${token}`),
    );
    expect(safe).toBeInstanceOf(SyncV2ClientError);
    expect(safe.code).toBe('sync_failed');
    expect(safe.message).not.toContain(token);
    expect(safe.message).not.toMatch(/Authorization|Cookie|Bearer/i);
  });

  it('classifies authentication, authorization, timeout and contract failures distinctly', () => {
    expect(classifySyncV2Error(new Error('HTTP 401'))).toBe('authentication_failed');
    expect(classifySyncV2Error(new Error('HTTP 403 scope denied'))).toBe('authorization_failed');
    expect(classifySyncV2Error(new Error('请求超时'))).toBe('timeout');
    expect(classifySyncV2Error(new Error('无法连接跨设备同步服务'))).toBe('network_error');
    expect(classifySyncV2Error(new Error('ACK 格式无效'))).toBe('contract_error');
  });
});
