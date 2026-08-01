# FocusLink 用户需求台账

本台账长期保存可验收的产品需求摘要，不保存聊天原文、访问令牌、完整二维码、私人任务正文或设备敏感信息。版本历史仍只写入根 `CHANGELOG.md`。

## 字段约定

| 字段 | 含义 |
| --- | --- |
| 需求 ID | 稳定、可引用的需求标识 |
| 日期 | 首次登记日期 |
| 摘要 | 不含私人数据的目标概述 |
| Windows / 手机 / 平板验收 | 对应终端的可观察结果；不适用时明确标记 |
| 状态 | 待实现 / 实施中 / 待真机 / 已验收 / 延后 |
| 目标版本 | 计划进入的版本或未发布版本 |
| 关联改动 | 规范、源码或测试入口，不记录命令流水 |

## 当前需求

| 需求 ID | 日期 | 需求摘要 | Windows 验收 | 手机验收 | 平板验收 | 状态 | 目标版本 | 关联改动 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FL-REQ-20260730-ACCOUNT-SYNC | 2026-07-30 | 唯一管理员账号登录后自动获得实时、任务与账本同步；普通用户不再填写服务地址、令牌或配对码 | 旧 `fl2` 原位识别登录；只显示账号/状态/立即同步/退出；新登录后台登记独立 Windows device | 登录按钮跳系统 owner 流；成功后自动登记 phone device 并写 Keystore；无地址/令牌/配对 UI | 平板同手机；OPPO 手表只从手机确认并获得独立 watch device | 客户端/私有 authority 与严格 start/poll 合同已完成；旧凭据继续同步；公网 bootstrap 与手表 companion 确认待独立部署授权 | v0.12.74 | `deviceSyncAccountService`、`accountBootstrapProtocol`、canonical probe、Account DO register、桌面/移动设置与手表登录态 |
| FL-REQ-20260730-TASK-FRESHNESS | 2026-07-30 | PC 发布的新任务快照必须在手机/平板前台自动收敛，旧 revision 或缓存响应不能覆盖新快照 | 发布 pending 只有 authority 回读同 device/payload 后清除 | 可见态每 15 秒 `no-store` 拉取；revision 只前进；同 revision 异文拒绝 | 同手机，父子 ID/parentId 数量保持 | 协议与无私人正文回归已完成，待 0.12.74 四端实装 | v0.12.74 | `taskSnapshotProtocol`、`deviceSyncService`、`MobileApp` freshness effect、`taskSnapshotFreshness.test.ts` |
| FL-REQ-20260730-DESKTOP-START | 2026-07-30 | 修复 Windows“开始专注”被实时 403 阻断、设置仪表预览显示不全、时间之带再次出现毛虫边缘；用户发现的问题必须进入需求表、实施日志、CHANGELOG 和可失败的回归门禁 | `fl2` 绑定 ID 贯穿 live/task 写入；空闲 401/403 可本地开始；九仪表预览不裁切；专注绿带全状态无锯齿/浮尘；日志不得只写 `[object Object]` | v0.12.72 同版安装并回读；移动功能不因桌面降级语义改变 | v0.12.72 同版安装并回读；华为 capsule 保持 | 已验收；四端 v0.12.72 实装与 smoke 已记录 | v0.12.72 | `deviceSyncService`、`FocusTimerController`、`TemporalRibbon`、仪表 preview CSS、live/device/UI smoke、`SYNC_TROUBLESHOOTING` |
| FL-REQ-20260730-DAY-LEDGER | 2026-07-30 | 建立共享 07:00–22:00 有效日与精确空档契约；focus/pause/gap 严格守恒，旧记录只给 estimated，不持久化第二份 gap 事实 | Dashboard 显示 SVG focus/pause/gap 甜甜圈、24h 轴、精确空档列表、多日三段柱和三分类页尾轨；任务时长与 KPI 同窗裁切；无 focus 不造全天空档；多日柱可访问、只读 gap 行无 Tab 停靠；玻璃只用于控制层 | 直接消费共享 `dayLedgers`，移动 renderer 不重写 gap 算法 | 同手机；宽屏布局保持唯一账本与任务投入 | 源码与自动验收已完成，待 v0.12.74 四端实装 | v0.12.74 | `shared/dayLedgerAnalytics.ts`、`SessionAnalyticsResult.dayLedgers`、`HistoryInsights`、`DashboardView`、纯函数/renderer/仪表回归 |
| FL-REQ-20260730-MOBILE-UI | 2026-07-30 | 手机/平板 renderer 使用原创 Liquid Glass 控制层与清楚内容面；四入口、共享日账本和 parentId 生物任务树可完整使用；保留 Windows 两态小窗、华为 capsule、小米系统表面与手表路径 | 桌面产品 UI 不改；须覆盖安装并回读同版，复验两态 mini | 360/412 与 640×1024 竖屏保持单列+底部 tab，触控区 ≥44px；亮暗、无 blur、减少透明度/动效均无溢出 | ≥760 或横屏才切 sidebar/split；选择任务留在任务页，开始才进入专注；华为 capsule 模块保持 | 源码、43 项定向测试、build:web 与五组亮暗四入口 viewport 已通过；待 0.12.74 四端实装 | v0.12.74 | `mobile.css`、`DashboardView`、`TaskBrowser`、匿名 parentId fixture、响应式/a11y 与 viewport smoke、`FRONTEND_SPEC` §10 |
| FL-REQ-20260730-CLOUD-MCP | 2026-07-30 | 电脑关闭时手机和平板直接从云端获取、控制和上传专注；ChatGPT 通过云端只读 MCP 获取当天完整记录与 live；不接 PersonalMcpGateway，不增加 E2EE、R2 或手表功能 | 不再运行 ADB reverse/内嵌同步中继；FocusLink 与本地 Foxlink 服务关闭时云端 MCP 仍可读，Windows 重启并重复同步后账本不重复、冲突基线不增长 | Windows FocusLink 关闭时，小米完成开始→观察华为暂停→继续→观察华为结束，并能观察、结束华为发起的同一 cloud live | Windows FocusLink 关闭时，华为观察并暂停/结束小米发起的 cloud live，并可独立发起由小米观察和结束 | 已验收；生产云部署、四端同版安装、双机闭环和云端 MCP 隔离读取通过，整台 Windows 物理关机仅作补充实测 | v0.12.70 | `deviceSyncV2Service`、`v2OutboxStore`、Account DO records DTO、cloud MCP、OAuth FocusLink-only rotation |
| FL-REQ-20260728-MOBILE1 | 2026-07-28 | FocusLink 手机/平板/手表比例适配；手表完整显示八位计时与双动作，手机不显示平板专属模块，错误、设备身份和状态字段不得被截断；Android 覆盖升级不得丢失配对 | 本轮未改桌面 UI；正式安装门禁待统一收口 | 393×873 本地 viewport 无横向 overflow；最终 v0.12.69 覆盖安装/截图待执行 | 834×1194 平板完整设备身份；378×496 手表八位计时和双按钮本地 viewport 通过；最终 v0.12.69 真机复验待执行 | 最终云闭环候选，待真机 | v0.12.69 | `WatchApp`、`watch.css`、`FocusConsole`、`viewportPolicy`、`mobile.css`、`nativeFocusRuntime`、`preferences` |
| FL-REQ-20260727-UI1 | 2026-07-27 | 专注中的时间之带去除毛虫般毛边与分节，改为贴满轨道上下内沿的半透明磨砂玻璃；暂停样式保持 | `0.12.65` 安装版/便携版 UI、mini 与四状态织带审计通过；注册表、EXE、健康接口回读 `0.12.65` | 小米 22041216C 覆盖安装并回读 `0.12.65/1265`；移动 UI 未改 | 华为 DBY-W09 覆盖安装并回读 `0.12.65/1265`；平板 UI 未改 | 已验收 | v0.12.65 | `TemporalRibbon`、`FRONTEND_SPEC` §6、`visual-review`、`ui-state-smoke` |
| FL-REQ-20260726-UI4 | 2026-07-26 | 4单：计时仪表 5→9（滚筒/指针表圈/游标标尺/制图描线）、手表 AMOLED 防烧屏与四行铺满布局与系统字体提速、时间织带羽化材质、三端+手表实装死命令、废除五版上传节奏 | 0.12.64 静默覆盖安装，注册表+EXE 回读 `0.12.64`，全量 UI/mini 冒烟与九仪表截图通过 | 小米 22041216C 回读 `0.12.64/1264` | 华为 DBY-W09 回读 `0.12.64/1264`；手表 OWW221 回读 `0.12.64/1264` 并真机截屏验证纯黑壳层 | 已验收（手表运行态色彩按共享状态色路径验证） | v0.12.64 | `TimerDial`、`watch.css`/`WatchApp`、`TemporalRibbon`、`AGENTS.md` 门禁、`ui-state-smoke` |
| FL-REQ-20260726-UI3 | 2026-07-26 | 3单：四个功能视图的呈现 UI 大改，统一「工位横幅 → 主舞台 → 文脉栏」仪器语法（专注仪表列+纪念碑+全宽时间之带、任务三栏执行台、统计双区工作台、设置编号规格表） | 0.12.63 打包版通过 497 项测试与冒烟；随 0.12.64 覆盖安装到本机 | 随 0.12.64 安装（本单不改手机 UI） | 随 0.12.64 安装（本单不改平板 UI） | 已验收；矩阵随 v0.12.64 补齐 | v0.12.63 | `FRONTEND_SPEC` §2/5/7/8/9、四视图源码与 `linear-workbench.css`、`ui-state-smoke` |
| FL-REQ-20260726-FOXLINK-MCP | 2026-07-26 | 独立 Foxlink MCP、专属 Tunnel 与 ChatGPT Developer Mode 私有应用，桌面业务 API 随正式安装包启动 | 0.12.61.0 覆盖安装；18770/8770/8878 ready；ChatGPT 回读 0.12.61 | 小米覆盖并回读 0.12.61/1261；移动业务不变 | 华为覆盖并回读 0.12.61/1261；移动业务不变 | 已验收；仅本地交付 | v0.12.61 | `electron/mcp`、`mcp/`、`FOXLINK_MCP.md`、三端版本矩阵与 ChatGPT 截图 |
| FL-REQ-20260724-SURFACE | 2026-07-24 | Android 使用真实可识别的系统计时表面，并明确能力与降级 | 设置可查看移动端真实能力 | 小米优先焦点通知，Android 16 优先 promoted ongoing，其余为常驻通知；失败状态准确 | 华为/荣耀优先 EMUI 系统计时胶囊，系统不识别时保留常驻通知 | 待视觉验收 | v0.12.28 | `SystemFocusSurfaceProvider`、系统控制区、Android 通知测试 |
| FL-REQ-20260724-OVERLAY | 2026-07-24 | 保留用户显式启用的可移动 Android 后备悬浮条 | 不适用 | 长按拖动、点击回应用、旋转/重启恢复并夹取安全区 | 与手机相同，兼容横竖屏和分屏 | 待人工操作 | 未发布 | `FocusDesktopOverlayController`、`FocusRuntimeSystemSettings` |
| FL-REQ-20260724-MINI | 2026-07-24 | 修复 Windows 小窗黑色残边和贴边绿色装饰 | 仅 184×44/256×70 两态；四边/四角无黑条、绿条和像素缝 | 不适用 | 不适用 | 实施中 | 未发布 | `miniWindowLayout.ts`、mini CSS、layout/smoke 测试 |
| FL-REQ-20260724-TASK-TREE | 2026-07-24 | 三端父子任务使用真实叠层层级，选择与开始分离 | 选择器显示父摘要与内嵌子组 | 父摘要、紧凑子清单、深层路径提示 | 760px 起树/详情双栏，窄分屏回落单栏 | 实施中 | 未发布 | `TaskTree`、`TaskPicker`、`TaskBrowser`、响应式 CSS |
| FL-REQ-20260724-PAIRING | 2026-07-24 | 用一次性二维码/短码简化连接，长期凭据安全保存 | 已验证启动、周期探测和晚连接协调；两台设备独立配对后立即同步 | 小米晚连接/重连与同代幂等通过；临时已结束账本写入与 tombstone 清理均收敛 | 华为断开再连接后一个探测周期内恢复 reverse 并同步；临时账本写入与清理均收敛 | 已验收 | v0.12.45 | `/v1/pair`、`AndroidSyncCoordinator`、Android 深链、配对与协调器测试 |
| FL-REQ-20260724-TRI-END | 2026-07-24 | 每轮 UI/行为迭代递增补丁版本并完成 Windows、手机、平板同版矩阵 | 覆盖安装并回读 0.12.53，数据库/设置保留且公网同步通过 | 小米回读 0.12.53 / 1253 | 华为回读 0.12.53 / 1253 | 已验收；按本轮要求仅本地交付 | v0.12.42 起持续 | `AGENTS.md`、发布规范、实施日志、v0.12.53 证据矩阵 |
| FL-REQ-20260725-MOBILE-LOCAL | 2026-07-25 | 电脑或服务不可达时手机/平板仍可完整专注，并与云端活动会话隔离 | Windows 两态小窗不变；Cloudflare 回收两份账本且各一次 | 电脑停止时完成开始/暂停/继续/结束，2 段/1 暂停只入账一次 | 与小米相同，独立 UUID 只入账一次 | 已验收；自动化、真机与公网收敛均通过 | v0.12.53 | `authorityPolicy`、IndexedDB v3、SQLite Durable Object、三端账本证据 |
| FL-REQ-20260725-OVERLAY-ISLAND | 2026-07-25 | 悬浮条点按关闭/3 秒收起/逐帧拖动；小米超级岛提供真实可见证据或明确兼容性结论 | Windows 小窗与新界面截图回归通过 | overlay janky 3.54%、无 >100 ms 帧；FocusPlugin `onAuthFailed`，该 ROM/签名视觉不兼容 | overlay janky 3.43%、无 >100 ms 帧；华为既有胶囊路径保持 | 已验收；小米结论为明确不兼容而非 `visually-verified` | v0.12.47 | 三系统表面适配器、`FocusDesktopOverlayController`、gfxinfo 与 SystemUI 证据 |
| FL-REQ-20260726-CF-PUBLIC | 2026-07-26 | 三端使用 Cloudflare 公网同步，电脑关机不影响移动端完整专注和最终入账 | 自定义域名连接、凭据安全存储、上传/拉取与账本导入通过 | 公网完整会话、幂等与 cursor 重建通过 | 公网完整会话、幂等与 cursor 重建通过 | 已验收 | v0.12.53 | `cloudflare/`、`wrangler.jsonc`、公网协议与三端账本证据 |
| FL-REQ-20260726-SYNC-V2 | 2026-07-26 | Outbox、base、三方合并、删除恢复、设备身份、冲突中心、推送与加密灾备连续实施 | 0.12.60.0 覆盖安装；SQLite 完整，158 个 base 建立、Outbox 清零 | 指定小米离线，0.12.60 未安装 | 0.12.60/1260 已安装，18 项 instrumentation 完成 | 部分验收；R2 账户未启用（10042），小米端不可达 | v0.12.60 | v2 协议与 store、公网状态文件、R2 与 ADB 错误证据 |
| FL-REQ-20260724-HARMONY | 2026-07-24 | HarmonyOS 原生客户端接入 Live View Kit | 不适用 | 不在 Android APK 伪造 | 后续独立 ArkTS 薄客户端 | 延后 | 待定 | 需独立立项与华为公开 SDK |
| FL-REQ-20260724-SYNC-SIMPLE | 2026-07-24 | 历史“一键连接”需求；普通用户不应接触同步基础设施参数 | 不再提供 quick setup、服务地址、令牌或配对写面；现由账号登录后台登记独立 device | 不再扫码领取共享凭据；登录同一管理员账号后获得本机独立凭据 | 同手机；手表只走 companion 确认 | 已由 `FL-REQ-20260730-ACCOUNT-SYNC` 取代；仅保留历史追溯 | 已取代 | `FL-REQ-20260730-ACCOUNT-SYNC`、账号 bootstrap 与 canonical authority 合同 |
| FL-REQ-20260724-HUAWEI-CAPSULE | 2026-07-24 | 华为桌面状态栏计时达到参考应用的系统实况窗效果 | 不适用 | 不适用 | EMUI 14.2 生成系统托管 `TIMER` 胶囊，运行/暂停和 elapsed 来自同一权威快照 | 待视觉验收 | v0.12.28 | 参考 APK 静态反编译、真机通知对象、`SystemFocusSurfaceProvider`、华为 instrumentation |

## 维护规则

- 产品行为改变时更新对应行的验收、状态和关联改动；需求含义改变时新增 ID，不复用旧 ID。
- 只有 Windows、手机、平板矩阵均有结论，且适用终端完成自动化与真实设备验证后，才能标记“已验收”。
- 跨端 UI 或行为候选每轮必须递增补丁版本；Windows、华为和小米读取到的版本不一致时不得标记完成、打包发布或创建 tag。
- 公网域名、托管资源或厂商权限未实际提供时，只能记录部署能力，不得写成已上线。
