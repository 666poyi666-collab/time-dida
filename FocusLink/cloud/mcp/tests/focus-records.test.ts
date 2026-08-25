import { describe, expect, it, vi } from 'vitest';

import { fetchFocusMcpRecords, type FocusRecordsEnv } from '../src/focus-records';

const TOKEN = 'mcp-service-secret-0123456789abcdefghijklmnopqrstuvwxyz';
const REQUEST = {
  from: 1_700_000_000_000,
  to: 1_700_000_100_000,
  limit: 20,
};

describe('FocusLink authority record binding', () => {
  it('uses the direct Account DO records endpoint and returns live timeline details', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe('/internal/mcp/v1/focus/records');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        from: String(REQUEST.from),
        to: String(REQUEST.to),
        limit: String(REQUEST.limit),
      });
      expect(request.headers.get('x-focuslink-mcp-service')).toBe(TOKEN);
      expect(request.headers.get('authorization')).toBeNull();
      return Response.json(records());
    });

    await expect(fetchFocusMcpRecords(env(fetch), REQUEST)).resolves.toMatchObject({
      authority: 'focuslink-account-do',
      records: [
        {
          id: 'session-1',
          segments: [{ id: 'segment-1', activeElapsedMs: 25_000 }],
          pauses: [{ id: 'pause-1', durationMs: 5_000 }],
        },
      ],
      live: { state: 'paused', session: { id: 'live-session' } },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects unrequested private fields instead of forwarding them to ChatGPT', async () => {
    const value = records() as Record<string, unknown>;
    const live = value.live as Record<string, unknown>;
    const session = live.session as Record<string, unknown>;
    session.lastCommandDeviceId = 'device-private';
    const fetch = vi.fn(async () => Response.json(value));

    await expect(fetchFocusMcpRecords(env(fetch), REQUEST)).rejects.toThrow(
      'focuslink_authority_protocol_error',
    );
  });
});

function env(fetch: (request: Request) => Promise<Response>): FocusRecordsEnv {
  return {
    FOCUSLINK_MCP_SERVICE_TOKEN: TOKEN,
    FOCUSLINK_UPSTREAM: { fetch } as Fetcher,
  };
}

function records(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    authority: 'focuslink-account-do',
    generatedAt: REQUEST.to,
    lastVerifiedAt: REQUEST.to - 1_000,
    freshness: { state: 'fresh', ageMs: 1_000, staleAfterMs: 900_000 },
    range: { from: REQUEST.from, to: REQUEST.to },
    records: [
      {
        id: 'session-1',
        startedAt: REQUEST.from,
        endedAt: REQUEST.from + 30_000,
        status: 'finished',
        activeElapsedMs: 25_000,
        pausedElapsedMs: 5_000,
        wallElapsedMs: 30_000,
        title: '化学复习',
        task: { taskId: 'task-chemistry', source: 'local', title: '化学复习' },
        segments: [
          {
            id: 'segment-1',
            startedAt: REQUEST.from,
            endedAt: REQUEST.from + 30_000,
            activeElapsedMs: 25_000,
            title: '化学复习',
            task: { taskId: 'task-chemistry', source: 'local', title: '化学复习' },
          },
        ],
        pauses: [
          {
            id: 'pause-1',
            segmentId: 'segment-1',
            startedAt: REQUEST.from + 10_000,
            endedAt: REQUEST.from + 15_000,
            durationMs: 5_000,
          },
        ],
        corrected: false,
        revision: { ledger: 1, metadata: 1, correction: null },
      },
    ],
    live: {
      revision: 4,
      serverTime: REQUEST.to,
      state: 'paused',
      session: {
        id: 'live-session',
        title: '当前专注',
        state: 'paused',
        startedAt: REQUEST.to - 60_000,
        activeElapsedMs: 55_000,
        pauseElapsedMs: 5_000,
        wallElapsedMs: 60_000,
        currentPauseStartedAt: REQUEST.to - 1_000,
        task: { taskId: 'task-live', source: 'local', title: '生物' },
        segments: [{ id: 'live-segment', startedAt: REQUEST.to - 60_000, endedAt: null }],
        pauses: [
          {
            id: 'live-pause',
            segmentId: 'live-segment',
            startedAt: REQUEST.to - 1_000,
            endedAt: null,
          },
        ],
        updatedAt: REQUEST.to,
      },
    },
  };
}
