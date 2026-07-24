import { describe, expect, it } from 'vitest';
import { validateDeviceSyncBundle } from '../shared/sync/deviceProtocol';
import {
  finishOfflineFocus,
  offlineRuntimeSnapshot,
  pauseOfflineFocus,
  resumeOfflineFocus,
  startOfflineFocus,
} from '../src/mobile/offlineFocusRuntime';

describe('mobile offline focus runtime', () => {
  it('preserves active and pause time and emits a valid completed sync bundle', () => {
    const started = startOfflineFocus({
      id: 'mobile-session-1',
      segmentId: 'mobile-segment-1',
      title: '整理化学错题',
      task: null,
      now: 1_000,
    });
    const paused = pauseOfflineFocus(started, 'mobile-pause-1', 61_000);
    const resumed = resumeOfflineFocus(paused, 91_000);
    const snapshot = offlineRuntimeSnapshot(resumed, 'phone-a', 121_000);

    expect(snapshot.activeElapsedMs).toBe(90_000);
    expect(snapshot.pauseElapsedMs).toBe(30_000);
    expect(snapshot.wallElapsedMs).toBe(120_000);

    const bundle = finishOfflineFocus(resumed, 151_000);
    expect(bundle.session.activeElapsedMs).toBe(120_000);
    expect(bundle.session.pauseElapsedMs).toBe(30_000);
    expect(bundle.pauses[0].durationMs).toBe(30_000);
    expect(validateDeviceSyncBundle(bundle)).toEqual({ ok: true });
  });

  it('closes an in-progress pause when the session finishes', () => {
    const started = startOfflineFocus({
      id: 'mobile-session-2',
      segmentId: 'mobile-segment-2',
      title: '阅读',
      task: null,
      now: 10_000,
    });
    const paused = pauseOfflineFocus(started, 'mobile-pause-2', 20_000);
    const bundle = finishOfflineFocus(paused, 50_000);
    expect(bundle.session.activeElapsedMs).toBe(10_000);
    expect(bundle.session.pauseElapsedMs).toBe(30_000);
    expect(bundle.pauses[0].pauseEndedAt).toBe(50_000);
    expect(validateDeviceSyncBundle(bundle).ok).toBe(true);
  });
});
