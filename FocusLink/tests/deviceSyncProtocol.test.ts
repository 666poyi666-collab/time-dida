import { describe, expect, it } from 'vitest';
import {
  DEVICE_SYNC_MAX_BUNDLE_BYTES,
  canonicalStringify,
  deviceSyncJsonByteLength,
  fingerprintDeviceSyncValue,
  makeDeviceSyncOperationId,
  normalizeDeviceSyncEndpoint,
  toDeviceSyncBundle,
  validateDeviceSyncBundle,
} from '@shared/sync/deviceProtocol';
import type { FocusSegment, FocusSession, PauseEvent } from '@shared/types';

function fixture() {
  const session: FocusSession = {
    id: 'session-1',
    title: null,
    status: 'finished',
    startedAt: 1_000,
    endedAt: 4_000,
    activeElapsedMs: 2_000,
    pauseElapsedMs: 1_000,
    wallElapsedMs: 3_000,
    defaultTaskId: 'task-1',
    defaultTaskSource: 'ticktick',
    defaultTaskTitle: '复习化学',
    note: null,
    createdAt: 1_000,
    updatedAt: 4_000,
  };
  const segments: FocusSegment[] = [
    {
      id: 'segment-1',
      sessionId: session.id,
      taskId: 'task-1',
      taskSource: 'ticktick',
      title: '复习化学',
      startedAt: 1_000,
      endedAt: 3_000,
      activeElapsedMs: 2_000,
      note: null,
      cloudFocusId: 'provider-local-id',
      tomatodoSubject: '化学',
      createdAt: 1_000,
      updatedAt: 3_000,
    },
  ];
  const pauses: PauseEvent[] = [
    {
      id: 'pause-1',
      sessionId: session.id,
      segmentId: 'segment-1',
      pauseStartedAt: 3_000,
      pauseEndedAt: 4_000,
      durationMs: 1_000,
      reason: null,
      createdAt: 3_000,
      updatedAt: 4_000,
    },
  ];
  return { session, segments, pauses };
}

describe('device sync protocol', () => {
  it('builds a portable completed-session bundle without provider-local ids', () => {
    const { session, segments, pauses } = fixture();
    const bundle = toDeviceSyncBundle(session, segments, pauses);

    expect(validateDeviceSyncBundle(bundle)).toEqual({ ok: true });
    expect(bundle.segments[0]).not.toHaveProperty('cloudFocusId');
    expect(bundle.segments[0].tomatodoSubject).toBe('化学');
  });

  it('rejects active sessions and broken parent references', () => {
    const { session, segments, pauses } = fixture();
    const active = toDeviceSyncBundle(
      { ...session, status: 'active', endedAt: null },
      segments,
      pauses,
    );
    expect(validateDeviceSyncBundle(active)).toMatchObject({ ok: false });

    const repaired = toDeviceSyncBundle(session, segments, [
      { ...pauses[0], segmentId: 'missing-segment' },
    ]);
    expect(repaired.pauses[0]?.segmentId).toBeNull();
    expect(validateDeviceSyncBundle(repaired)).toEqual({ ok: true });

    const broken = {
      ...repaired,
      pauses: [{ ...repaired.pauses[0], segmentId: 'missing-segment' }],
    };
    expect(validateDeviceSyncBundle(broken)).toMatchObject({ ok: false });

    const numericSegmentReference = {
      ...toDeviceSyncBundle(session, [{ ...segments[0], id: '1' }], pauses),
      pauses: [{ ...pauses[0], segmentId: 1 }],
    };
    expect(validateDeviceSyncBundle(numericSegmentReference)).toMatchObject({ ok: false });
  });

  it('rejects provider-local fields and incomplete task associations', () => {
    const { session, segments, pauses } = fixture();
    const portable = toDeviceSyncBundle(session, segments, pauses);
    const leakedProviderId = {
      ...portable,
      segments: [{ ...portable.segments[0], cloudFocusId: 'must-stay-on-desktop' }],
    };
    expect(validateDeviceSyncBundle(leakedProviderId)).toMatchObject({
      ok: false,
      error: expect.stringContaining('未授权字段'),
    });

    const incompleteAssociation = {
      ...portable,
      segments: [{ ...portable.segments[0], taskSource: null }],
    };
    expect(validateDeviceSyncBundle(incompleteAssociation)).toMatchObject({ ok: false });

    const leakedBundleCredential = { ...portable, accessToken: 'must-not-cross-devices' };
    expect(validateDeviceSyncBundle(leakedBundleCredential)).toMatchObject({
      ok: false,
      error: expect.stringContaining('bundle 包含未授权字段'),
    });
  });

  it('uses canonical content for deterministic operation ids', () => {
    const { session, segments, pauses } = fixture();
    const bundle = toDeviceSyncBundle(session, segments, pauses);
    expect(canonicalStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(fingerprintDeviceSyncValue({ b: 2, a: 1 })).toBe(
      fingerprintDeviceSyncValue({ a: 1, b: 2 }),
    );
    expect(makeDeviceSyncOperationId('s', 'put', 0, bundle)).toBe(
      makeDeviceSyncOperationId('s', 'put', 0, bundle),
    );
    expect(makeDeviceSyncOperationId('s', 'put', 0, bundle)).not.toBe(
      makeDeviceSyncOperationId('s', 'put', 1, bundle),
    );
  });

  it('rejects timestamps outside Date range and open children in a completed session', () => {
    const { session, segments, pauses } = fixture();
    expect(
      validateDeviceSyncBundle(
        toDeviceSyncBundle({ ...session, startedAt: 1e308 }, segments, pauses),
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateDeviceSyncBundle(
        toDeviceSyncBundle(session, [{ ...segments[0], endedAt: null }], pauses),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('未结束 segment') });
    expect(
      validateDeviceSyncBundle(
        toDeviceSyncBundle(session, segments, [{ ...pauses[0], pauseEndedAt: null }]),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('未结束 pause') });
  });

  it('caps one atomic session bundle below the HTTP page budget', () => {
    const { session, segments, pauses } = fixture();
    const oversized = toDeviceSyncBundle(
      session,
      Array.from({ length: 30 }, (_, index) => ({
        ...segments[0],
        id: `segment-${index}`,
        note: '大'.repeat(20_000),
      })),
      pauses.map((pause) => ({ ...pause, segmentId: 'segment-0' })),
    );
    expect(deviceSyncJsonByteLength(oversized)).toBeGreaterThan(DEVICE_SYNC_MAX_BUNDLE_BYTES);
    expect(validateDeviceSyncBundle(oversized)).toMatchObject({
      ok: false,
      error: expect.stringContaining('大小'),
    });
  });

  it('requires HTTPS except for explicit loopback development', () => {
    expect(normalizeDeviceSyncEndpoint('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
    expect(normalizeDeviceSyncEndpoint('https://sync.example.com/path?q=secret')).toBe(
      'https://sync.example.com/path',
    );
    expect(() => normalizeDeviceSyncEndpoint('http://192.168.1.2:8787')).toThrow(/HTTPS/);
    expect(() => normalizeDeviceSyncEndpoint('http://[::1]:8787')).toThrow(/HTTPS/);
  });
});
