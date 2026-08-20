# Architecture and contracts

## Authority boundary

`foxlink-cloud-mcp` 是唯一公网 canonical origin，但不是 FocusLink 数据权威。唯一权威是通过 Cloudflare service binding 调用的私有 FocusLink Worker 与 Account Durable Object。私有 Worker 的 `workers_dev` 和 custom routes 必须关闭。

D1 的 `feed_state` 与 `feed_entities` 只是 derived projection：

- fresh reader 和任何 epoch/account-generation reset 都以 `cursor: null` 从 seq 0 回放；epoch handshake 的 `changeSeq` 只作 tail 诊断，绝不写成 bootstrap cursor；
- 每页 entity projection 与 cursor checkpoint 用同一 D1 batch 提交；失败后下一次从已提交 cursor 恢复；
- tombstone 保留为 `deleted=1,payload_json=NULL`；
- 工具调用先 sync-on-read。上游失败时只返回带 `degraded/stale/incomplete`、last complete time、epoch、last sequence 的缓存投影；不伪造实时或完整；
- live focus 不属于 v2 feed，状态工具明确返回 unavailable reason。

## Canonical sync

`POST /sync/v2/exchange` 使用 FocusLink Sync v2 JSON shape：

```json
{
  "protocolVersion": 2,
  "deviceId": "device-...",
  "syncEpoch": "...",
  "cursorEpoch": "...",
  "accountGeneration": 1,
  "cursor": null,
  "mutations": [],
  "pullLimit": 500
}
```

调用者必须提供与 `deviceId` 绑定的 `fl2` token。adapter 严格校验结构与大小，通过 service binding 转发；DO 继续负责真实 credential hash、expiry、revocation、account/scope/device binding、opId idempotency、revision conflict 和 tombstone 语义。

## Credential separation

| Surface | Credential | Never accepted as |
| --- | --- | --- |
| `/sync/v2/status`, `/sync/v2/exchange`, `/sync/v2/tasks`, `/sync/v2/live*` | business-owned `fl2` device token | MCP OAuth token |
| `/mcp` | RS256 OAuth access token, `focuslink:read` | `fl2`, ACCESS_KEY, RS client secret |
| feed projection | dedicated `sync:read` paired secret | exchange caller or MCP token |
| pair offer | OAuth AS owner session + CSRF, then two distinct service-binding credentials | public OAuth/device/root token |
| introspection | RFC6749 `client_secret_basic` RS client | access/device token |

OAuth verifier requires `RS256`, `typ=at+jwt`, unique `kid`, RSA ≥2048, exact issuer, single exact aud/resource, `sub=poyi-owner`, `token_use=access_token`, `client_id`, jti, max 300-second TTL and only `focuslink:read`. Every MCP request performs authenticated introspection; network/5xx/wrong Basic/revoked all fail closed.

Every MCP tool declares `focuslink:read` through its per-tool OAuth `securitySchemes` metadata and is annotated read-only/non-destructive. The MCP 2026-07-28 handler is stateless: each request is independently authenticated, and a missing or expired token returns the protected-resource HTTP `WWW-Authenticate` challenge. Legacy stateless clients remain supported, but no MCP session ID is created or trusted.

## Pairing

Public OAuth scopes remain the global four-scope policy; no `focuslink:pair` or `devices:manage` OAuth scope exists.

1. The OAuth AS verifies the owner session and a one-time CSRF token, then calls canonical `/sync/v1/pair/offers` over a service binding with an audience/action-bound credential.
2. This Worker validates that first hop and calls the private FocusLink Worker with the distinct `FOCUSLINK_PAIR_AUTHORITY_TOKEN`; no root or device credential crosses a public boundary.
3. Device receives only the high-entropy nonce.
4. Device posts nonce plus bounded platform/app metadata to `/sync/v1/pair/exchange`; the adapter forwards exactly those allowlisted fields to the authority for audit and never accepts a caller-supplied deviceId.
5. DO atomically consumes the nonce and returns server-assigned deviceId/`fl2`; adapter validates their binding.

Neither service credential is put in browser/mobile storage. Ordinary `focuslink:read`, device tokens, the authority root, and OAuth RS client credentials get 403 on offer creation.
