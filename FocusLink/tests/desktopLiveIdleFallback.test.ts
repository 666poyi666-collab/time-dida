import { describe, expect, it, vi } from 'vitest';

import { LIVE_FOCUS_PROTOCOL_VERSION } from '@shared/sync/liveFocusProtocol';
import type { TimerSnapshot } from '@shared/types';

const runtimeConnection = vi.hoisted(() => ({
  current: { endpoint: 'http://127.0.0.1:18787', accessToken: 'test-token', deviceId: 'device' },
}));

vi.mock('../electron/sync/deviceSyncService.js', () => ({
  getDeviceSyncRuntimeConnection: () => runtimeConnection.current,
  runDeviceSync: vi.fn(),
  setDeviceSyncLiveTelemetry: vi.fn(),
}));
vi.mock('../electron/db/index.js', () => ({ getSession: vi.fn() }));

import { FocusTimerController } from '../electron/timer/focusTimerController';

function idle(): TimerSnapshot {
  return {
    state: 'idle',
    sessionId: null,
    currentSegmentId: null,
    currentTaskId: null,
    currentTaskTitle: null,
    currentTaskSource: null,
    sessionDefaultTaskId: null,
    sessionDefaultTaskTitle: null,
    activeElapsedMs: 0,
    pauseElapsedMs: 0,
    wallElapsedMs: 0,
    currentPauseStartedAt: null,
    segments: [],
    pauseEvents: [],
    lastTick: Date.now(),
  };
}

function liveIdle(): Response {
  return new Response(
    JSON.stringify({
      protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
      serverTime: Date.now(),
      snapshot: { revision: 0, state: 'idle', session: null },
    }),
    { status: 200 },
  );
}

describe('desktop live idle fallback', () => {
  it('demotes to the local timer after an idle wait connection drops', async () => {
    vi.useFakeTimers();
    let current = idle();
    const local = {
      getSnapshot: vi.fn(() => current),
      onSnapshot: vi.fn(),
      startWithTask: vi.fn(() => {
        current = { ...idle(), state: 'running' };
        return current;
      }),
      dispose: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/v1/live')) return Promise.resolve(liveIdle());
      if (url.includes('/v1/live/wait')) return Promise.reject(new TypeError('fetch failed'));
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const controller = new FocusTimerController(local as never);
    controller.reloadConfiguration();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(false);
    const result = await controller.startWithTask('task', 'local', '数学');
    expect(result.state).toBe('running');
    expect(local.startWithTask).toHaveBeenCalledWith('task', 'local', '数学');
    controller.dispose();
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it('falls back locally when the confirmed idle service dies before start command', async () => {
    let current = idle();
    const local = {
      getSnapshot: vi.fn(() => current),
      onSnapshot: vi.fn(),
      startWithTask: vi.fn(() => {
        current = { ...idle(), state: 'running' };
        return current;
      }),
      toggle: vi.fn(() => {
        current = { ...idle(), state: 'running' };
        return current;
      }),
      dispose: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/v1/live')) return Promise.resolve(liveIdle());
      if (url.includes('/v1/live/wait')) return new Promise<Response>(() => undefined);
      if (url.includes('/v1/live/command')) return Promise.reject(new TypeError('fetch failed'));
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const controller = new FocusTimerController(local as never);
    controller.reloadConfiguration();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(true);

    const start = controller.startWithTask('task', 'local', '数学');
    await new Promise((resolve) => setTimeout(resolve, 600));
    const result = await start;

    expect(result.state).toBe('running');
    expect(local.startWithTask).toHaveBeenCalledWith('task', 'local', '数学');
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(false);
    controller.dispose();
    fetchSpy.mockRestore();
  });
});
