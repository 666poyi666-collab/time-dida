import { describe, expect, it } from 'vitest';
import {
  FOCUS_MCP_FRESH_AFTER_MS,
  buildFocusMcpRecordsProjection,
  buildFocusMcpProjection,
} from '../shared/sync/focusMcpProjection';
import type { LiveFocusSnapshot } from '../shared/sync/liveFocusProtocol';
import type {
  FocusLedgerCorrectionV2,
  FocusLedgerV2,
  FocusMetadataV2,
} from '../shared/sync/v2Protocol';

const NOW = 2_000_000_000_000;

function ledger(
  sessionId: string,
  endedAt: number,
  task: { id: string; title: string } | null,
): FocusLedgerV2 {
  return {
    sessionId,
    startedAt: endedAt - 30 * 60_000,
    endedAt,
    status: 'finished',
    activeElapsedMs: 25 * 60_000,
    pausedElapsedMs: 5 * 60_000,
    wallElapsedMs: 30 * 60_000,
    originDeviceId: 'device-phone',
    segments: [
      {
        id: `segment-${sessionId}`,
        sessionId,
        taskId: task?.id ?? null,
        taskSource: task ? 'local' : null,
        title: task?.title ?? null,
        startedAt: endedAt - 30 * 60_000,
        endedAt: endedAt,
        activeElapsedMs: 25 * 60_000,
        note: null,
        tomatodoSubject: null,
        createdAt: endedAt - 30 * 60_000,
        updatedAt: endedAt,
      },
    ],
    pauses: [],
  };
}

function metadata(sessionId: string, title: string, taskId: string | null): FocusMetadataV2 {
  return {
    sessionId,
    title,
    note: 'must never appear in the MCP projection',
    subject: null,
    tags: [{ tagId: 'private', name: 'private' }],
    taskAssociation: taskId ? { taskId, source: 'local', title } : null,
    updatedAt: NOW,
    updatedByDeviceId: 'device-phone',
  };
}

describe('FocusLink cloud MCP projection', () => {
  it('returns counts, task allocation, exact durations and recent sessions without notes or tags', () => {
    const result = buildFocusMcpProjection({
      ledgers: [
        { revision: 1, payload: ledger('session-a', NOW - 1_000, { id: 'task-a', title: '化学' }) },
        { revision: 1, payload: ledger('session-b', NOW - 2_000, { id: 'task-a', title: '化学' }) },
        { revision: 1, payload: ledger('session-old', NOW - 90_000_000, null) },
      ],
      metadata: [
        { revision: 1, payload: metadata('session-a', '化学', 'task-a') },
        { revision: 1, payload: metadata('session-b', '化学', 'task-a') },
      ],
      generatedAt: NOW,
      lastVerifiedAt: NOW - 5_000,
      changeSeq: 42,
      from: NOW - 60_000,
      to: NOW + 1,
      limit: 1,
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      authority: 'focuslink-account-do',
      lastVerifiedAt: NOW - 5_000,
      freshness: { state: 'fresh', ageMs: 5_000, staleAfterMs: FOCUS_MCP_FRESH_AFTER_MS },
      totals: {
        focusCount: 2,
        activeMs: 50 * 60_000,
        pausedMs: 10 * 60_000,
        wallMs: 60 * 60_000,
      },
      tasks: [
        {
          taskId: 'task-a',
          source: 'local',
          title: '化学',
          focusCount: 2,
          activeMs: 50 * 60_000,
        },
      ],
      changeSeq: 42,
    });
    expect(result.recentSessions).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('must never appear');
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('marks authority verification stale independently of whether historical data exists', () => {
    const result = buildFocusMcpProjection({
      ledgers: [],
      metadata: [],
      generatedAt: NOW,
      lastVerifiedAt: NOW - FOCUS_MCP_FRESH_AFTER_MS - 1,
      changeSeq: 0,
      from: NOW - 60_000,
      to: NOW,
      limit: 20,
    });
    expect(result.freshness.state).toBe('stale');
    expect(result.dataThrough).toBeNull();
    expect(result.totals.focusCount).toBe(0);
  });

  it('returns corrected record timelines and a sanitized cloud live state', () => {
    const original = ledger('session-corrected', NOW - 2_000, { id: 'task-a', title: '化学' });
    original.segments[0]!.note = 'segment private note';
    original.pauses = [
      {
        id: 'pause-corrected',
        sessionId: original.sessionId,
        segmentId: original.segments[0]!.id,
        pauseStartedAt: original.startedAt + 10 * 60_000,
        pauseEndedAt: original.startedAt + 15 * 60_000,
        durationMs: 5 * 60_000,
        reason: 'private pause reason',
        createdAt: original.startedAt + 10 * 60_000,
        updatedAt: original.startedAt + 15 * 60_000,
      },
    ];
    const corrected = {
      ...original,
      activeElapsedMs: 20 * 60_000,
      pausedElapsedMs: 10 * 60_000,
    };
    const correction: FocusLedgerCorrectionV2 = {
      correctionId: 'correction-session-corrected',
      sessionId: original.sessionId,
      baseLedgerRevision: 3,
      before: original,
      after: corrected,
      reason: 'local_ledger_changed_after_sync',
      createdAt: original.endedAt,
      createdByDeviceId: 'device-desktop',
    };
    const live: LiveFocusSnapshot = {
      revision: 9,
      state: 'paused',
      session: {
        id: 'live-session',
        title: '当前专注',
        state: 'paused',
        startedAt: NOW - 20 * 60_000,
        activeElapsedMs: 15 * 60_000,
        pauseElapsedMs: 5 * 60_000,
        wallElapsedMs: 20 * 60_000,
        currentPauseStartedAt: NOW - 1_000,
        task: { taskId: 'task-live', taskSource: 'local', taskTitle: '生物' },
        segments: [{ id: 'live-segment', startedAt: NOW - 20 * 60_000, endedAt: null }],
        pauses: [
          { id: 'live-pause', segmentId: 'live-segment', startedAt: NOW - 1_000, endedAt: null },
        ],
        updatedAt: NOW,
        lastCommandDeviceId: 'device-watch-private',
      },
    };

    const result = buildFocusMcpRecordsProjection({
      ledgers: [{ revision: 3, payload: original }],
      metadata: [{ revision: 2, payload: metadata(original.sessionId, '化学', 'task-a') }],
      corrections: [{ revision: 1, payload: correction }],
      live,
      serverTime: NOW,
      generatedAt: NOW,
      lastVerifiedAt: NOW,
      from: NOW - 60 * 60_000,
      to: NOW + 1,
      limit: 20,
    });

    expect(result.records).toEqual([
      expect.objectContaining({
        id: original.sessionId,
        activeElapsedMs: 20 * 60_000,
        pausedElapsedMs: 10 * 60_000,
        corrected: true,
        revision: { ledger: 3, metadata: 2, correction: 1 },
        pauses: [
          {
            id: 'pause-corrected',
            segmentId: 'segment-session-corrected',
            startedAt: original.startedAt + 10 * 60_000,
            endedAt: original.startedAt + 15 * 60_000,
            durationMs: 5 * 60_000,
          },
        ],
      }),
    ]);
    expect(result.live).toMatchObject({
      revision: 9,
      state: 'paused',
      session: { id: 'live-session', task: { taskId: 'task-live', source: 'local' } },
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      'device-phone',
      'device-desktop',
      'device-watch-private',
      'segment private note',
      'private pause reason',
      'must never appear in the MCP projection',
      'private',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('does not apply a correction whose base ledger fingerprint does not match', () => {
    const original = ledger('session-invalid-correction', NOW - 1_000, null);
    const mismatched = ledger('session-invalid-correction', NOW - 2_000, null);
    const correction: FocusLedgerCorrectionV2 = {
      correctionId: 'correction-invalid',
      sessionId: original.sessionId,
      baseLedgerRevision: 2,
      before: mismatched,
      after: { ...original, activeElapsedMs: 1 },
      reason: 'local_ledger_changed_after_sync',
      createdAt: original.endedAt,
      createdByDeviceId: 'device-desktop',
    };

    const result = buildFocusMcpRecordsProjection({
      ledgers: [{ revision: 2, payload: original }],
      metadata: [],
      corrections: [{ revision: 1, payload: correction }],
      live: { revision: 0, state: 'idle', session: null },
      serverTime: NOW,
      generatedAt: NOW,
      lastVerifiedAt: null,
      from: NOW - 60 * 60_000,
      to: NOW + 1,
      limit: 20,
    });

    expect(result.records[0]).toMatchObject({
      activeElapsedMs: original.activeElapsedMs,
      corrected: false,
      revision: { ledger: 2, metadata: null, correction: null },
    });
  });
});
