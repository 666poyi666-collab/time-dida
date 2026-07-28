import { DEVICE_SYNC_PROTOCOL_VERSION } from '../shared/sync/deviceProtocol';
import { SYNC_V2_PROTOCOL_VERSION } from '../shared/sync/v2Protocol';
import { FocusLinkAccount, type WorkerEnv } from './accountDurableObject';

export { FocusLinkAccount };

// This Worker has no public ingress. The foxlink-cloud-mcp adapter is the sole
// public boundary and reaches these canonical paths through a service binding.
// Internal DO paths stay private so the adapter cannot accidentally revive the
// retired /v1/* or /v2/* public contracts.
const CANONICAL_AUTHORITY_ROUTES = new Map([
  ['/sync/v2/status', '/v2/sync/epoch'],
  ['/sync/v2/exchange', '/v2/sync'],
  ['/sync/v2/tasks', '/v1/tasks'],
  ['/sync/v2/live', '/v1/live'],
  ['/sync/v2/live/wait', '/v1/live/wait'],
  ['/sync/v2/live/command', '/v1/live/command'],
  ['/sync/v1/pair/offers', '/v2/pair/offers'],
  ['/sync/v1/pair/exchange', '/v2/pair/exchange'],
]);

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') {
      if (request.method !== 'GET')
        return errorJson(405, 'method_not_allowed', 'method not allowed');
      return withCors(
        request,
        env,
        json({
          ok: true,
          service: 'focuslink-device-sync-cloudflare',
          publicIngress: false,
          deploymentMode: 'internal-service-binding-only',
          protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
          syncV2ProtocolVersion: SYNC_V2_PROTOCOL_VERSION,
          storage: 'sqlite-durable-object',
        }),
      );
    }
    if (url.pathname === '/readyz') {
      if (request.method !== 'GET')
        return errorJson(405, 'method_not_allowed', 'method not allowed');
      if (
        !env.FOCUSLINK_ACCOUNT_ID ||
        !validDistinctServiceSecrets([
          env.FOCUSLINK_SYNC_TOKEN,
          env.FOCUSLINK_DEVICE_PEPPER,
          env.FOCUSLINK_MCP_SERVICE_TOKEN,
        ])
      ) {
        return errorJson(503, 'not_configured', 'worker account binding is incomplete');
      }
      try {
        const id = env.FOCUSLINK_ACCOUNT.idFromName(env.FOCUSLINK_ACCOUNT_ID);
        const stub = env.FOCUSLINK_ACCOUNT.get(id);
        const authorityResponse = await stub.fetch(
          new Request('https://focuslink.internal/internal/readyz', {
            method: 'GET',
            headers: {
              'x-focuslink-account': env.FOCUSLINK_ACCOUNT_ID,
              'x-focuslink-internal': env.FOCUSLINK_SYNC_TOKEN,
            },
          }),
        );
        const authorityStatus: unknown = await authorityResponse.json();
        if (
          !authorityResponse.ok ||
          !isRecord(authorityStatus) ||
          authorityStatus.ok !== true ||
          authorityStatus.storageReady !== true
        ) {
          return errorJson(503, 'authority_unready', 'account authority is not ready');
        }
        return withCors(
          request,
          env,
          json({
            ok: true,
            ready: true,
            service: 'focuslink-device-sync-cloudflare',
            publicIngress: false,
            authorityReady: true,
            mcpProjectionReady: true,
          }),
        );
      } catch {
        return errorJson(503, 'authority_unreachable', 'account authority is unavailable');
      }
    }
    if (url.pathname === '/internal/mcp/v1/focus/summary') {
      if (request.method !== 'GET') {
        return errorJson(405, 'method_not_allowed', 'GET required');
      }
      if (
        !env.FOCUSLINK_ACCOUNT_ID ||
        !env.FOCUSLINK_MCP_SERVICE_TOKEN ||
        request.headers.get('x-focuslink-mcp-service') !== env.FOCUSLINK_MCP_SERVICE_TOKEN
      ) {
        return errorJson(401, 'internal_service_unauthenticated', 'service credential required');
      }
      const id = env.FOCUSLINK_ACCOUNT.idFromName(env.FOCUSLINK_ACCOUNT_ID);
      const stub = env.FOCUSLINK_ACCOUNT.get(id);
      const headers = new Headers();
      headers.set('x-focuslink-account', env.FOCUSLINK_ACCOUNT_ID);
      headers.set('x-focuslink-mcp-service', env.FOCUSLINK_MCP_SERVICE_TOKEN);
      return stub.fetch(new Request(request.url, { method: 'GET', headers }));
    }
    if (isRetiredPublicRoute(url.pathname)) {
      return errorJson(410, 'legacy_route_retired', 'use /sync/v2/exchange or /sync/v2/status');
    }
    const authorityPath = CANONICAL_AUTHORITY_ROUTES.get(url.pathname);
    if (!authorityPath) return errorJson(404, 'not_found', 'route not found');
    if (request.method === 'OPTIONS') return preflight(request, env);

    const originError = validateOrigin(request, env);
    if (originError) return originError;
    const authorization = request.headers.get('authorization');
    const pairingExchange = url.pathname === '/sync/v1/pair/exchange';
    const isDevice =
      /^Bearer fl2_[A-Za-z0-9-]{6,80}_[A-Za-z0-9-]{6,80}_[A-Za-z0-9_-]{32,160}$/.test(
        authorization ?? '',
      );
    // Pair-offer creation reaches this private Worker only after the public
    // foxlink-cloud-mcp adapter validates owner session + CSRF. The supplied
    // fl2 credential is still checked by the Account DO for devices:manage;
    // merely matching the token shape here is never sufficient.
    // Other sync routes likewise accept only device credentials. OAuth tokens
    // and the Worker owner credential are intentionally not sync credentials.
    if (!pairingExchange && !isDevice) {
      return withCors(
        request,
        env,
        new Response(
          JSON.stringify({
            error: { code: 'unauthenticated', message: 'valid Bearer token required' },
          }),
          {
            status: 401,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
              'www-authenticate': 'Bearer realm="focuslink-device-sync-cloudflare"',
            },
          },
        ),
      );
    }
    if (!env.FOCUSLINK_ACCOUNT_ID || !env.FOCUSLINK_SYNC_TOKEN) {
      return errorJson(503, 'not_configured', 'worker account binding is incomplete');
    }

    const id = env.FOCUSLINK_ACCOUNT.idFromName(env.FOCUSLINK_ACCOUNT_ID);
    const stub = env.FOCUSLINK_ACCOUNT.get(id);
    const headers = new Headers(request.headers);
    if (isDevice) headers.set('x-focuslink-authorization', authorization!);
    headers.delete('authorization');
    headers.set('x-focuslink-account', env.FOCUSLINK_ACCOUNT_ID);
    const authorityUrl = new URL(request.url);
    authorityUrl.pathname = authorityPath;
    const forwarded = new Request(authorityUrl.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    });
    return withCors(request, env, await stub.fetch(forwarded));
  },
  async scheduled(_controller: ScheduledController, env: WorkerEnv): Promise<void> {
    const id = env.FOCUSLINK_ACCOUNT.idFromName(env.FOCUSLINK_ACCOUNT_ID);
    const stub = env.FOCUSLINK_ACCOUNT.get(id);
    const response = await stub.fetch('https://focuslink.internal/internal/v2/backup', {
      method: 'POST',
      headers: {
        'x-focuslink-account': env.FOCUSLINK_ACCOUNT_ID,
        'x-focuslink-internal': env.FOCUSLINK_SYNC_TOKEN,
      },
    });
    if (!response.ok) throw new Error(`scheduled backup failed: ${response.status}`);
  },
  async queue(batch: MessageBatch, _env: WorkerEnv): Promise<void> {
    // Provider credentials are deliberately optional. HTTPS polling remains authoritative;
    // queued hints are acknowledged until a provider adapter can authenticate.
    for (const message of batch.messages) message.ack();
  },
} satisfies ExportedHandler<WorkerEnv>;

function isRetiredPublicRoute(pathname: string): boolean {
  return pathname === '/sync/push' || pathname.startsWith('/v1/') || pathname.startsWith('/v2/');
}

function validServiceSecret(value: string | undefined): value is string {
  return typeof value === 'string' && value.length >= 32;
}

function validDistinctServiceSecrets(values: Array<string | undefined>): values is string[] {
  return values.every(validServiceSecret) && new Set(values).size === values.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function allowedOrigins(env: WorkerEnv): Set<string> {
  return new Set(
    (env.FOCUSLINK_ALLOWED_ORIGINS ?? 'https://localhost,capacitor://localhost,http://localhost')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function validateOrigin(request: Request, env: WorkerEnv): Response | null {
  const origin = request.headers.get('origin');
  if (!origin || allowedOrigins(env).has(origin)) return null;
  return errorJson(403, 'cors_origin_denied', 'origin is not allowed');
}

function preflight(request: Request, env: WorkerEnv): Response {
  const originError = validateOrigin(request, env);
  if (originError) return originError;
  const origin = request.headers.get('origin');
  const response = new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
    },
  });
  if (origin) response.headers.set('access-control-allow-origin', origin);
  return response;
}

function withCors(request: Request, env: WorkerEnv, response: Response): Response {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(env).has(origin)) return response;
  const next = new Response(response.body, response);
  next.headers.set('access-control-allow-origin', origin);
  next.headers.append('vary', 'Origin');
  return next;
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function errorJson(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
