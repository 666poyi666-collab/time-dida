-- The Focus Guard application publishes AES-GCM envelopes through the same
-- Account DO. D1 remains a derived, opaque projection: it may count/version
-- these rows but never needs a key or plaintext schema.
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS feed_entities_v3 (
  account_key TEXT NOT NULL
    CHECK (length(account_key) BETWEEN 1 AND 80),
  entity_type TEXT NOT NULL
    CHECK (entity_type IN (
      'focus_ledger_v2',
      'focus_metadata_v2',
      'focus_ledger_correction_v2',
      'focus_guard_rule_v1',
      'focus_guard_state_v1',
      'focus_guard_completion_v1',
      'focus_guard_config_v1'
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

INSERT INTO feed_entities_v3 (
  account_key, entity_type, entity_id, revision, fingerprint, deleted,
  payload_json, source_device_id, change_seq, applied_at
)
SELECT
  account_key, entity_type, entity_id, revision, fingerprint, deleted,
  payload_json, source_device_id, change_seq, applied_at
FROM feed_entities;

DROP TABLE feed_entities;
ALTER TABLE feed_entities_v3 RENAME TO feed_entities;

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

PRAGMA foreign_keys = ON;
