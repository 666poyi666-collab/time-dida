import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { APP_VERSION } from '@shared/version';
import type { TimerSnapshot, TimerState } from '@shared/types';
import {
  getDb,
  getMeta,
  getSession,
  listPauses,
  listSegments,
  listSessions,
  setMeta,
} from '../db/index.js';
import { logger } from '../logger.js';
import type { FocusTimerController } from '../timer/focusTimerController.js';

const HOST = '127.0.0.1';
const PORT = 18770;
const REVISION_KEY = 'foxlink.mcp.controlRevision';
const MAX_BODY_BYTES = 64 * 1024;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface FoxlinkBusinessApi {
  close(): Promise<void>;
  port: number;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Json,
  ) {
    super(message);
  }
}

function tokenPath(): string {
  if (process.env['FOXLINK_BUSINESS_API_TOKEN_FILE'])
    return process.env['FOXLINK_BUSINESS_API_TOKEN_FILE'];
  return path.join(
    process.env['ProgramData'] ?? path.join(os.homedir(), 'AppData', 'Local'),
    'Poyi',
    'FoxlinkMcp',
    'business-api-token',
  );
}

function readToken(): string | null {
  const fromEnvironment = process.env['FOXLINK_BUSINESS_API_TOKEN']?.trim();
  if (fromEnvironment) return fromEnvironment;
  try {
    const value = fs.readFileSync(tokenPath(), 'utf8').trim();
    return value.length >= 32 ? value : null;
  } catch {
    return null;
  }
}

function equalSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function send(response: http.ServerResponse, status: number, value: Json): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

async function body(request: http.IncomingMessage): Promise<Record<string, Json>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_BODY_BYTES)
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    chunks.push(value);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('object required');
    return parsed as Record<string, Json>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object');
  }
}

function requiredString(value: Json | undefined, name: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new ApiError(400, 'INVALID_ARGUMENT', `${name} is required`);
  return value;
}

function requiredNumber(value: Json | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new ApiError(400, 'INVALID_ARGUMENT', `${name} must be a number`);
  return value;
}

function canonicalJson(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
    .join(',')}}`;
}

function snapshotValue(snapshot: TimerSnapshot, revision: number): Json {
  return { ...snapshot, revision } as unknown as Json;
}

function sessionDetail(id: string): Json {
  const session = getSession(id);
  if (!session) throw new ApiError(404, 'NOT_FOUND', 'Session was not found');
  return { session, segments: listSegments(id), pauses: listPauses(id) } as unknown as Json;
}

export function startFoxlinkBusinessApi(timer: FocusTimerController): FoxlinkBusinessApi | null {
  const token = readToken();
  if (!token) {
    logger.warn('foxlinkMcp', 'business API disabled because its credential file is missing', {
      tokenPath: tokenPath(),
    });
    return null;
  }
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS foxlink_api_idempotency (
      idempotency_key TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_foxlink_api_idempotency_created
      ON foxlink_api_idempotency(created_at);
  `);
  let revision = Math.max(0, Number(getMeta(REVISION_KEY) ?? 0));
  let material = '';
  const observe = (value: TimerSnapshot) => {
    const next = `${value.state}:${value.sessionId ?? ''}`;
    if (material && material !== next) {
      revision += 1;
      setMeta(REVISION_KEY, String(revision));
    }
    material = next;
  };
  observe(timer.getSnapshot());
  const unsubscribe = timer.onSnapshot(observe);
  let controlQueue = Promise.resolve();

  const runControl = async (operation: string, payload: Record<string, Json>): Promise<Json> => {
    const requestId = requiredString(payload['requestId'], 'requestId');
    const commandId = requiredString(payload['commandId'], 'commandId');
    const expectedRevision = requiredNumber(payload['expectedRevision'], 'expectedRevision');
    const expectedState = requiredString(payload['expectedState'], 'expectedState') as TimerState;
    const expiresAt = requiredNumber(payload['expiresAt'], 'expiresAt');
    const requestHash = crypto
      .createHash('sha256')
      .update(canonicalJson({ operation, payload } as unknown as Json))
      .digest('hex');
    const key = `command:${commandId}`;
    const existing = getDb()
      .prepare(
        'SELECT request_hash,response_json FROM foxlink_api_idempotency WHERE idempotency_key=?',
      )
      .get(key) as { request_hash: string; response_json: string } | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'commandId was reused with a different payload',
        );
      return JSON.parse(existing.response_json) as Json;
    }
    const requestKey = `request:${requestId}`;
    const existingRequest = getDb()
      .prepare(
        'SELECT request_hash,response_json FROM foxlink_api_idempotency WHERE idempotency_key=?',
      )
      .get(requestKey) as { request_hash: string; response_json: string } | undefined;
    if (existingRequest) {
      if (existingRequest.request_hash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'requestId was reused with a different payload',
        );
      return JSON.parse(existingRequest.response_json) as Json;
    }
    if (expiresAt <= Date.now()) throw new ApiError(409, 'COMMAND_EXPIRED', 'Command has expired');
    const current = timer.getSnapshot();
    if (revision !== expectedRevision)
      throw new ApiError(409, 'REVISION_CONFLICT', 'Control revision changed', {
        expectedRevision,
        actualRevision: revision,
      });
    if (current.state !== expectedState)
      throw new ApiError(409, 'STATE_CONFLICT', 'Timer state changed', {
        expectedState,
        actualState: current.state,
      });
    let result: TimerSnapshot;
    if (operation === 'start') {
      if (current.state !== 'idle')
        throw new ApiError(409, 'STATE_CONFLICT', 'Start requires idle state');
      result = await timer.toggle();
    } else if (operation === 'pause') result = await timer.pause();
    else if (operation === 'resume') result = await timer.resume();
    else result = await timer.stop();
    observe(result);
    const response = {
      status: 'applied',
      requestId,
      commandId,
      snapshot: snapshotValue(result, revision),
    } as unknown as Json;
    const responseJson = JSON.stringify(response);
    getDb().transaction(() => {
      const statement = getDb().prepare(
        'INSERT INTO foxlink_api_idempotency(idempotency_key,operation,request_hash,response_json,created_at) VALUES (?,?,?,?,?)',
      );
      statement.run(key, operation, requestHash, responseJson, Date.now());
      statement.run(requestKey, operation, requestHash, responseJson, Date.now());
      getDb()
        .prepare('DELETE FROM foxlink_api_idempotency WHERE created_at < ?')
        .run(Date.now() - 30 * 86400000);
    })();
    return response;
  };

  const enqueueControl = <T>(task: () => Promise<T>): Promise<T> => {
    const pending = controlQueue.then(task, task);
    controlQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
      if (request.method === 'GET' && url.pathname === '/v1/health')
        return send(response, 200, { status: 'ok', product: 'Foxlink', version: APP_VERSION });
      const authorization = request.headers.authorization ?? '';
      if (!authorization.startsWith('Bearer ') || !equalSecret(authorization.slice(7), token))
        throw new ApiError(401, 'AUTH_FAILED', 'Authentication failed');
      if (request.method === 'GET' && url.pathname === '/v1/status')
        return send(response, 200, {
          product: 'Foxlink',
          version: APP_VERSION,
          apiVersion: '1',
          timer: snapshotValue(timer.getSnapshot(), revision),
        });
      if (request.method === 'GET' && url.pathname === '/v1/capabilities')
        return send(response, 200, {
          protocolVersion: '1',
          tools: [
            'status',
            'current-session',
            'list-sessions',
            'get-session',
            'today-summary',
            'start-focus',
            'pause-focus',
            'resume-focus',
            'stop-focus',
          ],
          resources: [
            'foxlink://sessions/recent',
            'foxlink://sessions/{id}',
            'foxlink://analytics/today',
          ],
          writes: {
            requestId: true,
            commandId: true,
            revision: true,
            expectedState: true,
            expiresAt: true,
          },
        });
      if (request.method === 'GET' && url.pathname === '/v1/focus/current')
        return send(response, 200, snapshotValue(timer.getSnapshot(), revision));
      if (request.method === 'GET' && url.pathname === '/v1/sessions') {
        const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
        const limit = Number.isFinite(requestedLimit)
          ? Math.max(1, Math.min(200, Math.trunc(requestedLimit)))
          : 50;
        const items = listSessions(limit);
        return send(response, 200, { items, count: items.length } as unknown as Json);
      }
      if (request.method === 'GET' && url.pathname.startsWith('/v1/sessions/'))
        return send(
          response,
          200,
          sessionDetail(decodeURIComponent(url.pathname.slice('/v1/sessions/'.length))),
        );
      if (request.method === 'GET' && url.pathname === '/v1/analytics/today') {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const items = listSessions(1000).filter((item) => item.startedAt >= start);
        return send(response, 200, {
          date: new Date(start).toISOString().slice(0, 10),
          sessionCount: items.length,
          activeElapsedMs: items.reduce((sum, item) => sum + item.activeElapsedMs, 0),
          pauseElapsedMs: items.reduce((sum, item) => sum + item.pauseElapsedMs, 0),
        });
      }
      const match =
        request.method === 'POST'
          ? /^\/v1\/focus\/(start|pause|resume|stop)$/.exec(url.pathname)
          : null;
      if (match) {
        const payload = await body(request);
        return send(response, 200, await enqueueControl(() => runControl(match[1], payload)));
      }
      throw new ApiError(404, 'NOT_FOUND', 'Route was not found');
    } catch (error) {
      if (error instanceof ApiError)
        send(response, error.status, {
          error: { code: error.code, message: error.message, details: error.details ?? null },
        });
      else {
        logger.error('foxlinkMcp', 'business API request failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        send(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
      }
    }
  });
  server.listen(PORT, HOST, () =>
    logger.info('foxlinkMcp', 'business API listening', { host: HOST, port: PORT }),
  );
  return {
    port: PORT,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          unsubscribe();
          resolve();
        }),
      ),
  };
}
