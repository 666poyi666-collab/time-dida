/**
 * Owner-approved device bootstrap.
 *
 * FocusLink phone/tablet/watch clients POST an anonymous "start" registration
 * to the public /account/v1/device/bootstrap endpoint. This module stores the
 * intent in D1, returns the owner login URL (hosted by the identity gateway),
 * and keeps serving "pending" until the owner approves the flow. On approval
 * the next poll forwards the registration to the private authority's
 * /sync/v1/devices/register endpoint (with the fia_* identity authority) and
 * returns the exact authenticated envelope the client's strict parser accepts.
 *
 * Admin list/approve/deny endpoints are reachable only from the identity
 * gateway over the FocusLinkService fls_* service-credential hop.
 */
import { BoundedBodyError, exactArrayBuffer, readBoundedBody } from './bounded-body';
import { focuslinkUpstreamUrl } from './upstream';

const MAX_BOOTSTRAP_BODY_BYTES = 16 * 1024;
const MAX_BOOTSTRAP_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;

/** Mirrors shared/sync/accountBootstrapProtocol.ts on the FocusLink side. */
export const FOCUSLINK_CANONICAL_SYNC_ORIGIN =
  'https://foxlink-mcp.focuslink-poyi-6465e9.workers.dev' as const;
/** Mirrors shared/sync/accountBootstrapProtocol.ts FOCUSLINK_CANONICAL_IDENTITY_ORIGIN. */
export const FOCUSLINK_CANONICAL_IDENTITY_ORIGIN =
  'https://poyi-oauth-as.focuslink-poyi-6465e9.workers.dev' as const;

const FLOW_ID_PATTERN = /^flow_[A-Za-z0-9_-]{32,160}$/;
const POLL_TOKEN_PATTERN = /^flb_[A-Za-z0-9_-]{43,160}$/;
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9._~-]{20,160}$/;
const APP_VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,32}$/;
const DEVICE_PLATFORMS = new Set(['windows', 'android', 'web']);
const DEVICE_KINDS = new Set(['desktop', 'phone', 'tablet', 'watch']);
const FLOW_LIFETIME_MS = 10 * 60_000;
const RETRY_AFTER_MS = 5_000;
const MAX_PENDING_FLOWS_PER_DEVICE_KIND = 10;

export interface BootstrapEnv {
  DB: D1Database;
  FOCUSLINK_UPSTREAM: Fetcher;
  FOCUSLINK_IDENTITY_AUTHORITY_TOKEN?: string;
  FOCUSLINK_OWNER_SUBJECT?: string;
  FOCUSLINK_OWNER_LABEL?: string;
  FOCUSLINK_BOOTSTRAP_PEPPER?: string;
  FOCUSLINK_BOOTSTRAP_ENABLED?: string;
  FOCUSLINK_ALLOWED_ORIGINS?: string;
  PAIR_RATE_LIMITER?: RateLimit;
}

export interface BootstrapFlowRow {
  flow_id: string;
  registration_json: string;
  poll_token_hmac: string;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';
  expires_at: number;
  created_at: number;
  consumed_at: number | null;
  device_json: string | null;
}

export interface PendingBootstrapFlowView {
  flowId: string;
  createdAt: number;
  displayName: string;
  platform: string;
  deviceKind: string;
  appVersion: string | null;
}

export interface BootstrapConfiguration {
  enabled: boolean;
  upstream: boolean;
  identityAuthority: boolean;
  ownerSubject: boolean;
  pepper: boolean;
}

export function validateBootstrapConfiguration(env: BootstrapEnv): BootstrapConfiguration {
  const identityAuthority =
    typeof env.FOCUSLINK_IDENTITY_AUTHORITY_TOKEN === 'string' &&
    /^fia_[A-Za-z0-9_-]{43,160}$/.test(env.FOCUSLINK_IDENTITY_AUTHORITY_TOKEN);
  const ownerSubject =
    typeof env.FOCUSLINK_OWNER_SUBJECT === 'string' &&
    /^[A-Za-z0-9._~-]{3,128}$/.test(env.FOCUSLINK_OWNER_SUBJECT);
  return {
    enabled: env.FOCUSLINK_BOOTSTRAP_ENABLED === 'true',
    upstream: Boolean(env.FOCUSLINK_UPSTREAM),
    identityAuthority,
    ownerSubject,
    pepper:
      typeof env.FOCUSLINK_BOOTSTRAP_PEPPER === 'string' &&
      env.FOCUSLINK_BOOTSTRAP_PEPPER.length >= 32,
  };
}
/**
 * Public anonymous endpoint: POST /account/v1/device/bootstrap.
 * Returns the protocol-shaped response the client's strict parser accepts.
 */
export async function handleBootstrap(request: Request, env: BootstrapEnv): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request, env);
  const originError = validateOrigin(request, env);
  if (originError) return originError;
  const url = new URL(request.url);
  if (url.pathname !== '/account/v1/device/bootstrap') {
    return withCors(request, env, bootstrapError(404, 'route_not_found'));
  }
  if (url.search) {
    return withCors(request, env, bootstrapError(400, 'unexpected_query'));
  }
  if (
    request.headers.has('authorization') ||
    request.headers.has('x-focuslink-service-credential') ||
    request.headers.has('x-focuslink-identity-authority')
  ) {
    return withCors(request, env, bootstrapError(403, 'credential_boundary_violation'));
  }
  if (!validateBootstrapConfiguration(env).enabled) {
    return withCors(request, env, bootstrapError(503, 'bootstrap_disabled_pending_e2e'));
  }
  const config = validateBootstrapConfiguration(env);
  if (!config.upstream || !config.identityAuthority || !config.ownerSubject) {
    return withCors(request, env, bootstrapError(503, 'bootstrap_not_configured'));
  }
  if (!env.DB) {
    return withCors(request, env, bootstrapError(503, 'bootstrap_store_missing'));
  }

  const body = await readBootstrapJsonBody(request);
  if ('response' in body) return withCors(request, env, body.response);
  if (!isRecord(body.value) || body.value.protocolVersion !== 1) {
    return withCors(request, env, bootstrapError(400, 'invalid_bootstrap'));
  }

  if (body.value.action === 'start') {
    const limited = await rateLimit(request, env, 'start');
    if (limited) return withCors(request, env, limited);
    return withCors(request, env, await handleStart(env, body.value));
  }
  if (body.value.action === 'poll') {
    const limited = await rateLimit(request, env, 'poll');
    if (limited) return withCors(request, env, limited);
    return withCors(request, env, await handlePoll(request, env, body.value));
  }
  return withCors(request, env, bootstrapError(400, 'invalid_bootstrap'));
}

async function handleStart(env: BootstrapEnv, value: Record<string, unknown>): Promise<Response> {
  if (!hasOnlyKeys(value, ['protocolVersion', 'action', 'registration'])) {
    return bootstrapError(400, 'invalid_bootstrap_start');
  }
  const registration = parseDeviceRegistration(value.registration);
  if (!registration) {
    return bootstrapError(400, 'invalid_device_registration');
  }
  const now = Date.now();
  const db = env.DB!;
  const pendingCount = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM bootstrap_flows
       WHERE status IN ('pending', 'approved')
         AND created_at > ? AND registration_json LIKE ?`,
    )
    .bind(now - 60 * 60 * 1_000, `%"deviceKind":"${registration.deviceKind}"%`)
    .first<{ count: number }>();
  if (pendingCount && pendingCount.count >= MAX_PENDING_FLOWS_PER_DEVICE_KIND) {
    return bootstrapError(429, 'bootstrap_flow_limit');
  }

  const flowId = `flow_${randomToken(40)}`;
  const pollToken = `flb_${randomToken(48)}`;
  const pollTokenHmac = await hmacHex(
    env.FOCUSLINK_BOOTSTRAP_PEPPER ?? '',
    `focuslink-bootstrap-poll-v1:${flowId}:${pollToken}`,
  );
  const registrationJson = JSON.stringify(registration);
  await db
    .prepare(
      `INSERT INTO bootstrap_flows (
         flow_id, registration_json, poll_token_hmac, status,
         expires_at, created_at, consumed_at, device_json
       ) VALUES (?, ?, ?, 'pending', ?, ?, NULL, NULL)`,
    )
    .bind(flowId, registrationJson, pollTokenHmac, now + FLOW_LIFETIME_MS, now)
    .run();

  // Send a new device to the one-time-code form first. The registrations page
  // requires an owner session and must only be reached after that login step.
  const loginUrl = `${FOCUSLINK_CANONICAL_IDENTITY_ORIGIN}/owner/sign-in?bootstrap_flow=${encodeURIComponent(flowId)}`;
  return bootstrapJson({
    protocolVersion: 1,
    status: 'login-required',
    flowId,
    pollToken,
    loginUrl,
    retryAfterMs: RETRY_AFTER_MS,
    expiresAt: now + FLOW_LIFETIME_MS,
    serverTime: now,
  });
}

async function handlePoll(
  request: Request,
  env: BootstrapEnv,
  value: Record<string, unknown>,
): Promise<Response> {
  if (!hasOnlyKeys(value, ['protocolVersion', 'action', 'flowId', 'pollToken'])) {
    return bootstrapError(400, 'invalid_bootstrap_poll');
  }
  const flowId = value.flowId;
  const pollToken = value.pollToken;
  if (
    typeof flowId !== 'string' ||
    !FLOW_ID_PATTERN.test(flowId) ||
    typeof pollToken !== 'string' ||
    !POLL_TOKEN_PATTERN.test(pollToken)
  ) {
    return bootstrapError(400, 'invalid_bootstrap_poll');
  }
  const db = env.DB!;
  const row = await db
    .prepare(
      `SELECT flow_id, registration_json, poll_token_hmac, status,
              expires_at, created_at, consumed_at, device_json
       FROM bootstrap_flows WHERE flow_id = ?`,
    )
    .bind(flowId)
    .first<BootstrapFlowRow>();
  if (!row) return bootstrapError(404, 'bootstrap_flow_not_found');

  const expectedHmac = await hmacHex(
    env.FOCUSLINK_BOOTSTRAP_PEPPER ?? '',
    `focuslink-bootstrap-poll-v1:${row.flow_id}:${pollToken}`,
  );
  if (!constantTimeEqual(expectedHmac, row.poll_token_hmac)) {
    return bootstrapError(403, 'bootstrap_poll_token_rejected');
  }

  const now = Date.now();
  if (now >= row.expires_at) {
    await db
      .prepare(`UPDATE bootstrap_flows SET status = 'expired' WHERE flow_id = ?`)
      .bind(flowId)
      .run();
    return bootstrapError(410, 'bootstrap_flow_expired');
  }
  if (row.status === 'denied') {
    return bootstrapError(403, 'bootstrap_flow_denied');
  }
  if (row.status === 'consumed') {
    return bootstrapError(410, 'bootstrap_flow_consumed');
  }
  if (row.status === 'pending') {
    return bootstrapJson({
      protocolVersion: 1,
      status: 'pending',
      flowId,
      retryAfterMs: RETRY_AFTER_MS,
      expiresAt: row.expires_at,
      serverTime: now,
    });
  }
  if (row.status !== 'approved') {
    return bootstrapError(409, 'bootstrap_flow_not_approved');
  }

  // Approved: forward registration to the private authority and mint the
  // device credential. The flow is consumed atomically afterwards so a
  // repeated poll can never mint twice.
  const registration = JSON.parse(row.registration_json) as Record<string, unknown>;
  const response = await registerDeviceUpstream(
    env.FOCUSLINK_UPSTREAM!,
    env.FOCUSLINK_IDENTITY_AUTHORITY_TOKEN!,
    env.FOCUSLINK_OWNER_SUBJECT!,
    registration,
  );
  if (response.status !== 200) return response;

  const device = await cloneJson(response);
  if (!isDeviceRegistrationResponse(device)) {
    return bootstrapError(502, 'invalid_device_registration_response');
  }
  await db
    .prepare(
      `UPDATE bootstrap_flows
       SET status = 'consumed', consumed_at = ?, device_json = ?
       WHERE flow_id = ? AND status = 'approved'`,
    )
    .bind(now, JSON.stringify(device), flowId)
    .run();
  return bootstrapJson({
    protocolVersion: 1,
    status: 'authenticated',
    endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
    accountLabel: (env.FOCUSLINK_OWNER_LABEL ?? 'Poyi').slice(0, 100),
    device,
  });
}

/**
 * Identity-gateway admin surface (service-to-service). The gateway calls these
 * after verifying the owner session; this worker re-verifies the fls_* hop.
 */
export async function handleBootstrapAdmin(
  request: Request,
  env: BootstrapEnv,
  action?:
    | 'focuslink.bootstrap.flows.read'
    | 'focuslink.bootstrap.flow.approve'
    | 'focuslink.bootstrap.flow.deny',
): Promise<Response> {
  if (!env.DB) return bootstrapError(503, 'bootstrap_store_missing');
  const url = new URL(request.url);
  if (url.search) return bootstrapError(400, 'unexpected_query');
  const db = env.DB;

  if (action === undefined) {
    if (url.pathname === '/sync/v1/bootstrap/flows') {
      action = 'focuslink.bootstrap.flows.read';
    } else if (url.pathname.endsWith('/approve')) {
      action = 'focuslink.bootstrap.flow.approve';
    } else if (url.pathname.endsWith('/deny')) {
      action = 'focuslink.bootstrap.flow.deny';
    }
  }

  if (action === 'focuslink.bootstrap.flows.read') {
    if (request.method !== 'GET') return bootstrapError(405, 'method_not_allowed');
    const rows = await db
      .prepare(
        `SELECT flow_id, created_at, expires_at, registration_json, status
         FROM bootstrap_flows
         WHERE status IN ('pending', 'approved')
         ORDER BY created_at ASC LIMIT 100`,
      )
      .all<BootstrapFlowRow>();
    const now = Date.now();
    const flows: PendingBootstrapFlowView[] = [];
    for (const row of rows.results ?? []) {
      if (now >= row.expires_at) {
        await db
          .prepare(`UPDATE bootstrap_flows SET status = 'expired' WHERE flow_id = ?`)
          .bind(row.flow_id)
          .run();
        continue;
      }
      const registration = safeJsonRecord(row.registration_json);
      if (!registration) continue;
      flows.push({
        flowId: row.flow_id,
        createdAt: row.created_at,
        displayName: stringField(registration.displayName, 100),
        platform: stringField(registration.platform, 20),
        deviceKind: stringField(registration.deviceKind, 20),
        appVersion: stringFieldOrNull(registration.appVersion, 32),
      });
    }
    return bootstrapJson({ flows, serverTime: now });
  }

  const match = /^\/sync\/v1\/bootstrap\/flows\/(flow_[A-Za-z0-9_-]{32,160})\/(approve|deny)$/.exec(
    url.pathname,
  );
  if (!match) return bootstrapError(404, 'bootstrap_route_not_found');
  const [, flowId, decision] = match;
  const targetStatus = decision === 'approve' ? 'approved' : 'denied';
  if (request.method !== 'POST') return bootstrapError(405, 'method_not_allowed');
  // The flow id is carried in the path. A JSON body is optional; when present
  // it must not contradict the path (defense against ambiguous admin clients).
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  if (contentType) {
    if (!contentType.startsWith('application/json')) {
      return bootstrapError(415, 'content_type_must_be_json');
    }
    const body = await readBootstrapJsonBody(request);
    if ('response' in body) return body.response;
    if (body.value !== null && body.value !== undefined) {
      if (
        !isRecord(body.value) ||
        !hasOnlyKeys(body.value, ['flowId']) ||
        body.value.flowId !== flowId
      ) {
        return bootstrapError(400, 'invalid_bootstrap_decision');
      }
    }
  } else if (Number(request.headers.get('content-length') ?? '0') > 0) {
    return bootstrapError(400, 'invalid_bootstrap_decision');
  }
  const row = await db
    .prepare(`SELECT flow_id, status, expires_at FROM bootstrap_flows WHERE flow_id = ?`)
    .bind(flowId)
    .first<BootstrapFlowRow>();
  if (!row) return bootstrapError(404, 'bootstrap_flow_not_found');
  if (row.status === 'consumed' || row.status === 'denied') {
    return bootstrapError(409, 'bootstrap_flow_already_settled');
  }
  if (Date.now() >= row.expires_at) {
    await db
      .prepare(`UPDATE bootstrap_flows SET status = 'expired' WHERE flow_id = ?`)
      .bind(flowId)
      .run();
    return bootstrapError(410, 'bootstrap_flow_expired');
  }
  await db
    .prepare(`UPDATE bootstrap_flows SET status = ? WHERE flow_id = ?`)
    .bind(targetStatus, flowId)
    .run();
  return bootstrapJson({ flowId, status: targetStatus });
}

async function registerDeviceUpstream(
  binding: Fetcher,
  identityAuthority: string,
  ownerSubject: string,
  registration: Record<string, unknown>,
): Promise<Response> {
  const url = focuslinkUpstreamUrl('/sync/v1/devices/register');
  let response: Response;
  try {
    response = await binding.fetch(
      new Request(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json; charset=utf-8',
          'x-focuslink-identity-authority': identityAuthority,
          'x-focuslink-owner-subject': ownerSubject,
        },
        body: JSON.stringify(registration),
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      return bootstrapError(504, 'authoritative_upstream_timeout');
    }
    return bootstrapError(502, 'authoritative_upstream_unreachable');
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return bootstrapError(502, 'authoritative_redirect_rejected');
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(response.body, response.headers, MAX_BOOTSTRAP_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof BoundedBodyError && error.reason === 'too_large') {
      return bootstrapError(502, 'bootstrap_response_too_large');
    }
    return bootstrapError(502, 'bootstrap_response_unreadable');
  }
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return bootstrapError(502, 'bootstrap_response_not_json');
  }
  if (response.status === 401 || response.status === 403) {
    return new Response(exactArrayBuffer(bytes), {
      status: response.status,
      headers: bootstrapHeaders({
        'x-focuslink-authority': 'durable-object-v2',
        'x-focuslink-adapter': 'owner-device-registration',
      }),
    });
  }
  if (response.status >= 400) {
    return new Response(exactArrayBuffer(bytes), {
      status: response.status,
      headers: bootstrapHeaders({
        'x-focuslink-authority': 'durable-object-v2',
        'x-focuslink-adapter': 'owner-device-registration',
      }),
    });
  }
  return new Response(exactArrayBuffer(bytes), {
    status: response.status,
    headers: bootstrapHeaders({
      'x-focuslink-authority': 'durable-object-v2',
      'x-focuslink-adapter': 'owner-device-registration',
    }),
  });
}

function parseDeviceRegistration(value: unknown): Record<string, unknown> | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'protocolVersion',
      'installationId',
      'displayName',
      'platform',
      'deviceKind',
      'appVersion',
    ])
  ) {
    return null;
  }
  const installationId = value.installationId;
  const displayName = typeof value.displayName === 'string' ? value.displayName.trim() : '';
  if (
    value.protocolVersion !== 1 ||
    typeof installationId !== 'string' ||
    !INSTALLATION_ID_PATTERN.test(installationId) ||
    displayName.length < 1 ||
    displayName.length > 100 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(displayName) ||
    typeof value.platform !== 'string' ||
    !DEVICE_PLATFORMS.has(value.platform) ||
    typeof value.deviceKind !== 'string' ||
    !DEVICE_KINDS.has(value.deviceKind) ||
    (value.appVersion !== undefined &&
      (typeof value.appVersion !== 'string' || !APP_VERSION_PATTERN.test(value.appVersion)))
  ) {
    return null;
  }
  return {
    protocolVersion: 1,
    installationId,
    displayName,
    platform: value.platform,
    deviceKind: value.deviceKind,
    ...(value.appVersion !== undefined ? { appVersion: value.appVersion } : {}),
  };
}

function isDeviceRegistrationResponse(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'protocolVersion',
      'accountPublicId',
      'deviceId',
      'accessToken',
      'tokenType',
      'scopes',
      'expiresAt',
      'serverTime',
    ]) ||
    value.protocolVersion !== 1 ||
    typeof value.accountPublicId !== 'string' ||
    !/^[A-Za-z0-9-]{6,80}$/.test(value.accountPublicId) ||
    typeof value.deviceId !== 'string' ||
    !/^device-[A-Za-z0-9-]{6,194}$/.test(value.deviceId) ||
    typeof value.accessToken !== 'string' ||
    !/^fl2_[A-Za-z0-9-]{6,80}_[A-Za-z0-9-]{6,80}_[A-Za-z0-9_-]{32,160}$/.test(value.accessToken) ||
    value.tokenType !== 'Bearer' ||
    !Number.isSafeInteger(value.expiresAt) ||
    !Number.isSafeInteger(value.serverTime) ||
    Number(value.expiresAt) <= Number(value.serverTime)
  ) {
    return false;
  }
  const scopes = value.scopes;
  if (
    !Array.isArray(scopes) ||
    scopes.length !== 4 ||
    !['sync:read', 'sync:write', 'live:read', 'live:write'].every((scope) => scopes.includes(scope))
  ) {
    return false;
  }
  const match = /^fl2_([A-Za-z0-9-]{6,80})_([A-Za-z0-9-]{6,80})_/.exec(value.accessToken);
  return Boolean(
    match && match[1] === value.accountPublicId && value.deviceId === `device-${match[2]}`,
  );
}

async function readBootstrapJsonBody(
  request: Request,
): Promise<{ value: unknown } | { response: Response }> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return { response: bootstrapError(415, 'content_type_must_be_json') };
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(request.body, request.headers, MAX_BOOTSTRAP_BODY_BYTES);
  } catch (error) {
    if (error instanceof BoundedBodyError && error.reason === 'too_large') {
      return { response: bootstrapError(413, 'bootstrap_body_too_large') };
    }
    return { response: bootstrapError(400, 'bootstrap_body_unreadable') };
  }
  try {
    return {
      value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown,
    };
  } catch {
    return { response: bootstrapError(400, 'invalid_json') };
  }
}

async function rateLimit(
  request: Request,
  env: BootstrapEnv,
  surface: string,
): Promise<Response | null> {
  if (!env.PAIR_RATE_LIMITER) {
    return bootstrapError(503, 'bootstrap_rate_limiter_not_configured');
  }
  const client = request.headers.get('cf-connecting-ip') ?? 'unknown-client';
  try {
    const outcome = await env.PAIR_RATE_LIMITER.limit({
      key: `bootstrap:${surface}:${client}`,
    });
    if (outcome.success) return null;
    const response = bootstrapError(429, 'bootstrap_rate_limited');
    response.headers.set('retry-after', '60');
    return response;
  } catch {
    return bootstrapError(503, 'bootstrap_rate_limiter_unavailable');
  }
}

async function hmacHex(pepper: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(signature));
}

function randomToken(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToBase64Url(buffer);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function safeJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringField(value: unknown, max: number): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : '';
}

function stringFieldOrNull(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : null;
}

function allowedOrigins(env: BootstrapEnv): Set<string> {
  return new Set(
    (env.FOCUSLINK_ALLOWED_ORIGINS ?? 'https://localhost,capacitor://localhost,http://localhost')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function validateOrigin(request: Request, env: BootstrapEnv): Response | null {
  const origin = request.headers.get('origin');
  return !origin || allowedOrigins(env).has(origin)
    ? null
    : bootstrapError(403, 'cors_origin_denied');
}

function preflight(request: Request, env: BootstrapEnv): Response {
  const error = validateOrigin(request, env);
  if (error) return error;
  const response = new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
      'cache-control': 'no-store',
      vary: 'Origin',
    },
  });
  const origin = request.headers.get('origin');
  if (origin) response.headers.set('access-control-allow-origin', origin);
  return response;
}

function withCors(request: Request, env: BootstrapEnv, response: Response): Response {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(env).has(origin)) return response;
  const next = new Response(response.body, response);
  next.headers.set('access-control-allow-origin', origin);
  next.headers.append('vary', 'Origin');
  return next;
}

function bootstrapError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: bootstrapHeaders(),
  });
}

function bootstrapJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: bootstrapHeaders(),
  });
}

function bootstrapHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
}

async function cloneJson(response: Response): Promise<unknown> {
  try {
    return (await response.clone().json()) as unknown;
  } catch {
    return null;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
