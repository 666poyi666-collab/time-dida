import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildNativeAuthorityHistory,
  enqueueNativeCompletedLedgerBundle,
  isNativeFocusRuntimeAvailable,
  makeNativeDisplaySnapshot,
  nativeFocusCommandSuccessCopy,
  normalizeNativePauseReminderDelayMinutes,
  restoreOrMigrateNativeFocusConnection,
  updateNativeAuthorityProjectionHistory,
} from '../src/mobile/nativeFocusRuntime';
import { idleLiveFocusSnapshot } from '../src/mobile/runtimeModel';
import type { CachedBundle } from '../src/mobile/cache';
import { FOCUSLINK_CANONICAL_SYNC_ORIGIN } from '../shared/sync/identityProtocol';

const STORED_TOKEN = `fl2_account1_watch1_${'s'.repeat(32)}`;
const LEGACY_TOKEN = `fl2_account1_watchold_${'l'.repeat(32)}`;

const capacitorHarness = vi.hoisted(() => ({ native: false, pluginAvailable: false }));
const nativePluginHarness = vi.hoisted(() => ({
  configureConnection: vi.fn(),
  enqueueCompletedLedgerBundle: vi.fn(),
  updateAuthorityProjectionHistory: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitorHarness.native,
    isPluginAvailable: (name: string) =>
      name === 'FocusRuntime' && capacitorHarness.pluginAvailable,
  },
  registerPlugin: () => nativePluginHarness,
}));

describe('mobile native focus display projection', () => {
  beforeEach(() => {
    capacitorHarness.native = false;
    capacitorHarness.pluginAvailable = false;
    nativePluginHarness.configureConnection.mockReset();
    nativePluginHarness.configureConnection.mockResolvedValue({ connectionLease: '1' });
    nativePluginHarness.enqueueCompletedLedgerBundle.mockReset();
    nativePluginHarness.enqueueCompletedLedgerBundle.mockResolvedValue({
      queued: true,
      pending: 1,
    });
    nativePluginHarness.updateAuthorityProjectionHistory.mockReset();
    nativePluginHarness.updateAuthorityProjectionHistory.mockResolvedValue({
      accepted: 1,
      pending: 0,
    });
    nativePluginHarness.getConnection.mockReset();
    nativePluginHarness.getConnection.mockResolvedValue({
      configured: false,
      connectionLease: '0',
    });
  });

  it('keeps a bounded native snapshot alive between background cloud polls', () => {
    const snapshot = {
      ...idleLiveFocusSnapshot(9, 100_000),
      state: 'paused' as const,
      sessionId: 'session-9',
      title: '复习物理',
      activeElapsedMs: 45_000,
      pauseElapsedMs: 10_000,
      wallElapsedMs: 55_000,
      currentStateStartedAt: 95_000,
    };

    expect(makeNativeDisplaySnapshot(snapshot, true, 105_000)).toEqual({
      state: 'paused',
      sessionId: 'session-9',
      stateRevision: 9,
      title: '复习物理',
      timeLabel: '00:10',
      detail: '已暂停 · 专注 00:45 · 暂停 00:15',
      primaryElapsedMs: 10_000,
      primaryAdvances: true,
      controlsEnabled: true,
      localAuthority: false,
      validUntilEpochMs: 1_905_000,
    });
  });

  it('marks a local session so native cloud polling cannot replace it', () => {
    const snapshot = {
      ...idleLiveFocusSnapshot(3, 100_000),
      state: 'running' as const,
      sessionId: 'local-session',
      activeElapsedMs: 20_000,
      wallElapsedMs: 20_000,
      currentStateStartedAt: 100_000,
    };

    expect(makeNativeDisplaySnapshot(snapshot, false, 120_000, true).localAuthority).toBe(true);
  });

  it('exposes Android controls only when both the native platform and plugin are available', () => {
    capacitorHarness.native = true;
    expect(isNativeFocusRuntimeAvailable()).toBe(false);

    capacitorHarness.pluginAvailable = true;
    expect(isNativeFocusRuntimeAvailable()).toBe(true);

    capacitorHarness.native = false;
    expect(isNativeFocusRuntimeAvailable()).toBe(false);
  });

  it('restores the Keystore credential without overwriting it from a legacy browser copy', async () => {
    capacitorHarness.native = true;
    capacitorHarness.pluginAvailable = true;
    nativePluginHarness.getConnection.mockResolvedValue({
      configured: true,
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      accessToken: STORED_TOKEN,
      deviceId: 'device-watch1',
      connectionLease: '7',
    });

    await expect(
      restoreOrMigrateNativeFocusConnection({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        accessToken: LEGACY_TOKEN,
        deviceId: 'device-watchold',
      }),
    ).resolves.toEqual({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      accessToken: STORED_TOKEN,
      deviceId: 'device-watch1',
      connectionLease: '7',
    });
    expect(nativePluginHarness.configureConnection).not.toHaveBeenCalled();
  });

  it('migrates a legacy renderer credential before its browser copy can be removed', async () => {
    capacitorHarness.native = true;
    capacitorHarness.pluginAvailable = true;
    const legacyConnection = {
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      accessToken: LEGACY_TOKEN,
      deviceId: 'device-watchold',
    };

    await expect(restoreOrMigrateNativeFocusConnection(legacyConnection)).resolves.toEqual({
      endpoint: legacyConnection.endpoint,
      accessToken: legacyConnection.accessToken,
      deviceId: legacyConnection.deviceId,
      connectionLease: '1',
    });
    expect(nativePluginHarness.configureConnection).toHaveBeenCalledWith({
      endpoint: legacyConnection.endpoint,
      accessToken: legacyConnection.accessToken,
      deviceId: legacyConnection.deviceId,
      expectedConnectionLease: '0',
    });
  });

  it('does not claim a legacy credential was migrated when the Keystore write fails', async () => {
    capacitorHarness.native = true;
    capacitorHarness.pluginAvailable = true;
    nativePluginHarness.configureConnection.mockRejectedValue(new Error('keystore unavailable'));

    await expect(
      restoreOrMigrateNativeFocusConnection({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        accessToken: LEGACY_TOKEN,
        deviceId: 'device-watchold',
      }),
    ).rejects.toThrow('keystore unavailable');
  });

  it('refuses to restore a Keystore bearer bound to an arbitrary HTTPS origin', async () => {
    capacitorHarness.native = true;
    capacitorHarness.pluginAvailable = true;
    nativePluginHarness.getConnection.mockResolvedValue({
      configured: true,
      endpoint: 'https://evil.example.test',
      accessToken: STORED_TOKEN,
      deviceId: 'device-watch1',
      connectionLease: '9',
    });

    await expect(restoreOrMigrateNativeFocusConnection(null)).resolves.toBeNull();
    expect(nativePluginHarness.configureConnection).not.toHaveBeenCalled();
  });

  it('reports the actual native action source in the confirmation copy', () => {
    expect(nativeFocusCommandSuccessCopy({ type: 'pause', source: 'quick-settings' })).toBe(
      '快捷设置动作已确认暂停',
    );
    expect(nativeFocusCommandSuccessCopy({ type: 'resume', source: 'notification' })).toBe(
      '通知动作已确认继续',
    );
    expect(nativeFocusCommandSuccessCopy({ type: 'finish', source: 'notification' })).toBe(
      '通知动作已确认结束，正在收敛账本',
    );
  });

  it('mirrors a completed bundle as two stable cursorless native mutations', async () => {
    capacitorHarness.native = true;
    capacitorHarness.pluginAvailable = true;
    const bundle = {
      session: {
        id: 'session-native',
        title: '离线记录',
        status: 'finished' as const,
        startedAt: 1,
        endedAt: 2,
        activeElapsedMs: 1,
        pauseElapsedMs: 0,
        wallElapsedMs: 1,
        defaultTaskId: null,
        defaultTaskSource: null,
        defaultTaskTitle: null,
        note: null,
        createdAt: 1,
        updatedAt: 2,
      },
      segments: [],
      pauses: [],
    };

    await expect(
      enqueueNativeCompletedLedgerBundle(bundle, 'device-native', '12'),
    ).resolves.toBe(true);
    const options = nativePluginHarness.enqueueCompletedLedgerBundle.mock.calls[0][0];
    expect(options.deviceId).toBe('device-native');
    expect(options.connectionLease).toBe('12');
    const record = options.record;
    expect(record).toMatchObject({
      schemaVersion: 1,
      bundleId: 'session-native',
      deviceId: 'device-native',
    });
    expect(record).not.toHaveProperty('cursor');
    expect(record).not.toHaveProperty('accessToken');
    expect(record.mutations).toHaveLength(2);
    expect(record.mutations.map((mutation: { entityType: string }) => mutation.entityType)).toEqual(
      ['focus_ledger_v2', 'focus_metadata_v2'],
    );
    expect(
      record.mutations.every(
        (mutation: { baseRevision: number; baseFingerprint: null }) =>
          mutation.baseRevision === 0 && mutation.baseFingerprint === null,
      ),
    ).toBe(true);
  });

  it('projects confirmed history and specific tasks with the exact read-only V1 fields', async () => {
    const cached = cachedBundle();
    expect(buildNativeAuthorityHistory([cached])).toEqual([
      {
        sessionId: 'session-history',
        startedAt: 1_000,
        endedAt: 61_000,
        status: 'finished',
        activeMs: 50_000,
        pausedMs: 10_000,
        wallMs: 60_000,
        title: '化学复习',
        task: {
          taskId: 'task-chemistry',
          source: 'ticktick',
          title: '化学错题',
        },
      },
    ]);

    capacitorHarness.native = true;
    capacitorHarness.pluginAvailable = true;
    await expect(
      updateNativeAuthorityProjectionHistory({
        deviceId: 'device-native',
        connectionLease: '12',
        records: [cached],
        lastVerifiedAt: 70_000,
        lastAttemptAt: 69_000,
        pendingCount: 0,
      }),
    ).resolves.toBe(true);
    expect(nativePluginHarness.updateAuthorityProjectionHistory).toHaveBeenCalledWith({
      deviceId: 'device-native',
      connectionLease: '12',
      history: buildNativeAuthorityHistory([cached]),
      lastVerifiedAt: 70_000,
      lastAttemptAt: 69_000,
      pendingCount: 0,
      lastErrorCode: '',
    });
  });

  it('omits a legacy history row whose durations cannot satisfy the consumer contract', () => {
    const cached = cachedBundle();
    cached.bundle.session.wallElapsedMs = 59_999;
    expect(buildNativeAuthorityHistory([cached])).toEqual([]);
  });

  it('normalizes the native pause reminder delay to the supported range', () => {
    expect(normalizeNativePauseReminderDelayMinutes()).toBe(3);
    expect(normalizeNativePauseReminderDelayMinutes(Number.NaN)).toBe(3);
    expect(normalizeNativePauseReminderDelayMinutes(0)).toBe(1);
    expect(normalizeNativePauseReminderDelayMinutes(3.6)).toBe(4);
    expect(normalizeNativePauseReminderDelayMinutes(999)).toBe(240);
  });
});

function cachedBundle(): CachedBundle {
  return {
    entityId: 'session-history',
    revision: 3,
    changeSeq: 9,
    sourceDeviceId: 'device-cloud',
    bundle: {
      session: {
        id: 'session-history',
        title: '化学复习',
        status: 'finished',
        startedAt: 1_000,
        endedAt: 61_000,
        activeElapsedMs: 50_000,
        pauseElapsedMs: 10_000,
        wallElapsedMs: 60_000,
        defaultTaskId: 'task-chemistry',
        defaultTaskSource: 'ticktick',
        defaultTaskTitle: '化学错题',
        note: null,
        createdAt: 1_000,
        updatedAt: 61_000,
      },
      segments: [],
      pauses: [],
    },
  };
}
