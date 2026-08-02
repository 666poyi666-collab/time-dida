# FocusLink 实施日志

## 2026-08-02 · v0.12.75 设备授权登录修复（Android 浏览器打开 + 授权页重定向）

- **根因一：Android 11+ package visibility 导致浏览器打不开**。0.12.72–0.12.74 手机点「登录」提示
  「无法打开系统登录页面」，随后停在「请在已登录设备上确认登录」。定位：`FocusRuntimePlugin.openExternalUrl`
  用 `intent.resolveActivity()` 探测默认浏览器，但 `AndroidManifest.xml` 没有 `<queries>` 声明
  `VIEW/BROWSABLE https`，Android 11+ 包可见性使 `resolveActivity()` 返回 null，插件 `opened=false`，
  授权页从未弹出。真机证据：修复前 MIUI 不出现任何弹窗；修复后点击登录出现「FocusLink 想要打开 Via」确认框，
  浏览器正常打开。修复：Manifest 增加 `<queries>`。
- **根因二：授权页未登录返回 401 JSON 无界面**。手机浏览器打开 `/owner/device-registrations?flow=...`
  时直接 `401 {"error":"access_denied"}`，无登录表单。修复：`poyi-oauth-as` 中未登录且带 `flow` 参数访问
  自动 303 到 `/owner/sign-in?bootstrap_flow=...`（一次性验证码登录表单），登录后回待批准列表。
- **文案纠正**：`MobileApp.tsx` 的 `login-required`/`waiting-for-phone` 分支提示改为
  「已打开授权网页，请在网页中完成登录与批准，会自动继续」。
- **云端链路**：`foxlink-cloud-mcp` 部署 `/account/v1/device/bootstrap`（D1 `bootstrap_flows` 流程表、
  start/poll/approve 单次消费、poll token HMAC）；`focuslink-sync` 与 `foxlink-cloud-mcp` 配置同一
  `fia_*` 身份令牌；`poyi-oauth-as` 增加 `/owner/device-registrations` 批准页。
- **小米真机端到端**（installationId `android-cc2bd342...`，flow `flow_x_2N9u...`）：点击登录 → 浏览器打开 →
  一次性验证码登录 → 批准设备 → 手机 poll 消费 flow → 实时已连接 + 账本同步确认（处理 362 条变更、
  95 场会话、82 个缓存任务）。D1 中 flow 状态 `pending → approved → consumed` 全程可查。
- **遗留**：华为平板、Windows 桌面登录链路待 0.12.75 三端实装后回读；OPPO 手表未纳入本轮。


## 2026-08-02 · 设备授权登录网关落地（跨仓）

- 补齐公网 `/account/v1/device/bootstrap`：`foxlink-cloud-mcp` 新增 D1 `bootstrap_flows` 流程表与
  `src/bootstrap.ts`（start 建 flow、返回 owner 授权页 URL；poll 回显 pending，owner 批准后经
  service binding 调私有 `/sync/v1/devices/register`，一次性签发 `fl2` 凭据并原子消费 flow；
  单次消费、poll token HMAC 指纹、10 分钟有效期、`[750,10000]ms` 轮询节奏）。客户端零改动。
- `poyi-oauth-as` 新增 `/owner/device-registrations` 管理员批准页：复用 owner session + 一次性
  CSRF，列出待批设备（设备名/平台/类型/版本）并批准或拒绝，经 `fls_*` service hop 写回 flow。
- 设备绑定语义与 README 对齐：单账号（Poyi）多设备；每台设备以 installationId 登记，重启/重装
  不变，恢复出厂或换机后重新授权；Windows/华为平板/小米手机为已绑定设备。
- 公网 404→`failed to fetch` 的根因（`errorJson` 无 CORS 头 + 端点不存在）随端点落地一并消除。


## 2026-08-01 · v0.12.74 账号过渡与 native lease 最终封口

- 0.12.73/1273 候选作废（候选生成后修改了跨端行为），本版统一升为 0.12.74/1274；
  release-v01273 候选目录退役，保留 v01270/v01272/v01274 三个规范发布目录。
- 竞态冻结审查（Android / Sync v2 / native lease 三段）确认 0e1398f 封口成立，并补两处
  边界：`drainPendingCommands` 纳入 connection-generation barrier（切号后旧调用按
  `stale_connection` 拒绝）；Sync v2 切号 reset 同时清除 legacy `cursor` 元数据。为
  `settleMobileV2Ack` 补错 lease/device/epoch 拒绝的确定性负向用例。
- 手机/手表 live command、任务快照与账本拉取统一挂载可中止 request lease；accountLifecycle
  串行化 Keystore 写入，旧 restore 补偿不可能覆盖后继登录；instrumentation 使用 PID 前缀
  隔离 SharedPreferences，不触碰 7 个生产偏好文件（前后 SHA-256 契约在真机证据链回填）。

## 2026-07-30 · v0.12.73 Focus Guard 阶段 A 本地兼容层

- 冻结四类 `focus_guard_*` 的 entity ID、V1 明文字段白名单、A256GCM envelope、AAD、
  tombstone、revision、冲突和设备专属字段边界；Account DO 仍只保存 opaque envelope。
- `shared/sync/v2Protocol.ts` 成为七类 Sync v2 entity type 的唯一运行时判定；Electron 和
  mobile reader 不再各自维护只含 ledger/metadata/correction 的旧白名单。无 root 客户端只
  验证/保存 guard envelope，不解密、不物化规则，也不创建第二 authority。
- mixed-version 自动化覆盖四类 guard kind、附带明文/额外字段拒绝、Electron 与 IndexedDB
  持久化、cursor 不前进、byte pagination、tombstone、Account DO validator 绑定，以及
  Android cursorless completed-ledger writer 忽略不消费的 guard change。
- 本地兼容层随 0.12.73 候选统一交付；未部署 Worker/DO/gateway、未读取 secret，也未新增
  root provisioning、全端解密 parser、冲突预览或生产 publisher。

## 2026-07-30 · v0.12.73 账号切换竞态最终封口

- Android 连接存储以同一同步 barrier 完成 Keystore credential 替换/清除和 runtime
  snapshot/command、authority projection、poll diagnostics 清理。已经进入旧 generation 的写入先
  完成再被清空；尚未进入的旧 live/command/ledger 响应因 generation 变化直接丢弃。来自 renderer 的
  snapshot、completed ledger 与 projection 还必须携带并匹配当前 source deviceId。
- 移动 Sync v2 的 enqueue/claim 将 outbox 与 `syncV2.bootstrap` 放进同一 IndexedDB 事务，核对
  account owner、deviceId、sync/cursor epoch 与 account generation；claim 同时过滤 device 与
  generation，账号切换会归档并删除所有外账号 outbox 状态、旧账本投影和时间元数据。
- 手机账本拉取在 sync、缓存读取、pending 读取和 native projection 每个 await 后重验连接；手机与
  手表 live command 使用独立 AbortController lease，切号同步取消请求并清除 busy/pending，旧请求的
  success、catch 与 finally 均不能覆盖新账号 UI。
- 确定性回归覆盖“旧 poll 被阻塞后切号”“旧写已进入 generation barrier 后切号”“新 checkpoint
  已提交后释放旧 enqueue”与 command lease 失效。Node 20.20.2 定向 43 项通过；Android Studio
  JBR 21.0.10 完成 unit/lint/assemble，JBR 构建 APK 在小米直跑 20 项 instrumentation 为 `OK`，
  其中需真实云参数或华为机型的既有用例按合同 skipped，新增两项账号竞态用例均实际通过。

## 2026-07-30 · v0.12.73 单账号 bootstrap 与任务快照 freshness

- 新设备登录合同收紧为严格 start/poll：独立短期 `flb_*` poll credential、canonical owner URL、流程绑定、响应精确字段和 credential 脱敏；Electron 拒绝未经过 owner 登录直接下发的 device token。公网 probe 当前实测 404 时明确报告 `not-deployed`，不冒充新设备登录已上线；旧 `fl2` 原位升级链保持不变。
- 手机、平板与手表共用同一严格 bootstrap 解析：start 只提交精确 registration，poll 只提交绑定的 `flowId + flb_*`；首次响应直接夹带 credential、legacy session、非 canonical owner/origin、额外字段或身份不一致全部失败。普通 Electron renderer 的 configure/quickSetup/pairing API 已移除，`settings:set` 忽略 `deviceSync`，生产 `fl2` 连接固定 canonical origin。
- 账号退出、credential/endpoint generation 变化会先 abort 旧请求；Electron 与手机、平板、手表的账号级请求在应用响应前再次核对 generation/scope，移动 Keystore 读写使用同一串行队列，失效响应不得写入缓存、SQLite、原生安全存储或推进 cursor。Android 原生连接存储固定 `BuildConfig.CANONICAL_SYNC_ORIGIN`，任意其他 HTTPS origin 不能恢复为 bearer 连接。诊断只保留状态、分类和脱敏后的错误，不记录 token、poll token、installationId 或完整设备身份。
- Sync v2 checkpoint 显式保存 `boundAccountId`；exchange 落库时在同一 IndexedDB 事务中复核持久 bootstrap owner 与 credential/connection epoch，只有仍属于当前账号的结果才能写 checkpoint 或 bootstrap。延迟 A 账号响应在切到 B 账号后完成的回归会锁定 B 的 bootstrap/cursor 不被旧事务覆盖。
- 任务快照增加单调 freshness 合同：PC 仅在 authority 回读相同 device/payload 后确认发布，手机可见态每 15 秒自动 GET 且强制 `no-store`，旧 revision 不回退、同 revision 异文不覆盖。回归 fixture 不包含私人任务正文。
- 精确 PC-off fixture 固定 revision `1→2→3→4`，最终 `2 segments + 1 pause` 且三时间守恒；相同 finish commandId 重放返回 duplicate，第一轮 cursor 只收一份 completed change、第二轮为空。该项是自动化合同，不替代 0.12.73 四端实装后的生产真机证据。
- 公网真正上线仍需按顺序配置独立 `fia_*`、部署私有 registration、在 foxlink gateway 实现 owner session/CSRF 与 start/poll flow store、执行 poll token 单次消费负测；本仓 dry-run 与合同测试不替代该外部部署。

## 2026-07-30 · FL-REQ-20260730-DAY-LEDGER 共享有效日与 Windows Dashboard

- 新增 `shared/dayLedgerAnalytics.ts`：默认有效日 07:00–22:00，观察起点只认当天第一段真实 focus，今天截止 now、历史日截止 22:00；pause 使用真实 `PauseEvent`，重叠时 pause 优先，focus/pause/gap 以边界切片后严格守恒。gap 只在读取时派生，不写 SQLite、同步队列或云端。
- 进行中 Session 的 open segment/pause 可延伸到当前观察终点；历史 open 行、缺 Segment/PauseEvent 的旧账本只输出 estimated 汇总，绝不伪造分钟级区间。纯函数回归覆盖无 focus、尾部空档、跨午夜、重叠、running/paused、今天/历史日与旧数据边界。
- `SessionAnalyticsResult.dayLedgers` 成为桌面/移动共享 IPC 结果。Windows Dashboard 消费该结果，增加可动画 SVG focus/pause/gap 甜甜圈、突出 07–22 的 24h 轴、精确空档列表与多日三段堆叠柱；任务投入与“最长一轮”按同一有效日窗口裁切，estimated 只补 KPI/任务 legacy 并单独标记，不与精确 gap 共用分母。多日图外层/日柱采用分层 ARIA，页尾轨保持三分类，只读 gap 行不进入 Tab 序列；内容层保持连续，Liquid Glass 只用于日期浮层、甜甜圈和 estimated 状态徽标，并完整支持 reduced-motion。
- 桌面定向验证覆盖共享分析、renderer、九仪表、完整状态机与空闲 403 本地安全回退；本条不改版本元数据、不打包、不安装、不发布。
- 移动 Dashboard 直接消费共享 `dayLedgers`，没有复制 gap 算法；任务页以匿名 `parentId` fixture 验证父摘要、子组、孤儿/循环降级和选择/开始分离。Liquid Glass 只落在控制层，360/412/640/760 与横屏的亮暗四入口 viewport、44px 命中区、无横向溢出及 reduced-motion/a11y 合同均已通过；WatchApp 与原生华为/小米系统表面未改。

## 2026-07-30 · v0.12.72 单账号登录与四端候选收口

- 账号模型固定为管理员派发的唯一 owner `poyi-owner`。普通 UI 不再编辑 endpoint/token/pairing；Windows、手机和平板从旧 `fl2` 无损识别登录态，新安装通过 canonical `/account/v1/device/bootstrap` 进入系统浏览器登录，成功后自动保存各设备独立凭据并开启实时与账本同步。手表只显示“从手机登录”和等待确认。
- Account DO 新增 `/v2/devices/register`，私有 adapter 映射 `/sync/v1/devices/register`；只有独立 `fia_*` identity authority 与精确 owner subject 可调用。稳定 `installationId` 经 HMAC 派生稳定 deviceId，重复登记只轮换 secret；设备 scope 固定为 sync/live read/write，登记审计不含 installationId、secret 或 token。
- 公网 bootstrap 不在 FocusLink 私有 Worker 暴露。`foxlink-cloud-mcp` 仍需验证 owner 会话并转发登记，且要与私有 Worker同时配置独立 identity secret；本轮没有跨仓部署或读取远端 secret。故验收必须区分“旧凭据升级后继续同步”与“新设备公网登录尚待网关上线”，禁止把本地合同测试写成生产已部署。
- 自动化与打包：format/typecheck/lint、93 个 Vitest 文件/605 项、生产依赖 0 漏洞、Electron 隔离回归、Web/Cloud/38 项跨端合同、Cloudflare dry-run、Android unit/lint/assemble 全通过；emulator instrumentation 完成 26 项，8 项因 OEM/真实云参数不适用而 skipped、0 failed。干净提交 `cf779db` 构建的 Windows 主窗 smoke、两态 mini 四边吸附 smoke 与 live fallback 均通过；mini 首次运行因系统临时目录残留锁未连接 renderer，改用本轮隔离 TEMP 后原包重试通过，没有改代码或产物。
- 四端安装矩阵：Windows 静默覆盖退出码 0，卸载注册表 `DisplayVersion=0.12.72`，安装态 EXE `FileVersion=0.12.72 / ProductVersion=0.12.72.0` 并以 `--hidden` 重启存活；小米 `192.168.1.84:5555`、华为 `192.168.1.61:5555`、OPPO OWW221 `192.168.1.44:5555` 均 `adb install -r` 成功并回读 `versionName=0.12.72 / versionCode=1272`。小米/华为升级后旧 `fl2` 继续实时连接；手表无旧凭据时显示“从手机登录”，未伪造 companion 授权已上线。
- 交付产物来自干净提交 `cf779db`：安装版 SHA-256 `4C3A681A0DB9F47DE2579AD26C9020680CBC8D610642AAA725F111FB7C3B178F`，便携版 `1B9C7423143D29FB310AB6C42C8DB63187DC33E9383085BAF80E2AFF257184E0`，APK 备份 `A269F37761B0070661836B00112CD270B79222F00C802CC61688357F7B5D91CC`。打包后发现 `.git/lfs/tmp` 遗留 275 个临时文件/23,355,375,657 bytes；确认 8 秒不增长且无 `git-lfs` 进程后只删除 tmp 文件，`.git/lfs/objects` 未动，最终 tmp 为 0。

- 0.12.71 首次干净 `win-unpacked` smoke 精确测得游标标尺 dial `189.24px`、frame `179.50px`，右溢出 `9.74px`；该候选未安装。预览宽度收至 `176px`，smoke 保存九卡 frame/dial 坐标并要求全部在界内。
- UI smoke 的 STOP 由直接 CDP/contextBridge Promise 调用改为点击真实 `.btn-stop-action`；主进程已成功 STOP 时不再因桥 Promise 悬挂误判产品失败。Android emulator 显式安装 target/test APK、授予 overlay 后 18/18 instrumentation 通过。
- 0.12.72 继承 0.12.71 移动端重构及 Windows `fl2` device binding、本地开始降级、全状态磨砂时间之带和结构化日志修复；最终安装矩阵在正式包生成后补录。

## 2026-07-30 · v0.12.71 手机与平板工业时间仪器重构

- 移动 renderer 改为深墨设备框架、暖白连续工作面与翡翠校准线；四入口、真实计时/账本/任务/同步语义均未改变。手机首屏按主读数、任务输入、112px 时间之带顺读，深色粘底操作条固定在 68px 底部导航之上。
- 平板从 620px 起使用 80px 左侧导航轨；华为 DBY-W09 的 640 CSS-pixel 竖屏不再被实时上下文侧栏压缩，760px 起才展开双栏。统计结论舞台、任务空态与设置外观规格表共享同一仪器框架，亮暗主题均有独立映射。
- Android 原生业务与系统表面未修改：保留华为 `huawei-live-capsule`、小米系统通知路径、OPPO 手表 renderer 和 Windows 两态 mini。响应式合同更新为 620px 单列/760px 双栏；本轮四端安装矩阵在构建后补录。
- Windows 403 根因为 canonical GET 无命令正文而成功，但 live command 与 task snapshot 仍携带 legacy 本机 UUID；Account DO 将其识别为与 `fl2` 凭据不匹配的设备伪装并拒绝。`getDeviceSyncRuntimeConnection`、Sync v2 与任务快照现统一从 token 解析 `device-<publicId>`，单元回归同时断言实时连接和任务发布正文。
- 空闲云端的 start 遇到网络失败或 401/403 时，桌面退出 live fact source 并启动本地 TimerManager；已有 running/paused 云端会话不允许降级。日志保留 Error name/message/stack 与 `credential-rejected` / `transport-unavailable` 分类，任务快照错误不再抛出普通对象。
- 桌面时间之带彻底删除旧的 3px 锯齿列、齿端浮尘和内部颗粒分支，暂停/结束画面中的绿色历史段也固定为连续磨砂玻璃；设置九仪表 smoke 新增逐卡预览边界断言，覆盖指针表圈、游标标尺与制图描线的裁切回归。

## 2026-07-30 · v0.12.70 云端三端同步与 MCP 修复

- 桌面 correction 使用已结束账本时间生成稳定 payload/opId；同步前只修复旧缺陷留下的 correction outbox/ACK conflict，保留操作审计。Account DO 仅把 createdAt 漂移视为 semantic duplicate，并要求历史 conflict 同时满足无 base、纯 revision 和双侧内容匹配才关闭。
- Electron 运行期不再启动内嵌同步服务、ADB reverse 或 Android 自动配对。手机/平板仍直接连接 canonical HTTPS Account DO；独立 staging Android identity 和硬编码 staging endpoint 已移除，候选 endpoint 只能由构建参数注入。
- 私有 Account DO records DTO 返回已校正 session、任务、segments、pauses、结束时间及 cloud live，删除 deviceId、note、tags、reason 和凭据。cloud MCP 的 status/today/list 工具直接读取该 DTO；D1 保留为同步诊断。
- FocusLink-only OAuth 轮换使用临时 capability：OAuth Worker 内计算并登记新 HMAC，脚本只更新 `foxlink-cloud-mcp` secret，验证 introspection/readyz 后删除 capability；不轮换 Journal、Watch、Gateway 或 App。生产 OAuth 恢复到健康版本 `c5be709d-c084-49d2-8e54-23760a06b51e`，轮换端点在 capability 销毁后返回 404。
- Account DO 冷启动增加 `account_schema_version` 常量行快路径，避免大账户每次唤醒重放 schema/index DDL而触发 Cloudflare 免费层行读取上限；live 完成同时发布 v1 bundle 与 v2 ledger/metadata，并有界补迁移历史 v1-only 完成账本。生产 Version ID 为 `c17d90b8-2501-4e0a-b578-cd0505b8e9db`。
- 生产实机闭环在 Windows FocusLink 关闭时完成：小米发起、华为暂停、小米继续、华为结束；华为再发起、小米观察并结束。最终 live 为 idle、revision 62；两端看到同一两条账本（小米 2 segments/1 pause，华为 1 segment/0 pause）。Windows 重启和第二轮自动同步后两条记录各导入一次，既有 correction outbox/open conflict 基线不增长。
- ChatGPT 经 FocusLink 云端 OAuth 实际调用 status/today/list；在本地 FocusLink、两个 Foxlink 服务及 8770/8878 监听全部关闭时，三个工具仍从 `focuslink-account-do` 返回 fresh、revision 62、live idle 和当天 2 条完整记录。生产移动域名 cloud MCP Worker Version ID 为 `5ce44467-e209-4780-8cc4-72297470ed48`。验证后独立 Foxlink 服务恢复 Running/Automatic。Windows、小米、华为与 OPPO 手表均实装并回读 `0.12.70/1270`；物理关闭整台 Windows 的验收未执行，不能把桌面进程关闭描述为整机关机。

## 2026-07-29 · v0.12.69 中央 canonical identity-focus 对齐

- FocusLink observation 在中央签名 registry 中固定使用 `productId=identity-focus` 与完整 HTTPS `/authority/identity-focus` audience；内部 named entrypoint 仍为 `FocusLinkAuthorityObservation`，路径仍为 `/internal/authority-observation/v1`。
- staging Wrangler 固定 canonical audience，独立 capability 只以 Cloudflare secret 配置；默认 Worker ingress、错误 capability/audience、缺依赖、过期或额外字段继续 fail-closed。
- 首次 staging 两跳暴露空闲 TTL 缺陷：旧 schema 对 `state_hash` 设唯一约束，且 GET 只读 snapshot，导致相同业务状态无法生成后续 verification checkpoint。现以事务化 DO schema v2 迁移移除该唯一约束；GET 每次做只读依赖 probe，有效 snapshot 不写库，只有缺失/损坏/到期才递增 checkpoint revision。
- 第二次 staging 探测未进入 Account DO：产品曾额外要求 `fao_` 固定格式，而中央 capability registry 使用统一的 32–512 字符安全 token。两端现共享同一格式校验，仍保持独立 secret、常量时间比较和不得复用 device/MCP/pair 凭据的约束。
- 本轮跨端候选提升为 `0.12.69/1269`。远端 staging、中央两跳、真实手机/平板/手表和三轮 PC-off 必须在源码提交后独立验收；未全部完成前不得写 `supportsPcOff=true`。

## 2026-07-28 · v0.12.68 私有 authority 与 canonical adapter 收口

- `cloudflare/worker.ts` 改为无公网入口的 service-binding authority adapter；只接受 canonical `/sync/v2/*` 与 `/sync/v1/pair/*`。pair offer 将 fl2 credential 转交 DO 复验 `devices:manage`，公网 owner session + CSRF 仍由 foxlink-cloud-mcp 负责。
- Account DO 绑定 authenticated device 与 body/mutation `deviceId`；live/task scope、伪造/过期/撤销/跨账号 token 负测齐全。V2 change feed 使用与 foxlink adapter 一致的 1,100,000-byte cap 二分选页，cursor/watermark 只推进到返回尾。
- Node personal-cloud production entry、Docker API service、静态 bearer account 和数据卷硬退役；Node 只保留回环合同测试。`/readyz` 检查三项两两不同的 service secret 并执行 DO SQLite probe。
- 手机、平板、手表响应式比例与 Android Keystore-first 恢复已实现；本地 viewport screenshot 与样式契约覆盖八位计时、双按钮、完整错误/设备字段及横向 overflow。
- `focus_guard_state_v1` producer golden fixture 与 Java consumer 完全一致；因同账号 32-byte root provisioning 尚不存在，生产 publisher 保持阻断，不创建第二 authority 或明文状态面。
- 本轮只做本地实现、dry-run 和自动化；未部署、未读取/复用远端 secret，最终 v0.12.68 ADB 覆盖安装与 PC-off 三轮验收未执行，`supportsPcOff=false`。

## 2026-07-28 · v0.12.67 Android 安全凭据恢复

- 手机和手表共用 `restoreOrMigrateNativeFocusConnection`：优先读取 Android Keystore；旧版仅有 WebView credential 时，原生写入成功后才清理浏览器副本。
- 手表配对流程补齐原生 `configureConnection` 与启动恢复；手机配对、手工连接的提交顺序同步收紧，Keystore 失败不再产生假保存。
- 新增恢复/迁移/失败保持和三类视口 CSS 契约测试。当前真机上已经被 v0.12.66 删除的旧手表凭据无法凭空恢复，需重新配对后完成活动态视觉验收。
- 本轮不部署、不读取远端 secret，`supportsPcOff` 继续为 false。

## 2026-07-28 · v0.12.66 canonical 云端专注数据面

- Account Durable Object 增加内部 `GET /internal/mcp/v1/focus/summary` 投影；独立 MCP service credential 与设备 token、OAuth token 分离，公网 OAuth 仍由 canonical foxlink-cloud-mcp 验证 `focuslink:read`。
- 投影从 `focus_ledger_v2` 与 `focus_metadata_v2` 生成次数、任务、时长、起止、最近记录和 `lastVerifiedAt/freshness`，不输出 note、tags 或任何凭据。
- live/task 公网路径迁移到 `/sync/v2/live*` 与 `/sync/v2/tasks`；旧 `/v1/*` 保持退休，DO 内部路径增加真实设备 credential、scope 与 `deviceId` 绑定。
- 当前只完成本地实现和门禁；未部署、未读取远端 secret，`supportsPcOff` 维持 false。

## 2026-07-27 · v0.12.65 专注时间之带磨砂材质

- running 专注材料从确定性锯齿、浮尘和内部颗粒改为全高半透明磨砂玻璃；以柔和内雾、宽幅漫反射和薄边缘高光保留质感及刻度可读性，去除长条展开后的毛边与分节感。
- paused 继续调用原有绿色历史材料、红色缺口、底部疤痕和 `frontier-ash` 消散分支；修正视觉审计中仍期待旧 `interval-trace` 且禁止疤痕的过期断言，不改变暂停画面。
- 自动化通过 format/typecheck/lint、73 文件 497 项测试、Electron 隔离回归、Android 单测/lint、安装版/便携版 UI、两态 mini 与四状态织带审计；依赖审计为 0 漏洞。
- 三端实装：Windows 静默覆盖后注册表、EXE 与健康接口均回读 `0.12.65`；小米 22041216C、华为 DBY-W09 均 `adb install -r` 成功并回读 `0.12.65/1265`。本轮未改移动/手表产品代码，OPPO 手表门禁不适用。

## 2026-07-26 · Foxlink 独立 MCP 最终私有接入

- 独立 `PoyiFoxlinkMcp` Windows 服务安装并运行于 `127.0.0.1:8770/mcp`；业务 API 仍由
  FocusLink Electron 在 `127.0.0.1:18770` 提供，MCP 不直接读取 SQLite。
- `FoxlinkSecureMcpTunnel` 以独立 Tunnel ID 连接，不依赖 PersonalMcpGateway；健康端口
  `127.0.0.1:8878` 返回 ready。
- ChatGPT Plus Developer Mode 已创建 Foxlink 私有应用并连接成功，不经过开发者实名认证或
  公开 App 发布。真实只读调用返回 `0.12.60 / revision 22 / paused`。
- 真实写入依次返回 `revision 23 / running` 和 `revision 24 / paused`；复用同一 pause
  `requestId/commandId` 再次调用仍返回 `revision 24 / paused`，幂等结果重放通过。
- 打包复验发现原 v0.12.60 安装包生成早于业务 API 合入，因此递增到 `0.12.61 / 1261` 并重新
  覆盖三端。正式 Windows 进程监听 18770，MCP 回读 `0.12.61`；ChatGPT 最终只读调用返回
  `0.12.61 / revision 28 / idle`，不再依赖开发态进程。

## 2026-07-26 · v0.12.54～v0.12.60 Sync v2 连续实施

- 0.12.54：建立三类实体、稳定 deviceId、租约 Outbox、base snapshot、bootstrap manifest 与三类 epoch。
- 0.12.55：加入 metadata 三方合并、tagId 操作语义、tombstone、90 天 stale 水位和 graveyard 防复活策略。
- 0.12.56：完成 `fl2_` 独立设备令牌、HMAC pepper、scope、配对重放保护、撤销与轮换。
- 0.12.57：接入冲突/回收站查询与标准 mutation 解决、恢复、用户层永久删除；ledger correction 强制原因。
- 0.12.58：创建并部署 Cloudflare Queue；厂商推送凭据缺失时只记录 `credential-missing`，轮询保持权威。
- 0.12.59：完成 R2 AES-256-GCM 快照目录和 maintenance generation 恢复代码；账户级 R2 未启用，Wrangler 返回 10042。
- 0.12.60：Node/Docker 与 Cloudflare 核心 v2 契约统一，桌面/移动双栈客户端、管理界面、公网与容器回归收口。
- 以上版本仅是迁移检查点，连续完成后统一生成 0.12.60 本地候选，不曾在中间检查点停止或分发。

本日志长期记录有产品意义的实现决策与验证结果，不记录逐条终端命令、访问令牌、完整配对载荷、私人任务正文或敏感设备信息。版本发布历史仍只写入根 `CHANGELOG.md`。

## 记录格式

每条记录包含日期、需求 ID、涉及子系统、关键决策、兼容性变化、三端验证矩阵、测试结果、部署结果和遗留风险。

## 2026-07-26 · v0.12.53 Windows 原位覆盖安装

- v0.12.52 证明旧卸载器既可能返回任意非零值，也可能完全不删除旧 EXE。重试耗尽后不再依赖旧卸载器副作用：当前用户进程已由 `customInit` 有界关闭，新安装器直接覆盖注册表来源的同一安装目录，不执行目录删除。
- 版本递增为 `0.12.53 / 1253`，最终验证旧版覆盖、同版本重装、数据哈希、公网同步、双 Android 覆盖与三端回读。

## 2026-07-26 · v0.12.52 Windows 覆盖安装事实判定

- v0.12.51 仍停留在重试，证明旧卸载器返回码不稳定。恢复宏改为在重试耗尽时只检查注册表来源 `$installationDir` 下产品 EXE 是否已消失；消失则继续安装，存在则保持失败。
- 版本递增为 `0.12.52 / 1252`；旧卸载器未移除 EXE，改由 v0.12.53 原位覆盖。

## 2026-07-26 · v0.12.51 Windows 覆盖安装无删除恢复

- v0.12.50 不再直接退出 2，但在 `RMDir /r` 处理仍被旧卸载器占用的安装根目录时超时。恢复宏删除递归删除动作，只在注册表来源目录的产品 EXE 已消失时归一退出码 2，新安装器随后覆盖同一路径。
- 版本递增为 `0.12.51 / 1251`；实际重试退出码不稳定导致恢复未触发，由 v0.12.52 继续修复。

## 2026-07-26 · v0.12.50 Windows 覆盖安装闭环

- v0.12.49 覆盖仍失败，原因是最终结果处理时旧卸载器已删除注册值。恢复判定回到仍持有注册表来源 `$installationDir` 的重试函数，只要求该目录下产品 EXE 已不存在，再清理残留并把已知退出码 2 归一为成功；任何产品 EXE 残留继续失败。
- 版本递增为 `0.12.50 / 1250`；真实覆盖在锁定目录删除处超时，由 v0.12.51 继续修复。
- 本轮明确不推送 `main`、不建 tag/GitHub Release，尽管补丁号达到集中上传节点；只保留本地四文件目录、APK 备份和完整证据。

## 2026-07-26 · v0.12.49 Windows 覆盖安装最终恢复

- v0.12.48 真实覆盖仍返回 2，证明 `customUninstallRetryExhausted` 不负责最终退出。恢复逻辑迁入 `customUnInstallCheck`：仅在退出码 2、注册卸载器父目录匹配 `$installationDir` 且产品 EXE 已消失时清零结果；残留 EXE 和其他失败继续退出 2。
- 版本递增为 `0.12.49 / 1249`；真实覆盖仍失败，未进入三端交付，由 v0.12.50 继续修复。

## 2026-07-26 · v0.12.48 Windows 覆盖安装收口

- 复现：停止全部 FocusLink 进程后，v0.12.47 同版本静默覆盖仍返回退出码 2，旧 payload 被删除但卸载注册项保留；四个用户数据文件哈希不变。
- 根因与修复：`customUninstallRetryExhausted` 对注册旧安装目录与新 `$INSTDIR` 做了脆弱的字符串等值门禁。删除该重复条件，保留“注册卸载器文件的父目录必须等于 `$installationDir`”作为实际删除边界，并更新 installer policy 测试。
- 版本：行为候选递增为 `0.12.48 / 1248`；真实升级仍失败，未进入三端交付，由 v0.12.49 继续修复。

## 2026-07-26 · v0.12.47 公网本地优先收敛版

- Cloudflare：新增 Worker 与账号级 SQLite Durable Object，生产自定义域名为 `https://focuslink-sync.pyzzgk.dpdns.org`。公网测试覆盖 opId/commandId 幂等与复用拒绝、旧 revision conflict、cursor 增量、任务快照、实时 start/pause/resume/finish 和重部署后持久性；Node/Docker 后端未替换，隔离容器门禁使用 API `28787`、Web `28080` 通过。
- 双 Android：Windows FocusLink 停止时，小米会话 `live_741d6676-1418-4670-9f9e-384035719dfe` 与华为会话 `live_4fbefe9e-0420-4b57-a86a-6f452f724693` 均完成开始、暂停、继续、结束；两者各生成 2 段/1 暂停并只入账一次。旧 Node cursor 收到结构化 `invalid_cursor` 后，两端从空 cursor 正确重建。
- 小米 0.12.60 补验：网络 ADB `192.168.1.84:5555` 恢复后覆盖安装并回读 `versionName=0.12.60 / versionCode=1260`；`https_localhost_0.indexeddb.leveldb` 和原生连接偏好在覆盖安装后保留。9 项适用的 Sync/runtime instrumentation 通过；PIP UI 用例被系统结束且未返回完成码，人工截图、华为专属和缺少真实云参数的用例不并入通过数。
- Overlay：以 0.12.45 为真机基线，小米 janky 14.04%→3.54%，华为 15.52%→3.43%，两端超过 100 ms 帧均为 0；运行态与拖动后截图、原始 `gfxinfo` 和结构化报告保存在 `.tmp/v01247-acceptance`。
- 小米系统表面：指定设备 `22041216C / xaga / HyperOS OS3.0.1.0.VLHCNXM / Android 15` 已确认协议 3 载荷被 FocusPlugin 解析，但日志在 `onInflateSuccess/onInflateFinish` 后出现 `onAuthFailed ... app.focuslink.mobile`，桌面与锁屏截图均无超级岛。结论为 OEM Focus allowlist/签名授权不满足，当前 ROM 对该包视觉不兼容；标准通知和 overlay 继续工作。
- Windows：清理已备份的孤立 0.12.46 卸载注册项后，0.12.47 静默覆盖安装成功。数据库、设置、设备身份文件安装前后哈希一致；安装态安全保存公网令牌并同步成功（上传 63、拉取 76、导入 13、冲突 0、拒绝 0），两份 Android 账本在 SQLite 各一条。主界面与设置截图完成回归。
- 交付：三端均回读 `0.12.47 / 1247`。本版为本地中间版本，不推送 `main`、不创建 tag/GitHub Release；最终四文件目录、APK 备份与 SHA256 随本轮收口生成。

## 2026-07-25 · v0.12.46 移动端本地优先基础版

- 需求 ID：`FL-REQ-20260725-MOBILE-LOCAL`、`FL-REQ-20260725-OVERLAY-ISLAND`。移动端新增 `cloud-live/local-offline/reconnecting/forked-local` 四态与双事实域隔离；离线会话不升级、不覆盖远端，也不把本机 UUID 发送为云端控制目标。
- IndexedDB 升级到 v3，增加 `sessionSyncMeta` 与可诊断 pending 状态；本机开始/结束及成功出队使用跨 store 事务，旧 opId 保留，崩溃遗留 uploading 恢复为 retry。
- Android 原生快照增加 `localAuthority`，Store 在锁内拒绝迟到云端响应覆盖本机显示。系统表面拆为标准、小米、华为三个适配器；overlay 实现点按叉号、3 秒收起、持久关闭与按帧合并拖动。
- 自动化：format、typecheck、ESLint、68 个 Vitest 文件/475 项测试、桌面/Web/云构建、Android JVM unit/lint/assemble 与 Windows `dist` 已通过。跨设备 28 项 Vitest 通过；个人云容器门禁因 Docker Desktop Linux Engine 未运行而受阻。
- 三端：小米 `22041216C` 与华为 `DBY-W09` 已覆盖安装并回读 `0.12.46 / 1246`；华为 instrumentation 为 `OK (17 tests)`，小米能力选择、协议 3 载荷和真实通知发布用例分别通过。Windows 两个候选二进制均回读 `0.12.46`，尚未覆盖安装。小米活动通知表已接收 `1214`，但锁屏截图未出现超级岛，故只到 `systemui-accepted`；视觉、gfxinfo、稳定断开 PC 一轮及并发真机分叉仍未验收。
- 本地交付：`release-v01246` 仅含安装版、便携版、SHA256 与说明四文件；Android APK 备份位于 `.tmp/android-apk-backups`。根目录只保留 `release-v01244`、`release-v01245`、`release-v01246`。该候选来自 dirty 工作区，不推送 main、不建 tag/GitHub Release，也不宣称完整门禁完成。

## 2026-07-25 · v0.12.45 便携版 CI 启动门禁与集中发布节奏

- `v0.12.44` 两次通过源码与 Electron 回归，但 GitHub Windows runner 的便携包自解压未在硬编码 15 秒内暴露 CDP 页面；本机同一包的主窗、小窗和便携启动均已通过，Release 尚未创建。
- smoke 的 CDP 启动窗口扩展为有界 60 秒，并在 Electron 提前退出时直接报告退出码，避免把慢启动误报成产品页面失败。
- 从 `0.12.45` 起，仅补丁尾号为 `0` 或 `5` 的版本上传 GitHub；中间版本保留完整本地日志、三端验收、四文件发布目录和 APK 备份，下一上传节点汇总发布。

## 2026-07-25 · v0.12.44 CI 握手测试同步修订

- `v0.12.43` 的发布工作流两次在 `desktopLiveIdleFallback.test.ts` 相同断言失败：测试固定等待 8 个微任务，GitHub runner 尚未完成初始 live 握手；标签、版本、发布说明与 LFS 门禁均已通过，Release 尚未创建。
- 保留公开标签 `v0.12.43`，不移动、不覆盖；测试改为等待 `liveMode` 的可观察状态，产品的 idle 断线回退行为不变。
- Windows、华为、小米推进到 `0.12.44 / 1244` 并重新执行三端同版部署、正式打包和发布门禁。

## 2026-07-24 · v0.12.43 发布门禁修订

- `v0.12.42` 的公开标签触发工作流后，因发布说明使用“对应源码”而非强制字段“对应提交”，且 release-record commit 未包含干净构建生成的版本元数据，工作流在创建 Release 前失败。
- 按不可变标签规则保留 `v0.12.42`，不移动、不覆盖；`0.12.43` 保持相同产品行为，递增 Windows/Android 版本并重新执行三端同版部署与全部发布门禁。
- `0.12.43` 的 release-record commit 必须是源码提交的直接子提交，并且只包含 `shared/version.generated.ts` 与发布目录四个规定文件。

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
