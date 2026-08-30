import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  migrateStoredDeviceSyncError,
  normalizeStoredDeviceSyncError,
} from '../shared/sync/deviceSyncStatusCode';
import type { DeviceSyncManagedDevice, DeviceSyncStatus } from '../shared/ipc/api';
import {
  presentDeviceSyncError,
  presentDeviceSyncOverview,
  presentManagedDeviceActivity,
  presentObservedTime,
  presentTomatodoBridgeStatus,
} from '../src/features/settings/deviceSyncStatusPresentation';

function statusFixture(overrides: Partial<DeviceSyncStatus> = {}): DeviceSyncStatus {
  return {
    signedIn: true,
    accountId: 'account-fixture',
    accountLabel: 'FocusLink',
    enabled: true,
    endpoint: 'https://fixture.invalid',
    autoSync: true,
    liveControlEnabled: true,
    liveConnected: true,
    liveRevision: 12,
    liveState: 'idle',
    configured: true,
    tokenConfigured: true,
    deviceId: 'device-current',
    cursor: 'c1',
    running: false,
    lastSyncAt: 1_700_000_000_000,
    lastError: null,
    unresolvedConflicts: 0,
    ...overrides,
  };
}

describe('desktop device-sync Settings presentation', () => {
  it.each([
    ['network_error', 0, 'transport-unavailable', 'warning', '最近一次同步尝试未完成'],
    ['timeout', 0, 'transport-unavailable', 'warning', '最近一次同步尝试未完成'],
    ['conflict_present', 2, 'conflict-present', 'warning', '同步已连接，有记录待确认'],
    ['authentication_failed', 0, 'authentication-failed', 'danger', '最近一次设备凭据校验未通过'],
    ['authorization_failed', 0, 'authorization-failed', 'danger', '最近一次设备授权被拒绝'],
    ['contract_error', 0, 'sync-failed', 'danger', '最近一次同步尝试失败'],
    ['rejected_operation', 0, 'operation-rejected', 'warning', '同步已连接，部分记录未同步'],
    ['response_too_large', 0, 'sync-failed', 'danger', '最近一次同步尝试失败'],
    ['cursor_ahead', 0, 'sync-failed', 'danger', '最近一次同步尝试失败'],
    ['invalid_exchange_request', 0, 'sync-failed', 'danger', '最近一次同步尝试失败'],
    ['sync_failed', 0, 'sync-failed', 'danger', '最近一次同步尝试失败'],
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

  it('keeps current live connectivity separate from a historical transport error', () => {
    const overview = presentDeviceSyncOverview(
      statusFixture({ lastError: 'network_error', liveConnected: true, liveState: 'running' }),
      1_700_000_060_000,
    );
    expect(overview.connection).toMatchObject({
      value: '已确认',
      detail: '专注中 · revision 12',
      tone: 'success',
    });
    expect(presentDeviceSyncError('network_error')).toMatchObject({
      title: '最近一次同步尝试未完成',
    });
    expect(presentDeviceSyncError('network_error')?.detail).toContain('不等同于当前设备离线');
  });

  it('renders unconfirmed as unknown current connectivity rather than claiming offline', () => {
    const overview = presentDeviceSyncOverview(
      statusFixture({ liveConnected: false, lastError: 'network_error' }),
    );
    expect(overview.connection).toMatchObject({ value: '尚未确认', tone: 'warning' });
    expect(JSON.stringify(overview.connection)).not.toContain('离线');
  });

  it('formats freshness without converting missing observations into activity', () => {
    expect(presentObservedTime(null, 100_000)).toEqual({ relative: '尚无记录', exact: null });
    expect(presentObservedTime(40_000, 100_000).relative).toBe('1 分钟前');
    expect(presentObservedTime(100_000 + 120_000, 100_000).relative).toBe('设备时间待校准');
  });

  it('shows exact managed-device activity and does not infer that a device is online', () => {
    const device: DeviceSyncManagedDevice = {
      deviceId: 'device-other',
      devicePublicId: 'public-other',
      displayName: '平板',
      platform: 'android',
      deviceKind: 'tablet',
      appVersion: '0.12.104',
      expiresAt: null,
      revokedAt: null,
      lastSeenAt: 1_700_000_000_000,
      stale: false,
      registeredAt: 1_699_000_000_000,
    };
    const result = presentManagedDeviceActivity(device, 1_700_000_300_000);
    expect(result.value).toBe('最近活动 5 分钟前');
    expect(result.detail).toContain('最近活动');
    expect(JSON.stringify(result)).not.toContain('在线');

    expect(
      presentManagedDeviceActivity({ ...device, expiresAt: 1_700_000_100_000 }, 1_700_000_300_000),
    ).toMatchObject({ value: '设备凭据已过期', tone: 'danger' });
  });

  it('presents the TomaToDo bridge boundary without leaking raw launch errors', () => {
    expect(
      presentTomatodoBridgeStatus({
        state: 'connected',
        connected: true,
        running: true,
        installed: true,
        launched: false,
      }),
    ).toMatchObject({ value: '连接已确认', tone: 'success' });
    const failed = presentTomatodoBridgeStatus({
      state: 'launch-failed',
      connected: false,
      running: false,
      installed: true,
      launched: true,
      error: 'secret upstream fixture',
    });
    expect(failed).toMatchObject({ value: '最近连接失败', tone: 'danger' });
    expect(JSON.stringify(failed)).not.toContain('secret upstream fixture');
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
