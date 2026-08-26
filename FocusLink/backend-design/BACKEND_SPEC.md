# FocusLink 后端与共享契约规范

> 状态：v0.12.x 后端单一真相；当前实现 v0.12.104（实施中）
>
> 边界：Electron 主进程持有计时、持久化、外部服务和窗口事实；renderer 只能通过 preload API 请求能力。

## 当前三端同步修复需求（2026-07-22）

- 修复手机与平板在已配置连接后仍报告“同步中断 / 重试失败”的问题；必须分别验证实时控制长轮询与已结束账本同步，不能用其中一条链路成功代替另一条。
- 桌面、Web/PWA 与 Android 继续共享协议、幂等 command id、revision 冲突处理和 completed ledger；移动 renderer 不复制 Electron 业务服务。
- 移动端覆盖安装必须保留兼容的 endpoint、token 选择与本地账本缓存；协议或缓存升级只能做显式兼容迁移，不能靠清除应用数据恢复。
- Android 原生 Keystore 连接与 WebView 偏好必须执行同一旧默认端口迁移；WebView 会话令牌被系统回收不得隐式清空仍服务于活动通知的原生连接。
- 历史 v0.12.53 完成过 Windows 覆盖安装与双 Android 真实联调；当前生产入口已收口为 canonical `foxlink-cloud-mcp` HTTPS origin。本机 Node 服务只允许回环合同测试，Node/Docker production authority 已硬退役。
- v0.12.60 在 v1 实时控制面之外增加 Sync v2：三类实体独立 revision；SQLite/IndexedDB 租约 Outbox、base snapshot、显式 epoch、设备水位、tombstone/graveyard 和冲突中心共同保证本地修改不会被静默覆盖。

## Sync v2 不变量

- Account Durable Object 是唯一账户 authority；Windows、手机和平板都直接访问云端，Electron 不运行内嵌同步服务，不维护 ADB reverse，也不自动配对 Android。
- `focus_ledger_correction_v2` 的 logical identity、payload 时间戳与 opId 必须跨同步轮次稳定。历史缺陷修复只处理无 base 的 correction revision conflict；操作历史保留，真实 conflict 不自动关闭。
- 移动 App 打开并在线时立即拉取账本、任务与 live，并在前台长轮询。被系统结束后不终止云端 live，也不将缓存当成本地计时 authority；重新打开后从 Account DO 收敛。
- 离线移动会话只作为本机临时账本，完成后持久排队。联网时若存在不同 cloud live，状态固定为 `forked-local`，不得自动覆盖或合并。
- ChatGPT MCP 的状态、今日明细和记录列表直接读取私有 Account DO 记录 DTO；D1 只用于诊断。MCP 仅有 `focuslink:read`，不提供写工具或第二套 identity。
- Account DO 冷启动先读取单行 `account_schema_version`；已迁移账户不得在每次唤醒时重放全量 schema/index DDL。旧 `authority_observation_schema_version=2` 账户只补写新标记，避免大账户触发 Cloudflare 行读取上限。
- cloud live 结束必须在同一 authority 中写入 v1 兼容 bundle 与 v2 `focus_ledger_v2`/`focus_metadata_v2`。历史 v1-only 完成账本按有界批次补迁移；已有任一 v2 实体保持不变，不生成重复 ledger/metadata。

- 已结束时间账本不可直接覆盖；时间、segment 或 pause 修正都生成带原因的 correction。
- metadata 以 base/local/remote 三方比较；标题、学科、任务、备注双边异值进入冲突，标签以稳定 tagId 合并。
- 业务写入与 Outbox 同事务；`uploading` 持有有期限 lease；只有 `applied/duplicate` 原子更新 base 后删除 Outbox。
- Bootstrap 固定为 `uninitialized → inventory-uploaded → manifest-received → base-established → v2-active`。generation 或 epoch 改变时保留 Outbox 并重新建立 base。
- 设备 90 天未上线标 stale；tombstone 至少保留 180 天并等待全部活跃设备水位；graveyard 继续阻止旧副本复活。
- 设备令牌使用 `fl2_` 路由格式；账号 DO 只保存 pepper HMAC、scope、过期和撤销状态，token 正文不落日志。
- FocusLink 账号当前只接受管理员派发的唯一 subject `poyi-owner`。首台设备/账号恢复由 canonical identity gateway 验证 owner 后，使用独立 `fia_*` authority 登记；后续设备优先由任一已有合法 `fl2 + sync:write` 的可信设备生成 8 位短码。Account DO 按 `(accountId, installationId)` 的 HMAC 派生稳定 deviceId，并为 Windows、手机、平板、手表分别签发独立 `fl2`。客户端只能获得固定 sync/live read/write scope，不能自报 owner、devices:manage 或 backups:manage。
- 新设备入口固定为 `POST /account/v1/device/bootstrap` 的两阶段合同。`start` 携带严格设备 registration；gateway 返回 `flowId`、只供该流程使用的高熵 `flb_*` poll token 和 canonical `/owner/*` HTTPS 登录 URL。客户端只打开一次系统浏览器，随后用 `poll` 的 `flowId + pollToken` 领取结果；poll token 必须短期、单次消费，日志和诊断只能输出脱敏状态。未完成 owner 登录时直接返回 `authenticated`、轮询中更换 flow/credential、非 canonical 登录 origin 或回退到 installationId 领取凭据均为安全失败。
- endpoint、authority secret、owner subject 和配对兼容层都属于基础设施细节，不进入 renderer 表单。旧合法 `fl2` 原位迁移为已登录；退出只删除本机凭据，不删除账本。移动端必须把稳定 installationId 与 authority 分配的 deviceId 分开保存，重新登录不得制造幽灵设备。
- 推送只传 needSync hint，HTTPS/cursor 始终是数据真相。当前厂商凭据缺失，状态为 `credential-missing`。
- R2 恢复进入 maintenance 并切换 generation 与 epoch。当前账户未启用 R2，Wrangler API `10042` 代表真实备份门禁未通过。

## 1. 分层

```text
src/ renderer
  -> window.focuslink
shared/ipc/api.ts + shared/types.ts
  -> electron/preload.ts
  -> electron/ipc.ts
  -> timer / tasks / sync services
  -> db / integrations / OS
```

- `src/` 不导入 Electron 可执行模块，不读取 SQLite、文件系统或 shell。
- `preload.ts` 使用 `contextBridge` 暴露最小 API，并满足 `FocusLinkAPI`。
- `ipc.ts` 负责输入校验和分发，不复制 Provider、计时或同步算法。
- `shared/` 只保存跨进程类型、尺寸常量和无副作用纯策略。
- 外部集成放在 `electron/integrations/`；同一功能不得出现第二套 source tree。

## 2. 计时数据模型

| 实体/字段         | 语义                             |
| ----------------- | -------------------------------- |
| `FocusSession`    | 一次完整会话及默认任务           |
| `FocusSegment`    | 一段连续有效专注，可覆盖默认任务 |
| `PauseEvent`      | 独立暂停区间                     |
| `activeElapsedMs` | 有效专注，不含暂停               |
| `pauseElapsedMs`  | 暂停累计                         |
| `wallElapsedMs`   | 从开始到结束的自然跨度           |

核心不变量：

- `idle → running → paused → running → finished` 由主进程状态机驱动。
- 暂停会结束当前 segment；继续创建继承 session 默认任务的新 segment。
- 暂停、继续、结束和设置任务等关键边界立即持久化；周期快照只是补充。
- 崩溃恢复读取持久化快照，不通过伪造 UI 操作恢复。
- renderer 只消费 `TimerSnapshot`；显示累计复用 `shared/focus/` selector。
- 45 分专注 + 5 分暂停 + 45 分专注必须得到 90/5/95 分钟三种时间。

## 3. FocusLink 任务模型与可选外部连接

任务工作台的产品语义固定为 FocusLink 自有任务库。滴答 CLI / TickTick OAuth 是用户显式选择的导入/外部副作用连接，不自动成为主数据源。

| 字段/概念                | 取值                                        | 含义                                                                                   |
| ------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Task.source`            | `local` / `ticktick`                        | `local` 是 FocusLink 真实任务身份；外部读取只在导入前保留 `ticktick`                         |
| `Task.projectId`         | 一个真实清单 ID                         | 任务只归属一个普通清单；`local-inbox` 是系统收件箱，全部/完成只是聚合视图             |
| `task_projects.color`    | 受控颜色值                                | 每个清单独立保存；颜色不是身份，两清单可显式选同色，默认分配会避开收件箱色       |
| `AppSettings.taskSource` | `local` / `ticktick-cli` / `ticktick-oauth` | 默认 `local`；后两者只在用户选择导入时使用                                                   |

Provider 的稳定能力应包括：

- 列出项目与任务、按关键字搜索、按 id 回读。
- 创建或更新任务（Provider 支持时）。
- 以 `setTaskCompleted(task, completed)` 完成或恢复任务；IPC 返回规范化后的 Task，而不是仅返回模糊布尔值。
- 将专注记录写入任务或原生 focus；删除或重建错误记录。

任务工作台使用两个稳定 API：

- `window.focuslink.tasks.refresh(options?)` 返回 `IpcResult<TaskWorkspaceRefreshData>`，包含内部实际连接方式、清单、任务和 `refreshedAt`；失败保留精确连接错误。`provider` 仅用于诊断，renderer 不将它渲染成来源切换。
- `window.focuslink.tasks.setCompleted(task, completed)` 返回更新后的 Task。主进程在外部写入成功后更新缓存并广播；若 UI 采用乐观更新，失败必须恢复旧任务。
- `window.focuslink.tasks.updateProject(projectId, {name?, color?})` 只更新一个普通清单；收件箱名称固定。
- `window.focuslink.tasks.moveTask(taskId, projectId)` 移动任务子树；根若原有父任务在另一清单，必须解除根 `parentId`，不留跨清单父引用。

`Task` 的完成语义必须包含 `isCompleted` 和可空 `completedAt`；Provider 返回完成时间时必须规范化为 epoch milliseconds 并写入缓存，恢复未完成后 `completedAt=null`。`createdAt` / `updatedAt` 在 Provider 可用时同样保留，避免排序只能猜测。

工作台采用分阶段加载：

1. 默认 `includeCompleted=false`，dida CLI 仅执行 argv `task filter [--projects] --status 0 --json`，OAuth 仅列出活动任务。
2. 只有用户打开已完成视图时才传 `includeCompleted=true`与 `completedDays`；UI 只提供 30 / 90 / 365 天窗口，默认 90 天。
3. dida 0.1.10 的 filter 不可靠返回已完成普通任务，因此完成历史使用 argv `task completed [--projects] --start-date <iso> --end-date <iso> --json` 单独读取。
4. 活动任务先写入 id map，完成历史只补充缺失 id；历史端点不得用短暂旧状态覆盖已恢复任务。
5. renderer 以 request id 废弃过时刷新，并以 120 项为一批逐步渲染；该上限是渲染策略，不得丢弃已加载数据。

所有 CLI 读写不通过 shell 拼接，刷新或状态写入的 IPC 不得吞掉错误。

### dida checklist

- checklist item 不是普通任务。只持有 `parentId` 时要回读父任务并在父级 `items` 中定位目标。
- 完成子项：更新父任务 `items` 数组，只将目标 `status` 设为 `2`，保留兄弟项与未知字段。
- 取消完成子项：同样更新父任务完整 `items`，只将目标设置为 `status=0, completedTime=null`；兄弟项和未知字段原样保留，不得创建新普通任务代替。
- 原生专注只能关联 dida 接受的父任务身份；本地 segment 仍保留被用户选择的子项上下文。

## 4. IPC 契约

`shared/ipc/api.ts` 是 renderer API 的唯一类型真值。改变任何通道时必须原子更新：

1. `shared/types.ts` 的领域类型。
2. `shared/ipc/api.ts` 的参数、结果和事件。
3. `electron/preload.ts` 的桥接。
4. `electron/ipc.ts` 的校验与 handler。
5. renderer 调用端与测试。

要求：

- 设置更新采用局部对象并与完整设置递归合并；缺失字段表示不修改。
- 慢请求使用 request id 或版本防止旧响应覆盖新状态。
- `sessions.analytics(range)` 是严格只读、范围有界的统计接口。数据库必须选择与范围相交的会话，而不是只按 `started_at` 落点筛选；共享聚合器按自然日裁切 Session、Segment 与 PauseEvent，跨午夜/跨月/跨年数据不得整段归到开始日。该接口不得修改计时、同步队列或外部服务状态。
- `shared/dayLedgerAnalytics.ts` 是有效日与空档分析的唯一纯函数真值，结果通过 `SessionAnalyticsResult.dayLedgers` 暴露给桌面与移动 renderer。默认有效日为 07:00–22:00；观察起点只认真实 segment 边界，pause 以真实 `PauseEvent` 为准并在重叠时优先分类，gap 只在内存中由观察区间内 focus/pause 并集的补集推导，禁止新增 gap 表或同步实体。三类精确时长必须满足 `focus + pause + gap = observation`。
- `DayLedgerAnalytics.tasks` 必须从同一批已裁切、pause 优先的 focus 区间聚合，任务总量与有效专注 KPI 使用同一窗口；缺少可定位 segment 的旧记录只能作为 `estimated` legacy 余量展示，不能把自然日整段时长重新混入任务分配。
- `DayLedgerAnalytics.sessionFocus` 提供同一有效日窗口内的逐会话 focus，供“最长一轮”等 KPI 跨日合并；精确行来自已分区 focus，旧会话只保留按有效窗口裁切的 estimated share。estimated 不得与精确 gap 相加后伪装成同一观察区间或三分类柱高。
- 当天 open segment 可在活动 Session 中延伸到 `min(now, 22:00)`，open PauseEvent 代表 paused 尾段；历史 open 行和缺少 Segment/PauseEvent 的旧会话不得伪造起止，只输出 `estimatedFocusMs/estimatedPauseMs` 与 `estimated=true`。跨午夜、重叠、DST 本地日、历史/今天均由共享纯函数裁切；00–07 与 22–24 不进入统计区间。
- 统计会话详情同时核对 request id 和当前展开 session id；路由卸载会使所有未完成详情请求失效。失败必须清理当前 loading 并保留行内可重试错误，不得产生 unhandled rejection。
- 统计 renderer 只订阅当前 session id 和 timer state 等原子值，不因 `activeElapsedMs` 每秒变化而重渲染整份历史列表。
- 主窗、小窗和托盘共享计时 tick、设置与任务变更广播。
- 外部命令退出码、超时、解析错误、空 id 和 `undefined` 输出都必须可观察且视为失败。
- 不暴露任意命令执行、任意文件读写或数据库句柄给 renderer。

当前任务相关通道为 `tasks:refresh` 与 `tasks:set-completed`。旧 `tasks:complete` 只能作为兼容入口，新的 UI 不得为“恢复未完成”复制另一套通道。

## 5. dida CLI

### 可执行入口

- 手动配置路径优先；其次解析用户 npm 全局目录中的 dida 真实 Node 入口；最后才使用 PATH。
- 安装版、便携版和开机启动环境必须分别验证，不能用开发终端 PATH 推断成功。
- 诊断记录结构化的命令类别、耗时、退出码和脱敏错误，不记录 token。

### 写入规则

- 中文、换行和 JSON 一律通过 `execFile`/argv 传递，不拼 shell 字符串。
- FocusLink 专注摘要优先写任务评论；评论失败才回读并保留原正文后追加。
- 每条 segment 带稳定 marker：`[FocusLink:segment:<id>]`。
- 写入前读取现有评论/正文；marker 已存在则跳过，保证幂等。
- `undefined`、空输出、缺少目标 id 或无法回读证明的写入都不算成功。
- 原生 focus 使用紧凑有效区间：`end = start + activeElapsedMs`，不能把暂停或隔夜 wall time 放大到云端。

### 普通任务完成与恢复

- 完成使用 argv `task complete <projectId> <taskId>`，并拒绝 `undefined` 输出。
- 恢复先尝试 argv `task update ... --status 0 --json`。若当前 dida CLI（已知 0.1.10）未暴露该参数，才使用最小 Open API bridge。
- bridge 只读取 `~/.config/dida-cli/config.json` 中已有 token，不修改配置，也绝不把 token 写入日志、IPC、诊断或错误。
- bridge 必须先 GET 完整任务，再 POST `/open/v1/task/{id}` 写 `status=0, completedTime=null`，最后 GET 二次验证；Dida 可能在恢复后保留历史 `completedTime`，因此回读的显式 `status=0` 才是未完成的权威依据。任一步失败都不能更新本地为未完成。
- TickTick OAuth 完成使用官方 `/project/{projectId}/task/{taskId}/complete`，恢复通过 `/task/{id}` 写 `status=0, completedTime=null` 并回读验证。

## 6. dida 同步队列

- SQLite 是本地事实；结束 segment 后先持久化，再进入异步队列。
- payload 固定记录入队时 Provider，用户之后切换来源不能改变旧项执行方。
- 队列单飞、小批量串行；普通失败有上限，429/限流进入持久化退避且不消耗永久重试次数。
- `synced` 只在外部写入得到可验证结果后设置；pending、failed 和 skipped 不得映射成成功。
- 重新关联、清除或删除时，与后台同步使用同一排他区：先清理旧云记录和相关队列，再修改本地关联。
- 应用退出等待在途写入完成可控交接，再关闭数据库。

## 7. 番茄 To-do

本地数据库写入与云桥是两个阶段：

1. 将带 `[FocusLink:tomatodo:segment:<id>]` marker 的 PCRecord 原子写入本地库，`isSynced=0`。
2. 已有可验证原生桥时，或用户手动同步触发按需桥接后，按会话批量调用 `cloudSyncUploadRecord`。
3. 只有上传接口明确返回 `success` 且本地状态成功持久化后才设置 `isSynced=1`。这叫“上传已确认”，不是独立云端回读。
4. 手机投递是独立阶段：电脑版只有在 `syncGetStatus().connectedCount > 0` 时才调用 `syncRecord`，并以该调用的结果记录 `phoneSyncConfirmed`。云上传成功不能清除手机投递 durable queue。

不变量：

- FocusLink 启动和后台周期重试只探测已存在的可验证桥；客户端关闭时保留本地待上传和持久 segment id，不得为后台补传擅自启动外部应用。
- 本地 JSON 写成功不能显示为云端已同步。
- 用户手动同步且番茄 To-do 未运行时，可以用 `spawn` / `execFile` 参数数组按需启动已知客户端，参数固定包含 `--remote-debugging-port=0`；不得拼接 shell 命令。只有发现实际端口且目标同时通过“番茄 ToDo 标题 + 特征 electronAPI 方法集”身份校验后才能上传；不得选择任意 `page` target。显式 `FOCUSLINK_TOMATODO_CDP_PORT` 失败时不得回退到通用 9222。
- 番茄 To-do 已以普通模式运行但没有可验证桥时，绝不自动结束或重启其进程；返回可操作诊断，要求用户完全退出客户端后再从 FocusLink 连接。
- 已核对番茄 ToDo 1.6.2：`cloudSyncFetchTodo` 只读取待办数据，CloudSyncService 只提供 `fetchTodoData` / `uploadRecordData`，没有专注 PCRecord 的独立云端回读或远端删除 API。因此 bridge 返回 `uploadConfirmed` 与 `cloudRecordReadbackSupported=false`；删除结果固定声明 `local-record-only` 与 `remoteDeleteSupported=false`。
- `isSynced=1` 是番茄 To-do 自有字段，不能同时被解释成 FocusLink 的“手机已显示”。云上传确认与手机 `syncRecord` 投递确认必须由独立状态表达；手机未连接时状态为 `phone-pending`，不能因云上传成功清除 durable queue。
- 已存在且云上传确认的 marker，在请求手机投递时仍必须调用 `syncRecord`；marker 幂等只禁止重复创建 PCRecord，不禁止向尚未确认的手机通道重试。
- 真实手机验证确认专注云投递只保留最近 7 天且按一次性批次消费。超窗记录返回 `tomatodo_record_outside_seven_day_window`，不得因上传 API 返回 success 改成已确认，也不得在未获用户授权时重写记录日期。
- 未识别学科统一归入“学习”；迁移只处理 FocusLink marker 记录，不碰用户其他数据。
- 写盘使用同目录临时文件、fsync、原子替换和备份；Windows `EACCES/EBUSY/EPERM` 做有界退避，持续失败保留旧库。
- 学科更改可请求重新上传；已有 marker 的单个/批量学科修改若因桥不可用或上传失败未写入外部记录，必须把 segment id 写入 durable queue。队列清空前，即使旧番茄记录仍为 `isSynced=1`，状态也必须显示“待上传”，不能把旧学科的成功与新本地选择拼成“上传已确认”。
- 删除只能确认本地 marker 清理。没有远端 API 时不得声称已回读或已清理云端记录，两个同步域互不冒充对方成功。

## 8. FocusLink 跨设备同步

跨设备同步是独立于 dida `sync_queue` 与番茄 To-do durable queue 的第三个同步域。它复制
FocusLink 自己的专注账本，不代表记录已经写入滴答或番茄 To-do，也不得复用后两者的状态文案。

已结束账本平面以完整会话包为原子单元：`FocusSession + FocusSegment[] + PauseEvent[]`。协议真值
位于 `shared/sync/deviceProtocol.ts`，固定包含 `protocolVersion`、设备 ID、幂等 `opId`、实体
revision、服务端单调 change sequence 与不透明 cursor。规则如下：

### Focus Guard V1 加密实体合同

`focus_guard_rule_v1`、`focus_guard_state_v1`、`focus_guard_completion_v1` 与
`focus_guard_config_v1` 复用同一个 Sync v2 change feed，但正文必须始终是
`EncryptedFocusGuardEnvelopeV1`。Account DO 只验证精确 envelope、entity type、revision、
fingerprint、tombstone 和 cursor，不持有或生成 32-byte account root，也不读取明文。

Envelope 固定且不允许额外字段：`version=1`、`algorithm=A256GCM`、
`product=focus-guard`、与 entity type 一致的 `entityKind`、96-bit base64url `nonce`、
base64url `ciphertext`、64 位十六进制 `aadHash`、`aadBaseRevision`、
`operation=put|restore`、`createdAt`。AAD 固定绑定
`product | entityType | entityId | aadBaseRevision | operation`；删除只使用 Sync v2 tombstone，
不伪造“加密空对象”。

解密后的 V1 明文字段冻结如下；这些字段只存在于受信客户端内存和设备安全存储，不进入
authority 日志或服务端索引：

| entity type                 | 稳定 entity id               | V1 明文字段                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `focus_guard_rule_v1`       | `guard-rule:<uuid>`          | `ruleId`、`ruleType=supervision \| sleep`、`name`、`enabled`、`priority`、`schedule{timeZone,weekdays,startMinute,endMinute}`、`limits{continuousUseMs,cumulativeUseMs,lockMs}`、`applicationPolicies[]`、`whitelistPackages[]`、`lockMode=normal \| strong \| brick`、`allowSkip`、`maxPauseMs`、`expiresAt`、`updatedAt` |
| `focus_guard_state_v1`      | `guard-state-focuslink-live` | `state=idle \| running \| paused`、`sessionId`、`revision`、`observedAt`、`expiresAt`；TTL 默认 90 秒、最大 300 秒，只供短期展示，永不作为永久锁机授权                                                                                                                                                                     |
| `focus_guard_completion_v1` | `guard-completion:<uuid>`    | `completionId`、`ruleId`、`ruleType`、`outcome=completed \| skipped \| interrupted`、`startedAt`、`endedAt`、`activeMs`、`lockedMs`、`sourceRevision`                                                                                                                                                                      |
| `focus_guard_config_v1`     | `guard-config:global`        | `supervisionEnabled`、`sleepEnabled`、`notificationsEnabled`、`ladder{enabled,thresholdMs,useMs,lockMs}`、`updatedAt`                                                                                                                                                                                                      |

字段级边界：`applicationPolicies` 只保存用户声明的可移植包名、模式和时长/次数阈值；
`whitelistPackages` 只保存用户选择的包名。Android UID、应用是否已安装、权限结果、ROM
能力、解析后的本机组件、Keystore 材料、token、root、当前锁机授权、日志和原数据库行均禁止
进入明文。跨设备恢复必须把包不存在或能力不匹配保留为本机待处理状态，不能改写云端规则。

阶段 B 的本地 root 实现另有独立合同：32-byte account root 由受信本地 provisioning 生成，
owner recovery 使用 HKDF-SHA256 recovery envelope，rotation 使用旧 root 加密的新 root，
二者都绑定 account、fromGeneration/generation、purpose、AAD 与 createdAt。Windows 只允许
Electron `safeStorage` 包裹 root material 并做 temp/fsync/rename/readback；Android 只允许独立
Keystore alias 包裹 root material，普通偏好仅存密文 envelope 与非敏感 metadata。root generation
或 rotation 字段不得添加到 V1 guard envelope；生产 publisher、解密桥、Worker/DO/gateway 和
schema 变更仍未接线，阶段 C/D 需单独批准。

Windows 的 root material 写入在同一 root 文件的进程内 mutex 下执行，并在落盘前复核记录
SHA-256 版本，避免两个 desktop store 实例互相覆盖。加密 material 与记录 metadata 必须同时
绑定 `accountPublicId + generation + keyId`；`revoked` 是不可逆终态，任何降级、恢复或旧 generation
写入都被拒绝。root writer 只在 Electron main 的本地 vault 中存在，不向 renderer/IPC 暴露，也不等同于
已批准的跨设备 Focus Guard publisher。

冲突和兼容规则：

- rule/config 使用 `expected baseRevision + baseFingerprint`；同字段双边变化在将来的解密桥中
  进入显式冲突，不允许 last-write-wins。state 使用固定 ID、严格 revision 与短 TTL；过期、
  rollback 或同 revision 异文全部 fail-closed。completion 以稳定 ID 幂等且写后不可覆盖。
- 四类实体沿用现有 180 天 tombstone、水位、graveyard 和 purge 门禁。restore 必须引用当前
  tombstone revision；旧副本不能复活已删除规则或配置。
- 能识别 V1 但尚未持有 root 的 Electron、Web/PWA/Android reader 必须验证并原样保存
  envelope，不得解密猜测或因 guard 类型拒绝整页；无效 envelope、未来未知 entity type、
  非单调 changeSeq/cursor 或 revision rollback 必须在提交 cursor 前隔离/失败。
- Android 原生 completed-ledger Worker 是 cursorless writer，不消费 change feed；它可以忽略
  响应中的 guard change，但不得复制、解密或写入第二份 guard 缓存。移动 renderer 仍是唯一
  Android Sync v2 reader。

- 账本平面仍只复制 `finished` / `aborted` 会话；活动快照和控制命令绝不塞进 completed bundle，也不改变现有桌面端已结束会话补传语义。
- `cloudFocusId`、第三方投递结果、CLI/OAuth 凭据、TomaToDo 路径、窗口/快捷键/小窗设置均不进入会话包。
- 服务端以 `(account, opId)` 去重；稳定 `opId` 同时包含实体、正文与 `baseRevision`，相同 op 重放返回 `duplicate`，`baseRevision` 过期返回 `conflict`，不使用客户端 `updatedAt` 静默覆盖。
- Electron 以 SQLite 完成会话为耐久事实源，网络失败后下次重新扫描补传；cursor、每个会话的已确认 revision/fingerprint 与未解决冲突写入同一个原子 `app_meta` 检查点。Sync v2 transport checkpoint 按“规范化 endpoint + 完整 device token 的不可逆摘要”分区；dida/TomaToDo provider queue 则使用独立 `providerScope`：canonical `fl2` 为 endpoint + accountPublicId 的匿名哈希，legacy loopback 才按凭据哈希。切换服务/账号不得复用旧状态；服务明确返回 `invalid_cursor` 时清理当前分区并完整重试一次。Web/PWA/Android 若从旧安装或旧账号缓存恢复出无效 cursor，也必须识别结构化 `invalid_cursor` 错误码，清空该设备的旧账本缓存并从空 cursor 重建一次；禁止保留旧账号会话或按错误文本无限重试。
- Android/Web 的本机离线会话使用同一 completed bundle 协议，不新增移动端业务服务。活动草稿和待上传 bundle 分开存入 IndexedDB；结束操作必须在一个事务中写入稳定 `opId` 的 pending 记录并删除活动草稿。每次在线账本拉取前先串行补传 pending，只有 `applied/duplicate` 删除，`conflict/rejected` 或网络失败保留；普通“清缓存”不得删除 pending。移动端应用沙箱保护账本，Android token 仍只存 Keystore，Electron token 仍只存 `safeStorage`，日志、overlay 和通知均不得输出令牌或 endpoint。
- Windows 登录项的有效策略为“用户显式自动启动”或“跨设备同步已启用且 autoSync 已启用”。后一种情况必须隐藏启动并常驻托盘；睡眠恢复后重新确认 canonical HTTPS 连接并立即跑一次同步。回环开发后端只允许测试进程显式启动并监听 `127.0.0.1:18787`，不得由 Electron 自动启动或开放 LAN。
- ADB 只用于显式构建、安装、版本回读和 instrumentation；Electron 运行期不得枚举设备、维护 `adb reverse`、自动配对或把手机流量中继到本机测试后端。生产移动端始终直连 canonical HTTPS authority。
- 拉回的全新会话在一个 SQLite 事务中插入 session/segments/pauses，并在同一事务写入按 `(connectionScope, sessionId, provider)` 唯一的 `dida` / `tomatodo` 回写意图；事务内绝不执行外部副作用。提交后 coordinator 才以 SQLite 原子 claim/lease 消费，两个 provider 分别完成或指数退避，过期 lease 可跨重启回收；滴答复用 marker 幂等的 `sync_queue`，番茄 To-do 复用 durable segment queue，后台不得启动外部客户端。同一次 cursor catch-up 的所有响应页先在内存按实体折叠到最新 revision，完整收敛后才写 SQLite 与原子检查点；中途断网不会暴露旧 revision。拉取完成后的既有记录或已改动的同 ID 正文写入耐久冲突箱。冲突未解决时界面不得清空错误或宣称完全收敛。
- 服务端对 cursor 之后同一实体的多次历史 revision 先折叠为最新状态，再按 change sequence、条数与响应字节预算分页；全新设备不得先导入旧 revision 再把同一批历史误判为本地冲突。
- 当前桌面端不执行远端删除，也不自动覆盖已有会话；删除/编辑冲突需要后续显式清理与合并流程。
- Electron 访问令牌只经 `safeStorage` 加密落盘，不进入 `AppSettings`、renderer 日志或多端 payload。
- 回环测试后端可生成 2 分钟一次性配对 offer；生产保留可信设备 `/pair/offers` → 新设备 `/pair/exchange` 兼容路径，并新增新设备 `/pair/requests` → 可信设备 `/pair/approve` → 新设备 `/pair/claim` 的反向批准路径。两条路径都使用 8 位数字码和 10 分钟 TTL。反向路径的短码只能批准，不能领取凭据；高强度 request token 只留在申请设备，DO 对短码/token 分别保存域分离 HMAC。claim 未批准返回 202，批准后按 installation 稳定绑定独立 `fl2`，成功响应丢失可在请求 TTL 内幂等领取。public edge 用 client + 凭据摘要双键限流，日志不记录请求体、code、request token、nonce 或设备令牌。Android 领取后的令牌进入 Keystore，Electron 进入 safeStorage。
- Electron 只有在首次 `GET /sync/v2/live` 成功并通过协议校验后才切换到实时事实源；握手失败时保持本机 idle/计时可用，并以 `2s → 4s → 8s … → 60s` 有界退避重连。已确认的 running/paused 实时会话断线时不得切回本机空闲状态或伪造云端确认。
- 生成 completed bundle 时，旧版本遗留的暂停孤立引用只在传输副本中归一为 `segmentId: null`，原始 SQLite 行不被静默删除；诊断必须记录会话 ID 和孤立数量。

`cloud/` 的默认开发入口仍是回环测试后端：默认监听 `127.0.0.1`，启动必须显式提供
`FOCUSLINK_CLOUD_TEST_TOKEN`，执行精确 CORS allowlist、Bearer 鉴权、512 KiB 单会话包上限与请求/响应各 1 MiB 字节预算；请求和响应都按序列化字节切页，可用
忽略目录中的单进程 JSON 文件持久化。

生产 Cloudflare Sync v2 的唯一数据 authority 是 `cloudflare/accountDurableObject.ts` 的 Account Durable Object。`cloudflare/worker.ts` 只作为私有 service-binding authority adapter：`wrangler.jsonc` 固定 `workers_dev=false`、`preview_urls=false`；不得创建未经登记的 `workers.dev`、preview 或任意用户自定义入口。生产客户端仍以 canonical `foxlink-cloud-mcp` HTTPS origin 作为身份与默认地址；为应对部分网络对 `workers.dev` 的 DNS/443 阻断，数据面额外允许固定的 `https://focuslink.pyzzgk.dpdns.org` failover，两个 origin 必须指向同一 adapter，且只在传输失败时按固定顺序重试。OAuth、owner session、CSRF、resource/audience 与登录 URL 仍只走 identity gateway；客户端不得接受任意用户域名、不得把 failover 当作登录域、不得改指向私有 Worker。

新设备登录的部署顺序不可交换：先在私有 FocusLink Worker 与 canonical gateway 分别配置同一代、独立于 device/OAuth/MCP 的 `fia_*` authority secret；再部署私有 `/sync/v1/devices/register` 与 Account DO migration；随后部署 gateway 的 bootstrap flow store、owner session/CSRF approval 和私有登记转发；最后运行 start/poll 正负测试并撤销旧 secret。回滚时先停止新 flow，再保留旧 `fl2` 数据面和已登录设备，不得撤销现有 device credential。仓库内合同通过或 dry-run 均不等于 gateway 已上线。

Node `cloud/server.ts` 仅保留显式 token 的 `127.0.0.1` 合同测试后端。`startPersonalCloud()` 与 `FOCUSLINK_CLOUD_MODE=production` 固定失败；`cloud/Dockerfile` 是不可启动 authority 的退役标记镜像，Compose 不再声明 Node cloud API、静态 bearer 账号或持久卷。Node 不能作为应急 production authority，也不能绕过设备撤销、scope、Account DO 事务或 MCP 投影。

canonical adapter 与私有 authority 的路由表如下。`/v1/*`、`/v2/*` 和 `/sync/push` 均为已退休外部路径，adapter 与私有 Worker 都不得回退：

| Canonical path                   | 方法       | 凭据 / scope                                                                               | 私有 Account DO 路径             |
| -------------------------------- | ---------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| `/sync/v2/status`                | GET        | device token · `sync:read`                                                                 | `/v2/sync/epoch`                 |
| `/sync/v2/exchange`              | POST       | device token · 无 mutation 时 `sync:read`，有 mutation 时 `sync:write`                     | `/v2/sync`                       |
| `/sync/v2/tasks`                 | GET / POST | device token · `sync:read` / `sync:write`                                                  | `/v1/tasks`（仅 DO 内部）        |
| `/sync/v2/live`                  | GET        | device token · `live:read`                                                                 | `/v1/live`（仅 DO 内部）         |
| `/sync/v2/live/wait`             | GET        | device token · `live:read`                                                                 | `/v1/live/wait`（仅 DO 内部）    |
| `/sync/v2/live/command`          | POST       | device token · `live:write`                                                                | `/v1/live/command`（仅 DO 内部） |
| `/sync/v1/pair/offers`           | POST       | pair-service authority，或已有 `fl2` 由 DO 最终校验 `sync:write`；设备路径强限流           | `/v2/pair/offers`                |
| `/sync/v1/pair/exchange`         | POST       | 8 位短码 + 完整 installation metadata，或兼容一次性高熵 nonce；不得要求已有 bearer         | `/v2/pair/exchange`              |
| `/sync/v1/pair/requests`         | POST       | 无 bearer；完整 installation metadata；返回短码与仅本机保存的高强度 request token          | `/v2/pair/requests`              |
| `/sync/v1/pair/approve`          | POST       | 已授权 device token · `sync:write`；只提交 8 位短码                                       | `/v2/pair/approve`               |
| `/sync/v1/pair/claim`            | POST       | 无 bearer；request token + 与申请完全一致的 installation metadata                          | `/v2/pair/claim`                 |
| `/sync/v1/devices/register`      | POST       | 仅 identity gateway 的独立 `fia_*` + 精确 `poyi-owner`；公网客户端不得直连                 | `/v2/devices/register`           |
| `/internal/mcp/v1/focus/summary` | GET        | 仅 MCP service binding credential；公网 OAuth 由 `foxlink-cloud-mcp` 校验 `focuslink:read` | 同名内部投影                     |

Account DO 保存实体、revision、reservation/result、change feed、任务快照、实时会话、commandId 与设备 credential HMAC；每个请求在 DO 内执行真实 scope、过期、撤销、跨账号和 `deviceId` 绑定检查。任何日志、响应或同步实体都不得返回 token。`/healthz` 只证明进程存活；`/readyz` 必须验证必需 secrets 与 Account DO SQLite probe，不能把配置存在冒充 authority 可写。

### 同步健康与错误呈现合同

- canonical `foxlink-cloud-mcp` 公网 adapter 的匿名存活探针是 `GET /healthz`；本机 loopback 测试后端才使用 `GET /health`。`/healthz` 成功只证明当前 DNS/TCP/TLS/adapter 请求链可达，不证明设备 token、scope、Account DO 读写或历史同步已成功。
- `GET /sync/v2/status` 是只读 canonical 状态路由；无凭据返回 401 只能证明路由存在且鉴权 fail-closed，不能冒充已存凭据通过。bootstrap inventory/entities 是会创建或更新服务端 bootstrap 状态的 POST 路由，禁止作为 health probe。
- `deviceSync.lastErrorV2.<scope>` 保存的是最近一次结构化同步结果码，不是单一的连接布尔值。`network_error`、超时与 HTTP/credential 错误属于 transport/auth 失败；`conflict_present` 表示同步请求已完成但本机仍有耐久冲突，`rejected_operation` 表示操作被拒绝。后两者不得显示为“当前连接失败”。
- 一次成功同步可以同时留下 `lastSyncAt` 和 `conflict_present`。界面必须结合结构化 error code、`unresolvedConflicts`、最近一次已验证 transport 时间和 live telemetry 呈现；禁止依赖本地化错误文案的正则匹配，也禁止把任意非空 `lastError` 统一映射为 danger/“跨设备同步失败”。
- `conflict_present` 且 `unresolvedConflicts > 0` 的固定语义是 warning：“同步已连接，有记录待确认”；冲突记录继续安全保留，不自动覆盖。`network_error` 只有在最近一次真实请求失败且尚无更新的成功证据时才能呈现“同步服务未连接”。
- 诊断必须同时保留历史失败和当前探针事实：日志中的早先 `network_error` 不因当前 health 恢复而被改写；当前 health 恢复也不能清除尚未解决的冲突。不得通过清 token、清缓存、删数据库或重做 bootstrap 掩盖状态分类错误。

Cloudflare 外部协议 gate 是受限测试操作，不是部署入口：external run/verify 必须显式 opt-in，目标只能是 `127.0.0.1` 的 disposable Worker。`FOCUSLINK_TEST_STATE` 只能是项目 `.tmp` 或系统临时目录下允许名称的直系状态文件；父目录与文件均须拒绝 junction/symlink/非普通类型，创建使用 exclusive create，读取与删除前复核文件身份，序列化状态不得包含 credential。external verify 不自动删除外部状态文件，因为它没有可证明的所有权能力；只有 local 隔离 gate 在自建临时根内自动清理自己的状态与持久化目录。

中央 authority 读取 FocusLink 状态时只能绑定 named entrypoint `FocusLinkAuthorityObservation`，默认 Worker 对 `/internal/authority-observation/v1` 固定返回 `service_binding_required`。中央 canonical registry 将 FocusLink 固定映射为 `productId=identity-focus`；请求必须精确携带 vendor `Accept`、32–512 字符安全 token 形式的独立 `Capability` secret 和完整 HTTPS `/authority/identity-focus` audience，device/OAuth/MCP/pair 凭据均不能替代该 capability，产品不得另加中央不识别的前缀约束。Account DO 以真实 v2 change sequence、live revision、device watermark、generation、maintenance 与 conflict 状态生成 checkpoint fingerprint；fingerprint 改变时立即递增 observation revision。有效 TTL 内的 named GET 先在同一 DO SQLite 事务中探测 schema/meta/live 依赖，再原字节返回既有 snapshot；snapshot 缺失、损坏或到期时，只有依赖探测通过才推进新的 verification checkpoint revision 并持久化新 snapshot，相同业务 fingerprint 也不改写旧 revision。DO 内部 `authority_observation_schema_version=2` 移除旧 `state_hash` 唯一约束以保存这些续期 checkpoint。同一 revision 的 truth、`observedAt`、`expiresAt` 与序列化正文永不重写；缺配置、依赖失败、额外字段或不可用 revision 全部非 200，由中央 authority 在校验后另行计算 observation hash 和签名。

实时活动会话是独立控制平面，协议真值位于 `shared/sync/liveFocusProtocol.ts`。Web/PWA、Android
与显式开启实时控制的 Electron 同步同一账号下的唯一活动会话。Electron 由
`timer/focusTimerController.ts` 统一承接 IPC、托盘、快捷键和窗口快照；实时模式中本地
`TimerManager` 必须保持 idle，不得生成第二份活动账本。实时规则如下：

- 状态仅为 `idle / running / paused`，合法迁移是 `idle→running`、`running→paused`、`paused→running` 以及活动态经 `finish/abort` 回到 idle。服务端持有 revision 与时间边界，客户端只做显示外推。
- 每个命令含随机稳定 `commandId`、发起 `deviceId`、目标 `sessionId` 与 `expectedRevision`；相同正文重放返回 duplicate，同 id 不同正文被拒绝，旧 revision 返回 conflict 和最新快照。
- canonical HTTPS 下的 Electron live command、任务快照和 Sync v2 mutation 必须统一从 `fl2` 凭据解析 `device-<devicePublicId>`；不得把 legacy SQLite `deviceSync.deviceIdV1` UUID 填入受设备令牌绑定校验的写请求。回环合同测试允许继续使用本机 UUID。
- 云端快照已确认 idle 后，start 若因传输不可达或 HTTP 401/403 未被确认，Electron 必须先取消长轮询、退出 live fact source、记录分类诊断，再启动本地 TimerManager；本地开始不能被失效凭据卡死。若云端或本地任一侧已经 running/paused，则禁止该降级，继续保留权威/冲突保护。
- start 由客户端生成 session id，可携带有界标题与可选任务上下文；同一账号一次只能有一个活动会话。pause/resume/finish/abort 必须命中当前 session，陈旧通知或快捷设置动作不能作用于下一轮。
- `GET /sync/v2/live` 返回当前快照；`GET /sync/v2/live/wait` 只在 revision 前进或有界超时后返回，HTTP 断开必须释放 waiter；`POST /sync/v2/live/command` 处理幂等命令。三者都经 canonical adapter，私有 authority 复验 device credential 与 scope。
- 每个响应给出 `serverTime`，并把 active/pause/wall 三时间物化到该时刻。running 后只有 active 与 wall 增长，paused 后只有 pause 与 wall 增长；客户端从该基点逐秒显示，不能用本机时间改写云端事实。
- finish/abort 在同一次持久化提交中闭合当前 segment/pause、生成通过 completed-bundle 校验的完整 Session/Segment/Pause，并写入现有账本 change log；其他设备随后用原 cursor 协议拉回，不能观察半个会话。
- 实时快照携带 segment/pause 边界；Electron 以 `serverTime` 计算本机时钟偏移后投影 `TimerSnapshot`。由任一设备结束时，Electron 必须先运行账本拉取并确认完整 bundle 已进入 SQLite，再发出 `finished` 快照触发 dida/TomaToDo 副作用。
- 实时快照、命令幂等记录与 completed ledger 共用账号级原子 JSON 提交并向后兼容旧测试文件；进程重启后必须保留活动时间边界和命令去重。该 JSON 仍只允许单进程本地测试。
- dida 和番茄 To-do 始终是桌面副作用。移动命令与实时快照不携带凭据或伪造投递结果；结束会话进入 FocusLink 账本后，只有桌面端真实执行相应队列并得到可验证结果才能显示外部同步成功。
- Android 前台 Service、通知动作与 Quick Settings Tile 是薄传输层：只保存当前显示快照和至少一次 native command 队列，不自行推进业务计时，不在云端确认前乐观翻转。快照的 `localAuthority=true` 表示 WebView 正在运行本机离线会话；此时 Service 不上传 native 云端命令，迟到的云端响应也必须在 Store 原子门禁处被拒绝，不能覆盖本机通知或 overlay。待处理云端动作必须含 session/revision 并支持冷启动 drain/ack；只有匹配 command id 的 applied/duplicate/conflict/rejected 才能完成本地队列项。
- Android completed-ledger native mirror 由唯一 WorkManager work 承载，要求 `NetworkType.CONNECTED` 和指数退避；WorkManager 负责进程死亡、boot、网络恢复与 Doze 后续跑，boot/package-replaced receiver 只在 Keystore 身份仍有效且 native outbox 非空时补排。401/403、撤销和 revision rollback 写入固定诊断并停止自动重试，记录保留到显式凭据修复；不得退回 JobScheduler、明文 HTTP 或第二 cursor。
- Android 后台只读刷新采用自调度链而非周期 Future：主线程触发单线程 HTTP 请求，请求的 `finally` 安排下一次 20 秒刷新，任何异常不得永久取消后续轮询。最近尝试次数、成功时间、revision 与错误写入本机诊断状态。本机权威期间允许记录探测成功，但不得 `putSnapshot/applyCloudSnapshot`；其余云端快照写入按 revision 单调拒绝旧值，idle 必须保留 revision。
- Android 系统表面由 `SystemFocusSurfaceProvider` 选择，`StandardNotificationAdapter`、`XiaomiIslandAdapter` 与 `HuaweiCapsuleAdapter` 只共享脱敏 `FocusRuntimeSnapshot`，不共享厂商载荷。小米使用稳定业务 ID、通知 ID 与协议 3 start/running/pause/resume/finish 投影；能力证据依次为 `unsupported/protocol-selected/systemui-accepted/visually-verified`，最后一级只能由真机截图和人工矩阵写入。标准 ongoing notification 始终独立可用；华为既有 TIMER/capsule 字段与布局保持不变。
- Android 的沉浸系统栏与画中画由 `MainActivity` 通过公开 API 提供，Capacitor 插件只暴露能力、当前状态和显式用户动作。结束活动会话后 renderer 必须恢复系统栏；画中画不支持时返回结构化 `supported: false`。这些显示能力不得引入第二套计时器、kiosk/设备所有者权限或厂商私有 API 依赖。
- Android 桌面后备计时使用 `TYPE_APPLICATION_OVERLAY` 和显式 `SYSTEM_ALERT_WINDOW` 特殊授权，默认关闭且不得因通知可用而自动显示。点按显示关闭按钮并在 3 秒无操作后收起；关闭持久禁用 overlay，但不结束会话或通知，重新启用只能来自应用设置。拖动目标坐标通过 `postOnAnimation` 每帧最多更新一次，拖动期间缓存安全区/尺寸，背景 drawable 按状态复用；位置继续归一化持久化并在配置变化后重新夹取。

云端任务清单使用独立的权威快照平面，协议真值位于 `shared/sync/taskSnapshotProtocol.ts`；其内容来源是 FocusLink 自有任务库或用户显式导入后归一化的本地副本：

- 电脑端每次成功读取或修改 FocusLink 任务工作台后自动发布清单与任务快照；发布失败只记诊断，本地任务仍可用。
- 项目 V1 未单独携带 `updatedAt`；合并时以快照 `publishedAt` 与 SQLite `task_projects.updated_at` 比较，旧快照不得回退刚在本机修改的名称/颜色。
- 快照只包含选择专注所需的任务 ID、来源、标题、项目、优先级、到期日、标签、父子关系和完成状态；不包含任务正文、原始 JSON、CLI/OAuth 凭据或第三方写入能力。Checklist 子项在传输时展平并保留 `parentId`。
- 云端按账号保留最后一份完整快照，内容相同的同设备重放不增加 revision。Web/PWA/Android 使用 `GET /sync/v2/tasks` 读取并写入 IndexedDB；PC 关闭或任务服务暂时不可达时继续使用最后一次缓存。
- 任务快照 GET/POST 必须 `Cache-Control: no-store`；`publishedAt` 只是客户端排序提示，Account DO 与 loopback 必须只接受 `publishedAt <= serverTime + 5 分钟`，超限统一返回 HTTP `422` / `task_snapshot_timestamp_too_far_ahead`。已保存且超出该窗口的旧快照是 legacy far-future 状态，下一份合法快照可替换它；正常 register 保持相同 source/payload 幂等、较旧 timestamp 为 `409 stale_task_snapshot`、同 timestamp 异文为 `409 task_snapshot_conflict`。移动端前台每 15 秒自动拉取并在恢复可见、登录或连接 epoch 变化时立即拉取。revision 只能前进：低 revision 响应不得覆盖缓存；同 revision 若 source/payload 不同视为 authority 不一致并保留当前快照。桌面端仅在当前 connection scope/generation 内收到上述 422 时，至多一次 GET 可信 `serverTime`、重戳原 payload 后重试一次；成功回读同一 source device/payload 或 stale 才可清除 durable pending，conflict、第二次 422、GET/解析/重试失败或连接变化均必须保留 pending，不能递归重试。
- 移动端开始实时会话时可以携带快照中的任务上下文，也可以不关联任务自由开始。任务上下文最终进入 completed bundle，PC 拉回后仍由桌面端执行 dida/TomaToDo 副作用。
- 移动端不直连滴答，只读写同一 FocusLink 账号任务快照；任务创建、完成、清单改色/重命名与任务移动均是完整快照 mutation，成功回读后才更新 IndexedDB 缓存。

## 9. 小窗与边缘状态

- 只有 `collapsed` 和 `expanded` 两种合法尺寸，数值唯一来自 `shared/miniWindowLayout.ts`。当前为 `184×44` 与 `256×70`，不引入第三尺寸；44px 收起高度避免 Windows 原生无框最小高度与 renderer 内容尺寸错位，常量变化必须同步更新前端规范。
- `MiniWindowDockPlacement` 在四条边之外区分四个 corner placement；角落收起/展开必须同时锚定 X/Y 两轴。主进程通过 `mini:dock-transition` 明确发送 `prepare / settled / cancel` 与 edge/placement，renderer 不得从 CSS 猜测原生屏幕位置。
- Windows 原生移动循环结束后才允许吸附与收起；纯展示进度轨必须保留 `-webkit-app-region: drag`。用户拖离 release hysteresis 后在新位置展开，任何 programmatic bounds 变化都不得被误判为新的用户拖动。
- collapsed renderer 契约仅允许进度/状态、当前时间、底部 2px 当前分钟秒级消逝轨和展开入口；该轨不是专注率。不传达任务详情、三组累计或其他控制。expanded 契约须在 74px 内容盒内完整呈现任务名、当前时间、累计专注/暂停/总历时与全部控制，时间与按钮分属独立网格行、结构上不重叠或换行。验收字号为 collapsed 25px、expanded 至少 21px。
- Electron 主进程持有真实 bounds、当前显示器 work area、吸附边缘和窗口状态。
- Windows 通过 `WM_ENTERSIZEMOVE` / `WM_EXITSIZEMOVE` 明确区分按住与释放；按住不动时不得用 move 事件静默时间猜测释放。真正结束后才计算最近合法边缘，使用进入 14px / 离开 30px 双阈值；先吸附并保持 expanded 尺寸，renderer 接收 `mini:dock-transition` 显示 320ms 收束反馈，之后才切换 collapsed；过渡中再次 native move 必须取消待折叠任务。程序化 bounds 允许 2px DPI 归一化误差。
- 展开必须向 work area 内部生长并校正坐标；多显示器、负坐标和不同缩放比均要覆盖。
- 拖离所有边缘 140ms 后自动展开；点击箭头立即展开并设置 900ms 防回弹。换尺寸时固定接触边并围绕视觉中心调整位置。
- 手动展开、显式收起、主题/状态变化和重启恢复通过稳定事件广播，不由 renderer 猜测 native resize。
- 不恢复 freeform resize。旧宽高在设置迁移时归一化到最近合法预设。

## 10. renderer 健康、日志与托盘生命周期

- 主窗和小窗都监听 `unresponsive`、`responsive`、`render-process-gone` 和 `did-finish-load`。短暂阻塞先给 5 秒恢复窗口；仍无响应时用 `reloadIgnoringCache()` 重建 renderer。
- 受控恢复每 60 秒最多 3 次，超限后等到时间窗重置，禁止无界重载循环。计时器、session 和 SQLite 事实留在主进程，renderer 恢复不能终止当前专注。
- 日志元数据序列化必须保留 `Error.name/message/stack/cause`，支持 bigint 与循环对象降级；不得再把未捕获异常记成无信息的 `{}`，日志失败也不得触发第二次异常。
- HTTP 错误必须先包装成 Error 再进入日志，至少保留 status、协议 code 与安全截断的 message；禁止 `throw { code, message }` 后退化为 `[object Object]`。实时 start 失败必须记录是否执行本地降级，且日志不得包含 bearer token。
- 托盘、快捷键与主 snapshot 广播的运行时初始化必须幂等。窗口 `ready-to-show` 与已加载回退竞态只能创建一个托盘和一份 snapshot 监听；设置更新不重建托盘。退出时解除可解除监听并销毁托盘。

## 11. 数据安全与迁移

- schema 迁移单调、幂等，在事务中执行；禁止无版本地重写用户数据库。
- 删除 session/segment 使用事务并协调两个外部同步域。外部清理失败时保留足够本地事实供重试。
- OAuth/token 使用系统安全存储或既有凭据层，日志和导出不得包含密钥。
- 回归/自测只使用隔离的 `test-data` 或临时目录，不打开用户真实 Electron/FocusLink 数据。
- 用户数据导出支持 JSON/CSV/Markdown，但导出不改变同步状态。

## 12. 状态文案契约

- `已关联 / 未关联`：本地 task id 是否存在。
- `已同步 / 未同步 / 同步失败`：dida 队列是否得到云端可验证结果。
- `已写入本地 / 待上传 / 上传已确认`：番茄 To-do 两阶段状态；“上传已确认”不得解释为独立云端回读或远端可删除。
- session 没有默认任务但存在已关联 segment 时，摘要不能显示“未关联”。
- 禁止“可同步”“应该成功”等无法证明结果的状态。

## 13. 变更规则

- 计时语义变化：更新状态机/manager、shared selector、数据库、恢复测试和 45+5+45 场景。
- 任务能力变化：更新 CLI 优先/OAuth 后备连接策略、IPC、`completedAt` 缓存、分阶段加载、任务页、6 秒撤销与失败回滚测试。
- dida 写入变化：保留 argv、comment-first、父 checklist、marker、undefined 失败，并执行真实临时任务验收。
- 番茄变化：分别验证后台不启动外部应用、手动同步在未运行时用参数数组和端口 0 按需启动、已普通运行时绝不杀进程、身份校验、上传接口确认、学科修改和本地 marker 删除；独立云端回读/远端删除只有 API 真正提供后才能加入门禁。
- 小窗变化：同步 shared 常量、settings 迁移、Electron bounds、CSS 和 smoke；不把数字复制到文档以外的多处代码。
- 统计/生命周期变化：覆盖详情 request id、tick 渲染边界、renderer 恢复预算、Error 序列化和托盘监听幂等性。
- 发布变化：执行 [TEST_AND_RELEASE.md](TEST_AND_RELEASE.md) 的全部门禁并推送 `main`；只有用户明确要求时才创建公开 tag 和 GitHub Release。
