import { DEVICE_SYNC_PROTOCOL_VERSION } from '../shared/sync/deviceProtocol';
import { SYNC_V2_PROTOCOL_VERSION } from '../shared/sync/v2Protocol';
import { FocusLinkAccount, type WorkerEnv } from './accountDurableObject';

export { FocusLinkAccount };

const PUBLIC_ROUTES = new Map([
  ['/sync/v2/status', '/v2/sync/epoch'],
  ['/sync/v2/exchange', '/v2/sync'],
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
          production: true,
          protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
          syncV2ProtocolVersion: SYNC_V2_PROTOCOL_VERSION,
          storage: 'sqlite-durable-object',
        }),
      );
    }
    if (url.pathname === '/readyz') {
      if (request.method !== 'GET')
        return errorJson(405, 'method_not_allowed', 'method not allowed');
      if (!env.FOCUSLINK_ACCOUNT_ID || !env.FOCUSLINK_SYNC_TOKEN) {
        return errorJson(503, 'not_configured', 'worker account binding is incomplete');
      }
      return withCors(request, env, json({ ok: true, ready: true, service: 'foxlink-cloud-mcp' }));
    }
    if (isRetiredPublicRoute(url.pathname)) {
      return errorJson(410, 'legacy_route_retired', 'use /sync/v2/exchange or /sync/v2/status');
    }
    const authorityPath = PUBLIC_ROUTES.get(url.pathname);
    if (!authorityPath) return errorJson(404, 'not_found', 'route not found');
    if (request.method === 'OPTIONS') return preflight(request, env);

    const originError = validateOrigin(request, env);
    if (originError) return originError;
    const authorization = request.headers.get('authorization');
    const pairingExchange = url.pathname === '/sync/v1/pair/exchange';
    const pairingOffer = url.pathname === '/sync/v1/pair/offers';
    const isDevice =
      /^Bearer fl2_[A-Za-z0-9-]{6,80}_[A-Za-z0-9-]{6,80}_[A-Za-z0-9_-]{32,160}$/.test(
        authorization ?? '',
      );
    // Offer creation is owner-session + CSRF work performed through an internal
    // service binding. A public OAuth or device bearer must not mint a device.
    if (pairingOffer) {
      return errorJson(403, 'pair_offers_internal_only', 'pair offers require the owner service binding');
    }
    // Sync accepts only the device token form. OAuth tokens and the Worker
    // owner credential are intentionally not valid sync credentials.
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
