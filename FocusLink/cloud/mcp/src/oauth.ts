const JWKS_MAX_BYTES = 128 * 1024;
const INTROSPECTION_MAX_BYTES = 32 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const JWKS_CACHE_MS = 5 * 60 * 1_000;
const CLOCK_SKEW_SECONDS = 30;
const MAX_ACCESS_TOKEN_LIFETIME_SECONDS = 300;
const OAUTH_PROBE_SUCCESS_CACHE_MS = 15_000;
const OAUTH_PROBE_FAILURE_CACHE_MS = 3_000;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface McpOAuthEnv {
  OAUTH_ISSUER?: string;
  OAUTH_AUDIENCE?: string;
  OAUTH_JWKS_URL?: string;
  OAUTH_TOKEN_STATUS_URL?: string;
  OAUTH_RS_CLIENT_ID?: string;
  OAUTH_RS_CLIENT_SECRET?: string;
  OAUTH_HTTP?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}

export interface OAuthConfiguration {
  issuer: string;
  audience: string;
  jwksUrl: string;
  introspectionUrl: string;
  introspectionAuthorization: string;
}

export interface AccessTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  resource: string | string[];
  scope: string;
  exp: number;
  iat: number;
  nbf?: number;
  jti: string;
  client_id: string;
  token_use: 'access_token';
  [key: string]: unknown;
}

export type McpAuthentication =
  { ok: true; claims: AccessTokenClaims } | { ok: false; response: Response };

export interface ScopeRequirement {
  allOf?: string[];
  anyOf?: string[];
}

interface JwksCacheEntry {
  expiresAt: number;
  keys: JwkWithKid[];
}

interface JwkWithKid extends JsonWebKey {
  kid?: string;
  use?: string;
  alg?: string;
}

const jwksCache = new Map<string, JwksCacheEntry>();
const oauthProbeCache = new Map<string, { expiresAt: number; error: boolean }>();
const oauthProbeInFlight = new Map<string, Promise<void>>();

export function validateOAuthConfiguration(env: McpOAuthEnv): OAuthConfiguration {
  const issuer = secureUrl(env.OAUTH_ISSUER, 'oauth_issuer_invalid', false);
  const audience = secureUrl(env.OAUTH_AUDIENCE, 'oauth_audience_invalid', true);
  const jwksUrl = secureUrl(env.OAUTH_JWKS_URL, 'oauth_jwks_url_invalid', true);
  const introspectionUrl = secureUrl(
    env.OAUTH_TOKEN_STATUS_URL,
    'oauth_introspection_url_invalid',
    true,
  );
  if (
    new URL(jwksUrl).origin !== new URL(issuer).origin ||
    new URL(introspectionUrl).origin !== new URL(issuer).origin
  ) {
    throw new Error('oauth_endpoint_origin_mismatch');
  }
  const rsClientId = env.OAUTH_RS_CLIENT_ID ?? '';
  const rsClientSecret = env.OAUTH_RS_CLIENT_SECRET ?? '';
  if (
    !/^[A-Za-z0-9._~-]{3,200}$/.test(rsClientId) ||
    !/^[A-Za-z0-9._~-]{32,4096}$/.test(rsClientSecret)
  ) {
    throw new Error('oauth_introspection_auth_invalid');
  }
  return {
    issuer: issuer.replace(/\/$/, ''),
    audience,
    jwksUrl,
    introspectionUrl,
    introspectionAuthorization: `Basic ${btoa(`${rsClientId}:${rsClientSecret}`)}`,
  };
}

export async function authenticateMcpRequest(
  request: Request,
  env: McpOAuthEnv,
  metadataUrl: string,
  fetcher?: Fetcher,
  requirement: ScopeRequirement = { allOf: ['focuslink:read'] },
): Promise<McpAuthentication> {
  const oauthFetcher = fetcher ?? fetcherFor(env);
  let config: OAuthConfiguration;
  try {
    config = validateOAuthConfiguration(env);
  } catch {
    return { ok: false, response: oauthUnavailable('oauth_not_configured') };
  }
  const token = bearerToken(request);
  if (!token) return { ok: false, response: oauthChallenge(metadataUrl) };

  let claims: AccessTokenClaims;
  try {
    claims = await verifyAccessToken(token, config, oauthFetcher, undefined, requirement);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'invalid_token';
    if (code === 'oauth_dependency_unavailable') {
      return { ok: false, response: oauthUnavailable(code) };
    }
    if (code === 'insufficient_scope') {
      return {
        ok: false,
        response: oauthChallenge(
          metadataUrl,
          403,
          'insufficient_scope',
          [...(requirement.allOf ?? []), ...(requirement.anyOf ?? [])].join(' '),
        ),
      };
    }
    return { ok: false, response: oauthChallenge(metadataUrl, 401, 'invalid_token') };
  }
  return { ok: true, claims };
}

export async function probeOAuthDependencies(env: McpOAuthEnv, fetcher?: Fetcher): Promise<void> {
  const oauthFetcher = fetcher ?? fetcherFor(env);
  const config = validateOAuthConfiguration(env);
  const cacheKey = [config.issuer, config.audience, config.jwksUrl, config.introspectionUrl].join(
    '|',
  );
  const cached = oauthProbeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.error) throw new Error('oauth_dependency_unavailable');
    return;
  }
  const active = oauthProbeInFlight.get(cacheKey);
  if (active) return active;

  const probe = runOAuthDependencyProbe(config, oauthFetcher)
    .then(() => {
      oauthProbeCache.set(cacheKey, {
        expiresAt: Date.now() + OAUTH_PROBE_SUCCESS_CACHE_MS,
        error: false,
      });
    })
    .catch((error) => {
      oauthProbeCache.set(cacheKey, {
        expiresAt: Date.now() + OAUTH_PROBE_FAILURE_CACHE_MS,
        error: true,
      });
      throw error instanceof Error ? error : new Error('oauth_dependency_unavailable');
    })
    .finally(() => {
      oauthProbeInFlight.delete(cacheKey);
    });
  oauthProbeInFlight.set(cacheKey, probe);
  return probe;
}

function fetcherFor(env: McpOAuthEnv): Fetcher {
  if (!env.OAUTH_HTTP) return fetch;
  return (input, init) => env.OAUTH_HTTP!.fetch(new Request(input, init));
}

async function runOAuthDependencyProbe(
  config: OAuthConfiguration,
  fetcher: Fetcher,
): Promise<void> {
  let metadata: unknown;
  try {
    metadata = await fetchBoundedJson(
      `${config.issuer}/.well-known/oauth-authorization-server`,
      { method: 'GET', headers: { accept: 'application/json' } },
      INTROSPECTION_MAX_BYTES,
      fetcher,
    );
  } catch {
    throw new Error('oauth_metadata_unavailable');
  }
  if (
    !isRecord(metadata) ||
    metadata.issuer !== config.issuer ||
    metadata.jwks_uri !== config.jwksUrl ||
    metadata.introspection_endpoint !== config.introspectionUrl ||
    !exactStringArray(metadata.introspection_endpoint_auth_methods_supported, [
      'client_secret_basic',
    ]) ||
    !exactStringArray(metadata.code_challenge_methods_supported, ['S256'])
  )
    throw new Error('oauth_metadata_invalid');

  try {
    await loadJwks(config.jwksUrl, fetcher, true);
  } catch {
    throw new Error('oauth_jwks_unavailable');
  }
  let introspection: unknown;
  try {
    introspection = await fetchBoundedJson(
      config.introspectionUrl,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: config.introspectionAuthorization,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: 'foxlink-readiness-invalid-token',
          token_type_hint: 'access_token',
        }).toString(),
      },
      INTROSPECTION_MAX_BYTES,
      fetcher,
    );
  } catch {
    throw new Error('oauth_introspection_unavailable');
  }
  if (
    !isRecord(introspection) ||
    introspection.active !== false ||
    Object.keys(introspection).length !== 1
  )
    throw new Error('oauth_introspection_invalid');
}

export async function verifyAccessToken(
  token: string,
  config: OAuthConfiguration,
  fetcher: Fetcher = fetch,
  nowSeconds = Math.floor(Date.now() / 1_000),
  requirement: ScopeRequirement = { allOf: ['focuslink:read'] },
): Promise<AccessTokenClaims> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length < 1 || part.length > 16_384)) {
    throw new Error('invalid_token');
  }
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (!isRecord(header) || !isRecord(payload)) throw new Error('invalid_token');
  if (
    !hasOnlyKeys(header, ['alg', 'typ', 'kid']) ||
    header.alg !== 'RS256' ||
    typeof header.kid !== 'string' ||
    header.kid.length < 1 ||
    header.kid.length > 128 ||
    header.typ !== 'at+jwt'
  )
    throw new Error('invalid_token');

  const keys = await loadJwks(config.jwksUrl, fetcher);
  const jwk = keys.find(
    (candidate) =>
      candidate.kid === header.kid &&
      (!candidate.use || candidate.use === 'sig') &&
      (!candidate.alg || candidate.alg === header.alg),
  );
  if (!jwk) throw new Error('invalid_token');
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
  } catch {
    throw new Error('invalid_token');
  }
  const signature = decodeBase64Url(parts[2]);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(algorithm, key, exactBuffer(signature), exactBuffer(signed));
  } catch {
    throw new Error('invalid_token');
  }
  if (!valid) throw new Error('invalid_token');

  const claims = payload as unknown as AccessTokenClaims;
  if (
    claims.iss !== config.issuer ||
    claims.sub !== 'poyi-owner' ||
    !audienceMatches(claims.aud, config.audience) ||
    claims.resource !== config.audience ||
    !Number.isSafeInteger(claims.exp) ||
    !Number.isSafeInteger(claims.iat) ||
    claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS ||
    claims.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > MAX_ACCESS_TOKEN_LIFETIME_SECONDS ||
    (claims.nbf !== undefined &&
      (!Number.isSafeInteger(claims.nbf) || claims.nbf > nowSeconds + CLOCK_SKEW_SECONDS)) ||
    typeof claims.jti !== 'string' ||
    claims.jti.length < 8 ||
    claims.jti.length > 256 ||
    typeof claims.scope !== 'string' ||
    typeof claims.client_id !== 'string' ||
    claims.client_id.length < 1 ||
    claims.client_id.length > 256 ||
    claims.token_use !== 'access_token'
  )
    throw new Error('invalid_token');
  const scopes = new Set(claims.scope.split(/\s+/).filter(Boolean));
  const allowedScopes = new Set(['focuslink:read']);
  if (
    scopes.size === 0 ||
    [...scopes].some((scope) => !allowedScopes.has(scope)) ||
    (requirement.allOf ?? []).some((scope) => !scopes.has(scope)) ||
    ((requirement.anyOf?.length ?? 0) > 0 && !requirement.anyOf!.some((scope) => scopes.has(scope)))
  ) {
    throw new Error('insufficient_scope');
  }

  await assertTokenActive(token, claims, config, fetcher);
  return claims;
}

async function loadJwks(url: string, fetcher: Fetcher, bypassCache = false): Promise<JwkWithKid[]> {
  const cached = jwksCache.get(url);
  if (!bypassCache && cached && cached.expiresAt > Date.now()) return cached.keys;
  const value = await fetchBoundedJson(
    url,
    { method: 'GET', headers: { accept: 'application/json' } },
    JWKS_MAX_BYTES,
    fetcher,
  );
  if (
    !isRecord(value) ||
    !Array.isArray(value.keys) ||
    value.keys.length < 1 ||
    value.keys.length > 20 ||
    !value.keys.every(isRecord)
  )
    throw new Error('oauth_dependency_unavailable');
  const keys = value.keys as JwkWithKid[];
  const keyIds = new Set<string>();
  for (const key of keys) {
    if (
      key.kty !== 'RSA' ||
      key.alg !== 'RS256' ||
      key.use !== 'sig' ||
      typeof key.kid !== 'string' ||
      key.kid.length < 1 ||
      key.kid.length > 128 ||
      keyIds.has(key.kid) ||
      typeof key.n !== 'string' ||
      typeof key.e !== 'string' ||
      modulusBitLength(key.n) < 2_048 ||
      ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some((field) =>
        Object.hasOwn(key as Record<string, unknown>, field),
      ) ||
      (key.key_ops !== undefined && !key.key_ops.includes('verify'))
    )
      throw new Error('oauth_dependency_unavailable');
    keyIds.add(key.kid);
  }
  jwksCache.set(url, { keys, expiresAt: Date.now() + JWKS_CACHE_MS });
  return keys;
}

async function assertTokenActive(
  token: string,
  claims: AccessTokenClaims,
  config: OAuthConfiguration,
  fetcher: Fetcher,
): Promise<void> {
  const value = await fetchBoundedJson(
    config.introspectionUrl,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: config.introspectionAuthorization,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token, token_type_hint: 'access_token' }).toString(),
    },
    INTROSPECTION_MAX_BYTES,
    fetcher,
  );
  if (
    !isRecord(value) ||
    value.active !== true ||
    value.token_type !== 'Bearer' ||
    value.iss !== claims.iss ||
    value.sub !== claims.sub ||
    !sameJson(value.aud, claims.aud) ||
    value.resource !== claims.resource ||
    value.client_id !== claims.client_id ||
    value.iat !== claims.iat ||
    value.exp !== claims.exp ||
    value.jti !== claims.jti ||
    typeof value.scope !== 'string'
  )
    throw new Error('invalid_token');
  if (!scopeSetEqual(value.scope, claims.scope)) throw new Error('invalid_token');
}

async function fetchBoundedJson(
  url: string,
  init: RequestInit,
  maxBytes: number,
  fetcher: Fetcher,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new Error('oauth_dependency_unavailable');
  }
  if (!response.ok) throw new Error('oauth_dependency_unavailable');
  const length = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > maxBytes) {
    throw new Error('oauth_dependency_unavailable');
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    throw new Error('oauth_dependency_unavailable');
  }
  if (bytes.byteLength > maxBytes) throw new Error('oauth_dependency_unavailable');
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error('oauth_dependency_unavailable');
  }
}

export function oauthChallenge(
  metadataUrl: string,
  status = 401,
  error = 'invalid_token',
  scope?: string,
): Response {
  const errorDescription =
    error === 'insufficient_scope'
      ? 'The focuslink:read OAuth scope is required'
      : 'A valid FocusLink OAuth access token is required';
  const fields = [
    'Bearer realm="foxlink-cloud-mcp"',
    `resource_metadata="${metadataUrl}"`,
    `error="${error}"`,
    `error_description="${errorDescription}"`,
    ...(scope ? [`scope="${scope}"`] : []),
  ];
  const challenge = fields.join(', ');
  return new Response(
    JSON.stringify({
      error,
      error_description: errorDescription,
      _meta: { 'mcp/www_authenticate': [challenge] },
    }),
    {
      status,
      headers: responseHeaders({ 'www-authenticate': challenge }),
    },
  );
}

function oauthUnavailable(code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status: 503,
    headers: responseHeaders({ 'retry-after': '60' }),
  });
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9._~-]{32,32768})$/i.exec(
    request.headers.get('authorization') ?? '',
  );
  return match?.[1] ?? null;
}

function secureUrl(value: string | undefined, code: string, allowPath: boolean): string {
  if (!value) throw new Error(code);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(code);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (!allowPath && url.pathname !== '/' && url.pathname !== '')
  )
    throw new Error(code);
  return url.toString().replace(/\/$/, '');
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as unknown;
  } catch {
    throw new Error('invalid_token');
  }
}

function audienceMatches(value: unknown, expected: string): boolean {
  return (
    value === expected || (Array.isArray(value) && value.length === 1 && value[0] === expected)
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function scopeSetEqual(left: string, right: string): boolean {
  const leftSet = [...new Set(left.split(/\s+/).filter(Boolean))].sort();
  const rightSet = [...new Set(right.split(/\s+/).filter(Boolean))].sort();
  return (
    leftSet.length === rightSet.length && leftSet.every((scope, index) => scope === rightSet[index])
  );
}

function exactStringArray(value: unknown, expected: string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_token');
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding);
  } catch {
    throw new Error('invalid_token');
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function modulusBitLength(value: string): number {
  try {
    const bytes = decodeBase64Url(value);
    let first = 0;
    while (first < bytes.length && bytes[first] === 0) first += 1;
    if (first === bytes.length) return 0;
    return (bytes.length - first - 1) * 8 + (32 - Math.clz32(bytes[first]));
  } catch {
    return 0;
  }
}

function exactBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function responseHeaders(extra: Record<string, string>): Headers {
  return new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
}

export function clearOAuthCachesForTest(): void {
  jwksCache.clear();
  oauthProbeCache.clear();
  oauthProbeInFlight.clear();
}
