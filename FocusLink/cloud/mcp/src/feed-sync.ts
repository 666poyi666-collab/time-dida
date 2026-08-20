import {
  FEED_ENTITY_TYPES,
  SYNC_PROTOCOL_VERSION,
  type FeedChange,
  type FeedEnv,
  type FeedEpoch,
  type FeedEpochResponse,
  type FeedStateRow,
  type FeedSyncRequest,
  type FeedSyncResponse,
  type FeedSyncResult,
} from "./feed-types";
import {
  applyFeedPage,
  getFeedState,
  markFeedError,
  prepareFeedState,
} from "./feed-store";
import { BoundedBodyError, readBoundedBody } from "./bounded-body";
import { focuslinkUpstreamUrl } from "./upstream";

export const FEED_AUTHORITY = "focuslink-cloudflare-v2-change-feed" as const;
export const FEED_PULL_LIMIT = 500;
export const FEED_MAX_PAGES_PER_SYNC = 100;

const MAX_UPSTREAM_RESPONSE_BYTES = 1_100_000;
const UPSTREAM_TIMEOUT_MS = 15_000;
const DEVICE_TOKEN_PATTERN =
  /^fl2_([A-Za-z0-9-]{6,80})_([A-Za-z0-9-]{6,80})_([A-Za-z0-9_-]{32,160})$/;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface FeedSyncOptions {
  fetcher?: Fetcher;
  now?: () => Date;
  maxPages?: number;
  pullLimit?: number;
}

export class FeedAdapterError extends Error {
  constructor(
    readonly code: string,
    message = code,
    readonly retryable = true,
  ) {
    super(message);
  }
}

class EpochDriftError extends FeedAdapterError {
  constructor(code: string) {
    super(code, code, true);
  }
}

interface FeedConfig {
  accountKey: string;
  deviceId: string;
  deviceToken: string;
}

export function validateFeedConfiguration(env: FeedEnv): FeedConfig {
  if (!env.FOCUSLINK_UPSTREAM) {
    throw new FeedAdapterError(
      "upstream_service_binding_missing",
      "FocusLink service binding is required",
      false,
    );
  }
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(env.FOCUSLINK_ACCOUNT_KEY ?? "")) {
    throw new FeedAdapterError("invalid_account_key", "invalid account key", false);
  }
  if (
    typeof env.FOCUSLINK_DEVICE_ID !== "string" ||
    env.FOCUSLINK_DEVICE_ID.length < 1 ||
    env.FOCUSLINK_DEVICE_ID.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(env.FOCUSLINK_DEVICE_ID)
  ) {
    throw new FeedAdapterError("invalid_device_id", "invalid device id", false);
  }
  const tokenMatch = DEVICE_TOKEN_PATTERN.exec(env.FOCUSLINK_DEVICE_TOKEN ?? "");
  if (
    !tokenMatch ||
    env.FOCUSLINK_DEVICE_ID !== `device-${tokenMatch[2]}` ||
    env.FOCUSLINK_DEVICE_TOKEN === env.FOCUSLINK_PAIR_AUTHORITY_TOKEN ||
    env.FOCUSLINK_DEVICE_TOKEN === env.OAUTH_RS_CLIENT_SECRET
  ) {
    throw new FeedAdapterError(
      "invalid_paired_device_credential",
      "paired device credential does not match device id",
      false,
    );
  }
  return {
    accountKey: env.FOCUSLINK_ACCOUNT_KEY,
    deviceId: env.FOCUSLINK_DEVICE_ID,
    deviceToken: env.FOCUSLINK_DEVICE_TOKEN,
  };
}

export async function syncAuthoritativeFeed(
  env: FeedEnv,
  options: FeedSyncOptions = {},
): Promise<FeedSyncResult> {
  const config = validateFeedConfiguration(env);
  const fetcher = options.fetcher ?? upstreamFetcher(env);
  const now = options.now ?? (() => new Date());
  const maxPages = boundedInteger(options.maxPages ?? FEED_MAX_PAGES_PER_SYNC, 1, 1_000);
  const pullLimit = boundedInteger(options.pullLimit ?? FEED_PULL_LIMIT, 1, FEED_PULL_LIMIT);
  let reset = false;

  for (let epochAttempt = 0; epochAttempt < 2; epochAttempt += 1) {
    try {
      const result = await syncOneEpoch(env.DB, config, {
        fetcher,
        now,
        maxPages,
        pullLimit,
      });
      return { ...result, reset: reset || result.reset };
    } catch (error) {
      if (error instanceof EpochDriftError && epochAttempt === 0) {
        reset = true;
        continue;
      }
      const normalized = normalizeAdapterError(error);
      await safeMarkError(env.DB, config.accountKey, normalized.code, now().toISOString());
      throw normalized;
    }
  }
  throw new FeedAdapterError("epoch_retry_exhausted");
}

export async function probeAuthoritativeFeed(
  env: FeedEnv,
  fetcher?: Fetcher,
): Promise<FeedEpochResponse> {
  const config = validateFeedConfiguration(env);
  return getRemoteEpoch(config, fetcher ?? upstreamFetcher(env));
}

async function syncOneEpoch(
  db: D1Database,
  config: FeedConfig,
  options: Required<Pick<FeedSyncOptions, "fetcher" | "now" | "maxPages" | "pullLimit">>,
): Promise<FeedSyncResult> {
  const epochResponse = await getRemoteEpoch(config, options.fetcher);
  const existing = await getFeedState(db, config.accountKey);
  if (
    existing &&
    existing.device_id === config.deviceId &&
    existing.sync_epoch === epochResponse.syncEpoch &&
    existing.cursor_epoch === epochResponse.cursorEpoch &&
    existing.account_generation === epochResponse.accountGeneration &&
    epochResponse.changeSeq < existing.last_change_seq
  ) {
    throw new FeedAdapterError(
      "upstream_head_regressed",
      "authoritative change sequence regressed without an epoch reset",
      false,
    );
  }
  const prepared = await prepareFeedState(
    db,
    config.accountKey,
    config.deviceId,
    epochResponse,
    options.now().toISOString(),
  );
  let state = prepared.state;

  // A fresh adapter and every epoch reset MUST start at seq 0. changeSeq from the epoch
  // handshake is diagnostic tail information and is never a bootstrap checkpoint.
  if (prepared.reset && (state.cursor !== null || state.last_change_seq !== 0)) {
    throw new FeedAdapterError("unsafe_tail_bootstrap_rejected", "fresh feed did not start at seq 0", false);
  }

  let pages = 0;
  let changesApplied = 0;
  while (pages < options.maxPages) {
    const response = await postSyncPage(config, epochResponse, state.cursor, options, pages);
    assertSameEpoch(epochResponse, response);
    validatePageProgress(state, response, epochResponse);
    pages += 1;
    changesApplied += response.changes.length;
    state = await applyFeedPage(db, {
      accountKey: config.accountKey,
      deviceId: config.deviceId,
      epoch: epochResponse,
      previous: state,
      changes: response.changes,
      nextCursor: response.nextCursor,
      serverTime: response.serverTime,
      complete: !response.hasMore,
      now: options.now().toISOString(),
    });
    if (!response.hasMore) {
      return { complete: true, reset: prepared.reset, pages, changesApplied, state };
    }
  }
  throw new FeedAdapterError("page_budget_exhausted", "authoritative feed still has more pages");
}

async function getRemoteEpoch(config: FeedConfig, fetcher: Fetcher): Promise<FeedEpochResponse> {
  const value = await upstreamJson(
    focuslinkUpstreamUrl("/sync/v2/status"),
    config,
    fetcher,
    { method: "GET" },
  );
  if (!isEpochResponse(value)) throw new FeedAdapterError("upstream_epoch_protocol_error");
  return value;
}

async function postSyncPage(
  config: FeedConfig,
  epoch: FeedEpoch,
  cursor: string | null,
  options: Required<Pick<FeedSyncOptions, "fetcher" | "now" | "maxPages" | "pullLimit">>,
  pageNumber: number,
): Promise<FeedSyncResponse> {
  const request: FeedSyncRequest = {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    deviceId: config.deviceId,
    ...epoch,
    cursor,
    mutations: [],
    pullLimit: options.pullLimit,
  };
  const value = await upstreamJson(
    focuslinkUpstreamUrl("/sync/v2/exchange"),
    config,
    options.fetcher,
    {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(request),
    },
    pageNumber,
  );
  if (!isSyncResponse(value, options.pullLimit)) {
    throw new FeedAdapterError("upstream_sync_protocol_error");
  }
  return value;
}

async function upstreamJson(
  url: URL,
  config: FeedConfig,
  fetcher: Fetcher,
  init: RequestInit,
  _pageNumber = 0,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.deviceToken}`,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new FeedAdapterError("upstream_unreachable");
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new FeedAdapterError("upstream_redirect_rejected", "upstream redirect rejected", false);
  }
  let raw: Uint8Array;
  try {
    raw = await readBoundedBody(response.body, response.headers, MAX_UPSTREAM_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof BoundedBodyError && error.reason === "too_large") {
      throw new FeedAdapterError(
        "upstream_response_too_large",
        "upstream response is too large",
        false,
      );
    }
    throw new FeedAdapterError("upstream_response_unreadable");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new FeedAdapterError("upstream_invalid_json");
  }
  if (response.ok) return value;
  const remoteCode = remoteErrorCode(value);
  if (
    response.status === 409 &&
    ["account_generation_changed", "sync_epoch_changed", "cursor_epoch_changed"].includes(
      remoteCode,
    )
  ) {
    throw new EpochDriftError(remoteCode);
  }
  if (response.status === 401 || response.status === 403) {
    throw new FeedAdapterError("upstream_read_credential_rejected", "read credential rejected", false);
  }
  if (response.status === 404) {
    throw new FeedAdapterError("upstream_v2_contract_missing", "v2 feed contract is missing", false);
  }
  throw new FeedAdapterError(
    response.status >= 500 ? "upstream_temporary_failure" : `upstream_${remoteCode}`,
    "upstream rejected feed request",
    response.status >= 500 || response.status === 429,
  );
}

function validatePageProgress(
  state: FeedStateRow,
  response: FeedSyncResponse,
  observedEpoch: FeedEpochResponse,
): void {
  if (response.hasMore && response.changes.length === 0) {
    throw new FeedAdapterError("upstream_empty_page_with_more");
  }
  if (
    response.nextCursor === state.cursor &&
    (response.hasMore || response.changes.length > 0)
  ) {
    throw new FeedAdapterError("upstream_cursor_not_advancing");
  }
  let sequence = state.last_change_seq;
  for (const change of response.changes) {
    if (change.changeSeq !== sequence + 1) {
      throw new FeedAdapterError("upstream_change_sequence_not_increasing");
    }
    sequence = change.changeSeq;
  }
  if (!response.hasMore && sequence < observedEpoch.changeSeq) {
    throw new FeedAdapterError(
      "upstream_incomplete_tail",
      "upstream ended pagination before the observed authoritative head",
    );
  }
}

function assertSameEpoch(expected: FeedEpoch, actual: FeedEpoch): void {
  if (actual.accountGeneration !== expected.accountGeneration) {
    throw new EpochDriftError("account_generation_changed");
  }
  if (actual.syncEpoch !== expected.syncEpoch) throw new EpochDriftError("sync_epoch_changed");
  if (actual.cursorEpoch !== expected.cursorEpoch) {
    throw new EpochDriftError("cursor_epoch_changed");
  }
}

function isEpochResponse(value: unknown): value is FeedEpochResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "protocolVersion",
    "syncEpoch",
    "cursorEpoch",
    "accountGeneration",
    "changeSeq",
    "serverTime",
  ])) return false;
  return (
    value.protocolVersion === SYNC_PROTOCOL_VERSION &&
    isEpoch(value) &&
    isSafeNonNegativeInteger(value.changeSeq) &&
    isSafeNonNegativeInteger(value.serverTime)
  );
}

function isSyncResponse(value: unknown, pullLimit: number): value is FeedSyncResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "protocolVersion",
    "syncEpoch",
    "cursorEpoch",
    "accountGeneration",
    "acks",
    "changes",
    "nextCursor",
    "hasMore",
    "serverTime",
  ])) return false;
  if (
    value.protocolVersion !== SYNC_PROTOCOL_VERSION ||
    !isEpoch(value) ||
    !Array.isArray(value.acks) ||
    value.acks.length !== 0 ||
    !Array.isArray(value.changes) ||
    value.changes.length > pullLimit ||
    typeof value.nextCursor !== "string" ||
    value.nextCursor.length < 1 ||
    value.nextCursor.length > 2_048 ||
    typeof value.hasMore !== "boolean" ||
    !isSafeNonNegativeInteger(value.serverTime)
  ) return false;
  return value.changes.every(isFeedChange);
}

function isEpoch(value: Record<string, unknown>): value is Record<string, unknown> & FeedEpoch {
  return (
    typeof value.syncEpoch === "string" &&
    value.syncEpoch.length >= 1 &&
    value.syncEpoch.length <= 128 &&
    typeof value.cursorEpoch === "string" &&
    value.cursorEpoch.length >= 1 &&
    value.cursorEpoch.length <= 128 &&
    Number.isSafeInteger(value.accountGeneration) &&
    Number(value.accountGeneration) >= 1
  );
}

function isFeedChange(value: unknown): value is FeedChange {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "changeSeq",
    "entityType",
    "entityId",
    "revision",
    "fingerprint",
    "deleted",
    "payload",
    "sourceDeviceId",
  ])) return false;
  return (
    isSafeNonNegativeInteger(value.changeSeq) &&
    Number(value.changeSeq) >= 1 &&
    FEED_ENTITY_TYPES.includes(value.entityType as (typeof FEED_ENTITY_TYPES)[number]) &&
    isRemoteId(value.entityId) &&
    isSafeNonNegativeInteger(value.revision) &&
    Number(value.revision) >= 1 &&
    typeof value.fingerprint === "string" &&
    /^[a-f0-9]{32,128}$/i.test(value.fingerprint) &&
    typeof value.deleted === "boolean" &&
    (value.payload === null || isRecord(value.payload)) &&
    (value.deleted ? value.payload === null : value.payload !== null) &&
    isRemoteId(value.sourceDeviceId)
  );
}

function isRemoteId(value: unknown): value is string {
  return (
    typeof value === "string" &&
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
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function remoteErrorCode(value: unknown): string {
  if (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    /^[a-z0-9_]{1,80}$/.test(value.error.code)
  ) return value.error.code;
  return "request_rejected";
}

function normalizeAdapterError(error: unknown): FeedAdapterError {
  if (error instanceof FeedAdapterError) return error;
  if (error instanceof Error && /^[a-z0-9_]{1,120}$/.test(error.message)) {
    return new FeedAdapterError(error.message);
  }
  return new FeedAdapterError("feed_projection_failed");
}

async function safeMarkError(
  db: D1Database,
  accountKey: string,
  code: string,
  now: string,
): Promise<void> {
  try {
    const state = await getFeedState(db, accountKey);
    if (state) await markFeedError(db, accountKey, code, now);
  } catch {
    // The original adapter error is more useful than a secondary status-write failure.
  }
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new FeedAdapterError("invalid_sync_limit", "invalid sync limit", false);
  }
  return value;
}

function upstreamFetcher(env: FeedEnv): Fetcher {
  const binding = env.FOCUSLINK_UPSTREAM;
  if (!binding) {
    throw new FeedAdapterError(
      "upstream_service_binding_missing",
      "FocusLink service binding is required",
      false,
    );
  }
  return (input, init) => binding.fetch(new Request(input, init));
}
