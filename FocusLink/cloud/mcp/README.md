# foxlink-cloud-mcp

FocusLink 的唯一公开 canonical cloud origin。数据权威仍是内部 FocusLink Account Durable Object 的 Sync v2 change feed；本 Worker 不成为第二数据权威。

## 当前状态

v0.12.105 的上游 auth、service binding、统一 OAuth read/write scope 与时间/循环任务扩展已部署；private authority 为 `1e8d3397-f989-4e20-8912-d4fd4d7b5841`，public MCP 为 `4919bcce-8b7c-4eb1-a2ad-902b3273854f`，Poyi OAuth 为 `fab9ed8a-6400-42c3-b78b-7361aef706c0`，远端匿名探针 `19/19` 通过。ChatGPT Web 已完成 read/write OAuth，并以真实生产工具完成清单与循环任务创建、字段读回、删除和零残留确认；认证态 E2E 已闭合。

生产拓扑：

- `/sync/v2/status`、`/sync/v2/exchange`：携带业务自有 `fl2` device credential，经 service binding 读取/写入 Account DO；opId/revision/deviceId 原样交给 DO 判定，D1 不接写入。旧 `/sync/v1/status|exchange` 固定返回 410。
- `/sync/v2/tasks`、`/sync/v2/live`、`/sync/v2/live/wait`、`/sync/v2/live/command`：同一公网 origin 上的任务与实时专注面，经私有 Worker 转发到同一个 Account DO。
- `/mcp`：只接受统一 AS 签发、实时 introspection 为 active 的 RS256 access token；读取需要 `focuslink:read`，自有任务写入需要同时具备 `focuslink:read focuslink:write`。
- MCP read 先经专属 `sync:read` paired device 拉完整 v2 feed，再读取 D1 derived projection。
- `focuslink_get_task_summary` 经专属 service binding 读取 Account DO 的最小明文投影，只包含专注次数、任务、时长、最近记录和 freshness；不返回备注、标签、deviceId 或凭据。
- `focuslink_get_current_time` 读取 Account DO 同步时钟，返回 IANA timezone、UTC/local 时间、offset 与当天边界；`focuslink_list_projects/get_project/list_tasks/get_task` 读取同一 `task_state` 快照，任务列表可按清单、父级、优先级、开始/截止区间和标签筛选。
- `focuslink_create_project`/`update_project`/`delete_project` 与 `focuslink_create_task`/`update_task`/`complete_task`/`restore_task`/`delete_task`/`move_task` 通过 Account DO 的 CAS mutation 管理任务。写入均携带 `operationId`、`expectedRevision`，相同正文重放返回 `duplicate`，旧 revision 返回冲突；开始/截止时间（Unix ms）、优先级、标签、父子 `parentId` 与结构化循环都在快照中保留。循环调用方不能设置 `completedCount`，authority 完成事务按规则推进。清单删除只迁入收件箱，任务删除才永久删除子树，确认响应不带任务正文。
- `/sync/v1/pair/offers`：仅 OOB/internal admin capability；OAuth token 与普通 device token 均拒绝。
- `/sync/v1/pair/exchange`：匿名高熵一次性 nonce + device metadata，受双键 rate limit 保护。
- `/sync/push` 与旧 `/<ACCESS_KEY>/mcp`：永久 `410 Gone`。
- `/v1/*`、live、command、device write/admin 不由本 MCP 暴露；任务 mutation 仅作为 `/sync/v2/tasks/mutate` 的 canonical adapter 路径由 MCP 内部 service binding 调用 Account DO。

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
- `tests/tasks.test.ts`：时间、清单/任务读取、筛选、结构化循环、CAS/幂等和脱敏确认。
- `tests/focus-summary.test.ts`：Account DO 内部摘要的 credential、timeout、redirect、范围与 strict DTO 校验。

共享合同位于 `contracts/`，必须与 `PersonalMcpGateway/standards/project-platform/contracts/` 保持 byte-exact 一致。

架构、部署阻断和 E2E 见 [docs/architecture.md](docs/architecture.md)、[docs/deployment.md](docs/deployment.md)、[docs/e2e.md](docs/e2e.md)。
