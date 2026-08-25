import { describe, expect, it, vi } from 'vitest';

import { fetchFocusMcpProjection, type FocusSummaryEnv } from '../src/focus-summary';

const TOKEN = 'mcp-service-secret-0123456789abcdefghijklmnopqrstuvwxyz';
const REQUEST = {
  from: 1_700_000_000_000,
  to: 1_700_000_100_000,
  limit: 20,
};

describe('FocusLink authority summary binding', () => {
  it('uses only the internal service credential and validates the exact DTO', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe('/internal/mcp/v1/focus/summary');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        from: String(REQUEST.from),
        to: String(REQUEST.to),
        limit: String(REQUEST.limit),
      });
      expect(request.headers.get('x-focuslink-mcp-service')).toBe(TOKEN);
      expect(request.headers.get('authorization')).toBeNull();
      return Response.json(projection());
    });

    await expect(fetchFocusMcpProjection(env(fetch), REQUEST)).resolves.toMatchObject({
      schemaVersion: 1,
      authority: 'focuslink-account-do',
      freshness: { state: 'fresh' },
      totals: { focusCount: 1 },
      changeSeq: 2,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects private or unknown fields instead of forwarding them to ChatGPT', async () => {
    const value = projection() as Record<string, unknown>;
    const sessions = value.recentSessions as Array<Record<string, unknown>>;
    sessions[0].note = 'must not leave the authority';
    const fetch = vi.fn(async () => Response.json(value));

    await expect(fetchFocusMcpProjection(env(fetch), REQUEST)).rejects.toThrow(
      'focuslink_authority_protocol_error',
    );
  });

  it('fails closed on a missing service credential or upstream redirect', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://public.example/' } }),
    );
    await expect(
      fetchFocusMcpProjection({ ...env(fetch), FOCUSLINK_MCP_SERVICE_TOKEN: 'short' }, REQUEST),
    ).rejects.toThrow('focuslink_mcp_service_not_configured');
    expect(fetch).not.toHaveBeenCalled();

    await expect(fetchFocusMcpProjection(env(fetch), REQUEST)).rejects.toThrow(
      'focuslink_authority_redirect_rejected',
    );
  });
});

function env(fetch: (request: Request) => Promise<Response>): FocusSummaryEnv {
  return {
    FOCUSLINK_MCP_SERVICE_TOKEN: TOKEN,
    FOCUSLINK_UPSTREAM: { fetch } as Fetcher,
  };
}

function projection(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    authority: 'focuslink-account-do',
    generatedAt: REQUEST.to,
    lastVerifiedAt: REQUEST.to - 1_000,
    dataThrough: REQUEST.from + 30_000,
    freshness: {
      state: 'fresh',
      ageMs: 1_000,
      staleAfterMs: 900_000,
    },
    range: { from: REQUEST.from, to: REQUEST.to },
    totals: {
      focusCount: 1,
      activeMs: 30_000,
      pausedMs: 0,
      wallMs: 30_000,
    },
    tasks: [
      {
        taskId: 'task-chemistry',
        source: 'local',
        title: '化学复习',
        focusCount: 1,
        activeMs: 30_000,
        lastFocusedAt: REQUEST.from + 30_000,
      },
    ],
    recentSessions: [
      {
        sessionId: 'session-1',
        startedAt: REQUEST.from,
        endedAt: REQUEST.from + 30_000,
        status: 'finished',
        activeMs: 30_000,
        pausedMs: 0,
        wallMs: 30_000,
        title: '化学复习',
        task: {
          taskId: 'task-chemistry',
          source: 'local',
          title: '化学复习',
        },
        segmentTasks: [
          {
            taskId: 'task-chemistry',
            source: 'local',
            title: '化学复习',
            activeMs: 30_000,
          },
        ],
      },
    ],
    changeSeq: 2,
  };
}
