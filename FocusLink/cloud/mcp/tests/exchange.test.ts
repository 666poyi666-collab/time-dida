import { describe, expect, it, vi } from 'vitest';

import { handleCanonicalSync, type ExchangeEnv } from '../src/exchange';

const TOKEN = 'fl2_account1_reader01_0123456789abcdefghijklmnopqrstuvwxyzABCDE';
const PROJECTION_TOKEN = 'fl2_account1_project1_0123456789abcdefghijklmnopqrstuvwxyzABCDE';
const PAIR_AUTHORITY_TOKEN = 'fla_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';

const epoch = {
  protocolVersion: 2,
  syncEpoch: 'sync-1',
  cursorEpoch: 'cursor-1',
  accountGeneration: 1,
};

function body(mutations: unknown[] = []) {
  return {
    ...epoch,
    deviceId: 'device-reader01',
    cursor: null,
    mutations,
    pullLimit: 500,
  };
}

describe('canonical /sync/v2 adapter', () => {
  it('proxies status and exchange only through the configured service binding', async () => {
    const upstream = binding(async (request) => {
      expect(request.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
      if (new URL(request.url).pathname === '/sync/v2/status') {
        expect(request.method).toBe('GET');
        return Response.json({
          ...epoch,
          changeSeq: 4,
          serverTime: Date.now(),
        });
      }
      expect(request.method).toBe('POST');
      expect(await request.json()).toEqual(body());
      return Response.json({
        ...epoch,
        acks: [],
        changes: [],
        nextCursor: 'c4',
        hasMore: false,
        serverTime: Date.now(),
      });
    });
    const env = exchangeEnv(upstream);

    const status = await handleCanonicalSync(request('/sync/v2/status', 'GET', TOKEN), env);
    expect(status.status).toBe(200);

    const exchange = await handleCanonicalSync(
      request('/sync/v2/exchange', 'POST', TOKEN, body()),
      env,
    );
    expect(exchange.status).toBe(200);
    expect(exchange.headers.get('x-focuslink-authority')).toBe('durable-object-v2');
    expect(upstream.fetch).toHaveBeenCalledTimes(2);
  });

  it('preserves mutation opId/device/revision semantics and returns the DO ack unchanged', async () => {
    const mutation = {
      opId: 'op-idempotent-1',
      entityType: 'focus_metadata_v2',
      entityId: 'session-1',
      kind: 'put',
      baseRevision: 0,
      baseFingerprint: null,
      payload: {
        sessionId: 'session-1',
        title: 'Canonical write',
        note: null,
        subject: null,
        tags: [],
        taskAssociation: null,
        updatedAt: Date.now(),
        updatedByDeviceId: 'device-reader01',
      },
      deviceId: 'device-reader01',
      accountGeneration: 1,
    };
    const ack = {
      opId: mutation.opId,
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      status: 'applied',
      revision: 1,
      fingerprint: 'a'.repeat(64),
      errorCode: null,
    };
    const upstream = binding(async (request) => {
      const forwarded = (await request.json()) as { mutations: unknown[] };
      expect(forwarded.mutations).toEqual([mutation]);
      return Response.json({
        ...epoch,
        acks: [ack],
        changes: [],
        nextCursor: 'c1',
        hasMore: false,
        serverTime: Date.now(),
      });
    });
    const response = await handleCanonicalSync(
      request('/sync/v2/exchange', 'POST', TOKEN, body([mutation])),
      exchangeEnv(upstream),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ acks: [ack] });
  });

  it('rejects device spoofing locally before the authority is called', async () => {
    const upstream = binding(async () => Response.json({ error: 'must_not_run' }));
    const spoofed = { ...body(), deviceId: 'device-someone-else' };
    const response = await handleCanonicalSync(
      request('/sync/v2/exchange', 'POST', TOKEN, spoofed),
      exchangeEnv(upstream),
    );
    expect(response.status).toBe(400);
    expect(upstream.fetch).not.toHaveBeenCalled();
  });

  it('never accepts projection, pair-authority, or OAuth RS credentials as device exchange tokens', async () => {
    const upstream = binding(async () => Response.json({ error: 'must_not_run' }));
    const env = exchangeEnv(upstream);
    env.FOCUSLINK_DEVICE_TOKEN = PROJECTION_TOKEN;
    env.OAUTH_RS_CLIENT_SECRET = TOKEN;
    env.FOCUSLINK_PAIR_AUTHORITY_TOKEN = PAIR_AUTHORITY_TOKEN;

    const rsResponse = await handleCanonicalSync(
      request('/sync/v2/exchange', 'POST', TOKEN, body()),
      env,
    );
    expect(rsResponse.status).toBe(403);

    const projectionBody = { ...body(), deviceId: 'device-project1' };
    const projectionResponse = await handleCanonicalSync(
      request('/sync/v2/exchange', 'POST', PROJECTION_TOKEN, projectionBody),
      env,
    );
    expect(projectionResponse.status).toBe(403);

    const pairingResponse = await handleCanonicalSync(
      request('/sync/v2/exchange', 'POST', PAIR_AUTHORITY_TOKEN, body()),
      env,
    );
    expect(pairingResponse.status).toBe(401);
    expect(upstream.fetch).not.toHaveBeenCalled();
  });

  it('passes read-only write rejection, revoked, expired, and cross-account failures through', async () => {
    for (const status of [401, 403]) {
      const upstream = binding(async () =>
        Response.json(
          {
            error: {
              code: status === 401 ? 'credential_invalid' : 'scope_denied',
            },
          },
          { status },
        ),
      );
      const response = await handleCanonicalSync(
        request('/sync/v2/exchange', 'POST', TOKEN, body()),
        exchangeEnv(upstream),
      );
      expect(response.status).toBe(status);
      expect(upstream.fetch).toHaveBeenCalledOnce();
    }
  });

  it('rejects malformed credentials, JSON, oversized/unknown fields, and denied origins', async () => {
    const upstream = binding(async () => Response.json({ error: 'must_not_run' }));
    const env = exchangeEnv(upstream);

    expect(
      (
        await handleCanonicalSync(
          request('/sync/v2/exchange', 'POST', 'not-a-device-token', body()),
          env,
        )
      ).status,
    ).toBe(401);

    const extra = { ...body(), authority: 'client-claim' };
    expect(
      (await handleCanonicalSync(request('/sync/v2/exchange', 'POST', TOKEN, extra), env)).status,
    ).toBe(400);

    const denied = request('/sync/v2/exchange', 'POST', TOKEN, body());
    denied.headers.set('origin', 'https://evil.example');
    expect((await handleCanonicalSync(denied, env)).status).toBe(403);
    expect(upstream.fetch).not.toHaveBeenCalled();
  });

  it('proxies the canonical task and live surfaces through the private authority', async () => {
    const seen: Array<{
      path: string;
      method: string;
      search: string;
      body: unknown;
    }> = [];
    const upstream = binding(async (request) => {
      const url = new URL(request.url);
      seen.push({
        path: url.pathname,
        method: request.method,
        search: url.search,
        body: request.method === 'POST' ? await request.json() : null,
      });
      return Response.json({ ok: true });
    });
    const env = exchangeEnv(upstream);

    expect((await handleCanonicalSync(request('/sync/v2/tasks', 'GET', TOKEN), env)).status).toBe(
      200,
    );
    expect(
      (
        await handleCanonicalSync(
          request('/sync/v2/tasks', 'POST', TOKEN, {
            protocolVersion: 1,
            revision: 2,
            tasks: [],
          }),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleCanonicalSync(
          request('/sync/v2/tasks/mutate', 'POST', TOKEN, {
            protocolVersion: 1,
            operationId: 'mcp-op-1234',
            expectedRevision: 2,
            deviceId: 'mcp-service',
            mutation: { kind: 'set_task_completed', taskId: 'task-1', completed: true },
          }),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleCanonicalSync(
          request('/sync/v2/live/wait?afterRevision=3&waitMs=1000', 'GET', TOKEN),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleCanonicalSync(
          request('/sync/v2/live/command', 'POST', TOKEN, {
            protocolVersion: 1,
            deviceId: 'device-reader01',
            command: { type: 'pause' },
          }),
          env,
        )
      ).status,
    ).toBe(200);

    expect(seen.map((item) => item.path)).toEqual([
      '/sync/v2/tasks',
      '/sync/v2/tasks',
      '/sync/v2/tasks/mutate',
      '/sync/v2/live/wait',
      '/sync/v2/live/command',
    ]);
    expect(seen[3]?.search).toBe('?afterRevision=3&waitMs=1000');
    expect(seen[4]?.body).toMatchObject({ deviceId: 'device-reader01' });
    expect(
      (await handleCanonicalSync(request('/sync/v2/live/command', 'GET', TOKEN), env)).status,
    ).toBe(405);
  });

  it('proxies device inventory and exact targeted revocation without accepting a body', async () => {
    const seen: Array<{ path: string; method: string; body: string }> = [];
    const upstream = binding(async (request) => {
      seen.push({
        path: new URL(request.url).pathname,
        method: request.method,
        body: await request.text(),
      });
      return Response.json({ ok: true });
    });
    const env = exchangeEnv(upstream);

    expect((await handleCanonicalSync(request('/sync/v2/devices', 'GET', TOKEN), env)).status).toBe(
      200,
    );
    expect(
      (
        await handleCanonicalSync(
          request('/sync/v2/devices/device-reader01/revoke', 'POST', TOKEN),
          env,
        )
      ).status,
    ).toBe(200);
    expect(seen).toEqual([
      { path: '/sync/v2/devices', method: 'GET', body: '' },
      {
        path: '/sync/v2/devices/device-reader01/revoke',
        method: 'POST',
        body: '',
      },
    ]);

    expect(
      (
        await handleCanonicalSync(
          request('/sync/v2/devices/device-reader01/revoke', 'POST', TOKEN, {}),
          env,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await handleCanonicalSync(
          request('/sync/v2/devices/not-a-device/revoke', 'POST', TOKEN),
          env,
        )
      ).status,
    ).toBe(404);
    expect(
      (await handleCanonicalSync(request('/sync/v2/devices?include=secrets', 'GET', TOKEN), env))
        .status,
    ).toBe(400);
  });

  it('rejects upstream redirects and unexpected status queries', async () => {
    const upstream = binding(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example' },
        }),
    );
    const env = exchangeEnv(upstream);
    const redirected = await handleCanonicalSync(request('/sync/v2/live', 'GET', TOKEN), env);
    expect(redirected.status).toBe(502);
    expect(await redirected.json()).toMatchObject({
      error: { code: 'authoritative_redirect_rejected' },
    });

    const queried = await handleCanonicalSync(request('/sync/v2/status?tail=1', 'GET', TOKEN), env);
    expect(queried.status).toBe(400);
  });

  it('retires v1 data aliases and does not preflight unknown v2 routes', async () => {
    const upstream = binding(async () => Response.json({ error: 'must_not_run' }));
    const env = exchangeEnv(upstream);
    for (const path of ['/sync/v1/status', '/sync/v1/exchange']) {
      const response = await handleCanonicalSync(request(path, 'GET', TOKEN), env);
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({
        error: { code: 'legacy_sync_route_retired' },
      });
    }
    const unknown = await handleCanonicalSync(request('/sync/v2/not-real', 'OPTIONS', TOKEN), env);
    expect(unknown.status).toBe(404);

    const known = await handleCanonicalSync(request('/sync/v2/live', 'OPTIONS', TOKEN), env);
    expect(known.status).toBe(204);
    expect(known.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    expect(upstream.fetch).not.toHaveBeenCalled();
  });

  it('enforces exact live-wait queries and per-route body limits', async () => {
    const upstream = binding(async () => Response.json({ ok: true }));
    const env = exchangeEnv(upstream);
    const invalidWaits = [
      '/sync/v2/live/wait',
      '/sync/v2/live/wait?afterRevision=1',
      '/sync/v2/live/wait?afterRevision=1&afterRevision=2&waitMs=1',
      '/sync/v2/live/wait?afterRevision=1&waitMs=25001',
      '/sync/v2/live/wait?afterRevision=-1&waitMs=1',
      '/sync/v2/live/wait?afterRevision=1&waitMs=1&extra=1',
    ];
    for (const path of invalidWaits) {
      expect((await handleCanonicalSync(request(path, 'GET', TOKEN), env)).status).toBe(400);
    }
    expect(
      (await handleCanonicalSync(request('/sync/v2/tasks?ignored=true', 'GET', TOKEN), env)).status,
    ).toBe(400);

    const oversizedTask = await handleCanonicalSync(
      request('/sync/v2/tasks', 'POST', TOKEN, {
        value: 'x'.repeat(512 * 1024),
      }),
      env,
    );
    expect(oversizedTask.status).toBe(413);
    expect(await oversizedTask.json()).toMatchObject({
      error: { code: 'task_body_too_large' },
    });

    const oversizedCommand = await handleCanonicalSync(
      request('/sync/v2/live/command', 'POST', TOKEN, {
        value: 'x'.repeat(16 * 1024),
      }),
      env,
    );
    expect(oversizedCommand.status).toBe(413);
    expect(await oversizedCommand.json()).toMatchObject({
      error: { code: 'live_command_body_too_large' },
    });
    const oversizedMutation = await handleCanonicalSync(
      request('/sync/v2/tasks/mutate', 'POST', TOKEN, {
        value: 'x'.repeat(512 * 1024),
      }),
      env,
    );
    expect(oversizedMutation.status).toBe(413);
    expect(await oversizedMutation.json()).toMatchObject({
      error: { code: 'task_mutation_body_too_large' },
    });
    expect(upstream.fetch).not.toHaveBeenCalled();
  });
});

function exchangeEnv(upstream: { fetch: ReturnType<typeof vi.fn> }): ExchangeEnv {
  return {
    FOCUSLINK_UPSTREAM: upstream as unknown as Fetcher,
    FOCUSLINK_DEVICE_TOKEN: PROJECTION_TOKEN,
    FOCUSLINK_PAIR_AUTHORITY_TOKEN: PAIR_AUTHORITY_TOKEN,
    OAUTH_RS_CLIENT_SECRET: 'oauth-rs-client-secret-that-is-not-a-device-token',
    FOCUSLINK_ALLOWED_ORIGINS: 'https://localhost',
  };
}

function binding(handler: (request: Request) => Promise<Response>) {
  return { fetch: vi.fn(handler) };
}

function request(path: string, method: string, token: string, value?: unknown): Request {
  return new Request(`https://worker.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(value === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
}
