import { describe, expect, it, vi } from 'vitest';

// The Durable Object only needs to be a definable class for the worker module to
// load; routing tests never instantiate it, so an empty base is sufficient.
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor() {}
  },
}));

import worker from '../cloudflare/worker';
import type { WorkerEnv } from '../cloudflare/accountDurableObject';

const ALLOWED_ORIGIN = 'https://localhost';
const VALID_DEVICE_TOKEN = `fl2_accountaa_devicebb_${'x'.repeat(40)}`;

interface ForwardedCall {
  url: string;
  authorization: string | null;
  forwardedAuthorization: string | null;
  mcpService: string | null;
  internalService: string | null;
  pairAuthority: string | null;
  account: string | null;
}

function makeEnv(forwarded: ForwardedCall[]): WorkerEnv {
  const stub = {
    async fetch(request: Request): Promise<Response> {
      forwarded.push({
        url: request.url,
        authorization: request.headers.get('authorization'),
        forwardedAuthorization: request.headers.get('x-focuslink-authorization'),
        mcpService: request.headers.get('x-focuslink-mcp-service'),
        internalService: request.headers.get('x-focuslink-internal'),
        pairAuthority: request.headers.get('x-focuslink-pair-authority'),
        account: request.headers.get('x-focuslink-account'),
      });
      const ready = new URL(request.url).pathname === '/internal/readyz';
      return new Response(
        JSON.stringify(
          ready
            ? { ok: true, storageReady: true, authority: 'focuslink-account-do' }
            : { ok: true, forwarded: true },
        ),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    },
  };
  return {
    FOCUSLINK_ACCOUNT: {
      idFromName: () => ({ name: 'account' }),
      get: () => stub,
    },
    FOCUSLINK_ACCOUNT_ID: 'account-public',
    FOCUSLINK_SYNC_TOKEN: 'owner-internal-token-with-at-least-32-characters',
    FOCUSLINK_DEVICE_PEPPER: 'device-pepper-with-at-least-32-characters',
    FOCUSLINK_MCP_SERVICE_TOKEN: 'mcp-service-token-which-is-not-a-device-token',
    FOCUSLINK_PAIR_AUTHORITY_TOKEN: `fla_${'p'.repeat(48)}`,
    FOCUSLINK_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
  } as unknown as WorkerEnv;
}

function call(
  path: string,
  {
    method = 'GET',
    authorization,
    origin,
    mcpService,
    pairAuthority,
  }: {
    method?: string;
    authorization?: string;
    origin?: string;
    mcpService?: string;
    pairAuthority?: string;
  } = {},
  env: WorkerEnv = makeEnv([]),
): Promise<Response> {
  const headers = new Headers();
  if (authorization) headers.set('authorization', authorization);
  if (origin) headers.set('origin', origin);
  if (mcpService) headers.set('x-focuslink-mcp-service', mcpService);
  if (pairAuthority) headers.set('x-focuslink-pair-authority', pairAuthority);
  const request = new Request(`https://foxlink-cloud-mcp.example${path}`, { method, headers });
  return worker.fetch(request, env);
}

describe('FocusLink private authority routing behind foxlink-cloud-mcp', () => {
  it('retires every legacy data route with 410 and no production fallback', async () => {
    for (const path of ['/sync/push', '/v1/tasks', '/v1/live', '/v2/sync', '/v2/sync/epoch']) {
      const response = await call(path, { method: 'POST' });
      expect(response.status, `${path} must be retired`).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'legacy_route_retired' },
      });
    }
  });

  it('rejects an OAuth-shaped bearer on the canonical status route', async () => {
    const response = await call('/sync/v2/status', {
      authorization: 'Bearer oauth-looking-access-token',
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('rejects a fabricated but almost-valid fl2 device token', async () => {
    // Secret segment one character short of the 32-char minimum.
    const forged = `fl2_accountaa_devicebb_${'x'.repeat(31)}`;
    const response = await call('/sync/v2/exchange', {
      method: 'POST',
      authorization: `Bearer ${forged}`,
    });
    expect(response.status).toBe(401);
  });

  it('rejects an unauthenticated exchange', async () => {
    const response = await call('/sync/v2/exchange', { method: 'POST' });
    expect(response.status).toBe(401);
  });

  it('forwards canonical pair offers only through the dedicated private authority', async () => {
    const forwarded: ForwardedCall[] = [];
    const env = makeEnv(forwarded);
    const response = await call(
      '/sync/v1/pair/offers',
      {
        method: 'POST',
        pairAuthority: `fla_${'p'.repeat(48)}`,
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toMatchObject({
      authorization: null,
      forwardedAuthorization: 'Bearer owner-internal-token-with-at-least-32-characters',
      pairAuthority: null,
      account: 'account-public',
    });
    expect(forwarded[0].url).toContain('/v2/pair/offers');
  });

  it('rejects missing, malformed and incorrect pair authority before the DO', async () => {
    const forwarded: ForwardedCall[] = [];
    for (const pairAuthority of [undefined, `fla_${'p'.repeat(42)}`, `fla_${'x'.repeat(48)}`]) {
      const response = await call(
        '/sync/v1/pair/offers',
        { method: 'POST', pairAuthority },
        makeEnv(forwarded),
      );
      expect(response.status).toBe(401);
    }
    expect(forwarded).toHaveLength(0);
  });

  it('never accepts the pair authority on sync, live, exchange or MCP routes', async () => {
    const forwarded: ForwardedCall[] = [];
    const env = makeEnv(forwarded);
    const pairAuthority = `fla_${'p'.repeat(48)}`;
    for (const [path, method] of [
      ['/sync/v2/exchange', 'POST'],
      ['/sync/v2/live', 'GET'],
      ['/sync/v1/pair/exchange', 'POST'],
    ] as const) {
      const response = await call(path, { method, pairAuthority }, env);
      expect(response.status).toBe(401);
    }
    expect(forwarded).toHaveLength(0);
  });

  it('returns 404 for any route outside the canonical allowlist', async () => {
    const response = await call('/sync/v2/unknown', { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('forwards only a valid device token, stripping the public Authorization header', async () => {
    const forwarded: ForwardedCall[] = [];
    const env = makeEnv(forwarded);
    const response = await call(
      '/sync/v2/exchange',
      { method: 'POST', authorization: `Bearer ${VALID_DEVICE_TOKEN}`, origin: ALLOWED_ORIGIN },
      env,
    );
    expect(response.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    // The account authority receives the device credential only through the internal
    // header, never the public Authorization header, and is addressed by internal path.
    expect(forwarded[0].authorization).toBeNull();
    expect(forwarded[0].forwardedAuthorization).toBe(`Bearer ${VALID_DEVICE_TOKEN}`);
    expect(forwarded[0].account).toBe('account-public');
    expect(forwarded[0].url).toContain('/v2/sync');
  });

  it('keeps live control available on the canonical route while legacy /v1/live stays retired', async () => {
    const forwarded: ForwardedCall[] = [];
    const env = makeEnv(forwarded);
    const response = await call(
      '/sync/v2/live',
      { authorization: `Bearer ${VALID_DEVICE_TOKEN}` },
      env,
    );
    expect(response.status).toBe(200);
    expect(forwarded[0]).toMatchObject({
      forwardedAuthorization: `Bearer ${VALID_DEVICE_TOKEN}`,
    });
    expect(forwarded[0].url).toContain('/v1/live');
    expect((await call('/v1/live', { authorization: `Bearer ${VALID_DEVICE_TOKEN}` })).status).toBe(
      410,
    );
  });

  it('allows only the dedicated MCP service credential onto the internal focus projection', async () => {
    const denied = await call('/internal/mcp/v1/focus/summary');
    expect(denied.status).toBe(401);

    const forwarded: ForwardedCall[] = [];
    const env = makeEnv(forwarded);
    const accepted = await call(
      '/internal/mcp/v1/focus/summary?limit=10',
      { mcpService: 'mcp-service-token-which-is-not-a-device-token' },
      env,
    );
    expect(accepted.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toMatchObject({
      authorization: null,
      forwardedAuthorization: null,
      mcpService: 'mcp-service-token-which-is-not-a-device-token',
      account: 'account-public',
    });
  });

  it('reports ready only after the Account DO storage probe succeeds', async () => {
    const forwarded: ForwardedCall[] = [];
    const env = makeEnv(forwarded);
    const response = await call('/readyz', {}, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ready: true,
      publicIngress: false,
      authorityReady: true,
      mcpProjectionReady: true,
    });
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toMatchObject({
      account: 'account-public',
      internalService: 'owner-internal-token-with-at-least-32-characters',
    });
    expect(forwarded[0].url).toContain('/internal/readyz');
  });

  it('fails readiness when the MCP service secret or Account DO probe is missing', async () => {
    const missingSecret = makeEnv([]);
    delete missingSecret.FOCUSLINK_MCP_SERVICE_TOKEN;
    expect((await call('/readyz', {}, missingSecret)).status).toBe(503);

    const missingPairAuthority = makeEnv([]);
    delete missingPairAuthority.FOCUSLINK_PAIR_AUTHORITY_TOKEN;
    expect((await call('/readyz', {}, missingPairAuthority)).status).toBe(503);

    const failedProbe = makeEnv([]);
    failedProbe.FOCUSLINK_ACCOUNT = {
      idFromName: () => ({ name: 'account' }),
      get: () => ({
        fetch: async () =>
          new Response(JSON.stringify({ ok: false, storageReady: false }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
      }),
    } as unknown as WorkerEnv['FOCUSLINK_ACCOUNT'];
    const response = await call('/readyz', {}, failedProbe);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'authority_unready' },
    });
  });

  it('fails readiness when any two service secrets are reused', async () => {
    const reused = makeEnv([]);
    reused.FOCUSLINK_MCP_SERVICE_TOKEN = reused.FOCUSLINK_SYNC_TOKEN;
    expect((await call('/readyz', {}, reused)).status).toBe(503);

    reused.FOCUSLINK_MCP_SERVICE_TOKEN = 'mcp-service-token-which-is-not-a-device-token';
    reused.FOCUSLINK_DEVICE_PEPPER = reused.FOCUSLINK_SYNC_TOKEN;
    expect((await call('/readyz', {}, reused)).status).toBe(503);

    reused.FOCUSLINK_DEVICE_PEPPER = 'device-pepper-with-at-least-32-characters';
    reused.FOCUSLINK_PAIR_AUTHORITY_TOKEN = reused.FOCUSLINK_MCP_SERVICE_TOKEN;
    expect((await call('/readyz', {}, reused)).status).toBe(503);
  });

  it('denies a disallowed CORS origin before forwarding', async () => {
    const forwarded: ForwardedCall[] = [];
    const env = makeEnv(forwarded);
    const response = await call(
      '/sync/v2/exchange',
      {
        method: 'POST',
        authorization: `Bearer ${VALID_DEVICE_TOKEN}`,
        origin: 'https://evil.example',
      },
      env,
    );
    expect(response.status).toBe(403);
    expect(forwarded).toHaveLength(0);
  });
});
