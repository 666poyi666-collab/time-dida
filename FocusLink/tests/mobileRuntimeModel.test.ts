import { describe, expect, it } from 'vitest';
import {
  formatClockDuration,
  idleLiveFocusSnapshot,
  liveConnectionCopy,
  projectLiveFocusDurations,
  runtimeControlAvailability,
  type LiveFocusSnapshotLike,
} from '../src/mobile/runtimeModel';

const MINUTE = 60_000;

function liveSnapshot(
  state: LiveFocusSnapshotLike['state'],
  overrides: Partial<LiveFocusSnapshotLike> = {},
): LiveFocusSnapshotLike {
  return {
    ...idleLiveFocusSnapshot(4, 100 * MINUTE),
    state,
    sessionId: state === 'idle' ? null : 'session-live',
    title: state === 'idle' ? null : '复习化学',
    activeElapsedMs: 45 * MINUTE,
    pauseElapsedMs: 5 * MINUTE,
    wallElapsedMs: 50 * MINUTE,
    currentStateStartedAt: 100 * MINUTE,
    ownerDeviceId: 'phone-a',
    ...overrides,
  };
}

describe('mobile live runtime model', () => {
  it('ticks active and wall time only while running', () => {
    expect(projectLiveFocusDurations(liveSnapshot('running'), 110 * MINUTE)).toEqual({
      activeElapsedMs: 55 * MINUTE,
      pauseElapsedMs: 5 * MINUTE,
      wallElapsedMs: 60 * MINUTE,
      primaryElapsedMs: 55 * MINUTE,
    });
  });

  it('ticks pause and wall time only while paused', () => {
    expect(projectLiveFocusDurations(liveSnapshot('paused'), 107 * MINUTE)).toEqual({
      activeElapsedMs: 45 * MINUTE,
      pauseElapsedMs: 12 * MINUTE,
      wallElapsedMs: 57 * MINUTE,
      primaryElapsedMs: 7 * MINUTE,
    });
  });

  it('does not move an idle snapshot or run time backwards', () => {
    expect(projectLiveFocusDurations(idleLiveFocusSnapshot(2, 10_000), 5_000)).toEqual({
      activeElapsedMs: 0,
      pauseElapsedMs: 0,
      wallElapsedMs: 0,
      primaryElapsedMs: 0,
    });
    expect(projectLiveFocusDurations(liveSnapshot('running'), 90 * MINUTE).activeElapsedMs).toBe(
      45 * MINUTE,
    );
  });

  it('locks all mutating controls unless the live connection is confirmed', () => {
    const snapshot = liveSnapshot('running');
    expect(
      runtimeControlAvailability({ snapshot, connection: 'offline', pending: false, title: '' }),
    ).toEqual({ start: false, pause: false, resume: false, finish: false });
    expect(
      runtimeControlAvailability({ snapshot, connection: 'live', pending: false, title: '' }),
    ).toEqual({ start: false, pause: true, resume: false, finish: true });
    expect(
      runtimeControlAvailability({ snapshot, connection: 'live', pending: true, title: '' }),
    ).toEqual({ start: false, pause: false, resume: false, finish: false });
  });

  it('requires a non-empty title before starting', () => {
    const snapshot = idleLiveFocusSnapshot();
    expect(
      runtimeControlAvailability({ snapshot, connection: 'live', pending: false, title: '  ' })
        .start,
    ).toBe(false);
    expect(
      runtimeControlAvailability({
        snapshot,
        connection: 'live',
        pending: false,
        title: '整理错题',
      }).start,
    ).toBe(true);
  });

  it('allows only an explicitly safe offline start and local-session controls', () => {
    const idle = idleLiveFocusSnapshot();
    expect(
      runtimeControlAvailability({
        snapshot: idle,
        connection: 'offline',
        pending: false,
        title: '离线复习',
        allowOfflineStart: true,
      }).start,
    ).toBe(true);
    expect(
      runtimeControlAvailability({
        snapshot: liveSnapshot('running'),
        connection: 'offline',
        pending: false,
        title: '',
        localSession: true,
      }),
    ).toEqual({ start: false, pause: true, resume: false, finish: true });
  });

  it('uses exact state wording and stable clock slots', () => {
    expect(liveConnectionCopy('offline', true)).toEqual({
      title: '当前离线 · 控制已锁定',
      detail: '计时仅按最后确认状态在本机推算，联网后自动校准',
    });
    expect(formatClockDuration(65_001)).toBe('01:05');
    expect(formatClockDuration(3_661_000)).toBe('01:01:01');
  });
});
