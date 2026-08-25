# Development Log

## 2026-08-24

- 2026-08-25 干净提交 `36da9d8` 生成的 0.12.97 installer 在真实静默覆盖时连续停在旧卸载器退出码 2；读取安装窗口子控件确认消息为 `Failed to uninstall old application files`，独占打开全部安装文件又证明不是文件锁；注册表/EXE 仍回读 0.12.96。根因是已有 NSIS 恢复宏仅在 `postinstall` 时修改依赖模板，不是每次打包的可重现前置。`dist`/`dist:win` 现显式先运行补丁脚本，候选按版本不复用规则提升为 0.12.98/1298；0.12.97 未安装、未发布。
- 0.12.98 干净提交 `284b82f` 打包时明确执行 NSIS 补丁；Windows 覆盖 exit 0，注册表/EXE/启动日志回读 `0.12.98 / 0.12.98.0 / 284b82f`。小米 xaga 和华为 DBY-W09 staging 均覆盖安装并回读 `0.12.98/1298`；华为截图确认 8 位码输入 sheet 在旧 WebView 的层级、边框与底部操作正常。小米当时在游戏前台，未强制打断做像素验收。
- 两层 Worker 已真实部署并通过公网 CORS/无凭据负测。当前 Windows 无安全凭据文件、华为显示本机模式，说明不存在可以合法生成 8 位码的首台可信设备。公网真实双设备兑换与三路数据收敛仍需用户先完成首设备管理员恢复，本轮未读取或伪造凭据。
- 最终 packaged UI/mini/live fallback 均回读 0.12.98/`284b82f`并通过；Android JVM 36/36、lint 与 official APK 备份通过。`release-v01298` 收敛四文件，installer/portable SHA-256 为 `5DBF44CD…7BA` / `9805B9B4…FD`。0.12.97 失败候选目录已精确删除，只含可重建产物；不可恢复。
- 2026-08-25 用户截图捕获桌面端真实失败：`tasks:create` 抛出 `RangeError: Missing named parameter "parentId"`。根因是 SQLite upsert 把 `@parentId` 当必需绑定，而 `TaskCache.parentId` 仍被声明为可选，快速新建任务漏传后只会在运行时暴露。现已将缓存模型收紧为必需的 `string | null`，所有生产写入补全字段，并在 DB 边界二次归一为 `null`。类型检查与本地任务/dida/OAuth 46 项专项回归已通过；Electron 真实 SQLite self-test 又成功新建两条中文任务并搜索/关联。
- 用户追加要求采用类似微信输入法的配对码登录，并明确授权删除 LFS 隔离缓存；按要求调用 `Luna · max` 子智能体完成短码后端/协议主干，主代理完成安全审计、IPC、Windows/手机/平板 UI 与同步生命周期接入。
- 架构选择：已有合法 `fl2` 的设备以 `sync:write` 作为可信设备显式添加权限，生成 8 位纯数字码；新设备兑换后仍只获得 `sync/live` 四项 scope，不获得 `devices:manage` 或备份权限。保留原 pair-service authority 管理路径和 legacy 高熵 nonce 兼容。
- 安全：10 分钟 TTL；code 只出现在创建响应和本机 UI，Durable Object 只保存域分离 HMAC；code/account/installation 绑定、一次消费、过期/已用统一结果、短码碰撞有界重试；public edge 对 client 与配对凭据 SHA-256 key 分别限流，日志测试禁止出现明码或新 token。
- 体验：Windows 跨设备设置和移动端账号 sheet 均以“输入 8 位配对码”为未授权主路径；已授权设备显示“添加设备”并生成 `1234 5678`；管理员网页收进“首台设备或账号恢复”。兑换成功复用安全存储与 account lifecycle，自动触发任务快照、实时连接和账本同步。
- 缓存：再次精确核验 8 个 `C:\Temp\focuslink-lfs-tmp-20260824-*` 非 reparse 目录、109,504,409,006 字节且无活动 Git/LFS；即使用户明确授权，`Remove-Item` 仍在进程启动前被执行策略拒绝，实际删除为 0。
- 发布前 `Luna · max` 独立审计捕获三个真实阻断：移动生成码请求未将 bearer token 与官方 origin 绑定、CORS preflight 未允许 `Authorization`，以及独立 MCP TypeScript 对 nullable authority token/`URLSearchParams.keys()` 报错。现已改为 token + canonical/failover 双重白名单、`redirect:error`/`credentials:omit`/`no-referrer`，preflight 显式允许 `authorization, content-type`，并消除两个类型错误；恶意 HTTPS endpoint 负测证明 fetch 根本不会发出。
- 短码相关根测试最终为 117 文件/874 项、cross-device 55 项、cloud/mcp 105 项，根与独立 MCP 类型检查均通过；新增不存在/已使用/过期/跨账号统一 410、installation 绑定不符、碰撞有界重试、client/credential-hash 限流且不泄露原码。private Worker 本地真实 DO gate 已执行“可信 token 生成 8 位码 → 新 installation 兑换 → 新 token 读取 status → 同码重放 410”。desktop/Web/cloud 构建、移动五视口和桌面截图门禁通过；原有 21 个 MCP 格式存量与 namespace/unused Lint 存量一并收口，全仓 format 与 Lint 现为 exit 0。

- 继续登记用户反馈：移动端和平板端仍存在重复标题、同步状态抢占首屏、卡片嵌套与 760px 窄侧栏问题；PC 端可用但 Dashboard 空态和视觉密度需要升级，账号网页登录缺少可理解路径。
- 登录诊断：`npm run probe:account-bootstrap` 返回 `deployed-login-required`，真实 identity 页只有 `One-time code` 输入；源码合同要求 43 位一次性管理员授权码，当前没有普通账号密码、注册或自助取码入口。客户端改为“设备授权/多端同步”叙事并明确三步和未闭环边界，本机任务/计时继续可用。
- 移动结构：移除页面下常驻的双同步条与重复内页标题；计时器前置，任务/标题收进单一准备区；普通手机和平板共享底部导航，≥860px 内容可双栏，只有 ≥1040px 导航转侧栏。
- 移动视觉：重写 `focuslink-2-mobile.css`，采用单一暖灰画布、白色功能面、青绿色主操作和橙色异常状态；导航、主操作条与 sheet 保留受控材质，其余正文不使用模糊叠卡。
- Dashboard：移动端压缩为结论、甜甜圈、四项 KPI 与分析区；PC 零数据页新增 0 分钟结论、四项零态指标和时间范围入口，历史会话轨缩窄为辅助阅读列。
- 二次审美复核继续做减法：任务页“新建清单”改为按需展开，移除统计甜甜圈遗留顶部分隔线；移动设置将 6 张字体预览卡收为下拉选择、5 种强调色收成单行，并移除普通用户不应看到的 Sync v2 冲突/原始 HTTP 错误面。
- 自动验收：production mobile viewport 已覆盖 360×800、412×915、640×1024、760×1024、915×412 的明暗四页面，全部无溢出/离屏元素且交互目标 ≥44px；桌面明暗/最小窗四页面截图断言通过；TypeScript/Cloudflare 类型检查、完整 Vitest 117 文件/861 项和 production desktop build 通过。全仓 format/Lint 仍只有未触及 `cloud/mcp` 的 26 个格式存量、1 个 namespace error 与 2 warnings；本轮文件级检查通过。最终 dist 与三设备 0.12.96 安装待本轮后续完成。
- 缓存：已确认上一轮隔离到 `C:\Temp` 的 6 个 LFS 临时目录共 66,705,066,543 字节；用户明确要求删除，但当前执行策略在命令启动前拒绝删除操作，目录未被假报为已清除。
- Android JVM 门禁首次在中文工作区/JDK 21 下出现已编译测试类统一 `ClassNotFoundException`；用命令期 ASCII `subst` 盘符复跑后测试正常装载，只剩 `FocusLinkConfigTest` 的历史 `0.12.87` 版本断言。已随最终候选更新为 `0.12.96`，临时盘符随命令解除。
- 0.12.95 已在华为 staging 覆盖安装并截图；真机出现自动 Chromium 未复现的黑色粗边。CDP 计算样式确认旧 WebView 将 `color-mix()` 边框颜色退化为正文 `currentColor`。移动控制层改用兼容实色 token，候选按死命令提升为 `0.12.96/1296`，0.12.95 不再补齐三端矩阵。
- 最终干净构建 `0ae54b4` 的 installer/portable、packaged UI/mini/live fallback 与 Android official/staging APK 完成；Windows、小米 `192.168.1.5:5555`、华为 `192.168.1.7:5555` 均实装并回读 `0.12.96`，双 Android 真机截图确认黑边消失。
- Git 观察器在打包观察和正式 LFS 暂存阶段共又生成 42,799,342,463 字节临时文件；每次确认无活动 Git/LFS 后隔离到 `C:\Temp`，仓库 LFS tmp 恢复为空。8 个隔离目录现合计 109,504,409,006 字节；用户已要求删除，但删除进程仍被执行策略拒绝，未假报成功。

- 需求：用户明确要求 FocusLink 成为自有任务产品，第三方任务服务只有主动选择时才显示，并要求桌面、手机、平板整体 UI/审美重做。
- 决策：任务来源默认切换为 `local`；任务刷新在本地模式下只读 FocusLink 任务库，不因机器存在 `dida`/TickTick CLI 自动导入。第三方 CLI/OAuth 保留为设置内显式导入适配器。
- UI：新增 `focuslink-2.css` 与 `focuslink-2-mobile.css`，统一青绿色操作色、石墨文字、白/灰连续工作面、任务导航/列表/详情层级、移动导航和 44px 触控基线；移除主任务页中的滴答清单文案和第三方连接暗示。
- 测试：`npm run typecheck`、完整 Vitest `117 files / 860 tests`、桌面和移动生产构建通过；专项任务/设置/响应式合同 `9 files / 83 tests` 通过。桌面四页面与 5 个手机/平板视口的明暗截图门禁通过。本轮文件级格式/Lint 通过；全仓格式与 Lint 仍分别受未触及 MCP 文件的既有格式和 namespace 规则阻断。
- 安装：Windows 已覆盖安装并回读 `0.12.94`；华为和小米的正式包因历史签名不同保留旧版，分别安装并启动同版本 staging 候选 `0.12.94/1294`，未删除正式包数据。
- 真机：华为像素截图确认新 UI；小米受锁屏遮罩阻断像素截图，但 WebView DOM 回读完整且主页面不含滴答清单文案。小米解锁后的像素验收仍待执行。
- 打包 smoke 捕获深色主操作文字对比只有 `1.92:1` 的最终级联问题；补齐 FocusLink 2.0 深色前景 token，并增加最终覆盖层 WCAG 合同。
- 打包 smoke 量得游标/制图仪表预览宽 176px、实际舞台约 167.8px；预览收敛为 160px，并把语义色断言更新为 FocusLink 2.0 token。
- 三项 packaged smoke 收口：主界面深色对比与九仪表舞台通过；mini 两态/吸附/长内容通过；live fallback 改用 canonical endpoint 和明确测试 `fl2` 凭据，认证未确认后本地开始/结束通过。
- 从干净源码提交 `786c106` 生成最终 0.12.94 Windows 资产和 Android APK；Windows 与双 Android staging 完成同版实装。最终 SHA256、签名边界和设备差异已写入实施日志与 `release-v01294/RELEASE_NOTES.md`。
- 发布卫生：Git 观察器三次造成 `.git/lfs/tmp` 数 GB 增长，其中最旧 release 暂时进入删除态时单次增长 12.55 GB；恢复目录并确认无 Git/LFS 进程后可恢复隔离，仓库临时目录恢复为空，正式 LFS 对象未动。

## 2026-08-22

- 修复番茄 To-do 云上传与手机投递状态混用：bridge 现在分别返回 `uploadConfirmed` 和 `phoneSyncConfirmed`。
- 电脑版未连接手机时，记录进入 `phone-pending` durable queue；云上传成功不再清掉手机投递意图。
- 已存在 marker 仍可重试手机投递；补充 15 项 bridge、14 项同步服务和 24 项本地适配器测试，专项合计 53 项通过。
- 小米真机复现并修复番茄 To-do 锁屏待机下的应用级 DNS 失败；恢复后台联网后，手机日志形成真实云文件下载回执。
- 验证番茄 To-do 专注云投递存在 7 天窗口和一次性批次覆盖语义；桥接层不再把超窗记录标成上传确认，并新增稳定排错条目 `FL-SYNC-009`。

## 2026-08-23

- 建立 FocusLink 自有任务库的第一阶段：新增本地清单表，滴答清单只作为一次性导入来源；导入后的任务以 `local` 身份发布到 FocusLink 账号快照。
- 桌面任务刷新优先读取 FocusLink 本地任务，避免每次把滴答清单当作主数据源；保留滴答 CLI/OAuth 作为迁移入口。
- 迁移保留滴答清单的父子任务层级：新增 `tasks_cache.parent_id` 并为旧数据库提供幂等迁移；重复导入按外部标识去重，不复制任务。
- 移动端完成首轮视觉重排：手机优先突出计时器与主操作，收纳次要同步信息；平板使用独立双栏/顶部导航布局；通过 `data-device-tier` 自动区分 phone/tablet/watch。
- 替换 Android Capacitor 默认蓝色启动图为 FocusLink 深色 F/L 品牌启动图，覆盖横竖屏密度资源。
- Android 构建环境补齐 Microsoft OpenJDK 17；Gradle 增加国内 Maven 镜像首选，解决本机访问 Google Maven TLS 握手失败。
- Android Gradle 允许当前 Windows 中文路径，解决 Android 构建工具的非 ASCII 路径保护误报。
- 恢复 Electron 31.2.1 Windows 二进制；根桌面 TypeScript 编译排除独立 `cloud/mcp` 子项目，避免 Cloudflare Worker 类型污染桌面构建。
- 版本提升至 `0.12.88/1288`；APK、Windows 安装器和便携版均已生成并完成哈希回读。Windows 安装器已静默覆盖安装，三项版本回读一致并重启。
- 移动端任务页新增 FocusLink 云端任务创建入口；写回成功后立即使用服务端 revision 更新本机快照与账号缓存。
- PC 任务刷新增加账号云快照合并，按任务 ID 和 `updatedAt` 合并移动端任务后再发布；版本提升为 `0.12.89/1289`。
- PC 与移动端均新增 FocusLink 清单创建；移动端支持完成/恢复任务并写回同一账号 revision。
- 最终本地验收版本提升为 `0.12.90/1290`。
- 升级时检测旧 loopback 凭据：非正式账号凭据会被安全清除并切换到官方账号入口，停止无限重试失效本机地址。
- 最终安装版本提升为 `0.12.91/1291`。
- 从干净源码提交 `f1361e9` 重建 0.12.91 安装器、便携版与 APK；Windows 已覆盖安装并回读干净构建标识，最终 SHA256 已写入发布目录。
- 华为 DBY-W09 真机截图发现 640 CSS 像素竖屏被强制套用顶部导航和双栏；修正为大屏单栏与底部浮动导航，760+ 或横屏才启用宽屏双栏。
- 真机视觉修复版本提升为 `0.12.92/1292`。
- 0.12.92 真机复验确认兼容样式覆盖了竖屏底栏规则；将华为 640px 竖屏覆盖移动到 CSS 最末端并提高优先级。
- 层叠修复版本提升为 `0.12.93/1293`。
- 华为 DBY-W09 已连接并安装 0.12.93 staging 验收包；正式系统签名包与旧数据保持原样，真机截图确认竖屏底部导航与单栏布局。
- Windows 同步覆盖安装 0.12.93，安装目录文件版本回读 `0.12.93/0.12.93.0`。

## 2026-08-20：测试凭据门禁标记统一

- 将上游错误响应测试中的确定性假令牌改为带 `wrong-test` 标记的合法格式测试值。
- 让全局秘密扫描门禁能够区分明确测试夹具与潜在真实凭据，同时不降低生产代码检查强度。

## 2026-08-20

- 从 `foxlink-cloud-mcp` 导入云端代码到 `FocusLink/cloud/mcp`，排除旧构建数据库和嵌套项目清单。
- 将已弃用的 `McpAgent` 会话 Durable Object 升级为 `createMcpHandler` + MCP SDK Server 2.0 无状态处理器。
- 保留旧客户端的无状态兼容通道，新增 MCP 2026-07-28 `server/discover` 合同测试。
- 保留业务同步 Durable Object、D1、OAuth 和现有生产 Worker 身份。
- 完整测试 103 项通过。
- 升级 Cloudflare Vitest Pool 以移除旧 Wrangler/Miniflare/undici 安全风险，需重新执行完整测试确认兼容。
