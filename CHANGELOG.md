# Changelog

## v0.12.86 - 2026-08-12（桌面密度/断点与小窗打磨、移动连续工作面与 640/760 响应式、IME/系统主题/a11y 修复）

- **候选身份升级**：0.12.85 已完成三设备实装回读并推送 main。跨端 UI/行为继续迭代，按候选身份不可复用规则，本轮唯一源码版本升为 `0.12.86/1286`（release-v01286）；旧 0.12.85 EXE/APK 只保留为历史证据，不回填本轮安装矩阵。
- **桌面密度与断点打磨**：980×660 最小尺寸下专注页仪器列与纪念碑的级联冲突、账本宽度分层、控制台密度与辅助字号下限（≥10px）收口；保留固定两态 mini（收起 `184×44` / 展开 `256×70`）的置顶、吸附、折叠语义打磨。
- **移动连续工作面取代嵌套卡片**：移动 renderer 以连续工作面替代嵌套卡片结构；640 竖屏下主操作粘性置于底部导航之上并预留高度；760 双栏（sidebar/树·详情）细化；清理半失效的 legacy 620 覆盖层。
- **IME/系统主题/a11y 修复**：键盘输入时不遮挡粘性操作区（`interactive-widget` / `adjustResize` 边界）；`system` 主题跟随系统实时变化；`partial` 等状态文案完整换行与触控目标/对比度回归。
- **自动化与 packaged 验证**：5 个锁定 DeepSeek worker 完成桌面、mini、移动、同步后端与验收规范的互斥审计；时间之带首分钟填充、IME、640/760 级联、触控目标与全主题 focus token 对比度进入静态/单元门禁。Node `22.22.2` / npm `10.9.9` 下 format/typecheck/lint、全量 Vitest `117 files / 848 tests`、build 与 Android unit/lint/AndroidTest 编译/assemble 已通过。干净候选的 packaged UI 与 mini smoke 已通过；mini smoke 由 OS 分配独立 loopback CDP 端口，消除随机端口竞态，并隔离本机 Foxlink business API 凭据/监听端口。
- **当前状态**：提交 `85c1155` 的 installer/portable 已打包，packaged UI/mini/live-fallback 均通过；`release-v01286/` 已收敛为四文件，APK 已备份并复核 SHA-256。Windows 安装器 `/S` exit 0，卸载项与已安装 EXE 均回读 `0.12.86` 并已重启。小米 xaga 由 mDNS 发现当前地址 `192.168.1.4:5555`，`adb install -r` 成功并回读 `0.12.86/1286`、启动成功；旧 `192.168.50.250:5555` 只保留为 offline 历史。华为 DBY-W09 未出现在 `adb devices`/mDNS，历史 `192.168.1.7:5555` 及当前已发现邻居端口均不可达，故三设备同版门禁仍未闭合，不能推送为完整交付。OPPO OWW221 保持退役/冻结。本轮未打 tag、未创建 GitHub Release。

## v0.12.85 - 2026-08-11（版本源提升：loopback 服务 Fetch 安全端口与隔离 synthetic 凭据 smoke）

- **候选身份升级**：0.12.84 二进制（干净提交 `1c800a8`）之后又发生产品邻近的 loopback 同步服务与 smoke 修复（提交 `ba3ca82`）。按候选身份不可复用规则，0.12.84 不得继续作为候选，本轮唯一源码版本升为 `0.12.85/1285`；旧 EXE/APK 不得回填。
- **loopback 同步服务 Fetch 安全端口**：`cloud/deviceSyncServer.ts` 监听时拒绝 Node Fetch 禁止端口集合（0/1/7/9/13/53/110/143/465/6000/6667/10080 等），请求端口不安全时自动在有界次数内重新绑定 Fetch 安全端口，并提供 `isPortForbidden` 测试注入点；新增 `deviceSyncServerPortSafety.test.ts` 确定性回归，防止合同/测试后端落到浏览器 fetch 无法访问的端口。
- **live fallback smoke 改为隔离 synthetic 凭据**：`live-fallback-packaged-smoke.cjs` 不再读取、复制或解密当前账户真实 device-sync 凭据与设置，改由新的 `write-synthetic-device-credential.cjs` 在隔离 profile 内用 Electron `safeStorage` 现场生成 synthetic 非生产令牌；helper 失败不再以 `SKIP` 计过，而是在有界超时内明确失败。
- **mini smoke 增加置顶几何断言**：`mini-ui-smoke.cjs` 在 `mini.bringToFront()` 前后读取前台窗口与收起态几何，断言置顶动作不改变收起态位置、viewport 或吸附边。
- **当前状态**：0.12.85 已完成 Windows、华为平板与小米手机同版安装回读；OPPO OWW221 按 2026-08-11 用户决定退役，不再开发或纳入门禁。完整最终树已干净整合（历史超大非 LFS blob 已从提交历史剔除），并推送 GitHub main 为提交 `40d6dec`；未创建 tag 或 GitHub Release——用户未要求正式发布。

## v0.12.84 - 2026-08-10（实时连接与干净 Electron 构建候选）

- **候选身份再次升级**：0.12.82 EXE 打包审计发现 `app.asar` 同时收录两轮 `dist-electron` hash chunks；并行隔离树已生成 0.12.83/1283，因此两个编号都不得复用，本轮唯一候选升为 `0.12.84/1284`。
- **构建卫生变成可执行门禁**：`npm run build` 在 gen-version 后、Vite 前强制运行 `clean:desktop-build`，只删除当前工作区直接子目录 `dist-electron`；隔离临时目录回归真实写入 stale chunk 后执行清理，阻止重复 build/dist 把旧 main/preload/service chunks 打入 app.asar。
- **继承功能**：完整继承 0.12.82 的固定备用数据面、前后台唯一 long-poll、HTTP authority fail-closed、machine-code-only 同步状态与 Windows 小窗“置于最顶层”。
- **当前状态**：Node 22.22.2/npm 10.9.9 下 format/typecheck/lint 与全量 Vitest 113 文件/792 项通过，desktop build hygiene 2/2；干净提交 `1c800a8` 的 app.asar 已审计，packaged mini smoke exit 0（28.5 秒），使用 synthetic 非生产令牌的隔离 live fallback smoke exit 0（2.3 秒）。Windows 已静默覆盖、回读卸载项与文件版本 0.12.84 并重启；Android 0.12.84/1284 的 JVM 36/36、lint、AndroidTest 编译和 assemble 已通过。小米 `192.168.50.250:5555` 当前在线并回读 0.12.84/1284；华为 `192.168.1.7:5555` 已转 offline，缺本轮有效回读，OPPO/手表按用户要求不处理。发布目录仍含非发布文件，LFS 正式暂存属性复核也尚未执行，因此不能宣称四端门禁或正式发布完成。

## v0.12.82 - 2026-08-09（实时连接 failover 与长轮询修复候选）

- **候选身份升级**：0.12.81 在 APK 生成后又收口了 Android failover-first、第二域名 401/403 状态保真以及备用域名长轮询语义超时；按跨端候选不可复用规则，0.12.81 不晋级，本轮统一升为 `0.12.82/1282`，旧 APK/EXE 不得回填。
- **实时连接可用性**：固定备用数据面优先用于实时控制、任务快照、移动 Sync v2 与 Android CloudClient；只有 transport 失败才切换 origin，任何 HTTP 响应都保留为当前 authority 的权威结果，不跨域吞掉。页面隐藏或 Capacitor inactive 会中止旧 long-poll，`pageshow` 只重新评估而不伪造 native active，online/凭据等依赖更新也不能在后台重启请求，恢复前台只启动一个新 loop；备用域名的合法 bounded wait 不再被 8 秒误截断，结构化连接原因会在状态条和专注控制台一致呈现并于恢复后清除。
- **桌面小窗**：设置 → 专注小窗增加“置于最顶层”按钮；动作不抢焦点、不改变两态尺寸、位置、吸附或控件数量。
- **同步状态只认机器码**：设置 presenter 不再用中文正则猜测 transport/conflict；旧安装遗留值只在 Electron 持久层边界迁移并回写，未知文本统一安全降级，不会原样进入 UI。
- **验证状态**：Node 22.22.2/npm 10.9.9 下全量 Vitest 112 文件/790 项、typecheck/lint/format 通过；Android JVM 36/36、lint、AndroidTest 编译通过。0.12.82 尚未完成 Windows/Xiaomi/Huawei 同版安装与网络切换真机 smoke；OPPO/手表按本轮用户要求不处理，不能写成四端发布完成。

## v0.12.81 - 2026-08-09（实时连接备用数据面与桌面小窗置顶候选）

- **真实根因已分离**：小米与华为当前 Wi‑Fi 对 `workers.dev` 的 DNS/443 持续阻断，实时 `/sync/v2/live` 在 TLS 前超时，不能归咎于 token、权限或任务数据。固定备用数据面 `https://focuslink.pyzzgk.dpdns.org` 的 `/healthz` 返回 200、无凭据 `/sync/v2/status` 返回 401，证明路由与 fail-closed 鉴权仍在。
- **移动实时与账本 failover**：实时控制、任务快照、移动 Sync v2 和 Android 原生 CloudClient 仅在固定白名单内优先尝试备用域名；只有 transport/network/timeout 失败才尝试 canonical，任意 HTTP 响应均不跨 origin；Android 仅在首个 `IOException` 后切换。不接受任意用户域名、不把备用域名用于登录；任一候选返回的 401/403、协议错误和明确拒绝都保留为权威结果，Android 第二次请求的身份状态也不再因异常包装而丢失或形成后台重试风暴。
- **生命周期与长轮询修复**：页面隐藏、Capacitor inactive 会立即中止旧 long-poll；恢复前台只启动一个新的 generation loop。固定备用候选不再因并非持久化 endpoint 而于 8 秒提前中止合法的 25 秒 bounded wait。网络/超时/409/5xx/rate-limit 有界退避，认证与协议错误停止盲目重试并给出明确提示。
- **Windows 小窗**：设置 → 专注小窗新增“置于最顶层”按钮；动作不抢焦点、不改变两态尺寸、位置、吸附或控件数量。
- **候选状态**：源码回归曾通过，但在 APK 生成后又补了 Android 401/403 保真与移动 long-poll 语义修复；该候选已由 v0.12.82 取代，不得安装、回填或写成发布完成。

## v0.12.80 - 2026-08-09（终态拒绝与 Android authority 语义修正候选）

- **0.12.79 候选作废并重新编号**：0.12.79 构建后又发现 `rejected_operation` 被桌面设置页误报为整体同步失败、Android authority 将 terminal attention 混入 offline freshness，以及 Electron `dist-electron` 残留旧 dirty chunks。按候选身份与干净构建门禁，0.12.79 不晋级，统一升为 `0.12.80/1280`。
- **终态状态分域**：`rejected_operation` 现在显示“同步已连接，部分记录未同步”，保留记录并等待处理，不再把整个云端连接标红为失败；Android `conflict_present/rejected_operation` 作为 durable attention 保留安全诊断，有已验证投影时不伪报 offline，无验证时保持 unknown 并继续脱敏。
- **时序修复**：Android 在通过完整、单调的 ledger status 校验后，于同一 checkpoint 提交中清除旧的 ledger `network_error`；随后收到 conflict/rejected ACK 时只呈现 terminal attention，不会被历史传输错误重新压成 offline。live poll diagnostics 仍由独立存储保留。
- **构建卫生**：正式构建前清空 `dist-electron`，确保 `app.asar` 不含旧 `-dirty` chunk；候选包元数据绑定干净源码提交。
- **当前门禁**：Node `22.22.2` / npm `10.9.9` 下 format/typecheck/lint、110 个 Vitest 文件/778 项、6 个 cross-device 文件/47 项，以及 Android JVM 7 个 suite/32 项、lint 0 error 已通过；干净 Windows 包的 app.asar 无旧 dirty hash。Windows 已静默安装并回读 0.12.80；小米 `D68P65855TPBHYWS`（`.4:5555`）与华为 `f8630574`（`.7:5555`）已安装同一 `0.12.80/1280` APK、启动无崩溃/ANR，terminal lifecycle instrumentation 各 4/4 通过。OPPO OWW221（历史 `.44:5555`）仍不可达且无可核验序列号，因此四端正式门禁、最终四文件目录和发布仍阻塞。本节不得解释为已发布。

## v0.12.79 - 2026-08-08（云端同步状态语义与 Bug 必读门禁）

- **0.12.78 候选作废**：`0.12.78/1278` 已实装 Windows、小米和华为，但 OPPO OWW221 仍离线；实装后又确认设置页会把成功同步后的 `conflict_present` 误报为“跨设备同步失败”。按四设备安装门禁，已安装候选不得在继续修改后复用，因此统一升为 `0.12.79/1279`。
- **同步状态按机器码分类**：设置页不再用本地化中文正则猜测状态。`network_error/timeout` 显示服务暂不可达，`conflict_present + unresolvedConflicts > 0` 显示“同步已连接，有记录待确认”，身份/权限错误与协议/拒绝错误分别呈现；冲突数已归零时忽略陈旧 `conflict_present`，不会显示“0 条冲突”或落入红色失败。
- **跨端部分同步不再假确认**：移动账本按 completed-session identity 合并 legacy 与 Sync v2 durable 待办，不再把同一场 ledger/metadata 两条 mutation 误报成两场，也不会把旧账号已绑定记录计入当前账号。pending、conflict 或 rejected 任一存在时保持 `partial`，不推进原生 `lastVerifiedAt`；重启、再次失败和 deferred retry 后仍保留上一次完整确认时间。Android completed-ledger 将 conflict/rejected 写入 terminal sidecar，原记录保留、普通 WorkManager 重试停止；authority projection 同时携带 terminal 数量与安全错误码，后续其他记录成功也不能把它清成“已确认”。OPPO watch 对 applied/duplicate/conflict/rejected 四类 ACK 都显示明确结果。
- **错误与本地持久化边界加固**：Windows 主进程、renderer 刷新失败与未知上游错误只持久化/呈现 allowlisted machine code，不把任意 `error.message`、端点或凭据样式文本回显到设置页。Android completed-ledger 敏感键过滤固定使用 `Locale.ROOT`，不再受土耳其语等系统区域大小写规则影响；未绑定 legacy pending 由当前设备一次性 CAS 认领，后续其他设备不能重新认领或上传。
- **事故与禁止复发规则固化**：`FL-SYNC-006` 保存历史真实 `network_error`、当前 `/healthz` 恢复、最近成功同步与耐久冲突同时存在的完整证据；根 `AGENTS.md` 和 `TEST_AND_RELEASE.md` 增加每轮迭代前必读当前 Bug、稳定故障编号与完整发布门禁的强制步骤，禁止另建平行 Bug 报告或用清 token/cache/SQLite 掩盖状态误判。
- **Android terminal 显式恢复**：terminal sidecar 继续持久保留原始 outbox 并停止普通重试；用户在电脑端处理冲突/拒绝后，可在 Android 原生控制区点击“重新检查已结束专注”。该动作先以当前 device + connection lease 复核，再提交绑定持久 expected device id 的独立 `REPLACE` work；marker 在执行前始终保留，普通 Worker 永远不可读取，账号切换或排程失败都不能把它降级为普通 pending。只有显式 Worker 可读取本设备 terminal 记录，applied/duplicate 后才删除 outbox 与 sidecar；孤立 marker 会被安全清理。
- **当前门禁**：Node `22.22.2` / npm `10.9.9` 下 format/typecheck/lint、110 个 Vitest 文件/778 项、6 个 cross-device 文件/47 项、Web/Cloud/桌面构建、Electron 隔离回归、Cloudflare 本地持久化协议门禁与 production viewport smoke 已通过；Android JVM 31/31、lint 0 error，隔离 terminal lifecycle instrumentation 已编译通过但尚未在真机执行。干净源码提交、正式 `dist`/APK、Windows/小米/华为/OPPO 的 `0.12.79/1279` 同版实装仍未完成。本节不得解释为已发布。

## v0.12.78 - 2026-08-08（移动横屏 UI 与 Cloudflare 行为调整后的重新编号候选）

- **0.12.77 候选作废**：`0.12.77/1277` 曾安装到小米，之后又修改移动横屏 UI 与 Cloudflare 同步行为。按三设备安装门禁的强制版本身份规则，已安装候选绝不复用，统一升为 `0.12.78/1278`。
- **低矮横屏首屏闭环**：`915×412` 手机横屏隐藏重复的专注标题栏，保留主读数与操作区双列布局；production viewport smoke 新增强制断言 `.focus-actions` 与主按钮完整落在视口内，不再只检查元素互不重叠。360/412/640/760、平板、亮暗主题、字体 profile 与两种 OPPO renderer 保持通过。
- **任务快照防冻结统一**：Cloudflare Account DO 与 loopback store 对齐 `publishedAt` 单调合同，但只接受不晚于服务端 `serverTime + 5 分钟` 的新值；超限统一返回 `422 task_snapshot_timestamp_too_far_ahead`，不把时钟错误伪装成 register 冲突。已持久化的远未来旧快照被视为 legacy 状态，下一份合法快照可恢复 register；正常路径仍保持相同 device/payload 幂等、旧时间戳 `stale_task_snapshot`、同时间异文 `task_snapshot_conflict`。桌面 durable pending 收到该 422 后至多一次读取可信 `serverTime` 并重戳原内容重试；只有 stale 可清除，conflict、读取/解析/重试失败均保留 pending。Android Focus Guard 同时拒绝 same-root rotation；Windows root store 的共享 mutex/CAS、不可逆 `revoked` 和 account/generation 密钥绑定完成复核。
- **Cloudflare 外部 gate 状态文件收紧**：外部 run/verify 只在显式 opt-in 的 `127.0.0.1` disposable Worker 上运行；状态文件限于项目 `.tmp` 或系统临时目录的受控直系文件，拒绝 junction/symlink/非普通文件，以 exclusive create、文件身份复核和无凭据序列化保护。external verify 只验证持久化，因无法证明所有权而不自动删除外部状态文件；local 隔离 gate 才自动清理自己的临时目录。
- **Cloudflare 正式工具链升级**：保留 Worker `compatibility_date: 2026-07-25`。Node `20.20.2` 可运行的 Wrangler `4.86.0` 只带支持到 `2026-05-03` 的 workerd，而支持当前日期的 Wrangler `4.114.0` 要求 Node 22；因此正式 engines 升为 Node `22.x` / npm `10.x`（门禁基线 Node `22.22.2` / npm `10.9.9`），并精确锁定 Wrangler `4.114.0` 与 `@cloudflare/workers-types` `5.20260724.1`，不以回退 compatibility date 换取通过。
- **代码与真实服务门禁**：Node `22.22.2` / npm `10.9.9` 下 format/typecheck/lint、107 个 Vitest 文件/741 项、Electron 隔离回归、44 项 cross-device、Web/Cloud/Android 构建、Android unit/lint 与 Focus Guard 5/5 全部通过。Cloudflare Sync v2 隔离 run/verify/persistence 连续通过，canonical bootstrap 返回脱敏 `deployed-login-required`；真实 dida 中文 comment/marker/完成恢复与 TomaToDo bridge/upload smoke 通过，番茄清理仍只声明 `local-record-only`。
- **门禁与发布状态**：v0.12.78 已实装 Windows、小米与华为，OPPO OWW221 未在线；随后发现 `conflict_present` 状态误报并继续修改，因此候选作废，由 v0.12.79 重新完成构建、安装回读和全部强制门禁。

## v0.12.77 - 2026-08-04（移动端 Apple UI 与跨凭据自动回写收口）

- **0.12.76 候选作废**：0.12.76 只安装到 Windows、小米和华为，强制 OPPO OWW221 门禁未执行；候选生成后又补了设置页 44px 触控目标、账号级 provider scope 与旧远端会话回填。按硬性规则不复用该版本，统一升为 `0.12.77/1277`。
- **账号级自动回写**：canonical `fl2` 的 provider 队列按 `endpoint + accountPublicId` 建立稳定匿名作用域，同一账号轮换 Windows device token 后仍消费同一 durable work；legacy loopback 继续按凭据隔离。既有 Sync v2 远端会话会幂等回填 dida/TomaToDo 意图对，已完成或已排队项不重复重开。
- **Cloudflare Sync v2 任务快照**：Account DO 与 loopback 合同统一把 `publishedAt` 作为单调 register；同一 device/payload 重放保持幂等，较旧时间戳返回 `stale_task_snapshot`，同时间不同内容返回 `task_snapshot_conflict`，不能以较晚到达的旧任务树覆盖当前快照。
- **番茄 ToDo 清理边界**：`cloudSyncUploadRecord` success 只代表“上传已确认”；客户端没有 PCRecord 远端删除 API，所有清理明确标注 `local-record-only`，不虚报远端回读或删除。
- **移动端验收补漏**：设置页主题选择器从 38px 提升到 44px；同时清除旧 `min-width: 620px` sidebar 规则遗留的 `top/grid-auto-rows`，避免 640×1024 底部导航被拉成整页 fixed 覆盖层。静态契约与 production smoke 现在同时断言导航贴底位置和高度；360/412/640/760/横屏、亮暗四页面、任务树展开与 OPPO 两种 renderer 全部无横向溢出、触控目标达标。
- **验证与交付**：该候选完成了首轮自动化与真实 dida 验收，但在四设备同版实装前即因后续 UI/Cloudflare 修改作废；后续扩展到 107 个 Vitest 文件/741 项、TomaToDo 真实 smoke 与 Cloudflare 门禁的结果统一记入 v0.12.78，不回填为 v0.12.77 已交付。v0.12.77 从未完成四设备门禁、最终资产或发布。

## v0.12.76 - 2026-08-03（移动端 Apple 平台化 UI、云端任务树与自动回写升级）

- **候选作废**：该版本漏装强制 OPPO 手表，且打包后继续修改跨端 UI/同步；未推送 `main`、未创建 tag 或 GitHub Release，由 0.12.77 替代。
- **移动端界面统一重做**：手机、平板与移动 Web 采用同一套 Apple HIG 启发的系统化层级、系统字体、grouped surface、发丝分隔与 44px 触控区；清理旧的卡片墙、扫光和不一致材质，亮暗主题与减少透明度/动效均保留完整可读层级。Windows 产品 UI、两态 mini、华为 capsule、小米系统表面与 OPPO 手表专用 renderer 保持原路径。
- **云端任务树取代旧选择行**：主界面的原生 `<select>` 与横向“浏览任务树”组合改为单一「从云端任务清单选择」disclosure；任务页使用电脑最后一次成功发布到云端的滴答快照，支持项目分组、父子折叠、搜索、完整路径、选择与「关联并开始专注」，手机和平板不接触滴答凭据。
- **远端会话自动回写**：Windows 导入手机/平板完成的 Sync v2 会话时，在同一 SQLite 事务内只登记滴答与番茄 To-Do 的独立持久意图；提交后由原子 claim/lease coordinator 复用既有 durable provider 队列，分别确认成功、失败保留并指数退避，重复导入与重启恢复不会重复投递。后台重试不会强制启动番茄 To-Do。
- **版本与交付**：Windows、小米和华为曾安装 `0.12.76/1276`，OPPO OWW221 未在线，四设备门禁失败；本候选不得标记完成或发布。

## v0.12.75 - 2026-08-02（设备授权登录修复：Android 浏览器打开与授权页重定向）

- **Android `<queries>` 修复浏览器打开**：0.12.72–0.12.74 的手机/平板点「登录」后提示「无法打开系统登录页面」，随后停在「请在已登录设备上确认登录」。根因是 Android 11+ package visibility——`AndroidManifest.xml` 未声明 `VIEW/BROWSABLE https` 的 `<queries>`，`resolveActivity()` 对默认浏览器返回空，`openExternalUrl` 返回 `opened=false`，授权页从未弹出。本版在 Manifest 增加 `<queries>` 声明；小米真机验证：点击登录弹出 MIUI「FocusLink 想要打开 Via」确认框，授权页正常打开。
- **授权页未登录重定向**：手机浏览器打开 `/owner/device-registrations?flow=...` 时此前直接返回 `401 {"error":"access_denied"}` JSON，无任何可操作界面。现在未登录带 `flow` 参数访问会自动重定向到验证码登录表单（`/owner/sign-in?bootstrap_flow=...`），登录后回到待批准设备列表；该逻辑在 `poyi-oauth-as` 部署。
- **登录文案纠正**：`login-required`/`waiting-for-phone` 分支改为明确提示「已打开授权网页，请在网页中完成登录与批准，会自动继续」，不再误导为「请在已登录设备上确认登录」。
- **设备授权登录端到端打通**：云端 `/account/v1/device/bootstrap` 已部署（`foxlink-cloud-mcp`），owner 在网页用一次性验证码批准后设备获得 `fl2` 凭据。小米真机完成全链路：登录 → 浏览器打开 → 验证码登录 → 批准 → 实时已连接 + 账本同步确认（处理 362 条变更、95 场会话、82 个缓存任务）。
- **版本与交付**：三端统一升为 `0.12.75/1275`；门禁与安装矩阵见 `backend-design/TEST_AND_RELEASE.md` 与发布记录。

## v0.12.74 - 2026-08-01（账号过渡与 native lease 最终封口、instrumentation 隔离）

- **0.12.73 候选作废**：0.12.73/1273 候选生成后又修改了跨端行为，按用户决定作废、绝不复用；本版在冻结范围内统一升为 `0.12.74/1274`，作废候选的 release-v01273 目录退役，保留 v01270/v01272/v01274 三个规范发布目录。
- **native lease 生命周期收口**：手机/手表 renderer 的 live command、任务快照与账本拉取统一走可中止 request lease（新请求即中止旧代），Android native 侧以 `connection-generation barrier` + 来源 `deviceId` 双重校验写入；每次 await 后重验连接，旧 success/catch/finally 不再污染新账号。
- **切号竞态冻结审查补漏**：冻结审查确认 Android configure/clear、Sync v2 owner/epoch CAS、旧响应丢弃与 renderer 来源校验全部成立；补上两处边界 —— 旧代 `drainPendingCommands` 进入 generation barrier（切号后旧调用按 `stale_connection` 拒绝），Sync v2 切号 reset 同时清除 legacy `cursor` 元数据（不再向旧账号 UI 短暂暴露旧游标），并为 `settleMobileV2Ack` 补错 lease/device/epoch 拒绝的确定性负向用例。
- **instrumentation 生产偏好隔离**：Android instrumentation 全程使用 PID 前缀隔离 SharedPreferences，绝不触碰 7 个生产偏好文件；前后 SHA-256 契约在真机证据链回填。
- **移动端批次**：MobileApp/WatchApp 账本、命令与快照在账号生命周期上统一挂载可中止 lease；accountLifecycle 串行化 Keystore 写入与补偿回滚（后继登录提交后旧 restore 直接拒绝，不可能覆盖）。
- **门禁与安装矩阵**：格式/类型/lint/全量测试/build/dist、Android JBR 三件套与 instrumentation 按 TEST_AND_RELEASE.md 执行；安装矩阵（Windows/小米/华为/OPPO）与外部阻塞在发布记录回填。

## v0.12.73 - 2026-07-30（账号同步加固、任务快照收敛与有效日账本）

- **登录还是只登账号**：Windows、手机、平板继续不显示服务地址、访问令牌、配对码或“编辑连接”；既有 `fl2` 凭据原位升级不掉线。新设备 bootstrap 收紧为 start/poll 两阶段，使用短期独立 `flb_*` poll credential、canonical owner 登录 URL、精确字段与全链脱敏；未完成管理员登录时直接下发 device token 会被拒绝。
- **canonical 权限边界闭环**：Electron preload/IPC 不再向普通 renderer 暴露 configure、quick setup 或 pairing 写面，`settings:set` 会剥离 `deviceSync`；生产 `fl2` 运行期与 Android 原生安全存储都固定 canonical origin，移动账号操作按 generation 取消旧请求并串行写 Keystore。退出登录、凭据或连接 epoch 变化会废弃旧 live、任务与账本响应；Sync v2 checkpoint 绑定账号，并在同一 IndexedDB 事务内复核 bootstrap owner，延迟的旧账号 exchange 不能写入新连接。
- **账号切换竞态最终封口**：Android configure/clear、runtime command/snapshot、authority projection 与 poll diagnostics 进入同一 connection-generation barrier，renderer 写入还必须匹配来源设备；手机/手表命令和账本拉取在每个异步边界后复核连接。Sync v2 enqueue/claim 与 bootstrap owner 在同一 IndexedDB 事务内 CAS，并同时过滤 device 与 account generation；新账号提交后才恢复的旧 enqueue 会被 `AbortError` 拒绝。
- **Focus Guard mixed-version 兼容**：Electron 与移动 renderer 共用完整 Sync v2 entity type 判定；四类 `focus_guard_*` A256GCM envelope 可由无 root 客户端精确验证并原样持久化，明文、额外字段、错误 kind、未知 type 或非法 cursor/revision 会在 checkpoint 前失败。Account DO 继续只见密文，本版不新增生产 publisher、root provisioning 或解密桥。
- **公网边界不冒充**：新增 `probe:account-bootstrap` 只输出结构化部署状态。当前 canonical 实测 `/account/v1/device/bootstrap` 为 404，明确记为 `not-deployed`；本仓已完成客户端、私有 registration、合同、诊断与部署清单，真实上线仍需 foxlink gateway 的 owner session/CSRF、flow store、独立 `fia_*` secret 和单次消费负测。
- **任务快照自动追新**：手机/平板可见态每 15 秒使用 `no-store` 拉取任务快照，并在恢复前台/连接变化时立即刷新；revision 只允许前进，延迟旧响应不覆盖新缓存，同 revision 异文直接拒绝。PC 只有收到 authority 对同一 device/payload 的回读确认后才清除耐久 pending snapshot。
- **共享有效日账本**：新增 07:00–22:00 有效日纯函数，真实 Segment/PauseEvent 切出 focus/pause/gap 且严格守恒；Dashboard 提供甜甜圈、24h 轴和精确空档，历史缺边界数据只显示 estimated，不写第二份 gap 事实。
- **移动 Liquid Glass 与任务树**：手机、平板只在导航、切换器、浮动操作与弹层使用有边界玻璃控制层，正文保持清楚连续；统计直接消费共享 `dayLedgers`，任务页按匿名 `parentId` 重建父子树。360/412/640/760 与横屏、亮暗主题、四入口和 a11y viewport 门禁已通过，手表 renderer、华为 capsule、小米系统表面与 Windows 两态 mini 保持原路径。
- **PC-off 收敛门禁**：自动化精确锁定“小米开始 → 华为暂停 → 小米继续 → 华为结束”的 revision `1→2→3→4` 合同，最终只生成 `2 segments + 1 pause`；相同 finish command 重放必须为 duplicate，第二次 cursor 拉取必须为空。0.12.73 真机证据仍只在四端实装后回填。
- **交付边界**：版本统一为 `0.12.73/1273`。完整门禁、四设备覆盖安装、最终哈希与源码提交在候选生成后回填；不创建公开 GitHub Release 或 tag。

## v0.12.72 - 2026-07-30（单账号云同步与四端候选收口）

- **登录即同步**：Windows、手机、平板只显示 FocusLink 账号、同步状态、最近同步、立即同步与退出登录；普通界面彻底移除服务地址、访问令牌、一次性配对码、“编辑连接”和高级连接开关。既有合法 `fl2` 凭据原位识别为已登录，不要求当前三端重新配对。
- **唯一 owner 自动登记**：私有 Account DO 新增身份网关专用设备登记接口，只接受 `poyi-owner` 与独立 `fia_*` authority；按本机稳定 `installationId` 为 Windows、手机、平板、手表签发各自独立 `fl2`，客户端不能申请管理 scope，日志不记录令牌。OPPO 手表只提供“从手机登录/等待确认”，不复制手机凭据。
- **部署边界**：本仓完成客户端、私有 authority 与合同测试；公网 `/account/v1/device/bootstrap` 仍必须由 `foxlink-cloud-mcp` 校验 owner 登录后转发，并配置独立 identity authority secret。本轮未获该外部仓远端部署授权，因此不得把新设备公网登录写成已上线；旧凭据同步保持可用。
- **本地交付验收**：format/typecheck/lint、93 个 Vitest 文件/605 项、Electron 隔离回归、Web/Cloud/跨端合同、Cloudflare dry-run、Android unit/lint/assemble 与 emulator instrumentation 全部通过；干净源码提交 `cf779db` 的主窗、两态 mini、live fallback smoke 通过。Windows、小米、华为和 OPPO 手表均实装并回读 `0.12.72/1272`；手机/平板旧凭据升级后仍显示实时与账本已连接，手表未登录首屏只显示“从手机登录”。

- **正式替代 0.12.71 候选**：0.12.71 的首次 UI smoke 发现游标标尺预览比固定舞台宽 9.74px，未进入任何设备安装；本版将预览收至 176px，并让 smoke 记录每张卡的 frame/dial 边界且真实点击“结束”，不再因 contextBridge Promise 把已成功的 STOP 卡成假超时。
- **Windows 403 根修复**：实时命令、任务快照与 Sync v2 统一使用 `fl2` 凭据绑定的设备 ID；空闲云端遇到 401/403 或传输不可达时本地计时仍可开始，活动云端会话继续保持权威锁定。失败原因完整写入日志，不再退化为 `[object Object]`。
- **视觉回归封死**：九种计时仪表预览全部必须落入固定 70px 舞台；指针表圈、游标标尺和制图描线不再裁切。桌面时间之带在 running/paused/finished 全状态只使用平直磨砂玻璃专注材料，旧毛虫状锯齿/浮尘路径已删除。
- **移动端继承**：完整继承 0.12.71 的手机/平板工业时间仪器重构，并以 `0.12.72/1272` 作为唯一允许进入 Windows、小米、华为和 OPPO 手表安装门禁的候选。

## v0.12.71 - 2026-07-30（手机与平板工业时间仪器重构）

- **移动端视觉重构**：手机和平板改用深墨设备框架、暖白连续工作面和翡翠校准线；顶部品牌、四入口导航、同步状态带、主计时舞台、任务输入、时间之带、统计结论与设置规格表重新建立统一层级，不改变真实计时、任务、账本或云同步语义。
- **手机首屏重排**：393px 级手机固定先显示主计时读数，再显示任务/标题和 112px 紧凑时间之带；主操作条粘在 68px 底部导航之上，连接、开始、暂停、继续与结束始终位于拇指区。同步状态压成双列，去除重复页面头与径向 glow。
- **平板独立版式**：620px 起使用 80px 深墨左侧导航；华为 DBY-W09 的 640 CSS-pixel 竖屏保持全宽计时主区，把多端上下文放到下方；760px 起才展开实时状态侧栏，避免任务选择器和主读数被挤成细条。
- **主题与回归**：亮/暗主题分别映射设备框架、统计结论舞台、操作条与状态文字；响应式合同覆盖 620px 单列和 760px 双栏。华为 capsule、小米系统表面、OPPO 手表 renderer 与 Windows 两态 mini 未改，需在本轮四端实装后补齐最终矩阵。
- **Windows 开始专注 403 修复**：桌面实时命令与任务快照统一使用 `fl2` 凭据绑定的 `deviceId`，不再把旧本机 UUID 发给 canonical authority 触发 device-binding 403；即使空闲云端返回 401/403 或网络失败，也会明确记录原因并降级启动本地计时，不再让“开始专注”失效。活动云端会话仍保持权威锁定，不做分叉降级。
- **仪表完整显示与毛虫回归封死**：设置页为滚筒、指针表圈、游标标尺和制图描线提供独立固定预览几何，九种仪表都必须完整落在 70px 舞台内；时间之带的专注材料在 running、paused、finished 三态统一使用平直磨砂玻璃，删除旧锯齿/浮尘绘制路径，暂停红色损耗层保持独立。
- **诊断可追溯**：实时开始失败写入 `liveFocus` 日志并区分凭据拒绝与传输不可达；任务快照 HTTP 错误改为带 status/code/message 的 Error，不再每分钟只留下无信息的 `[object Object]`。

## v0.12.70 - 2026-07-30（云端三端同步与 MCP 修复）

- **稳定 correction 与精确修复**：桌面 correction 的 `createdAt`、`correctionId` 和 `opId` 改为稳定值；已确认 correction 不再重复入队。启动同步时只清理旧缺陷生成的 `baseRevision=0` revision-conflict 行，保留操作审计、账本和真实冲突。
- **Account DO 唯一 authority**：Account DO 将除 `createdAt` 外完全一致的历史 correction 识别为 duplicate，并只关闭无 base、纯 revision、内容匹配的历史合成冲突；metadata、删除、账本字段差异和跨设备 fork 继续保留冲突。
- **电脑不再是中继**：移除 Electron 运行期 ADB reverse、Android 自动配对和内嵌回环同步服务；旧 loopback 配置不会迁移凭据，必须重新走云端配对。手机和平板继续直接读写 canonical HTTPS authority，离线完成账本保持本机 pending，联网后补传。
- **ChatGPT 云端 MCP**：新增私有 Account DO 记录接口，直接提供已校正 session、任务、segments、pauses、暂停时长、结束时间与当前 live；状态、今日汇总和记录列表不再读取 D1 投影，且不输出 deviceId、note、tags 或凭据。修复 FocusLink resource-server 凭据不一致导致的 `oauth_introspection_unavailable`，OAuth 仍仅授权 `focuslink:read`，没有写工具；轮换用临时 capability 已在验证后销毁。
- **单一云端版本**：版本提升为 `0.12.70/1270`，移除 Android 独立 staging 应用身份和硬编码 staging 数据面；本版本不设置 staging 验收阶段，所有验证直接针对生产云端。Account DO 冷启动使用常量行 schema 标记，不再因重复扫描全部索引触发免费层行数限制；live 结束同时写 v1 兼容账本和 v2 ledger/metadata，并有界补迁移历史 v1-only 记录。
- **生产验收**：Windows FocusLink 关闭时，小米发起、华为暂停、小米继续、华为结束，以及华为发起、小米观察并结束均通过；云端最终 `live=idle`、revision `62`，两端各看到同一两条账本。Windows 重启并连续同步后两条记录各导入一次，既有 correction outbox/open conflict 基线不增长。ChatGPT 在本地 FocusLink/Foxlink 服务及 8770/8878 监听全部关闭时，仍通过 OAuth 从 Account DO 读到当天 2 条完整 records、segments、pauses 与 live。Windows、小米、华为和 OPPO 手表均实际安装并回读 `0.12.70/1270`；整机物理断电验收未执行，不把“桌面进程关闭”写成“电脑已关机”。

## v0.12.69 - 2026-07-29（移动端云闭环与中央 observation 对齐）

- **唯一 authority 与 canonical V2**：Account Durable Object 继续作为唯一账户 authority；同步收口原子 outbox/cursor/ACK、稳定 opId、conflict、tombstone/graveyard，以及 generation/changeSeq/epoch 单调与恢复，不创建第二套账户、token、deviceId、cursor 或云状态。
- **Android fail-closed 恢复**：凭据使用 Keystore；WorkManager 覆盖 boot、package replacement、网络与 Doze 后恢复；401/403、撤销和 revision rollback 固定停止自动重试并保留待修复队列。ContentProvider V1 仅输出 currentFocus、history、任务名、次数/时长聚合、identityStatus 和 syncHealth，不输出 credential、deviceId、cursor 或 envelope。
- **中央 observation canonical registry**：named service binding 使用独立 Capability 与 vendor media type；FocusLink 在中央签名层固定为 `productId=identity-focus`，staging audience 固定为完整 HTTPS `/authority/identity-focus`。同 revision 的持久 snapshot、truth、时间字段和 observation hash 保持不可变；公网、缺配置、错误 capability/audience、过期、额外字段、依赖失败与 rollback 全部 fail-closed。
- **空闲 checkpoint 续期**：修复 observation 只在业务 mutation 时生成、TTL 到期后永久 503 的问题。named GET 在同一 Account DO SQLite 事务内先探测 schema/meta/live 依赖；有效 snapshot 原字节复用，缺失、损坏或到期才推进真实 verification checkpoint revision 并持久化新 snapshot。DO schema v2 移除 `state_hash` 唯一约束，使相同业务状态可在新的 checkpoint revision 下续期而不改写旧 revision；Capability 校验与中央统一为 32–512 字符安全 token，不再额外要求产品私有前缀。
- **交付状态**：版本提升为 `0.12.69/1269`，用于本轮唯一跨端候选。staging、中央两跳、真实设备、三轮 PC-off 与 production 灰度必须在本提交后的独立验收中留下脱敏证据；未全部通过前 `supportsPcOff=false`。

## v0.12.68 - 2026-07-28（私有 Account DO authority 与分页 liveness）

- **唯一 production authority**：Cloudflare Account Durable Object 成为唯一生产数据权威；私有 FocusLink Worker 固定关闭 `workers.dev`、preview 和 custom route，只接受 canonical service-binding 路径。Node `startPersonalCloud()`、production CLI、Docker/Compose 静态 bearer authority 全部硬退役，回环 Node 仅保留合同测试。
- **canonical 路由与配对**：live、tasks、exchange、status 和 pairing 统一为 `/sync/v2/*`、`/sync/v1/pair/*`；`/v1/*`、`/v2/*`、`/sync/push` 不回退。pair offer 先由 foxlink-cloud-mcp 校验 owner session + CSRF，再携带 fl2 credential 交给 DO 复验 `devices:manage`；pair exchange 只消费一次性高熵 nonce。
- **身份与 liveness**：device token 强制绑定 request/mutation `deviceId`；格式有效的伪造、过期、撤销、跨账号、错误 secret/scope 均拒绝。V2 change feed 按 foxlink adapter 的 `1,100,000` serialized-byte cap 二分选页，cursor 与 watermark 只推进到实际返回尾；1 MiB 单实体上限、acks、第二页无丢重和 500 项复杂度有直接测试。
- **真实 readiness 与请求边界**：`/readyz` 同时探测 Account DO SQLite，三个必需 service secrets 至少 32 字节且两两不同。Account DO 在读取完整正文前执行 content-length 预拒和 bounded stream；task publish 与 live command 拒绝未知 query。
- **MCP 与多端体验**：内部只读投影返回次数、任务、有效/暂停/总时长、最近记录及 freshness，不输出 note、tags、deviceId 或 credential。手机隐藏平板专属模块，平板显示完整设备身份与状态字段，手表八位计时和双按钮在小屏内收敛；Android 凭据按 Keystore-first 无损恢复。
- **未完成边界**：Focus Guard 加密 state producer 只有与不做手机控 Java consumer 一致的 golden fixture；因 FocusLink 尚无同账号 32-byte root provisioning，未伪造第二把根密钥、未接生产 publisher。本版未部署、未读取远端 secret、未执行最终 v0.12.68 ADB 覆盖安装或 PC-off 三轮验收，`supportsPcOff=false`。

## v0.12.67 - 2026-07-28（Android 配对凭据无损迁移）

- **覆盖升级不再丢配对**：修复 Android 启动时先删除旧 WebView token、手表又不读取或写入 Keystore，导致覆盖安装后显示“未配对”的回归。手机与手表统一为“先恢复已有 Keystore；否则把旧凭据写入 Keystore并确认成功；最后清理浏览器副本”。
- **失败保持可恢复**：Keystore 写入失败时不再删除唯一旧凭据；新配对和手工保存连接也必须先完成原生安全持久化，才提交 renderer 偏好。
- **比例回归门禁**：新增手机/平板/手表 CSS 契约，锁定手机错误完整换行、平板状态字段不省略、手表八位计时和双操作按钮不越界。
- **状态**：本版仍是本地候选；未部署远端服务，正式 PC-off 验收与完整四端同版安装矩阵未完成，`supportsPcOff=false`。

## v0.12.66 - 2026-07-28（云端专注投影与手机/手表比例修复）

- **PC-off 数据面**：Account DO 新增仅供 canonical cloud MCP service binding 调用的专注投影，返回专注次数、任务分配、起止时间、有效/暂停/总时长、最近记录和独立的 authority freshness；默认不返回 note、tags 或凭据。
- **唯一 authority 与实时兼容**：设备身份强制绑定请求和 mutation `deviceId`；Node personal-cloud 默认拒绝权威 v2 写。实时控制与任务快照迁移到 `/sync/v2/live*`、`/sync/v2/tasks`，公网 `/v1/*` 继续 410，Account DO 对读写分别校验设备 token scope。
- **真实设备比例**：OWW221 的八位计时按整串宽度收敛，单列 grid 不再被大读数撑宽，暂停/结束按钮强制落在 378×496 屏内；小米手机不再渲染平板专属显示模块，同步失败原因允许完整换行；华为平板状态事实改为单列完整展示。
- **状态**：本版是本地候选，`supportsPcOff=false`；未部署远端服务，正式 PC-off 三轮验收与发布证据仍待后续统一执行。

## v0.12.65 - 2026-07-27（专注时间之带磨砂材质）

- **专注态重绘**：移除运行中绿色材料每 3px 生成的锯齿轮廓、齿端浮尘和内部颗粒，避免长时间展开后形成毛虫般的分节与毛边。
- **全高磨砂玻璃**：专注材料改为半透明绿色玻璃层，以柔和内雾、宽幅漫反射和薄边缘高光表达质感；材料贴合轨道上下内沿，不再留下悬空缝隙，墙钟刻度仍可透过。
- **暂停保持**：paused 继续使用原有绿色历史材料、红色缺口、底部疤痕和向上消散粒子；暂停绘制与动效分支未修改。
- **验证与实装**：format/typecheck/lint、73 文件 497 项测试、Electron 隔离回归、Android 单测/lint、build/dist、安装版/便携版 UI、两态 mini 与时间之带四状态视觉审计通过。Windows 注册表、EXE 和健康接口回读 `0.12.65`；小米 22041216C 与华为 DBY-W09 均回读 `0.12.65/1265`。本版未修改移动/手表产品代码，OPPO 手表不适用第四设备门禁。

## v0.12.64 - 2026-07-26（4单：九仪表 · 手表防烧屏 · 织带材质 · 四端实装）

- **计时仪表 5 → 9**：新增滚筒计数器（里程表滚筒，9→0 经复制位正向回绕不倒转）、指针表圈（60 刻度 SVG 表圈 + 秒针按累计秒 6°/格擒纵步进、换分不回摆 + 中央数字读数）、游标标尺（固定 2px 游标线 + 滑动秒刻度带线性擒纵）、制图描线（描边空心数字 + 24px 制图网格、角规线与带端刺的尺寸标注）。设置页仪表预览成 3×3 网格，冒烟逐一断言九种样式的真实机械结构并截图。
- **手表端专项（OWW221）**：防烧屏——手表一律深色、纯黑 AMOLED 画布（`html.watch-runtime` 令牌提权覆盖）、待机读数压暗、整壳 4 分钟周期 1px 位移；比例——主视图改「状态/读数(1fr)/任务/操作」四行铺满整屏，读数同时受 vw/vh 约束，任务页独立两行模板；性能——界面字体改系统字族（省去数 MB 中文 Web 字体的加载与常驻内存），任务选择页打开时暂停秒针刷新、返回即时校准，活动态新增专注/暂停副行。真机截屏验证纯黑壳层与新布局。
- **时间之带材质**：专注实体从实心条升级为「羽化材料」——以 0.5s 世界时间格为键的确定性破碎轮廓、齿端浮尘与内部亮斑/暗粒；相机静止时逐像素冻结，运行态随镜头滑动低幅换代，符合规范「不能读成实心塑料条」。
- **规则固化（用户死命令）**：AGENTS.md 三端安装门禁升级为每轮必须真实安装（Windows 静默覆盖 + 注册表/EXE 回读，小米/华为 `adb install -r` + versionName 回读，动移动代码时手表为第四目标）；废除五版本检查点上传节奏，每次改动每个版本即推 GitHub main。
- **四端实装矩阵（全部真实回读）**：Windows 本机 `0.12.64`（注册表 + EXE + 重启运行）；小米 22041216C `0.12.64/1264`；华为 DBY-W09 `0.12.64/1264`（经 mDNS 重新发现 192.168.1.61 并连接）；OPPO 手表 OWW221 `0.12.64/1264`。0.12.63 也已在本轮先行完成 Windows 本机安装。
- **验证**：73 文件 497 项测试、format/typecheck/lint/build/dist、打包版全量 UI/mini 冒烟通过；`release-v01264` 四件套与 APK 备份（artifacts）就绪。R2 与厂商推送凭据维持外部阻塞。

## v0.12.63 - 2026-07-26（3单：功能视图呈现大改 · 仪器工位语法）

- **统一呈现语法**：四个功能视图以同一条「工位横幅」开场（视图身份 → 实时读数/主仪器控制 → 视图级操作），主体组织为「主舞台 + 文脉栏」；旧的各视图大标题页头全部退役。
- **专注页重构**：三项累计移入左侧仪表列（纵排量块 + 占总历时的真实占比刻度 + 本场起点诊断行）；任务、主仪表、控制沿中轴构成纪念碑；时间之带横贯整个工位底部，账本、仪表列与纪念碑都立在同一条时间材料上。
- **任务页重构**：升级为「索引｜执行列表｜详情栏」三栏执行台。点选/聚焦行即在右侧 332px 详情栏展开任务档案（来源、清单、父任务、优先级、截止、标签、子任务预览）与主操作；选择与开始保持两个独立动作，无选中时回落到正在专注的任务。
- **统计页重构**：拆为「分析画布｜账本阅读列」双区，各自独立滚动、账本轨头部粘顶，与移动端宽屏账本列契约一致；会话行改为带起止墙钟锚点的账本条目，徽标折行呈现。范围预设与单日导航移入工位横幅。
- **设置页重构**：全局搜索晋升为横幅中央主仪器，版本/外观诊断入横幅右端；分区改为 01/02/… 编号规格表，宽屏标题栏在左、设置行在右。
- **冒烟欠账清偿**：ui-state-smoke 补上 0.12.62 遗留的六分组导航路径与 `frontier-ash` 消散契约；结束冻结断言改在唯一稳定窗口（暂停尾灰 1.9s 演完后、3s 结算保留期内）用页内画布哈希采样，并显式验收 finished→idle 自动复位；states.json 在断言前落盘，失败运行可诊断。
- **默认窗口即见新布局**：统计双区与任务详情栏的收起断点降到 1200px 以下，1240×800 默认主窗直接呈现完整工作台。
- **验证**：format/typecheck/lint、73 文件 497 项测试、build、dist 与打包版全量 UI/mini 冒烟通过，四视图截图目检完成。本版为本地中间版本，Windows/小米/华为三端同版矩阵待真机安装后记录。

## v0.12.62 - 2026-07-26（手表接入、手机优先布局与跨层样式契约）

- **手表层（OPPO OWW221）**：新增 189×248dp 专用 WatchApp 外壳，可选任务、开始、暂停/继续、结束，并复用 `focuslink://pair` 深链配对；按视口在 `main.tsx` 门禁挂载。
- **Chrome 83 WebView 一等同步客户端**：修复配对链接在 Chromium <85 非特殊 scheme 解析下的主机名判定、deviceSyncServer 全局 CORP 阻断跨源预检、`crypto.randomUUID` 缺失与 flex gap 不支持；Vite target 降至 chrome83，CSP 允许 `font-src data:`。
- **手机优先布局（≤620px）**：读数优先、操作钮固定在导航之上、紧凑头部堆叠；导航背景不透明，构建身份移入设置页。
- **桌面同步改进**：TemporalRibbon 概览改为整场会话取景并保留可读暂停缺口；滴答独立子任务按 `parentId` 重新嵌套；设置页改为 6 个意图分组 + 全局搜索的注册表式 IA；补齐 6 个未定义 CSS 变量与 23 个未样式化设置类，`styleContract` 测试锁定。
- **字体瘦身**：本地 TTF 转 woff2，包体 44MB → 23MB，视口测试断言 7 个字族全部加载。
- **簿记说明**：本条目为 3单会话补记。上一会话在版本源齐平前中断：`package.json`/`versionCode` 已到 0.12.62/1262，但 `shared/version.ts` 与 `electron-builder.yml` 仍为 0.12.61，0.12.62 安装包曾误输出到 `release-v01261/`（已移至 `release-v01262/`）；三端版本矩阵未记录。版本源在 v0.12.63 统一齐平。

## v0.12.61 - 2026-07-26（Foxlink 独立 MCP 打包收口）

- **独立服务**：Foxlink MCP 以 `PoyiFoxlinkMcp` 原生 Windows 服务监听 `127.0.0.1:8770/mcp`，专属 Secure MCP Tunnel 独立运行，不依赖 PersonalMcpGateway。
- **桌面业务 API 入包**：修复 v0.12.60 安装包早于 MCP 业务 API 合入的问题；`127.0.0.1:18770` 现在随正式 Windows 应用启动，MCP 不再依赖开发态进程。
- **ChatGPT 私有验收**：Developer Mode 私有 Foxlink 应用已连接；真实只读、恢复、暂停及相同 `requestId/commandId` 结果重放通过。
- **Tunnel 重启修复**：修复 WinSW 日志文件 ACL 漂移导致的 1067 与孤儿 tunnel-client；提升权限的定向修复会验证专用端口和进程类型、重置日志 ACL，并要求 SCM 持续 `Running` 后才报告成功。
- **版本门禁**：Windows、小米和华为统一升级为 `0.12.61 / 1261`；本版仅本地交付，不推送 `main`、不创建 tag 或 GitHub Release。

## v0.12.60 - 2026-07-26（Sync v2 连续实施）

- **事务同步基础**：桌面 SQLite 与移动 IndexedDB 增加租约 Outbox、entity state、base snapshot、冲突和 30 天操作历史；`applied/duplicate` 原子确认并删除 Outbox。
- **实体与合并**：已结束会话拆为不可变 `focus_ledger_v2`、可编辑 `focus_metadata_v2` 和追加式 correction；metadata 按 base 三方合并，备注、时间结构和 tagId 删除/重加进入显式冲突。
- **Bootstrap 与代次**：固定 inventory/manifest/base/v2-active 状态机，并使用 `syncEpoch/cursorEpoch/accountGeneration` 使 stale 设备、日志压缩和恢复后旧 cursor 明确失效。
- **可信设备**：Cloudflare 账号 Durable Object 支持独立 `fl2_` 设备令牌、HMAC pepper、scope、配对 nonce 防重放、改名、撤销和轮换。
- **删除与处理中心**：实现 tombstone、水位、stale 设备、graveyard、冲突与回收站 API；解决、恢复和用户层永久删除继续走标准 mutation/revision/opId。
- **推送与灾备**：Cloudflare Queue 已部署；无厂商凭据时状态固定为 `credential-missing` 且 HTTPS 轮询兜底。R2 AES-256-GCM、maintenance generation 恢复和前后快照代码完成；当前 Cloudflare 账户未启用 R2（API 10042），真实 R2 写入门禁登记为外部阻塞。
- **双后端与客户端**：Cloudflare SQLite Durable Object 与 Node/Docker 均实现 v2 bootstrap/sync 核心契约；Windows 与 Android 在 v1 可用期间增量启用 v2，不因 v2 暂不可达破坏 v1。
- **验证**：486 项自动化通过；公网 v2 的 bootstrap、applied/duplicate、revision conflict、cursor、设备配对、nonce 防重放、scope 和 Queue 诊断通过；Docker Linux 构建与集成通过。
- **迁移复测**：Windows 真实历史首次迁移发现 1 MiB 批次与缺失 base 问题；改为有界批次并按远端相同 fingerprint 建 base 后，158 个实体全部确认、Outbox 清零，原有 79 场会话和 19 项设置保留。

## 未发布

## v0.12.53 - 2026-07-26（Windows 原位覆盖安装）

- **原位覆盖恢复**：旧卸载器重试耗尽后，不删除旧安装目录，也不要求旧 EXE 已消失；在当前用户进程已被有界关闭的前提下，直接让新安装器覆盖注册表来源的同一安装路径。
- **完整复测**：从完整 v0.12.47 安装覆盖到 v0.12.53，并执行 v0.12.53 同版本重装；验证退出码、版本、数据哈希和公网同步。
- **版本与交付**：三端统一为 `0.12.53 / 1253`，按本轮要求仅本地交付。

## v0.12.52 - 2026-07-26（Windows 覆盖安装事实判定）

- **退出码无关恢复**：旧卸载器重试耗尽后不再依赖不稳定的退出码；仅依据注册表来源旧安装目录中的产品 EXE 是否已消失决定是否继续，新 EXE 仍存在时保持失败。
- **真实复测**：旧卸载器不移除旧 EXE，事实判据仍无法触发，本制品由 v0.12.53 的原位覆盖取代。
- **版本与交付**：三端统一为 `0.12.52 / 1252`，继承 Cloudflare、公网离线专注、overlay 性能和小米兼容性结论。按本轮要求只做本地交付。

## v0.12.51 - 2026-07-26（Windows 覆盖安装无删除恢复）

- **锁定目录修复**：旧卸载器仍可能占用安装根目录，恢复宏不再递归删除该目录；确认产品 EXE 已不存在后直接让新安装器写回同一路径，避免静默安装卡死。
- **真实复测**：旧卸载器重试后的实际返回码并非稳定为 2，恢复条件未触发，本制品由 v0.12.52 取代。
- **版本与交付**：三端统一为 `0.12.51 / 1251`，继承 Cloudflare、公网离线专注、overlay 性能和小米兼容性结论。按本轮要求只做本地交付，不推送 `main`、不创建 tag 或 GitHub Release。

## v0.12.50 - 2026-07-26（Windows 覆盖安装闭环）

- **注册目录恢复**：Electron Builder 从注册表读取旧 `$installationDir` 后，若旧卸载器连续返回 2，仅在该目录内产品 EXE 已不存在时清理残留目录并继续安装；不再依赖升级后已被删除的注册值或路径字符串形式。
- **真实复测**：从完整 v0.12.47 覆盖时安装器在锁定目录递归删除处超时，本制品由 v0.12.51 取代。
- **版本与交付**：三端统一为 `0.12.50 / 1250`，继承 v0.12.47 的 Cloudflare、公网离线专注、overlay 性能和小米兼容性结论。按本轮用户要求只完成本地验收，不推送 `main`、不创建 tag 或 GitHub Release。

## v0.12.49 - 2026-07-26（Windows 覆盖安装最终恢复）

- **最终结果分支修复**：在 `customUnInstallCheck` 中处理已知退出码 2；仅当注册卸载器父目录匹配旧安装目录且产品 EXE 已不存在时继续升级，任何路径不匹配、payload 残留、启动失败或其他退出码仍立即失败。
- **版本门禁**：首轮 v0.12.48 修复未命中 Electron Builder 最终结果处理分支，本候选递增为 `0.12.49 / 1249`；真实覆盖仍失败，因为旧卸载器已删除最终处理器依赖的注册值，本制品由 v0.12.50 取代。
- **完整继承 v0.12.47**：Cloudflare SQLite Durable Object、公网三端离线专注收敛、悬浮条性能结果和小米 OEM Focus `onAuthFailed` 兼容性结论保持不变。

## v0.12.48 - 2026-07-26（Windows 覆盖安装收口）

- **NSIS 升级恢复修复**：旧卸载器连续返回退出码 2 时，不再要求注册安装目录与新 `$INSTDIR` 的字符串形式完全一致；仍以“注册卸载器父目录等于待删除目录”作为删除边界，允许已移除旧 payload 的升级继续安装。
- **版本门禁**：因安装器行为改变，Windows、Web/PWA、Android 统一递增为 `0.12.48 / 1248`；真实升级复测仍返回退出码 2，证明恢复逻辑未命中最终结果处理分支，本制品由 v0.12.49 取代。
- **完整继承 v0.12.47**：Cloudflare SQLite Durable Object、公网三端离线专注收敛、悬浮条性能结果和小米 OEM Focus `onAuthFailed` 兼容性结论保持不变。

## v0.12.47 - 2026-07-26（公网本地优先收敛版）

- **Cloudflare 公网后端**：新增 Worker 与账号级 SQLite Durable Object，兼容 `/health`、`/v1/sync`、`/v1/tasks`、`/v1/live`、`/v1/live/wait`、`/v1/live/command`。实体 revision、opId、change log、任务快照、实时会话与 commandId 均持久化；现有 Node/Docker 服务保持兼容。
- **公网三端收敛**：自定义域名 `https://focuslink-sync.pyzzgk.dpdns.org` 已部署并通过鉴权、幂等、旧 revision 冲突、cursor 增量、实时生命周期及 Worker 重部署后数据保留。电脑进程停止时，小米与华为分别完成开始、暂停、继续、结束，Windows 恢复后各导入一次完整的 2 段/1 暂停账本。
- **Windows 覆盖安装**：从 `0.12.46` 覆盖到 `0.12.47` 后数据库、设置和设备身份文件保持；安装态重新保存安全凭据后公网同步上传 63、拉取 76、导入 13，冲突/拒绝为 0，新界面主视图和设置视图完成截图回归。
- **悬浮条性能门禁**：小米 janky frames 从 14.04% 降至 3.54%，华为从 15.52% 降至 3.43%；两机均无超过 100 ms 帧，拖动后位置连续，满足不高于 5% 且不劣于基线的门禁。
- **小米超级岛兼容性结论**：`22041216C / HyperOS OS3.0.1.0.VLHCNXM / SystemUI 20240808.0` 能解析协议 3 并记录 `onInflateSuccess/onInflateFinish`，随后以 `onAuthFailed ... app.focuslink.mobile` 拒绝 OEM Focus 授权；桌面和锁屏均无真实岛显示，因此明确标记为该 ROM/签名不兼容，不标记 `visually-verified`，标准通知与悬浮条仍正常。
- **回归与本地交付**：format、typecheck、lint、68 个 Vitest 文件/475 项测试、Android unit/lint/assemble、Docker 隔离个人云和 Cloudflare 公网协议均通过。版本统一为 `0.12.47 / 1247`；随后发现 NSIS 同版本覆盖安装退出码 2，本制品由 v0.12.48 取代。

## v0.12.46 - 2026-07-25（移动端本地优先基础版）

- **双事实域隔离**：手机和平板在电脑、endpoint 或云端状态不可达时可直接创建独立本机 UUID；恢复连接发现不同云端活动会话时进入 `forked-local`，两边互不发送控制命令、互不覆盖并分别结束入账。Android 原生快照增加 `localAuthority` 门禁，后台云轮询不能覆盖本机通知和悬浮条。
- **持久补传队列**：IndexedDB 升级到 v3，新增 `sessionSyncMeta`；本机开始和结束分别使用事务保存运行态/元数据及 completed bundle。pending 记录支持 `pending/uploading/retry/conflict/rejected`、尝试次数、退避时间和错误码；崩溃遗留 uploading 恢复为 retry，只有 `applied/duplicate` 同时删除 pending 与元数据。
- **Android 悬浮条**：点按显示关闭按钮，3 秒无操作收起；关闭后持久禁用且不终止专注或常驻通知，只能回应用重新开启。拖动位置更新按动画帧合并，拖动期间缓存安全区、尺寸和背景 drawable。
- **系统表面隔离**：标准通知、小米超级岛和华为胶囊拆为独立适配器。小米使用稳定业务 ID 与协议 3 生命周期载荷，能力证据严格区分 `unsupported/protocol-selected/systemui-accepted/visually-verified`，应用不会自动宣称人工视觉验收。
- **版本与交付边界**：Windows、Web/PWA 与 Android 版本源统一为 `0.12.46`，Android `versionCode=1246`。本版为本地中间版本，不推送 `main`、不创建 tag 或 GitHub Release；真机视觉、拖动性能与三端同版矩阵以最终验收记录为准。

## v0.12.45 - 2026-07-25（便携版 CI 启动门禁与集中发布节奏）

- **便携版启动门禁**：GitHub Windows runner 上 212 MB 便携包自解压超过原 15 秒窗口；主窗 smoke 改为最长 60 秒的有界 CDP 等待，并在 Electron 提前退出时立即报告退出码。
- **五版本集中上传**：从本版起仅补丁尾号为 `0` 或 `5` 的版本上传 GitHub；中间版本仍完成本地日志、三端同版验收、四文件发布目录和 Android APK 备份。`0.12.45` 是首个上传节点，下一节点为 `0.12.50`。
- **正式替代 0.12.44**：Windows、华为平板和小米手机统一升级到 `0.12.45`，Android 使用 `versionCode=1245`。公开 `v0.12.44` 标签保留不动，未创建对应 GitHub Release。

## v0.12.44 - 2026-07-25（CI 握手测试同步修订）

- **稳定发布门禁**：桌面实时 idle 回退测试改为等待已确认的 live 状态，不再假定异步握手会在固定 8 个微任务内完成；产品回退逻辑不变。
- **正式替代 0.12.43**：Windows、华为平板和小米手机统一升级到 `0.12.44`，Android 使用 `versionCode=1244`。公开的 `v0.12.43` 标签因两次 CI 测试门禁失败而保留，不移动、不覆盖，也不创建对应 GitHub Release。`v0.12.44` 随后因 CI 便携版在 15 秒内未完成自解压启动而在创建 Release 前失败。

## v0.12.43 - 2026-07-24（0.12.42 发布门禁修订）

- **正式替代 0.12.42**：功能与三端验收内容保持不变，修正 GitHub Release notes 的“对应提交”字段，并把干净构建生成的 `shared/version.generated.ts` 纳入独立 release-record commit。
- **版本单调递增**：Windows、华为平板和小米手机统一升级到 `0.12.43`；Android 使用 `versionCode=1243`。公开的 `v0.12.42` 标签因发布工作流门禁失败而保留，不移动、不覆盖，也不创建对应 GitHub Release。`v0.12.43` 随后也因 CI 握手测试依赖固定微任务数量而在创建 Release 前失败。

## v0.12.42 - 2026-07-24（三端自动配对与同版交付）

- **v0.12.42 三端自动配对与同版交付**：Windows 以串行协调器持续维护 ADB reverse，并在 Android 晚连接、断开重连或同步令牌轮换后为每台设备独立补发一次性配对；并发探测不会重复拉起应用，单机失败不阻断另一台。Windows、华为平板和小米手机必须安装同一补丁版本并完成联合矩阵后才能标记交付。
- **v0.12.41 华为胶囊图标尺寸约束**：保持系统要求的 24dp 通知图标画布，将 FocusLink 标记的可见尺寸收缩到约 12dp，减少 EMUI 固定图标槽中的视觉占用并为小时级计时文本留出辨识空间。
- **v0.12.40 华为胶囊动态计时修复**：运行态与暂停态都按 FocusLink 的当前主计时正向推进；暂停态只切换红色，不再错误冻结胶囊，只有显式静态快照才设置 EMUI pause 标志。
- **v0.12.39 华为暂停胶囊与移动资源修复**：暂停态保持 EMUI 接受的活动状态码并通过 `capsulePause` 冻结计时，胶囊背景切换为暂停红；Android 交付强制经过 Web 构建与 Capacitor 同步，避免 APK 界面版本落后于原生包版本。
- **v0.12.38 小米超级岛前台启动修复**：Android 主界面在 `onResume()` 后从 UI 队列同步原生专注通知，避免 HyperOS 3 将 Activity 创建阶段的前台服务启动误判为后台启动；超级岛真机测试改为只走正式 Activity 触发链路。
- **v0.12.37 华为实况准入安装**：依据 EMUI `HwLiveNotificationManager` 真机实现恢复完整 `TIMER` type/event/operation 与 feature Bundle；华为测试平板以同签名可更新系统应用安装，使用系统服务明确提供的本地校验通过分支生成状态栏计时胶囊。
- **v0.12.36 华为桌面胶囊准入收口**：真机逐项验证确认 `notification.live.type/operation/event` 会触发 EMUI 扩展实况窗许可删除，而桌面状态栏胶囊直接读取 capsule Bundle；正式通知仅保留番茄 Todo 同款 timer capsule 数据与 `CapsuleEnabled`，绕开无关的扩展实况窗准入。
- **v0.12.35 华为胶囊持久性修复**：删除参考通知中不存在、且仅供扩展实况窗使用的空 `notification.live.feature` Bundle；真机验收在发布 5 秒后检查 `1216`，避免只验证到瞬时入队。
- **v0.12.34 华为胶囊发布诊断**：记录 `1216` 发布入口、候选设备判断、通知管理器结果与活跃通知 ID；真机测试在返回桌面前断言 `1216` 已进入系统通知表。普通通知 `when` 使用墙钟计时基准，EMUI capsule Bundle 继续使用设备参考的 elapsed 计时值。

## v0.12.30 - 2026-07-24（华为桌面计时胶囊验收）

- **华为胶囊协议对齐**：按真机参考通知补齐 EMUI `TIMER` 倒计时双拼写、Chronometer 与系统通道提示字段，优先完成返回桌面后的左上角时间胶囊。
- **版本身份统一**：Android、Windows 与 Web 版本源统一为 0.12.30，Android `versionCode` 为 1230。

## v0.12.29 - 2026-07-24（双机自动配对与系统计时表面验证）

- **华为/小米自动配对**：PC 一键检查同步时为每台已连接 Android 设备生成独立的一次性配对链接；移动端自动换取并加密保存令牌，避免覆盖安装后 WebView 与原生后台凭据脱节。
- **同步收敛**：自动配对后立即刷新实时状态与账本，华为平板和小米手机继续共用同一云端 revision。
- **系统表面保持**：继续投影华为胶囊 elapsed 时间与小米超级岛计时信息，保留原有悬浮小窗、画中画和常驻通知降级。
- **版本身份统一**：Windows、Web/PWA 与 Android 统一升级到 0.12.29，Android `versionCode` 为 1229。

## v0.12.28 - 2026-07-24（系统计时表面、安全配对与任务层级）

- **Android 系统计时表面**：新增统一系统表面 provider，按设备选择小米焦点通知、华为/荣耀 EMUI 计时胶囊、Android 16 promoted ongoing 或标准常驻通知；华为分支投影运行/暂停、计时、图标和胶囊颜色，系统不识别时仍保留标准通知。后备 overlay 改为显式启用、长按拖动、点击回应用，并按安全区持久恢复位置。
- **Windows 两态小窗修复**：收起高度统一为 184×44，删除 35px contentBounds 绕行、贴边 cue 与绿色 L 型装饰，继续保留四边吸附、拖动和自动折叠。
- **三端任务层级统一**：桌面、手机和平板均使用父任务摘要与内嵌 child group；深层任务改用路径提示，选择与开始分离，760px 起的平板任务页使用树/详情双栏。
- **一次性安全配对**：桌面生成 2 分钟二维码和 8 位短码，载荷不含长期令牌；移动端通过一次性握手换取凭据，重复兑换被拒绝，远程连接继续强制 HTTPS。
- **一键本机同步**：把安全凭据生成、内嵌服务启动、健康检查、安卓桥接与首次同步合并为可重复自愈的一键动作；主界面只保留开启/修复与连接二维码，地址、令牌和独立开关移入高级设置，既有冲突不会被自动覆盖。
- **华为参考效果核验与实现**：对平板参考 APK 完成 jadx 静态还原和真机通知对象对照；确认业务 DEX 受原生壳保护、APK 未携带 Huawei Live View SDK，并从 EMUI 14.2 运行态确定 `TIMER` 与 capsule Bundle 字段。FocusLink 已以独立兼容层生成同类系统托管计时胶囊，华为真机字段 instrumentation 通过。
- **长期需求与实施记录**：新增三端用户需求台账和实施日志，并把 Windows、手机、平板验证矩阵加入前后端交接门禁。
- **版本身份统一**：Windows、Web/PWA 与 Android 统一升级到 0.12.28，Android `versionCode` 单调递增为 1228。

## v0.12.27 - 2026-07-23（覆盖安装、三端连接与统计动画收口）

- **Windows 覆盖安装收口**：安装器在调用旧卸载器前持续、有界地清理当前用户配置目录内短暂重生的 Electron 子进程，避免后台托盘或冒烟测试残留导致“无法关闭、必须重试”；本地污染的临时安装身份不再作为正式安装成功依据。
- **安装恢复边界加固**：旧卸载器已清空载荷但因空根目录返回 code 2 时，在 Electron Builder 显示 Retry 前接管；只对白名单退出码、相同安装目录和一致卸载器父目录执行恢复，未知错误保持失败，不再从错误注册表值推导递归删除目标。
- **Android 原生端口迁移**：除 WebView localStorage 外，Keystore 保护的后台连接也将旧默认 `http://127.0.0.1:8787` 原子迁移为 `18787`，覆盖安装后即使 WebView 尚未打开，通知后台链路也不会继续请求旧端口。
- **WebView 回收保活**：未勾选记住令牌时，Android 回收 WebView 导致 sessionStorage 为空不再自动清除原生密文和活动通知快照；只有用户显式移除令牌或清理连接时才清除原生连接。
- **Dashboard 自然日下钻收口**：移动热力日期选择会同步更新结论、四项 KPI、趋势、学科/任务/时段构成、暂停守恒和唯一账本；最长一轮使用范围裁剪值，午夜边界不再产生 0ms 幽灵轮次，相同任务 ID 按来源隔离。
- **时间轴与五仪表丝滑化**：秒级刷新对齐真实秒边界；沉浸模式只挂载一个 TimerDial/TemporalRibbon 实例；像素窄冒号不再侵入后一位，翻牌动画增加取消兜底，reduced-motion 暂停态仍保持时间投影更新。
- **版本身份统一**：Windows、Web/PWA 与 Android 升级到 0.12.27，Android `versionCode` 为 1227；手机和平板继续共用同一响应式 APK。

## v0.12.26 - 2026-07-22（三端统计升级与同步修复）

- **覆盖安装同步修复**：手机和平板启动时只把已废弃的回环默认地址 `127.0.0.1/localhost:8787` 迁移并持久化为桌面内嵌服务使用的 `18787`；个人 HTTPS、自定义路径与其他用户地址保持不变。
- **Dashboard 口径与结构升级**：桌面 KPI、图表和唯一账本统一使用自然日裁切与范围相交口径，跨午夜会话不再出现“图表有数据、结论为空”；任务构成算法下沉到共享层，移动统计补齐任务投入和暂停守恒。
- **时间轴与五套仪表性能优化**：时间之带保持单一渲染循环并逐帧绘制，缓存主题与混合时间线，移除逐帧布局读取；账本只刷新进行中行，像素、七段与翻页仪表减少无效重绘和高成本滤镜。
- **三端需求固化与版本统一**：参考高质量时间统计界面的高密度趋势、热力、时段与宽屏组织方式，同时保留 FocusLink 的真实账本和同步语义；Windows、Web/PWA 与 Android 统一升级到 0.12.26，Android `versionCode` 为 1226。

## v0.12.25 - 2026-07-22（全端粒子时间带与移动连接诊断）

- **桌面时间之带重构**：专注段保留完整连续时间材料，同时以边缘羽化、团簇、扰动和溢散避免退化成实心进度条；暂停段由完整残迹层与独立生命周期活动粒子组成，恢复后仍保留真实绿—红—绿历史。
- **手机与平板同步迭代**：Web/PWA/Android 控制台保留服务端真实 `segments` 与 `pauses`，新增共用语义的响应式粒子时间带；手机采用紧凑单列，平板与宽屏显示实时状态侧栏。
- **连接错误可执行诊断**：实时控制与已结束账本状态分开呈现；Android 使用 `localhost`/`127.0.0.1` 时明确要求 ADB reverse，局域网或异地设备继续要求 HTTPS，不再只显示笼统的连接中断。
- **移动安装身份统一**：Windows、Web/PWA 与 Android 同步升级到 0.12.25，Android `versionCode` 单调递增为 1225，手机和平板共用同一响应式 APK。

## v0.12.24 - 2026-07-22（时间仪器工作台与多端同步闭环）

- **时间仪器视觉闭环**：专注、任务、统计、设置与固定两态小窗统一为低噪声时间仪器工作面；统计页去除圆角卡片墙与阴影，以单一外边界、直角分区和发丝线组织结论、四项 KPI、时间轴、任务构成与暂停损耗。
- **全端专注与同步可恢复**：桌面、Web/PWA 与 Android 共用权威实时会话和已结束账本边界；本机同步服务、失败队列恢复、任务快照、离线回落与 Android 通知/快捷设置动作均保持幂等和 revision 校验。
- **发布级 UI 证据链**：修复 Windows Electron CDP 使用端口 `0` 时目标发现不稳定的问题；主窗和小窗 smoke 使用隔离随机回环端口，覆盖明暗主题、五套计时仪表、计时全状态、统计最小宽度和四边吸附释放。
- **候选资产作废重建**：删除未从干净源码生成的 0.12.21～0.12.23 本地候选资产；0.12.24 从新源码提交重新生成安装版、便携版和 SHA256，不沿用旧二进制或旧哈希。
- **版本身份统一**：Windows、Web/PWA 与 Android 同步升级到 0.12.24，Android `versionCode` 单调递增为 1224。

## v0.12.23 - 2026-07-22（统计工作台重构）

- **统计面板重构**：参考统计分析工作台布局，将结论、KPI、趋势、时间轴、任务分配与暂停损耗拆成清晰的白色分析模块。
- **响应式统计体验**：桌面保持两列分析视图，窄屏自动切换为两列 KPI 与单列分析，避免横向溢出。
- **数据逻辑保持一致**：继续使用专注/暂停/任务真实账本，不新增虚构统计口径。

## v0.12.22 - 2026-07-22（本机同步服务与队列恢复）

- **本机同步服务托管**：启用默认 `127.0.0.1:18787` 时由桌面主进程启动 loopback 同步服务，退出或关闭功能时释放端口；服务状态与访问令牌仍只保存在本机。
- **失败队列可恢复**：手动重试先恢复全部 `failed` 项，并连续处理成功批次；20 条积压不会只处理前 8 条后停住，限流与离线状态仍保留退避保护。
- **跨设备连接诊断**：保存配置与首次联网解耦，服务未启动时仍保留配置和本机计时；IPC 错误包装统一清理为可执行中文提示。
- **安装器进程匹配**：按 `域/电脑名\\用户名` 精确匹配当前用户进程，并进行有界强制关闭，减少“结束进程重试”循环。
- **版本统一**：Windows、Web/PWA 与 Android 升级到 0.12.22，Android `versionCode` 为 1222。

## v0.12.21 - 2026-07-22（粒子时间场与全端动效语言）

- **时间之带粒子场**：整条过去的时间带渲染为确定性粒子场，近“现在”处粒子密集、向远端逐渐散开并消逝；叠加痕迹渍层，暂停引线以燃烧形态保留，不再只有前沿一秒有生命力。
- **统一动效与光效语言**：新增 `motion.css` 动效基础设施（缓动/时长 token），外壳四视图方向感切换、专注页交错入场与按钮辉光、Toast 堆叠重排与对话框弹簧全部接入同一套语言，并统一提供 `prefers-reduced-motion` 降级。
- **五套表盘各自成戏**：standard 数字滑动、flip 翻页优化、pixel 呼吸核心、thin 与 segment 进位扫光；时间之带指针增加呼吸辉光与变焦交叉淡化，任务树展开与 Picker 改用弹簧动效。
- **统计/设置/小窗/移动端对齐**：统计页 KPI count-up 与交错入场，设置页开关与 tab 指示条，mini 窗交叉淡入与状态点呼吸，移动端 ConnectionSheet 弹簧且专注绿对齐桌面 `#0E9F6E`；FRONTEND_SPEC 新增「动效与光效语言」章。
- **版本身份统一**：Windows、Web/PWA 与 Android 同步升级到 0.12.21，Android `versionCode` 为 1221。
- **安装器错误索引**：当前账户的 FocusLink 子进程关闭增加有界二次强制收尾；新增 `FocusLink/backend-design/INSTALLER_TROUBLESHOOTING.md`，为“FocusLink 无法关闭”提供 `FL-INSTALL-001` 的核对与恢复步骤。
- **同步错误收口**：实时控制只有在 `/v1/live` 握手成功后才切换云端事实源；服务不可达时本机计时保持可用，重连指数退避且不再每 2 秒刷错。相同可见错误 Toast 在消失前只保留一条；跨设备网络错误统一显示服务地址，并新增 `FocusLink/backend-design/SYNC_TROUBLESHOOTING.md`（`FL-SYNC-001`～`005`）。
- **实时启动竞态与回环端口修复**：握手成功后服务在 `start` 命令前断开时，空闲桌面自动取消失效长轮询并回落本机计时；请求期间锁定开始按钮，避免同一错误连续堆叠。旧默认端口 `8787` 迁移到专用 `18787`，已有设置自动迁移。

## v0.12.20 - 2026-07-20（采样式时间切片消散）

- **暂停视觉模型推倒重做**：删除整块暂停填色、红色斜纹、孔洞侵蚀、扩散椭圆与独立观察框；暂停区保持为空白损耗区，只留下极淡余烬轨迹。
- **时间切片采样消散**：暂停时每秒先在“现在”前沿生成一片完整红色时间切片，再按规则网格采样成粒子，由右向左逐层剥离并向未来侧漂移、缩小、熄灭；相邻秒批次交叠，避免整秒闪切。
- **三层粒子质感**：采样点脱离后分化为碎片、粉尘与短火花，加入确定性湍流、重力和亮色模式对比；主时间之带与固定两态小窗复用同一纯函数模型。
- **验收链路去插件化**：视觉回归直接通过隔离 Electron 的 CDP 与 Canvas PNG 捕获完成，不操作用户鼠标键盘，并验证暂停态 `particle-field` 与真实画布尺寸。
- **版本身份统一**：Windows、Web/PWA 与 Android 同步升级到 0.12.20，Android `versionCode` 为 1220。

## v0.12.19 - 2026-07-20（设置工作区与粒子消散重构）

- **设置工作区规整**：外观、六套界面字体、全局强调色、五套计时仪表与状态语义拆成独立层级；字体与仪表改为响应式选择网格，仪表使用固定 70px 预览舞台，标准等宽不再被窄列裁切。
- **暂停粒子消散重制**：主时间之带以每秒 32 个发射槽连续生成碎片、尘点与火花，相邻批次跨秒重叠，并叠加余烬光、双层扩散波、漂移、缩小与熄灭；消散直接发生在时间材料与“现在”前沿，不叠加第二套观察框或刻度。打孔侵蚀仅保留为低对比材料纹理，小窗复用同一确定性粒子模型并以连续帧驱动。
- **账本全量状态着色**：每条专注记录都使用全局强调色，每条暂停记录都使用暂停红；状态轨、时间轴刻点、标题和时长保持一致，当前条目只增加背景强调，不再只有最后一条有颜色。
- **档案入口重新分类**：根文档和前后端索引按“前端产品/维护”和“后端架构/发布/历史”分组，历史 Release 增加系列索引，保持前端与后端两棵唯一文档树。
- **版本身份统一**：Windows、Web/PWA 与 Android 同步升级到 0.12.19，Android `versionCode` 为 1219。

## v0.12.18 - 2026-07-20（安装器跨账户误判彻底修复）

- **撤销全局进程扫描**：删除 0.12.17 基于 `nsProcess` 的跨账户查找与强杀链路，避免安装器看见 Codex、CI 或其他 Windows 账户的 FocusLink 测试进程后因无权关闭而永久阻塞。
- **当前账户定向关闭**：关闭动作移到 assisted installer 外层与 UAC 内层都会执行的 `customInit`，直接且仅向当前 `%USERNAME%` 的 `FocusLink.exe` 发送退出并有界强制结束；强制阶段不使用会卡住 Electron/Chromium 多进程树的 `/T`。
- **旧卸载器兼容桥**：新版安装器在自身进程树内临时设置关闭跳过标记，让 0.12.17 旧卸载器绕过有缺陷的全局 `nsProcess` 检查；变量不写入系统环境，安装器退出即消失。
- **把故障固化为门禁**：新增安装策略单元测试，明确禁止 `nsProcess` / `tasklist` 全局扫描、无用户名过滤的终止命令、`customInit` 和预安装强杀钩子，同时保留隔离安装 smoke 的进程级跳过开关。
- **版本身份继续统一**：Windows、Web/PWA 与 Android 同步升级到 0.12.18，Android `versionCode` 单调递增为 1218。

## v0.12.17 - 2026-07-20（安装器关闭竞态修复）

- **安装器关闭链路重写**：用 NSIS `nsProcess` 精确执行优雅关闭、2 秒有界等待、强制关闭和最终复查，不再依赖安装器进程的 `PATH` 或裸 `taskkill` 命令。
- **消除重复检查竞态**：替换 Electron Builder 默认的二次运行检查；仅在进程确实因权限原因仍存活时显示“无法关闭”，正常升级不再要求用户手动结束后台托盘进程。
- **版本身份继续统一**：Windows、Web/PWA 与 Android 同步升级到 0.12.17，Android `versionCode` 单调递增为 1217。

## v0.12.16 - 2026-07-20（统一多端版本身份与视觉资产）

- **消除同版本覆盖歧义**：PC、Web/PWA 与 Android 从 0.12.15 统一升级到 0.12.16；Android `versionCode` 单调递增为 1216，移动端显式显示语义版本和源码提交，Windows 安装器不再用同一个 0.12.15 覆盖另一套 0.12.15 设计包。
- **全平台图标单一来源**：桌面应用、主界面品牌标、托盘、PWA 192/512 与 maskable、Android adaptive/legacy launcher、前台通知统一为 `F / L` 双织带字标；生成脚本同时产出各平台 PNG/ICO，杜绝桌面已换新而手机仍显示旧圆环或默认 Android 图标。
- **完整继承实时多端专注**：保留 0.12.15 的 PC/Web/Android 唯一实时会话、revision/幂等命令、结束账本原子收敛、离线缓存、Android 通知动作与快捷设置磁贴；本版从统一源码重新走 Web、Cloud、Android、Electron 和发布门禁。

## v0.12.15 - 2026-07-20（PC/Web/Android 实时多端专注）

- **跨设备同步首个纵向切片**：新增与 dida/番茄 To-do 队列严格分离的 FocusLink v1 会话包协议；桌面端仅上传已结束 Session/Segment/PauseEvent，使用包含基线 revision 的稳定 `opId` 幂等补传，并以系统安全存储保护测试服务 token。cursor/revision/冲突箱以连接摘要分区并原子落盘，失效 cursor 可有界恢复；拉回的新会话原子写入 SQLite，不自动触发第三方副作用，同 ID 冲突持久保留且不静默覆盖。
- **Web/PWA 实时专注控制台**：320px 起的响应式界面从只读账本升级为开始、暂停、继续、结束与已结束账本；服务端 revision 为权威，命令携带稳定 id/session/expected revision，在线长轮询自动收敛，断线仅本机推算并锁定控制。Bearer、cursor 增量拉取、IndexedDB 缓存、显式记住/移除 token 与离线 app shell 保持隔离。
- **Android 薄原生运行层**：Capacitor 7.6.8 Android 壳新增 special-use 前台通知、暂停/继续/结束动作、Quick Settings Tile 与至少一次持久命令队列；通知动作以 Activity PendingIntent 避开 Android 12+ notification trampoline 限制，Tile 在 OEM 缓存旧状态时仍可打开 App 自愈。原生层不复制业务计时状态机，备份/设备迁移继续禁用。
- **实时测试云控制平面**：loopback-first Node HTTP 服务在现有完整账本协议之外新增账号唯一活动会话、start/pause/resume/finish/abort、幂等/冲突、长轮询与中断清理；finish/abort 与完整 Session/Segment/Pause 账本在同一次持久化提交中闭合。它仍不具备生产账号、备份、监控或多实例能力，禁止公开部署。
- **网络 ADB 双机验收**：华为 DBY-W09（Android 12）与小米 22041216C（Android 15）均通过最终 APK 的 3/3 instrumentation；实机完成跨设备 rev 收敛、快捷设置与通知动作、陈旧 revision 拒绝、断连缓存/控制锁定/恢复、唯一结束账本、通知和前台服务退出，并检查无 crash、ANR 或前台服务异常。小米 HyperOS 的 Tile 旧状态缓存已通过可点击 inactive 状态修复。
- **PC 正式接入实时控制**：桌面主窗、小窗、托盘和全局快捷键统一接入账号级实时会话；显式开启后以云端为唯一活动事实源，投影真实 segment/pause 时间线与任务上下文，断线不伪造命令确认。无论由 PC 还是 Android 结束，PC 都先导入云端权威账本，再触发原有滴答与番茄 To-do 完成后同步，避免重复会话。

## v0.12.14 - 2026-07-19（时间仪器深度打磨）

- **翻页与点阵仪表重制**：翻页机械改为事件驱动的 `steady → fold → unfold → commit` 状态机，快速变化只保留最新数字，结束/空闲与 reduced-motion 静态提交；像素点阵升级为高对比 7×9 整数网格，标准仪表增加固定数字槽与工业读数标记。
- **时间之带停止漂移**：修复非活动态把毫秒误当秒导致结束后高速移动的问题；idle/finished 固定在最后记录锚点并停止持续重绘。暂停态以从当前边界侵蚀、脱落和消失的红色碎片表达节律损耗，近远景转换仍保持秒级数据。
- **六套真实字体与统一强调色**：新增霞鹜新晰黑正线体和得意黑，与思源黑体、文楷、新致宋、漫黑组成六套不同字形骨架；导航、字体/仪表选择态、任务、统计、专注读数与时间之带统一使用用户强调色，暂停固定为红色。
- **统计 Dashboard 推倒重构**：改为结论与四项 KPI、带 00/06/12/18/24 定位的双尺度单日时间轴、带时长刻度和键盘精确值的多日堆叠日柱、百分比合计 100% 的任务构成带及暂停损耗；删除约 750 行已无入口的 weave/matrix/beads/mosaic 与旧 Dashboard 代码。
- **272×76 小窗重制**：展开态在 74px 内容盒内使用三行仪器布局，图标与按钮全部自绘且不换行，结束态显示本轮累计专注；暂停粒子跟随当前分钟进度边界，长任务名在字体变化后重新测量。收起态保持 `184×35` 简洁时间条。
- **番茄 To-do 补传一致性**：真实只读核验当前 54/54 FocusLink marker 为上传已确认、durable queue 为 0；新增学科修改失败的持久重试，避免旧记录 `isSynced=1` 把新学科误报为已上传。当前客户端仍没有独立云端回读与远端删除 API，删除只确认本机记录清理。

## v0.12.13 - 2026-07-19（NSIS 发布门禁加固）

- 完整继承 v0.12.12 已通过 GitHub 源码、Electron 回归、便携版主窗与小窗验收的界面重构和标准校验表。
- **安装门禁加固**：v0.12.12 在 GitHub Windows runner 上连续两次触发 NSIS 已知瞬时访问冲突 `0xC0000005`；保留真实静默安装验收，把同一错误的有界重试从 2 次提高到 4 次并增加递增退避，其他退出码仍立即失败。

## v0.12.12 - 2026-07-19（发布校验表格式修复）

- 完整继承 v0.12.11 已通过 GitHub 源码、Electron 回归、便携版主窗/小窗与安装版验收的界面重构。
- **发布校验修复**：v0.12.11 的两份 SHA256 数值正确，但 `SHA256SUMS.txt` 使用双空格分隔，未满足发布工作流要求的标准 `hash *文件名` 形式；旧 tag 保持不变，本版从新干净提交重新生成资产并修正格式。

## v0.12.11 - 2026-07-19（v0.12.10 发布目录元数据修复）

- 完整继承 v0.12.10 已通过本机验收的四套艺术字体、全局强调色、日报 Dashboard、五套计时仪表、原生全屏沉浸、秒级时间之带与 `280×84` 小窗。
- **发布目录元数据修复**：v0.12.10 的公开 tag 因 `shared/version.ts` 中 `APP_RELEASE_DIR` 仍指向旧目录而在 GitHub 元数据门禁被阻断；旧 tag 保持不变，本版同步为 `release-v01211` 后从新干净提交重新生成资产。

## v0.12.10 - 2026-07-19（全局强调色 · 艺术字体 · 日报 Dashboard）

- **四套真实中文字体**：界面改为 Noto Sans SC、霞鹜文楷、霞鹜新致宋与霞鹜漫黑，全部本地嵌入并提供真实样张；删除未使用的 MiSans 资源，不再用同一黑体的粗细变化冒充不同字体。
- **Dashboard 推倒重构**：统计改为结论、四项核心指标、24 小时专注/暂停时间轴、任务投入排行和最近会话表的顺读日报；多日范围改为每日趋势，删除珠链、马赛克与抽象视图切换器。
- **强调色真正全局化**：五种颜色同时作用于导航、按钮、任务选中态、设置、统计图、专注读数与时间之带；暂停始终使用红色，危险操作继续保持独立深红。
- **计时与沉浸细化**：修复翻页机械快速变更时旧数字卡住的问题，卡片材质适配亮暗主题与强调色；全屏沉浸使用独立排版和 520ms 入场过渡，仅保留完整专注界面。
- **时间之带升级**：增加近景/远景手动选择和跟随状态模式，专注与暂停都精确到秒，720ms 镜头变焦保持世界坐标连续，并以状态粒子表现当前边界的时间消逝。
- **小窗再压缩**：展开态收紧为 `280×84`，仍完整显示任务、当前时间、三项累计和全部控制；收起态为 `184×35`，使用 2px 进度轨与暂停粒子衰减。

## v0.12.9 - 2026-07-19（v0.12.8 正式发布修复）

- 完整继承 v0.12.8 已通过本机验收的清晰字形、五套计时仪表、原生全屏沉浸、单目标统计、跨色相专注色、时间之带材质和 `304×96` 紧凑小窗。
- **发布记录拓扑修复**：v0.12.8 的公开 tag 因 smoke 契约修正提交位于构建源码提交与 release-record 之间，不符合“release-record 必须是构建源码直接子提交”的不可变门禁；旧 tag 保持不变，本版把全部测试契约纳入新的构建源码提交后重新生成并验证资产。

## v0.12.8 - 2026-07-19（清晰字形 · 全屏沉浸 · 单目标统计）

- **字体真正换骨架**：界面提供思源黑体、MiSans 与霞鹜文楷三套本地字体，不再用同一字体只改粗细冒充差异；取消全局强制抗锯齿与读数模糊滤镜，改善“待完成”、设置说明和小字号的发虚问题。
- **五套计时仪表继续打磨**：翻页机械强化实体上下分片、转轴与全屏舞台；像素点阵增大实体格点；高反差编辑改用 Bodoni Moda；新增自绘 SVG 七段数码仪表，连同标准等宽形成五种真实不同的计时表现。
- **原生全屏沉浸**：沉浸模式现在切换 Electron 原生全屏，只保留任务、状态、主仪表、累计时间、控制和占约三分之一屏高的时间之带；普通窗口右侧专注账本可以折叠。
- **时间之带材质升级**：刻度继续承担进度本身，并新增秒格边界、实体层次、指针导轨和暂停双向斜纹；专注近景逐秒擒纵、暂停收缩到远景的语义保持不变。
- **统计改为单目标阅读**：顶部只保留一句结论与三个关键数字，今天轨迹/多日节律、单次质量、时间去向改为三个互斥分析视图，一次只突出一个主图，减少图表同时争抢注意力。
- **强调色跨色相**：专注色从四个相近绿色改为翡翠、钴蓝、鸢尾、琥珀、石墨五种跨色相选择；暂停始终使用红色，不与专注色混淆。
- **小窗进一步紧凑**：展开态从 `320×116` 收紧为 `304×96`，仍完整保留任务、当前时间、累计专注/暂停/总历时及全部控制；长任务名滚动展示，时间与按钮使用独立网格行。

## v0.12.7 - 2026-07-19（时间仪器 Time Instrument · 设计系统重建）

- **「时间仪器」设计系统落地**：整窗收敛为单一浅色工作面加 1px 发丝线分区，删除圆角卡片墙；移除整套旧 temporal-ui 主题层、AmbientField 环境动效与 fontProfile 字体气质机制，主题只保留明亮/深色/跟随系统。颜色收敛为四种语义：界面蓝 = 操作、专注绿 = 运行（四档可选）、暂停红 = 损耗、深红 = 危险操作。
- **四套计时仪表**：标准等宽（JetBrains Mono）、翻页机械（Oswald，上下分片加转轴翻页）、像素点阵（自绘 5×7 点阵数字，核心图形随累计专注点亮）、极细编辑（Inter Tight 纤细宽字距）；设置页四卡实时渲染预览并持久化，旧 editorial/digital/mono 设置自动迁移为 thin/pixel/standard。
- **时间之带重写为 canvas**：刻度即进度，颜色填充整个刻度区、刻度绘于颜色之上，不再有独立第二进度条；专注为秒级近景、暂停时 720ms 对数变焦拉远到约 30 分钟大格远景、继续时第一帧即变绿且镜头反向拉近；逐秒 130ms 离散步进，reduced-motion 下瞬时切换。
- **统计 Dashboard 重做**：顶部一句自然语言结论（计入进行中会话并标注）；单日为 24 小时时间织带、多日为日期×时段节律矩阵、单次会话质量为珠链图、时间去向为马赛克比例带加精确时长占比行（含「未关联」类别）；范围切换保留请求版本保护；不再有环形图与 KPI 卡片墙。
- **沉浸模式重排**：覆盖层依次呈现当前任务、状态、四套仪表之一、累计专注/暂停/总历时、全部控制与放大约 1/4 屏高的时间之带，Esc 退出。
- **专注页与按钮系统**：删除左侧蓝色选中竖线，右侧专注账本与主区同一工作面、1px 发丝线分隔；开始/继续为操作蓝主按钮，暂停为深色，结束为次级，大窗口重排版不留空。
- **小窗修复**：仍只有收起 `184×35` / 展开 `320×116` 两个固定尺寸（唯一来源 `shared/miniWindowLayout.ts`，旧 `320×124` 设置自动归一）；展开态六区重排，完整显示任务名（无省略号/渐隐，极长名克制滚动）、当前时间、三项累计与全部控制，时间与继续按钮分行不重叠。
- **字体清理**：删除未使用或近似的字体包，保留 Geist Variable（界面拉丁）+ MiSans（中文）+ JetBrains Mono（数据）+ Inter Tight / Oswald（仪表字形），像素数字为自绘点阵，全部本地嵌入。

## v0.12.6 - 2026-07-19（结论优先统计台 · 发布环境韧性修复）

- 完整继承 v0.12.5 已通过本机与 GitHub 便携版验收的统计 Dashboard、双尺度时间之带、沉浸模式、专注色/计时字形设置和信息完整小窗。
- **安装门禁韧性修复**：v0.12.5 在与 v0.12.3 相同的 Windows Server 2025 runner 和安装脚本上偶发 `0xC0000005`，且发生在安装器进程、尚未进入应用 smoke；发布流水线现在仅对此访问冲突清理隔离目录后重试一次，其他退出码仍立即失败。

## v0.12.5 - 2026-07-19（结论优先统计台 · 正式发布修复）

- 完整继承 v0.12.4 已通过本机验收的统计 Dashboard、双尺度时间之带、沉浸模式、专注色/计时字形设置和信息完整小窗。
- **发布元数据修复**：v0.12.4 的公开 tag 因四份设计规范使用精确补丁号、未保留 workflow 要求的 `v0.12.x` 系列基线而在创建 GitHub Release 前被阻断；旧 tag 保持不变，本版恢复系列基线并重新生成、验证和发布资产。

## v0.12.4 - 2026-07-19（结论优先统计台 · 双尺度时间之带）

- **统计 Dashboard 重建**：采纳 Kimi 的独立结构审阅，删除误导性的环形“时间构成”和稳定性数字格；首屏先给有效专注、会话、暂停与专注率结论，再展开专注节律、独立时间去向、单次专注质量和当天真实轨迹。
- **时间之带双尺度升级**：专注时使用 75 秒近景与逐秒刻度，固定“此刻”指针呈现滴答推进；暂停时收缩为 90 分钟远景，以 5 分钟小格和 30 分钟大格呈现全局，专注绿与暂停红严格分离。
- **专注视觉与沉浸模式**：运行主时间改为专注绿，暂停改为红；移除侧轨蓝色激活竖线，新增可按 Esc 退出的沉浸模式，并提供编辑体、数码体、等宽体三种计时字形。
- **设置与字体辨识**：新增四档专注色设置，保持界面操作蓝和暂停红不变；字体选项恢复真实样张并强化字重、字距差异。
- **小窗信息完整性**：仍只保留两种固定尺寸，展开态调整为 `320×124`，任务可换行，累计专注/暂停/总历时与开始/暂停/继续/结束控制不再截断或互相重叠。

## v0.12.3 - 2026-07-18（Linear Workbench · CI 显示器适配修复）

- 完整继承 v0.12.2 已通过本机验收的 Linear Workbench、流动时间织带、连续专注账本、真实统计与紧凑双态小窗。
- **CI 显示器适配**：v0.12.2 的 GitHub runner 无法提供 `1280×720` 可用窗口宽度，旧 smoke 将操作系统的正常尺寸夹取误判为 UI 失败；本版保留 `980×660` 产品最小尺寸契约，并允许大尺寸用例按显示器工作区安全夹取。

## v0.12.2 - 2026-07-18（Linear Workbench · 正式发布修复）

- 完整继承 v0.12.1 已通过本机验收的 Linear Workbench、流动时间织带、连续专注账本、任务列表、真实统计和紧凑双态小窗。
- **发布清单修复**：v0.12.1 的公开 tag 因版本化发布正文缺失、LFS 工作流配置误混入 release-record 提交而在元数据门禁阶段被阻断；旧 tag 保持不变，本版将运输配置固定在源码祖先提交，并按严格六文件 release-record 重新生成、验证和发布资产。

## v0.12.1 - 2026-07-18（Linear Workbench · 时间织带与全界面审美收敛）

- **单一视觉系统**：移除 Quiet / Dawn / Bloom 多主题运行时分支和自由强调色入口，保留明亮、深色、跟随系统三种外观；界面蓝、专注绿、暂停琥珀固定承担各自语义，不再在不同页面漂移。
- **流动时间织带**：以固定“此刻”指针和向左流动的世界时钟表达时间推进；暂停时专注段冻结在暂停边界，琥珀暂停段继续向“此刻”生长，继续专注后新段从指针处接力。短片段保留最小可见宽度，刻度标签会避让当前指针。
- **专注台重新收色**：主计时恢复高对比中性墨色，运行/暂停差异收敛到状态点、织带指针、账本状态线和操作按钮；专注账本与主区共享连续工作面，并移除重复状态竖线。
- **任务、统计与设置密度修正**：任务页改为连续列表工作区；统计页重建当天 24 小时节律、专注/暂停构成、任务去向、单次强度和混合时间轴；设置页字体方案改为紧凑四列选择，删除臃肿主题与强调色配置。
- **小窗回归紧凑双态**：继续严格使用共享尺寸常量中的折叠/展开两档，恢复直接、低装饰的进度条与控制台表现，不增加第三尺寸或自由缩放。
- **统计数据真值补足**：新增范围交叠查询和只读 `sessions.analytics(range)`，跨午夜会话按自然日裁切，图表不再依赖历史列表行数或伪造数据。

## v0.12.0 - 2026-07-18（安静的桌面时间仪器 · 全量前端视觉重构）

- **全量视觉重构落地**：在 v0.11.7 专注页基础上完成外壳、任务、弹层、统计、设置、小窗全部表面的统一重构，整窗收敛为同一套「安静的桌面时间仪器」语言；亮色为设计起点，暗色为同构映射。
- **复合时间仪器**：专注页重新引入 60 刻度机械感时钟，用秒针、状态表圈与中央精确读数表达“此刻”；时钟下方保留真实 Session Flow 时间轴，用专注段、暂停段、刻度和此刻游标表达“过程”，两者都不伪造目标进度。
- **四套字体气质**：新增 IBM Plex「精密」、Manrope「人文」、Geist「现代」、Sora「几何」四组正文/标题/数字字族，Quiet、Dawn、Bloom 均可独立切换。
- **统一弹层系统**：任务选择器、下拉菜单与确认弹窗共享 `.overlay-surface` 不透明材质、`.overlay-backdrop` 哑光遮罩与 `.motion-popover` 生长动画；历史页三处原生 `confirm()`（删除记录、批量改关联、删云端重同步）替换为统一 `ConfirmDialog` 组件，具备焦点圈、Esc 取消、焦点返回触发元素与 danger 红色语义。
- **统计页单一分析目标**：时间去向与专注稳定性重排为一张“时间图谱”，每日趋势、构成、任务去向、强度排行与当天混合时间轴全部来自只读 `sessions.analytics(range)`。
- **跨日统计修复**：分析查询改为选择与范围真正交叠的 Session；跨午夜、跨月和跨年的 Session、Segment、PauseEvent 按自然日裁切分摊，单日查询不再遗漏前一天开始的会话。
- **任务页连续列表**：Things 3 式任务树、留白与渐进披露，搜索、排序、完成/恢复与「关联并开始」在同一节奏内完成。
- **设置页 Raycast 式密度**：连接、同步、体验、主题、小窗与版本分区重排，状态条与诊断信息收敛，首屏不再暴露原始诊断。
- **小窗双固定尺寸保持**：折叠/展开两档尺寸契约不变，视觉材质与主窗主题同源，多显示器与 DPI 行为维持既有契约。
- **主题 token 修复**：Tailwind safelist 补齐运行时动态切换的 `theme-dawn`/`theme-bloom`/`light` 等类，修复生产构建亮色 Dawn/Bloom token 块被 purge 导致亮色主题失效的问题。
- **候选版验证**：format/typecheck/lint、243 项自动化测试、build、dist 与隔离用户目录的主窗/小窗 Electron 视觉巡检均通过；正式 GitHub Release 仍以发布前真实外部服务、安装版/便携版启动和资产回读门禁为准。

## v0.11.7 - 2026-07-17（安静的桌面时间仪器 · 视觉重构阶段 1：专注页）

- **设计方向切换**：废止 Bloom Console / Dawn Ledger 语言，锁定「安静的桌面时间仪器」；token 全部重写（亮 canvas `#F3F1EC`、深 teal accent `#286C63`、pause `#CC5145`，暗色同构 `#111411`/`#78C5B5`/`#EF6A5C`），字体统一 IBM Plex Sans + IBM Plex Mono（tabular-nums），中文回退 Microsoft YaHei UI / Noto Sans SC；旧 accent 六色选择器与 font-profile 双档已归一中性化，将在设置页阶段移除。
- **专注页 58/42 双区重建**：左区为当前任务意图、约 300px 细刻度 SVG 仪表（60 根哑光发丝刻度 + 细针，运行填充 accent、暂停转红）、84px 等宽主数字、暂停/结束双主操作（accent/pause/ink 三体系，hover/active/disabled 齐备）与累计专注/累计暂停/总历时同竖线对齐；右区为纯文本「本次专注账本」，Segment 与暂停区间按时间交织、发丝线分隔，彻底去除 chip 与色块堆叠。
- **逻辑零改动**：计时、任务关联与状态机未动；UI 冒烟色值断言同步新 token（`40 108 99` / `204 81 69`）；232 项测试与 format/typecheck/lint/build 门禁保持通过。
- **文档口径修正**：根 README 与后端索引中「最近正式版 v0.11.4」「v0.11.6 仅源码迭代」等滞后表述修正为已发布口径；小窗时间 31px 更正为 30px。

## v0.11.6 - 2026-07-17（曦光控制台 Bloom Console · 从零重建）

- **曦光花田光场**：亮色为桃/鸢尾/天青/薄荷四色可见光斑慢漂移的晨曦场，暗色为同构加浓的极光场；彻底告别灰白卡片与顶部胶囊导航，改为 78px 磨砂左轨道（白瓷激活瓦片 + 靛青霓虹指示条 + 状态胶囊）。
- **单轴和谐专注台**：REC 眉毛 → Space Grotesk 渐变墨巨数（88–188px，色相流动 + 回晖呼吸）→ 彗星进度轨（刻度基底 + 发光彗头 3.4s 永续循环，暂停冻结为红色彗星）→ 磨砂命令坞（五层宝石主按钮 + 磨砂次键 + 扫光 + 弹簧手感）；有片段时账本为贴边全高右栏，非浮动卡片。
- **字体换血**：展示与数字改 Space Grotesk，中文改 MiSans，拉丁 UI 保留 Geist/Manrope 双档位，mono 沿用 JetBrains Mono。
- **暂停全红**：徽章、按钮、活动轨、账本、图表、小窗统一 `--app-pause` 红色系；运行保持绿色语义。
- **修复**：渐变墨数字整位隐形（filter 破坏 background-clip:text）、亮色小窗暂停键被冲刷成白底、松石绿/琥珀金强调色对比度不达标。
- **回归与文档同步**：双 smoke 令牌断言、FRONTEND_SPEC、验收驱动脚本（`scripts/review/`）齐备；232 项测试与 format/typecheck/lint/build 门禁保持通过。

## v0.11.5 - 2026-07-17（亮色优先工作台 · 当天可导航统计 · 清晰专注状态）

- **亮色视觉与控件状态增强**：明亮主题继续作为默认入口，强调色贯穿主操作、导航、当前任务、开关、滑块和计时活动轨；设置开关统一为清楚的 `42×24` 两态规格，并补齐 switch 可访问语义。
- **当天优先的统计浏览**：统计默认展示当天，支持前后逐日切换并禁止进入未来；保留近 7 天、半个月、1 个月与自定义范围，在同一分析区呈现真实时间构成、柱状趋势和单次排行。
- **任务工作台去歧义**：移除含义不明的旗标与来源副标题，用清单层级、文字优先级、子项数量和常驻“开始专注”入口组织任务；运行和暂停时显示准确的当前任务状态。
- **专注开始反馈补强**：空闲、专注中和已暂停状态使用明确文案；开始或暂停时间直接可见，启动、暂停、继续的操作与 Toast 不再产生冲突反馈，同时保留三时间模型与片段账本语义。
- **回归覆盖更新**：统计日期纯函数、真实按钮开始/暂停、逐日导航和开关语义纳入自动化验证，设计规范与交接清单同步更新。

## v0.11.4 - 2026-07-15（正式发布修复）

- 完整继承 v0.11.3 的排版驱动专注台、连续片段账本、柱线面积组合图和双字体视觉成果。
- **发布清单修复**：v0.11.3 的公开 tag 在资产校验阶段因 `SHA256SUMS.txt` 缺少 GNU 校验格式要求的 `*` 文件标记而被阻断；旧 tag 保持不变，本版按 workflow 的精确格式重新生成、验证和发布资产。

## v0.11.3 - 2026-07-15（排版驱动专注台 · 单一分析画布 · 统一视觉语言）

- **废弃科幻仪表盘造型**：移除多层圆轨、交叉轴线与跳动信号，计时区改为大字号排版、局部流动光面和细活动轨；状态、片段编号、时间与控制建立清晰阅读顺序。
- **本次片段成为同一工作面**：左右区域共享边界、材质和纵向节奏，右侧使用时间刻度背景与连续事件行，不再像独立空白卡片贴在计时器旁边。
- **统计图表重新编排**：三张独立后台卡片合并为一块分析画布；每日趋势改为柱、趋势线、面积与刻度共同构成的组合图，稀疏数据不会再把单根柱子拉满，时间构成与单次排行收进同一视觉节奏。
- **发布不可变修复**：v0.11.2 的公开 tag 因发布记录提交额外包含旧目录删除而在创建 GitHub Release 前被阻断；旧 tag 保持不变，目录清理前移到 v0.11.3 源码提交，重新构建与发布。

## v0.11.2 - 2026-07-15（连续专注工作台 · 真实统计图谱 · 显著字体分型）

- **专注页重新构图**：计时器与“本次片段”合并为一个连续材质工作台，取消左右两个独立卡片的割裂感；活动片段改为轻量状态色带，时间线通过分隔与对齐建立秩序。
- **计时核心特效重建**：短装饰横线替换为多层轨道、交叉轴线、状态节点和五段节奏信号；运行时轨道以低频差速旋转，暂停时自然收束，数字保持最高对比且不使用廉价文字发光。
- **统计页新增真实图谱**：根据当前时间范围内的真实会话生成专注/暂停环形构成、每日专注柱状趋势与最长五次横向排行；图表随筛选重算并服从 reduced-motion，不填充假数据。
- **双字体不再只是改名**：“舒展”使用 Manrope + Noto Sans SC 的圆润宽松节奏；“锐界”使用 Geist + 微软雅黑 UI 的紧凑字面，并分别调整正文和计时数字字重、字距。UI smoke 会比较实际 computed style，防止再次退化成无差异切换。
- **空间过渡与回归加固**：四个页面使用同方向感的短位移、缩放与透明度收敛；新增统计三图和字体差异的桌面 UI 断言，并修复 Windows smoke 结束时日志目录尾写入导致的 `ENOTEMPTY` 次生失败。

## v0.11.1 - 2026-07-13（Windows runner 契约修正 · 不可变补丁发布）

- **小窗 smoke 改验真实内容尺寸**：Windows runner 会把 frameless 窗口的 `window.outerHeight` 混入不可见系统边框，本版不再用该平台装饰值判定产品尺寸，改由 viewport、填满 viewport 的 shell 和 PNG 像素三项共同验证 `184×35` / `256×92` 固定契约；`outerWidth/outerHeight` 只保留为诊断与幂等信号。
- **失败清理不再产生次生错误**：小窗 smoke 删除临时 user-data 时增加 Windows 有界重试，避免 Electron 日志尾写入造成 `ENOTEMPTY` 掩盖首个断言。
- **发布不可变性**：公开的 `v0.11.0` tag 在 GitHub Release 创建前被 runner 特有的错误断言阻断，因此不移动、不覆盖旧 tag；完整 UI、任务、小窗与双同步更新由 v0.11.1 重新打包、复验并发布。
- **发布路径去硬编码**：主窗与小窗 smoke 从 `package.json` 版本自动推导 `release-v*`，后续补丁版本不再沿用旧发布目录。

## v0.11.0 - 2026-07-13（动态材质工作面 · 过渡式边缘小窗 · 单一源码工作区）

- **动态材质系统大改**：主窗口新增确定性的低对比环境光场、轨道轮廓、稀疏粒子、状态呼吸光与强调色伴生色；专注、任务、统计和设置统一使用高不透明材质面、折射边缘、定向阴影与连续悬停反馈，六种强调色会同时驱动按钮、导航和环境层。
- **动效层级重建且规避合成黑块**：按钮、面板、状态、数字和环境元素使用分层 transform/opacity 动效；全屏页面只做短淡入，不再动画 blur 或整页滤镜，避免 Electron 截图和实际窗口出现黑色合成块；reduced-motion 会关闭持续粒子、扫光、呼吸与位移。
- **双字体体验**：新增默认的“澄澈”方案（`Manrope Variable` + `Noto Sans SC Variable`），保留 v0.10 的 Geist“精准”方案并可在设置 > 体验即时切换；字体偏好持久化且只触发主题域刷新，不误触快捷键、开机启动或同步设置副作用。
- **小窗内容与比例彻底重构**：继续严格使用 `184×35` / `256×92` 两种固定尺寸；折叠时间放大到 25px、展开时间放大到 31px，折叠态新增 3px 真实专注占比进度轨，展开态重排任务、三时间和控制区。
- **贴边过渡不再突变**：Windows 原生拖拽通过进入/退出 move loop 明确识别释放，按住不动时不会改尺寸；释放后先吸附到当前显示器 work area 边缘，再显示 320ms 收束/淡缩反馈后折叠，过渡中重新拖动会立即取消，并继续覆盖四边、多显示器与 DPI。
- **单一源码工作区**：根目录只保留 GitHub/治理入口、最近三个 `release-v*` 与 `FocusLink/`；renderer、Electron、shared、测试、脚本、设计文档和构建配置全部收进 `FocusLink/`，GitHub Actions、Electron Builder、smoke 默认路径与文档链接同步迁移。
- **双同步真值加固**：滴答真实临时任务覆盖中文评论、marker 幂等、30 秒原生 focus 及任务关联、完成与恢复；番茄手动同步可在未运行时用参数数组和随机调试端口按需连接，已普通运行但无桥时绝不杀进程，后台周期也不擅自启动外部应用。CDP 页面必须通过标题与特征 API 指纹；上传 success 只是“上传已确认”，不冒充独立云端回读或当前不支持的远端删除。
- **兼容既有核心能力**：滴答任务完成/恢复与 6 秒撤销、手动强制刷新、番茄 To-do 学习分类与待上传队列、统计 request-id 保护和三时间账本保持原有语义。
- **不可变发布记录**：源码提交、发布记录提交与 annotated tag 严格相邻；包内 commit 由运行时 smoke 核对，GitHub Release 附件会下载回读并逐字节、逐 SHA256 对照，正式正文使用稳定的“正式版 / 已通过”元数据。
- **不中断会话的安装验收**：隔离安装开关现在同时绕过自定义关闭和 Electron Builder 内置的运行中提示；本地发布 smoke 会临时隔离并最终恢复卸载注册项与快捷方式，安装版验证不再卡住，也不会结束用户正在进行的专注。

## v0.10.0 - 2026-07-13（候选：精密明亮工作面 · 可找回任务 · 双同步闭环）

- **精密明亮工作面与专用字体系统**：深浅主题统一为瓷白/石墨中性画布、分层高不透明表面、定向阴影和单一受控状态光；重做 FocusLink 标识、分段式顶栏、专注主区、任务、统计和设置版心，同时移除大面积 blur、径向光球与文字发光；中文使用内置 `Noto Sans SC Variable`，数字与拉丁使用内置 `Geist Variable`，`JetBrains Mono` 仅用于诊断和代码。
- **局部且连续的动效**：共享节奏收敛为 140/220/320ms，页面只做短淡入，控件和账本只动画 transform、opacity、颜色与边界；持续动画仅保留加载与运行状态指示点/短线，reduced-motion 会取消位移和呼吸。
- **固定滴答任务语义与真刷新**：任务页删除“任务来源”切换，统一表达滴答清单；dida CLI 优先、已登录 OAuth 后备只作连接策略，两者都不可用时给出可诊断错误；首屏仍复用 30 秒短缓存，用户点击刷新会明确绕过缓存并合并并发读取，不再看见外部新建任务却刷新不出来。
- **完成任务可立即撤销也可稍后找回**：工作台先加载活动任务，已完成历史仅在打开时按 30/90/365 天窗口读取；新增 `completedAt` 归一化与最近完成/名称/截止日期排序，完成后提供 6 秒撤销，长列表每批最多渲染 120 项。
- **统计交互不再被旧请求卡住**：会话详情以 request id 和当前 session id 双重核对，过时 IPC 响应不再覆盖新行，失败可见且可重试；统计页只订阅所需计时原子值，不再因每秒 tick 重渲染整份历史。
- **renderer 与运行时生命周期加固**：主窗和小窗无响应时先等待 5 秒，随后在每 60 秒最多 3 次的预算内受控重载，主进程计时不中断；日志保留 Error name/message/stack/cause，托盘、快捷键与 snapshot 监听初始化幂等。
- **小窗改为时间优先层级**：继续使用收起 `184×35` 与展开 `256×92` 两个固定尺寸；收起态仅保留进度/状态、当前时间和展开入口，两态主时间分别放大到 23.5px 与 30px，展开态在单一网格内容纳任务、三时间和当前控制。
- **验证门禁补足真实可逆链路**：发布前除现有静态检查、回归、主窗/小窗和真实外部服务验证外，还必须在真实 UI 中完成“完成 → 6 秒撤销 → 再次完成 → 完成列表找回 → 恢复”，并覆盖统计快速切换、renderer 恢复、日志序列化与托盘监听幂等性。

## v0.9.0 - 2026-07-13（发布候选：任务工作台 · 明亮主题 · 边缘进度小窗）

- **四区主工作面**：顶级导航重建为专注、任务、统计、设置；页面过渡改为可并行收敛的状态切换，修复快速导航时旧页面卡在退出态的问题。
- **独立任务工作台**：新增本地、dida CLI、TickTick OAuth 三来源任务浏览，支持项目筛选、搜索、未完成/已完成/全部切换、层级任务、快速创建、完成/取消完成、关联并开始专注以及双同步状态入口。
- **可逆任务后端**：renderer 统一调用 `tasks.refresh` 与 `tasks.setCompleted`；普通任务、checklist 子项和本地任务共用可逆语义。dida 0.1.10 缺少恢复参数时使用只读既有凭据的最小 Open API bridge，并在写后回读验证。
- **滴答状态兼容修复**：任务列表合并活动与已完成结果；Dida 恢复任务后可能保留历史 `completedTime`，现在以显式 `status=0` 为权威，避免已恢复任务仍被误判为完成。
- **明亮默认主题**：新增高对比冷白/靛蓝默认主题，保留原深色主题；统一六套强调色、状态光场、材质、阴影、点击反馈、列表交错和 reduced-motion 退化。
- **小窗彻底缩小**：展开态固定为 `256×92` 高密度控制台，收起态固定为 `184×35` 边缘进度胶囊；只显示当前状态、时间和对应累计，移除自由缩放和重复信息。
- **四边吸附交互**：小窗支持左右上下边缘吸附，14px 进入/30px 离开双阈值，贴边 260ms 自动收起，拖离 140ms 自动展开，点击展开提供 900ms 防回弹，并在多显示器 work area 内向屏幕内侧生长。
- **双同步真实闭环**：真实临时 dida 任务已覆盖完成、恢复、回读与清理；真实番茄 To-do 已覆盖本地写入、云确认、marker 幂等和清理，未识别内容继续归入“学习”。两个同步域仍独立显示本地关联与云端状态。
- **文档与目录单一真相**：维护文档只保留 `frontend-design/` 和 `backend-design/` 两个入口及 AI 接手清单；移除平行 docs/backend/shared-contract、旧前端树、一次性修复报告和可再生成产物。
- **发布闭环自动化**：新增 tag 驱动的 Windows GitHub Actions，校验 tag/包版本、执行静态检查与完整测试、打包、生成 SHA256，并创建带安装版、便携版和校验文件的 GitHub Release；线上发布仍必须回读核验后才算完成。
- **回归脚本收口**：修复崩溃恢复脚本调用不存在阶段导致进程空转的问题，未知阶段改为立即失败；新增统一 Electron、dida 状态与番茄 To-do 真云验收命令。本地候选已通过 26 个测试文件 / 206 项测试、0 个生产依赖漏洞及全部真实临时数据清理。

## v0.8.0 - 2026-07-12（精密专注台 · 可靠同步闭环）

- **UI 全面重建**：删除多代叠加且互相冲突的 Aurora / Liquid Glass 样式和臃肿卡片层级，重建统一的状态光场、材质分层与高密度桌面工作面；深浅主题、边界、高光、阴影、圆角和动效由一套设计令牌控制。
- **专注语义定型**：专注数字、状态与小窗统一使用绿色，暂停统一使用红色；任务标题、结构导航和普通操作保持中性，避免用状态色污染信息层级。
- **空闲界面减法**：没有片段时只显示居中的单一计时面板，不再为了填满版面展示空账本、装饰进度线、英文副标题或重复快捷键提示；产生片段后才展开紧凑时间账本。
- **统一任务选择**：删除独立 `TaskPanel` 抽屉，计时预选、当前片段关联、会话默认任务和历史补关联全部复用同一 `TaskPicker`；本地/滴答来源、搜索、清单过滤和父子折叠在一个弹窗内完成，点选即生效。
- **历史与设置瘦身**：历史回归扁平时间账本，移除片段合并维护交互；设置收敛为连接、同步、体验三个平面页签，删除强调色选择器和无效说明卡，CLI 路径与原始模板只在高级配置中显示。
- **短专注可靠保存**：暂停和继续都会立即持久化当前快照，短于周期快照间隔的专注不再因暂停或崩溃丢失；异常恢复不再通过错误状态调用停止流程。
- **dida checklist 修复**：任务缓存只带 `parentId` 时也能回读父任务并解析 checklist 子项；原生专注绑定父任务，完成子项仍只更新父任务 `items` 中的目标状态。
- **同步队列隔离**：队列项在入队时记录实际 Provider，切换任务来源不会把旧记录交给错误 Provider；退出应用会等待在途自动同步完成交接后再关闭数据库。
- **重新关联一致性**：更换或清除云端任务关联时先在同步互斥区清理旧 dida focus 和相关队列，再更新本地片段，避免 marker 命中旧任务却误报成功。
- **番茄 To-do 离线保障**：客户端未运行时把缺失片段安全写入本地待上传记录并保留持久 ID，桥恢复后继续补传；未识别内容继续统一归入“学习”。
- **Windows 写盘加固**：番茄 To-do 原子替换遇到短暂 `EPERM / EBUSY / EACCES` 文件锁时做有界退避重试，持续失败仍保留旧库；新增故障注入测试并连续压力验证，避免偶发记录丢失。
- **固定小窗重构**：两态尺寸收敛为 240×80 与 384×164，重新组织收起态读数和展开态任务、统计与控制；收起、展开和重置后立即广播设置变化，展开时按当前显示器工作区校正位置。
- **源码结构收敛**：前端按 `app / ui / features / styles` 分区，第三方后端归入 `electron/integrations`，构建、回归与 smoke 脚本分目录管理；共享 IPC 和计时纯策略不再反向依赖 Electron 或 renderer。
- **项目文档收束**：新增统一文档中心和历史索引，分别整理前端设计、后端模块与共享契约入口；移除 docs 根目录中 v0.1–v0.2 的重复修复报告和旧版 CHANGELOG 快照。

## v0.7.0 - 2026-07-11（高级材质工作面 · 语义状态重构）

- **统一高级工作面**：移除侧栏、重复页头和布局跳动，品牌、专注、账本、设置、任务与托盘操作收敛到单一顶部导航；计时控制台和片段账本组成连续材质面板。
- **专注绿色 / 暂停红色**：新增独立 `pause` 语义色；主计时、状态徽章、控制按钮、片段时间线、品牌状态和固定小窗全部统一，warning 不再承担暂停含义。
- **状态材质与光效**：专注时使用绿色呼吸线与柔和环境光，暂停时切换红色边界、阴影和材质溢色；保持 GPU 友好的 opacity / transform 动效和 reduced-motion 退化。
- **交互减法**：删除 split drawer、宽度策略及对应测试；任务面板始终覆盖打开，任务和隐藏到托盘各只保留一个入口。
- **项目规整**：清理旧可视化组件、过期设计/构建目录和多余发布目录，版本与交接文档统一升级到 0.7.0。

## v0.6.0 - 2026-07-11（专注工作台 · 双云同步闭环）

- **统一工作面全面重构**：删除侧栏、重复页头、圆形仪表盘与剧场式光效；全应用只保留一条顶部导航，专注控制台与片段账本收进同一连续工作面。
- **交互彻底收敛**：任务与隐藏到托盘各保留一个入口；任务面板始终使用固定覆盖式抽屉，不再根据窗口宽度切换 split view 或挤压计时区。
- **响应式工作台定型**：统一工作面使用 `520px / 320px` 最小双列，900px 以下改为单列滚动；空闲时账本仍显示解释型状态，不出现无意义空白。
- **任务工作流收敛**：任务抽屉可直接切换“本地 / 滴答”，支持搜索、清单过滤、开始专注、关联当前片段、设为本次默认任务和完成任务，无需在设置页来回跳转。
- **dida 默认来源迁移**：首次发现本机已安装 dida CLI 时自动选为默认任务来源；迁移只执行一次，之后尊重用户手动选择。
- **短专注时长修复**：滴答专注记录只使用有效专注跨度，不把隔夜暂停写进云端开始/结束时间，避免几分钟记录显示成数小时。
- **双队列可诊断同步**：设置页同时展示滴答队列与番茄 Todo 待上传数量，支持立即重试；失败数据保留本地并给出明确状态。
- **番茄 Todo 自动补传**：FocusLink 启动后立即检查积压，并每 20 秒探测番茄 Todo；客户端可用时通过原生桥批量上传，服务器确认后才标记已同步。
- **番茄 Todo 持久补传**：待上传片段另存持久 ID 队列；本地写入、云桥上传、学科更新与删除共用串行锁，桥接瞬时失败后会回读真实记录确认客户端自动上传结果。
- **同步与删除互斥**：dida 后台队列、手动重同步和外部删除进入同一排他区；外部记录确认清理前不删除本地数据，避免竞态产生孤儿记录。
- **设置与退出修复**：局部设置更新改为深合并，切换任务来源不再覆盖其他设置；窗口退出 IPC 改为真正退出应用，不再被托盘隐藏逻辑拦截。
- **连接与同步界面重构**：任务来源和同步模式改为清晰的卡片选择；CLI 可用状态、真实入口和高级诊断分层展示，数据库路径等低频配置折叠到高级区域。
- **历史账本更新**：默认显示近 7 天，放大统计和会话列表，保留片段、暂停、任务归属、学科、云同步、补同步、导出与删除能力。

## v0.5.3 - 2026-07-10（六科自动匹配 · 专注账本收敛）

- **滴答 CLI 启动链修复**：安装版和开机启动不再依赖终端 PATH；自动解析用户 npm 目录与 dida 的真实 Node 入口，手动 executable 仍保持最高优先级。
- **云端专注时长修正**：`dida focus create` 使用紧凑有效区间（`end-start=activeElapsedMs`）且不传 `--pause-duration`，避免长暂停放大云端跨度；marker 命中但时长错误的旧记录会安全替换并收敛重复项。
- **同步队列限流保护**：后台改为单飞、小批量串行处理；遇到 `429 / exceed_query_limit` 不消耗永久重试次数，并按 1–15 分钟指数退避。
- **番茄 To-do 真云同步**：运行中通过原生桥接批量调用 `cloudSyncUploadRecord`，只有服务器确认后才标记 `isSynced=1`；未运行时保留为本地待上传，界面不再把写 JSON 误报为云端成功。
- **外部数据迁移幂等**：新版 PCRecord 写入独立迁移标记；便携版、全新配置和重复启动不会再把已经真实上云的历史记录重置为待同步。
- **默认板块迁移**：未识别内容统一归入“学习”，旧版兜底值与带 FocusLink marker 的旧记录会定向迁移，不触碰用户其他记录。
- **番茄 To-do 自动分类**：专注结束后会按任务标题、正文和标签自动匹配语文、数学、英语、物理、化学、生物；未识别时才使用设置中的兜底分类。
- **一键手动纠正**：历史时间线显示“自动匹配 / 已手动调整 / 未识别”来源；点六个学科之一即可覆盖，支持“恢复自动”。
- **手动修改会回写**：已同步的番茄 To-do PCRecord 会原位更新学科，不会被 marker 去重逻辑跳过；删除本地片段即使关闭同步开关也会继续清理旧记录。
- **前端整体重构**：主界面收敛为 timer-first 工作台，任务改为按需抽屉，历史回归紧凑时间账本，设置按任务来源/同步/窗口分区，移除冗余统计大卡与重复入口。
- **写盘可靠性**：番茄 To-do 本地库改为 fsync 后同目录原子替换，并保留独立备份。

## v0.5.2 - 2026-07-09（番茄 Todo 手动学科分类 · 交互瘦身迭代）

- **学科设置提速**：历史记录里的番茄 Todo 学科由笨重下拉改成快速点选，小步操作更顺手。
- **批量套用**：会话详情新增学科速设工具栏，支持“只补未设”与“覆盖全部”两种批量模式。
- **默认学科回退可见**：片段现在明确区分“已单独设置”与“跟随默认”，并且可以一键恢复跟随默认。
- **状态提示更清楚**：会话操作栏会提示还有多少片段仍在跟随默认学科，减少漏设。
- **内部逻辑瘦身**：补上批量设置 IPC / DB 通道，局部状态改成更直接的乐观更新，减少历史面板里的重复逻辑。

## v0.5.1 - 2026-07-09（番茄 Todo 手动学科分类 · 内测集成第一版）

- **番茄 Todo 同步**：专注结束后，自动将专注记录按学科分类写入番茄 Todo 本地库（`tomatodo_db.json`），独立并行通道，不影响滴答同步。
- **手动学科选择**：历史记录每个专注片段行内嵌学科选择器（语文/数学/英语/物理/化学/生物/学习），一键切换，操作快速简单。
- **Marker 去重**：每条 PCRecord 的 `s1` 字段存储 `[FocusLink:tomatodo:segment:<id>]` 稳定标记，重复同步自动跳过。
- **删除联动**：删除 FocusLink 专注片段/会话时，自动清理番茄 Todo 中对应的 PCRecord。
- **设置面板**：番茄 Todo 开关 + 数据库路径 + 兜底学科选择。
- **DB 迁移**：`focus_segments` 新增 `tomatodo_subject` 列，自动迁移。
- typecheck + 92 测试通过，真实库 schema 验证通过。

## v0.3.11 - 2026-07-06（极光剧场 · Step 12：数字翻转 + 丝滑页面过渡 + 卡片悬浮）

- **FlipDigits 数字翻转组件**：每位数字独立追踪变化，仅变化的位触发 scale + opacity + blur 微翻转动画，60fps 合成器属性，不触发 layout。
- **计时器数字翻转**：主计时器 60px 巨型数字集成 FlipDigits，秒数变化时仅最后一位翻转。
- **小窗数字翻转**：折叠模式 26px + 展开模式 38px 时间显示均集成 FlipDigits。
- **页面过渡升级**：从线性 duration 过渡改为 spring 物理曲线（stiffness: 380, damping: 38, mass: 0.9），加入 scale 微变化营造深度感。
- **任务抽屉精进**：spring 参数调优（stiffness: 460, damping: 42），加入 opacity 过渡 + GPU 加速。
- **动效令牌扩展**：新增 `--motion-instant`(80ms)、`--motion-spring`(460ms)、`--ease-spring`、`--ease-out-quart`、`--ease-out-expo`、`--ease-in-out-quart` 6 个物理曲线变量。
- **列表交错入场**：新增 `motion-list-enter` 动画类，任务/历史记录依次滑入。
- **卡片悬浮微动**：新增 `motion-card-float` 类，历史面板 3 处卡片 hover 时上浮 2px + accent 辉光。
- **侧轨标签过渡**：hover 标签从 duration-150 改为 `--motion-fast` + `--ease-spring` spring 曲线。
- **reduced-motion 完整支持**：所有新增动画类均加入 `prefers-reduced-motion` 守卫。
- typecheck + 59 测试通过。

## v0.3.10 - 2026-07-06（极光剧场 · Step 11：超丝滑动效引擎 + 图标系统全面迁移）

- **Motion Engine v2**：新增 15+ 动画工具类，覆盖数字翻转、磁吸悬停、光泽扫过、交错入场、文字渐显、状态点呼吸等高帧率微交互。
- **性能隔离**：`contain: layout style paint` 应用于卡片/小窗/时间线卡片，`content-visibility: auto` 跳过离屏渲染。
- **图标系统 v2**：Icon 组件新增 `hover` 和 `spin` 属性，支持悬停微动效和加载旋转；新增 20+ 图标（Loader、BarChart、LogOut、Stethoscope、ListChecks、ListTree、Layers3、Sparkles、Gauge、Lock、Unlock、Wifi、Bell、Power 等）；新增 Spinner 组件。
- **全量图标迁移**：HistoryPanel、SettingsPanel、TaskPanel、TaskPicker、Toast 全部从 lucide-react 原始导入迁移到统一 Icon 系统，100% 覆盖。
- **按钮光泽扫过**：主按钮/专注按钮/暂停按钮新增 `btn-shine` 光泽扫过效果，hover 时一道光从左到右流过。
- **磁吸悬停**：计时器主按钮使用 `motion-magnetic`，hover 时 `scale(1.03)` + spring 曲线弹性放大。
- **时间线增强**：卡片新增 `motion-hover-expand`（hover 放大 + 上浮）+ `scroll-snap-item`（滚动捕捉对齐）+ `perf-contain`（性能隔离）。
- **主题平滑过渡**：根元素添加 `theme-transition`，深色/浅色切换时颜色交叉淡入而非突变。
- **焦点环动画**：侧轨按钮新增 `motion-focus-ring`，键盘焦点时辉光环呼吸动画。
- **小窗按钮增强**：mini-icon-button 新增 `scale(1.08)` hover + `scale(0.92)` active 弹性反馈。
- **状态点呼吸**：计时器运行状态点使用 `motion-dot-breathe`，比 ping 更精致的呼吸效果。
- **Toast 弹性入场**：toast 动画从线性过渡改为 spring 物理曲线（stiffness: 420, damping: 32）。
- typecheck + 59 测试通过。

## v0.3.9 - 2026-07-06（极光剧场 · Step 10：组件精进 - Linear 级精致度）

- **按钮系统精进**：阴影从 12px 降到 8px（更克制），hover 时阴影加深（有层次），按压 `scale(0.97)` 替代 `translateY`。
- **按钮 hover 态**：主按钮/专注/暂停按钮 hover 时阴影 + 亮度同步变化，视觉反馈更丰富。
- **outline 按钮**：hover 时背景 + 边框同步变化，独立 hover 态取代 Tailwind hover。
- **卡片精进**：backdrop-blur 从 12px 加到 16px + saturate(1.2)，玻璃感更强。
- **输入框精进**：hover 态边框加深，背景透明度降低更融入画布。
- **任务行精进**：hover 时 `translateY(-1px)` 微抬升 + 阴影加深，有浮起感。
- **侧轨按钮精进**：hover 时 `translateX(2px) scale(1.04)` 弹性放大，按压 `scale(0.95)`。
- 所有组件过渡曲线统一为 `--ease-out-quart`，节奏更精致。
- typecheck + 59 测试通过。

## v0.3.8 - 2026-07-06（极光剧场 · Step 9：动效系统重做 - 丝滑高帧率）

- **GPU 加速**：新增 `.motion-gpu` 工具类，`will-change: transform, opacity` + `translateZ(0)` 强制独立合成层，确保 60-120fps。
- **spring 物理曲线**：新增 `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)` 模拟弹性，比传统 cubic-bezier 更自然。
- **quart/expo 缓动**：新增 `--ease-out-quart`/`--ease-out-expo`/`--ease-in-out-quart`，更精致的减速曲线。
- **动效节奏精进**：五档时间——instant(80ms)/fast(120ms)/normal(200ms)/slow(320ms)/spring(460ms)。
- **按钮按压**：`.motion-press:active` 从 `translateY(1px)` 改为 `scale(0.97)`，更有物理弹性感。
- **悬停抬升**：`.motion-lift:hover` 位移从 -2px 加到 -3px，弹性更明显。
- **spring 入场**：新增 `.motion-spring-in` 动画，scale+translateY 弹性入场。
- **任务抽屉**：弹簧参数调优 `stiffness: 420, damping: 40, mass: 0.9`，更丝滑。
- **页面切换**：缓动从 `cubic-bezier(0.22,1,0.36,1)` 改为 `cubic-bezier(0.16,1,0.3,1)`（expo），时长 0.22→0.28s 更从容。
- 所有 `will-change` 在 `prefers-reduced-motion` 下降级为 `auto`。
- typecheck + 59 测试通过。

## v0.3.7 - 2026-07-06（极光剧场 · Step 8：图标系统重构）

- **统一图标包装器**：新增 `src/components/Icon.tsx`，用 `createIcon` HOC 包装 60+ 个 lucide 图标。
- **自适应描边**：根据图标尺寸自动调整 `strokeWidth`——xs（12px）用 2.25 粗描边保证可读，xl（22px）用 1.5 细描边保证精致。
- **五档尺寸**：xs/sm/md/lg/xl 统一光学尺寸，告别散乱的 `size={13}`/`size={15}`/`size={18}`。
- **语义色调**：`tone` prop 快捷映射（accent/success/warning/danger/info/muted/subtle/default）。
- **全组件迁移**：App.tsx、TimerPanel、SegmentTimeline、MiniWindow 所有图标全部迁移到 Icon 系统。
- typecheck + 59 测试通过。

## v0.3.6 - 2026-07-06（极光剧场 · Step 7：设计令牌精进 - 融合 Linear/VoltAgent）

> 参考 [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) 中 Linear 与 VoltAgent 的设计文档，将令牌精度提升到工业级。

- **深色画布加深**：`--app-bg` 从 `#090b10` 加深到 `#060810`（近纯黑，带极淡蓝调），更接近 Linear 的 `#010102` 近黑画布。
- **表面阶梯精修**：四步表面阶梯（canvas→surface→surface-2→elevated）层级更均匀，靠表面提升而非阴影分层（Linear 风格）。
- **发丝边框系统**：边框色降低对比度（`#20262e`→`#1a1f28`），更接近 Linear 的 hairline 边框，精密克制。
- **极光环境光降强**：三层径向渐变透明度降低（0.14→0.1），更克制不喧宾夺主。
- **阴影系统精简**：深色画布上几乎不用投影，阴影强度降低，靠表面阶梯 + 发丝边框分层。
- **浅色模式同步精修**：背景更冷调（#f6f7f9），文字更黑（#1c2028），边框更细。
- **字体特性增强**：Manrope 启用 `cv11`/`ss01` OpenType 特性，`text-rendering: optimizeLegibility`。
- **新增 eyebrow 工具类**：`.eyebrow`（Linear 风格大写正字距）+ `.eyebrow-mono`（VoltAgent 风格等宽大写）。
- typecheck + 59 测试通过。

## v0.3.5 - 2026-07-05（极光剧场 · Step 6：历史 + 设置面板适配）

- **历史面板标题**：`历史记录` 标题改用 `font-display`（Sora）+ text-xl font-bold，与新设计语言一致。
- **历史记录计数**：记录计数徽章改用 `rounded-lg` + `bg-bg-card/60` + `backdrop-blur-sm`，更精致。
- **设置面板标题**：`设置` 标题改用 `font-display` + text-xl font-bold。
- **设置 Tab 栏**：Tab 容器圆角加大到 `rounded-xl`，边框/背景透明度调低，与极光画布融合。
- 两面板的卡片、按钮、输入框、任务行等通过 v0.3.0 的 CSS 令牌更新自动获得新视觉（圆角加大、辉光阴影、新配色）。
- typecheck + 59 测试通过。

## v0.3.4 - 2026-07-05（极光剧场 · Step 5：小窗深度重构）

- **收起态时间胶囊**：COLLAPSED 模式重构为「时间胶囊」——状态行 / 巨型时间 / 累计三段式，时间 26px 居中成为绝对主角。
- **展开态专注甲板**：EXPANDED 模式重构为「专注甲板」——时间增大到 38px，带状态色文字辉光阴影。
- **辉光阴影**：running 态时间带 success 色 28px 文字辉光，paused 态带 warning 色辉光，强化状态感知。
- **布局精简**：展开态移除冗余的 5 列统计 grid，改为「时间 + 双累计卡 + 总历时 + 控制」的清晰四层结构。
- **累计统计竖排**：累计专注/暂停改为右侧竖排两个 MiniStat 卡片，与左侧大时间形成主次对比。
- **底部控制行**：总历时移至左下角，控制按钮移至右下角，空间利用更均衡。
- 保留全部小窗逻辑（固定尺寸、主题同步、事件监听、拖拽、收起/展开）不变。
- typecheck + 59 测试通过。

## v0.3.3 - 2026-07-05（极光剧场 · Step 4：时间码头水平化 + 任务面板适配）

- **片段时间线水平化**：SegmentTimeline 从竖向列表彻底重构为水平滚动「时间码头」，每个片段为 150px 固定宽卡片。
- **时间码头卡片**：顶部状态色条 + 节点圆点 + 序号 + 时长 + 标题 + 起止时间 + 滴答关联标记，信息密度适配横向布局。
- **自动滚动**：新增片段时自动平滑滚动到最右（最新条目）。
- **选中合并**：保留点击选中合并能力，选中态右上角显示 success 角标。
- **水平连接线**：穿过所有节点圆点的水平基线，强化「码头」序列感。
- **空状态**：改为单行内联提示，不再占据大块空间。
- 任务面板（抽屉内）沿用更新后的 `.task-row` / `.task-metric` 样式，圆角与辉光与新设计语言一致。
- typecheck + 59 测试通过。

## v0.3.2 - 2026-07-05（极光剧场 · Step 3：计时舞台重构）

- **巨型弧光环**：新增 `ArcRing` 组件，280px SVG 圆环显示分钟节奏进度（0-60s），专注态绿色辉光弧、暂停态橙色辉光弧。
- **中央时间舞台**：60px JetBrains Mono 巨型数字置于弧光环中央，running 时带 success 色文字辉光阴影。
- **辉光滤镜**：弧光环使用 `feGaussianBlur` + `feMerge` 实现 SVG 辉光滤镜，外圈装饰刻度环增强精密感。
- **呼吸辉光**：running 态弧光环外圈有 3s 循环的 radial-gradient 呼吸辉光。
- **统计胶囊化**：累计专注/暂停/总历时从底部三栏 grid 改为水平胶囊行（`StatPill`），带图标 + 色调。
- **状态徽章重设计**：`StateBadge` 改为 pill 样式，running 态有 ping 脉冲圆点。
- **任务上下文条**：保持上下分离条样式，状态色随计时态切换（running=success、paused=warning）。
- 保留全部计时逻辑（useDisplayValues、handleToggle、handleStop、关联/清除/预选等）不变。
- typecheck + 59 测试通过。

## v0.3.1 - 2026-07-05（极光剧场 · Step 2：主窗口骨架重构）

- **拆除左右分栏**：彻底移除 v0.2 的「左计时 + 分割线 + 右任务」三段式布局。
- **新增侧轨导航**：56px 垂直侧轨取代顶部水平 nav，含品牌标识、计时/历史/设置导航、任务召唤按钮、窗口控制。
- **侧轨按钮**：悬停弹出文字标签，激活态左侧辉光指示条，导航从水平胶囊变为垂直图标。
- **任务抽屉化**：TaskPanel 不再常驻右栏，改为从右侧滑入的召唤式抽屉（380px），带 scrim 遮罩与弹簧动画。
- **极光画布**：主舞台背景根据计时状态切换——running 泛冷绿辉光、paused 泛暖橙辉光、idle 极光环境光。
- **计时舞台居中**：TimerPanel 居中展示（max-w-640），SegmentTimeline 贴底，视觉重心集中在中央。
- TaskPanel 新增 `inDrawer` prop，抽屉模式下增加内边距。
- typecheck + 59 测试通过。

## v0.3.0 - 2026-07-05（极光剧场 · Step 1：设计系统地基）

> 本版本开启 v0.3「极光剧场」深度重构系列，目标是建立与 v0.2 完全不同的视觉语言。

- 当时新增“极光剧场”设计语言；其仍有效的经验现已归并到 `frontend-design/FRONTEND_SPEC.md`，旧概念文件不再单独维护。
- 字体系统全面替换：Inter → Manrope（正文）+ Sora（展示标题）+ JetBrains Mono（计时数字），禁用通用字体。
- 色彩令牌重写：深色模式从「Notion 暖纸面」转为「近黑深蓝画布」(#090b10)，主色改为靛蓝辉光 (#818cf8)。
- 新增「极光环境光」三层径向渐变系统（`--aurora-1/2/3`），专注态泛冷绿、暂停态泛暖橙。
- 圆角加大：卡片 22px、按钮 14px、小窗 24px，营造更柔软悬浮感。
- 主题色变体全部调整为高饱和度辉光色，深色画布上具备发光感。
- 新增 `.aurora-canvas` / `.side-rail` / `.rail-btn` / `.font-display` / `.arc-rotate` 等 v0.3 布局基础类。
- 沿用 v0.2 动效节奏（120/180/260ms）与 reduced-motion 降级，保证体感一致。

## v0.2.29 - 2026-07-05

- 执行 `npx getdesign@latest add notion`，保留 `notion/DESIGN.md` 作为原始 Notion 设计参考。
- 更新前端交接规范，明确 FocusLink 只吸收暖纸面、轻边框、字体层级和克制阴影，不改成 Notion 产品或营销页。
- 修复统一计时 selector：小窗和其他入口在没有当前片段标题时会回退到本次默认任务，避免有默认任务却显示“未关联任务”。
- 小窗 `finished` 状态点击开始会先 reset 再启动，与主界面“开始新专注”逻辑保持一致。
- 小窗主按钮按状态使用语义色：开始/继续为绿色，暂停为橙色。

## v0.2.28 - 2026-07-05

- 重构计时区主卡的信息层级：把任务上下文移入主计时卡，当前片段/默认任务/预选任务一眼可见。
- 主操作按钮按语义色区分：开始、继续、开始新专注使用绿色，暂停使用橙色，避免和导航蓝混淆。
- 修复结束后的交互坑：`finished` 状态点击“开始新专注”会先 reset 再启动，不再调用无效 toggle。
- 修复 finished 状态预选任务会被立即清空的问题，结束后也可以先选任务再开始下一轮。
- 时间线专注片段统一使用绿色，暂停片段继续使用橙色，滴答关联 chip 保持蓝色结构语义。

## v0.2.27 - 2026-07-05

- 将全局 UI tokens 进一步落到 Notion 风格：暖纸面背景、细灰边框、蓝色结构主色，保留绿色专注和橙色暂停语义。
- 重做应用图标、托盘图标和 favicon：纸面卡片、焦点环、任务连接节点、小色块刻度统一成 FocusLink 品牌符号。
- 主窗口左上角 `BrandMark` 从通用 Activity 图标改为自绘 FocusLink 标志，与安装包图标保持一致。
- 托盘图标改为按状态生成：未开始、专注中、暂停、结束有不同颜色反馈。
- 调整计时页与小窗运行态颜色，避免结构蓝和专注绿混用。

## v0.2.26 - 2026-07-05

- 修复 dida CLI 同步成功但云端任务看不到记录的问题：稳定路径改为优先写任务评论，失败时不再误标为已同步。
- 修复历史记录折叠态关联状态：折叠行使用片段摘要，不再把“没有默认任务”显示成“未关联”。
- 统一同步状态用词：使用“已同步 / 未同步 / 同步失败”，移除“可同步 / 已入队”等模糊状态。
- 继续打磨专注小窗：固定两态布局，优化透明圆角、统计卡密度和展开信息层级。
- 更新项目交接规范，补充后续 AI 需要遵守的同步、文案、小窗和目录边界。
