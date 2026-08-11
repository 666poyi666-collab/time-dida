import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  migrateStoredDeviceSyncError,
  normalizeStoredDeviceSyncError,
} from '../shared/sync/deviceSyncStatusCode';
import { presentDeviceSyncError } from '../src/features/settings/deviceSyncStatusPresentation';

describe('desktop device-sync Settings presentation', () => {
  it.each([
    ['network_error', 0, 'transport-unavailable', 'warning', '同步服务未连接，配置已保存'],
    ['timeout', 0, 'transport-unavailable', 'warning', '同步服务未连接，配置已保存'],
    ['conflict_present', 2, 'conflict-present', 'warning', '同步已连接，有记录待确认'],
    ['authentication_failed', 0, 'authentication-failed', 'danger', '登录凭据已失效'],
    ['authorization_failed', 0, 'authorization-failed', 'danger', '当前账号没有同步权限'],
    ['contract_error', 0, 'sync-failed', 'danger', '跨设备同步失败'],
    ['rejected_operation', 0, 'operation-rejected', 'warning', '同步已连接，部分记录未同步'],
    ['response_too_large', 0, 'sync-failed', 'danger', '跨设备同步失败'],
    ['cursor_ahead', 0, 'sync-failed', 'danger', '跨设备同步失败'],
    ['invalid_exchange_request', 0, 'sync-failed', 'danger', '跨设备同步失败'],
    ['sync_failed', 0, 'sync-failed', 'danger', '跨设备同步失败'],
  ] as const)(
    'maps %s through its machine-code category',
    (code, unresolvedConflicts, kind, tone, title) => {
      expect(presentDeviceSyncError(code, unresolvedConflicts)).toMatchObject({
        kind,
        tone,
        title,
      });
    },
  );

  it('migrates retired localized values before they reach the renderer', () => {
    expect(normalizeStoredDeviceSyncError('无法连接跨设备同步服务（旧地址）')).toBe(
      'network_error',
    );
    expect(normalizeStoredDeviceSyncError('跨设备同步请求超时')).toBe('timeout');
    expect(normalizeStoredDeviceSyncError('存在 2 个未解决的跨设备冲突')).toBe('conflict_present');
    expect(normalizeStoredDeviceSyncError('Bearer fl2_secret_should_not_render')).toBe(
      'sync_failed',
    );
  });

  it('persists a migrated machine code exactly once at the main-process boundary', () => {
    const persisted: string[] = [];
    expect(
      migrateStoredDeviceSyncError('无法连接跨设备同步服务（旧地址）', (normalized) => {
        persisted.push(normalized);
      }),
    ).toBe('network_error');
    expect(
      migrateStoredDeviceSyncError('network_error', (normalized) => {
        persisted.push(normalized);
      }),
    ).toBe('network_error');
    expect(persisted).toEqual(['network_error']);
  });

  it('ignores stale conflict_present when the durable conflict count is zero', () => {
    expect(presentDeviceSyncError('conflict_present', 0)).toBeNull();
  });

  it('does not classify an empty status as an error', () => {
    expect(presentDeviceSyncError(null)).toBeNull();
    expect(presentDeviceSyncError('   ')).toBeNull();
  });

  it('never renders an unknown upstream error or credential-like text', () => {
    const hostile = 'Bearer fl2_secret_should_not_render from https://private.example/path';
    const presented = presentDeviceSyncError(hostile);
    expect(presented).toMatchObject({
      kind: 'sync-failed',
      detail: '云端同步暂时失败，请稍后重试。',
    });
    expect(JSON.stringify(presented)).not.toContain(hostile);
    expect(JSON.stringify(presented)).not.toContain('fl2_');
  });

  it('keeps both the main-process durable status and renderer refresh failure code-only', () => {
    const serviceSource = fs.readFileSync(
      path.join(process.cwd(), 'electron', 'sync', 'deviceSyncService.ts'),
      'utf8',
    );
    const settingsSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'features', 'settings', 'SettingsPanel.tsx'),
      'utf8',
    );
    const presenterSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'features', 'settings', 'deviceSyncStatusPresentation.ts'),
      'utf8',
    );
    expect(serviceSource).toContain(
      'setMeta(lastErrorMetaKey(connection.scope), classifySyncV2Error(error));',
    );
    expect(serviceSource).toContain(
      "setMeta(lastErrorMetaKey(connection.scope), 'conflict_present');",
    );
    expect(serviceSource).not.toContain('个未解决的跨设备冲突`');
    expect(serviceSource).toContain('migrateStoredDeviceSyncError(rawStoredError');
    expect(presenterSource).not.toContain('LEGACY_');
    expect(presenterSource).not.toContain('未解决的跨设备冲突');
    expect(presenterSource).not.toContain('无法连接跨设备同步服务');
    expect(settingsSource).toMatch(
      /const refreshDeviceSyncStatus[\s\S]*?lastError: 'sync_failed',[\s\S]*?\}\s*:\s*null/,
    );
  });
});
