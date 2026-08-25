import { z } from 'zod';

import { BoundedBodyError, readBoundedBody } from './bounded-body';
import { focuslinkUpstreamUrl } from './upstream';

const EPOCH_MS = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const DURATION_MS = EPOCH_MS;
const TASK_SOURCE = z.enum(['local', 'ticktick']);
const NULLABLE_TASK_SOURCE = z.union([TASK_SOURCE, z.null()]);
const NULLABLE_EPOCH_MS = z.union([EPOCH_MS, z.null()]);
const NULLABLE_TITLE = z.union([z.string().max(1_000), z.null()]);

const taskAssociationSchema = z
  .object({
    taskId: z.string().min(1).max(256),
    source: TASK_SOURCE,
    title: NULLABLE_TITLE,
  })
  .strict();

const segmentTaskSchema = z
  .object({
    taskId: z.union([z.string().min(1).max(256), z.null()]),
    source: NULLABLE_TASK_SOURCE,
    title: z.string().min(1).max(1_000),
    activeMs: DURATION_MS,
  })
  .strict();

const taskAggregateSchema = z
  .object({
    taskId: z.union([z.string().min(1).max(256), z.null()]),
    source: NULLABLE_TASK_SOURCE,
    title: z.string().min(1).max(1_000),
    focusCount: z.number().int().min(1).max(1_000_000_000),
    activeMs: DURATION_MS,
    lastFocusedAt: EPOCH_MS,
  })
  .strict();

const sessionSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    startedAt: EPOCH_MS,
    endedAt: EPOCH_MS,
    status: z.enum(['finished', 'aborted']),
    activeMs: DURATION_MS,
    pausedMs: DURATION_MS,
    wallMs: DURATION_MS,
    title: NULLABLE_TITLE,
    task: z.union([taskAssociationSchema, z.null()]),
    segmentTasks: z.array(segmentTaskSchema).max(100),
  })
  .strict()
  .refine((session) => session.endedAt >= session.startedAt, {
    message: 'session time range is invalid',
  });

const freshnessSchema = z
  .object({
    state: z.enum(['fresh', 'stale', 'unknown']),
    ageMs: z.union([DURATION_MS, z.null()]),
    staleAfterMs: z.literal(900_000),
  })
  .strict()
  .refine(
    (freshness) =>
      freshness.state === 'unknown' ||
      (freshness.ageMs !== null && Number.isSafeInteger(freshness.ageMs)),
    { message: 'verified freshness requires ageMs' },
  );

export const focusMcpProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    authority: z.literal('focuslink-account-do'),
    generatedAt: EPOCH_MS,
    lastVerifiedAt: NULLABLE_EPOCH_MS,
    dataThrough: NULLABLE_EPOCH_MS,
    freshness: freshnessSchema,
    range: z
      .object({
        from: EPOCH_MS,
        to: EPOCH_MS,
      })
      .strict(),
    totals: z
      .object({
        focusCount: z.number().int().min(0).max(1_000_000_000),
        activeMs: DURATION_MS,
        pausedMs: DURATION_MS,
        wallMs: DURATION_MS,
      })
      .strict(),
    tasks: z.array(taskAggregateSchema).max(1_000),
    recentSessions: z.array(sessionSchema).max(100),
    changeSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .refine((projection) => projection.range.to > projection.range.from, {
    message: 'projection range is invalid',
  })
  .refine(
    (projection) => projection.freshness.state === 'unknown' || projection.lastVerifiedAt !== null,
    { message: 'verified freshness requires lastVerifiedAt' },
  );

export type FocusMcpProjection = z.infer<typeof focusMcpProjectionSchema>;

export interface FocusSummaryEnv {
  FOCUSLINK_UPSTREAM: Fetcher;
  FOCUSLINK_MCP_SERVICE_TOKEN: string;
}

export interface FocusSummaryRequest {
  from: number;
  to: number;
  limit: number;
}

const MAX_RESPONSE_BYTES = 1_100_000;
const SERVICE_TOKEN = /^[A-Za-z0-9._~-]{32,4096}$/;

export async function fetchFocusMcpProjection(
  env: FocusSummaryEnv,
  input: FocusSummaryRequest,
): Promise<FocusMcpProjection> {
  validateRequest(input);
  if (!SERVICE_TOKEN.test(env.FOCUSLINK_MCP_SERVICE_TOKEN ?? '')) {
    throw new Error('focuslink_mcp_service_not_configured');
  }
  if (!env.FOCUSLINK_UPSTREAM) {
    throw new Error('focuslink_authority_binding_missing');
  }

  const url = focuslinkUpstreamUrl('/internal/mcp/v1/focus/summary');
  url.searchParams.set('from', String(input.from));
  url.searchParams.set('to', String(input.to));
  url.searchParams.set('limit', String(input.limit));
  let response: Response;
  try {
    response = await env.FOCUSLINK_UPSTREAM.fetch(
      new Request(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-focuslink-mcp-service': env.FOCUSLINK_MCP_SERVICE_TOKEN,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      }),
    );
  } catch {
    throw new Error('focuslink_authority_unavailable');
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error('focuslink_authority_redirect_rejected');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 401
        ? 'focuslink_authority_service_rejected'
        : 'focuslink_authority_unavailable',
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(response.body, response.headers, MAX_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof BoundedBodyError && error.reason === 'too_large') {
      throw new Error('focuslink_authority_response_too_large');
    }
    throw new Error('focuslink_authority_unavailable');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error('focuslink_authority_protocol_error');
  }
  const parsed = focusMcpProjectionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('focuslink_authority_protocol_error');
  }
  if (
    parsed.data.range.from !== input.from ||
    parsed.data.range.to !== input.to ||
    parsed.data.recentSessions.length > input.limit
  ) {
    throw new Error('focuslink_authority_protocol_error');
  }
  return parsed.data;
}

function validateRequest(input: FocusSummaryRequest): void {
  if (
    !Number.isSafeInteger(input.from) ||
    input.from < 0 ||
    !Number.isSafeInteger(input.to) ||
    input.to <= input.from ||
    input.to - input.from > 10 * 366 * 24 * 60 * 60 * 1_000 ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100
  ) {
    throw new Error('invalid_focus_summary_request');
  }
}
