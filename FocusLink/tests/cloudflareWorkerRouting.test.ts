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
  account: string | null;
}

function makeEnv(forwarded: ForwardedCall[]): WorkerEnv {
  const stub = {
    async fetch(request: Request): Promise<Response> {
      forwarded.push({
        url: request.url,
        authorization: request.headers.get('authorization'),
        forwardedAuthorization: request.headers.get('x-focuslink-authorization'),
        account: request.headers.get('x-focuslink-account'),
      });
      return new Response(JSON.stringify({ ok: true, forwarded: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  return {
    FOCUSLINK_ACCOUNT: {
      idFromName: () => ({ name: 'account' }),
      get: () => stub,
    },
    FOCUSLINK_ACCOUNT_ID: 'account-public',
    FOCUSLINK_SYNC_TOKEN: 'owner-internal-token',
    FOCUSLINK_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
  } as unknown as WorkerEnv;
}

function call(
  path: string,
  { method = 'GET', authorization, origin }: {
    method?: string;
    authorization?: string;
    origin?: string;
  } = {},
  env: WorkerEnv = makeEnv([]),
): Promise<Response> {
  const headers = new Headers();
  if (authorization) headers.set('authorization', authorization);
  if (origin) headers.set('origin', origin);
  const request = new Request(`https://foxlink-cloud-mcp.example${path}`, { method, headers });
  return worker.fetch(request, env);
}

describe('foxlink public worker routing is the single guarded entry', () => {
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

  it('never lets a public device token mint pairing offers', async () => {
    const response = await call('/sync/v1/pair/offers', {
      method: 'POST',
      authorization: `Bearer ${VALID_DEVICE_TOKEN}`,
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'pair_offers_internal_only' },
    });
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

  it('denies a disallowed CORS origin before forwarding', async () => {
    const forwarded: ForwardedCall[] = [];
    const env = makeEnv(forwarded);
    const response = await call(
      '/sync/v2/exchange',
      { method: 'POST', authorization: `Bearer ${VALID_DEVICE_TOKEN}`, origin: 'https://evil.example' },
      env,
    );
    expect(response.status).toBe(403);
    expect(forwarded).toHaveLength(0);
  });
});
