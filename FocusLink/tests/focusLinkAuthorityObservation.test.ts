import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor() {}
  },
  WorkerEntrypoint: class {
    env: unknown;
    constructor(_context: unknown, env: unknown) {
      this.env = env;
    }
  },
}));

import {
  FOCUSLINK_AUTHORITY_OBSERVATION_MEDIA_TYPE,
  FOCUSLINK_AUTHORITY_OBSERVATION_PATH,
  buildFocusLinkAuthorityObservation,
  validateFocusLinkAuthorityObservation,
} from '../cloudflare/authorityObservation';
import worker, { FocusLinkAuthorityObservation } from '../cloudflare/worker';
import type { WorkerEnv } from '../cloudflare/accountDurableObject';

const AUDIENCE = 'https://authority.contract.test/authority/focuslink';

function capability(): string {
  return `fao_${randomBytes(32).toString('base64url')}`;
}

function observation(now: number, revision = 7) {
  return buildFocusLinkAuthorityObservation({
    revision,
    audience: AUDIENCE,
    observedAtMs: now,
    lastVerifiedAtMs: now - 1_000,
    pendingCount: 0,
    blockerReason: null,
    readAvailable: true,
    writeAvailable: true,
    continuedSync: true,
  });
}

function environment(value: unknown, configuredCapability = capability()): WorkerEnv {
  return {
    FOCUSLINK_ACCOUNT: {
      idFromName: () => ({ name: 'focuslink-account' }),
      get: () => ({
        fetch: async () =>
          new Response(JSON.stringify(value), {
            status: 200,
            headers: { 'content-type': FOCUSLINK_AUTHORITY_OBSERVATION_MEDIA_TYPE },
          }),
      }),
    },
    FOCUSLINK_ACCOUNT_ID: 'focuslink-account',
    FOCUSLINK_SYNC_TOKEN: `internal-${'i'.repeat(40)}`,
    FOCUSLINK_DEVICE_PEPPER: `pepper-${'p'.repeat(40)}`,
    FOCUSLINK_MCP_SERVICE_TOKEN: `mcp-${'m'.repeat(40)}`,
    FOCUSLINK_PAIR_AUTHORITY_TOKEN: `fla_${'q'.repeat(48)}`,
    FOCUSLINK_AUTHORITY_CAPABILITY: configuredCapability,
    FOCUSLINK_AUTHORITY_AUDIENCE: AUDIENCE,
  } as unknown as WorkerEnv;
}

function request(configuredCapability: string, overrides: HeadersInit = {}): Request {
  const headers = new Headers({
    accept: FOCUSLINK_AUTHORITY_OBSERVATION_MEDIA_TYPE,
    authorization: `Capability ${configuredCapability}`,
    'x-poyi-authority-audience': AUDIENCE,
  });
  new Headers(overrides).forEach((value, key) => headers.set(key, value));
  return new Request(
    `https://focuslink-observation.internal${FOCUSLINK_AUTHORITY_OBSERVATION_PATH}`,
    {
      headers,
    },
  );
}

describe('FocusLink service-binding authority observation', () => {
  it('keeps the exact observation body and hash immutable for one real revision', async () => {
    const now = Date.now();
    const snapshot = observation(now);
    const configuredCapability = capability();
    const env = environment(snapshot, configuredCapability);
    const entrypoint = new FocusLinkAuthorityObservation({} as never, env);

    const first = await entrypoint.fetch(request(configuredCapability));
    const second = await entrypoint.fetch(request(configuredCapability));
    const firstBody = await first.text();
    const secondBody = await second.text();

    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe(FOCUSLINK_AUTHORITY_OBSERVATION_MEDIA_TYPE);
    expect(second.status).toBe(200);
    expect(firstBody).toBe(secondBody);
    expect(createHash('sha256').update(firstBody).digest('hex')).toBe(
      createHash('sha256').update(secondBody).digest('hex'),
    );
    expect(Object.keys(JSON.parse(firstBody)).sort()).toEqual(
      ['schemaVersion', 'productId', 'audience', 'observedAt', 'expiresAt', 'truth'].sort(),
    );
    expect(firstBody).not.toMatch(/signature|secret|token|deviceId|cursor|envelope/i);
  });

  it('rejects public ingress, missing binding/config, bad media, capability and audience', async () => {
    const now = Date.now();
    const snapshot = observation(now);
    const configuredCapability = capability();
    const env = environment(snapshot, configuredCapability);
    const entrypoint = new FocusLinkAuthorityObservation({} as never, env);

    expect(
      (
        await worker.fetch(
          new Request(`https://public.example${FOCUSLINK_AUTHORITY_OBSERVATION_PATH}`),
          env,
        )
      ).status,
    ).toBe(403);
    const missingBinding = environment(snapshot, configuredCapability);
    delete (missingBinding as Partial<WorkerEnv>).FOCUSLINK_ACCOUNT;
    expect(
      (
        await new FocusLinkAuthorityObservation({} as never, missingBinding).fetch(
          request(configuredCapability),
        )
      ).status,
    ).toBe(503);
    const missingCapability = environment(snapshot, configuredCapability);
    delete missingCapability.FOCUSLINK_AUTHORITY_CAPABILITY;
    expect(
      (
        await new FocusLinkAuthorityObservation({} as never, missingCapability).fetch(
          request(configuredCapability),
        )
      ).status,
    ).toBe(503);
    expect(
      (await entrypoint.fetch(request(configuredCapability, { accept: 'application/json' })))
        .status,
    ).toBe(406);
    expect(
      (await entrypoint.fetch(request(configuredCapability, { authorization: 'Bearer ignored' })))
        .status,
    ).toBe(401);
    expect(
      (
        await entrypoint.fetch(
          request(configuredCapability, {
            'x-poyi-authority-audience': 'https://authority.contract.test/authority/other',
          }),
        )
      ).status,
    ).toBe(403);
  });

  it('fails closed for expiry, dependency failure and any extra observation field', async () => {
    const now = Date.now();
    const configuredCapability = capability();
    const expired = observation(now - 10 * 60_000);
    expect(
      (
        await new FocusLinkAuthorityObservation(
          {} as never,
          environment(expired, configuredCapability),
        ).fetch(request(configuredCapability))
      ).status,
    ).toBe(503);

    const extra = { ...observation(now), unexpected: true };
    expect(
      (
        await new FocusLinkAuthorityObservation(
          {} as never,
          environment(extra, configuredCapability),
        ).fetch(request(configuredCapability))
      ).status,
    ).toBe(503);

    const failed = environment(observation(now), configuredCapability);
    failed.FOCUSLINK_ACCOUNT = {
      idFromName: () => ({ name: 'focuslink-account' }),
      get: () => ({ fetch: async () => new Response(null, { status: 503 }) }),
    } as unknown as WorkerEnv['FOCUSLINK_ACCOUNT'];
    expect(
      (
        await new FocusLinkAuthorityObservation({} as never, failed).fetch(
          request(configuredCapability),
        )
      ).status,
    ).toBe(503);
  });

  it('validates exact HTTPS audience, exact truth fields and expiry', () => {
    const now = Date.now();
    const value = observation(now);
    expect(validateFocusLinkAuthorityObservation(value, now)).toBe(true);
    expect(validateFocusLinkAuthorityObservation({ ...value, extra: true }, now)).toBe(false);
    expect(
      validateFocusLinkAuthorityObservation(
        { ...value, audience: 'http://authority.contract.test/authority/focuslink' },
        now,
      ),
    ).toBe(false);
    expect(validateFocusLinkAuthorityObservation(value, Date.parse(value.expiresAt))).toBe(false);
    expect(
      validateFocusLinkAuthorityObservation(
        { ...value, truth: { ...value.truth, extra: true } },
        now,
      ),
    ).toBe(false);
  });
});
