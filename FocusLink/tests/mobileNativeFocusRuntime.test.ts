import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isNativeFocusRuntimeAvailable,
  makeNativeDisplaySnapshot,
  nativeFocusCommandSuccessCopy,
  normalizeNativePauseReminderDelayMinutes,
} from '../src/mobile/nativeFocusRuntime';
import { idleLiveFocusSnapshot } from '../src/mobile/runtimeModel';

const capacitorHarness = vi.hoisted(() => ({ native: false, pluginAvailable: false }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitorHarness.native,
    isPluginAvailable: (name: string) =>
      name === 'FocusRuntime' && capacitorHarness.pluginAvailable,
  },
  registerPlugin: () => ({}),
}));

describe('mobile native focus display projection', () => {
  beforeEach(() => {
    capacitorHarness.native = false;
    capacitorHarness.pluginAvailable = false;
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
      validUntilEpochMs: 1_905_000,
    });
  });

  it('exposes Android controls only when both the native platform and plugin are available', () => {
    capacitorHarness.native = true;
    expect(isNativeFocusRuntimeAvailable()).toBe(false);

    capacitorHarness.pluginAvailable = true;
    expect(isNativeFocusRuntimeAvailable()).toBe(true);

    capacitorHarness.native = false;
    expect(isNativeFocusRuntimeAvailable()).toBe(false);
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

  it('normalizes the native pause reminder delay to the supported range', () => {
    expect(normalizeNativePauseReminderDelayMinutes()).toBe(3);
    expect(normalizeNativePauseReminderDelayMinutes(Number.NaN)).toBe(3);
    expect(normalizeNativePauseReminderDelayMinutes(0)).toBe(1);
    expect(normalizeNativePauseReminderDelayMinutes(3.6)).toBe(4);
    expect(normalizeNativePauseReminderDelayMinutes(999)).toBe(240);
  });
});
