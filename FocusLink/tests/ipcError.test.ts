import { describe, expect, it } from 'vitest';
import { ipcErrorMessage } from '../src/app/ipcError';

describe('ipcErrorMessage', () => {
  it('removes Electron invoke wrappers while preserving the actionable message', () => {
    expect(
      ipcErrorMessage(
        new Error(
          "Error invoking remote method 'device-sync:run': Error: 无法连接跨设备同步服务（http://127.0.0.1:18787/v1/sync）",
        ),
      ),
    ).toBe('无法连接跨设备同步服务（http://127.0.0.1:18787/v1/sync）');
  });

  it('keeps ordinary errors readable', () => {
    expect(ipcErrorMessage(new Error('访问令牌无效'))).toBe('访问令牌无效');
  });
});
