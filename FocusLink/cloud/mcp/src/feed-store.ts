import type {
  FeedChange,
  FeedEntityRow,
  FeedEpochResponse,
  FeedStateRow,
  FeedStatus,
} from './feed-types';

const STATE_COLUMNS = `account_key, device_id, cursor, sync_epoch, cursor_epoch,
  account_generation, last_change_seq, observed_head_change_seq, head_observed_at,
  last_server_time, status,
  last_sync_started_at, last_page_at, last_synced_at, last_error, last_error_at,
  reset_count`;

export async function getFeedState(
  db: D1Database,
  accountKey: string,
): Promise<FeedStateRow | null> {
  return db
    .prepare(`SELECT ${STATE_COLUMNS} FROM feed_state WHERE account_key = ?`)
    .bind(accountKey)
    .first<FeedStateRow>();
}

export async function prepareFeedState(
  db: D1Database,
  accountKey: string,
  deviceId: string,
  epoch: FeedEpochResponse,
  now: string,
): Promise<{ state: FeedStateRow; reset: boolean }> {
  const current = await getFeedState(db, accountKey);
  const corruptCheckpoint = Boolean(
    current &&
    ((current.cursor === null && current.last_change_seq !== 0) ||
      current.last_change_seq < 0 ||
      !Number.isSafeInteger(current.last_change_seq)),
  );
  const reset =
    !current ||
    corruptCheckpoint ||
    current.device_id !== deviceId ||
    current.sync_epoch !== epoch.syncEpoch ||
    current.cursor_epoch !== epoch.cursorEpoch ||
    current.account_generation !== epoch.accountGeneration;

  if (reset) {
    const resetCount = current ? current.reset_count + 1 : 0;
    await db.batch([
      db.prepare('DELETE FROM feed_entities WHERE account_key = ?').bind(accountKey),
      db
        .prepare(
          `INSERT INTO feed_state (
             account_key, device_id, cursor, sync_epoch, cursor_epoch,
             account_generation, last_change_seq, observed_head_change_seq,
             head_observed_at, last_server_time, status,
             last_sync_started_at, last_page_at, last_synced_at, last_error,
             last_error_at, reset_count
           ) VALUES (?, ?, NULL, ?, ?, ?, 0, ?, ?, NULL, 'syncing', ?, NULL, NULL, NULL, NULL, ?)
           ON CONFLICT(account_key) DO UPDATE SET
             device_id = excluded.device_id,
             cursor = NULL,
             sync_epoch = excluded.sync_epoch,
             cursor_epoch = excluded.cursor_epoch,
              account_generation = excluded.account_generation,
              last_change_seq = 0,
              observed_head_change_seq = excluded.observed_head_change_seq,
              head_observed_at = excluded.head_observed_at,
              last_server_time = NULL,
             status = 'syncing',
             last_sync_started_at = excluded.last_sync_started_at,
             last_page_at = NULL,
             last_synced_at = NULL,
             last_error = NULL,
             last_error_at = NULL,
             reset_count = excluded.reset_count`,
        )
        .bind(
          accountKey,
          deviceId,
          epoch.syncEpoch,
          epoch.cursorEpoch,
          epoch.accountGeneration,
          epoch.changeSeq,
          now,
          now,
          resetCount,
        ),
    ]);
  } else {
    await db
      .prepare(
        `UPDATE feed_state
         SET status = 'syncing', last_sync_started_at = ?,
             observed_head_change_seq = ?, head_observed_at = ?, last_error = NULL,
             last_error_at = NULL
         WHERE account_key = ?`,
      )
      .bind(now, epoch.changeSeq, now, accountKey)
      .run();
  }

  const state = await getFeedState(db, accountKey);
  if (!state) throw new Error('feed_state_write_failed');
  return { state, reset };
}

export async function applyFeedPage(
  db: D1Database,
  input: {
    accountKey: string;
    deviceId: string;
    epoch: FeedEpochResponse;
    previous: FeedStateRow;
    changes: FeedChange[];
    nextCursor: string;
    serverTime: number;
    complete: boolean;
    now: string;
  },
): Promise<FeedStateRow> {
  const currentRows =
    input.changes.length === 0
      ? []
      : await db.batch(
          input.changes.map((change) =>
            db
              .prepare(
                `SELECT revision, fingerprint, deleted, change_seq
               FROM feed_entities
               WHERE account_key = ? AND entity_type = ? AND entity_id = ?`,
              )
              .bind(input.accountKey, change.entityType, change.entityId),
          ),
        );
  const entityVersions = new Map<
    string,
    { revision: number; fingerprint: string; deleted: number; change_seq: number }
  >();
  input.changes.forEach((change, index) => {
    const row = currentRows[index]?.results[0] as
      { revision: number; fingerprint: string; deleted: number; change_seq: number } | undefined;
    if (row?.change_seq && row.change_seq > input.previous.last_change_seq) {
      throw new Error('feed_entity_checkpoint_inconsistent');
    }
    if (row) entityVersions.set(`${change.entityType}\u0000${change.entityId}`, row);
  });

  let lastSequence = input.previous.last_change_seq;
  const statements: D1PreparedStatement[] = [];
  for (const change of input.changes) {
    if (change.changeSeq !== lastSequence + 1)
      throw new Error('feed_change_sequence_not_contiguous');
    lastSequence = change.changeSeq;
    const entityKey = `${change.entityType}\u0000${change.entityId}`;
    const prior = entityVersions.get(entityKey);
    if (
      prior &&
      (change.revision < prior.revision ||
        (change.revision === prior.revision &&
          (change.fingerprint !== prior.fingerprint || Number(change.deleted) !== prior.deleted)))
    ) {
      throw new Error('feed_entity_revision_regressed');
    }
    entityVersions.set(entityKey, {
      revision: change.revision,
      fingerprint: change.fingerprint,
      deleted: Number(change.deleted),
      change_seq: change.changeSeq,
    });
    statements.push(
      db
        .prepare(
          `INSERT INTO feed_entities (
             account_key, entity_type, entity_id, revision, fingerprint, deleted,
             payload_json, source_device_id, change_seq, applied_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_key, entity_type, entity_id) DO UPDATE SET
             revision = excluded.revision,
             fingerprint = excluded.fingerprint,
             deleted = excluded.deleted,
             payload_json = excluded.payload_json,
             source_device_id = excluded.source_device_id,
             change_seq = excluded.change_seq,
             applied_at = excluded.applied_at
           WHERE excluded.change_seq > feed_entities.change_seq
             AND excluded.revision >= feed_entities.revision`,
        )
        .bind(
          input.accountKey,
          change.entityType,
          change.entityId,
          change.revision,
          change.fingerprint,
          change.deleted ? 1 : 0,
          change.payload === null ? null : JSON.stringify(change.payload),
          change.sourceDeviceId,
          change.changeSeq,
          input.now,
        ),
    );
  }

  statements.push(
    db
      .prepare(
        `UPDATE feed_state SET
           device_id = ?, cursor = ?, sync_epoch = ?, cursor_epoch = ?,
           account_generation = ?, last_change_seq = ?, last_server_time = ?,
           observed_head_change_seq = ?, head_observed_at = ?,
           status = ?, last_page_at = ?,
           last_synced_at = CASE WHEN ? = 1 THEN ? ELSE last_synced_at END,
           last_error = NULL, last_error_at = NULL
         WHERE account_key = ?`,
      )
      .bind(
        input.deviceId,
        input.nextCursor,
        input.epoch.syncEpoch,
        input.epoch.cursorEpoch,
        input.epoch.accountGeneration,
        lastSequence,
        input.serverTime,
        input.epoch.changeSeq,
        input.now,
        input.complete ? 'synced' : 'syncing',
        input.now,
        input.complete ? 1 : 0,
        input.now,
        input.accountKey,
      ),
  );
  await db.batch(statements);
  const state = await getFeedState(db, input.accountKey);
  if (!state) throw new Error('feed_state_checkpoint_failed');
  return state;
}

export async function markFeedError(
  db: D1Database,
  accountKey: string,
  errorCode: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE feed_state
       SET status = 'degraded', last_error = ?, last_error_at = ?
       WHERE account_key = ?`,
    )
    .bind(errorCode.slice(0, 120), now, accountKey)
    .run();
}

export async function listFeedEntities(
  db: D1Database,
  accountKey: string,
): Promise<FeedEntityRow[]> {
  const rows = await db
    .prepare(
      `SELECT account_key, entity_type, entity_id, revision, fingerprint, deleted,
              payload_json, source_device_id, change_seq, applied_at
       FROM feed_entities WHERE account_key = ?
       ORDER BY change_seq ASC`,
    )
    .bind(accountKey)
    .all<FeedEntityRow>();
  return rows.results;
}

export async function feedEntityCounts(
  db: D1Database,
  accountKey: string,
): Promise<Array<{ entity_type: string; deleted: number; count: number }>> {
  const rows = await db
    .prepare(
      `SELECT entity_type, deleted, COUNT(*) AS count
       FROM feed_entities WHERE account_key = ?
       GROUP BY entity_type, deleted ORDER BY entity_type, deleted`,
    )
    .bind(accountKey)
    .all<{ entity_type: string; deleted: number; count: number }>();
  return rows.results;
}

export function isFeedStatus(value: string): value is FeedStatus {
  return ['never_synced', 'syncing', 'synced', 'degraded'].includes(value);
}
