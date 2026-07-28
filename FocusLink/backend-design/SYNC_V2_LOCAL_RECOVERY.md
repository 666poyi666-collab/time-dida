# FocusLink Local Sync v2 Recovery

This document describes the local-only recovery guarantees implemented on
`work/stage-3a-focuslink-local-sync`. It is not deployment, cloud, PC-off or
physical-device evidence.

## Canonical data path

- Desktop and mobile ledger replication use only `/sync/v2/status` and
  `/sync/v2/exchange`.
- Retired mobile `/v1/sync` pull/push helpers reject locally with
  `legacy_route_retired`; they do not issue a fallback request.
- Live-focus and pairing routes remain separate product protocols and are not
  ledger fallback paths.

## Durable boundary

- Desktop applies ACK settlement, remote materialization, history and the
  cursor checkpoint inside one SQLite transaction.
- Mobile applies the same values inside one IndexedDB transaction.
- Completing a paired offline mobile session writes both the local pending
  bundle and canonical v2 outbox mutations in one IndexedDB transaction.
- Leased outbox rows survive process loss. ACKs delete a row only in the same
  transaction that records the confirmed entity/history state.

## Recovery and conflicts

- Outbox claims are bound to the credential-derived device ID. A credential
  rebind archives old-device active rows before the pull-first bootstrap.
- `opId` is idempotent only for the exact same mutation. Reuse with a
  different payload fails closed.
- Cursor rollback/ahead values fail closed. Cursors and change sequences use
  safe integers only.
- Same revision with a different fingerprint, revision rollback, local-vs-
  tombstone revival and pending-vs-remote changes create durable conflicts;
  neither candidate silently overwrites the other.
- User-triggered desktop deletion stages canonical tombstones before deleting
  the local projection. A remote tombstone cannot be revived by an older
  snapshot.

## Credentials and companion projection

- Desktop tokens stay in Electron `safeStorage`; Android tokens stay wrapped
  by Android Keystore. The ordinary mobile IndexedDB device store is
  allowlisted and migrates away historical token fields.
- Persistent sync diagnostics retain fixed error codes and verification times,
  never upstream response bodies or request headers.
- Android exposes a same-signature, call-only projection at
  `content://app.focuslink.mobile.authority.projection/v1/current` using
  `getProjectionV1`. It exposes only the versioned FocusLink projection;
  token, device ID, cursor and envelope data are excluded.
