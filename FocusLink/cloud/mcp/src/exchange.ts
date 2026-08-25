import { BoundedBodyError, exactArrayBuffer, readBoundedBody } from './bounded-body';
import { FEED_ENTITY_TYPES, SYNC_PROTOCOL_VERSION } from './feed-types';
import { focuslinkUpstreamUrl } from './upstream';

const MAX_EXCHANGE_BODY_BYTES = 1024 * 1024;
const MAX_TASK_BODY_BYTES = 512 * 1024;
const MAX_LIVE_COMMAND_BODY_BYTES = 16 * 1024;
const MAX_UPSTREAM_RESPONSE_BYTES = 1_100_000;
const MAX_CANONICAL_QUERY_BYTES = 2_048;
const MAX_MUTATIONS = 200;
const MAX_PULL = 500;
const UPSTREAM_TIMEOUT_MS = 15_000;
const LIVE_WAIT_MAX_MS = 25_000;
const LIVE_WAIT_TIMEOUT_MARGIN_MS = 5_000;
const DEVICE_TOKEN_PATTERN =
  /^fl2_([A-Za-z0-9-]{6,80})_([A-Za-z0-9-]{6,80})_([A-Za-z0-9_-]{32,160})$/;

export interface ExchangeEnv {
  FOCUSLINK_UPSTREAM?: Fetcher;
  FOCUSLINK_DEVICE_TOKEN?: string;
  FOCUSLINK_PAIR_AUTHORITY_TOKEN?: string;
  OAUTH_RS_CLIENT_SECRET?: string;
  FOCUSLINK_ALLOWED_ORIGINS?: string;
}

export async function handleCanonicalSync(request: Request, env: ExchangeEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/sync/v1/status' || url.pathname === '/sync/v1/exchange') {
    return withCors(request, env, syncError(410, 'legacy_sync_route_retired'));
  }
  const route = canonicalRoute(url.pathname);
  if (!route) return withCors(request, env, syncError(404, 'not_found'));
  if (request.method === 'OPTIONS') return preflight(request, env, route.methods);
  const originError = validateOrigin(request, env);
  if (originError) return originError;
  if (!route.methods.includes(request.method as 'GET' | 'POST')) {
    return withCors(request, env, methodNotAllowed(route.methods));
  }
  const query = validateCanonicalQuery(url, route.query);
  if (!query.ok) return withCors(request, env, syncError(query.status, query.code));
  if (!env.FOCUSLINK_UPSTREAM) {
    return withCors(request, env, syncError(503, 'upstream_service_binding_missing'));
  }

  const token = deviceBearerToken(request);
  if (!token) return withCors(request, env, syncError(401, 'device_credential_required'));
  if (
    (env.OAUTH_RS_CLIENT_SECRET && constantTimeEqual(token.value, env.OAUTH_RS_CLIENT_SECRET)) ||
    (env.FOCUSLINK_DEVICE_TOKEN && constantTimeEqual(token.value, env.FOCUSLINK_DEVICE_TOKEN)) ||
    (env.FOCUSLINK_PAIR_AUTHORITY_TOKEN &&
      constantTimeEqual(token.value, env.FOCUSLINK_PAIR_AUTHORITY_TOKEN))
  ) {
    return withCors(request, env, syncError(403, 'credential_boundary_violation'));
  }

  if (url.pathname === '/sync/v2/status') {
    return withCors(
      request,
      env,
      await proxyToAuthority(
        focuslinkUpstreamUrl('/sync/v2/status'),
        token.value,
        { method: 'GET' },
        env.FOCUSLINK_UPSTREAM,
        UPSTREAM_TIMEOUT_MS,
      ),
    );
  }

  if (url.pathname === '/sync/v2/exchange') {
    const parsed = await readJsonBody(request, MAX_EXCHANGE_BODY_BYTES, 'exchange_body_too_large');
    if ('response' in parsed) return withCors(request, env, parsed.response);
    if (!validateExchangeBody(parsed.value, token.devicePublicId)) {
      return withCors(request, env, syncError(400, 'invalid_exchange_request'));
    }
    return withCors(
      request,
      env,
      await proxyToAuthority(
        focuslinkUpstreamUrl('/sync/v2/exchange'),
        token.value,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify(parsed.value),
        },
        env.FOCUSLINK_UPSTREAM,
        UPSTREAM_TIMEOUT_MS,
      ),
    );
  }

  const upstreamUrl = focuslinkUpstreamUrl(url.pathname);
  upstreamUrl.search = url.search;
  let init: RequestInit = { method: request.method };
  if (request.method === 'POST') {
    if (route.maxBodyBytes === 0) {
      try {
        await readBoundedBody(request.body, request.headers, 0);
      } catch (error) {
        if (error instanceof BoundedBodyError && error.reason === 'too_large') {
          return withCors(request, env, syncError(413, route.tooLargeCode));
        }
        return withCors(request, env, syncError(400, 'request_body_unreadable'));
      }
      init = { method: 'POST' };
    } else {
      const parsed = await readJsonBody(request, route.maxBodyBytes, route.tooLargeCode);
      if ('response' in parsed) return withCors(request, env, parsed.response);
      init = {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(parsed.value),
      };
    }
  }
  return withCors(
    request,
    env,
    await proxyToAuthority(upstreamUrl, token.value, init, env.FOCUSLINK_UPSTREAM, query.timeoutMs),
  );
}

type CanonicalMethod = 'GET' | 'POST';
type QueryPolicy = 'none' | 'live-wait';
interface CanonicalRoute {
  methods: ReadonlyArray<CanonicalMethod>;
  query: QueryPolicy;
  maxBodyBytes: number;
  tooLargeCode: string;
}

function canonicalRoute(pathname: string): CanonicalRoute | null {
  if (/^\/sync\/v2\/devices\/device-[A-Za-z0-9-]{6,194}\/revoke$/.test(pathname)) {
    return {
      methods: ['POST'],
      query: 'none',
      maxBodyBytes: 0,
      tooLargeCode: 'body_not_allowed',
    };
  }
  switch (pathname) {
    case '/sync/v2/status':
      return {
        methods: ['GET'],
        query: 'none',
        maxBodyBytes: 0,
        tooLargeCode: 'body_not_allowed',
      };
    case '/sync/v2/exchange':
      return {
        methods: ['POST'],
        query: 'none',
        maxBodyBytes: MAX_EXCHANGE_BODY_BYTES,
        tooLargeCode: 'exchange_body_too_large',
      };
    case '/sync/v2/tasks':
      return {
        methods: ['GET', 'POST'],
        query: 'none',
        maxBodyBytes: MAX_TASK_BODY_BYTES,
        tooLargeCode: 'task_body_too_large',
      };
    case '/sync/v2/live':
      return {
        methods: ['GET'],
        query: 'none',
        maxBodyBytes: 0,
        tooLargeCode: 'body_not_allowed',
      };
    case '/sync/v2/live/wait':
      return {
        methods: ['GET'],
        query: 'live-wait',
        maxBodyBytes: 0,
        tooLargeCode: 'body_not_allowed',
      };
    case '/sync/v2/live/command':
      return {
        methods: ['POST'],
        query: 'none',
        maxBodyBytes: MAX_LIVE_COMMAND_BODY_BYTES,
        tooLargeCode: 'live_command_body_too_large',
      };
    case '/sync/v2/devices':
      return {
        methods: ['GET'],
        query: 'none',
        maxBodyBytes: 0,
        tooLargeCode: 'body_not_allowed',
      };
    default:
      return null;
  }
}

function validateCanonicalQuery(
  url: URL,
  policy: QueryPolicy,
): { ok: true; timeoutMs: number } | { ok: false; status: number; code: string } {
  if (url.search.length > MAX_CANONICAL_QUERY_BYTES) {
    return { ok: false, status: 414, code: 'query_too_large' };
  }
  if (policy === 'none') {
    return url.search
      ? { ok: false, status: 400, code: 'unexpected_query' }
      : { ok: true, timeoutMs: UPSTREAM_TIMEOUT_MS };
  }
  const keys: string[] = [];
  url.searchParams.forEach((_value, key) => keys.push(key));
  if (
    keys.some((key) => key !== 'afterRevision' && key !== 'waitMs') ||
    url.searchParams.getAll('afterRevision').length !== 1 ||
    url.searchParams.getAll('waitMs').length !== 1
  ) {
    return { ok: false, status: 400, code: 'invalid_live_wait_query' };
  }
  const afterRevision = strictUnsignedInteger(url.searchParams.get('afterRevision'));
  const waitMs = strictUnsignedInteger(url.searchParams.get('waitMs'));
  if (afterRevision === null || waitMs === null || waitMs > LIVE_WAIT_MAX_MS) {
    return { ok: false, status: 400, code: 'invalid_live_wait_query' };
  }
  return {
    ok: true,
    timeoutMs: Math.max(UPSTREAM_TIMEOUT_MS, waitMs + LIVE_WAIT_TIMEOUT_MARGIN_MS),
  };
}

function strictUnsignedInteger(value: string | null): number | null {
  if (value === null || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function proxyToAuthority(
  url: URL,
  deviceToken: string,
  init: RequestInit,
  binding: Fetcher,
  timeoutMs: number,
): Promise<Response> {
  let response: Response;
  try {
    const nextRequest = new Request(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${deviceToken}`,
        ...(init.headers ?? {}),
      },
    });
    response = await binding.fetch(nextRequest);
  } catch {
    return syncError(502, 'authoritative_upstream_unreachable');
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return syncError(502, 'authoritative_redirect_rejected');
  }
  let body: Uint8Array;
  try {
    body = await readBoundedBody(response.body, response.headers, MAX_UPSTREAM_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof BoundedBodyError && error.reason === 'too_large') {
      return syncError(502, 'authoritative_response_too_large');
    }
    return syncError(502, 'authoritative_response_unreadable');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return syncError(502, 'authoritative_response_not_json');
  }
  return new Response(exactArrayBuffer(body), {
    status: response.status,
    headers: syncHeaders({
      'x-focuslink-authority': 'durable-object-v2',
      'x-focuslink-adapter': 'canonical-sync-v2-service-binding',
    }),
  });
}

async function readJsonBody(
  request: Request,
  maximumBytes: number,
  tooLargeCode: string,
): Promise<{ value: unknown } | { response: Response }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return { response: syncError(415, 'content_type_must_be_json') };
  }
  let raw: Uint8Array;
  try {
    raw = await readBoundedBody(request.body, request.headers, maximumBytes);
  } catch (error) {
    if (error instanceof BoundedBodyError && error.reason === 'too_large') {
      return { response: syncError(413, tooLargeCode) };
    }
    return { response: syncError(400, 'exchange_body_unreadable') };
  }
  try {
    return {
      value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as unknown,
    };
  } catch {
    return { response: syncError(400, 'invalid_json') };
  }
}

function validateExchangeBody(value: unknown, devicePublicId: string): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'protocolVersion',
      'deviceId',
      'syncEpoch',
      'cursorEpoch',
      'accountGeneration',
      'cursor',
      'mutations',
      'pullLimit',
    ])
  )
    return false;
  if (
    value.protocolVersion !== SYNC_PROTOCOL_VERSION ||
    value.deviceId !== `device-${devicePublicId}` ||
    !isEpochString(value.syncEpoch) ||
    !isEpochString(value.cursorEpoch) ||
    !Number.isSafeInteger(value.accountGeneration) ||
    Number(value.accountGeneration) < 1 ||
    (value.cursor !== null &&
      (typeof value.cursor !== 'string' ||
        value.cursor.length < 1 ||
        value.cursor.length > 2_048)) ||
    !Array.isArray(value.mutations) ||
    value.mutations.length > MAX_MUTATIONS ||
    !Number.isSafeInteger(value.pullLimit) ||
    Number(value.pullLimit) < 1 ||
    Number(value.pullLimit) > MAX_PULL
  )
    return false;
  return value.mutations.every((mutation) =>
    validateMutation(mutation, value.deviceId as string, value.accountGeneration as number),
  );
}

function validateMutation(value: unknown, deviceId: string, accountGeneration: number): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'opId',
      'entityType',
      'entityId',
      'kind',
      'baseRevision',
      'baseFingerprint',
      'payload',
      'deviceId',
      'accountGeneration',
    ])
  )
    return false;
  if (
    !isRemoteId(value.opId) ||
    !FEED_ENTITY_TYPES.includes(value.entityType as (typeof FEED_ENTITY_TYPES)[number]) ||
    !isRemoteId(value.entityId) ||
    !['put', 'delete', 'restore', 'purge'].includes(String(value.kind)) ||
    !Number.isSafeInteger(value.baseRevision) ||
    Number(value.baseRevision) < 0 ||
    (value.baseFingerprint !== null &&
      (typeof value.baseFingerprint !== 'string' ||
        !/^[a-f0-9]{32,128}$/i.test(value.baseFingerprint))) ||
    value.deviceId !== deviceId ||
    value.accountGeneration !== accountGeneration
  )
    return false;
  if ((value.kind === 'put' || value.kind === 'restore') && !isRecord(value.payload)) return false;
  if ((value.kind === 'delete' || value.kind === 'purge') && value.payload !== null) return false;
  return true;
}

function deviceBearerToken(
  request: Request,
): { value: string; accountPublicId: string; devicePublicId: string } | null {
  const header = /^Bearer ([^\s]{1,4096})$/i.exec(request.headers.get('authorization') ?? '');
  if (!header) return null;
  const match = DEVICE_TOKEN_PATTERN.exec(header[1]);
  return match ? { value: header[1], accountPublicId: match[1], devicePublicId: match[2] } : null;
}

function allowedOrigins(env: ExchangeEnv): Set<string> {
  return new Set(
    (env.FOCUSLINK_ALLOWED_ORIGINS ?? 'https://localhost,capacitor://localhost,http://localhost')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function validateOrigin(request: Request, env: ExchangeEnv): Response | null {
  const origin = request.headers.get('origin');
  if (!origin || allowedOrigins(env).has(origin)) return null;
  return syncError(403, 'cors_origin_denied');
}

function preflight(
  request: Request,
  env: ExchangeEnv,
  methods: ReadonlyArray<CanonicalMethod>,
): Response {
  const originError = validateOrigin(request, env);
  if (originError) return originError;
  const response = new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-methods': [...methods, 'OPTIONS'].join(', '),
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

function methodNotAllowed(methods: ReadonlyArray<CanonicalMethod>): Response {
  const response = syncError(405, 'method_not_allowed');
  response.headers.set('allow', [...methods, 'OPTIONS'].join(', '));
  return response;
}

function withCors(request: Request, env: ExchangeEnv, response: Response): Response {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(env).has(origin)) return response;
  const next = new Response(response.body, response);
  next.headers.set('access-control-allow-origin', origin);
  next.headers.append('vary', 'Origin');
  return next;
}

function syncError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: syncHeaders(
      status === 401 ? { 'www-authenticate': 'Bearer realm="focuslink-device-sync"' } : {},
    ),
  });
}

function syncHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
}

function isEpochString(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128;
}

function isRemoteId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
