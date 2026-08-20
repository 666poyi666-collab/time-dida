# foxlink-cloud-mcp

FocusLink 的唯一公开 canonical cloud origin。数据权威仍是内部 FocusLink Account Durable Object 的 Sync v2 change feed；本 Worker 不成为第二数据权威。

## 当前状态

本地实现与合同测试已落地，但生产仍是 **STOP-SHIP / partial**。固定后的上游 auth、service binding、统一 OAuth AS 与 canonical E2E 尚未通过远端门禁；完成这些门禁之前不得宣称公网 MCP、PC-off 或真实设备 E2E 已完成。

生产拓扑：

- `/sync/v2/status`、`/sync/v2/exchange`：携带业务自有 `fl2` device credential，经 service binding 读取/写入 Account DO；opId/revision/deviceId 原样交给 DO 判定，D1 不接写入。旧 `/sync/v1/status|exchange` 固定返回 410。
- `/sync/v2/tasks`、`/sync/v2/live`、`/sync/v2/live/wait`、`/sync/v2/live/command`：同一公网 origin 上的任务与实时专注面，经私有 Worker 转发到同一个 Account DO。
- `/mcp`：只接受统一 AS 签发、实时 introspection 为 active 的 `focuslink:read` RS256 access token。
- MCP read 先经专属 `sync:read` paired device 拉完整 v2 feed，再读取 D1 derived projection。
- `focuslink_get_task_summary` 经专属 service binding 读取 Account DO 的最小明文投影，只包含专注次数、任务、时长、最近记录和 freshness；不返回备注、标签、deviceId 或凭据。
- `/sync/v1/pair/offers`：仅 OOB/internal admin capability；OAuth token 与普通 device token 均拒绝。
- `/sync/v1/pair/exchange`：匿名高熵一次性 nonce + device metadata，受双键 rate limit 保护。
- `/sync/push` 与旧 `/<ACCESS_KEY>/mcp`：永久 `410 Gone`。
- `/v1/*`、live、tasks、command、device write/admin 不由本 MCP 暴露。

## 本地门禁

```powershell
npm ci
npm run typecheck
npm run test:typecheck
npm test
npx wrangler deploy --dry-run
```

关键可复现测试文件：

- `tests/feed-sync.integration.test.ts`：fresh seq-0、分页、故障重启、epoch reset、tombstone、ledger+metadata 合成。
- `tests/exchange.test.ts`：device credential、deviceId/opId、scope/revoke/cross-account 上游拒绝透传。
- `tests/oauth.test.ts`：RS256、aud/resource/scope/TTL、JWKS、client_secret_basic introspection、revocation。
- `tests/pairing.test.ts`：offer 隔离、nonce 过期/重放、token↔deviceId、brute-force rate limit。
- `tests/worker.contract.test.ts`：标准路由、410、OAuth/MCP、sync-on-read freshness 与交叉凭据。
- `tests/focus-summary.test.ts`：Account DO 内部摘要的 credential、timeout、redirect、范围与 strict DTO 校验。

共享合同位于 `contracts/`，必须与 `PersonalMcpGateway/standards/project-platform/contracts/` 保持 byte-exact 一致。

架构、部署阻断和 E2E 见 [docs/architecture.md](docs/architecture.md)、[docs/deployment.md](docs/deployment.md)、[docs/e2e.md](docs/e2e.md)。
