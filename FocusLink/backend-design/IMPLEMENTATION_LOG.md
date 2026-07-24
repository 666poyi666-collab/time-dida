# FocusLink 实施日志

本日志长期记录有产品意义的实现决策与验证结果，不记录逐条终端命令、访问令牌、完整配对载荷、私人任务正文或敏感设备信息。版本发布历史仍只写入根 `CHANGELOG.md`。

## 记录格式

每条记录包含日期、需求 ID、涉及子系统、关键决策、兼容性变化、三端验证矩阵、测试结果、部署结果和遗留风险。

## 2026-07-24 · v0.12.42 三端自动配对与同版门禁

- 需求 ID：`FL-REQ-20260724-PAIRING`、`FL-REQ-20260724-TRI-END`。
- 涉及子系统：Electron Android reverse/配对协调、移动端一次性深链、版本与发布门禁。
- 关键决策：所有协调请求串行执行；每台在线设备按同步令牌指纹代次最多自动配对一次，断开后重连或令牌轮换才重新配对；失败设备保留为下一轮重试，成功设备不重复拉起。配对成功立即运行跨设备同步。
- 兼容性：继续使用 `tcp:18787` reverse 和既有一次性配对协议，不改变账本、实时 revision、Windows 两态小窗、华为 `layout11` 或小米超级岛协议。
- 自动化：format、typecheck、lint、66 个 Vitest 文件/467 项测试、桌面/Web/云构建、Capacitor sync、Android unit/lint、主 APK 与 instrumentation APK 均通过。协调器覆盖并发触发、晚连接、序列变化、单机失败、令牌轮换、重复轮询和恢复重连。
- Windows：候选安装版与便携版生成成功，安装元数据和运行时均读取 `0.12.42`；日志确认两台在线 Android 获得独立一次性配对并立即同步，小窗继续使用 `184×44 / 256×70` 两态。当前二进制嵌入 `e866c39-dirty`，只作为本机候选，不满足正式发布的干净提交门禁。
- 手机：小米 22041216C 覆盖安装后读取 `versionName=0.12.42`、`versionCode=1242`，`tcp:18787` reverse 存在；真机选择 `xiaomi-island`，投影含 `miui.focus.param`，HyperOS `FocusPlugin` 确认收到通知 `1214`。标准通知通道继续保留。
- 平板：华为 DBY-W09 覆盖安装后读取 `versionName=0.12.42`、`versionCode=1242`，`tcp:18787` reverse 存在；断开后晚连接可在一次探测周期内恢复 reverse 并立即同步。胶囊从 `01:30` 连续推进到 `01:43`，`layout11` overlay 仍挂载且 Launcher 稳定。
- 发布卫生：根目录只保留 `release-v01228`、`release-v01229`、`release-v01242`；`release-v01242` 严格包含安装版、便携版、SHA256 和发布说明四个文件，两个哈希复算一致，打包后 `.git/lfs/tmp` 为 0 文件。
- 三端门禁：三端版本矩阵已一致，Android 测试包已从两台设备清理。通过正式本机服务执行临时 start/pause/resume/finish 后生成 2 个 segment、1 个 pause；华为和小米 IndexedDB 均精确包含该 session。发送 delete tombstone 并重启拉取后，两台缓存均不再包含该 session，测试数据已清理。正式 Windows 资产必须继续从本条对应的干净源码提交重建。

## 2026-07-24 · 三端系统计时与任务层级重构

- 需求 ID：`FL-REQ-20260724-SURFACE`、`OVERLAY`、`MINI`、`TASK-TREE`、`PAIRING`、`TRI-END`。
- 涉及子系统：Electron 小窗、React 桌面任务选择器、移动 React renderer、Capacitor Android 原生层、设备同步 HTTP 服务与安全凭据存储。
- 关键决策：Windows 收起高度固定为 44px 并继续保持两态；Android 由统一 provider 按能力选择小米焦点通知、Android promoted ongoing 或标准常驻通知；华为 Android APK 不冒充 HarmonyOS Live View；overlay 仅显式启用；任务继续复用 `parentId`；配对二维码只承载协议版本、端点、一次性随机数和过期时间。
- 兼容性变化：Android `compileSdk` 升为 36，AGP 升为 8.9.1，目标版本保持独立评估；小米焦点协议不可用或未授权时自动降级；非回环远程端点仍强制 HTTPS。
- Windows：布局常量与单元测试已通过；dock 绿色装饰和 35px contentBounds 绕行已删除；隔离候选安装版/便携版打包成功。packaged Chromium 未开放 smoke 所需本地 CDP 端口，候选进程虽启动但 smoke 在 renderer 连接前超时，因此明暗主题、四边/四角像素截图不得标记完成。
- 手机：任务叠层、系统表面状态、显式 overlay 开关与一次性码兑换已实现。小米 22041216C（Android 15 / HyperOS OS3）覆盖安装成功，应用 UID 读取到焦点协议 3、权限已开，实际能力选择为 `xiaomi-island`；instrumentation 0 失败。状态栏/锁屏最终视觉与动作仍需人工截图确认。
- 平板：760px 任务树/详情双栏及窄宽回落已实现。华为 DBY-W09（Android 12 / EMUI 14.2）覆盖安装成功，能力按公开 API 选择 `ongoing-notification`，未宣称 Live View；instrumentation 0 失败。任务双栏和 overlay 拖动位置仍需人工视觉确认。
- 测试结果：format/type/lint 通过；Vitest 65 个文件、462 项全部通过；Android JVM unit + lint 通过；小米与华为各 13 项 instrumentation 中 10 项通过、3 项因未提供真实云参数跳过、0 失败；两台设备均能把 `focuslink://pair` 解析到 `MainActivity`；主应用、Web、云、Android debug APK 和隔离 Windows 候选包构建成功；`npm audit --omit=dev` 的生产依赖漏洞计数为 0。
- 部署结果：最终 debug APK 已安装到小米手机和华为平板。注意：Gradle connected instrumentation 在测试收尾卸载了 target package，导致测试前的本机 App 沙箱无法保留；随后已重新安装候选 APK，但该次属于新安装，旧本机缓存只能从既有同步服务重新拉取，不能声称原地保留。Windows 候选包只生成在本机临时目录，未覆盖 Git LFS 发布资产，也未发布 GitHub Release；公网云未部署。
- 遗留风险：Windows 像素级 smoke 尚未得到 renderer 连接；小米系统岛与华为锁屏通知仍需人工视觉/动作截图；overlay 旋转、分屏和拖动后的坐标恢复需人工操作；PWA 后台能力受浏览器冻结限制；HarmonyOS Live View Kit 需后续独立 ArkTS 客户端；公网 HTTPS 服务需要用户提供域名与托管资源。

## 2026-07-24 · 同步主流程简化与华为参考效果核验

- 需求 ID：`FL-REQ-20260724-SYNC-SIMPLE`、`FL-REQ-20260724-HUAWEI-CAPSULE`。
- 涉及子系统：Electron 设备同步 IPC、Windows 设置页、Android 系统通知能力选择、真机通知核验。
- 关键决策：新增可重入的一键本机同步动作，将安全令牌生成、本机服务启动、`/health` 检查、已授权安卓 ADB reverse 和首次账本同步合并；默认界面只保留开启/自动修复和连接二维码，端点、令牌及开关收进高级设置。现有 revision 冲突继续保留并提示，不自动覆盖用户记录。
- 华为核验：在 DBY-W09 / Android 12 / EMUI 14.2 上启动参考应用临时计时后确认其状态栏胶囊来自华为 Live Notification 专用通知数据，而不是普通 `ongoing` 通知或应用 overlay。华为公开的 Live View Kit 官方页面明确面向 HarmonyOS/ArkTS；参考 Android APK 未发现随包提供的公开 Huawei Live View SDK。因缺少可公开验证的 EMUI Android 接口，本轮没有把黑盒观察到的未公开通知键硬编码进 FocusLink，也没有把标准通知宣称为参考视频同款实况窗。
- Windows：格式、类型、lint、65 个 Vitest 文件/462 项测试、生产构建与 Windows 安装版/便携版打包通过；一键动作仍需在新候选 UI 中人工点击验收。打包前后 `.git/lfs/tmp` 均为 0 文件；非交付的 unpacked/debug/blockmap 已移出发布目录。
- 手机：本轮同步主流程是桌面入口调整，移动连接协议不变；同一 debug APK 已覆盖安装到小米手机，版本 `0.12.27`，应用数据保留。
- 平板：同一 debug APK 已覆盖安装到华为平板，版本 `0.12.27`，应用数据保留；标准系统常驻通知仍可用，但参考视频同款胶囊未标记完成。
- 测试结果：前端 format/type/lint 通过；Vitest 462 项全部通过；Android JVM unit、lint 与 debug APK 构建通过；APK SHA-256 为 `E6774F9A829CD103F32CDBB851D96A5AE90B791AF35B2767E02EEF4BBE0617E7`。
- 部署结果：APK 已覆盖安装到两台已连接安卓设备；Windows 本地候选已生成但未发布 GitHub Release。没有部署公网云服务。
- 遗留风险：华为 EMUI Android 实况窗需厂商公开且适用于第三方 Android APK 的接口/SDK；否则只能通过后续 HarmonyOS ArkTS 客户端接入官方 Live View Kit。Windows 候选仍需人工验证一键修复、二维码扫码和既有冲突提示。

## 2026-07-24 · 华为 EMUI 计时胶囊兼容层

- 需求 ID：`FL-REQ-20260724-HUAWEI-CAPSULE`。
- 逆向对照：从 DBY-W09 拉取参考 APK 后用 jadx 1.5.2 还原；业务代码由原生壳运行时加载，静态结果只含加载器、资源和 Manifest，且没有随包 Huawei Live View SDK。随后启动现有 1 分钟测试待办，从 `dumpsys notification --noredact` 读取系统实际接收的通知对象，确认 `notification.live.event=TIMER`、type/operation、`CapsuleEnabled` 和 capsule 内的 time/status/type/color/icon/countdown 字段。
- 实现：`SystemFocusSurfaceProvider` 对 Huawei/Honor 选择 `huawei-live-capsule`，从同一权威 `FocusRuntimeSnapshot` 投影运行/暂停、elapsed、图标与胶囊色；基础 ongoing notification 始终保留，兼容字段被系统忽略时自然回落。
- 验证：Android JVM unit、lint、debug APK 和 instrumentation APK 编译通过；DBY-W09 上能力选择与胶囊字段两项 instrumentation 均为 `OK (1 test)`。最终状态栏/锁屏外观仍随本轮完整 APK 部署后的活动会话做视觉验收。

## 维护规则

- 每次 UI 或行为变更必须更新 Windows、手机、平板三端矩阵；不适用也要写明原因。
- 只有测试、构建、部署和遗留风险均有事实记录，需求才能进入“已验收”。
- 失败或降级结果同样记录，禁止把计划、编译通过或协议支持误写成真机效果已确认。
