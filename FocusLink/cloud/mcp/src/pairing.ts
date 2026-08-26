import { BoundedBodyError, exactArrayBuffer, readBoundedBody } from './bounded-body';
import { focuslinkUpstreamUrl } from './upstream';

const MAX_PAIR_BODY_BYTES = 16 * 1024;
const MAX_PAIR_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;
const DEVICE_TOKEN_PATTERN =
  /^fl2_([A-Za-z0-9-]{6,80})_([A-Za-z0-9-]{6,80})_([A-Za-z0-9_-]{32,160})$/;
const PAIRING_CODE_PATTERN = /^\d{8}$/;
const DEVICE_ID_PATTERN = /^device-[A-Za-z0-9-]{6,194}$/;
const PAIR_AUTHORITY_TOKEN_PATTERN = /^fla_[A-Za-z0-9_-]{43,160}$/;
const DEVICE_SCOPES = new Set([
  'sync:read',
  'sync:write',
  'live:read',
  'live:write',
  'devices:manage',
]);
const MAX_INVENTORY_DEVICES = 1_000;
const MAX_INVENTORY_SCOPES = 16;
const INVENTORY_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*(?::[A-Za-z0-9][A-Za-z0-9._~-]*)+$/;
// Only device-* identifiers can be addressed by the fl2 credential contract
// and the current revoke route. Historical renderer IDs are unmanageable
// migration rows, so exclude them without allowing one legacy row to poison
// the inventory for all current paired devices.

export const FOCUSLINK_DEVICE_INVENTORY_V1_SCHEMA_VERSION = 1;

export interface FocusLinkDeviceInventoryV1 {
  schemaVersion: typeof FOCUSLINK_DEVICE_INVENTORY_V1_SCHEMA_VERSION;
  devices: Array<{
    deviceId: string;
    displayName: string;
    scopes: string[];
    expiresAt: number | null;
    revokedAt: number | null;
    lastSeenAt: number | null;
    stale: boolean;
  }>;
  serverTime: number;
  omittedLegacyDeviceCount: number;
}

export interface PairingEnv {
  FOCUSLINK_UPSTREAM?: Fetcher;
  FOCUSLINK_PAIR_AUTHORITY_TOKEN?: string;
  FOCUSLINK_PAIR_SERVICE_CREDENTIAL?: string;
  FOCUSLINK_PAIRING_ENABLED?: string;
  FOCUSLINK_DEVICE_TOKEN?: string;
  OAUTH_RS_CLIENT_SECRET?: string;
  FOCUSLINK_ALLOWED_ORIGINS?: string;
  PAIR_RATE_LIMITER?: RateLimit;
}

export async function handleCanonicalPairing(
  request: Request,
  env: PairingEnv,
  ownerAuthorized: boolean,
): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request, env);
  const originError = validateOrigin(request, env);
  if (originError) return originError;
  const url = new URL(request.url);
  if (url.search) {
    return withCors(request, env, pairError(400, 'unexpected_query'));
  }
  if (
    ['/sync/v1/pair/exchange', '/sync/v1/pair/requests', '/sync/v1/pair/claim'].includes(
      url.pathname,
    ) &&
    (request.headers.has('authorization') ||
      request.headers.has('x-focuslink-service-credential') ||
      request.headers.has('x-focuslink-pair-authority'))
  ) {
    return withCors(request, env, pairError(403, 'credential_boundary_violation'));
  }
  if (env.FOCUSLINK_PAIRING_ENABLED !== 'true') {
    return withCors(request, env, pairError(503, 'pairing_disabled_pending_e2e'));
  }
  if (!env.FOCUSLINK_UPSTREAM) return pairError(503, 'upstream_service_binding_missing');

  if (url.pathname === '/sync/v1/pair/offers' && request.method === 'POST') {
    const deviceCredential = deviceOfferCredential(request);
    if (deviceCredential && ownerAuthorized) {
      return pairError(403, 'credential_boundary_violation');
    }
    if (
      deviceCredential &&
      (request.headers.has('x-focuslink-pair-authority') ||
        request.headers.has('x-focuslink-service-credential'))
    ) {
      return pairError(403, 'credential_boundary_violation');
    }
    if (!ownerAuthorized && !deviceCredential) return pairError(403, 'pair_service_required');
    let authorityToken = '';
    if (ownerAuthorized) {
      authorityToken = env.FOCUSLINK_PAIR_AUTHORITY_TOKEN ?? '';
    }
    if (
      ownerAuthorized &&
      (!PAIR_AUTHORITY_TOKEN_PATTERN.test(authorityToken) ||
        authorityToken === env.FOCUSLINK_DEVICE_TOKEN ||
        authorityToken === env.OAUTH_RS_CLIENT_SECRET ||
        authorityToken === env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL)
    )
      return pairError(503, 'pair_authority_not_configured');
    if (!ownerAuthorized) {
      const rateLimit = await claimOfferRateLimit(request, env);
      if (rateLimit) return rateLimit;
    }
    const body = await readJsonBody(request);
    if ('response' in body) return withCors(request, env, body.response);
    if (!isPairOfferRequest(body.value)) {
      return withCors(request, env, pairError(400, 'invalid_pair_offer'));
    }
    const response = await proxyPair(
      focuslinkUpstreamUrl('/sync/v1/pair/offers'),
      env.FOCUSLINK_UPSTREAM,
      'POST',
      body.value,
      authorityToken,
      deviceCredential,
    );
    if (response.ok) {
      const value = await cloneJson(response);
      if (!isPairOfferResponse(value, !ownerAuthorized))
        return pairError(502, 'invalid_pair_offer_response');
    }
    return withCors(request, env, response);
  }

  if (url.pathname === '/sync/v1/pair/exchange' && request.method === 'POST') {
    const body = await readJsonBody(request);
    if ('response' in body) return withCors(request, env, body.response);
    if (!isPairExchangeRequest(body.value)) {
      return withCors(request, env, pairError(400, 'invalid_pair_exchange'));
    }
    const rateLimit = await claimRateLimit(
      request,
      env,
      (typeof body.value.code === 'string' ? body.value.code : body.value.nonce) as string,
    );
    if (rateLimit) return withCors(request, env, rateLimit);
    const response = await proxyPair(
      focuslinkUpstreamUrl('/sync/v1/pair/exchange'),
      env.FOCUSLINK_UPSTREAM,
      'POST',
      {
        ...(typeof body.value.code === 'string'
          ? { code: body.value.code }
          : { nonce: body.value.nonce }),
        device: body.value.device,
      },
      null,
    );
    if (response.ok) {
      const value = await cloneJson(response);
      if (!isPairExchangeResponse(value)) {
        return pairError(502, 'invalid_pair_exchange_response');
      }
    }
    return withCors(request, env, response);
  }

  if (url.pathname === '/sync/v1/pair/requests' && request.method === 'POST') {
    const rateLimit = await claimOfferRateLimit(request, env);
    if (rateLimit) return withCors(request, env, rateLimit);
    const body = await readJsonBody(request);
    if ('response' in body) return withCors(request, env, body.response);
    if (!isPairRequestRequest(body.value)) {
      return withCors(request, env, pairError(400, 'invalid_pair_request'));
    }
    const response = await proxyPair(
      focuslinkUpstreamUrl('/sync/v1/pair/requests'),
      env.FOCUSLINK_UPSTREAM,
      'POST',
      body.value,
      null,
    );
    if (response.ok && !isPairRequestResponse(await cloneJson(response))) {
      return pairError(502, 'invalid_pair_request_response');
    }
    return withCors(request, env, response);
  }

  if (url.pathname === '/sync/v1/pair/approve' && request.method === 'POST') {
    const deviceCredential = deviceOfferCredential(request);
    if (
      !deviceCredential ||
      request.headers.has('x-focuslink-service-credential') ||
      request.headers.has('x-focuslink-pair-authority')
    ) {
      return withCors(request, env, pairError(401, 'device_credential_required'));
    }
    const body = await readJsonBody(request);
    if ('response' in body) return withCors(request, env, body.response);
    if (!isPairApprovalRequest(body.value)) {
      return withCors(request, env, pairError(400, 'invalid_pair_approval'));
    }
    const response = await proxyPair(
      focuslinkUpstreamUrl('/sync/v1/pair/approve'),
      env.FOCUSLINK_UPSTREAM,
      'POST',
      body.value,
      null,
      deviceCredential,
    );
    if (response.ok && !isPairApprovalResponse(await cloneJson(response))) {
      return pairError(502, 'invalid_pair_approval_response');
    }
    return withCors(request, env, response);
  }

  if (url.pathname === '/sync/v1/pair/claim' && request.method === 'POST') {
    const body = await readJsonBody(request);
    if ('response' in body) return withCors(request, env, body.response);
    if (!isPairClaimRequest(body.value)) {
      return withCors(request, env, pairError(400, 'invalid_pair_claim'));
    }
    const rateLimit = await claimRateLimit(request, env, body.value.requestToken as string);
    if (rateLimit) return withCors(request, env, rateLimit);
    const response = await proxyPair(
      focuslinkUpstreamUrl('/sync/v1/pair/claim'),
      env.FOCUSLINK_UPSTREAM,
      'POST',
      body.value,
      null,
    );
    if (
      (response.ok || response.status === 202) &&
      !isPairClaimResponse(await cloneJson(response))
    ) {
      return pairError(502, 'invalid_pair_claim_response');
    }
    return withCors(request, env, response);
  }

  if (url.pathname === '/sync/v1/pair/devices' && request.method === 'GET') {
    if (!ownerAuthorized) return pairError(403, 'pair_service_required');
    const authorityToken = pairAuthorityToken(env);
    if (!authorityToken) return pairError(503, 'pair_authority_not_configured');
    const response = await proxyPair(
      focuslinkUpstreamUrl('/sync/v1/pair/devices'),
      env.FOCUSLINK_UPSTREAM,
      'GET',
      undefined,
      authorityToken,
    );
    if (!response.ok) return withCors(request, env, response);
    const inventory = normalizeDeviceInventory(await cloneJson(response));
    if (!inventory) return pairError(502, 'invalid_device_inventory_response');
    return withCors(request, env, pairJson(inventory));
  }

  const revoke = /^\/sync\/v1\/pair\/devices\/(device-[A-Za-z0-9-]{6,194})\/revoke$/.exec(
    url.pathname,
  );
  if (revoke && request.method === 'POST') {
    if (!ownerAuthorized) return pairError(403, 'pair_service_required');
    const authorityToken = pairAuthorityToken(env);
    if (!authorityToken) return pairError(503, 'pair_authority_not_configured');
    const response = await proxyPair(
      focuslinkUpstreamUrl(url.pathname),
      env.FOCUSLINK_UPSTREAM,
      'POST',
      undefined,
      authorityToken,
    );
    if (!response.ok) return withCors(request, env, response);
    const revocation = normalizeDeviceRevocation(await cloneJson(response), revoke[1]);
    if (!revocation) return pairError(502, 'invalid_device_revocation_response');
    return withCors(request, env, pairJson(revocation));
  }

  return withCors(request, env, pairError(405, 'method_not_allowed'));
}

async function proxyPair(
  url: URL,
  binding: Fetcher,
  method: 'GET' | 'POST',
  value: unknown | undefined,
  authorityCredential: string | null,
  deviceCredential: string | null = null,
): Promise<Response> {
  let response: Response;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (value !== undefined) headers['content-type'] = 'application/json; charset=utf-8';
    if (authorityCredential) {
      headers['x-focuslink-pair-authority'] = authorityCredential;
    }
    if (deviceCredential) headers.authorization = `Bearer ${deviceCredential}`;
    response = await binding.fetch(
      new Request(url, {
        method,
        headers,
        body: value === undefined ? undefined : JSON.stringify(value),
        redirect: 'manual',
        signal: timeout,
      }),
    );
  } catch (error) {
    if (timeout.aborted || isTimeoutError(error)) {
      return pairError(504, 'authoritative_upstream_timeout');
    }
    return pairError(502, 'authoritative_upstream_unreachable');
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return pairError(502, 'authoritative_redirect_rejected');
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(response.body, response.headers, MAX_PAIR_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof BoundedBodyError && error.reason === 'too_large') {
      return pairError(502, 'pair_response_too_large');
    }
    return pairError(502, 'pair_response_unreadable');
  }
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return pairError(502, 'pair_response_not_json');
  }
  return new Response(exactArrayBuffer(bytes), {
    status: response.status,
    headers: pairHeaders({
      'x-focuslink-authority': 'durable-object-v2',
      'x-focuslink-adapter': 'sync-v1-pairing-to-v2',
    }),
  });
}

function pairAuthorityToken(env: PairingEnv): string | null {
  const value = env.FOCUSLINK_PAIR_AUTHORITY_TOKEN ?? '';
  return PAIR_AUTHORITY_TOKEN_PATTERN.test(value) &&
    value !== env.FOCUSLINK_DEVICE_TOKEN &&
    value !== env.OAUTH_RS_CLIENT_SECRET &&
    value !== env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL
    ? value
    : null;
}

function deviceOfferCredential(request: Request): string | null {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer (fl2_[A-Za-z0-9-]{6,80}_[A-Za-z0-9-]{6,80}_[A-Za-z0-9_-]{32,160})$/.exec(
    authorization,
  );
  return match?.[1] ?? null;
}

async function claimOfferRateLimit(request: Request, env: PairingEnv): Promise<Response | null> {
  if (!env.PAIR_RATE_LIMITER) return pairError(503, 'pair_rate_limiter_not_configured');
  const clientKey = request.headers.get('cf-connecting-ip') ?? 'unknown-client';
  try {
    const result = await env.PAIR_RATE_LIMITER.limit({ key: `offer-device:${clientKey}` });
    if (result.success) return null;
    const response = pairError(429, 'pair_rate_limited');
    response.headers.set('retry-after', '60');
    return response;
  } catch {
    return pairError(503, 'pair_rate_limiter_unavailable');
  }
}

async function readJsonBody(
  request: Request,
): Promise<{ value: unknown } | { response: Response }> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return { response: pairError(415, 'content_type_must_be_json') };
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(request.body, request.headers, MAX_PAIR_BODY_BYTES);
  } catch (error) {
    if (error instanceof BoundedBodyError && error.reason === 'too_large') {
      return { response: pairError(413, 'pair_body_too_large') };
    }
    return { response: pairError(400, 'pair_body_unreadable') };
  }
  try {
    return {
      value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown,
    };
  } catch {
    return { response: pairError(400, 'invalid_json') };
  }
}

function isPairOfferRequest(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['displayName', 'scopes'])) return false;
  if (
    typeof value.displayName !== 'string' ||
    value.displayName.trim().length < 1 ||
    value.displayName.trim().length > 100 ||
    !Array.isArray(value.scopes) ||
    value.scopes.length < 1 ||
    value.scopes.length > DEVICE_SCOPES.size ||
    !value.scopes.every(
      (scope): scope is string => typeof scope === 'string' && DEVICE_SCOPES.has(scope),
    )
  )
    return false;
  const scopes = new Set(value.scopes);
  return scopes.size === value.scopes.length && scopes.has('sync:read');
}

function isPairOfferResponse(value: unknown, numeric: boolean): boolean {
  if (!isRecord(value) || !validPairTiming(value.expiresAt)) return false;
  return numeric
    ? hasOnlyKeys(value, ['code', 'expiresAt']) &&
        typeof value.code === 'string' &&
        PAIRING_CODE_PATTERN.test(value.code)
    : hasOnlyKeys(value, ['nonce', 'expiresAt', 'devicePublicId']) &&
        typeof value.nonce === 'string' &&
        /^[A-Za-z0-9_-]{32,160}$/.test(value.nonce) &&
        typeof value.devicePublicId === 'string' &&
        /^[A-Za-z0-9-]{6,80}$/.test(value.devicePublicId);
}

function isPairExchangeRequest(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const numeric =
    hasOnlyKeys(value, ['code', 'device']) &&
    typeof value.code === 'string' &&
    PAIRING_CODE_PATTERN.test(value.code);
  const legacy =
    hasOnlyKeys(value, ['nonce', 'device']) &&
    typeof value.nonce === 'string' &&
    /^[A-Za-z0-9_-]{32,160}$/.test(value.nonce);
  return (numeric || legacy) && isDeviceMetadata(value.device, numeric);
}

function isPairRequestRequest(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['device']) &&
    'device' in value &&
    isDeviceMetadata(value.device, true)
  );
}

function isPairApprovalRequest(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['code']) &&
    typeof value.code === 'string' &&
    PAIRING_CODE_PATTERN.test(value.code)
  );
}

function isPairClaimRequest(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['requestToken', 'device']) &&
    typeof value.requestToken === 'string' &&
    /^flpr_[A-Za-z0-9_-]{43,160}$/.test(value.requestToken) &&
    isDeviceMetadata(value.device, true)
  );
}

function isPairRequestResponse(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['code', 'requestToken', 'expiresAt']) &&
    typeof value.code === 'string' &&
    PAIRING_CODE_PATTERN.test(value.code) &&
    typeof value.requestToken === 'string' &&
    /^flpr_[A-Za-z0-9_-]{43,160}$/.test(value.requestToken) &&
    validPairTiming(value.expiresAt)
  );
}

function isPairApprovalResponse(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['status', 'displayName', 'expiresAt']) &&
    value.status === 'approved' &&
    typeof value.displayName === 'string' &&
    value.displayName.trim().length >= 1 &&
    value.displayName.trim().length <= 100 &&
    validPairTiming(value.expiresAt)
  );
}

function isPairClaimResponse(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.status === 'pending') {
    return (
      hasOnlyKeys(value, ['status', 'expiresAt', 'retryAfterMs']) &&
      validPairTiming(value.expiresAt) &&
      Number.isSafeInteger(value.retryAfterMs) &&
      Number(value.retryAfterMs) >= 500 &&
      Number(value.retryAfterMs) <= 10_000
    );
  }
  if (
    value.status !== 'authenticated' ||
    !hasOnlyKeys(value, ['status', 'deviceId', 'accessToken', 'scopes', 'expiresAt'])
  )
    return false;
  return isPairExchangeResponse({
    deviceId: value.deviceId,
    accessToken: value.accessToken,
    scopes: value.scopes,
    expiresAt: value.expiresAt,
  });
}

function isDeviceMetadata(value: unknown, numeric: boolean): boolean {
  if (!isRecord(value)) return false;
  if (numeric) {
    return (
      hasOnlyKeys(value, [
        'installationId',
        'displayName',
        'platform',
        'deviceKind',
        'appVersion',
      ]) &&
      typeof value.installationId === 'string' &&
      /^[A-Za-z0-9._~-]{20,160}$/.test(value.installationId) &&
      typeof value.displayName === 'string' &&
      value.displayName.trim().length >= 1 &&
      value.displayName.trim().length <= 100 &&
      ['windows', 'android', 'web'].includes(String(value.platform)) &&
      ['desktop', 'phone', 'tablet', 'watch'].includes(String(value.deviceKind)) &&
      typeof value.appVersion === 'string' &&
      /^[0-9A-Za-z.+-]{1,32}$/.test(value.appVersion)
    );
  }
  return (
    hasOnlyKeys(value, ['platform', 'appVersion', 'displayName']) &&
    ['windows', 'macos', 'linux', 'android', 'ios', 'web'].includes(String(value.platform)) &&
    typeof value.appVersion === 'string' &&
    value.appVersion.length >= 1 &&
    value.appVersion.length <= 50 &&
    (value.displayName === undefined ||
      (typeof value.displayName === 'string' &&
        value.displayName.trim().length >= 1 &&
        value.displayName.trim().length <= 100))
  );
}

async function claimRateLimit(
  request: Request,
  env: PairingEnv,
  nonce: string,
): Promise<Response | null> {
  if (!env.PAIR_RATE_LIMITER) return pairError(503, 'pair_rate_limiter_not_configured');
  const clientKey = request.headers.get('cf-connecting-ip') ?? 'unknown-client';
  try {
    const credentialHash = await sha256Base64Url(`focuslink-pair-rate-v1\0${nonce}`);
    const [client, nonceResult] = await Promise.all([
      env.PAIR_RATE_LIMITER.limit({ key: `client:${clientKey}` }),
      env.PAIR_RATE_LIMITER.limit({ key: `credential:${credentialHash}` }),
    ]);
    if (client.success && nonceResult.success) return null;
    const response = pairError(429, 'pair_rate_limited');
    response.headers.set('retry-after', '60');
    return response;
  } catch {
    return pairError(503, 'pair_rate_limiter_unavailable');
  }
}

function validPairTiming(value: unknown): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) > Date.now() &&
    Number(value) <= Date.now() + 15 * 60 * 1_000
  );
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function isPairExchangeResponse(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['deviceId', 'accessToken', 'scopes', 'expiresAt']) ||
    typeof value.deviceId !== 'string' ||
    typeof value.accessToken !== 'string' ||
    !Array.isArray(value.scopes) ||
    !value.scopes.includes('sync:read') ||
    value.scopes.length > DEVICE_SCOPES.size ||
    !value.scopes.every(
      (scope): scope is string => typeof scope === 'string' && DEVICE_SCOPES.has(scope),
    ) ||
    new Set(value.scopes).size !== value.scopes.length ||
    !Number.isSafeInteger(value.expiresAt) ||
    Number(value.expiresAt) <= Date.now()
  )
    return false;
  const token = DEVICE_TOKEN_PATTERN.exec(value.accessToken);
  return Boolean(token && value.deviceId === `device-${token[2]}`);
}

function normalizeDeviceInventory(value: unknown): FocusLinkDeviceInventoryV1 | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.devices) ||
    value.devices.length > MAX_INVENTORY_DEVICES
  )
    return null;
  const serverTime = normalizeTimestamp(value.serverTime);
  if (serverTime === null || serverTime === undefined) return null;

  const devices: FocusLinkDeviceInventoryV1['devices'] = [];
  const deviceIds = new Set<string>();
  let omittedLegacyDeviceCount = 0;
  for (const candidate of value.devices) {
    if (!isRecord(candidate)) return null;
    const deviceId = candidate.deviceId;
    if (typeof deviceId === 'string' && !DEVICE_ID_PATTERN.test(deviceId)) {
      omittedLegacyDeviceCount += 1;
      continue;
    }
    const displayName = normalizeDisplayName(candidate.displayName);
    const scopes = normalizeDeviceScopes(candidate.scopes);
    const expiresAt = normalizeTimestamp(candidate.expiresAt);
    const revokedAt = normalizeTimestamp(candidate.revokedAt);
    const lastSeenAt = normalizeTimestamp(candidate.lastSeenAt);
    if (
      typeof deviceId !== 'string' ||
      !DEVICE_ID_PATTERN.test(deviceId) ||
      deviceIds.has(deviceId) ||
      displayName === null ||
      scopes === null ||
      expiresAt === undefined ||
      revokedAt === undefined ||
      lastSeenAt === undefined ||
      typeof candidate.stale !== 'boolean'
    )
      return null;

    deviceIds.add(deviceId);
    devices.push({
      deviceId,
      displayName,
      scopes,
      expiresAt,
      revokedAt,
      lastSeenAt,
      stale: candidate.stale,
    });
  }
  return {
    schemaVersion: FOCUSLINK_DEVICE_INVENTORY_V1_SCHEMA_VERSION,
    devices,
    serverTime,
    omittedLegacyDeviceCount,
  };
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length >= 1 &&
    normalized.length <= 100 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(normalized)
    ? normalized
    : null;
}

function normalizeDeviceScopes(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_INVENTORY_SCOPES ||
    !value.every(
      (scope): scope is string =>
        typeof scope === 'string' && scope.length <= 64 && INVENTORY_SCOPE_PATTERN.test(scope),
    ) ||
    new Set(value).size !== value.length ||
    !value.includes('sync:read')
  )
    return null;
  return [...value];
}

function normalizeTimestamp(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIMESTAMP_MS
      ? value
      : undefined;
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,15})$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_TIMESTAMP_MS ? parsed : undefined;
}

function normalizeDeviceRevocation(
  value: unknown,
  deviceId: string,
): { deviceId: string; revokedAt: number } | null {
  return isRecord(value) && value.deviceId === deviceId && Number.isSafeInteger(value.revokedAt)
    ? { deviceId, revokedAt: value.revokedAt as number }
    : null;
}

async function cloneJson(response: Response): Promise<unknown> {
  try {
    return (await response.clone().json()) as unknown;
  } catch {
    return null;
  }
}

function allowedOrigins(env: PairingEnv): Set<string> {
  return new Set(
    (env.FOCUSLINK_ALLOWED_ORIGINS ?? 'https://localhost,capacitor://localhost,http://localhost')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function validateOrigin(request: Request, env: PairingEnv): Response | null {
  const origin = request.headers.get('origin');
  return !origin || allowedOrigins(env).has(origin) ? null : pairError(403, 'cors_origin_denied');
}

function preflight(request: Request, env: PairingEnv): Response {
  const error = validateOrigin(request, env);
  if (error) return error;
  const response = new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
      'cache-control': 'no-store',
      vary: 'Origin',
    },
  });
  const origin = request.headers.get('origin');
  if (origin) response.headers.set('access-control-allow-origin', origin);
  return response;
}

function withCors(request: Request, env: PairingEnv, response: Response): Response {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(env).has(origin)) return response;
  const next = new Response(response.body, response);
  next.headers.set('access-control-allow-origin', origin);
  next.headers.append('vary', 'Origin');
  return next;
}

function pairError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: pairHeaders(),
  });
}

function pairJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: pairHeaders(),
  });
}

function pairHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
