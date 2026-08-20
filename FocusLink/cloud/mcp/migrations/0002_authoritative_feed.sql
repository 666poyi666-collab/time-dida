-- Retire the Windows /sync/push snapshot mirror and replace it with a
-- materialized projection of the authoritative FocusLink Sync v2 feed.
CREATE TABLE IF NOT EXISTS feed_state (
  account_key TEXT PRIMARY KEY NOT NULL
    CHECK (length(account_key) BETWEEN 1 AND 80),
  device_id TEXT NOT NULL
    CHECK (length(device_id) BETWEEN 1 AND 200),
  cursor TEXT
    CHECK (cursor IS NULL OR length(cursor) BETWEEN 1 AND 2048),
  sync_epoch TEXT
    CHECK (sync_epoch IS NULL OR length(sync_epoch) BETWEEN 1 AND 128),
  cursor_epoch TEXT
    CHECK (cursor_epoch IS NULL OR length(cursor_epoch) BETWEEN 1 AND 128),
  account_generation INTEGER
    CHECK (
      account_generation IS NULL OR
      (typeof(account_generation) = 'integer' AND account_generation >= 1)
    ),
  last_change_seq INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(last_change_seq) = 'integer' AND last_change_seq >= 0),
  observed_head_change_seq INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(observed_head_change_seq) = 'integer' AND observed_head_change_seq >= 0),
  head_observed_at TEXT,
  last_server_time INTEGER
    CHECK (
      last_server_time IS NULL OR
      (typeof(last_server_time) = 'integer' AND last_server_time >= 0)
    ),
  status TEXT NOT NULL DEFAULT 'never_synced'
    CHECK (status IN ('never_synced', 'syncing', 'synced', 'degraded')),
  last_sync_started_at TEXT,
  last_page_at TEXT,
  last_synced_at TEXT,
  last_error TEXT
    CHECK (last_error IS NULL OR length(last_error) <= 1024),
  last_error_at TEXT,
  reset_count INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(reset_count) = 'integer' AND reset_count >= 0),
  CHECK (
    (sync_epoch IS NULL AND cursor_epoch IS NULL AND account_generation IS NULL) OR
    (sync_epoch IS NOT NULL AND cursor_epoch IS NOT NULL AND account_generation IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS feed_entities (
  account_key TEXT NOT NULL
    CHECK (length(account_key) BETWEEN 1 AND 80),
  entity_type TEXT NOT NULL
    CHECK (entity_type IN (
      'focus_ledger_v2',
      'focus_metadata_v2',
      'focus_ledger_correction_v2'
    )),
  entity_id TEXT NOT NULL
    CHECK (length(entity_id) BETWEEN 1 AND 200),
  revision INTEGER NOT NULL
    CHECK (typeof(revision) = 'integer' AND revision >= 1),
  fingerprint TEXT NOT NULL
    CHECK (
      length(fingerprint) BETWEEN 32 AND 128 AND
      fingerprint NOT GLOB '*[^0-9A-Fa-f]*'
    ),
  deleted INTEGER NOT NULL
    CHECK (deleted IN (0, 1)),
  payload_json TEXT,
  source_device_id TEXT NOT NULL
    CHECK (length(source_device_id) BETWEEN 1 AND 200),
  change_seq INTEGER NOT NULL
    CHECK (typeof(change_seq) = 'integer' AND change_seq >= 1),
  applied_at TEXT NOT NULL,
  PRIMARY KEY (account_key, entity_type, entity_id),
  FOREIGN KEY (account_key) REFERENCES feed_state(account_key) ON DELETE CASCADE,
  CHECK (
    (deleted = 1 AND payload_json IS NULL) OR
    (deleted = 0 AND payload_json IS NOT NULL AND json_valid(payload_json)
      AND json_type(payload_json) = 'object')
  )
);

CREATE INDEX IF NOT EXISTS idx_feed_entities_projection
  ON feed_entities(account_key, entity_type, deleted, change_seq DESC);

CREATE INDEX IF NOT EXISTS idx_feed_entities_session
  ON feed_entities(account_key, entity_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_feed_entities_changes
  ON feed_entities(account_key, change_seq);

CREATE INDEX IF NOT EXISTS idx_feed_entities_tombstones
  ON feed_entities(account_key, change_seq)
  WHERE deleted = 1;

CREATE INDEX IF NOT EXISTS idx_feed_entities_ledger_started_at
  ON feed_entities(
    account_key,
    CAST(json_extract(payload_json, '$.startedAt') AS INTEGER) DESC
  )
  WHERE entity_type = 'focus_ledger_v2' AND deleted = 0;

DROP TABLE IF EXISTS snapshots;
