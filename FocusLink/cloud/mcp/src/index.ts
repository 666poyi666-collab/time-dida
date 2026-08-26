/**
 * FocusLink remote MCP on Cloudflare Workers.
 *
 * FocusLink's Cloudflare Durable Object v2 change feed is the sole authority.
 * This Worker owns a read-only paired-device credential, synchronizes that feed
 * on every MCP read, and materializes a restart-safe D1 projection. It never
 * accepts Windows snapshots and never exposes FocusLink live/write routes.
 */
import { createMcpHandler } from 'agents/mcp/server';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { handleCanonicalSync } from './exchange';
import {
  handleBootstrap,
  handleBootstrapAdmin,
  validateBootstrapConfiguration,
  type BootstrapEnv,
} from './bootstrap';
import {
  FEED_AUTHORITY,
  FeedAdapterError,
  probeAuthoritativeFeed,
  syncAuthoritativeFeed,
  validateFeedConfiguration,
} from './feed-sync';
import { feedEntityCounts, getFeedState } from './feed-store';
import type { FeedEnv, FeedStateRow } from './feed-types';
import {
  authenticateMcpRequest,
  oauthChallenge,
  probeOAuthDependencies,
  validateOAuthConfiguration,
  type McpOAuthEnv,
} from './oauth';
import { handleCanonicalPairing } from './pairing';
import { fetchFocusMcpRecords, type FocusMcpRecords } from './focus-records';
import { fetchFocusMcpProjection } from './focus-summary';
import { readProjection, type ProjectionResult } from './projection';

export interface Env extends FeedEnv, McpOAuthEnv, BootstrapEnv {
  FOCUSLINK_FEED_SYNC: DurableObjectNamespace;
  OAUTH_ISSUER: string;
  OAUTH_AUDIENCE: string;
  OAUTH_JWKS_URL: string;
  OAUTH_TOKEN_STATUS_URL: string;
  OAUTH_RS_CLIENT_ID: string;
  OAUTH_RS_CLIENT_SECRET: string;
  FOCUSLINK_PAIR_AUTHORITY_TOKEN: string;
  FOCUSLINK_PAIR_SERVICE_CREDENTIAL: string;
  FOCUSLINK_PAIR_SERVICE_CLIENT_ID: string;
  FOCUSLINK_PAIRING_ENABLED: string;
  FOCUSLINK_MCP_SERVICE_TOKEN: string;
  PAIR_RATE_LIMITER: RateLimit;
  FOCUSLINK_ALLOWED_ORIGINS?: string;
  FOCUSLINK_UPSTREAM_VISIBILITY?: string;
  FOCUSLINK_TIME_ZONE?: string;
}

const PROJECT = {
  name: 'poyi-foxlink',
  version: '0.3.0',
  staleAfterMinutes: 180,
};

interface SyncAttempt {
  ok: boolean;
  complete?: boolean;
  reset?: boolean;
  pages?: number;
  changesApplied?: number;
  errorCode?: string;
  retryable?: boolean;
}

interface ReadContext {
  syncAttempt: SyncAttempt;
  state: FeedStateRow | null;
  projection: ProjectionResult | null;
  metadata: Record<string, unknown>;
}

const OAUTH_READ_SECURITY_SCHEMES = [{ type: 'oauth2', scopes: ['focuslink:read'] }] as const;

const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const OAUTH_READ_TOOL_META = {
  // The core MCP SDK currently serializes extension fields through `_meta`.
  // ChatGPT documents this as the compatibility mirror for securitySchemes.
  securitySchemes: OAUTH_READ_SECURITY_SCHEMES,
} as const;

function text(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function createFoxlinkMcpServer(env: Env): McpServer {
  const server = new McpServer(
    { name: PROJECT.name, version: PROJECT.version },
    {
      instructions:
        'FocusLink 云端 MCP 只暴露经过批准的专注与任务投影。不要请求凭据、设备标识、备注、标签或本地诊断；写入和设备控制不属于此端点。',
    },
  );
  const getStatus = async () => focusStatusResponse(env);
  const getTodaySummary = async () => focusTodaySummaryResponse(env);
  const listFocusRecords = async ({ limit }: { limit: number }) => focusRecordsResponse(env, limit);
  const getTaskSummary = async ({ from, to, limit }: { from: number; to: number; limit: number }) =>
    text(await fetchFocusMcpProjection(env, { from, to, limit }));
  const getSyncOverview = async () => focusSyncOverviewResponse(env);

  server.registerTool(
    'focuslink_get_status',
    {
      description: '读取 FocusLink Account DO 的当前专注状态和最近完成记录。',
      inputSchema: {},
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      _meta: OAUTH_READ_TOOL_META,
    },
    getStatus,
  );
  server.registerTool(
    'foxlink_get_status',
    {
      description: '兼容旧名称：读取 FocusLink 权威 v2 feed 的同步状态和最近完成记录。',
      inputSchema: {},
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      _meta: OAUTH_READ_TOOL_META,
    },
    getStatus,
  );

  server.registerTool(
    'focuslink_get_today_summary',
    {
      description: '按部署时区汇总权威 v2 feed 中今天的完成/中止专注记录。',
      inputSchema: {},
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      _meta: OAUTH_READ_TOOL_META,
    },
    getTodaySummary,
  );
  server.registerTool(
    'foxlink_get_today_summary',
    {
      description: '兼容旧名称：按部署时区汇总今天的 FocusLink 专注记录。',
      inputSchema: {},
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      _meta: OAUTH_READ_TOOL_META,
    },
    getTodaySummary,
  );

  server.registerTool(
    'focuslink_list_focus_records',
    {
      description: '列出 Account DO 权威专注记录，包含每段专注和暂停时间线。',
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(50),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      _meta: OAUTH_READ_TOOL_META,
    },
    listFocusRecords,
  );
  server.registerTool(
    'foxlink_list_sessions',
    {
      description: '兼容旧名称：列出权威专注记录及其时间线。',
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(50),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      _meta: OAUTH_READ_TOOL_META,
    },
    listFocusRecords,
  );

  server.registerTool(
    'focuslink_get_task_summary',
    {
      description: '按具体任务聚合 FocusLink 专注次数、完成/中止次数、有效时长和最近专注时间。',
      inputSchema: {
        from: z.number().int().nonnegative(),
        to: z.number().int().positive(),
        limit: z.number().int().min(1).max(100),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      _meta: OAUTH_READ_TOOL_META,
    },
    getTaskSummary,
  );

  server.registerTool(
    'foxlink_get_sync_overview',
    {
      description: '读取权威 feed checkpoint、epoch、freshness 和实体/tombstone 计数。',
      inputSchema: {},
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      _meta: OAUTH_READ_TOOL_META,
    },
    getSyncOverview,
  );
  return server;
}

async function focusStatusResponse(env: Env) {
  const records = await fetchRecentFocusRecords(env, 1);
  return text({
    authority: recordsAuthority(records),
    data: {
      live: records.live,
      latestCompletedSession: records.records[0] ?? null,
    },
  });
}

async function focusTodaySummaryResponse(env: Env) {
  const timeZone = validTimeZone(env.FOCUSLINK_TIME_ZONE) ?? 'Asia/Shanghai';
  const records = await fetchRecentFocusRecords(env, 100, 48 * 60 * 60 * 1_000);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const target = formatter.format(new Date());
  const sessions = records.records.filter(
    (session) => formatter.format(new Date(session.startedAt)) === target,
  );
  return text({
    authority: recordsAuthority(records),
    data: {
      timeZone,
      live: records.live,
      sessionCount: sessions.length,
      finishedCount: sessions.filter((session) => session.status === 'finished').length,
      abortedCount: sessions.filter((session) => session.status === 'aborted').length,
      activeElapsedMs: sessions.reduce((total, session) => total + session.activeElapsedMs, 0),
      pausedElapsedMs: sessions.reduce((total, session) => total + session.pausedElapsedMs, 0),
      wallElapsedMs: sessions.reduce((total, session) => total + session.wallElapsedMs, 0),
      sessions,
    },
  });
}

async function focusRecordsResponse(env: Env, limit: number) {
  const records = await fetchRecentFocusRecords(env, limit);
  return text({
    authority: recordsAuthority(records),
    data: {
      count: records.records.length,
      truncated: records.records.length === limit,
      live: records.live,
      sessions: records.records,
    },
  });
}

async function fetchRecentFocusRecords(
  env: Env,
  limit: number,
  lookbackMs = 30 * 24 * 60 * 60 * 1_000,
): Promise<FocusMcpRecords> {
  const now = Date.now();
  return fetchFocusMcpRecords(env, { from: now - lookbackMs, to: now, limit });
}

function recordsAuthority(records: FocusMcpRecords) {
  return {
    source: 'focuslink-account-do',
    generatedAt: records.generatedAt,
    lastVerifiedAt: records.lastVerifiedAt,
    freshness: records.freshness,
    range: records.range,
  };
}

async function focusSyncOverviewResponse(env: Env) {
  const context = await readContext(env);
  let counts: Array<{ entity_type: string; deleted: number; count: number }> = [];
  try {
    counts = await feedEntityCounts(env.DB, env.FOCUSLINK_ACCOUNT_KEY);
  } catch {
    // readContext already reports unavailable projection state.
  }
  return text({ authority: context.metadata, projectionCounts: counts });
}

export class FocuslinkFeedSync implements DurableObject {
  private inFlight: Promise<SyncAttempt> | null = null;

  constructor(
    readonly state: DurableObjectState,
    readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/sync' || request.method !== 'POST') {
      return json({ error: 'not_found' }, 404);
    }
    if (!this.inFlight) {
      this.inFlight = runFeedSync(this.env).finally(() => {
        this.inFlight = null;
      });
    }
    return json(await this.inFlight);
  }
}

async function runFeedSync(env: Env): Promise<SyncAttempt> {
  try {
    const result = await syncAuthoritativeFeed(env);
    return {
      ok: true,
      complete: result.complete,
      reset: result.reset,
      pages: result.pages,
      changesApplied: result.changesApplied,
    };
  } catch (error) {
    const adapterError =
      error instanceof FeedAdapterError ? error : new FeedAdapterError('feed_projection_failed');
    return {
      ok: false,
      errorCode: adapterError.code,
      retryable: adapterError.retryable,
    };
  }
}

async function requestFeedSync(env: Env): Promise<SyncAttempt> {
  try {
    const id = env.FOCUSLINK_FEED_SYNC.idFromName(env.FOCUSLINK_ACCOUNT_KEY || 'unconfigured');
    const response = await env.FOCUSLINK_FEED_SYNC.get(id).fetch('https://feed.internal/sync', {
      method: 'POST',
    });
    if (!response.ok)
      return {
        ok: false,
        errorCode: 'feed_sync_do_unavailable',
        retryable: true,
      };
    const value = (await response.json()) as unknown;
    return isSyncAttempt(value)
      ? value
      : {
          ok: false,
          errorCode: 'feed_sync_do_protocol_error',
          retryable: true,
        };
  } catch {
    return {
      ok: false,
      errorCode: 'feed_sync_do_unavailable',
      retryable: true,
    };
  }
}

async function readContext(env: Env): Promise<ReadContext> {
  const syncAttempt = await requestFeedSync(env);
  let state: FeedStateRow | null = null;
  let projection: ProjectionResult | null = null;
  try {
    [state, projection] = await Promise.all([
      getFeedState(env.DB, env.FOCUSLINK_ACCOUNT_KEY),
      readProjection(env.DB, env.FOCUSLINK_ACCOUNT_KEY),
    ]);
  } catch {
    return {
      syncAttempt,
      state: null,
      projection: null,
      metadata: authorityMetadata(syncAttempt, null, null),
    };
  }
  return {
    syncAttempt,
    state,
    projection,
    metadata: authorityMetadata(syncAttempt, state, projection),
  };
}

function authorityMetadata(
  attempt: SyncAttempt,
  state: FeedStateRow | null,
  projection: ProjectionResult | null,
): Record<string, unknown> {
  const now = Date.now();
  const lastCompleteAt = state?.last_synced_at ?? null;
  const lastCompleteAgeSeconds = lastCompleteAt
    ? Math.max(0, Math.round((now - Date.parse(lastCompleteAt)) / 1_000))
    : null;
  const lagChanges = state
    ? Math.max(0, state.observed_head_change_seq - state.last_change_seq)
    : null;
  const caughtUp = Boolean(
    attempt.ok &&
    attempt.complete &&
    state?.status === 'synced' &&
    lagChanges === 0 &&
    projection?.invalidEntities === 0,
  );
  let freshness: 'current' | 'degraded' | 'stale' | 'incomplete' | 'never_synced';
  if (caughtUp) freshness = 'current';
  else if (!state || !projection) freshness = 'never_synced';
  else if (!lastCompleteAt) freshness = 'incomplete';
  else if (
    lastCompleteAgeSeconds !== null &&
    lastCompleteAgeSeconds > PROJECT.staleAfterMinutes * 60
  )
    freshness = 'stale';
  else freshness = 'degraded';

  return {
    source: FEED_AUTHORITY,
    upstreamContract: {
      epoch: 'GET /sync/v2/status over service binding',
      feed: 'POST /sync/v2/exchange over service binding',
      protocolVersion: 2,
      access: 'paired-device sync:read',
      writable: false,
    },
    servingMode: caughtUp ? 'sync_on_read_projection' : 'cached_projection',
    freshness,
    caughtUp,
    degraded: !caughtUp,
    projectionCompleteAtLastSync: Boolean(lastCompleteAt),
    lastCompleteAt,
    lastCompleteAgeSeconds,
    lastPageAt: state?.last_page_at ?? null,
    upstreamServerTime: state?.last_server_time ?? null,
    epoch: state
      ? {
          syncEpoch: state.sync_epoch,
          cursorEpoch: state.cursor_epoch,
          accountGeneration: state.account_generation,
        }
      : null,
    lag: state
      ? {
          changes: lagChanges,
          projectedChangeSeq: state.last_change_seq,
          observedHeadChangeSeq: state.observed_head_change_seq,
          observedAt: state.head_observed_at,
        }
      : null,
    checkpoint: state
      ? {
          lastChangeSeq: state.last_change_seq,
          observedHeadChangeSeq: state.observed_head_change_seq,
          syncEpoch: state.sync_epoch,
          cursorEpoch: state.cursor_epoch,
          accountGeneration: state.account_generation,
          status: state.status,
          resetCount: state.reset_count,
        }
      : null,
    syncAttempt: attempt,
    projection: projection
      ? {
          entityCount: projection.entityCount,
          sessionCount: projection.sessions.length,
          tombstones: projection.tombstones,
          invalidEntities: projection.invalidEntities,
          opaqueEncryptedEntities: projection.opaqueEncryptedEntities,
        }
      : null,
  };
}

export const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return json({
        ok: true,
        service: 'foxlink-cloud-mcp',
        authority: FEED_AUTHORITY,
      });
    }

    if (url.pathname === '/readyz') {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return readiness(env);
    }

    if (
      url.pathname === '/sync/v1/pair/exchange' ||
      url.pathname === '/sync/v1/pair/requests' ||
      url.pathname === '/sync/v1/pair/approve' ||
      url.pathname === '/sync/v1/pair/claim'
    ) {
      return handleCanonicalPairing(request, env, false);
    }
    if (url.pathname === '/sync/v1/pair/offers') {
      if (request.method === 'OPTIONS') return handleCanonicalPairing(request, env, false);
      const deviceOffer = isDevicePairOfferRequest(request);
      if (!deviceOffer) {
        const denial = await authorizePairService(request, env);
        if (denial) return denial;
      }
      return handleCanonicalPairing(request, env, !deviceOffer);
    }
    if (
      url.pathname === '/sync/v1/pair/devices' ||
      /^\/sync\/v1\/pair\/devices\/device-[A-Za-z0-9-]{6,194}\/revoke$/.test(url.pathname)
    ) {
      const list = url.pathname === '/sync/v1/pair/devices';
      const denial = await authorizePairAdminService(
        request,
        env,
        list ? 'GET' : 'POST',
        list ? 'focuslink.pair.devices.read' : 'focuslink.pair.device.revoke',
      );
      if (denial) return denial;
      return handleCanonicalPairing(request, env, true);
    }

    if (url.pathname === '/account/v1/device/bootstrap') {
      return handleBootstrap(request, env);
    }

    if (
      url.pathname === '/sync/v1/bootstrap/flows' ||
      /^\/sync\/v1\/bootstrap\/flows\/flow_[A-Za-z0-9_-]{32,160}\/(?:approve|deny)$/.test(
        url.pathname,
      )
    ) {
      const list = url.pathname === '/sync/v1/bootstrap/flows';
      const action =
        url.pathname === '/sync/v1/bootstrap/flows'
          ? 'focuslink.bootstrap.flows.read'
          : url.pathname.endsWith('/approve')
            ? 'focuslink.bootstrap.flow.approve'
            : 'focuslink.bootstrap.flow.deny';
      const denial = await authorizeBootstrapAdminService(
        request,
        env,
        list ? 'GET' : 'POST',
        action,
      );
      if (denial) return denial;
      return handleBootstrapAdmin(request, env, action);
    }

    if (url.pathname.startsWith('/sync/v1/') || url.pathname.startsWith('/sync/v2/')) {
      return handleCanonicalSync(request, env);
    }

    if (
      url.pathname === '/.well-known/oauth-protected-resource/mcp' ||
      url.pathname === '/.well-known/oauth-protected-resource'
    ) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return protectedResourceMetadata(env);
    }

    if (
      url.pathname === '/sync/push' ||
      url.pathname.startsWith('/sync/push/') ||
      /^\/[^/]+\/mcp(?:\/.*)?$/.test(url.pathname)
    ) {
      return legacyGone(url);
    }

    if (url.pathname === '/mcp') {
      const metadataUrl = `${url.origin}/.well-known/oauth-protected-resource/mcp`;
      const authentication = await authenticateMcpRequest(request, env, metadataUrl);
      if (!authentication.ok) {
        return (
          (await mcpToolOAuthChallenge(request, authentication.response)) ?? authentication.response
        );
      }
      const requiredScopes = await requiredMcpScopes(request);
      if (requiredScopes.includes('oob:pair-admin')) {
        return json({ error: 'pair_offer_requires_oob_admin' }, 403);
      }
      const grantedScopes = new Set(authentication.claims.scope.split(/\s+/).filter(Boolean));
      if (requiredScopes.some((scope) => !grantedScopes.has(scope))) {
        return oauthChallenge(metadataUrl, 403, 'insufficient_scope', requiredScopes.join(' '));
      }
      const handler = createMcpHandler(() => createFoxlinkMcpServer(env), {
        route: '/mcp',
        legacy: 'stateless',
        allowedHostnames: [
          new URL(env.OAUTH_AUDIENCE).hostname,
          'focuslink.pyzzgk.dpdns.org',
          'worker.test',
          'localhost',
          '127.0.0.1',
        ],
      });
      return handler(request, env, ctx);
    }

    return json({ error: 'not_found' }, 404);
  },
};

export default worker;

async function readiness(env: Env): Promise<Response> {
  const failures: string[] = [];
  let feedConfigured = true;
  let oauthConfigured = true;
  let focusProjectionConfigured = true;
  try {
    validateFeedConfiguration(env);
  } catch {
    feedConfigured = false;
    failures.push('feed_configuration');
  }
  try {
    validateOAuthConfiguration(env);
  } catch {
    oauthConfigured = false;
    failures.push('oauth_resource_server');
  }
  if (!env.FOCUSLINK_UPSTREAM) failures.push('upstream_service_binding');
  if (
    !/^[A-Za-z0-9._~-]{32,4096}$/.test(env.FOCUSLINK_MCP_SERVICE_TOKEN ?? '') ||
    env.FOCUSLINK_MCP_SERVICE_TOKEN === env.FOCUSLINK_DEVICE_TOKEN ||
    env.FOCUSLINK_MCP_SERVICE_TOKEN === env.FOCUSLINK_PAIR_AUTHORITY_TOKEN ||
    env.FOCUSLINK_MCP_SERVICE_TOKEN === env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL ||
    env.FOCUSLINK_MCP_SERVICE_TOKEN === env.OAUTH_RS_CLIENT_SECRET
  ) {
    failures.push('focus_mcp_service_credential');
    focusProjectionConfigured = false;
  }
  if (!env.PAIR_RATE_LIMITER) failures.push('pair_rate_limiter');
  if (
    !/^fla_[A-Za-z0-9_-]{43,160}$/.test(env.FOCUSLINK_PAIR_AUTHORITY_TOKEN ?? '') ||
    env.FOCUSLINK_PAIR_AUTHORITY_TOKEN === env.FOCUSLINK_DEVICE_TOKEN ||
    env.FOCUSLINK_PAIR_AUTHORITY_TOKEN === env.OAUTH_RS_CLIENT_SECRET ||
    env.FOCUSLINK_PAIR_AUTHORITY_TOKEN === env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL
  )
    failures.push('pair_authority_credential');
  if (
    !/^fls_[A-Za-z0-9_-]{43,160}$/.test(env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL ?? '') ||
    !/^[A-Za-z0-9._~-]{3,200}$/.test(env.FOCUSLINK_PAIR_SERVICE_CLIENT_ID ?? '') ||
    env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL === env.OAUTH_RS_CLIENT_SECRET ||
    env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL === env.FOCUSLINK_DEVICE_TOKEN ||
    env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL === env.FOCUSLINK_PAIR_AUTHORITY_TOKEN
  )
    failures.push('pair_service_credential');
  if (env.FOCUSLINK_PAIRING_ENABLED !== 'true') {
    failures.push('pairing_disabled_pending_e2e');
  }
  {
    const bootstrap = validateBootstrapConfiguration(env);
    if (!bootstrap.enabled) failures.push('bootstrap_disabled');
    if (!bootstrap.upstream) failures.push('bootstrap_upstream_binding');
    if (!bootstrap.identityAuthority) failures.push('bootstrap_identity_authority');
    if (!bootstrap.ownerSubject) failures.push('bootstrap_owner_subject');
    if (!bootstrap.pepper) failures.push('bootstrap_pepper');
  }
  try {
    await env.DB.prepare('SELECT account_key FROM feed_state LIMIT 1').all();
    await env.DB.prepare(
      'SELECT observed_head_change_seq, head_observed_at FROM feed_state LIMIT 1',
    ).all();
    await env.DB.prepare(
      'SELECT account_key, entity_type, change_seq FROM feed_entities LIMIT 1',
    ).all();
  } catch {
    failures.push('d1_projection_schema');
  }
  const dependencyChecks: Array<Promise<{ name: string; ok: boolean }>> = [];
  if (feedConfigured && env.FOCUSLINK_UPSTREAM) {
    dependencyChecks.push(
      probeAuthoritativeFeed(env)
        .then(() => ({ name: 'authoritative_upstream', ok: true }))
        .catch(() => ({ name: 'authoritative_upstream', ok: false })),
    );
  }
  if (oauthConfigured) {
    dependencyChecks.push(
      probeOAuthDependencies(env)
        .then(() => ({ name: 'oauth_dependencies', ok: true }))
        .catch((error) => ({
          name: safeOAuthProbeFailure(error),
          ok: false,
        })),
    );
  }
  if (focusProjectionConfigured && env.FOCUSLINK_UPSTREAM) {
    const now = Date.now();
    dependencyChecks.push(
      fetchFocusMcpProjection(env, { from: now - 1, to: now, limit: 1 })
        .then(() => ({ name: 'focus_mcp_projection', ok: true }))
        .catch(() => ({ name: 'focus_mcp_projection', ok: false })),
    );
  }
  for (const result of await Promise.all(dependencyChecks)) {
    if (!result.ok) failures.push(result.name);
  }
  return json(
    {
      ok: failures.length === 0,
      service: 'foxlink-cloud-mcp',
      authority: FEED_AUTHORITY,
      storage: failures.includes('d1_projection_schema') ? 'unavailable' : 'ready',
      configuration: failures.length === 0 ? 'ready' : 'incomplete',
      ...(failures.length === 0 ? {} : { failures }),
    },
    failures.length === 0 ? 200 : 503,
  );
}

function safeOAuthProbeFailure(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^oauth_(?:metadata|jwks|introspection)_(?:unavailable|invalid)$/.test(code)
    ? code
    : 'oauth_dependencies';
}

async function protectedResourceMetadata(env: Env): Promise<Response> {
  let oauth;
  try {
    oauth = validateOAuthConfiguration(env);
  } catch {
    return json(
      {
        error: 'oauth_not_configured',
        ready: false,
        required: ['issuer', 'audience', 'jwks', 'introspection', 'revocation'],
      },
      503,
    );
  }
  try {
    await probeOAuthDependencies(env);
  } catch {
    return json({ error: 'oauth_dependency_unavailable', ready: false }, 503);
  }
  return json({
    resource: oauth.audience,
    authorization_servers: [oauth.issuer],
    jwks_uri: oauth.jwksUrl,
    scopes_supported: ['focuslink:read'],
    bearer_methods_supported: ['header'],
    resource_name: 'FocusLink authoritative read-only MCP',
  });
}

function legacyGone(url: URL): Response {
  return json(
    {
      error: 'gone',
      code: 'legacy_foxlink_route_retired',
      canonicalBaseUrl: url.origin,
      canonicalRoutes: {
        exchange: '/sync/v2/exchange',
        status: '/sync/v2/status',
        tasks: '/sync/v2/tasks',
        live: '/sync/v2/live',
        mcp: '/mcp',
        oauthResourceMetadata: '/.well-known/oauth-protected-resource/mcp',
      },
      migration:
        'Windows snapshot push and secret-in-URL MCP were retired. Use device credentials only with exchange and OAuth access tokens only with MCP.',
    },
    410,
  );
}

function validTimeZone(value: string | undefined): string | null {
  if (!value) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value;
  } catch {
    return null;
  }
}

function isSyncAttempt(value: unknown): value is SyncAttempt {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { ok?: unknown }).ok === 'boolean' &&
    ((value as { ok: boolean }).ok ||
      typeof (value as { errorCode?: unknown }).errorCode === 'string'),
  );
}

async function requiredMcpScopes(request: Request): Promise<string[]> {
  if (request.method !== 'POST') return [];
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > 128 * 1024) return ['focuslink:read'];
  let value: unknown;
  try {
    const raw = await request.clone().arrayBuffer();
    if (raw.byteLength > 128 * 1024) return ['focuslink:read'];
    value = JSON.parse(new TextDecoder().decode(raw)) as unknown;
  } catch {
    return ['focuslink:read'];
  }
  const messages = Array.isArray(value) ? value : [value];
  const required = new Set<string>();
  for (const message of messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      required.add('focuslink:read');
      continue;
    }
    const rpc = message as Record<string, unknown>;
    if (rpc.method === 'tools/call') {
      const params = rpc.params;
      const name =
        params && typeof params === 'object' && !Array.isArray(params)
          ? (params as Record<string, unknown>).name
          : null;
      required.add(name === 'focuslink_create_pair_offer' ? 'oob:pair-admin' : 'focuslink:read');
    } else if (
      rpc.method === 'resources/read' ||
      rpc.method === 'resources/list' ||
      rpc.method === 'resources/templates/list'
    ) {
      required.add('focuslink:read');
    } else if (
      rpc.method !== 'initialize' &&
      rpc.method !== 'ping' &&
      rpc.method !== 'tools/list' &&
      typeof rpc.method === 'string' &&
      !rpc.method.startsWith('notifications/')
    ) {
      required.add('focuslink:read');
    }
  }
  return [...required];
}

async function mcpToolOAuthChallenge(
  request: Request,
  authenticationResponse: Response,
): Promise<Response | null> {
  const challenge = authenticationResponse.headers.get('www-authenticate');
  const sessionId = request.headers.get('mcp-session-id');
  if (
    !challenge ||
    !sessionId ||
    !/^[A-Za-z0-9._~-]{1,256}$/.test(sessionId) ||
    request.method !== 'POST'
  )
    return null;

  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > 128 * 1024) return null;
  let rpc: unknown;
  try {
    const raw = await request.clone().arrayBuffer();
    if (raw.byteLength > 128 * 1024) return null;
    rpc = JSON.parse(new TextDecoder().decode(raw)) as unknown;
  } catch {
    return null;
  }
  if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc)) return null;
  const message = rpc as Record<string, unknown>;
  if (
    message.jsonrpc !== '2.0' ||
    message.method !== 'tools/call' ||
    (typeof message.id !== 'string' && typeof message.id !== 'number')
  ) {
    return null;
  }

  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [
          {
            type: 'text',
            text: 'Authentication required. Reconnect the FocusLink OAuth account.',
          },
        ],
        _meta: { 'mcp/www_authenticate': [challenge] },
        isError: true,
      },
    }),
    {
      status: 200,
      headers: securityHeaders({ 'mcp-session-id': sessionId }),
    },
  );
}

function methodNotAllowed(allow: string): Response {
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: securityHeaders({ allow }),
  });
}

async function authorizePairService(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== 'POST') return methodNotAllowed('POST, OPTIONS');
  if (!env.PAIR_RATE_LIMITER) return json({ error: 'pair_rate_limiter_not_configured' }, 503);
  const client = request.headers.get('cf-connecting-ip') ?? 'unknown-client';
  try {
    const outcome = await env.PAIR_RATE_LIMITER.limit({
      key: `offer:${client}`,
    });
    if (!outcome.success) {
      const response = json({ error: 'pair_rate_limited' }, 429);
      response.headers.set('retry-after', '60');
      return response;
    }
  } catch {
    return json({ error: 'pair_rate_limiter_unavailable' }, 503);
  }
  const authorization = /^FocusLinkService (fls_[A-Za-z0-9_-]{43,160})$/.exec(
    request.headers.get('authorization') ?? '',
  );
  const expectedAudience = `${new URL(env.OAUTH_AUDIENCE).origin}/sync/v1/pair/offers`;
  if (
    !authorization ||
    !constantTimeEqual(authorization[1], env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL ?? '') ||
    request.headers.get('x-focuslink-service-client') !== env.FOCUSLINK_PAIR_SERVICE_CLIENT_ID ||
    request.headers.get('x-focuslink-service-audience') !== expectedAudience ||
    request.headers.get('x-focuslink-service-action') !== 'focuslink.pair.offer.create'
  ) {
    return json({ error: 'pair_service_required' }, 403);
  }
  return null;
}

async function authorizePairAdminService(
  request: Request,
  env: Env,
  method: 'GET' | 'POST',
  action: 'focuslink.pair.devices.read' | 'focuslink.pair.device.revoke',
): Promise<Response | null> {
  if (request.method !== method) return methodNotAllowed(method);
  if (!env.PAIR_RATE_LIMITER) return json({ error: 'pair_rate_limiter_not_configured' }, 503);
  const client = request.headers.get('cf-connecting-ip') ?? 'unknown-client';
  try {
    const outcome = await env.PAIR_RATE_LIMITER.limit({
      key: `admin:${action}:${client}`,
    });
    if (!outcome.success) {
      const response = json({ error: 'pair_rate_limited' }, 429);
      response.headers.set('retry-after', '60');
      return response;
    }
  } catch {
    return json({ error: 'pair_rate_limiter_unavailable' }, 503);
  }
  const authorization = /^FocusLinkService (fls_[A-Za-z0-9_-]{43,160})$/.exec(
    request.headers.get('authorization') ?? '',
  );
  const expectedAudience = `${new URL(env.OAUTH_AUDIENCE).origin}${new URL(request.url).pathname}`;
  if (!authorization) {
    const response = json({ error: 'pair_service_authentication_required' }, 401);
    response.headers.set('www-authenticate', 'FocusLinkService realm="focuslink-pair-admin"');
    return response;
  }
  if (
    !constantTimeEqual(authorization[1], env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL ?? '') ||
    request.headers.get('x-focuslink-service-client') !== env.FOCUSLINK_PAIR_SERVICE_CLIENT_ID ||
    request.headers.get('x-focuslink-service-audience') !== expectedAudience ||
    request.headers.get('x-focuslink-service-action') !== action
  ) {
    return json({ error: 'pair_service_authorization_denied' }, 403);
  }
  return null;
}

async function authorizeBootstrapAdminService(
  request: Request,
  env: Env,
  method: 'GET' | 'POST',
  action:
    | 'focuslink.bootstrap.flows.read'
    | 'focuslink.bootstrap.flow.approve'
    | 'focuslink.bootstrap.flow.deny',
): Promise<Response | null> {
  if (request.method !== method) return methodNotAllowed(method);
  if (!env.PAIR_RATE_LIMITER) return json({ error: 'pair_rate_limiter_not_configured' }, 503);
  const client = request.headers.get('cf-connecting-ip') ?? 'unknown-client';
  try {
    const outcome = await env.PAIR_RATE_LIMITER.limit({
      key: `bootstrap-admin:${action}:${client}`,
    });
    if (!outcome.success) {
      const response = json({ error: 'pair_rate_limited' }, 429);
      response.headers.set('retry-after', '60');
      return response;
    }
  } catch {
    return json({ error: 'pair_rate_limiter_unavailable' }, 503);
  }
  const authorization = /^FocusLinkService (fls_[A-Za-z0-9_-]{43,160})$/.exec(
    request.headers.get('authorization') ?? '',
  );
  const expectedAudience = `${new URL(env.OAUTH_AUDIENCE).origin}${new URL(request.url).pathname}`;
  if (!authorization) {
    const response = json({ error: 'pair_service_authentication_required' }, 401);
    response.headers.set('www-authenticate', 'FocusLinkService realm="focuslink-bootstrap-admin"');
    return response;
  }
  if (
    !constantTimeEqual(authorization[1], env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL ?? '') ||
    request.headers.get('x-focuslink-service-client') !== env.FOCUSLINK_PAIR_SERVICE_CLIENT_ID ||
    request.headers.get('x-focuslink-service-audience') !== expectedAudience ||
    request.headers.get('x-focuslink-service-action') !== action
  ) {
    return json({ error: 'pair_service_authorization_denied' }, 403);
  }
  return null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function isDevicePairOfferRequest(request: Request): boolean {
  return /^Bearer fl2_[A-Za-z0-9-]{6,80}_[A-Za-z0-9-]{6,80}_[A-Za-z0-9_-]{32,160}$/.test(
    request.headers.get('authorization') ?? '',
  );
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: securityHeaders(),
  });
}

function securityHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extra,
  });
}
