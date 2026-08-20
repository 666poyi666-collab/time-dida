import { z } from "zod";

import { BoundedBodyError, readBoundedBody } from "./bounded-body";
import { focuslinkUpstreamUrl } from "./upstream";

const EPOCH_MS = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const DURATION_MS = EPOCH_MS;
const TASK_SOURCE = z.enum(["local", "ticktick"]);
const NULLABLE_TITLE = z.union([z.string().max(1_000), z.null()]);
const NULLABLE_EPOCH_MS = z.union([EPOCH_MS, z.null()]);
const taskSchema = z
  .object({ taskId: z.string().min(1).max(256), source: TASK_SOURCE, title: NULLABLE_TITLE })
  .strict();

const segmentSchema = z
  .object({
    id: z.string().min(1).max(256),
    startedAt: EPOCH_MS,
    endedAt: NULLABLE_EPOCH_MS,
    activeElapsedMs: DURATION_MS,
    title: NULLABLE_TITLE,
    task: z.union([taskSchema, z.null()]),
  })
  .strict();
const pauseSchema = z
  .object({
    id: z.string().min(1).max(256),
    segmentId: z.union([z.string().min(1).max(256), z.null()]),
    startedAt: EPOCH_MS,
    endedAt: NULLABLE_EPOCH_MS,
    durationMs: DURATION_MS,
  })
  .strict();
const recordSchema = z
  .object({
    id: z.string().min(1).max(256),
    startedAt: EPOCH_MS,
    endedAt: EPOCH_MS,
    status: z.enum(["finished", "aborted"]),
    activeElapsedMs: DURATION_MS,
    pausedElapsedMs: DURATION_MS,
    wallElapsedMs: DURATION_MS,
    title: NULLABLE_TITLE,
    task: z.union([taskSchema, z.null()]),
    segments: z.array(segmentSchema).max(100),
    pauses: z.array(pauseSchema).max(100),
    corrected: z.boolean(),
    revision: z
      .object({
        ledger: z.number().int().positive(),
        metadata: z.union([z.number().int().positive(), z.null()]),
        correction: z.union([z.number().int().positive(), z.null()]),
      })
      .strict(),
  })
  .strict()
  .refine((record) => record.endedAt >= record.startedAt, {
    message: "record time range is invalid",
  });

const liveSchema = z
  .object({
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    serverTime: EPOCH_MS,
    state: z.enum(["idle", "running", "paused"]),
    session: z.union([
      z
        .object({
          id: z.string().min(1).max(256),
          title: NULLABLE_TITLE,
          state: z.enum(["running", "paused"]),
          startedAt: EPOCH_MS,
          activeElapsedMs: DURATION_MS,
          pauseElapsedMs: DURATION_MS,
          wallElapsedMs: DURATION_MS,
          currentPauseStartedAt: NULLABLE_EPOCH_MS,
          task: z.union([taskSchema, z.null()]),
          segments: z
            .array(
              z
                .object({ id: z.string().min(1).max(256), startedAt: EPOCH_MS, endedAt: NULLABLE_EPOCH_MS })
                .strict(),
            )
            .max(100),
          pauses: z
            .array(
              z
                .object({
                  id: z.string().min(1).max(256),
                  segmentId: z.string().min(1).max(256),
                  startedAt: EPOCH_MS,
                  endedAt: NULLABLE_EPOCH_MS,
                })
                .strict(),
            )
            .max(100),
          updatedAt: EPOCH_MS,
        })
        .strict(),
      z.null(),
    ]),
  })
  .strict();

const freshnessSchema = z
  .object({
    state: z.enum(["fresh", "stale", "unknown"]),
    ageMs: z.union([DURATION_MS, z.null()]),
    staleAfterMs: z.literal(900_000),
  })
  .strict();

export const focusMcpRecordsSchema = z
  .object({
    schemaVersion: z.literal(1),
    authority: z.literal("focuslink-account-do"),
    generatedAt: EPOCH_MS,
    lastVerifiedAt: NULLABLE_EPOCH_MS,
    freshness: freshnessSchema,
    range: z.object({ from: EPOCH_MS, to: EPOCH_MS }).strict(),
    records: z.array(recordSchema).max(100),
    live: liveSchema,
  })
  .strict()
  .refine((value) => value.range.to > value.range.from, {
    message: "records range is invalid",
  });

export type FocusMcpRecords = z.infer<typeof focusMcpRecordsSchema>;

export interface FocusRecordsEnv {
  FOCUSLINK_UPSTREAM: Fetcher;
  FOCUSLINK_MCP_SERVICE_TOKEN: string;
}

export interface FocusRecordsRequest {
  from: number;
  to: number;
  limit: number;
}

const MAX_RESPONSE_BYTES = 1_100_000;
const SERVICE_TOKEN = /^[A-Za-z0-9._~-]{32,4096}$/;

export async function fetchFocusMcpRecords(
  env: FocusRecordsEnv,
  input: FocusRecordsRequest,
): Promise<FocusMcpRecords> {
  validateRequest(input);
  if (!SERVICE_TOKEN.test(env.FOCUSLINK_MCP_SERVICE_TOKEN ?? "")) {
    throw new Error("focuslink_mcp_service_not_configured");
  }
  if (!env.FOCUSLINK_UPSTREAM) throw new Error("focuslink_authority_binding_missing");

  const url = focuslinkUpstreamUrl("/internal/mcp/v1/focus/records");
  url.searchParams.set("from", String(input.from));
  url.searchParams.set("to", String(input.to));
  url.searchParams.set("limit", String(input.limit));
  let response: Response;
  try {
    response = await env.FOCUSLINK_UPSTREAM.fetch(
      new Request(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-focuslink-mcp-service": env.FOCUSLINK_MCP_SERVICE_TOKEN,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      }),
    );
  } catch {
    throw new Error("focuslink_authority_unavailable");
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("focuslink_authority_redirect_rejected");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 401
        ? "focuslink_authority_service_rejected"
        : "focuslink_authority_unavailable",
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(response.body, response.headers, MAX_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof BoundedBodyError && error.reason === "too_large") {
      throw new Error("focuslink_authority_response_too_large");
    }
    throw new Error("focuslink_authority_unavailable");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("focuslink_authority_protocol_error");
  }
  const parsed = focusMcpRecordsSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.range.from !== input.from ||
    parsed.data.range.to !== input.to ||
    parsed.data.records.length > input.limit
  ) {
    throw new Error("focuslink_authority_protocol_error");
  }
  return parsed.data;
}

function validateRequest(input: FocusRecordsRequest): void {
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
    throw new Error("invalid_focus_records_request");
  }
}
