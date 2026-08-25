export const SYNC_PROTOCOL_VERSION = 2 as const;

export const FEED_ENTITY_TYPES = [
  'focus_ledger_v2',
  'focus_metadata_v2',
  'focus_ledger_correction_v2',
  'focus_guard_rule_v1',
  'focus_guard_state_v1',
  'focus_guard_completion_v1',
  'focus_guard_config_v1',
] as const;

export type FeedEntityType = (typeof FEED_ENTITY_TYPES)[number];

export interface FeedEpoch {
  syncEpoch: string;
  cursorEpoch: string;
  accountGeneration: number;
}

export interface FeedEpochResponse extends FeedEpoch {
  protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  changeSeq: number;
  serverTime: number;
}

export interface FeedChange {
  changeSeq: number;
  entityType: FeedEntityType;
  entityId: string;
  revision: number;
  fingerprint: string;
  deleted: boolean;
  payload: Record<string, unknown> | null;
  sourceDeviceId: string;
}

export interface FeedSyncRequest extends FeedEpoch {
  protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  deviceId: string;
  cursor: string | null;
  mutations: [];
  pullLimit: number;
}

export interface FeedSyncResponse extends FeedEpoch {
  protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  acks: [];
  changes: FeedChange[];
  nextCursor: string;
  hasMore: boolean;
  serverTime: number;
}

export type FeedStatus = 'never_synced' | 'syncing' | 'synced' | 'degraded';

export interface FeedStateRow {
  account_key: string;
  device_id: string;
  cursor: string | null;
  sync_epoch: string | null;
  cursor_epoch: string | null;
  account_generation: number | null;
  last_change_seq: number;
  observed_head_change_seq: number;
  head_observed_at: string | null;
  last_server_time: number | null;
  status: FeedStatus;
  last_sync_started_at: string | null;
  last_page_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  reset_count: number;
}

export interface FeedEntityRow {
  account_key: string;
  entity_type: FeedEntityType;
  entity_id: string;
  revision: number;
  fingerprint: string;
  deleted: number;
  payload_json: string | null;
  source_device_id: string;
  change_seq: number;
  applied_at: string;
}

export interface FeedSyncResult {
  complete: boolean;
  reset: boolean;
  pages: number;
  changesApplied: number;
  state: FeedStateRow;
}

export interface FeedEnv {
  DB: D1Database;
  FOCUSLINK_UPSTREAM: Fetcher;
  FOCUSLINK_ACCOUNT_KEY: string;
  FOCUSLINK_DEVICE_ID: string;
  FOCUSLINK_DEVICE_TOKEN: string;
  FOCUSLINK_PAIR_AUTHORITY_TOKEN?: string;
  OAUTH_RS_CLIENT_SECRET?: string;
}
