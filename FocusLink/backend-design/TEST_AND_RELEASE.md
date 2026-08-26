# FocusLink 测试与发布规范

> 这是发布门禁，不是建议清单。每个补丁版本都必须推送 GitHub `main`；公开 tag、资产上传和 GitHub Release 只在用户明确要求时执行，并且只有本页全部满足才算发布完成。
>
> 除非命令明确写了其他路径，本页所有 `npm` / `node` 命令都从仓库内 `FocusLink/` 执行。正式开发运行时固定为 Node.js 22.x / npm 10.x（当前门禁基线为 Node `22.22.2` / npm `10.9.9`）。Cloudflare Worker 保持 `compatibility_date: 2026-07-25`；不得为适配旧 Wrangler/workerd 而回退该日期。

## 0. 每轮迭代前置复盘

这是开始规划、改源码、升版本、构建或安装前的硬门禁：

1. 读完 [IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md) 顶部当前版本记录和其中尚未关闭的 Bug/事故；产品级事实、证据、根因和遗留风险只追加到该日志。
2. 读完与本轮症状对应的 [SYNC_TROUBLESHOOTING.md](SYNC_TROUBLESHOOTING.md) 或 [INSTALLER_TROUBLESHOOTING.md](INSTALLER_TROUBLESHOOTING.md) 稳定错误编号；需要复用的诊断顺序只维护在 troubleshooting 文档。
3. 读完本页全部门禁，再确定版本、测试、构建和三设备安装矩阵。未完成以上阅读不得把历史错误直接当成当前故障，也不得新建一次性 Bug 报告、平行 `docs/` 或散落结果文件。

连接事故必须按“已安装配置（脱敏）→ 最近日志时间/结构化错误码 → DNS → TCP → 正确的只读 health 路径 → canonical 路由/鉴权边界 → 产品状态”顺序诊断。历史 `network_error` 与当前 health 成功可以同时为真；`conflict_present` 是耐久数据待确认状态，不是 transport 断开。禁止仅凭任意非空 `lastError` 显示“连接失败”，也禁止用会写远端状态的 bootstrap 代替健康检查。

## 1. 测试层级

### 快速静态与单元验证

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm audit --omit=dev
npm run probe:account-bootstrap
```

测试必须覆盖状态机、三时间模型、崩溃恢复、任务树与排序、`completedAt`、CLI 优先/OAuth 后备、活动/完成分阶段加载、设置局部更新与旧设置兼容迁移（fontProfile 仅解析、timerStyle 旧值映射）、dida argv/checklist/marker、统计 request-id、renderer 受控恢复、logger Error 序列化、托盘监听幂等性、同步队列和番茄本地/云桥策略。

Focus Guard 阶段 B 的本地门禁另加：

```bash
npx vitest run tests/focusGuardRootProtocol.test.ts tests/focusGuardCrypto.test.ts tests/focusGuardRootStore.test.ts
./gradlew :app:testDebugUnitTest --tests app.focuslink.mobile.FocusGuardRootProtocolTest
```

必须覆盖四类 V1 payload round-trip、wrong root/account/AAD/entity/revision/operation、nonce/tag/
ciphertext/AAD 篡改与截断、generation rollback/replay、corrupt/lost/recovery-required/revoked 与
secure-storage unavailable；root/recovery secret/解密明文不得进入日志、renderer、WebView preference、
APK 常量或云端 payload。阶段 B 只允许本地源码和 synthetic fixture；不得以本地测试代替部署、生产
schema/secret、打包或设备安装验收。

### 构建与隔离回归

```bash
npm run build
npm run regression:electron
```

使用 `scripts/regression/` 的自测、跨设备三表原子导入与崩溃恢复流程时，所有 user data 和结果写入项目忽略的 `test-data/` 或系统临时目录。生成的 `dist-selftest/`、`*-result.json` 与测试数据完成后删除，不进入 release。

### Web、测试云与 Android

涉及跨设备协议或移动端时额外运行：

```bash
npm run build:web
npm run build:cloud
npm run test:cross-device
npm run android:sync
```

`npm run test:cross-device` 先运行协议与移动客户端 Vitest，再用
`cloud/docker-compose.yml` + `cloud/docker-compose.test.yml` 只验证 Web/PWA 容器。Node personal-cloud
authority 已退役，不能再用 Docker/Coolify、静态 bearer account 或本地 JSON 卷模拟 production。
回环协议测试直接使用 `startDeviceSyncTestBackend()` 且只监听 `127.0.0.1`；生产数据面必须验证
canonical foxlink-cloud-mcp → private service binding → Account DO 链路。回环与嵌入测试后端绑定动态端口 0 时必须避开 WHATWG Fetch forbidden-port 列表（`FL-SYNC-008`）：显式 forbidden 端口在 bind 前拒绝、标准列表不可被 seam 绕开、并发 `listen()` 合并、重试耗尽后服务保持关闭；`tests/deviceSyncServerPortSafety.test.ts` 为确定性回归，不得把端口 flake 当作 authority 故障。

账本协议测试必须覆盖 Bearer 鉴权、精确 CORS、512 KiB bundle/1 MiB 请求与响应字节预算、`opId` 重放及正文回退、
`baseRevision` 冲突、按连接分区的原子检查点、耐久冲突状态、`invalid_cursor` 恢复、单调 cursor 分页与账号隔离。
实时协议额外覆盖 start/pause/resume/finish/abort 合法迁移、command id 重放与复用、expected revision 冲突、
错误 session、单账号唯一活动会话、running/paused 三时间增长、长轮询变化/超时/断连清理、进程重启恢复，
以及 finish/abort 与 completed ledger 的原子衔接。浏览器在 360×800 / 412×915 和平板横竖屏下验证首次拉取、
双客户端实时控制、并发冲突、断网本机推算与缓存、重连、错误 token、移除 token 与清除本机缓存；旧账号 cursor 收到结构化 `invalid_cursor` 后必须只清理本机旧账本并从空 cursor 重建一次；PWA
离线壳不能依赖已经打开第二次才缓存的 hash 资源，也不得缓存 Bearer 接口响应。移动端离线专注还必须验证：无连接、陈旧 running/paused 缓存和从未确认云端状态时均可创建新本地 UUID；重载后活动草稿与 authority metadata 恢复；暂停/继续/结束三时间正确；重连不把未结束本机会话升级为 cloud live；不同远端 UUID 进入 `forked-local` 且命令域隔离；结束事务留下一个稳定 pending。IndexedDB 门禁覆盖 v2→v3、旧 opId 保留、遗留 uploading→retry、429/5xx 退避、conflict/rejected 终态、applied/duplicate 原子删除 pending 与 metadata。存在活动态或待处理记录时不能更换连接身份。

正式交付 Android APK 前，安装与工程要求匹配的 Android SDK 后从 `android/` 运行：

```bash
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
./gradlew :app:connectedDebugAndroidTest
```

当前工程使用 compileSdk 36、AGP 8.9.1，targetSdk 35 保持独立升级评估；至少覆盖 minSdk 24 与 targetSdk 35 设备，minSdk 不得低于按域 Network Security Config 生效的 API 24。
原生前台 Service 只显示云端已确认快照并转发通知/Tile 动作，不能复制业务计时状态机。必须验证通知权限允许/拒绝、
暂停/继续/结束、陈旧 revision、WebView 冷启动 drain/ack、进程杀死后安全恢复和结束后移除前台通知；未通过这些门禁
不得宣称 Android 已支持可靠后台控制。原生前台 Service 还必须在 WebView 进入后台后每 20 秒读取一次云端权威快照，
凭据使用 Android Keystore 加密，Web 会话存储丢失不得隐式删除原生凭据；网络中断时保留最后确认状态，另一设备结束后应在一个轮询周期内移除通知。通知/Tile 命令还必须在 WebView 被回收后由 Service 直接提交，断网保留、恢复重试、与 Web 并发重放只生效一次。真机门禁还需读取原生诊断计数，确认 WebView 退后台后至少连续成功三轮；注入低 revision 的 WebView 缓存不得覆盖新云端快照，idle revision 必须阻止已结束会话复活。华为、小米测试必须分别记录系统后台/自启动授权状态，未授权被 OEM 冻结应明确呈现为系统限制而不是假报在线。

平板系统显示门禁还必须验证：Manifest 声明可选画中画且 Activity 支持 PiP；活动会话可显式进入/退出沉浸系统栏，结束后恢复；支持设备可进入系统画中画且返回应用后状态收敛；锁屏通知公开版本不含任务标题或连接信息；暂停提醒偏好在 1–240 分钟内持久化，默认 3 分钟，每个暂停 revision 只提醒一次，恢复/结束后清除。华为/荣耀候选必须在真机断言 `huawei-live-capsule` 选择结果、`TIMER` event、capsule Bundle、运行/暂停状态和 elapsed；系统忽略兼容字段时必须保留持续通知。

原生 HTTP 必须经可注入的 `FocusCloudClient` 边界；JVM 测试至少覆盖 applied/duplicate/conflict/rejected、
错误 command id、非终态 ack、断网、非 200 和非法 JSON。Service 只有在匹配 command id 的终态 ack 后才可删除持久命令，
其他失败必须保留以便下一轮至少一次重放。OEM 候选的纯逻辑测试必须覆盖华为 action、小米显式组件及最终应用详情兜底。

原生 completed-ledger 还必须用隔离 SharedPreferences instrumentation 覆盖完整 terminal 生命周期：conflict/rejected 保留原 outbox、写 sidecar并从普通 Worker 队列排除；用户未点击时二次 Worker 不得发送。用户在电脑端处理后，只有当前 device + connection lease 通过的显式“重新检查”才能提交独立 unique work + `REPLACE`；该 work 必须持久绑定 expected device id，marker 在执行前保持不变，普通 `KEEP` worker 永远不可读取。排程失败、进程重启、错误 device/lease 与 A→B 账号切换都必须 fail-closed 且不得形成裸 pending；applied/duplicate 后 outbox 与 sidecar 同时清除；孤立 marker 清理不得伪报 requeued，有效 foreign marker 不得被当前设备状态读取改写。

发布前必须证明 Node production authority 无法启动：`startPersonalCloud()` 固定失败，Compose 不包含
`focuslink-cloud` API，容器配置不含 `FOCUSLINK_CLOUD_ACCOUNTS` 或生产 bearer token。运行
`wrangler deploy --dry-run` 只用于生成本地 bundle 证据，不等于部署或远端验收。

Cloudflare 托管实现必须先执行 Worker 类型检查、本地协议测试、deployment containment 测试和 dry-run。外部 run/verify 只能在显式 opt-in 的 `127.0.0.1` disposable Worker 上执行；`FOCUSLINK_TEST_STATE` 仅允许项目 `.tmp` 或系统临时目录下的受控直系状态文件，必须拒绝 junction/symlink/非普通文件、exclusive create 并在读取/清理前复核文件身份，状态不得保存 credential。external verify 只验证持久化、不得自动删除外部状态文件；local 隔离 gate 才自动清理自己创建的临时目录与状态。
私有 FocusLink Worker 不得有 `workers.dev`、preview 或 custom route；唯一公网 origin 是
foxlink-cloud-mcp adapter。公网门禁覆盖 canonical `/sync/v2/*`、`/sync/v1/pair/*`、错误 token、
OAuth/device 双向拒绝、`opId` applied/duplicate/复用拒绝、旧 revision conflict、cursor 增量、
任务快照、`commandId` 幂等与复用拒绝、实时 start/pause/resume/finish，以及 MCP
`focuslink:read` 摘要。保存第一次运行的状态证据，升级后确认 ledger、revision、change feed、
实时 idle 和幂等结果仍在；访问令牌只通过 deploy secret 与各平台安全存储传递。

账号 bootstrap 门禁必须覆盖严格 start/poll 字段、canonical `/owner/*` URL、`flb_*` poll token 短期单次消费、过期 flow、额外字段、错误 origin、凭据/日志脱敏和“未登录不得 authenticated”。`npm run probe:account-bootstrap` 只输出结构化状态；只有 `deployed-login-required` 返回成功退出码，`not-deployed` 是可诊断的真实阻塞，不算公网通过。上线验收必须在无旧凭据的新安装上完成 owner 登录、独立 `fl2` 签发和第二次 poll 拒绝，并确认旧安装原位升级仍在线。

可信设备短码配对门禁额外覆盖：offer 只有合法 `fl2 + sync:write` 或 dedicated pair-service authority 能创建；设备路径只返回 8 位数字 code + 10 分钟 expiresAt，DO 落盘只含域分离 HMAC。exchange 不携带 bearer，必须绑定完整 installationId/displayName/platform/deviceKind/appVersion，签发的 deviceId 与 token identity 一致且 scopes 精确为 sync/live 四项。错误码、过期、单次消费、重放、跨账号/绑定不符、短码碰撞有界重试、client/credential-hash 限流和日志脱敏都必须有负测。真实验收从已登录设备生成码，在全新隔离 profile/新设备输入；成功后分别确认任务 revision 收敛、live 长轮询确认和 completed-ledger 同步，任何一条不能由另外两条冒充。

任务快照 freshness 门禁使用不含真实任务正文的 fixture，覆盖发布回读一致性、GET `no-store`、前台 15 秒自动刷新、revision 36→37 收敛、延迟 36 不回退、同 revision 异文拒绝，以及父子 ID/parentId 数量守恒。Account DO 与 loopback 都必须接受 `publishedAt = serverTime + 5 分钟` 以内的边界值、拒绝超限值并返回 `422 task_snapshot_timestamp_too_far_ahead`，且超限不得改写当前 register；已持久化 legacy far-future 快照必须可由合法新快照恢复。桌面 durable pending 收到该 422 后只可执行一次可信 GET 与一次重戳 POST；第二次 422、GET/解析/重试失败或连接 scope/generation 变化均保留 pending，`stale_task_snapshot` 才可清除，`task_snapshot_conflict` 必须保留。

Sync v2 额外覆盖 inventory/manifest/bootstrap、三类 epoch、租约过期恢复、`opId` 幂等、旧 revision 冲突、tagId 合并、tombstone 水位、配对 nonce 重放、scope/撤销/轮换、冲突/回收站标准 mutation、Queue `credential-missing` 诊断和重部署持久性。R2 门禁必须包含真实 object 写入、AES-GCM 篡改检测、maintenance 写拒绝、恢复失败回滚及 generation 切换；账户未启用 R2 时记录 Cloudflare 错误码并判定该门禁未通过。

Authority observation 本地合同必须覆盖：默认公网入口拒绝、named service binding、精确 vendor `Accept` / `Content-Type`、独立 `Capability`、中央 registry 固定的 `productId=identity-focus` 与完整 HTTPS `/authority/identity-focus` audience、缺 binding/配置、错误 capability/audience、依赖失败、过期、额外字段与不可用 revision。测试必须对同一持久化 revision 连读并确认正文、truth、时间字段及计算出的 SHA-256 observation hash 完全相同；任何非 200 响应不得携带签名字段或返回 secret。

公网移动端验收必须在 Windows FocusLink 进程停止时，分别由小米手机和华为平板完成开始、暂停、继续、结束，并在 Cloudflare 中各形成一份含 2 个 segment、1 个 pause 的独立账本。随后 Windows 启动并执行同步，两份会话在 SQLite 中各出现一次；再次同步不得增加副本。旧 Node cursor 切到 Cloudflare 时，客户端必须根据结构化 `invalid_cursor` 清空当前连接的缓存并从空 cursor 重建，不得依赖人工清数据。

Android 门禁限定 `:app:`，只测试最终可交付 APK；不要让 Gradle 根任务选择器额外构建 Capacitor
生成库中没有产品测试源码的 instrumentation APK。

ADB 安装门禁必须先用 `adb devices -l` 核对指定小米手机和华为平板的两个唯一序列号；OPPO OWW221 已于 2026-08-11 退役，不再开发或验证，
安装与日志命令均显式传 `adb -s <serial>`，并逐台回读同一 APK 的 `versionName` / `versionCode`。移动端只接受
canonical HTTPS authority；不得再配置 ADB reverse、localhost/LAN HTTP，也不得为了真机调试放宽 Android
明文网络规则。手机和平板逐台跑连接测试时设置 `ANDROID_SERIAL` 后执行 `:app:connectedDebugAndroidTest`，
并核对各自的测试报告；不得用历史手表记录替代当前手机/平板 instrumentation 证据。

instrumentation 中的 native store 测试必须使用隔离的 SharedPreferences，禁止清空真机正在使用的
`focus_runtime_native_v1`。Gradle connected 任务可能在收尾卸载目标调试包，因此只能在专用测试设备
或配置实时链路之前运行；需要保留已配置真机时，分别 `adb install -r` target/test APK、执行
`am instrument`，最后只卸载 `.test` 包，随后复核目标包、token/缓存和 native command 队列仍在。

单手机原生云端验收先以 PC 命令建立 running 会话，再通过 canonical HTTPS authority 执行以下两项；参数缺失时测试必须报告
skipped，不得静默计为云端已验证：

```bash
adb -s <serial> shell am instrument -w -r \
  -e class 'app.focuslink.mobile.ExampleInstrumentedTest#backgroundServiceUploadsCommandsWithoutWebView' \
  -e focuslinkEndpoint 'https://<temporary-authority-host>' -e focuslinkToken '<temporary-token>' \
  app.focuslink.mobile.test/androidx.test.runner.AndroidJUnitRunner
adb -s <serial> shell am instrument -w -r \
  -e class 'app.focuslink.mobile.ExampleInstrumentedTest#backgroundServiceRetriesAfterConnectionRecovery' \
  -e focuslinkEndpoint 'https://<temporary-authority-host>' -e focuslinkToken '<temporary-token>' \
  app.focuslink.mobile.test/androidx.test.runner.AndroidJUnitRunner
```

`android/app/src/test/java/app/focuslink/mobile/FocusLinkConfigTest.java` 必须校验构建产物的
`BuildConfig.VERSION_NAME` 与本次 `android/app/build.gradle` 配置一致；该单元测试属于 Android APK
交付门禁，不得以 TypeScript 门禁已通过代替。

双机实时 smoke 必须在两个序列号上安装同一 APK、授予或显式拒绝通知权限并保持各自 HTTPS authority 连接。设备 A 开始后
设备 B 应在一个长轮询周期内显示同一 session；依次从两台设备执行暂停/继续，确认 revision 单调且三时间守恒；
制造同 revision 并发动作时只能一个 applied，另一台刷新 conflict 快照。结束后两台都回到 idle、账本各出现且只出现
一份完整会话，前台通知消失。断开一台网络后应保留缓存并标为离线推算，恢复后收敛；最后检查 logcat 无 crash、
ANR、ForegroundServiceStartNotAllowedException 或通知通道错误。

Android 真机还必须分别在手机和平板验证：任务父子叠层及 44px 展开命中、开始前树序任务选择、running/paused 时间之带在首分钟不会铺满且刻度可读；显式授予 overlay 后回到系统桌面，左上角计时逐秒更新并可点击回到 App，结束后消失。拒绝或撤销 overlay 权限时应用应继续通过通知工作且不崩溃。Windows FocusLink 进程停止期间，手机开始、平板暂停、手机继续、平板结束必须仍由 canonical authority 收敛为一份 `2 segments + 1 pause` 账本；Windows 重启并同步后只能导入一次，不得配置或恢复 ADB reverse。

OPPO OWW221 已退役；新候选不再安装或验证手表 renderer，相关历史实现与记录只保留用于兼容审计。

### UI smoke

- 主窗覆盖深浅主题的 idle、running、paused、任务、统计、设置和 TaskPicker。
- 契约断言覆盖六套真实界面字体、五套计时仪表、7×9 点阵（含窄冒号不越界）、翻页 `fold/unfold/steady` DOM 闭环与动画取消兜底、canvas 时间之带实时渲染与 finished 冻结、统计日报的 KPI/双尺度单日时间轴/多日堆叠柱/100% 任务构成带/暂停损耗，以及 Electron 原生全屏沉浸覆盖层、进入过渡和全页仅一个 TimerDial/TemporalRibbon 动画实例。
- 视觉断言要确认主工作面无大面积 `backdrop-filter`/blur/光晕，文字对比与字号下限符合前端规范，reduced-motion 无持续呼吸或位移。
- 覆盖默认尺寸、980×660 最小尺寸、1280×720、键盘焦点和无横向溢出；多日柱图的每日精确值必须可键盘聚焦。
- v0.12.86 起主窗与移动 UI smoke 追加以下验收（对应 `FL-REQ-20260811-UI-ITER`）：
  - 主窗：980×660 最小地板（与 `shared/mainWindowLayout.ts` 的 `MAIN_WINDOW_MIN_SIZE` 一致）与 1280×720 下仪表列/纪念碑无级联冲突，低保档保留 112px 计时舞台；账本列按 <1100px=336px / 默认 384px / ≥1600px=440px 分层，长时长不被任务标题挤压；桌面样式禁止 <10px 字号；`.text-meta` ≥11px、`.text-diag` ≥10px；搜索框 `:focus-visible` 为 2px 强调色描边；实心按钮与表单控件有显式 disabled 态；圆角只用 `--radius-*` 梯子，前景白/遮罩/表盘阴影必须 token 化。
  - 移动/平板：≤619px 手机顶部栏与同步条压缩后主读数与主操作留在首屏；640×1024 竖屏主操作条粘性位于底部导航之上并预留高度，规则必须排在旧 `≥620px bottom:0` 覆盖层之后（级联序有测试锁定）；760px/横屏双栏详情不再留白；空统计态为紧凑占位。
  - IME：软键盘弹出不得遮挡粘性操作区——Web viewport 含 `interactive-widget=resizes-content`，Android MainActivity 含 `android:windowSoftInputMode=adjustResize`，文本输入 16px。
  - 主题与 a11y：`system` 主题在 OS 外观切换后实时跟随、无需重载（现代与 legacy 监听路径均注册并清理）；44px 触控目标；对比度按 token 级 WCAG 下限（正文 ≥7:1；次要、辅助、成功与危险 ≥4.5:1；实心按钮标签 ≥4.5:1；暂停红 ≥3:1）。
- 小窗覆盖 expanded/collapsed、running/paused、实时主题/字体切换、透明边界、DPR、多显示器 work area 和四边吸附；Windows 原生拖拽必须由 `WM_ENTERSIZEMOVE` / `WM_EXITSIZEMOVE` 区分按住与释放，断言收起态仅有状态、当前时间、60 格当前分钟秒轨和展开入口，展开态在 `256×70` 外框内完整显示任务名、三项累计与全部控制，时间与按钮分区且按钮不换行；暂停粒子必须跟随消逝边界，并覆盖 320ms 收束与过渡中拖动取消；置顶动作（`mini.bringToFront`）前后必须断言收起态几何与 Win32 前台窗口身份（handle/processId/title）保持不变，且不抢焦点。
- 小窗像素精修（v0.12.86）由 `mini-ui-smoke.cjs` 断言：收起态展开入口 24px 命中区落在 30px 列内且 `min-width` 守住、展开态状态点 7px、秒轨 10px、指标 8.5/9.5px、控制 9px/17px 高；尺寸三重事实仍必须是 184×44 / 256×70 两态，不得引入第三尺寸。
- 小窗尺寸以 BrowserWindow 内容 viewport、填满 viewport 的 shell 和截图像素为三重事实；Chromium 的 `window.outerWidth/outerHeight` 在 Windows runner 可能包含不可见系统边框，只能用于诊断和重复命令前后不变性，不能作为固定内容尺寸的发布断言。
- 关闭 smoke 后删除临时 user-data 必须允许 Windows 日志尾写入的有界重试；清理错误不得覆盖首个产品/断言错误。
- 统计 smoke 连续快速展开不同会话、在计时 tick 中滚动/切换页面，确认旧请求不会覆盖新详情，退出页不拦截鼠标。
- 任务 smoke 必须用真实临时滴答任务完成整条可逆链路：“完成 → 6 秒内撤销 → 再次完成 → 已完成视图按 `completedAt` 找到 → 恢复未完成”。同时覆盖 30/90/365 天选项、名称/日期排序和超过 120 项时的逐步显示。
- UI smoke 输出放系统临时目录，不放仓库根目录。
- 跨设备实时控制改动必须运行 `npm run smoke:live-fallback -- <本次 win-unpacked\\FocusLink.exe>`：脚本使用隔离 userData、不可达 loopback，并由 Electron `safeStorage` helper 在该临时 profile 内生成 synthetic 非生产令牌；不得读取或复制当前账户真实凭据。脚本断言首次握手失败后本机计时仍能开始并结束；helper 初始化、加密或解密失败必须在有界超时内明确失败，不得以 `SKIP` 计入通过。

### 真实 dida 临时任务

正式发布前运行：

```bash
npm run smoke:dida
npm run smoke:dida:state
npm run smoke:dida:ui -- ../release-v01214/win-unpacked/FocusLink.exe
```

第三条必须指向本次刚构建的 unpacked 可执行文件；脚本不会猜测旧版本资产。

1. 创建临时 dida 任务。
2. 以 argv 写入包含中文和 `[FocusLink:segment:<id>]` 的评论。
3. 回读评论，确认 marker 恰好出现一次。
4. 重复写入并确认被幂等跳过。
5. 创建一个短原生 focus，确认有效时长与关联任务正确。
6. 完成和取消完成普通任务；若本版改变 checklist，额外验证父任务目标 item 的可逆状态。
7. 在真实 UI 中完成“完成 → 撤销 → 再完成 → 完成列表找回 → 恢复”，确认 `completedAt` 排序和完成时间显示正确。
8. 删除临时 focus、评论/任务，确认无测试垃圾残留。

### 真实番茄 To-do

客户端处于已登录可同步状态后运行 `npm run smoke:tomatodo:bridge` 和 `npm run smoke:tomatodo:real`。前者是不写业务数据的真实桥接 probe，番茄桥接启动/发现逻辑变更时必须纳入发布门禁；后者验证唯一 marker 的本地写入与上传边界。核对以下结果：

- FocusLink 启动和后台周期重试：客户端关闭时记录保持待上传，不会擅自启动番茄 To-do。
- 用户手动同步且客户端未运行：标准安装路径可用时，使用参数数组以 `--remote-debugging-port=0` 按需启动，实际 target 通过身份校验后才连接。
- 客户端已以普通模式运行但无桥：不得杀进程或自动重启，结果必须要求用户完全退出后再连接。
- 客户端运行且已登录：`cloudSyncUploadRecord` 返回 success 后标记上传已确认；当前客户端没有专注记录独立云端回读，禁止把本地 marker / `isSynced=1` 写成“云端回读通过”。
- 手机投递必须单独验证：`syncGetStatus().connectedCount=0` 时，云上传成功仍保留 `phone-pending` durable queue；只有在线手机通道调用 `syncRecord` 并返回确认后，才可清除该队列。`isSynced=1` 不能代替手机投递确认。
- 已存在且云端确认的 marker 仍须支持手机重试；marker 幂等只约束 PCRecord 创建，不能让手机投递因“已存在”而跳过。
- 覆盖 7 天云投递窗口：超窗 PCRecord 必须保持未确认并返回 `tomatodo_record_outside_seven_day_window`；真机云端验收按“停止手机应用 → 单批上传 → 启动手机应用 → 读取下载数量”执行，避免一次性批次被后台提前消费。
- 未识别标题落入“学习”；已知学科映射正确。
- 重复写入 marker 不产生重复记录。
- `smoke:tomatodo:bridge` 必须无业务写入地验证标准路径按需启动、番茄 ToDo 标题与特征 electronAPI 方法校验，以及已运行普通实例绝不被结束；错误页面必须被拒绝。
- 修改已有 marker 的学科会请求重新上传；桥不可用或上传失败时必须留下 durable pending，旧 `isSynced=1` 不得掩盖新学科待上传状态。删除 smoke 只验证本地 marker 清理与幂等。当前 API 不支持远端记录删除，结果必须明确报告 `remoteDeleteSupported=false`、`remoteCleanupVerified=false`。
- smoke 从第一次写入尝试开始就在 `finally` 按唯一 marker 尽力清理，覆盖“写入已发生但响应丢失”；不得破坏用户既有记录。若需要确认云端无临时记录，只能在番茄 ToDo 服务端/其他已绑定端人工核对，不能由本 smoke 宣称。

## 2. 版本一致性

### 版本迭代节流规则（2026-08-25）

- 同一组功能在验收期间只占用一个候选版本号；代码、测试、文案、视觉微调和同一功能的修复都合并到当前候选，不为每次中间重打包再升号。
- `patch` 版本只在一组用户可见行为准备实际安装/分发时递增；`0.12.104` 只用于“每台设备本机码、反向批准、自动领取和设备撤销权限”这一组完整协议/交互候选，组内后续小修不再递增。
- `minor` 版本用于一组完整的新产品能力且保持兼容；`major` 版本只用于数据模型、同步协议、权限或用户迁移不兼容变更。
- 只改文档、测试、构建脚本或未进入安装矩阵的中间修复不升产品版本；若已安装候选发现用户可见回归，则继续修复当前工作批次并在下一次实际分发前只升一次。
- 每个最终候选仍必须满足三端同版门禁；版本号节流不等于复用已经实际安装且失败的候选。

版本号变更必须在同一次提交中同步：

- `package.json`
- `package-lock.json`
- `shared/version.ts`
- `electron-builder.yml` 的输出目录
- `android/app/build.gradle` 的 `versionName` 与 `versionCode`
- `android/app/src/test/java/app/focuslink/mobile/FocusLinkConfigTest.java` 的版本断言
- 根目录 `README.md`
- 根目录 `CHANGELOG.md`
- `frontend-design/` 与 `backend-design/` 的适用版本
- 当前版本 `release-v*/RELEASE_NOTES.md`

Android `versionCode` 必须为正整数，且高于此前所有已发布或测试分发 APK 的值；每次分发都只能单调递增，
不得因语义版本回退、补发或重建而复用或降低。`versionName` 及其单元测试断言必须与本次版本策略同步更新。

跨端 UI 或行为每轮候选必须递增补丁版本。正式构建前必须把同一版本实际安装到 Windows、指定小米手机、
指定华为平板，分别回读版本并完成三设备验证矩阵；任一在用端缺失、版本落后或不一致时，不得标记完成、
执行正式打包、创建 tag 或发布。华为现用胶囊布局模块、Windows 两态小窗和小米系统表面必须保留并复验；
OPPO 手表 renderer 已冻结并退出新开发。

每个补丁版本都在测试、三设备同版安装、CHANGELOG/实施日志、四文件发布目录和 Android APK 备份完成后推送 `main`。补丁尾号不再决定上传节奏；annotated tag、公开资产和 GitHub Release 只在用户明确要求时创建，不得因版本尾号自动发布。

目录规则：`0.11.5 → release-v0115`，`0.2.10 → release-v0210`。发布目录位于源码工作区父级；仓库本地只保留最新三个 release 目录，更老的安装包由 GitHub Releases 长期保存。

### Git LFS 磁盘安全门禁

发布目录中的安装版和便携版 EXE 由 Git LFS 管理。禁止让普通的全仓 `git diff`、GUI 变更扫描或高频状态轮询反复处理 `release-v*/FocusLink-*-x64*.exe`；一个已修改的约 200 MB EXE 会反复启动 `git-lfs filter-process`，中断或重入时可在 `.git/lfs/tmp` 留下数百 GB 临时文件。只读检查必须排除发布 EXE，或仅对该次只读命令禁用 LFS filter；`add`、`commit`、`fetch`、`pull`、`push` 和正式发布流程始终保持 LFS 启用。

若 `.git/lfs/tmp` 异常增长，先停止重复触发它的 Git 客户端或命令并确认没有活动的 `git-lfs` 进程，再清理 `tmp`；不得把 `.git/lfs/objects` 当作临时目录删除。为规避故障 GUI watcher，可以在本机 `.git/info/attributes` 临时覆盖发布 EXE 的 filter/diff，但该文件不得提交。任何发布 EXE 入暂存区前必须删除此覆盖，并执行：

```bash
git check-attr filter diff -- release-vXYZ/FocusLink-x.y.z-x64.exe release-vXYZ/FocusLink-x.y.z-x64-portable.exe
```

两个文件都必须分别返回 `filter: lfs` 和 `diff: lfs`。正式构建前后都要记录 `.git/lfs/tmp` 的文件数与大小；目录非空或仍在增长即视为门禁失败，排除触发源后才能继续发布。

Foxlink 独立 MCP 的重启门禁还必须验证：停止 `FoxlinkSecureMcpTunnel` 与 `PoyiFoxlinkMcp` 后，
8770/8878 均消失且其他 MCP 服务保持运行；重新启动后两个 `/readyz` 恢复。若 WinSW 返回 1067，
先从 Windows Application 事件确认是否为 `service-logs/tunnel` ACL 漂移，再以提升权限执行
`mcp/tunnel/repair-acl.ps1`，不得通过新建 Tunnel 或替换 Runtime Key 掩盖本地权限问题。

## 3. 正式构建

安装器出现“FocusLink 无法关闭”或重复重试框时，先按
[INSTALLER_TROUBLESHOOTING.md](INSTALLER_TROUBLESHOOTING.md) 的 `FL-INSTALL-001` 处理；不要连续点击重试，也不要使用不带账户过滤的全局强杀命令。

安装后若出现 `timer:start-with-task` / `TypeError: fetch failed` 或跨设备同步不可达，先按 [SYNC_TROUBLESHOOTING.md](SYNC_TROUBLESHOOTING.md) 的 `FL-SYNC-001` 和 `FL-SYNC-002` 处理；该错误表示实时/账本服务不可达，不是安装器或本地计时器故障。

1. 完成功能源码提交，确认 `git status --short` 为空；该提交是 Release notes 中的“对应提交”。
2. 在这个干净源码提交上执行全部测试与 `npm run dist`；正式包写到父级 `release-v*`，`shared/version.generated.ts` 与包内元数据不得含 `-dirty`。
3. 对安装版与便携版计算 SHA256，写入 `SHA256SUMS.txt`，并运行安装版与便携版 smoke；不能只验证 `win-unpacked`。
   本机若已有不能中断的 FocusLink 会话，只允许在启动安装器的父进程临时设置
   `FOCUSLINK_INSTALLER_SKIP_CLOSE=1`，并用 `/D=<系统临时目录>` 安装后验收；不得把该变量写入系统环境。
   隔离安装前还必须备份并临时隐藏当前用户的 FocusLink 卸载注册项，避免 Electron Builder 把本次验证识别成升级并卸载正在运行的正式安装；
   桌面/开始菜单快捷方式也要先保存，并在 `finally` 中连同卸载注册项原样恢复。验证结束后必须确认原进程仍在、注册版本与两个快捷方式目标均未改变。
   `build/installer.nsh` 只能在 `customInit` 中使用当前用户 profile 路径及完整的 `%USERDOMAIN%\\%USERNAME%` 限定退出命令处理当前账户，
   并以 `/IM` 覆盖 Electron 子进程；禁止使用会卡住 Chromium 进程树的 `/T`。关闭后只允许在当前安装器
   进程树内设置 `FOCUSLINK_INSTALLER_SKIP_CLOSE=1`，供 0.12.17 旧卸载器绕过全局扫描，禁止持久化该变量。
   禁止重新引入 `nsProcess` / `tasklist` 全局扫描、无用户名过滤的终止命令或预安装强杀钩子，否则安装器会
   把其他账户的 smoke 进程误判为安装阻塞，并在不可见提示框或“无法关闭”弹窗上永久等待。
   GitHub Actions 的干净 runner 必须不设置该变量，覆盖安装器默认路径。若 NSIS 在 runner 上以 Windows 访问冲突
   `0xC0000005` 退出，可清理隔离安装目录并按发布工作流进行有界重试，最多共 4 次；只允许该退出码，第四次或其他退出码必须立即失败。
4. 填完对应根发布目录内唯一的 `RELEASE_NOTES.md`，记录上一步的源码提交和真实 SHA256；不可变元数据固定为
   “发布类型：正式版 / 验证状态：已通过”，不在正式 Release 正文里保留“候选”或“待发布”。
5. 清理 release 目录，只留下下列四个文件；把发布资产、notes 和本次生成的版本元数据组成单独的 release-record commit。该提交不得再改产品源码。

```text
../release-vXYZ/
├── FocusLink-x.y.z-x64.exe
├── FocusLink-x.y.z-x64-portable.exe
├── SHA256SUMS.txt
└── RELEASE_NOTES.md
```

`win-unpacked/`、`builder-debug.yml`、`*.blockmap`、日志、截图和测试 JSON 都不是发布资产。

## 4. Release notes

- 从 [../../.github/RELEASE_NOTES_TEMPLATE.md](../../.github/RELEASE_NOTES_TEMPLATE.md) 复制并填写。
- 内容必须与 `CHANGELOG.md` 同版本段落一致，但面向用户组织，不粘贴内部流水账。
- 只列已经实现并验证的内容；未完成项保留在下一版本草稿，不能写进发布正文。
- 必须记录升级提示、已知限制、验证摘要和两个资产的 SHA256。
- 正式正文使用稳定的“发布类型 / 验证状态”，不要使用发布后必然过期的“待发布”状态。
- 本地 `../release-v*/RELEASE_NOTES.md` 与 GitHub Release 正文保持一致，是离线发布记录。

## 5. GitHub 发布门禁

GitHub Actions 会复跑可自动化的静态检查、源码构建和隔离回归，并重新 smoke 已提交的便携版与安装版；它不会重新生成另一套哈希不同的发布包。workflow 会核对 package-lock 的根版本、annotated tag、源码提交祖先关系、唯一 Release notes、四文件目录和 SHA256，再原样发布这些已验证资产。它不能替代需要本机登录态的 dida、番茄 To-do 真实临时数据验收，也不能替代最终人工视觉检查。只有本地全部门禁通过后才能推送版本 tag；tag 是“允许自动发布”的明确授权，不是开始测试的快捷方式。

顺序固定：

1. 推送包含源码提交与 release-record commit 的 `main`，确认两者都在远端；Release notes 的“对应提交”必须是实际生成二进制的干净源码提交。
2. 在 release-record commit 上创建并推送与版本完全一致的 annotated tag，例如 `v0.11.5`。
3. 创建 GitHub Release，标题使用 `FocusLink v0.11.5`，正文使用本地 `RELEASE_NOTES.md`。
4. 上传安装版、便携版和 `SHA256SUMS.txt`。
5. 回读 Release 页面，确认 tag、正文、资产名称、文件大小和下载链接正确。
6. 在仓库首页/README 更新当前版本链接（若版本链接存在）。

只执行 `git push` 或只推 tag 不等于发布。GitHub Release 创建失败时，报告为“构建完成，发布受阻”，不得宣告版本已发布。
公开 tag 一旦推送就不得移动或覆盖；若 tag workflow 在创建 GitHub Release 前失败，修复后发布新的补丁版本，并在 CHANGELOG 记录被阻断版本与替代版本。

## 6. 发布后审计

- 安装包 SHA256 与本地/Release 附件一致。
- GitHub Release 的 target commit 必须是包含四文件发布记录的 tagged release-record commit；Release notes 中的源码提交必须与包内构建元数据一致，且是 target commit 的祖先。
- 最新 release 不是 draft（除非明确进行预发布验收），附件均可下载。
- 本地只保留最新三个规范 release 目录。
- 工作区没有 `win-unpacked`、`dist-selftest`、`test-data`、结果 JSON 或散落报告。
- 根目录 `CHANGELOG.md` 顶部版本、README 和应用内版本一致。
