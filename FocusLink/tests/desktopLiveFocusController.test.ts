import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_FOCUS_PROTOCOL_VERSION } from '@shared/sync/liveFocusProtocol';

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

function liveResponse(state: 'idle' | 'running' | 'paused' = 'idle', revision = 0): Response {
  const now = Date.now();
  const session =
    state === 'idle'
      ? null
      : {
          id: 'remote-session',
          title: '远程任务',
          state,
          startedAt: now - 1_000,
          activeElapsedMs: 1_000,
          pauseElapsedMs: state === 'paused' ? 200 : 0,
          wallElapsedMs: 1_000,
          currentPauseStartedAt: state === 'paused' ? now - 200 : null,
          segments: [{ id: 'remote-segment', startedAt: now - 1_000, endedAt: null }],
          pauses:
            state === 'paused'
              ? [
                  {
                    id: 'remote-pause',
                    segmentId: 'remote-segment',
                    startedAt: now - 200,
                    endedAt: null,
                  },
                ]
              : [],
          task: { taskId: 'task-1', taskSource: 'local', taskTitle: '远程任务' },
          updatedAt: now,
          lastCommandDeviceId: 'desktop-test-device',
        };
  return new Response(
    JSON.stringify({
      protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
      serverTime: now,
      snapshot: { revision, state, session },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
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

  it('retries a transient live request failure before returning a snapshot', async () => {
    const local = {
      getSnapshot: vi.fn(() => snapshot('idle')),
      onSnapshot: vi.fn(),
      dispose: vi.fn(),
    };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const controller = new FocusTimerController(local as never);

    const request = (
      controller as unknown as {
        request: (
          path: string,
          connection: { endpoint: string; accessToken: string; deviceId: string },
        ) => Promise<Response>;
      }
    ).request.bind(controller);
    const response = await request('/v1/live', runtimeConnection.current!);

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    controller.dispose();
    fetchSpy.mockRestore();
  });

  it('explains an unreachable live endpoint instead of exposing bare fetch failed', async () => {
    const local = {
      getSnapshot: vi.fn(() => snapshot('idle')),
      onSnapshot: vi.fn(),
      dispose: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const controller = new FocusTimerController(local as never);

    const request = (
      controller as unknown as {
        request: (
          path: string,
          connection: { endpoint: string; accessToken: string; deviceId: string },
        ) => Promise<Response>;
      }
    ).request.bind(controller);
    await expect(request('/v1/live/command', runtimeConnection.current!)).rejects.toThrow(
      '无法连接实时同步服务（http://127.0.0.1:18787/v1/live/command）',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    controller.dispose();
    fetchSpy.mockRestore();
  });

  it('keeps local start available until the first live handshake succeeds', async () => {
    vi.useFakeTimers();
    let current = snapshot('idle');
    const local = {
      getSnapshot: vi.fn(() => current),
      onSnapshot: vi.fn(),
      startWithTask: vi.fn(() => {
        current = snapshot('running');
        return current;
      }),
      dispose: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const controller = new FocusTimerController(local as never);

    controller.reloadConfiguration();
    await flushMicrotasks();
    const result = await controller.startWithTask('task-1', 'local', '数学');

    expect(result.state).toBe('running');
    expect(local.startWithTask).toHaveBeenCalledWith('task-1', 'local', '数学');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(false);

    controller.dispose();
    await vi.advanceTimersByTimeAsync(500);
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it('enters live mode only after a valid handshake and sends task starts to the cloud', async () => {
    let resolveInitial!: (response: Response) => void;
    const initial = new Promise<Response>((resolve) => {
      resolveInitial = resolve;
    });
    const local = {
      getSnapshot: vi.fn(() => snapshot('idle')),
      onSnapshot: vi.fn(),
      startWithTask: vi.fn(() => snapshot('running')),
      dispose: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/v1/live')) return initial;
      if (url.includes('/v1/live/wait')) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        });
      }
      if (url.includes('/v1/live/command')) {
        const now = Date.now();
        return Promise.resolve(
          new Response(
            JSON.stringify({
              protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
              serverTime: now,
              snapshot: {
                revision: 1,
                state: 'running',
                session: {
                  id: 'remote-session',
                  title: '数学',
                  state: 'running',
                  startedAt: now - 1_000,
                  activeElapsedMs: 1_000,
                  pauseElapsedMs: 0,
                  wallElapsedMs: 1_000,
                  currentPauseStartedAt: null,
                  segments: [{ id: 'remote-segment', startedAt: now - 1_000, endedAt: null }],
                  pauses: [],
                  task: { taskId: 'task-1', taskSource: 'local', taskTitle: '数学' },
                  updatedAt: now,
                  lastCommandDeviceId: 'desktop-test-device',
                },
              },
              ack: {
                commandId: 'command-1',
                status: 'applied',
                revision: 1,
                errorCode: null,
                completedEntityId: null,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const controller = new FocusTimerController(local as never);

    controller.reloadConfiguration();
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(false);
    resolveInitial(liveResponse());
    await flushMicrotasks();
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(true);
    const result = await controller.startWithTask('task-1', 'local', '数学');

    expect(result.state).toBe('running');
    expect(local.startWithTask).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes('/v1/live/command'))).toBe(
      true,
    );
    controller.dispose();
    fetchSpy.mockRestore();
  });

  it('keeps a confirmed live session authoritative when the wait connection drops', async () => {
    vi.useFakeTimers();
    let resolveInitial!: (response: Response) => void;
    const initial = new Promise<Response>((resolve) => {
      resolveInitial = resolve;
    });
    const local = {
      getSnapshot: vi.fn(() => snapshot('idle')),
      onSnapshot: vi.fn(),
      startWithTask: vi.fn(() => snapshot('running')),
      dispose: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/v1/live')) return initial;
      if (url.includes('/v1/live/wait')) {
        return Promise.reject(new TypeError('fetch failed'));
      }
      return Promise.reject(new Error(`unexpected URL: ${url}`));
    });
    const controller = new FocusTimerController(local as never);

    controller.reloadConfiguration();
    resolveInitial(liveResponse('running'));
    await flushMicrotasks();
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(true);
    expect(controller.getSnapshot().state).toBe('running');

    await vi.advanceTimersByTimeAsync(250);
    expect((controller as unknown as { liveMode: boolean }).liveMode).toBe(true);
    expect(controller.getSnapshot().state).toBe('running');
    expect(local.startWithTask).not.toHaveBeenCalled();

    controller.dispose();
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it('backs off repeated handshake failures instead of retrying every two seconds forever', async () => {
    vi.useFakeTimers();
    const local = {
      getSnapshot: vi.fn(() => snapshot('idle')),
      onSnapshot: vi.fn(),
      dispose: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const controller = new FocusTimerController(local as never);

    controller.reloadConfiguration();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSpy).toHaveBeenCalledTimes(5);

    controller.dispose();
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });
});
