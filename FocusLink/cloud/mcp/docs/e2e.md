# Canonical remote E2E

All positive evidence must use the one origin `https://foxlink-mcp.focuslink-poyi-6465e9.workers.dev`. Direct `/v2/sync` is never accepted as canonical evidence.

1. Verify `/healthz=200`, `/readyz=200`, RFC9728 metadata resource exactly canonical `/mcp`, and authorization_servers exactly unified issuer.
2. OOB admin creates a one-time offer; verify public OAuth/read/device credentials receive 403. Claim once with nonce+device metadata; replay and expiry return 410, brute force 429, returned token public id matches server deviceId.
3. With the new `fl2`, call `/sync/v2/status`, then `/sync/v2/exchange` using a unique opId to create ledger+metadata while the PC client is off. Verify `/sync/v2/tasks` and `/sync/v2/live*` use the same public origin and authority.
4. Replay the same opId and prove `duplicate`, not a second entity/revision.
5. Call OAuth-protected `/mcp`; `focuslink_list_focus_records` must sync-on-read and compose that ledger+metadata. Verify epoch, lastChangeSeq, freshness and source authority.
6. Call `focuslink_get_task_summary` for a bounded range. Verify its strict v1 DTO, exact focus/task/count/duration totals, `authority=focuslink-account-do`, monotonic `changeSeq`, and `lastVerifiedAt`/`dataThrough`/freshness. Confirm notes, tags, deviceId, cookies and credentials are absent.
7. With a token carrying `focuslink:read focuslink:write`, call `focuslink_list_projects` and `focuslink_list_tasks`, then create a temporary FocusLink project, parent task and child task carrying a due timestamp, priority and tags. Update, complete, restore and move the child/parent subtree while supplying the returned `revision` as `expectedRevision`; each successful response must be a redacted confirmation from Account DO.
8. Replay one write with the same `operationId` and exact body to obtain `duplicate`; reuse that ID with a different mutation and submit an old `expectedRevision` to obtain a conflict. Confirm the snapshot and revision do not advance for either rejected request. Delete the temporary project and verify all tasks remain once in `local-inbox`; finally delete the temporary task subtree and verify cleanup.
9. Delete the ledger through canonical exchange. MCP list must hide it while D1 retains a tombstone. Restore must reappear with the next revision.
10. Interrupt pagination after one page, restart DO/request, and prove resume from saved cursor. Change epoch/account generation and prove D1 clears projection then requests `cursor:null` from seq 0.
11. OAuth negatives: expired, wrong aud/resource, wrong/legacy scope, revoked, wrong RS Basic, algorithm/kid/typ downgrade. Device and OAuth credentials must be mutually rejected.
12. Upstream negatives through canonical: format-valid fake token 401, read-only write 403, body/mutation deviceId spoof 403, revoked/expired/cross-account rejected.
13. On phone, tablet and watch create/update/finish focus records, then verify the cloud summary's concrete task, count and duration. Repeat after app restart and network recovery.
14. Fake-off acceptance: stop local PC services; force-stop or disconnect all FocusLink/guard clients from the test path; from an independent client complete OAuth and invoke the public MCP. The already-synced records and task summaries must remain callable with truthful freshness. Reconnect one device, create another focus, and verify automatic catch-up.
15. Old direct Worker probes must show it cannot be used as a second official data path. Record status and Content-Length only; never print response bodies or credentials.

The final public MCP read can be reproduced without putting the bearer token on
the command line:

```powershell
$env:FOCUSLINK_MCP_ACCESS_TOKEN = Read-Host -MaskInput
npm run verify:pc-off
Remove-Item Env:FOCUSLINK_MCP_ACCESS_TOKEN
```

The verifier requires at least one real task/session and positive active time,
validates the strict Account DO DTO and privacy boundary, and prints aggregate
evidence only. The access token itself is never printed.
