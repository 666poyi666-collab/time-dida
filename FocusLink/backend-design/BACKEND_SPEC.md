# FocusLink 后端与共享契约规范

> 状态：v0.12.x 后端单一真相
>
> 边界：Electron 主进程持有计时、持久化、外部服务和窗口事实；renderer 只能通过 preload API 请求能力。

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

| 实体/字段 | 语义 |
| --- | --- |
| `FocusSession` | 一次完整会话及默认任务 |
| `FocusSegment` | 一段连续有效专注，可覆盖默认任务 |
| `PauseEvent` | 独立暂停区间 |
| `activeElapsedMs` | 有效专注，不含暂停 |
| `pauseElapsedMs` | 暂停累计 |
| `wallElapsedMs` | 从开始到结束的自然跨度 |

核心不变量：

- `idle → running → paused → running → finished` 由主进程状态机驱动。
- 暂停会结束当前 segment；继续创建继承 session 默认任务的新 segment。
- 暂停、继续、结束和设置任务等关键边界立即持久化；周期快照只是补充。
- 崩溃恢复读取持久化快照，不通过伪造 UI 操作恢复。
- renderer 只消费 `TimerSnapshot`；显示累计复用 `shared/focus/` selector。
- 45 分专注 + 5 分暂停 + 45 分专注必须得到 90/5/95 分钟三种时间。

## 3. 任务模型与滴答连接

任务工作台的产品语义固定为滴答清单，CLI 与 OAuth 是连接方式，不是可暴露给用户的“任务来源”。

| 字段/概念 | 取值 | 含义 |
| --- | --- | --- |
| `Task.source` | `local` / `ticktick` | 关联记录的逻辑身份；`local` 只为旧数据和内部兼容保留，CLI 与 OAuth 都归一为 `ticktick` |
| `AppSettings.taskSource` | `local` / `ticktick-cli` / `ticktick-oauth` | 旧设置与连接偏好的兼容字段；不决定任务页显示什么产品来源 |
| 工作台连接策略 | CLI 优先 / OAuth 后备 | 每次刷新先探测 dida CLI；不可用时才使用已登录 OAuth；两者都不可用则返回可诊断错误 |

Provider 的稳定能力应包括：

- 列出项目与任务、按关键字搜索、按 id 回读。
- 创建或更新任务（Provider 支持时）。
- 以 `setTaskCompleted(task, completed)` 完成或恢复任务；IPC 返回规范化后的 Task，而不是仅返回模糊布尔值。
- 将专注记录写入任务或原生 focus；删除或重建错误记录。

任务工作台使用两个稳定 API：

- `window.focuslink.tasks.refresh(options?)` 返回 `IpcResult<TaskWorkspaceRefreshData>`，包含内部实际连接方式、清单、任务和 `refreshedAt`；失败保留精确连接错误。`provider` 仅用于诊断，renderer 不将它渲染成来源切换。
- `window.focuslink.tasks.setCompleted(task, completed)` 返回更新后的 Task。主进程在外部写入成功后更新缓存并广播；若 UI 采用乐观更新，失败必须恢复旧任务。

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

不变量：

- FocusLink 启动和后台周期重试只探测已存在的可验证桥；客户端关闭时保留本地待上传和持久 segment id，不得为后台补传擅自启动外部应用。
- 本地 JSON 写成功不能显示为云端已同步。
- 用户手动同步且番茄 To-do 未运行时，可以用 `spawn` / `execFile` 参数数组按需启动已知客户端，参数固定包含 `--remote-debugging-port=0`；不得拼接 shell 命令。只有发现实际端口且目标同时通过“番茄 ToDo 标题 + 特征 electronAPI 方法集”身份校验后才能上传；不得选择任意 `page` target。显式 `FOCUSLINK_TOMATODO_CDP_PORT` 失败时不得回退到通用 9222。
- 番茄 To-do 已以普通模式运行但没有可验证桥时，绝不自动结束或重启其进程；返回可操作诊断，要求用户完全退出客户端后再从 FocusLink 连接。
- 已核对番茄 ToDo 1.6.2：`cloudSyncFetchTodo` 只读取待办数据，CloudSyncService 只提供 `fetchTodoData` / `uploadRecordData`，没有专注 PCRecord 的独立云端回读或远端删除 API。因此 bridge 返回 `uploadConfirmed` 与 `cloudRecordReadbackSupported=false`；删除结果固定声明 `local-record-only` 与 `remoteDeleteSupported=false`。
- 未识别学科统一归入“学习”；迁移只处理 FocusLink marker 记录，不碰用户其他数据。
- 写盘使用同目录临时文件、fsync、原子替换和备份；Windows `EACCES/EBUSY/EPERM` 做有界退避，持续失败保留旧库。
- 学科更改可请求重新上传；删除只能确认本地 marker 清理。没有远端 API 时不得声称已回读或已清理云端记录，两个同步域互不冒充对方成功。

## 8. 小窗与边缘状态

- 只有 `collapsed` 和 `expanded` 两种合法尺寸，数值唯一来自 `shared/miniWindowLayout.ts`。当前为 `184×35` 与 `304×96`，不引入第三尺寸；常量变化必须同步更新前端规范。
- collapsed renderer 契约仅允许进度/状态、当前时间、底部真实专注占比进度轨和展开入口；不传达任务详情、三组累计或其他控制。expanded 契约须完整呈现任务名（不用省略号/渐隐截断）、当前时间、累计专注/暂停/总历时与全部控制，时间与按钮分属独立网格行、结构上不重叠。验收字号为 collapsed 25px、expanded 27px。
- Electron 主进程持有真实 bounds、当前显示器 work area、吸附边缘和窗口状态。
- Windows 通过 `WM_ENTERSIZEMOVE` / `WM_EXITSIZEMOVE` 明确区分按住与释放；按住不动时不得用 move 事件静默时间猜测释放。真正结束后才计算最近合法边缘，使用进入 14px / 离开 30px 双阈值；先吸附并保持 expanded 尺寸，renderer 接收 `mini:dock-transition` 显示 320ms 收束反馈，之后才切换 collapsed；过渡中再次 native move 必须取消待折叠任务。程序化 bounds 允许 2px DPI 归一化误差。
- 展开必须向 work area 内部生长并校正坐标；多显示器、负坐标和不同缩放比均要覆盖。
- 拖离所有边缘 140ms 后自动展开；点击箭头立即展开并设置 900ms 防回弹。换尺寸时固定接触边并围绕视觉中心调整位置。
- 手动展开、显式收起、主题/状态变化和重启恢复通过稳定事件广播，不由 renderer 猜测 native resize。
- 不恢复 freeform resize。旧宽高在设置迁移时归一化到最近合法预设。

## 9. renderer 健康、日志与托盘生命周期

- 主窗和小窗都监听 `unresponsive`、`responsive`、`render-process-gone` 和 `did-finish-load`。短暂阻塞先给 5 秒恢复窗口；仍无响应时用 `reloadIgnoringCache()` 重建 renderer。
- 受控恢复每 60 秒最多 3 次，超限后等到时间窗重置，禁止无界重载循环。计时器、session 和 SQLite 事实留在主进程，renderer 恢复不能终止当前专注。
- 日志元数据序列化必须保留 `Error.name/message/stack/cause`，支持 bigint 与循环对象降级；不得再把未捕获异常记成无信息的 `{}`，日志失败也不得触发第二次异常。
- 托盘、快捷键与主 snapshot 广播的运行时初始化必须幂等。窗口 `ready-to-show` 与已加载回退竞态只能创建一个托盘和一份 snapshot 监听；设置更新不重建托盘。退出时解除可解除监听并销毁托盘。

## 10. 数据安全与迁移

- schema 迁移单调、幂等，在事务中执行；禁止无版本地重写用户数据库。
- 删除 session/segment 使用事务并协调两个外部同步域。外部清理失败时保留足够本地事实供重试。
- OAuth/token 使用系统安全存储或既有凭据层，日志和导出不得包含密钥。
- 回归/自测只使用隔离的 `test-data` 或临时目录，不打开用户真实 Electron/FocusLink 数据。
- 用户数据导出支持 JSON/CSV/Markdown，但导出不改变同步状态。

## 11. 状态文案契约

- `已关联 / 未关联`：本地 task id 是否存在。
- `已同步 / 未同步 / 同步失败`：dida 队列是否得到云端可验证结果。
- `已写入本地 / 待上传 / 上传已确认`：番茄 To-do 两阶段状态；“上传已确认”不得解释为独立云端回读或远端可删除。
- session 没有默认任务但存在已关联 segment 时，摘要不能显示“未关联”。
- 禁止“可同步”“应该成功”等无法证明结果的状态。

## 12. 变更规则

- 计时语义变化：更新状态机/manager、shared selector、数据库、恢复测试和 45+5+45 场景。
- 任务能力变化：更新 CLI 优先/OAuth 后备连接策略、IPC、`completedAt` 缓存、分阶段加载、任务页、6 秒撤销与失败回滚测试。
- dida 写入变化：保留 argv、comment-first、父 checklist、marker、undefined 失败，并执行真实临时任务验收。
- 番茄变化：分别验证后台不启动外部应用、手动同步在未运行时用参数数组和端口 0 按需启动、已普通运行时绝不杀进程、身份校验、上传接口确认、学科修改和本地 marker 删除；独立云端回读/远端删除只有 API 真正提供后才能加入门禁。
- 小窗变化：同步 shared 常量、settings 迁移、Electron bounds、CSS 和 smoke；不把数字复制到文档以外的多处代码。
- 统计/生命周期变化：覆盖详情 request id、tick 渲染边界、renderer 恢复预算、Error 序列化和托盘监听幂等性。
- 发布变化：执行 [TEST_AND_RELEASE.md](TEST_AND_RELEASE.md) 的全部门禁并创建 GitHub Release。
