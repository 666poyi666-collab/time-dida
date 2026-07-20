import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TimerSnapshot } from '@shared/types';

const runtimeConnection = vi.hoisted(() => ({
  current: null as { endpoint: string; accessToken: string; deviceId: string } | null,
}));

vi.mock('../electron/sync/deviceSyncService.js', () => ({
  getDeviceSyncRuntimeConnection: () => runtimeConnection.current,
  runDeviceSync: vi.fn(),
  setDeviceSyncLiveTelemetry: vi.fn(),
}));

vi.mock('../electron/db/index.js', () => ({
  getSession: vi.fn(),
}));

import { FocusTimerController } from '../electron/timer/focusTimerController';

function snapshot(state: TimerSnapshot['state']): TimerSnapshot {
  return {
    state,
    sessionId: state === 'idle' ? null : 'local-active-session',
    currentSegmentId: state === 'idle' ? null : 'local-segment',
    currentTaskId: null,
    currentTaskTitle: null,
    currentTaskSource: null,
    sessionDefaultTaskId: null,
    sessionDefaultTaskTitle: null,
    activeElapsedMs: 1_000,
    pauseElapsedMs: 0,
    wallElapsedMs: 1_000,
    currentPauseStartedAt: null,
    segments: [],
    pauseEvents: [],
    lastTick: Date.now(),
  };
}

describe('desktop live focus controller', () => {
  beforeEach(() => {
    runtimeConnection.current = {
      endpoint: 'http://127.0.0.1:18787',
      accessToken: 'desktop-live-test-token',
      deviceId: 'desktop-test-device',
    };
  });

  it('defers the live fact-source switch while a local session is active', async () => {
    const active = snapshot('running');
    const listeners = new Set<(value: TimerSnapshot) => void>();
    const local = {
      getSnapshot: vi.fn(() => active),
      onSnapshot: vi.fn((listener: (value: TimerSnapshot) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      toggle: vi.fn(() => active),
      dispose: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const controller = new FocusTimerController(local as never);

    controller.reloadConfiguration();
    const result = await controller.toggle();

    expect(result).toBe(active);
    expect(local.toggle).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toBe(active);
    controller.dispose();
    fetchSpy.mockRestore();
  });
});
