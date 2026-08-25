import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearOAuthCachesForTest,
  verifyAccessToken,
  type AccessTokenClaims,
  type OAuthConfiguration,
} from '../src/oauth';

const ISSUER = 'https://oauth.test';
const AUDIENCE = 'https://worker.test/mcp';
const KID = 'test-rs256-2026-07';
const RS_AUTH = `Basic ${btoa('foxlink-rs:rs-client-secret-0123456789abcdef')}`;

let keys: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string; alg: string; use: string };

const config: OAuthConfiguration = {
  issuer: ISSUER,
  audience: AUDIENCE,
  jwksUrl: `${ISSUER}/jwks.json`,
  introspectionUrl: `${ISSUER}/introspect`,
  introspectionAuthorization: RS_AUTH,
};

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  publicJwk = {
    ...(await crypto.subtle.exportKey('jwk', keys.publicKey)),
    kid: KID,
    alg: 'RS256',
    use: 'sig',
  };
});

beforeEach(() => clearOAuthCachesForTest());

describe('OAuth 2.1 protected-resource verification', () => {
  it('accepts only a valid RS256 at+jwt and introspects every request', async () => {
    const fixture = await tokenFixture();
    const mock = oauthFetcher(fixture.claims, true);

    await expect(verifyAccessToken(fixture.token, config, mock.fetcher)).resolves.toMatchObject({
      sub: 'poyi-owner',
      scope: 'focuslink:read',
      token_use: 'access_token',
    });
    await verifyAccessToken(fixture.token, config, mock.fetcher);

    expect(mock.introspectionCalls()).toBe(2);
    for (const request of mock.requests.filter((item) => item.url.endsWith('/introspect'))) {
      expect(request.headers.get('authorization')).toBe(RS_AUTH);
      expect(request.body).toContain('token_type_hint=access_token');
    }
  });

  it.each([
    ['expired', { exp: Math.floor(Date.now() / 1_000) - 60 }],
    ['wrong audience', { aud: 'https://wrong.test/mcp' }],
    ['wrong resource', { resource: 'https://wrong.test/mcp' }],
    ['multiple audiences', { aud: [AUDIENCE, 'https://wrong.test/mcp'] }],
    ['wrong owner', { sub: 'someone-else' }],
    ['wrong token use', { token_use: 'refresh_token' }],
  ])('rejects %s', async (_name, override) => {
    const fixture = await tokenFixture(override as Partial<AccessTokenClaims>);
    await expect(
      verifyAccessToken(fixture.token, config, oauthFetcher(fixture.claims, true).fetcher),
    ).rejects.toThrow('invalid_token');
  });

  it('rejects TTL above 300 seconds', async () => {
    const now = Math.floor(Date.now() / 1_000);
    const fixture = await tokenFixture({ iat: now, exp: now + 301 });
    await expect(
      verifyAccessToken(fixture.token, config, oauthFetcher(fixture.claims, true).fetcher, now),
    ).rejects.toThrow('invalid_token');
  });

  it.each(['watch:read', 'foxlink:read', 'focuslink:pair', 'focuslink:read foxlink:read'])(
    'rejects wrong or legacy scope %s',
    async (scope) => {
      const fixture = await tokenFixture({ scope });
      await expect(
        verifyAccessToken(fixture.token, config, oauthFetcher(fixture.claims, true).fetcher),
      ).rejects.toThrow('insufficient_scope');
    },
  );

  it('rejects a revoked token from authenticated introspection', async () => {
    const fixture = await tokenFixture();
    await expect(
      verifyAccessToken(fixture.token, config, oauthFetcher(fixture.claims, false).fetcher),
    ).rejects.toThrow('invalid_token');
  });

  it('fails closed when introspection is unavailable or the RS credential is rejected', async () => {
    const fixture = await tokenFixture();
    const mock = oauthFetcher(fixture.claims, true, 401);
    await expect(verifyAccessToken(fixture.token, config, mock.fetcher)).rejects.toThrow(
      'oauth_dependency_unavailable',
    );
  });

  it('rejects JWT and algorithm header downgrades', async () => {
    const wrongType = await tokenFixture({}, { typ: 'JWT' });
    await expect(
      verifyAccessToken(wrongType.token, config, oauthFetcher(wrongType.claims, true).fetcher),
    ).rejects.toThrow('invalid_token');

    const wrongAlgorithm = await tokenFixture({}, { alg: 'ES256' });
    await expect(
      verifyAccessToken(
        wrongAlgorithm.token,
        config,
        oauthFetcher(wrongAlgorithm.claims, true).fetcher,
      ),
    ).rejects.toThrow('invalid_token');

    for (const header of [
      { alg: 'none' },
      { alg: 'HS256' },
      { alg: 'RS256', kid: 'unknown-key' },
      { alg: 'RS256', typ: 'at+jwt', kid: KID, jku: 'https://evil.test/jwks' },
    ]) {
      const fixture = await tokenFixture({}, header);
      await expect(
        verifyAccessToken(fixture.token, config, oauthFetcher(fixture.claims, true).fetcher),
      ).rejects.toThrow('invalid_token');
    }
  });

  it('rejects JWKS private material and duplicate kid ambiguity', async () => {
    const weakModulus = new Uint8Array(256).fill(0xff);
    weakModulus[0] = 0x7f;
    for (const keysValue of [
      [{ ...publicJwk, d: 'private-material-must-not-be-published' }],
      [publicJwk, { ...publicJwk }],
      [{ ...publicJwk, n: base64Url(weakModulus) }],
    ]) {
      clearOAuthCachesForTest();
      const fixture = await tokenFixture();
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname === '/jwks.json') return Response.json({ keys: keysValue });
        return Response.json({ active: false });
      });
      await expect(verifyAccessToken(fixture.token, config, fetcher)).rejects.toThrow(
        'oauth_dependency_unavailable',
      );
    }
  });
});

async function tokenFixture(
  override: Partial<AccessTokenClaims> = {},
  headerOverride: Record<string, unknown> = {},
): Promise<{ token: string; claims: AccessTokenClaims }> {
  const now = Math.floor(Date.now() / 1_000);
  const claims: AccessTokenClaims = {
    iss: ISSUER,
    sub: 'poyi-owner',
    aud: AUDIENCE,
    resource: AUDIENCE,
    scope: 'focuslink:read',
    iat: now,
    exp: now + 300,
    jti: `jti-${crypto.randomUUID()}`,
    client_id: 'codex-test-client',
    token_use: 'access_token',
    ...override,
  };
  const header = { alg: 'RS256', typ: 'at+jwt', kid: KID, ...headerOverride };
  const encodedHeader = encodeJson(header);
  const encodedClaims = encodeJson(claims);
  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, signed);
  return {
    claims,
    token: `${encodedHeader}.${encodedClaims}.${base64Url(new Uint8Array(signature))}`,
  };
}

function oauthFetcher(claims: AccessTokenClaims, active: boolean, introspectionStatus = 200) {
  const requests: Array<{ url: string; headers: Headers; body: string }> = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push({
      url: request.url,
      headers: new Headers(request.headers),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const url = new URL(request.url);
    if (url.pathname === '/jwks.json') return Response.json({ keys: [publicJwk] });
    if (url.pathname === '/introspect') {
      if (introspectionStatus !== 200) {
        return Response.json({ active: false }, { status: introspectionStatus });
      }
      return Response.json(
        active
          ? {
              active: true,
              token_type: 'Bearer',
              iss: claims.iss,
              sub: claims.sub,
              aud: claims.aud,
              resource: claims.resource,
              scope: claims.scope,
              client_id: claims.client_id,
              iat: claims.iat,
              exp: claims.exp,
              jti: claims.jti,
            }
          : { active: false },
      );
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  });
  return {
    fetcher,
    requests,
    introspectionCalls: () => requests.filter((item) => item.url.endsWith('/introspect')).length,
  };
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
