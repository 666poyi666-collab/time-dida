import { afterEach, describe, expect, it } from 'vitest';

import { createDeviceSyncCloudServer, type DeviceSyncCloudServer } from '../cloud';

const TOKEN = 'personal-cloud-token-value';
const ACCOUNT = 'account-a';

// A non-empty mutations array is enough to classify the request as an authoritative
// v2 write; the guard runs before any store validation, so the payload need not be valid.
function exchangeBody() {
  return {
    protocolVersion: 2,
    deviceId: 'device-a',
    cursor: null,
    mutations: [{ opId: 'op-1', entityType: 'focus_metadata_v2', entityId: 's1', kind: 'put' }],
    pullLimit: 100,
    syncEpoch: 'sync-1',
    cursorEpoch: 'cursor-1',
    accountGeneration: 1,
  };
}

describe('node personal-cloud is a derived backend, not a second v2 authority (P0-2)', () => {
  let server: DeviceSyncCloudServer;
  let baseUrl: string;

  async function start(allowV2AuthoritativeWrites?: boolean): Promise<void> {
    server = createDeviceSyncCloudServer({
      profile: 'personal-cloud',
      tokenAccounts: new Map([[TOKEN, ACCOUNT]]),
      allowedOrigins: ['https://localhost'],
      allowV2AuthoritativeWrites,
    });
    baseUrl = (await server.listen()).url;
  }

  afterEach(async () => {
    await server.close();
  });

  async function post(pathname: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
  }

  it('disables authoritative v2 writes by default and advertises it on /health', async () => {
    await start();

    const health = (await (await fetch(`${baseUrl}/health`)).json()) as {
      v2WriteAuthority: string;
    };
    expect(health.v2WriteAuthority).toBe('disabled-cloudflare-do-authoritative');

    const exchange = await post('/sync/v2/exchange', exchangeBody());
    expect(exchange.status).toBe(409);
    await expect(exchange.json()).resolves.toMatchObject({
      error: { code: 'v2_authority_is_cloudflare_do' },
    });

    const establish = await post('/v2/bootstrap/entities', {
      protocolVersion: 2,
      deviceId: 'device-a',
      bootstrapId: 'b1',
      entities: [],
    });
    expect(establish.status).toBe(409);
    await expect(establish.json()).resolves.toMatchObject({
      error: { code: 'v2_authority_is_cloudflare_do' },
    });

    // Reads remain available so a device can still catch up from the derived node.
    const status = await fetch(`${baseUrl}/sync/v2/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(status.status).toBe(200);

    // A pull-only exchange (no mutations) is a read and must not be blocked as a write.
    const pull = await post('/sync/v2/exchange', { ...exchangeBody(), mutations: [] });
    const pullBody = (await pull.json()) as { error?: { code?: string } };
    expect(pullBody.error?.code).not.toBe('v2_authority_is_cloudflare_do');
  });

  it('permits authoritative writes only under an explicit emergency opt-in', async () => {
    await start(true);

    const health = (await (await fetch(`${baseUrl}/health`)).json()) as {
      v2WriteAuthority: string;
    };
    expect(health.v2WriteAuthority).toBe('emergency-enabled');

    // With emergency writes enabled the request reaches the store; it may still fail
    // downstream (e.g. epoch validation), but never with the authority-block code.
    const exchange = await post('/sync/v2/exchange', exchangeBody());
    const body = (await exchange.json()) as { error?: { code?: string } };
    expect(body.error?.code).not.toBe('v2_authority_is_cloudflare_do');
  });
});
