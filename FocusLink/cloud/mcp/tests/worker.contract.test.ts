import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { syncAuthoritativeFeed } from '../src/feed-sync';
import { clearOAuthCachesForTest } from '../src/oauth';
import { FakeFocusLinkFeed, ledgerChange, metadataChange } from './helpers/focuslink-feed';
import { createOAuthFixture } from './helpers/oauth';

const CANONICAL = 'https://worker.test';
const CALLER_DEVICE_TOKEN = 'fl2_account1_caller01_0123456789abcdefghijklmnopqrstuvwxyzABCDE';

describe('Worker canonical HTTP contract', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'retires snapshot push with 410 for %s',
    async (method) => {
      const response = await SELF.fetch(`${CANONICAL}/sync/push`, {
        method,
        headers: {
          authorization: 'Bearer obsolete-windows-snapshot-token',
          'content-type': 'application/json',
        },
        body: method === 'GET' ? undefined : '{not-even-json',
      });
      expect(response.status).toBe(410);
      const body = await response.json<Record<string, unknown>>();
      expect(body).toMatchObject({
        code: 'legacy_foxlink_route_retired',
        canonicalBaseUrl: CANONICAL,
        canonicalRoutes: { exchange: '/sync/v2/exchange', mcp: '/mcp' },
      });
    },
  );

  it('retires every secret-in-URL MCP shape with a migration response', async () => {
    const response = await SELF.fetch(`${CANONICAL}/old-access-key/mcp`, {
      method: 'POST',
    });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      code: 'legacy_foxlink_route_retired',
    });
  });

  it('publishes public health without credential or upstream leakage', async () => {
    const response = await SELF.fetch(`${CANONICAL}/healthz`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      ok: true,
      service: 'foxlink-cloud-mcp',
      authority: 'focuslink-cloudflare-v2-change-feed',
    });
    for (const secret of [env.FOCUSLINK_DEVICE_TOKEN, env.OAUTH_RS_CLIENT_SECRET])
      expect(body).not.toContain(secret);
  });

  it('reports ready only when D1, service binding, paired reader, and OAuth RS are configured', async () => {
    const oauth = await createOAuthFixture();
    oauth.install();
    const response = await SELF.fetch(`${CANONICAL}/readyz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      service: 'foxlink-cloud-mcp',
      storage: 'ready',
      configuration: 'ready',
    });
    expect(
      oauth.calls.some((call) => call.url.endsWith('/.well-known/oauth-authorization-server')),
    ).toBe(true);
    expect(oauth.calls.some((call) => call.url.endsWith('/jwks.json'))).toBe(true);
    expect(oauth.calls.some((call) => call.url.endsWith('/introspect'))).toBe(true);
  });

  it('publishes RFC9728 protected-resource metadata for the one canonical resource', async () => {
    const oauth = await createOAuthFixture();
    oauth.install();
    const response = await SELF.fetch(`${CANONICAL}/.well-known/oauth-protected-resource/mcp`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: `${CANONICAL}/mcp`,
      authorization_servers: [env.OAUTH_ISSUER],
      jwks_uri: env.OAUTH_JWKS_URL,
      scopes_supported: ['focuslink:read', 'focuslink:write'],
      bearer_methods_supported: ['header'],
      resource_name: 'FocusLink authoritative MCP',
    });
  });

  it('fails MCP closed without a real OAuth access token', async () => {
    const response = await SELF.fetch(`${CANONICAL}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      '/.well-known/oauth-protected-resource/mcp',
    );
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(response.headers.get('www-authenticate')).toContain('error_description=');
    expect(await response.json()).toMatchObject({
      error: 'invalid_token',
      error_description: expect.any(String),
      _meta: {
        'mcp/www_authenticate': [expect.stringContaining('error="invalid_token"')],
      },
    });
  });

  it('serves the MCP 2026-07-28 stateless discovery contract', async () => {
    const oauth = await createOAuthFixture();
    oauth.install();
    const response = await modernMcpPost('server/discover', {}, oauth.token);
    expect(response.status, await response.clone().text()).toBe(200);
    const message = await jsonRpcMessage(response);
    expect(message).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { supportedVersions: ['2026-07-28'] },
    });
    expect(response.headers.get('mcp-session-id')).toBeNull();
  });

  it('fails a stateless tool request closed when its OAuth token is absent', async () => {
    const oauth = await createOAuthFixture();
    oauth.install();
    await initializeMcp(oauth.token);

    const response = await SELF.fetch(`${CANONICAL}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 22,
        method: 'tools/call',
        params: { name: 'focuslink_get_status', arguments: {} },
      }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('mcp-session-id')).toBeNull();
    expect(response.headers.get('www-authenticate')).toContain(
      '/.well-known/oauth-protected-resource/mcp',
    );
  });

  it('accepts an active audience-bound OAuth token and serves direct Account DO records', async () => {
    const oauth = await createOAuthFixture();
    oauth.install();
    const sessionId = await initializeMcp(oauth.token);
    const payload = await callTool(oauth.token, sessionId, 'foxlink_get_status');

    expect(payload).toMatchObject({
      authority: {
        source: 'focuslink-account-do',
        freshness: { state: 'fresh', staleAfterMs: 900_000 },
      },
      data: {
        live: { state: 'running', session: { id: 'live-session-1' } },
        latestCompletedSession: {
          id: 'session-record-1',
          segments: [{ id: 'segment-record-1', activeElapsedMs: 25_000 }],
          pauses: [{ id: 'pause-record-1', durationMs: 5_000 }],
        },
      },
    });
    const today = await callTool(oauth.token, sessionId, 'focuslink_get_today_summary');
    expect(today).toMatchObject({
      data: {
        live: { state: 'running', session: { id: 'live-session-1' } },
        sessionCount: 1,
        sessions: [{ id: 'session-record-1' }],
      },
    });
    const listed = await callTool(oauth.token, sessionId, 'focuslink_list_focus_records', {
      limit: 1,
    });
    expect(listed).toMatchObject({
      data: {
        count: 1,
        truncated: true,
        live: { state: 'running', session: { id: 'live-session-1' } },
        sessions: [{ id: 'session-record-1' }],
      },
    });
    expect(oauth.calls.filter((call) => call.url.endsWith('/introspect'))).toHaveLength(4);
    expect(oauth.calls.filter((call) => call.url.endsWith('/jwks.json'))).toHaveLength(1);
    expect(oauth.calls.filter((call) => call.url.endsWith('/introspect'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authorization: `Basic ${btoa(`${env.OAUTH_RS_CLIENT_ID}:${env.OAUTH_RS_CLIENT_SECRET}`)}`,
        }),
      ]),
    );
  });

  it('publishes canonical FocusLink tools and aggregates concrete tasks without private fields', async () => {
    const metadata = metadataChange(2, 'session-task-1');
    metadata.payload = {
      ...metadata.payload,
      note: 'private note',
      tags: ['private-tag'],
      taskAssociation: {
        taskId: 'task-chemistry',
        taskTitle: '化学复习',
        privateField: 'hidden',
      },
    };
    const feed = new FakeFocusLinkFeed({
      changes: [ledgerChange(1, 'session-task-1'), metadata],
    });
    await syncAuthoritativeFeed(env, { fetcher: feed.fetch });

    const oauth = await createOAuthFixture();
    oauth.install();
    const sessionId = await initializeMcp(oauth.token);
    const listed = await mcpPost(
      { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      oauth.token,
      sessionId,
    );
    const listedMessage = await jsonRpcMessage(listed);
    const tools =
      (
        listedMessage.result as {
          tools?: Array<{
            name?: string;
            annotations?: Record<string, unknown>;
            _meta?: Record<string, unknown>;
          }>;
        }
      ).tools ?? [];
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'focuslink_get_status',
        'focuslink_get_today_summary',
        'focuslink_list_focus_records',
        'focuslink_get_task_summary',
        'foxlink_get_status',
        'foxlink_get_today_summary',
        'foxlink_list_sessions',
        'foxlink_get_sync_overview',
        'focuslink_list_projects',
        'focuslink_list_tasks',
        'focuslink_get_task',
        'focuslink_create_project',
        'focuslink_update_project',
        'focuslink_delete_project',
        'focuslink_create_task',
        'focuslink_update_task',
        'focuslink_complete_task',
        'focuslink_restore_task',
        'focuslink_delete_task',
        'focuslink_move_task',
      ]),
    );
    for (const tool of tools) {
      const write =
        tool.name?.startsWith('focuslink_') &&
        /^(?:focuslink_(?:create|update|delete)_project|focuslink_(?:create|update|complete|restore|delete|move)_task)$/.test(
          tool.name ?? '',
        );
      expect(tool.annotations).toEqual({
        readOnlyHint: write ? false : true,
        destructiveHint: write && /delete/.test(tool.name ?? '') ? true : false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool._meta).toMatchObject({
        securitySchemes: [
          {
            type: 'oauth2',
            scopes: write ? ['focuslink:read', 'focuslink:write'] : ['focuslink:read'],
          },
        ],
      });
    }

    const summary = await callTool<ToolPayload>(
      oauth.token,
      sessionId,
      'focuslink_get_task_summary',
      {
        from: 1_700_000_000_000,
        to: 1_700_000_100_000,
        limit: 20,
      },
    );
    expect(summary).toMatchObject({
      schemaVersion: 1,
      authority: 'focuslink-account-do',
      freshness: { state: 'fresh', staleAfterMs: 900_000 },
      totals: { focusCount: 1, activeMs: 30_000 },
      tasks: [
        {
          taskId: 'task-chemistry',
          source: 'local',
          title: '化学复习',
          focusCount: 1,
          activeMs: 30_000,
        },
      ],
      recentSessions: [
        {
          sessionId: 'session-task-1',
          task: {
            taskId: 'task-chemistry',
            source: 'local',
            title: '化学复习',
          },
        },
      ],
      changeSeq: 2,
    });
    expect(JSON.stringify(summary)).not.toContain('private note');
    expect(JSON.stringify(summary)).not.toContain('private-tag');
    expect(JSON.stringify(summary)).not.toContain('privateField');
    expect(JSON.stringify(summary)).not.toContain('phone-main');
  });

  it('does not let focuslink:read create device credentials', async () => {
    const oauth = await createOAuthFixture({ scope: 'focuslink:read' });
    oauth.install();
    const sessionId = await initializeMcp(oauth.token);
    const response = await mcpPost(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'focuslink_create_pair_offer',
          arguments: {
            displayName: 'phone',
            scopes: ['sync:read', 'sync:write'],
          },
        },
      },
      oauth.token,
      sessionId,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'pair_offer_requires_oob_admin',
    });
  });

  it('requires focuslink:write for task mutations and returns a redacted confirmation', async () => {
    const readOnly = await createOAuthFixture({ scope: 'focuslink:read' });
    readOnly.install();
    const readOnlySession = await initializeMcp(readOnly.token);
    const denied = await mcpPost(
      {
        jsonrpc: '2.0',
        id: 30,
        method: 'tools/call',
        params: {
          name: 'focuslink_create_task',
          arguments: {
            operationId: 'mcp-create-0001',
            expectedRevision: 7,
            title: '不可写入',
          },
        },
      },
      readOnly.token,
      readOnlySession,
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get('www-authenticate')).toContain(
      'scope="focuslink:read focuslink:write"',
    );

    clearOAuthCachesForTest();
    const writable = await createOAuthFixture({ scope: 'focuslink:read focuslink:write' });
    writable.install();
    const sessionId = await initializeMcp(writable.token);
    const projects = await callTool(writable.token, sessionId, 'focuslink_list_projects');
    expect(projects).toMatchObject({
      authority: 'focuslink-account-do',
      revision: 7,
      projects: [
        expect.objectContaining({ id: 'local-inbox' }),
        expect.objectContaining({ id: 'study' }),
      ],
    });
    const tasks = await callTool(writable.token, sessionId, 'focuslink_list_tasks', {
      includeCompleted: false,
      query: 'MCP',
      limit: 10,
    });
    expect(tasks).toMatchObject({
      authority: 'focuslink-account-do',
      revision: 7,
      tasks: [expect.objectContaining({ id: 'mcp-parent', parentId: null, tags: ['验收'] })],
    });
    const created = await callTool(writable.token, sessionId, 'focuslink_create_task', {
      operationId: 'mcp-create-0001',
      expectedRevision: 7,
      projectId: 'study',
      parentId: 'mcp-parent',
      title: 'MCP 子任务',
      priority: 5,
      dueDate: 1_720_000_100_000,
      tags: ['本周'],
    });
    expect(created).toMatchObject({
      authority: 'focuslink-account-do',
      confirmed: true,
      operationId: 'mcp-create-0001',
      status: 'applied',
      result: { kind: 'create_task', safety: 'updated' },
    });
    expect(JSON.stringify(created)).not.toContain('MCP 子任务');
  });

  it('rejects the non-canonical focuslink:pair OAuth scope', async () => {
    const oauth = await createOAuthFixture({ scope: 'focuslink:pair' });
    oauth.install();
    const response = await mcpPost(
      { jsonrpc: '2.0', id: 4, method: 'initialize', params: {} },
      oauth.token,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
    expect(response.headers.get('www-authenticate')).toContain('scope="focuslink:read"');
    expect(await response.json()).toMatchObject({
      error: 'insufficient_scope',
      _meta: {
        'mcp/www_authenticate': [expect.stringContaining('error="insufficient_scope"')],
      },
    });
  });

  it('keeps pair-offer off the public sync API and rejects OAuth at anonymous claim', async () => {
    const oauth = await createOAuthFixture({ scope: 'focuslink:pair' });
    oauth.install();
    const publicOffer = await SELF.fetch(`${CANONICAL}/sync/v1/pair/offers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${oauth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ displayName: 'phone', scopes: ['sync:read'] }),
    });
    expect(publicOffer.status).toBe(403);

    const claim = await SELF.fetch(`${CANONICAL}/sync/v1/pair/exchange`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${oauth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        nonce: 'n'.repeat(43),
        device: { platform: 'windows', appVersion: '2.0.0' },
      }),
    });
    expect(claim.status).toBe(403);
  });

  it('keeps device exchange and MCP OAuth credentials on separate protection surfaces', async () => {
    const exchange = await SELF.fetch(`${CANONICAL}/sync/v2/exchange`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.OAUTH_RS_CLIENT_SECRET}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(exchange.status).toBe(401);

    const mcp = await SELF.fetch(`${CANONICAL}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.FOCUSLINK_DEVICE_TOKEN}` },
    });
    expect(mcp.status).toBe(401);

    const offer = await SELF.fetch(`${CANONICAL}/sync/v1/pair/offers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.FOCUSLINK_DEVICE_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ displayName: 'spoof', scopes: ['sync:read'] }),
    });
    expect(offer.status).toBe(403);
  });

  it('routes the client canonical v2 live surface through the service binding', async () => {
    const response = await SELF.fetch(`${CANONICAL}/sync/v2/live`, {
      headers: { authorization: `Bearer ${CALLER_DEVICE_TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-focuslink-authority')).toBe('durable-object-v2');
    expect(await response.json()).toEqual({
      protocolVersion: 1,
      revision: 7,
      session: null,
      serverTime: 1_700_000_000_000,
    });
  });

  it('lets a trusted write-capable device create a numeric pair offer', async () => {
    const response = await SELF.fetch(`${CANONICAL}/sync/v1/pair/offers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${CALLER_DEVICE_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        displayName: 'FocusLink 新设备',
        scopes: ['sync:read', 'sync:write', 'live:read', 'live:write'],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: '01234567',
      expiresAt: expect.any(Number),
    });
  });

  it('exposes device-owned request, trusted approval and anonymous claim on the canonical edge', async () => {
    const device = {
      installationId: `android-${'i'.repeat(32)}`,
      displayName: 'FocusLink test tablet',
      platform: 'android',
      deviceKind: 'tablet',
      appVersion: '0.12.104',
    };
    const created = await SELF.fetch(`${CANONICAL}/sync/v1/pair/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device }),
    });
    expect(created.status).toBe(200);
    const request = (await created.json()) as { code: string; requestToken: string };
    expect(request.code).toBe('13572468');
    expect(request.requestToken).toMatch(/^flpr_/);

    const approved = await SELF.fetch(`${CANONICAL}/sync/v1/pair/approve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${CALLER_DEVICE_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ code: request.code }),
    });
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({ status: 'approved' });

    const claimed = await SELF.fetch(`${CANONICAL}/sync/v1/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestToken: request.requestToken, device }),
    });
    expect(claimed.status).toBe(200);
    await expect(claimed.json()).resolves.toMatchObject({
      status: 'authenticated',
      deviceId: 'device-mobile01',
      scopes: expect.arrayContaining(['devices:manage']),
    });
  });

  it('allows only the AS service capability to create a pair offer', async () => {
    const response = await SELF.fetch(`${CANONICAL}/sync/v1/pair/offers`, {
      method: 'POST',
      headers: {
        authorization: `FocusLinkService ${env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL}`,
        'content-type': 'application/json',
        'x-focuslink-service-client': env.FOCUSLINK_PAIR_SERVICE_CLIENT_ID,
        'x-focuslink-service-audience': `${CANONICAL}/sync/v1/pair/offers`,
        'x-focuslink-service-action': 'focuslink.pair.offer.create',
      },
      body: JSON.stringify({
        displayName: 'OOB bootstrap',
        scopes: ['sync:read', 'sync:write'],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      nonce: expect.any(String),
      devicePublicId: 'reader01',
    });
  });

  it('requires exact AS service actions for owner device inventory and revocation', async () => {
    const unauthenticated = await SELF.fetch(`${CANONICAL}/sync/v1/pair/devices`);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('www-authenticate')).toBe(
      'FocusLinkService realm="focuslink-pair-admin"',
    );
    expect(await unauthenticated.json()).toEqual({
      error: 'pair_service_authentication_required',
    });

    const credential = `FocusLinkService ${env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL}`;
    const common = {
      authorization: credential,
      'x-focuslink-service-client': env.FOCUSLINK_PAIR_SERVICE_CLIENT_ID,
    };
    const list = await SELF.fetch(`${CANONICAL}/sync/v1/pair/devices`, {
      headers: {
        ...common,
        'x-focuslink-service-audience': `${CANONICAL}/sync/v1/pair/devices`,
        'x-focuslink-service-action': 'focuslink.pair.devices.read',
      },
    });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      schemaVersion: 1,
      omittedLegacyDeviceCount: 0,
      devices: [{ deviceId: 'device-reader01', revokedAt: null }],
    });

    const revokePath = '/sync/v1/pair/devices/device-reader01/revoke';
    const revoke = await SELF.fetch(`${CANONICAL}${revokePath}`, {
      method: 'POST',
      headers: {
        ...common,
        'x-focuslink-service-audience': `${CANONICAL}${revokePath}`,
        'x-focuslink-service-action': 'focuslink.pair.device.revoke',
      },
    });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ deviceId: 'device-reader01' });

    const wrongAction = await SELF.fetch(`${CANONICAL}${revokePath}`, {
      method: 'POST',
      headers: {
        ...common,
        'x-focuslink-service-audience': `${CANONICAL}${revokePath}`,
        'x-focuslink-service-action': 'focuslink.pair.devices.read',
      },
    });
    expect(wrongAction.status).toBe(403);
    expect(await wrongAction.json()).toEqual({
      error: 'pair_service_authorization_denied',
    });
  });

  it('does not disclose configuration from unknown routes', async () => {
    const response = await SELF.fetch(`${CANONICAL}/not-a-route`);
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain(env.FOCUSLINK_DEVICE_TOKEN);
    expect(body).not.toContain(env.OAUTH_RS_CLIENT_SECRET);
  });
});

interface ToolPayload {
  authority: Record<string, unknown>;
  data: Record<string, unknown> | null;
}

async function initializeMcp(token: string): Promise<string> {
  const response = await mcpPost(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'worker-contract-test', version: '1.0.0' },
      },
    },
    token,
  );
  expect(response.status).toBe(200);
  const message = await jsonRpcMessage(response);
  expect(message).toMatchObject({
    jsonrpc: '2.0',
    id: 1,
    result: { serverInfo: { name: 'poyi-foxlink' } },
  });
  expect(response.headers.get('mcp-session-id')).toBeNull();
  return '';
}

async function callTool<T = ToolPayload>(
  token: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await mcpPost(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    token,
    sessionId,
  );
  expect(response.status).toBe(200);
  const message = await jsonRpcMessage(response);
  expect(message).not.toHaveProperty('error');
  const content = (message.result as { content?: Array<{ type?: string; text?: string }> })
    ?.content;
  expect(content).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.any(String) })]),
  );
  const text = content?.find((part) => part.type === 'text')?.text;
  return JSON.parse(text!) as T;
}

function mcpPost(message: unknown, token: string, sessionId?: string): Promise<Response> {
  return SELF.fetch(`${CANONICAL}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      host: 'worker.test',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(message),
  });
}

function modernMcpPost(
  method: string,
  params: Record<string, unknown>,
  token: string,
): Promise<Response> {
  const name = typeof params.name === 'string' ? params.name : undefined;
  return SELF.fetch(`${CANONICAL}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      host: 'worker.test',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(name ? { 'mcp-name': name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': {
            name: 'worker-contract-test',
            version: '1.0.0',
          },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
}

async function jsonRpcMessage(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  const data = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter(Boolean);
  if (data.length > 0) {
    return JSON.parse(data.at(-1)!) as Record<string, unknown>;
  }
  return JSON.parse(raw) as Record<string, unknown>;
}
