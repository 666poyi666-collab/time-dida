import { describe, expect, it } from 'vitest';
import {
  FOCUS_MCP_FRESH_AFTER_MS,
  buildFocusMcpProjection,
} from '../shared/sync/focusMcpProjection';
import type { FocusLedgerV2, FocusMetadataV2 } from '../shared/sync/v2Protocol';

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
});
