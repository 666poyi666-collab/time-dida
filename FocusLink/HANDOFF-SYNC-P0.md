# FocusLink 同步收口交接（跨 AI 连续上下文）

> 本文件是给"下一个接手的 AI / 换账号后的自己"读的自包含上下文。
> 随进展更新。不要删除历史结论，只在末尾追加"进展日志"。

最后更新：2026-07-28（由 Qoder 接手 codex/ChatGPT 的交接）
当前负责人（写入 owner）：单一 AI，串行修改，禁止并行写同仓。

---

## 0. 用户画像与价值排序（最重要，先读这段）

- 终极目标：手表(Watch)、日记(Journal)、专注(FocusLink)、不做手机控、随心一听等多个个人 App
  通过一个 MCP 网关(PersonalMcpGateway)接入 ChatGPT，并实现**电脑关机后仍可用的端到端加密云同步**（对标滴答清单体验）。
- 价值排序（用户明确纠正过）：**同步 > UI > 架构洁癖 > 交互真实性 > 安全（安全其实一般）**。
  - 因此：同步正确性与可用性是第一优先级。UI 是长期反复投诉的重点。
  - "安全"本身权重不高，但下面两个 P0 本质是"同步正确性 + 架构洁癖"问题，所以仍是高优先级。

## 1. 硬约束（不可违反）

- 不要 `git reset --hard` / `git checkout --` / 覆盖他人 dirty 改动；工作区是 dirty 的，改动都归用户。
- 当前阶段：**只做本地开发与本地验证，不合并、不部署、不碰任何远端资源**（Cloudflare/D1/secret）。
- `supportsPcOff` 全部保持 `false`；任何项目都不得标 `complete`，除非"实现 commit+部署 revision+远端探测+双设备证据+三轮 PC-off 记录+manifest"全部匹配。
- 单一写入 owner；审计/测试只读并行。

## 2. ChatGPT 指出的两个 P0（本次核心任务）

### P0-1：设备 token 可伪造同账号其他设备身份【已确认成立】
- 位置：`cloudflare/accountDurableObject.ts`
  - 路由 `/v2/sync`(L225-229)、`/v2/bootstrap/inventory`(L197-205)、`/v2/bootstrap/entities`(L206-214)
    调用 `authorizeV2()` 认证出真实设备身份后**丢弃了它**，直接用请求体 `request.deviceId` /
    `mutation.deviceId` 写入 `v2_changes.source_device_id`(L889) 与设备 watermark(L773-777)、touchV2Device(L749)。
  - 对照：`/v2/push/register`(L298-299) 已正确用 `identity.deviceId`，是应当模仿的范式。
- 为什么是"同步"问题：change feed 溯源(sourceDeviceId)与 watermark 会记到错误设备；
  `canPhysicallyPurge` 依赖 `activeDeviceWatermarks`，被污染后可能过早物理清除他设备尚未读到的删除 → 丢数据/错乱。
- 利用路径：持设备 A 合法 token(`fl2_<acct>_<A>_<secret>`)，请求体 deviceId 与 mutation.deviceId 填设备 B → 以 B 身份写入。
- 修复方案：认证后强制 `request.deviceId === identity.deviceId` 且每条 `mutation.deviceId === identity.deviceId`；
  owner-migration 身份(internal FOCUSLINK_SYNC_TOKEN)除外（合法回填历史设备 id）。不匹配返回 403 `device_identity_mismatch`。

### P0-2：Node 云服务可绕过 Account DO 成为独立 authority【已确认成立】
- 位置：`cloud/syncV2Store.ts`(自带 entities/operations/changes/cursor 独立持久化到 JSON) +
  `cloud/deviceSyncServer.ts`(`/v2/sync`L463、`/sync/v2/exchange`L477、`/v2/bootstrap/*` 直接 `v2Store.sync/establish`)。
  Node 侧只有 token→account 映射，**无设备级认证**，与 Cloudflare DO 并存时会数据分叉。
- 架构约定（projects.json）：`focuslink-device-sync-worker`(Cloudflare) = `internal_authoritative_upstream`(唯一 authority)；
  Node cloud 按用户原话是"**v2 同步核心的应急后端/回归实现，不是 Cloudflare 全功能镜像**"。
- 修复方案（最小）：`personal-cloud`(生产)profile 默认**拒绝**权威 v2 写（`/v2/sync` 带 mutations、`/sync/v2/exchange` 带 mutations、`/v2/bootstrap/entities`），
  返回 409 `v2_authority_is_cloudflare_do`，除非显式 `FOCUSLINK_CLOUD_V2_EMERGENCY=true` 应急开启；`/health` 暴露 `v2Authority` 字段。
  `test` profile 保持全功能（回归测试需要），不受影响。

## 3. 同步与可用性现状（成熟度）

- 已实现：outbox+lease(claimOutboxItems)、严格 `c<base36>` cursor、tombstone+graveyard、bootstrap(inventory/manifest/establish 状态机)、
  revision 冲突检测、不可变 ledger(`immutable_ledger_requires_correction`)、opId 去重、account-scoped 单调 cursor、metadata 三方合并、
  `canPhysicallyPurge`(retention+watermark+conflict+backup 四门)、stale device(90d)、备份/恢复(DO 内)。
- 缺口：厂商推送(FCM/华为/小米,credential-missing 仅框架)、真实设备三轮 PC-off 证据、R2 真实灾备演练、
  WorkManager/boot/Doze 客户端恢复的端到端验证、outbox 实际推送/重试的集成测试。

## 4. 现有测试

- `tests/deviceSyncCloud.test.ts`：打 Node 测试服务(非 DO)——健康/鉴权/CORS、v2 exchange cursor、不可变 ledger、opId 去重、revision 冲突/rebase、分页、账号隔离。
- `tests/syncV2Protocol.test.ts`：纯函数——合并策略、outbox 认领、token 解析、stale/generation 失效、purge 四门。
- `tests/mobileSyncClient.test.ts`：配对码交换、超时/中止、invalid_cursor、端点迁移。
- `tests/cloudflareWorkerRouting.test.ts`：worker 路由守卫负测（上一会话新增：410 退休/OAuth 拒/伪造 fl2 拒/未认证拒/配对拒/token 不外泄）。
- 缺口：无 DO 级 deviceId 与 token 身份一致性测试(P0-1)；无 Node 权威写隔离测试(P0-2)。

## 5. 本次会话进展

- [进行中] 见文末"进展日志"。

## 6. 如何恢复 / 上下文在哪

- 本文件：FocusLink 仓库根 `HANDOFF-SYNC-P0.md`（改动就在本仓）。
- 生态级审计：`C:\开发\mcp开发\PersonalMcpGateway\standards\project-platform\reports\audit-current.md` 与 `projects.json`。
- 恢复基线：`C:\开发\backups\qoder-baseline-20260728-*`（上一会话建立，各仓有 recovery/ 分支）。
- 本地门禁命令（FocusLink）：`npm run typecheck`、`npm run lint`、`npm run test`。

---

## 进展日志（追加，勿删旧条目）

- 2026-07-28 Qoder：确认 P0-1/P0-2 均成立，写下本交接文档；开始实施两处最小修复 + 负测。

- 2026-07-28 Qoder（完成本轮）：两个 P0 已本地修复并通过门禁（未合并未部署，supportsPcOff 仍 false）。
  - P0-1 修复：`cloudflare/accountDurableObject.ts` 新增导出纯函数 `assertV2DeviceBinding(identity, requestDeviceId, mutations)`；
    `/v2/sync`、`/v2/bootstrap/inventory`、`/v2/bootstrap/entities` 三路由改为捕获 `authorizeV2()` 的 identity 并调用该守卫，
    非匹配返回 403 `device_identity_mismatch`；owner-migration 内部凭据豁免。`/v2/push/register` 早已正确，未改。
  - P0-2 修复：`cloud/deviceSyncServer.ts` 新增 `allowV2AuthoritativeWrites`（test=true；personal-cloud 默认 false，
    仅 `options.allowV2AuthoritativeWrites===true` 应急开启）。personal-cloud 默认对权威 v2 写
    （`/v2/sync` 带 mutations、`/sync/v2/exchange` 带 mutations、`/v2/bootstrap/entities`）返回 409 `v2_authority_is_cloudflare_do`；
    读路径(status、空 mutations 拉取)不受影响；`/health` 新增 `v2WriteAuthority` 字段。`cloud/server.ts` 未改（生产入口默认即拒写）。
  - 顺带修复上一会话遗留的 typecheck 回归：`tests/cloudflareWorkerRouting.test.ts` 导入 cloudflare/ 使其被主 tsconfig(node types)检查而报错。
    已在 `tsconfig.json` 的 `exclude` 排除两个跨运行时桥接测试（该两测试仍由 vitest 运行；worker 代码本身由 tsconfig.worker.json 类型检查）。
  - 新增负测：`tests/accountDurableObjectDeviceBinding.test.ts`(4)、`tests/nodeCloudV2Authority.test.ts`(2)。
  - 门禁：`npm run typecheck` ✅、`npm run lint` ✅、`npm run test` ✅ 512 passed（原 506 + 新 6）。
  - 仍未做（下一步候选，按用户价值排序 同步>UI）：
    1) DO 侧 P0-1 的端到端测试需 workers pool（当前仅单测纯守卫函数）；若要更强证据，接 @cloudflare/vitest-pool-workers。
    2) UI（用户反复强调的重点，尤其看板磁贴拖拽/自由布局/整窗缩放/桌面固定透明）尚未在本轮触碰。
    3) 真实设备三轮 PC-off 验收、厂商推送、R2 灾备仍是既有缺口，需部署授权后进行。
