# Deployment gate

Production promotion remains blocked until fixed upstream authorization, service binding, OAuth AS and canonical E2E are all proven. Deployment itself is permitted only in the mandatory order below; a successful upload is not acceptance evidence.

## Required bindings and secrets

Wrangler config binds `FOCUSLINK_UPSTREAM` to service `focuslink-sync`, D1 `DB`, both MCP/feed Durable Objects, and `PAIR_RATE_LIMITER`.

Secrets (never commit or print):

- `FOCUSLINK_DEVICE_TOKEN`: dedicated paired token with only `sync:read` for derived projection.
- `FOCUSLINK_PAIR_AUTHORITY_TOKEN`: distinct `fla_*` high-entropy credential shared only with the private `focuslink-sync` Worker for pair-offer creation.
- `FOCUSLINK_PAIR_SERVICE_CREDENTIAL`: distinct service credential used only by the OAuth AS owner-session + CSRF flow when it calls this Worker over a service binding.
- `FOCUSLINK_MCP_SERVICE_TOKEN`: ≥32 random bytes, shared only with the Account DO internal MCP projection endpoint. It must differ from every device, pairing and OAuth credential.
- `OAUTH_RS_CLIENT_SECRET`: ≥32 random bytes, `client_secret_basic`, AS policy bound only to foxlink canonical `/mcp`.

Non-secret OAuth config is pinned in `wrangler.jsonc`: issuer, audience, JWKS, introspection URL and RS client id.

## Mandatory order

1. **Completed containment only:** old direct Worker public routes/custom domain were disabled; keep the recorded status/size evidence and do not restore them for testing.
2. Deploy/fix the private upstream Worker/DO canonical `/sync/v2/*` routes and `/internal/mcp/v1/focus/{summary,records}` plus `/internal/mcp/v1/tasks`; task reads/writes must use the same Account DO `task_state`, with `operationId`/`expectedRevision` CAS and no D1 task source. Bind the authenticated token device to every request/mutation deviceId, and prove fake=401, read-only task write=403, spoof=403, stale revision=409, operation replay=duplicate, revoked/expired/cross-account rejected. Its `workers_dev` must be false and it must have no public/custom route.
3. Deploy unified OAuth AS; prove metadata/JWKS/introspection and valid/expired/wrong-aud/wrong-scope/revoked matrix.
4. Provision projection and the two hop-specific pairing service credentials through the controlled owner channel. Never pass them as command-line arguments or print them.
5. Apply `migrations/0002_authoritative_feed.sql` remotely.
6. Run dry-run and full local gates.
7. Deploy canonical Worker, then execute `docs/e2e.md`.
8. Perform the fake-off test: stop local services and force-stop or disconnect PC/phone/tablet/watch participation, then invoke the public OAuth MCP from an independent network client. It must still return exact cloud-stored task/count/duration data and verifiable freshness.
9. Only after all remote and real-device evidence passes may `.poyi/project-platform.json` move from `partial`, and upstream visibility move to internal/private.

Read-only probe (outputs status and header size only):

```powershell
npm run probe:remote
```
