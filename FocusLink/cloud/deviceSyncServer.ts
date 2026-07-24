/** Shared HTTP transport for the loopback test service and the single-instance personal cloud. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  DEVICE_SYNC_MAX_BODY_BYTES,
  DEVICE_SYNC_ENTITY,
  DEVICE_SYNC_MAX_PULL,
  DEVICE_SYNC_MAX_PUSH,
  DEVICE_SYNC_PROTOCOL_VERSION,
} from '../shared/sync/deviceProtocol';
import type { DeviceSyncMutation, DeviceSyncRequest } from '../shared/sync/deviceProtocol';
import {
  LIVE_FOCUS_COMMAND_PATH,
  LIVE_FOCUS_MAX_COMMAND_BODY_BYTES,
  LIVE_FOCUS_MAX_WAIT_MS,
  LIVE_FOCUS_SNAPSHOT_PATH,
  LIVE_FOCUS_WAIT_PATH,
  validateLiveFocusCommandRequest,
} from '../shared/sync/liveFocusProtocol';
import {
  TASK_SNAPSHOT_MAX_BODY_BYTES,
  TASK_SNAPSHOT_PATH,
  validateTaskSnapshotPublishRequest,
} from '../shared/sync/taskSnapshotProtocol';
import {
  DeviceSyncCloudStoreError,
  LiveFocusWaitAbortedError,
  createDeviceSyncCloudStore,
  type DeviceSyncCloudStore,
} from './deviceSyncStore';

export const DEVICE_SYNC_TEST_BODY_LIMIT_BYTES = DEVICE_SYNC_MAX_BODY_BYTES;
export const DEFAULT_DEVICE_SYNC_TEST_HOST = '127.0.0.1';
export const DEFAULT_DEVICE_SYNC_TEST_PORT = 18787;
export const DEFAULT_DEVICE_SYNC_TEST_ACCOUNT = 'focuslink-local-test-account';
export const DEFAULT_DEVICE_SYNC_TEST_ORIGINS = [
  'http://127.0.0.1:5175',
  'http://localhost:5175',
  'http://127.0.0.1:4175',
  'http://localhost:4175',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
] as const;
export const DEVICE_SYNC_NATIVE_ORIGINS = ['https://localhost', 'capacitor://localhost'] as const;
const REQUEST_KEYS = new Set(['protocolVersion', 'deviceId', 'cursor', 'mutations', 'pullLimit']);
const MUTATION_KEYS = new Set(['opId', 'entity', 'entityId', 'kind', 'baseRevision', 'payload']);

export interface DeviceSyncCloudServerOptions {
  store?: DeviceSyncCloudStore;
  /** Test-only Bearer token to account mapping. */
  tokenAccounts?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  /** Exact origins only. Wildcards are intentionally unsupported. Native clients omit Origin. */
  allowedOrigins?: readonly string[];
  host?: string;
  port?: number;
  profile?: 'test' | 'personal-cloud';
  /** Require TLS termination to identify the original request as HTTPS. */
  requireForwardedHttps?: boolean;
  /** Coarse per-process protection; a production reverse proxy should add its own limiter too. */
  maxRequestsPerMinute?: number;
  /** Optional one-time credential exchange, used by the loopback embedded service only. */
  pairingExchange?: (nonce: string, deviceId: string) => { accessToken: string } | null;
}

export interface DeviceSyncCloudServerAddress {
  host: string;
  port: number;
  url: string;
}

export interface DeviceSyncCloudServer {
  readonly httpServer: http.Server;
  readonly store: DeviceSyncCloudStore;
  listen(): Promise<DeviceSyncCloudServerAddress>;
  close(): Promise<void>;
}

class RequestBodyTooLargeError extends Error {}
class InvalidRequestBodyError extends Error {}

export function createDeviceSyncCloudServer(
  options: DeviceSyncCloudServerOptions = {},
): DeviceSyncCloudServer {
  const store = options.store ?? createDeviceSyncCloudStore();
  const tokenAccounts = normalizeTokenAccounts(options.tokenAccounts);
  const allowedOrigins = new Set(options.allowedOrigins ?? DEFAULT_DEVICE_SYNC_TEST_ORIGINS);
  const host = options.host ?? DEFAULT_DEVICE_SYNC_TEST_HOST;
  const port = options.port ?? 0;
  const profile = options.profile ?? 'test';
  const requireForwardedHttps = options.requireForwardedHttps ?? false;
  const limiter = createRateLimiter(options.maxRequestsPerMinute ?? 0);
  const pairingExchange = options.pairingExchange;

  const httpServer = http.createServer((request, response) => {
    applySecurityHeaders(response);
    if (limiter && !limiter.accept(request.socket.remoteAddress ?? 'unknown', Date.now())) {
      response.setHeader('Retry-After', '60');
      sendError(response, 429, 'rate_limited', 'too many requests');
      return;
    }
    void handleRequest(
      request,
      response,
      store,
      tokenAccounts,
      allowedOrigins,
      profile,
      requireForwardedHttps,
      pairingExchange,
    ).catch((error) => {
      if (!response.headersSent) {
        sendError(response, 500, 'internal_error', 'sync server failed');
      } else if (!response.writableEnded) {
        response.end();
      }
      // Keep test-server failures observable without leaking request bodies or credentials.
      console.error(
        `[FocusLink ${profile}]`,
        error instanceof Error ? error.message : String(error),
      );
    });
  });
  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 10_000;
  httpServer.keepAliveTimeout = 5_000;

  return {
    httpServer,
    store,
    listen: () =>
      new Promise<DeviceSyncCloudServerAddress>((resolve, reject) => {
        if (httpServer.listening) {
          const address = httpServer.address();
          if (!address || typeof address === 'string') {
            reject(new Error('test sync server has no TCP address'));
            return;
          }
          resolve(toServerAddress(address));
          return;
        }
        const onError = (error: Error) => reject(error);
        httpServer.once('error', onError);
        httpServer.listen(port, host, () => {
          httpServer.off('error', onError);
          const address = httpServer.address();
          if (!address || typeof address === 'string') {
            reject(new Error('test sync server failed to bind a TCP address'));
            return;
          }
          resolve(toServerAddress(address));
        });
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!httpServer.listening) {
          resolve();
          return;
        }
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  store: DeviceSyncCloudStore,
  tokenAccounts: ReadonlyMap<string, string>,
  allowedOrigins: ReadonlySet<string>,
  profile: 'test' | 'personal-cloud',
  requireForwardedHttps: boolean,
  pairingExchange?: (nonce: string, deviceId: string) => { accessToken: string } | null,
): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', 'http://focuslink.test');
  if (
    requireForwardedHttps &&
    requestUrl.pathname !== '/health' &&
    !requestArrivedOverHttps(request)
  ) {
    sendError(response, 400, 'https_required', 'HTTPS is required');
    return;
  }
  const origin = readSingleHeader(request.headers.origin);
  if (origin && !allowedOrigins.has(origin)) {
    sendError(response, 403, 'cors_origin_denied', 'origin is not allowed');
    return;
  }
  if (origin) applyCorsHeaders(response, origin);

  if (request.method === 'OPTIONS') {
    handlePreflight(request, response, requestUrl.pathname, origin, allowedOrigins);
    return;
  }

  if (requestUrl.pathname === '/health') {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET, OPTIONS');
      sendError(response, 405, 'method_not_allowed', 'method not allowed');
      return;
    }
    sendJson(response, 200, {
      ok: true,
      service:
        profile === 'personal-cloud'
          ? 'focuslink-device-sync-personal-cloud'
          : 'focuslink-device-sync-test',
      production: profile === 'personal-cloud',
      protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
    });
    return;
  }

  if (requestUrl.pathname === '/v1/pair') {
    if (!pairingExchange) {
      sendError(response, 404, 'not_found', 'pairing is not available');
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST, OPTIONS');
      sendError(response, 405, 'method_not_allowed', 'method not allowed');
      return;
    }
    if (!hasJsonContentType(request)) {
      sendError(response, 415, 'unsupported_media_type', 'application/json required');
      return;
    }
    let pairBody: unknown;
    try {
      pairBody = JSON.parse(await readRequestBody(request, 8 * 1024)) as unknown;
    } catch {
      sendError(response, 400, 'invalid_request', 'invalid pairing request');
      return;
    }
    const record = pairBody as Record<string, unknown>;
    const nonce = typeof record?.nonce === 'string' ? record.nonce : '';
    const deviceId = typeof record?.deviceId === 'string' ? record.deviceId : '';
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(nonce) || !/^[A-Za-z0-9._-]{1,200}$/.test(deviceId)) {
      sendError(response, 400, 'invalid_request', 'invalid pairing fields');
      return;
    }
    const exchanged = pairingExchange(nonce, deviceId);
    if (!exchanged) {
      sendError(response, 410, 'pairing_expired', 'pairing code expired or was already used');
      return;
    }
    sendJson(response, 200, {
      protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
      accessToken: exchanged.accessToken,
    });
    return;
  }

  const expectedMethod = routeMethod(requestUrl.pathname);
  if (!expectedMethod) {
    sendError(response, 404, 'not_found', 'route not found');
    return;
  }
  const methodAllowed =
    requestUrl.pathname === TASK_SNAPSHOT_PATH
      ? request.method === 'GET' || request.method === 'POST'
      : request.method === expectedMethod;
  if (!methodAllowed) {
    response.setHeader(
      'Allow',
      requestUrl.pathname === TASK_SNAPSHOT_PATH
        ? 'GET, POST, OPTIONS'
        : `${expectedMethod}, OPTIONS`,
    );
    sendError(response, 405, 'method_not_allowed', 'method not allowed');
    return;
  }

  const accountId = authenticate(request.headers.authorization, tokenAccounts);
  if (!accountId) {
    response.setHeader('WWW-Authenticate', 'Bearer realm="focuslink-device-sync-test"');
    sendError(response, 401, 'unauthenticated', 'valid Bearer token required');
    return;
  }

  if (requestUrl.pathname === LIVE_FOCUS_SNAPSHOT_PATH) {
    if ([...requestUrl.searchParams].length > 0) {
      sendError(response, 400, 'invalid_query', 'snapshot route does not accept query fields');
      return;
    }
    sendJson(response, 200, store.getLiveSnapshot(accountId));
    return;
  }

  if (requestUrl.pathname === TASK_SNAPSHOT_PATH && request.method === 'GET') {
    if ([...requestUrl.searchParams].length > 0) {
      sendError(response, 400, 'invalid_query', 'task snapshot route does not accept query fields');
      return;
    }
    sendJson(response, 200, store.getTaskSnapshot(accountId));
    return;
  }

  if (requestUrl.pathname === LIVE_FOCUS_WAIT_PATH) {
    let query: { afterRevision: number; waitMs: number };
    try {
      query = parseLiveWaitQuery(requestUrl.searchParams);
    } catch (error) {
      sendError(
        response,
        400,
        'invalid_query',
        error instanceof Error ? error.message : 'invalid live wait query',
      );
      return;
    }
    await handleLiveWait(request, response, store, accountId, query);
    return;
  }

  if (!hasJsonContentType(request)) {
    sendError(response, 415, 'unsupported_media_type', 'application/json required');
    return;
  }

  const bodyLimit =
    requestUrl.pathname === LIVE_FOCUS_COMMAND_PATH
      ? LIVE_FOCUS_MAX_COMMAND_BODY_BYTES
      : requestUrl.pathname === TASK_SNAPSHOT_PATH
        ? TASK_SNAPSHOT_MAX_BODY_BYTES
        : DEVICE_SYNC_TEST_BODY_LIMIT_BYTES;
  let parsed: unknown;
  try {
    const raw = await readRequestBody(request, bodyLimit);
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      sendError(
        response,
        413,
        'payload_too_large',
        requestUrl.pathname === LIVE_FOCUS_COMMAND_PATH
          ? 'live command body exceeds 16 KiB'
          : requestUrl.pathname === TASK_SNAPSHOT_PATH
            ? 'task snapshot body exceeds 512 KiB'
            : 'request body exceeds 1 MiB',
      );
      return;
    }
    sendError(
      response,
      400,
      'invalid_json',
      error instanceof InvalidRequestBodyError ? error.message : 'request body is not valid JSON',
    );
    return;
  }

  if (requestUrl.pathname === LIVE_FOCUS_COMMAND_PATH) {
    const validation = validateLiveFocusCommandRequest(parsed);
    if (!validation.ok || !validation.request) {
      sendError(response, 400, 'invalid_request', validation.error ?? 'invalid live command');
      return;
    }
    try {
      sendJson(response, 200, store.commandLive(accountId, validation.request));
    } catch (error) {
      if (sendStoreError(response, error)) return;
      throw error;
    }
    return;
  }

  if (requestUrl.pathname === TASK_SNAPSHOT_PATH) {
    if (!validateTaskSnapshotPublishRequest(parsed)) {
      sendError(response, 400, 'invalid_request', 'invalid task snapshot');
      return;
    }
    try {
      sendJson(response, 200, store.publishTaskSnapshot(accountId, parsed));
    } catch (error) {
      if (sendStoreError(response, error)) return;
      throw error;
    }
    return;
  }

  let syncRequest: DeviceSyncRequest;
  try {
    syncRequest = parseSyncRequest(parsed);
  } catch (error) {
    sendError(
      response,
      400,
      'invalid_request',
      error instanceof Error ? error.message : 'invalid sync request',
    );
    return;
  }

  try {
    sendJson(response, 200, store.sync(accountId, syncRequest));
  } catch (error) {
    if (sendStoreError(response, error)) return;
    throw error;
  }
}

function routeMethod(pathname: string): 'GET' | 'POST' | null {
  if (pathname === '/v1/pair' || pathname === '/v1/sync' || pathname === LIVE_FOCUS_COMMAND_PATH)
    return 'POST';
  if (pathname === TASK_SNAPSHOT_PATH) return 'POST';
  if (pathname === LIVE_FOCUS_SNAPSHOT_PATH || pathname === LIVE_FOCUS_WAIT_PATH) return 'GET';
  return null;
}

function hasJsonContentType(request: http.IncomingMessage): boolean {
  const contentType = readSingleHeader(request.headers['content-type']);
  return !!contentType && /^application\/json(?:\s*;|$)/i.test(contentType);
}

function parseLiveWaitQuery(searchParams: URLSearchParams): {
  afterRevision: number;
  waitMs: number;
} {
  const keys = [...searchParams.keys()];
  if (
    keys.length !== 2 ||
    searchParams.getAll('afterRevision').length !== 1 ||
    searchParams.getAll('waitMs').length !== 1 ||
    keys.some((key) => key !== 'afterRevision' && key !== 'waitMs')
  ) {
    throw new Error('afterRevision and waitMs are required exactly once');
  }
  const afterRevision = parseStrictUnsignedInteger(
    searchParams.get('afterRevision'),
    'afterRevision',
  );
  const waitMs = parseStrictUnsignedInteger(searchParams.get('waitMs'), 'waitMs');
  if (waitMs > LIVE_FOCUS_MAX_WAIT_MS) {
    throw new Error(`waitMs must be between 0 and ${LIVE_FOCUS_MAX_WAIT_MS}`);
  }
  return { afterRevision, waitMs };
}

function parseStrictUnsignedInteger(value: string | null, name: string): number {
  if (value === null || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} exceeds the safe integer range`);
  return parsed;
}

async function handleLiveWait(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  store: DeviceSyncCloudStore,
  accountId: string,
  query: { afterRevision: number; waitMs: number },
): Promise<void> {
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  request.once('aborted', abort);
  response.once('close', abort);
  try {
    const result = await store.waitForLiveSnapshot(
      accountId,
      query.afterRevision,
      query.waitMs,
      abortController.signal,
    );
    if (!abortController.signal.aborted) sendJson(response, 200, result);
  } catch (error) {
    if (error instanceof LiveFocusWaitAbortedError || abortController.signal.aborted) return;
    if (sendStoreError(response, error)) return;
    throw error;
  } finally {
    request.off('aborted', abort);
    response.off('close', abort);
  }
}

function sendStoreError(response: http.ServerResponse, error: unknown): boolean {
  if (!(error instanceof DeviceSyncCloudStoreError)) return false;
  if (error.code === 'store_corrupt') {
    sendError(response, 500, 'store_corrupt', 'test sync store is corrupt');
    return true;
  }
  const status = error.code === 'invalid_live_revision' ? 409 : 400;
  sendError(response, status, error.code, error.message);
  return true;
}

function parseSyncRequest(value: unknown): DeviceSyncRequest {
  if (!isRecord(value)) throw new Error('request must be an object');
  if (!hasOnlyKeys(value, REQUEST_KEYS)) throw new Error('request contains unsupported fields');
  if (value.protocolVersion !== DEVICE_SYNC_PROTOCOL_VERSION) {
    throw new Error('unsupported protocol version');
  }
  if (!isId(value.deviceId)) throw new Error('deviceId is invalid');
  if (value.cursor !== null && (typeof value.cursor !== 'string' || value.cursor.length > 512)) {
    throw new Error('cursor is invalid');
  }
  if (!Array.isArray(value.mutations) || value.mutations.length > DEVICE_SYNC_MAX_PUSH) {
    throw new Error(`mutations must contain at most ${DEVICE_SYNC_MAX_PUSH} items`);
  }
  if (
    !Number.isInteger(value.pullLimit) ||
    Number(value.pullLimit) < 1 ||
    Number(value.pullLimit) > DEVICE_SYNC_MAX_PULL
  ) {
    throw new Error(`pullLimit must be between 1 and ${DEVICE_SYNC_MAX_PULL}`);
  }

  const mutations = value.mutations.map(parseMutation);
  return {
    protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
    deviceId: value.deviceId,
    cursor: value.cursor,
    mutations,
    pullLimit: Number(value.pullLimit),
  };
}

function parseMutation(value: unknown): DeviceSyncMutation {
  if (!isRecord(value)) throw new Error('mutation must be an object');
  if (!hasOnlyKeys(value, MUTATION_KEYS)) throw new Error('mutation contains unsupported fields');
  if (!isId(value.opId) || !isId(value.entityId)) throw new Error('mutation id is invalid');
  if (value.entity !== DEVICE_SYNC_ENTITY) throw new Error('mutation entity is unsupported');
  if (value.kind !== 'put' && value.kind !== 'delete') throw new Error('mutation kind is invalid');
  if (!Number.isSafeInteger(value.baseRevision) || Number(value.baseRevision) < 0) {
    throw new Error('baseRevision is invalid');
  }
  return {
    opId: value.opId,
    entity: DEVICE_SYNC_ENTITY,
    entityId: value.entityId,
    kind: value.kind,
    baseRevision: Number(value.baseRevision),
    payload: value.payload as DeviceSyncMutation['payload'],
  };
}

function authenticate(
  authorization: string | string[] | undefined,
  tokenAccounts: ReadonlyMap<string, string>,
): string | null {
  const value = readSingleHeader(authorization);
  const match = value ? /^Bearer ([^\s]+)$/i.exec(value) : null;
  return match ? (tokenAccounts.get(match[1]) ?? null) : null;
}

function handlePreflight(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  pathname: string,
  origin: string | null,
  allowedOrigins: ReadonlySet<string>,
): void {
  if (!origin || !allowedOrigins.has(origin)) {
    sendError(response, 403, 'cors_origin_denied', 'explicit allowed origin required');
    return;
  }
  const expectedMethod = pathname === '/health' ? 'GET' : routeMethod(pathname);
  const requestedMethod = readSingleHeader(request.headers['access-control-request-method']);
  const methodAllowed =
    pathname === TASK_SNAPSHOT_PATH
      ? requestedMethod === 'GET' || requestedMethod === 'POST'
      : requestedMethod === expectedMethod;
  if (!expectedMethod || !methodAllowed) {
    sendError(response, 403, 'cors_method_denied', 'preflight method is not allowed');
    return;
  }
  const requestedHeaders = (
    readSingleHeader(request.headers['access-control-request-headers']) ?? ''
  )
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  const allowedHeaders = new Set(['authorization', 'content-type']);
  if (requestedHeaders.some((header) => !allowedHeaders.has(header))) {
    sendError(response, 403, 'cors_headers_denied', 'preflight headers are not allowed');
    return;
  }
  response.statusCode = 204;
  response.setHeader(
    'Access-Control-Allow-Methods',
    pathname === TASK_SNAPSHOT_PATH ? 'GET, POST, OPTIONS' : `${expectedMethod}, OPTIONS`,
  );
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Max-Age', '600');
  response.setHeader('Cache-Control', 'no-store');
  response.end();
}

function applyCorsHeaders(response: http.ServerResponse, origin: string): void {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
}

function readRequestBody(request: http.IncomingMessage, byteLimit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(readSingleHeader(request.headers['content-length']));
    if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
      request.resume();
      reject(new RequestBodyTooLargeError());
      return;
    }

    const chunks: Buffer[] = [];
    let byteLength = 0;
    let exceeded = false;
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > byteLimit) {
        exceeded = true;
        chunks.length = 0;
        return;
      }
      if (!exceeded) chunks.push(buffer);
    });
    request.once('end', () => {
      if (exceeded) {
        reject(new RequestBodyTooLargeError());
        return;
      }
      if (byteLength === 0) {
        reject(new InvalidRequestBodyError('request body is empty'));
        return;
      }
      resolve(Buffer.concat(chunks, byteLength).toString('utf8'));
    });
    request.once('aborted', () => reject(new InvalidRequestBodyError('request was aborted')));
    request.once('error', (error) => reject(error));
  });
}

function normalizeTokenAccounts(
  input: DeviceSyncCloudServerOptions['tokenAccounts'],
): ReadonlyMap<string, string> {
  // No predictable fallback credential: an unconfigured server remains health-checkable but
  // rejects every sync request until the caller supplies an explicit token mapping.
  if (!input) return new Map();
  if (input instanceof Map) return new Map(input);
  return new Map(Object.entries(input));
}

function readSingleHeader(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return;
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(payload));
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(payload);
}

function applySecurityHeaders(response: http.ServerResponse): void {
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
}

function requestArrivedOverHttps(request: http.IncomingMessage): boolean {
  const encrypted = Boolean((request.socket as { encrypted?: boolean }).encrypted);
  if (encrypted) return true;
  const forwarded = readSingleHeader(request.headers['x-forwarded-proto']);
  return forwarded?.split(',')[0]?.trim().toLowerCase() === 'https';
}

interface RateLimiter {
  accept(key: string, now: number): boolean;
}

function createRateLimiter(maxRequestsPerMinute: number): RateLimiter | null {
  if (!Number.isInteger(maxRequestsPerMinute) || maxRequestsPerMinute <= 0) return null;
  const buckets = new Map<string, { windowStart: number; count: number }>();
  return {
    accept(key, now) {
      const current = buckets.get(key);
      if (!current || now - current.windowStart >= 60_000) {
        buckets.set(key, { windowStart: now, count: 1 });
        if (buckets.size > 10_000) {
          for (const [bucketKey, bucket] of buckets) {
            if (now - bucket.windowStart >= 60_000) buckets.delete(bucketKey);
          }
        }
        return true;
      }
      current.count += 1;
      return current.count <= maxRequestsPerMinute;
    },
  };
}

function sendError(
  response: http.ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(response, status, { error: { code, message } });
}

function toServerAddress(address: AddressInfo): DeviceSyncCloudServerAddress {
  const host = address.address === '::' ? '::1' : address.address;
  const urlHost = host.includes(':') ? `[${host}]` : host;
  return { host, port: address.port, url: `http://${urlHost}:${address.port}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}
