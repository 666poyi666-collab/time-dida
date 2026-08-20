-- Owner-approved device bootstrap flow store.
-- The public /account/v1/device/bootstrap endpoint creates a flow here; the
-- owner approves it from the identity gateway; a subsequent poll atomically
-- consumes the flow and forwards registration to the private authority.
-- Poll tokens are stored as HMAC fingerprints only; registration JSON is the
-- client-provided device intent and never contains credentials.
CREATE TABLE IF NOT EXISTS bootstrap_flows (
  flow_id TEXT PRIMARY KEY
    CHECK (flow_id GLOB 'flow_*' AND length(flow_id) BETWEEN 33 AND 161),
  registration_json TEXT NOT NULL,
  poll_token_hmac TEXT NOT NULL
    CHECK (length(poll_token_hmac) BETWEEN 32 AND 128),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'consumed')),
  expires_at INTEGER NOT NULL
    CHECK (typeof(expires_at) = 'integer' AND expires_at > 0),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at > 0),
  consumed_at INTEGER
    CHECK (consumed_at IS NULL OR typeof(consumed_at) = 'integer'),
  device_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_bootstrap_flows_status_created
  ON bootstrap_flows(status, created_at);
