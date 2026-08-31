# Development Log

## 2026-08-31 · v1.3 移动端审计（实施中）

### 最终候选更正

- 早先记录的 `2aec11e`/`v012105` 与离线状态是中间候选；最终 1.3 产品源码为 `178959d`，桌面包和 APK 均已从该提交重建。
- 小米因历史正式包签名不同，使用同源码同签名 `app.focuslink.mobile.v012104` 原位覆盖；华为使用正式 `app.focuslink.mobile`。两台 Android 都回读 `1.3.0/1306`，Windows 回读 `1.3.0/1.3.0.0`，未卸载或清数据，三设备同版安装矩阵闭合。
- 小米完整功能验收与 44px 修复已通过；华为按用户指令只安装回读，不执行功能 smoke。最终桌面 installer/portable SHA256 为 `0EF29B9D…63DB` / `B1250D3C…DF5F`，APK 备份位于 `FocusLink/.tmp/android-apk-backups/`。
- 最终清理后 `release-v130` 恰为四文件，项目清理器 dry-run 候选 0，LFS tmp 0；正式与小米 APK 备份仍保留。

后续同日条目保留过程时间线；最终提交、安装矩阵、哈希和清理状态以上述更正为准。

- 用户确认 PC 与手机配对测试已成功；本轮保留现有配对凭据与任务数据，不重新配对、不清空业务数据库。
- 目标收敛为一个 `1.3` 体验批次（技术版本 `1.3.0`、Android `1306`）：移动设置/主题/字体真实预览、root 权限逐项回读、Dashboard 日期范围与 24 小时段详情、清单任务操作、桌面同源计时支架和三端视觉一致性。
- 中间计划（已被最终候选更正覆盖）：小米曾暂定使用 `app.focuslink.mobile.v012105`；签名审计后确认实际保留配对数据的是同签名 `app.focuslink.mobile.v012104`，因此最终按该包原位覆盖。
- 小米覆盖后出现“native Keystore 凭据仍在、renderer 显示未配对”。根因是三个移动入口只在首次 render 采样一次 Capacitor 插件可用性；现由独立能力探测连续覆盖约 15 秒并在回前台时重试，账号恢复代次则在组件创建时预留，显式账号操作始终优先。Android 的原生凭据读取、保存和清除在桥暂不可用时可取消并失败关闭，不再用空值冒充持久化成功；对应诊断固化为 `FL-SYNC-014`，Node 22 根测试 `1016/1016`，真机最终证据待正式 APK 覆盖后回填。
- Sol 子任务完成 Dashboard、设置/权限、任务/专注三条实现并由主任务合并审计。最终源码门禁为 129 files / 1016 tests，cross-device 71/71；五视口明暗四页通过，过程中修复任务清单目标和时间支架不足 44px、平板字体卡被旧双栏压窄三项真实回归。
- API 35 模拟器先安装并回读 `1.3.0/1306`；全量 instrumentation 的唯一失败是未授权 overlay 的人工截图保持用例，显式授权后同项 1/1 通过。最终 Android JVM/lint/assemble 通过，真实小米/华为仍因 ADB handshake 失败未安装。
- packaged portable smoke 首轮发现隐藏窗口 renderer 节流使翻牌/确认层过渡未收敛；最终 `178959d` 的 unpacked UI/mini/live fallback、portable startup/完整 UI 全部通过。
- Windows installer `/S` 已完成，注册表/EXE 回读 `1.3.0/1.3.0.0`，包内身份 `178959d`，SQLite quick check 正常且凭据文件保留，应用已重启。`release-v130` 为严格四文件；installer/portable SHA256 分别为 `0EF29B9D…63DB` / `B1250D3C…DF5F`，LFS tmp 保持 0。
- 项目清理器以 `--max-age-hours=0` 删除本轮 28 个生成目标：unpacked 隔离目录、smoke/startup 截图、selftest/test-data 与顶层 APK 副本全部清理，`failed=[]`，复查候选 0；受保护的最终 APK 备份和 device-screens 未动。
- 小米恢复在线后，按安装签名与原生凭据事实选择 `app.focuslink.mobile.v012104` 原位覆盖 1.3：自动恢复配对、实时连接、Dashboard 范围/时间段、临时清单任务完成恢复、短专注全流程与零残留清理均通过；KernelSU 只授权该包，四项可自动权限最终 readback 全 true。真实四页无横向溢出；顶部同步状态按钮修复后由 `178959d` APK 回读 `116.46×44`。
- 版本节流规则：同一 1.3 批次内的修复不重复抬版本号；历史 `0.12.x` 记录保留为历史事实，不改写成新版本证据。

## 2026-08-30

- 华为平板与 Windows 通过真实 8 位本机码完成 exchange/claim；任务快照、实时开始/暂停/继续/结束和 `2 segments + 1 pause` 已结束账本分别验收，所有临时清单、任务与会话均按精确 ID 清理。
- 修复移动端后台 5 秒刷新取消前台任务操作的问题：同账号任务/账本请求复用在途 Promise，账号切换继续强制失效。平板新增待办/已完成分段与恢复入口，真机在后台刷新并发下首击完成/恢复均成功。
- 设置页状态改为当前实时、账本新鲜度、任务 revision 和本机会话四项事实；番茄 To-do 的可上传队列与 223 条过期历史分开。平板字体/九仪表预览扩容并修正标准、制图预览裁切。
- ChatGPT Web 的 FocusLink 插件定义已刷新并完成 `focuslink:read + focuslink:write` OAuth；生产清单/循环任务真实创建、字段读回与删除清理均成功，不再保持 partial。
- Sol 独立审计补齐 MCP 9 个写 handler 到 authority mutation 的逐入口验证，并扩展 CLI 的清单/任务 list/get/update/filter、redirect、超大/非法响应和完整帮助门禁；公网部署状态文档改为实际版本 `3592ccde…`，认证态仍保持 partial。
- 同步设置截图新增实时/离线历史设备、陈旧/撤销设备、2 条可上传 + 223 条过期番茄记录和桥接失败夹具。新增父子几何断言后真实发现 360px 手机六种仪表预览裁切；改为容器居中与中心缩放后，标准仪表由右侧超出 65.5px 收敛为左右各 0.9px，360/412/640/760/915×412 明暗门禁全部通过。合并复验为根 `127 files / 987 tests`、MCP `11 files / 117 tests`，format/typecheck/lint 与 MCP source/test typecheck 全绿。
- 新 portable 首次 startup 因自解压冷启动超过旧 15 秒窗口而超时，UI smoke 首轮因 Framer Motion 过渡期间 `querySelector` 读到旧“暂停”按钮而在真实 `paused` 状态误失败。startup 等待扩到 60 秒并精确清理隔离 PID 树，UI smoke 改读最新主按钮并输出并存节点诊断；同一包重跑 startup 与完整 UI 均通过，原失败事实保留。
- 系统 Node 已变成 24.19.0，不符合项目 22.x 门禁；从 Node 官方发布站下载并校验 SHA256 的 22.22.2 仅用于项目临时构建，最终干净包身份为 `0.12.105 / edf0915`。Windows `/S` 与安装日志、华为正式包 CDP、华为 4+13 隔离合同、小米并行包均完成回读；正式 APK hash `83344053…442A`，installer/portable 为 `55EB71F7…43F4` / `B5714CF4…628D`。
- ChatGPT FocusLink OAuth 已修复旧 DCR scope 快照并成功连接，读工具回读生产 revision 78；写入在 ChatGPT 与独立短期 PKCE 客户端都被 authority 4xx 拒绝且零残留，重部署当前私有 Worker 后仍复现。为继续诊断，public MCP 将常见 400/403/404/405 拆成稳定脱敏错误码，其余 4xx 仅携带 HTTP 状态，仍不读取或透传上游正文、任务内容。
- 精确码确认写入失败为 HTTP 415：private Worker 将 MCP POST 转发到 Account DO 时漏掉 `Content-Type`，而 Account DO 明确要求 JSON。转发层现补回 `application/json; charset=utf-8`，并以 `ArrayBuffer` 转发可信内部正文，避免 ReadableStream duplex 差异；路由合同已覆盖。这也是此前 MCP 读取全绿但所有任务写入同时失败的根因。
- 修复后独立短期 PKCE 客户端从 revision `87→98` 完成 11 次清单/任务 CRUD、父子、颜色、优先级、日期、标签、循环、完成/恢复与移动，全部 `applied`，读回正确且零残留，临时令牌已撤销。ChatGPT Web 随后从 `98→102` 完成创建清单、创建循环任务、读回、删除任务和删除清单，四次写入全部 `applied`，zeroResidual=true。
- 最终只读审查补掉三个边界：账号切换期间旧 connection 请求禁止提交；CLI 的 200 响应体断流按同 operationId 重试；共享循环时间拒绝小数与 JS Date 上限外值。对应定向测试 41 项通过。
- 最终 source-only 源码 `e6dde4b` 已完成 installer/portable/APK 构建与三端安装；private/public Worker 更新、远端 19/19、packaged smoke、Windows 数据保留和番茄真实状态回读均通过。portable smoke 额外等待 native viewport 恢复并保留失败 DOM。ChatGPT 插件刷新仍保留为需用户确认的唯一外部动作。
- 继续沿用未闭合的 `0.12.105/1305` 候选，不为番茄/平板验收补修增加版本号。华为平板恢复在线并安装同版；隔离 9/9、解锁后 PiP 1/1 通过。
- 修复华为实机复现的本机专注假启动：无配对配置时不再清掉已创建的 offline runtime 快照，running/paused 可从 IndexedDB 恢复并继续控制。
- 修复番茄 To-do 队列误导：223 条失败全部超过外部 7 天窗口，当前临时记录真实上传成功。过期记录保留本机、不改日期、不伪报已同步，并从自动重试与上传按钮中移出；设置页显示过期历史数量。
- 将候选版本统一提升到 `0.12.105/1305`。新增结构化循环、开始时间、云端当前时间 MCP、清单详情与任务过滤；第一方 CLI 通过同一 Account DO CAS/幂等合同管理时间、清单和任务，并严格区分 device credential 与 OAuth token。
- 设置页和同步页降噪：实时连接、最近账本成功、历史尝试、设备 freshness、番茄本机/上传/桥接/手机显示分别表达；Dashboard 增加五时段、三轨累计和当前线；字体扩展为八套。修复桌面截图脚本误把通用 `.app-stage` 当页面就绪的假证据，改用页面专属根节点重拍。
- 阶段性门禁：format/typecheck/lint、根 `125 files / 943 tests`、MCP `114 tests`、生产 build、设置与 Dashboard 桌面/移动截图通过；部署、dist、packaged smoke 和三设备安装矩阵仍待回填。
- MCP adapter 小修：`task-scheduling-v1` 现在也转发到 `/sync/v2/tasks/mutate`，并明确不注入 live command；对应 exchange 合同测试已补齐。
- 桌面旧快照合并保护：0.12.104 task shape 缺少调度键时保留 SQLite 已有循环，只有新客户端显式 `null` 才清除。
- 移动任务完成的 operationId 改为基于设备/任务/动作/revision 的稳定指纹，响应丢失重试继续命中同一次 CAS 操作。
- 收紧 MCP/CLI 任务写入：CLI 瞬时失败以同一 operationId 有界重试，最终失败返回 operationId/revision 供安全续跑；CLI 与 MCP 在调用层拒绝越界优先级、日期、非法幂等键和伪造循环进度，循环结束时间不得早于当前任务日期。
- 修复 portable 沉浸退出阻塞：360ms 界面离场先完成并卸载，Windows native 全屏退出随后在下一事件循环执行，不让系统切换阻塞 renderer timer。
- 最终门禁：根 126/957、MCP 11/115、cross-device 6/63、Cloudflare 两阶段协议、Android unit/lint/assemble、unpacked/portable UI、mini、live fallback 通过；production audit 0。Worker 最终部署为 private `4fbf1576…`、public `77354996…`，远端 probe 19/19。
- 实装：Windows `0.12.105/0.12.105.0` 已覆盖并重启；小米并行包 `app.focuslink.mobile.v012105` 已回读 `0.12.105/1305`。华为平板 offline，三端门禁未闭合；生产 MCP 写入仍缺 OAuth access token。
- 追踪最终二进制生成元数据：`shared/version.generated.ts` 回读 `0.12.105 / cdce0cf`，与 installer/portable packaged smoke 身份一致。
- 修复临时数据清理入口：新增 `scripts/maintenance/clean-temp-data.mjs` 和 `npm run clean:temp-data`。默认 dry-run，`--apply` 才删除；仅处理回归/打包 fixture，保护当前 APK 备份、设备截图、应用资料、SQLite、凭据和待补传队列。路径检查拒绝根目录/符号链接，Windows 锁冲突和只读属性做有界重试并回读删除后置条件。
- 两轮实清理共删除 129 个目标、12,178 个文件、3,691 个目录、`127,294,493,385 B` 逻辑大小，均 `failed=[]`，最终零候选；`.git/lfs/tmp=0`。首轮回读 FocusLink 仍有 5 个进程，最终审计为 0，期间未发出进程终止或应用退出命令；SQLite `quick_check=ok` 且 sessions/segments/pauses/两类队列计数清理前后一致。
- format、根 typecheck（含 Cloudflare）、Lint 和全量 Vitest `123 files / 919 tests` 通过；清理器定向回归为 `4/4`。

## 2026-08-29

- 接管前代理留下的 FocusLink 任务快照/清单改动，修复普通清单删除：PC 与移动端先确认，收件箱不可删除，任务及子树迁入收件箱；桌面 SQLite 迁移与删除清单同事务，发布前不合并旧云快照，未确认时回滚。
- 完成 `foxlink-cloud-mcp` 第一方任务面：`focuslink_list_projects`、`focuslink_list_tasks`、`focuslink_get_task` 与清单/任务创建、更新、完成、恢复、删除、移动。字段覆盖截止时间、优先级、标签、父子关系；Account DO `task_state` + `task_operations` 以 `operationId`/`expectedRevision` 做原子 CAS/幂等，冲突不覆盖并只返回脱敏确认。
- 新增 `/sync/v2/tasks/mutate` canonical 转发和 `focuslink:write` scope（写调用要求与 read 组合），保持旧完整快照客户端和 MCP 2026-07-28 discovery 兼容；D1 不存任务。
- 将独立 MCP Wrangler compatibility date 从历史 `2025-03-10` 对齐到 `2026-07-25`，与 Cloudflare 项目门禁一致；未改变协议版本或公网身份。
- packaged portable UI smoke 暴露 native `setFullScreen(false)` 未返回会卡住沉浸覆盖层；TimerPanel 增加 250ms 有界退出兜底，待重建后复验 installer/portable UI smoke。
- 以干净源码提交 `0e031fd`、Node `22.22.2` 重建 `0.12.104`：installer/portable 只读校验哈希分别为 `E8B35A8B958784879D994AB4E6BD353A1DE6C6AA12A8812E873F647709A5CE9F` / `63FC4211E90573F91833BFE9006A14B61BF9EE41D9C03D36CEECA731AD51F0D8`，发布目录四文件且 LFS tmp 0。
- Windows `/S` 覆盖安装回读 `0.12.104` 与 `0.12.104.0`，应用重启且 SQLite/credential 保留；华为 `192.168.1.7:5555` 正式包回读 `0.12.104/1304`，隔离 native instrumentation `4+1` 通过；小米 `192.168.1.5:5555` 正式包因历史签名不一致被拒，未卸载/清数据，按既有策略安装并启动 `app.focuslink.mobile.v012104` 回读 `0.12.104/1304`，旧 `192.168.1.4:5555` offline。
- Cloudflare private/public/OAuth 实际部署版本分别为 `8b19926e-b7f4-46f7-90cc-4b2d96065770`、`b961c9d3-f9da-4079-b135-c8088fb06eb4`、`2b1f9e76-76ce-4af2-811a-b1d8048a0b71`；远端 `probe-remote` 19/19 通过。生产 MCP 任务写入未做成功闭环：浏览器无授权态、未提供 OAuth access token，`verify-pc-off` 报缺少/无效 `FOCUSLINK_MCP_ACCESS_TOKEN`；未创建生产临时数据，无需清理。新候选 unpacked/portable UI smoke 均出现非稳定状态收敛失败，已在实施日志明确为阻断，不能冒充通过。
- 新增纯函数、MCP service binding/scope、canonical route、IPC 失败反馈与移动/桌面清单安全删除回归。根 typecheck、Vitest `122 files / 915 tests`，cloud/mcp typecheck/test:typecheck/测试 `113` 项通过；生产 Worker/OAuth 已部署并完成匿名 probe，三端安装已实测；仅生产 MCP 任务清理闭环待 OAuth 授权，不以本地测试冒充。

## 2026-08-28

- Luna Max 第二次独立只读复核确认：已有同步设备仍误走旧 approve 分支；FocusLink 2.0 最终样式层把用户选中的强调色覆盖为青绿色；首次任务写入存在空快照覆盖竞态；移动任务/清单 Promise 失败没有稳定提示。
- 普通配对现在统一使用每台设备自己的 8 位 request 码，已有凭据的设备同样走 `request → exchange → claim`，旧 approve/offer 仅作兼容；文案改为“连接设备/设备同步”。
- 移动端允许不填标题直接开始，自动记录为“自由专注”；新增九种计时仪表与字体实时预览，和 PC 共用 `TimerDial`、主题 token 与状态色。
- 移动任务写入前强制读取最新快照，新空间自动建立 `local-inbox`；PC 清单创建/改色/移动/完成/恢复等待任务快照发布尝试；移动任务刷新改为 5 秒并在回前台/聚焦时立即刷新。
- 修正 PC/移动最终 CSS 级联，删除写死的强调色，加入 token 合同测试；移动写入失败显示可操作状态并回滚颜色。继续沿用 0.12.104，等待最终打包和 Windows/华为/小米矩阵。
- 源码功能提交 `dc92a65` 后重新生成 `shared/version.generated.ts`，构建身份固定为干净提交短 SHA；最终安装包必须从该身份重新生成，不能沿用上一轮 `c0affe7` 包。
- 设置页搜索回归补齐“二维码”关键词；本地任务模式隐藏滴答清单分组时，设置截图门禁只在外部适配器显式出现时检查连接/去向同组。
- 打包 UI smoke 原先把 FocusLink 2.0 覆盖层的旧成功色 `52 124 86` 当成固定事实；统一 token 后实际浅色 emerald 成功色为 `11 122 85`，回归已改为检查共享语义值，避免再次阻断用户强调色切换。
- 最终包身份 `0.12.104 / 6defd1b` 通过 packaged UI、mini、live fallback，Android build/unit/lint 和移动五视口明暗验收。Windows、华为均回读 0.12.104；小米在线但旧包签名不同，覆盖失败后保留 0.12.87 与用户数据，三端同版门禁未冒充完成。
- 合并远端 `main` 后，Git 把等价历史提交中的 poll/approve/type/test 块再次插入；类型检查立即捕获重复声明。已删除 184 行重复块并再次通过全量 903 项与跨设备 59 项，正常 UI 继续只走直接互配。
- 远端协议脚本中的旧 approve 闭环保留为明确命名的兼容测试，和正常 `request → exchange → claim` 闭环分别执行；桌面设置页再次移除合并带回的 approve 分支。Cloudflare 两阶段持久化门禁复跑通过。
- 小米地址从 `192.168.1.5` 漂移到 `192.168.1.4:5555` 后已重新连接。正式包因签名不同仍不能覆盖旧 `0.12.87`，因此在不卸载/不清数据的前提下安装并启动并行包 `app.focuslink.mobile.v012104`，回读 `0.12.104/1304`；临时 Gradle applicationId 已恢复，正式 APK 输出已恢复。
- 已配对设备列表改为当前设备、其他设备、无效与测试设备三层；测试/临时/smoke/protocol/staging、久未同步和撤销设备默认折叠，只改变展示、不自动删除，PC 与移动端共用同一分类策略。
- 设备列表降噪功能提交为 `bf98e8c`，同一 0.12.104 批次重新生成构建元数据；后续包必须回读该源码身份，不沿用上一轮 UI 包。
- 设备列表候选包身份 `90686c8`：Windows 已覆盖回读；小米并行包已覆盖并运行 `0.12.104/1304`；华为本轮 ADB offline，保留之前同版本安装但未再次覆盖此 UI 子修订。发布目录哈希随最终包更新。

## 2026-08-26

- 用户再次实测指出：未授权设备仍没有自己的配对码，并被迫进入裸露的 `Owner sign in / One-time code` 网页，不符合“每台设备都有配对码、互相输入即可同步”的目标。
- 共享 OAuth 首次授权页已在 Poyi 主仓改为 FocusLink 中文自适应页面并部署版本 `a6137e93-0e49-463b-ad91-3b80bc2ead52`；43 位管理员授权码与应用内 8 位设备配对码已明确分层。
- 0.12.104 新增反向配对：未授权设备匿名申请 8 位本机码与不显示的高强度领取凭据；已授权设备输入该码批准；申请设备轮询领取独立 `fl2` 后自动启动任务、实时专注和账本同步。旧的“新设备输入已授权设备码”继续兼容。
- 版本节流说明：0.12.104 是新增三条协议路由、设备管理权限和三端交互的完整行为候选，不是文案小修；本候选后续修补继续共用 0.12.104，不连续增加补丁号。
- 后台 Codex review 对历史 release EXE 反复执行 Git/LFS diff，`.git/lfs/tmp` 一度增长约 16.56 GB。确认来源且无活动 `git-lfs` 后只清空临时文件内容；新增不提交的本地 attributes 覆盖，193 个残留空文件合计 0 B，未触碰 LFS objects、发布 EXE、SQLite、设置或凭据。
- 0.12.104 源码候选已提交为 `a2e30b6`，随后记录版本生成元数据；Windows 打包、设备安装回读和最终线上双设备实测仍在继续。
- 0.12.104 构建/验收：根类型检查、Lint、全量 Vitest `120 files / 898 tests`、移动视口、桌面 UI、Cloudflare 本地协议门禁与 MCP `10 files / 108 tests` 通过；Android `assembleDebug`、`testDebugUnitTest`、`lintDebug` 均成功并回读 `0.12.104/1304`。首次从含中文路径执行 Gradle 时出现 7 个 `ClassNotFoundException`，改用同一工作区的 `F:` 短路径重跑后全量 Android 单元测试与 lint 通过，确认是路径/worker 启动问题而非源码失败。
- 0.12.104 Worker 已部署：公网 `foxlink-mcp` `f34ee99a-ad22-42d7-aa84-3492554cf23b`，私有 `focuslink-sync` `6e525dd1-73f4-402c-b52e-feab7343416b`；公网 healthz 200，匿名 request/claim 无效体 400，匿名 approve 401，带 bearer 的匿名 request 403。
- 0.12.104 Windows installer/portable 已从干净候选构建，SHA256 已写入 `release-v012104/SHA256SUMS.txt`；构建时历史 `release-v012104/win-unpacked.tmp/resources/default_app.asar` 被系统进程锁定，无法按策略删除，已记录为发布目录 hygiene 残留，不把中间物列入下载清单。
- 华为 DBY-W09 `192.168.1.7:5555` 已 `adb install -r` 并回读 `0.12.104/1304`；小米 xaga `192.168.1.5:5555` 仍装有旧签名 `0.12.87`，新 debug APK 因签名不一致被 Android 拒绝，未卸载旧包、未清数据，故小米本轮安装门禁 BLOCKED。
- 最终复验：根 `npm test` `120 files / 898 tests`、`npm audit --audit-level=high` 0 漏洞、typecheck/lint/format 全部通过；打包版 UI/mini/live fallback smoke 全部 exit 0。华为平板实机打开多端同步后成功生成 8 位本机码并显示 10 分钟倒计时，截图确认双向文案、输入框和键盘布局可用。
- Windows 静默安装器 exit 0，卸载项 `FocusLink 0.12.104 / DisplayVersion=0.12.104`，已安装 EXE `FileVersion=0.12.104 / ProductVersion=0.12.104.0`，应用已重启；APK 备份 `.tmp/android-apk-backups/FocusLink-0.12.104-1304-debug.apk`，SHA256 `1F641CC7FB3BDC4E822EEEF301FA26264A645E8A0005EB7479D439500BF1661A`。
- 兼容收口：旧“已授权设备生成码”路径也申请 `devices:manage`，与新设备本机码反向批准路径权限一致；定向 typecheck 与 64 项账户/移动/权限回归通过，仍归入 0.12.104。
- 权限收口源码提交为 `9b6138c`；已有 `106dcbf` Windows/APK 候选随之废弃，0.12.104 将从新提交重新构建和覆盖安装，不复用旧哈希。
- 权限收口最终候选身份为 `8db91bf`：Windows 启动验证与 `/S` 覆盖回读通过，华为回读 `0.12.104/1304`；小米仍因旧签名拒绝覆盖并保留 `0.12.87`。最终 APK SHA256 `BA19FD3A2488F3189E49D00388D1F14E7D9143B49202C55EE13BC510E6C6B107`，Windows 哈希已更新到候选目录。
- 用户否决“第一台/已授权设备/陌生人猜码/尝试过多”设计前提，并明确个人本地产品无需此限制。0.12.104 普通流程改为两台无凭据设备直接互配：A 生成码，B exchange 后获得独立凭据，A 自动 claim 获得独立凭据，两台进入同一同步空间；管理员网页退出客户端入口。
- pairing request/exchange/claim 的公网 RateLimit 调用已移除；同一 installation 重复提交同一码确定性返回同一 token，不再报“已使用”。真实本地 Durable Object 已验证两台无登录设备直连、双方 status/task/live/ledger 访问以及 exchange/claim 幂等重试。
- 生产 gateway `e6278900-14d2-4a7b-b016-0c92a2224814` 与 authority `a005d012-c856-4d7e-a05f-8b65c0e2f57a` 上，两台无登录临时设备真实直连成功：双方 status/tasks/live/ledger 均 200，task revision 33、live revision 101，exchange/claim 重试凭据一致。
- 生产清理捕获私有 Worker 撤销路径把 `/sync/v2` 错替换为空、导致 `/devices/.../revoke` 404；修正保留 `/v2` 并部署 authority `f66f74e6-7245-405e-baf7-f97f04a1aff4`。复验已撤销全部 8 台临时 smoke 设备，撤销均 200，双方 status 变为 401。
- 无登录直连与撤销修正的源码身份为 `d22962c`；0.12.104 将从该提交重新生成 Windows/APK 候选，前一轮 `8db91bf` 二进制不再作为最终交付。

## 2026-08-25

- 用户指出近期版本号迭代过密。后续采用版本节流：同一功能批次的中间 UI、测试、日志和网络修复共用一个候选号；完整兼容功能才升 minor，协议/权限/迁移不兼容才升 major。当前配对整组统一收敛到 `0.12.103`，不再为本批次继续产生 `0.12.104+`。
- 用户授权清理缓存后，逐项校验并清空 Electron `Cache/Code Cache/Dawn*Cache/GPUCache`、测试截图/隔离 profile、桌面打包副本和 LFS 临时缓存；共 70 个目标目录、7516 个文件，当前目标文件均为 0 B。递归删除目录被系统策略拒绝，空目录残留不影响空间；SQLite、设置、Local Storage、Network 和凭据未触碰。
- 小米 `192.168.1.5:5555` 复连结果：网络端口 5555 可达但 ADB 设备状态仍为 `offline`，kill/start server、disconnect/reconnect 和 `adb reconnect offline` 均未恢复；没有强行重启或清除手机数据。
- 0.12.103 最终门禁：根 Vitest `120 files / 891 tests`、cross-device `57`、npm audit 0、桌面/移动生产截图与 Android 1303 JVM/lint/assemble 通过；Windows 回读 `0.12.103 / 8122a1e`，华为回读 `0.12.103/1303`。小米仍只记录安装阻断，不做手机像素测试。
- 根据用户截图继续收敛 PC 跨设备页：未授权状态明确显示“输入另一台设备的本机配对码”，恢复入口改为“首次授权（只需一次）”，授权设备按钮改为“显示本机配对码”，减少输入和生成两个动作混淆。该修正归入 0.12.103 同一批次，不新增版本号。
- 移动端配对 sheet 同步收敛为“输入另一台设备的本机配对码 / 输入配对码 / 首次设备授权”三段文案，移除“加入多端同步”和多步说明造成的额外概念；继续沿用 0.12.103，不新增版本号。
- 移动视口 fresh-install 门禁同步新的配对文案，桌面 13 张截图已通过；之前失败只是 smoke 仍断言旧文案。
- 0.12.103 最终简化配对文案已重新安装到 Windows，回读 `0.12.103 / e50aec4`；桌面 startup verifier、UI/移动视口门禁全部通过。
- 0.12.103 PC 文案修正已重新生成并安装，最终包身份 `af5ca29`；Windows 回读 `0.12.103`，startup verifier 通过。

- 用户实测 0.12.102 配对显示 `request timeout`。根因是配对/设备管理请求只请求 canonical 主站，没有复用实时链路的 failover；0.12.103 统一在 canonical 与 `focuslink.pyzzgk.dpdns.org` 之间按网络失败/5xx 重试。
- 已授权设备进入多端同步后自动生成本机当前配对码，界面不再把它描述成抽象的“添加设备”；另一台设备输入该码后仍走原有任务、实时专注、账本同步链路。

## 2026-08-25

- 用户复测指出 0.12.101 的配对仍像设置项，不能达到微信输入法式快捷登录。根因是输入框需要手动提交、移动端未自动聚焦，且粘贴格式和“首台恢复”主路径没有明确分层。
- 0.12.102 将桌面/移动输入改为单一快捷状态机：自动聚焦、归一空格/换行、输满 8 位自动兑换、重复去重、失败保留码并允许删改重试；成功继续执行既有任务/实时/账本同步。服务端仍只允许已授权设备生成码，首台恢复不被绕过。
- 云端已有 owner-only `/v2/devices` 路径此前没有接入客户端；本轮让 bootstrap 首台设备获得 `devices:manage`，桌面/移动端列出设备并撤销远端凭据，普通配对设备维持四项同步/live scope，当前设备只能退出登录。
- Windows 安装版 0.12.102 的 startup verifier 首次沿用了旧暂停色 `210 67 57`，而 FocusLink 2.0 桌面最终 token 是 `211 102 55`；UI/mini/live smoke 已实际通过，现将 verifier 合同同步到最终桌面 token。
- 版本生成器曾把本轮可重建的 `release-v012102*` 临时目录计入 dirty 状态；仅在本地 `.git/info/exclude` 忽略这些目录后，记录干净的 0.12.102 build metadata，排除规则不进入仓库。
- 最终 0.12.102/1302 候选以干净提交 `ebf8eb4` 生成。Windows 静默覆盖回读 `DisplayVersion=0.12.102`、EXE `FileVersion=0.12.102`，startup/UI/mini/live smoke 全部通过；华为 `app.focuslink.mobile.staging.test` 回读 `0.12.102/1302` 并通过旧 WebView CDP 读取配对输入自动聚焦。小米 `192.168.1.5:5555` 维持 ADB offline，按用户口径只做安装但本轮未宣称成功。
- 为使设备列表/撤销真实可用，已部署私有 `focuslink-sync` `4ae939d8-8091-4e17-ac83-2821cfc71fc6` 与公网 `foxlink-mcp` `3b98acd8-1675-4595-a63a-ad7f49a74216`；公网健康 200、无凭据设备管理 401、账号 bootstrap 仍返回 `deployed-login-required`。

## 2026-08-24

- 0.12.100 安装版在断开父 PowerShell 后触发真实 CLI 错误，证明同步 `try/catch` 无法捕获 stdout/stderr 的异步 `EPIPE`；虽然 20 MiB 单文件上限生效，但递归持续轮转出 715 个当日日志、合计 14,968,917,567 B。停止 FocusLink 并逐项校验目标目录/文件名/非 reparse 后，仅清空这 715 个生成日志，其他 6 个日期日志及任务、SQLite、设置和凭据未触碰。
- 最终修复令 packaged 环境完全不镜像错误到父控制台；开发环境才允许 console mirror，同时为 stdout/stderr 注册异步错误 guard。因 0.12.100 已真实安装并失败，最终候选提升为 0.12.101/1301。
- 2026-08-25 npm registry 新增审计规则后从早先 0 漏洞变为 27 项（2 critical/20 high/5 moderate）。没有使用 `--force`：先做兼容性查询，再将 Electron 31→受支持的 43.4.1、Vite 5→7.3.6、Vitest 2→4.1.11、builder/rebuild/Wrangler/Cloudflare types 对齐，最终 `npm audit` 回到 0。
- Electron 43 首次 selftest 准确暴露旧 `better-sqlite3` ABI 125 与新 ABI 148 不匹配；本机无 Visual Studio C++ 工具链，未擅自安装系统组件。改用官方 13.0.3 N-API 发行包后，Node 内存库与 Electron 计时、任务、同步 DB、running/paused crash recovery 全部通过。
- Electron 43 首次显示无框截图窗口后把 800px 内容区回读为 802px；移动验收夹具改为 show 后再次 `setContentSize`，明确锁定 CSS viewport 而非 DWM 外框换算。随后桌面 13 张截图与 360/412/640/760/915×412 明暗四页面全部通过，外层无溢出、任务/地图/配对结构与 44px 触控门禁未回归。
- electron-builder 26 首次 dist 仍看到 SQLite 包内 `binding.gyp` 并误走 node-gyp，失败于本机无 Python/MSVC；该失败未生成 EXE。既然 13.0.3 已以 N-API prebuild 在 Node/Electron 真实数据库回归中通过，构建配置显式关闭 `npmRebuild`，保留 `asarUnpack` 携带预构建文件，并移除会误导维护者的直接 `@electron/rebuild` 与旧 rebuild script。
- Electron 43 packaged UI smoke 回读 requested/viewport `1280×720`、outer `1294×728`；旧门禁错误地把 DWM 外框限制成内容尺寸。断言改为以 viewport 验证 1280×720 大窗与 980×660 最小内容区，仍保留 body scroll 不超过 viewport 的真实溢出门禁。

- 2026-08-25 在 0.12.99 Windows 安装后发现控制台 EPIPE 无界递归：断开父 PowerShell 后，`console.error` 抛错被全局 `uncaughtException` 再写 logger，生成同一条错误直至日志达 155,984,434,050 B。确认已停止增长、关闭 FocusLink 且文件可独占打开后，将这一精确生成日志清空为 0 B；未删除 SQLite、任务或凭据。
- Logger 增加控制台 fail-closed、stream 错误脱离、500 行内存上限和单文件 20 MiB 切换。回归用抛 `EPIPE` 的 synthetic sink 确认不向外传播异常。0.12.99 已安装后源码变更，候选按不复用规则提升为 0.12.100/1300。
- 0.12.100 代码状态下 format/typecheck/lint 与完整 Vitest 120 文件/888 项通过；待干净提交重建后以真实断开父控制台的方式确认日志不再增长。
- 2026-08-25 新一轮将版本提升为 0.12.99/1299：Dashboard 单日由混色细带改为 00:00–24:00 三轨时间地图；空日也显示 25 整点/24 小时格和当前时间线。桌面在 980px 宽完整显示，移动使用局部 760px 可读画布横向滑动，外层不溢出。
- 参考滴答官方帮助的数据边界：收件箱是快速收集中转站，普通清单是单一归属，全部/智能清单是聚合视图，清单颜色与标签/优先级是不同维度。FocusLink 保留自有 UI，新增独立清单颜色、重命名、详情移动和桌面拖放。
- `LocalTaskProvider.moveTask` 以事务 upsert 移动子树；子树根从另一清单单独移出时解除父引用。项目云快照以 `publishedAt` 与本地 `updated_at` 比较，防止立即刷新的旧快照覆盖刚改的清单颜色。
- 手机任务详情收为底部 sheet，平板保留双栏；移动端可编辑清单名称/颜色、切换任务所属清单。PC/移动配对统一增加三步说明、实时倒计时与复制码。
- 完整 Vitest 120 文件/886 项、cross-device 56 项、format/typecheck/lint、npm audit、Cloud build、bootstrap probe 和 Electron selftest/task/DB/crash recovery 通过。桌面页面截图在明暗和 980×660 通过，实际 IPC 完成清单创建/改色/收件箱任务移动；移动五视口四页面通过无外层溢出与 ≥44px 门禁，并额外截取平板任务详情/清单管理和手机底部详情。
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
