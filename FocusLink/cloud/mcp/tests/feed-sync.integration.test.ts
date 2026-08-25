import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { applyFeedPage, getFeedState, listFeedEntities, prepareFeedState } from '../src/feed-store';
import { syncAuthoritativeFeed } from '../src/feed-sync';
import type { FeedChange, FeedEnv } from '../src/feed-types';
import { readProjection } from '../src/projection';
import {
  EPOCH_ONE,
  EPOCH_TWO,
  FakeFocusLinkFeed,
  TEST_ACCOUNT_KEY,
  epochResponse,
  ledgerChange,
  metadataChange,
  tombstoneChange,
} from './helpers/focuslink-feed';

const feedEnv = env as unknown as FeedEnv;

describe('FocusLink v2 authoritative feed adapter', () => {
  it('starts a fresh reader at cursor null, pages the real v2 shape, and composes ledger + metadata', async () => {
    const upstream = new FakeFocusLinkFeed({
      pageSize: 2,
      changes: [
        ledgerChange(1, 'session-a'),
        metadataChange(2, 'session-a'),
        ledgerChange(3, 'session-b'),
        metadataChange(4, 'session-b'),
      ],
    });
    upstream.install();

    const result = await syncAuthoritativeFeed(feedEnv, { fetcher: upstream.fetch });

    expect(result).toMatchObject({
      complete: true,
      reset: true,
      pages: 2,
      changesApplied: 4,
    });
    expect(upstream.postBodies().map((body) => body.cursor)).toEqual([null, 'c2']);
    expect(upstream.calls.every((call) => call.redirect === 'manual')).toBe(true);
    expect(upstream.postBodies()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocolVersion: 2,
          deviceId: env.FOCUSLINK_DEVICE_ID,
          mutations: [],
          pullLimit: 500,
          ...EPOCH_ONE,
        }),
      ]),
    );
    upstream.expectReadOnlyCredential();

    const state = await getFeedState(env.DB, TEST_ACCOUNT_KEY);
    expect(state).toMatchObject({
      cursor: 'c4',
      last_change_seq: 4,
      observed_head_change_seq: 4,
      status: 'synced',
      reset_count: 0,
      sync_epoch: EPOCH_ONE.syncEpoch,
      cursor_epoch: EPOCH_ONE.cursorEpoch,
      account_generation: EPOCH_ONE.accountGeneration,
      last_error: null,
    });
    expect(state?.last_synced_at).not.toBeNull();

    const projection = await readProjection(env.DB, TEST_ACCOUNT_KEY);
    expect(projection).toMatchObject({ tombstones: 0, invalidEntities: 0, entityCount: 4 });
    expect(projection.sessions).toHaveLength(2);
    expect(projection.sessions.find((session) => session.id === 'session-a')).toMatchObject({
      title: 'Session session-a',
      note: 'synced from FocusLink',
      subject: 'chemistry',
      activeElapsedMs: 30_000,
      authority: {
        ledgerRevision: 1,
        metadataRevision: 1,
        correctionRevision: null,
        lastChangeSeq: 2,
      },
    });
  });

  it('commits each page atomically, marks interruption degraded, and resumes from the committed cursor', async () => {
    const upstream = new FakeFocusLinkFeed({
      pageSize: 1,
      changes: [
        ledgerChange(1, 'session-resume'),
        metadataChange(2, 'session-resume'),
        ledgerChange(3, 'session-after-resume'),
      ],
    });
    upstream.failSyncCall = 2;
    upstream.install();

    await expect(syncAuthoritativeFeed(feedEnv, { fetcher: upstream.fetch })).rejects.toMatchObject(
      {
        code: 'upstream_temporary_failure',
      },
    );

    const interrupted = await getFeedState(env.DB, TEST_ACCOUNT_KEY);
    expect(interrupted).toMatchObject({
      cursor: 'c1',
      last_change_seq: 1,
      status: 'degraded',
      last_error: 'upstream_temporary_failure',
    });
    expect(await listFeedEntities(env.DB, TEST_ACCOUNT_KEY)).toHaveLength(1);

    upstream.failSyncCall = null;
    const resumed = await syncAuthoritativeFeed(feedEnv, { fetcher: upstream.fetch });

    expect(resumed).toMatchObject({ complete: true, reset: false, changesApplied: 2 });
    const bodies = upstream.postBodies();
    expect(bodies[0].cursor).toBeNull();
    expect(bodies[1].cursor).toBe('c1');
    expect(bodies[2].cursor).toBe('c1');
    expect(bodies.at(-1)?.cursor).toBe('c2');
    expect(await getFeedState(env.DB, TEST_ACCOUNT_KEY)).toMatchObject({
      cursor: 'c3',
      last_change_seq: 3,
      status: 'synced',
      last_error: null,
    });
  });

  it('keeps tombstones authoritative and excludes deleted ledgers from the composed projection', async () => {
    const upstream = new FakeFocusLinkFeed({
      changes: [
        ledgerChange(1, 'session-deleted'),
        metadataChange(2, 'session-deleted'),
        tombstoneChange(3, 'session-deleted'),
      ],
    });
    upstream.install();

    await syncAuthoritativeFeed(feedEnv, { fetcher: upstream.fetch });

    const entities = await listFeedEntities(env.DB, TEST_ACCOUNT_KEY);
    const tombstone = entities.find(
      (row) => row.entity_type === 'focus_ledger_v2' && row.entity_id === 'session-deleted',
    );
    expect(tombstone).toMatchObject({ deleted: 1, payload_json: null, revision: 2, change_seq: 3 });
    const projection = await readProjection(env.DB, TEST_ACCOUNT_KEY);
    expect(projection).toMatchObject({ sessions: [], tombstones: 1, invalidEntities: 0 });
  });

  it('counts Focus Guard envelopes as opaque and never materializes them as FocusLink sessions', async () => {
    const upstream = new FakeFocusLinkFeed({
      changes: [
        {
          changeSeq: 1,
          entityType: 'focus_guard_config_v1',
          entityId: 'guard-config-default',
          revision: 1,
          fingerprint: 'a'.repeat(64),
          deleted: false,
          payload: {
            version: 1,
            algorithm: 'A256GCM',
            product: 'focus-guard',
            entityKind: 'config',
            nonce: 'n'.repeat(16),
            ciphertext: 'c'.repeat(16),
            aadHash: 'd'.repeat(64),
            aadBaseRevision: 0,
            operation: 'put',
            createdAt: 1_700_000_000_000,
          },
          sourceDeviceId: 'device-focus-guard',
        },
      ],
    });
    upstream.install();

    await syncAuthoritativeFeed(feedEnv, { fetcher: upstream.fetch });

    const projection = await readProjection(env.DB, TEST_ACCOUNT_KEY);
    expect(projection).toMatchObject({
      sessions: [],
      invalidEntities: 0,
      opaqueEncryptedEntities: 1,
      entityCount: 1,
    });
  });

  it('clears the old projection and replays from null when the epoch changes', async () => {
    const upstream = new FakeFocusLinkFeed({
      epoch: EPOCH_ONE,
      changes: [ledgerChange(1, 'old-session'), metadataChange(2, 'old-session')],
    });
    upstream.install();
    await syncAuthoritativeFeed(feedEnv, { fetcher: upstream.fetch });

    upstream.epoch = EPOCH_TWO;
    upstream.changes = [ledgerChange(1, 'new-session'), metadataChange(2, 'new-session')];
    const result = await syncAuthoritativeFeed(feedEnv, { fetcher: upstream.fetch });

    expect(result).toMatchObject({ complete: true, reset: true });
    const posts = upstream.postBodies();
    expect(posts[0]).toMatchObject({ cursor: null, ...EPOCH_ONE });
    expect(posts[1]).toMatchObject({ cursor: null, ...EPOCH_TWO });
    const state = await getFeedState(env.DB, TEST_ACCOUNT_KEY);
    expect(state).toMatchObject({
      cursor: 'c2',
      last_change_seq: 2,
      reset_count: 1,
      sync_epoch: EPOCH_TWO.syncEpoch,
      cursor_epoch: EPOCH_TWO.cursorEpoch,
      account_generation: EPOCH_TWO.accountGeneration,
    });
    expect(
      (await readProjection(env.DB, TEST_ACCOUNT_KEY)).sessions.map((session) => session.id),
    ).toEqual(['new-session']);
    expect(
      (await listFeedEntities(env.DB, TEST_ACCOUNT_KEY)).some(
        (row) => row.entity_id === 'old-session',
      ),
    ).toBe(false);
  });

  it('rolls back entity writes and the cursor together when any statement in a D1 page fails', async () => {
    const prepared = await prepareFeedState(
      env.DB,
      TEST_ACCOUNT_KEY,
      env.FOCUSLINK_DEVICE_ID,
      epochResponse(EPOCH_ONE, 2),
      new Date().toISOString(),
    );
    const invalid = {
      ...metadataChange(2, 'session-atomic'),
      entityType: 'not-a-focuslink-type',
    } as unknown as FeedChange;

    await expect(
      applyFeedPage(env.DB, {
        accountKey: TEST_ACCOUNT_KEY,
        deviceId: env.FOCUSLINK_DEVICE_ID,
        epoch: epochResponse(EPOCH_ONE, 2),
        previous: prepared.state,
        changes: [ledgerChange(1, 'session-atomic'), invalid],
        nextCursor: 'c2',
        serverTime: Date.now(),
        complete: false,
        now: new Date().toISOString(),
      }),
    ).rejects.toThrow();

    expect(await listFeedEntities(env.DB, TEST_ACCOUNT_KEY)).toEqual([]);
    expect(await getFeedState(env.DB, TEST_ACCOUNT_KEY)).toMatchObject({
      cursor: null,
      last_change_seq: 0,
      status: 'syncing',
    });
  });

  it('never reports catch-up when the authority ends before its observed head', async () => {
    const upstream = new FakeFocusLinkFeed({ reportedHeadChangeSeq: 10, changes: [] });
    upstream.install();

    await expect(syncAuthoritativeFeed(feedEnv, { fetcher: upstream.fetch })).rejects.toMatchObject(
      {
        code: 'upstream_incomplete_tail',
      },
    );

    expect(await getFeedState(env.DB, TEST_ACCOUNT_KEY)).toMatchObject({
      cursor: null,
      last_change_seq: 0,
      observed_head_change_seq: 10,
      status: 'degraded',
      last_error: 'upstream_incomplete_tail',
    });
    expect(await listFeedEntities(env.DB, TEST_ACCOUNT_KEY)).toEqual([]);
  });

  it('does not advance the checkpoint past a regressed entity revision', async () => {
    const upstream = new FakeFocusLinkFeed({
      changes: [ledgerChange(1, 'session-regression', 2)],
    });
    upstream.install();
    await syncAuthoritativeFeed(feedEnv, { fetcher: upstream.fetch });

    upstream.changes = [
      ledgerChange(1, 'session-regression', 2),
      ledgerChange(2, 'session-regression', 1),
    ];
    await expect(syncAuthoritativeFeed(feedEnv, { fetcher: upstream.fetch })).rejects.toMatchObject(
      {
        code: 'feed_entity_revision_regressed',
      },
    );

    expect(await getFeedState(env.DB, TEST_ACCOUNT_KEY)).toMatchObject({
      cursor: 'c1',
      last_change_seq: 1,
      status: 'degraded',
    });
    expect(await listFeedEntities(env.DB, TEST_ACCOUNT_KEY)).toEqual([
      expect.objectContaining({ revision: 2, change_seq: 1 }),
    ]);
  });

  it('rejects a non-paired or mismatched device credential before any upstream request', async () => {
    const upstream = new FakeFocusLinkFeed();
    upstream.install();
    const invalidEnv: FeedEnv = {
      ...feedEnv,
      FOCUSLINK_DEVICE_ID: 'device-another-reader',
    };

    await expect(
      syncAuthoritativeFeed(invalidEnv, { fetcher: upstream.fetch }),
    ).rejects.toMatchObject({
      code: 'invalid_paired_device_credential',
      retryable: false,
    });
    expect(upstream.calls).toEqual([]);
  });

  it('rejects reuse of the projection credential as an OAuth RS or pairing secret', async () => {
    const upstream = new FakeFocusLinkFeed();
    const reusedEnv: FeedEnv = {
      ...feedEnv,
      OAUTH_RS_CLIENT_SECRET: feedEnv.FOCUSLINK_DEVICE_TOKEN,
    };
    await expect(
      syncAuthoritativeFeed(reusedEnv, { fetcher: upstream.fetch }),
    ).rejects.toMatchObject({ code: 'invalid_paired_device_credential', retryable: false });
    expect(upstream.calls).toEqual([]);
  });
});
