# FocusLink 实施日志

## 2026-08-29 · v0.12.104 自有任务清单删除与云端 MCP 任务管理

- **清单删除安全语义**：PC 与移动端普通 FocusLink 清单现在都提供删除入口并二次确认；收件箱固定不可删除。删除清单只在 SQLite/快照中把全部任务及子树迁入 `local-inbox`，不静默丢失任务；只有显式任务删除才永久删除子树。PC 本地迁移与清单删除使用同一 SQLite 事务，删除发布前跳过旧云快照合并，发布未获确认时恢复原清单和任务归属；移动端仅在服务端回读成功后更新内存与 IndexedDB，失败保留旧树并显示错误。
- **云端 MCP 任务面**：`foxlink-cloud-mcp` 新增 `focuslink_list_projects`、`focuslink_list_tasks`、`focuslink_get_task`，以及清单创建/更新/删除、任务创建/更新/完成/恢复/删除/移动工具。任务字段包含清单、`parentId`、截止时间（Unix ms）、优先级和标签；清单删除返回 `moved_to_inbox`，任务删除返回 `permanent_subtree_delete`。所有写工具要求 `operationId` + `expectedRevision`，Account DO 在同一 `task_state`/`task_operations` 持久化事务中执行 CAS 与重放，冲突不覆盖，成功只返回稳定 ID、revision、计数等脱敏确认。
- **协议与权限**：新增 canonical `/sync/v2/tasks/mutate` 到 Account DO `/v1/tasks/mutate` 的转发；旧 `/sync/v2/tasks` 完整快照读写与旧客户端保持兼容。MCP 2026-07-28 discovery 保持，读写 token 额外允许 `focuslink:write`，写调用要求 `focuslink:read focuslink:write`；MCP D1 投影不保存任务。
- **Cloudflare 配置**：独立 `cloud/mcp/wrangler.jsonc` 的 compatibility date 从历史 `2025-03-10` 对齐到项目门禁 `2026-07-25`，仅是兼容运行时配置修正，不改变 task snapshot 协议版本或 MCP discovery 目标。
- **Portable immersive 修复**：packaged portable smoke 曾因 native `setFullScreen(false)` Promise 长时间不返回而使 body immersive overlay 无法卸载；`TimerPanel` 现在以 250 ms 有界 fallback 后继续 360 ms 卸载过渡，native 正常确认仍优先。修复后须从新干净源码重建并重跑 installer/portable UI smoke，未重跑前不宣称 portable UI 通过。
- **最终候选打包**：在干净源码提交 `0e031fd`、Node `22.22.2` 下 `npm run dist` 成功，包内身份 `0.12.104 / 0e031fd`；`release-v012104/` 已收敛为 installer、portable、`SHA256SUMS.txt`、`RELEASE_NOTES.md` 四文件。installer SHA256 `E8B35A8B958784879D994AB4E6BD353A1DE6C6AA12A8812E873F647709A5CE9F`，portable `63FC4211E90573F91833BFE9006A14B61BF9EE41D9C03D36CEECA731AD51F0D8`；`.git/lfs/tmp` 构建前后 0 文件/0 B。
- **packaged smoke 证据**：unpacked `smoke:live-fallback` 与旧版已通过的 UI/mini smoke 保留；`verify-startup` 对新 portable 回读版本、commit、shell、rail、console、pause token 全通过。新候选 `smoke:ui` 在 unpacked 一次设置 toggle、一次 flip/history delete 检查出现 flaky 断言；portable 在 immersive 后/暂停状态未在脚本 4 秒窗口内收敛，均记录为本轮 UI smoke 未通过，不能冒充完整 packaged UI 验收。
- **Windows/Android 安装矩阵**：Windows installer `/S` exit 0，卸载注册项和已安装 `FocusLink.exe` 回读 `0.12.104 / 0.12.104.0`，应用已重启，SQLite 与设备凭据保留。Huawei DBY-W09（`192.168.1.7:5555`）正式包 `app.focuslink.mobile` 覆盖安装并回读 `versionName=0.12.104/versionCode=1304`；隔离 instrumentation terminal lifecycle `4/4`、应用上下文 `1/1` 通过，仅卸载 `.test` 包。Xiaomi xaga `22041216C`（`192.168.1.5:5555`）正式包覆盖返回 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，未卸载/清数据；按既有并行包策略安装 `app.focuslink.mobile.v012104`，回读 `0.12.104/1304` 并启动。旧地址 `192.168.1.4:5555` 保持 offline，不作为当前 Xiaomi serial。
- **公网验收状态**：`focuslink-sync` 已部署 `8b19926e-b7f4-46f7-90cc-4b2d96065770`，`foxlink-mcp` 已部署 `b961c9d3-f9da-4079-b135-c8088fb06eb4`，Poyi OAuth scope migration `0006_focuslink_task_write_scope.sql` 已远端应用，OAuth Worker `2b1f9e76-76ce-4af2-811a-b1d8048a0b71` 已部署；health/ready/protected metadata 与 `probe-remote` 19/19 通过。生产 MCP 任务/子任务闭环仍 BLOCKED：没有可用 OAuth access token 或浏览器授权态，`verify-pc-off` 明确返回 `FOCUSLINK_MCP_ACCESS_TOKEN is missing or invalid`；本机加密 device credential 无法在隔离 Electron 进程解密，未创建生产临时数据，故不存在待清理的生产任务。
- **验证**：根 typecheck、全量 Vitest `122 files / 915 tests` 通过；`cloud/mcp` typecheck、test:typecheck 与全量 MCP 回归 `113 tests` 通过。新增纯函数父子/日期/优先级/标签/安全删除、MCP binding/CAS scope、canonical route、IPC refresh failure 和 UI wiring 回归。生产 Worker/MCP 部署、真实临时任务闭环和本批次三设备新包安装尚未在本条目宣称完成，须按发布门禁继续回填。

## 2026-08-28 · v0.12.104 移动端功能与直接互配收口

- **Luna Max 独立复核**：确认移动端自由专注、仪表入口、任务首写和 PC/移动颜色级联存在真实缺口；复核服务第一次返回 503，第二次成功完成只读审计，未直接改动源码。
- **直接互配主路径**：已有同步凭据的 Windows、Web、手机和平板也统一生成匿名本机 request 码；输入另一台设备的码始终走 `request → exchange → claim`，不再从 UI 进入 approve。旧 `/pair/offers`、`/pair/approve` 只保留协议兼容和定向回归。
- **移动专注**：标题和任务都可以留空，开始时稳定落为“自由专注”；移动外观新增持久化 `timerStyle`，专注页和设置页复用桌面九种 `TimerDial`，字体选择同时显示真实中文/数字预览。
- **任务快照**：新同步空间在 `snapshot=null/revision=0` 时按需建立稳定 `local-inbox` 首写；移动创建前强制 GET 当前快照，防止首次加载竞态覆盖已有任务。PC 强制 refresh 会等待 pending snapshot 发布尝试，完成/恢复任务也会发布；移动前台刷新调整为 5 秒，并在回到前台/聚焦/pageshow 立即拉取。
- **颜色根因**：`focuslink-2.css` 和 `focuslink-2-mobile.css` 原来在最终层写死青绿色，覆盖 `focus-color-*` token，导致 PC/移动点击钴蓝、鸢尾、琥珀看起来不生效。已删除重复 token，让最终控件只消费 `temporal-foundation.css` 的强调色变量，并加入级联静态合同。
- **失败反馈与文案**：移动任务/清单创建、改色、移动、完成失败现在显示页面状态并回滚颜色；普通入口统一使用“配对设备/设备同步/退出此设备同步”，不再把直接互配称为登录、批准或首台授权。
- **验证**：typecheck、lint、定向移动/任务/配对/颜色测试和全量移动视口（360/412/640/760/915×412 明暗）通过；全量 Vitest、生产构建、三端最终安装矩阵待本节完成后回填。版本继续沿用 0.12.104，不因同一功能批次的小修增加版本号。
- **最终自动门禁**：format/typecheck/lint、根 Vitest `120 files / 903 tests`、cross-device `6 files / 59 tests`、Cloudflare 两阶段 task/live/cursor 持久化门禁通过；桌面设置截图、packaged UI、固定两态 mini、live fallback、移动五视口明暗四页面均通过。Windows 包内构建身份回读 `0.12.104 / 6defd1b`。
- **最终安装矩阵**：Windows 静默覆盖后卸载项与安装 EXE 回读 `0.12.104`，安装进程已重启；Huawei DBY-W09 覆盖安装成功并回读 `0.12.104/1304`；Xiaomi `192.168.1.5:5555` 已在线，但旧 `0.12.87/1287` 正式包签名与本地 debug APK 不同，`adb install -r` 返回 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，未卸载、未清数据，故三端同版门禁仍为 BLOCKED。
- **最终资产**：installer SHA256 `B719C453480499BDD9041C8074FF6F3ABC2C6E40C86FAF6D00C838522C6E42FD`；portable `D345532C0B3403F9104858119614FEE90D8586802F4A14332593C8CB0B9E6263`；APK 备份 `09B6001CC9E124ED15B4BE2A271EC704ED0A52FF160F65E14EEA327605F4CBBF`。发布目录已收敛四文件，`.git/lfs/tmp` 构建前后均为 0 B；未创建 tag 或 GitHub Release。
- **小米补充安装**：小米从旧地址 `192.168.1.5` 漂移到 mDNS 地址 `192.168.1.4:5555`；重连后确认型号 `22041216C`。正式包 `app.focuslink.mobile` 因历史签名差异仍不能覆盖 `0.12.87/1287`，未卸载、未清数据；为完成实际安装，在不碰正式包的前提下用同一源码临时 applicationId 构建并安装并行包 `app.focuslink.mobile.v012104`，成功回读 `0.12.104/1304` 并启动。临时 Gradle 改动已恢复，正式 APK 输出已恢复并校验为 `app.focuslink.mobile`。
- **设备列表降噪**：用户指出 roster 中混有无效和测试设备。PC 与移动端现共用纯展示策略：当前设备常驻，正常其他设备折叠，test/smoke/protocol/staging/临时/验收命名、久未同步或已撤销设备统一折叠到“无效与测试设备”。不自动执行撤销，展开后保留逐台确认删除；新增纯函数和 SSR 合同测试。
- **设备列表候选安装**：全量 Vitest `121 files / 905 tests`、PC 设置截图、移动五视口明暗、packaged UI/mini/live fallback 与 Android build/unit/lint 通过；包内身份 `0.12.104 / 90686c8`。Windows 已覆盖并由 startup verifier 回读该身份；小米 `192.168.1.4:5555` 并行包已覆盖回读 `0.12.104/1304`、进程在前台。华为 `192.168.1.7:5555` 本轮 ADB offline，保留此前 `0.12.104/1304`，因此该子修订三端再次覆盖门禁为 BLOCKED，不冒充完成。

## 2026-08-26 · v0.12.104 每台设备本机码与反向批准

- **用户反证**：0.12.103 未授权设备只能输入另一台设备的码，点击首次授权则进入裸露英文管理员页面；这仍不是用户要求的“每台设备都有配对码”。
- **最终产品取舍**：用户明确拒绝“第一台/已授权设备/陌生人猜码”的账号安全叙事，并确认这是个人本地产品。最终采用两台无凭据设备直接互配：任一设备输入另一台的 8 位码一次，两台进入同一固定同步空间；Poyi owner 页面退出普通入口。
- **协议**：设备 A `/sync/v1/pair/requests` 提交 installation metadata，收到 8 位码、10 分钟过期时间与只留本机的高强度 request token；设备 B `/pair/exchange` 输入该码后获得自己的独立 `fl2`，A 的 `/pair/claim` 随后自动获得自己的 `fl2`。旧 offer/approve 路径只保留兼容。
- **幂等与次数**：同一 installation 在 TTL 内重复 exchange 或 claim 确定性获得同一凭据，不再返回“已使用”；其他 installation 占用同一码才 410。public edge 移除 pairing request/exchange/claim 的 RateLimit 调用，不再出现“尝试次数过多”。短码和 request token 仍分别只以域分离 HMAC 落盘，日志不含明文。
- **三端交互**：PC、手机和平板统一只显示“本机配对码 / 输入另一台设备的本机配对码 / 加入同步”，不出现第一台、已授权、批准或管理员码。配对后的设备都包含 `devices:manage`；撤销设备不删除业务数据。
- **旧身份页退场**：生产共享 OAuth 中文页版本 `a6137e93-0e49-463b-ad91-3b80bc2ead52` 仍作为后台维护兼容存在，但普通 FocusLink 客户端不再打开或要求 43 位管理员码。
- **候选身份**：0.12.103 已实际安装，新增跨端行为不得复用；候选提升为 0.12.104/1304。按版本节流，本组后续测试与 UI 修补继续使用 0.12.104。
- **本轮门禁**：根类型检查、Lint、全量 Vitest `120 files / 898 tests`、移动 360/412/640/760/915 横竖屏、桌面 UI、Cloudflare 本地真实配对闭环与 MCP `108` 项通过；Android `assembleDebug`、`testDebugUnitTest`、`lintDebug` 均通过并回读 `0.12.104/1304`。含中文路径首次运行 Gradle 的 7 个 `ClassNotFoundException` 通过同一工作区 `F:` 短路径重跑消除，确认是 Gradle worker 路径解析问题而非 Android 源码失败。
- **线上部署**：公网 gateway `foxlink-mcp` 版本 `f34ee99a-ad22-42d7-aa84-3492554cf23b`，私有 authority `focuslink-sync` 版本 `6e525dd1-73f4-402c-b52e-feab7343416b`；`/healthz=200`，匿名 request/claim/approve credential boundary 负测分别回读 400/400/401，匿名 request 携 bearer 回读 403。
- **安装矩阵**：Huawei DBY-W09 `192.168.1.7:5555` 已安装并回读 `0.12.104/1304`；Xiaomi xaga `192.168.1.5:5555` 旧官方包签名与本地 debug APK 不同，`adb install -r` 回读 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，未卸载旧包或清数据，故小米为 BLOCKED。Windows 0.12.104 安装器待完成 `/S` 覆盖回读；本地打包目录另有被系统进程锁定的 `win-unpacked.tmp`，四文件下载目录的中间物清理未完成。
- **最终回填**：根 `npm test` `120 files / 898 tests`、`npm audit --audit-level=high` 0、typecheck/lint/format、打包版 UI/mini/live fallback smoke 全部通过。Windows `/S` exit 0，卸载项与安装 EXE 均回读 `0.12.104`，应用已重启；Android APK 备份 SHA256 `1F641CC7FB3BDC4E822EEEF301FA26264A645E8A0005EB7479D439500BF1661A`。华为平板真机生成本机码并截图确认倒计时、输入框自动聚焦与软键盘不遮挡；小米仍因签名不一致 BLOCKED。最终 EXE 哈希见 `release-v012104/SHA256SUMS.txt`。
- **兼容收口**：旧的“已授权设备生成码”路径也统一申请 `devices:manage`，与“新设备本机码反向批准”路径权限一致；定向 typecheck 与 64 项账户/移动/权限回归通过，仍归入 0.12.104，不新增版本号。权限收口候选源码身份更新为 `8db91bf`，重新构建后的 Windows/APK 旧哈希全部废弃。
- **权限候选重验**：从系统临时目录重新打包，启动验证回读 `0.12.104 / 8db91bf`；Windows `/S` exit 0，卸载项与安装 EXE 回读 `0.12.104`；华为覆盖安装回读 `0.12.104/1304`，小米仍因旧签名 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` 保留 `0.12.87`，不卸载不清数据。新 APK SHA256 `BA19FD3A2488F3189E49D00388D1F14E7D9143B49202C55EE13BC510E6C6B107`。
- **用户纠正后的直连闭环**：普通配对最终改为两台无凭据设备直接互配，移除 pairing request/exchange/claim 的公网 RateLimit 调用；同 installation 重试 exchange/claim 返回同一凭据。UI 删除“第一台、已授权、批准、管理员码”及恢复入口，只保留双方 8 位码。
- **生产实证**：私有 authority `a005d012-c856-4d7e-a05f-8b65c0e2f57a`、公网 gateway `e6278900-14d2-4a7b-b016-0c92a2224814` 首次部署后，两个无登录临时设备成功直连，双方 status/tasks/live/ledger 均 200，task revision `33`、live revision `101`，exchange/claim 重试 token 保持一致。
- **Bug-02（设备撤销路径丢失 `/v2`）**：生产 smoke 清理临时设备时 `/sync/v2/devices/:id/revoke` 回读 404。根因是私有 Worker 将 canonical 路径误映射成 `/devices/:id/revoke`；修正为 `/v2/devices/:id/revoke` 并部署 `f66f74e6-7245-405e-baf7-f97f04a1aff4`。第二次生产 smoke 撤销全部 8 台临时设备，所有 revoke 200，双方撤销后 status 401。
- **最终源码身份**：无登录直连、无配对次数限流、同 installation 幂等和设备撤销修正提交为 `d22962c`；旧 `8db91bf` 二进制废弃，0.12.104 从新身份重新构建，不增加版本号。
- **Bug-03（移动端“自由专注”被标题校验锁死）**：用户实测移动端无法不选任务单独开始。根因是 `runtimeControlAvailability` 和 `MobileApp.handleCommand` 同时要求标题非空，和界面“自由专注”承诺互相冲突。开始条件现只检查会话/连接权威与 pending，空标题稳定落为“自由专注”；在线与本机离线两条开始路径共用同一标题规则。
- **Bug-04（移动端没有计时仪表状态）**：移动外观模型只有 theme/focusColor/fontProfile，专注页固定渲染普通 `<strong>` 读数，因此字体虽已打包但缺少可见预览，九种 PC 仪表也根本无法选择。移动端现持久化 `timerStyle`，直接复用桌面 `TimerDial` 的九种真实结构，在设置页提供 3×3 实时预览并在专注页渲染；915×412 横屏增加紧凑几何，防止主操作与底部导航重叠。
- **Bug-05（清单颜色/完成/移动写回没有等待确认）**：PC 任务 mutation 调用 `refreshTaskWorkspace({force:true})`，但服务仍用 `void publishDeviceTaskSnapshot` 火并忘；完成/恢复任务甚至没有触发 refresh。结果是 UI 先说“已保存”，快照可能尚未发出或失败。强制刷新现等待 pending snapshot 写回尝试结束，创建/改色/移动/完成/恢复都走同一发布链；移动端前台 cadence 收紧到 5 秒，回到前台/窗口聚焦/pageshow 立即刷新。
- **清单首写与颜色反馈**：新配对空间的 task snapshot 可为 `revision=0/snapshot=null`，旧移动代码因此拒绝创建第一条任务或清单。现按需建立只含稳定 `local-inbox` 的首写 payload；PC 与移动端清单色板轻触即提交当前名称与颜色，不再要求用户额外猜测“还要点保存”。
- **配对叙事收口**：普通三端 UI 改用“配对设备 / 设备同步 / 退出此设备同步”，不再把正常 8 位码路径称为账号登录、设备授权或批准；同 installation 有效期内重试文案明确可重试。内部 account/credential 名称只保留在实现层。
- **本轮自动证据（已完成）**：类型检查通过；定向移动/任务/同步测试 `8 files / 50 tests` 通过；完整移动 360/412/640/760/915×412 明暗四页面通过，无外层溢出、离屏控件或小于 44px 目标，全部本地字体装载成功。全量、打包和安装矩阵已在本节后续回填，不新增版本号。

## 2026-08-25 · v0.12.103 配对超时与本机配对码

- **用户复测**：0.12.102 输入配对码后长时间等待并显示 `request timeout`。
- **根因**：移动 `exchangeDeviceSyncPairingCode` 与 Electron `requestPairing` 以及新设备 roster 请求固定只访问 canonical origin；canonical 网络超时没有走已有 failover。
- **修复**：配对 offer/exchange、设备列表、设备撤销统一使用 canonical → failover 有界重试；4xx 不伪装成网络失败，父级取消仍立即终止。已授权设备进入多端同步时自动生成当前本机配对码，输入端仍支持空格/换行粘贴与满 8 位自动兑换。
- **候选身份**：0.12.102 已实际安装 Windows/华为，交互行为变化提升为 0.12.103/1303。最终简化文案包身份为 `0.12.103 / e50aec4`，华为已 `adb install -r` 回读 `0.12.103/1303` 并通过 WebView 功能回读；小米仍因 ADB `offline` 未安装。
- **版本节流**：本批次后续小修不再继续占用补丁号；`0.12.103` 收纳本次配对网络、UI 和设备管理完整批次，直到最终三端验收结束。
- **缓存与小米**：按用户授权清空本轮 70 个缓存/临时目标目录的全部文件内容（7516 文件，目标文件当前均 0 B），不删除 SQLite/设置/凭据；小米 TCP 5555 可达但 ADB 仍 `offline`，因此不能宣称安装成功。
- **Bug-01（首次授权跳入裸英文管理员表单）**：2026-08-26 用户截图证明生产 `poyi-oauth-as` 的 `/owner/sign-in?bootstrap_flow=…` 仍只显示 `Owner sign in / One-time code`，没有说明 43 位管理员授权码的来源，也没有与应用内 8 位设备配对码区分；这不是同步 transport 故障。根因是共享身份 Worker 直接返回未设计的通用 HTML。已在 Poyi 主仓修为 FocusLink 中文自适应首次设备授权页，保留 CSRF、单次码长度校验、no-store、同源 form-action 与 frame deny，并部署 Worker 版本 `a6137e93-0e49-463b-ad91-3b80bc2ead52`。公网回读标题 `授权第一台设备 · FocusLink`、旧英文标题不存在；1365×900 与 390×844 真实浏览器渲染均无横向溢出。边界不变：已有授权设备时只输入其 8 位本机配对码；完全没有授权设备时仍需 43 位一次性管理员授权码，不能伪造为自助注册。

## 2026-08-25 · v0.12.102 微信输入法式配对码入口

- **用户复测**：0.12.101 虽已有 8 位码协议，但输入端仍是设置项，移动端需要手动点提交且未自动聚焦；用户明确要求类似微信输入法的快捷输入体验。
- **交互修复**：桌面与手机/平板配对输入自动聚焦；`normalizeFocusLinkPairingCode` 统一清理空格/换行；输入满 8 位自动兑换并以码值去重，避免 React/粘贴事件重复提交；失败保留内容，删改后可重试；成功后沿用既有 `applyOwnerAccountSession` / `finishLogin` 读取任务、live 和账本。
- **边界**：不开放匿名生成码，不绕过首台设备恢复，不改变服务端一次消费、TTL、scope 和限流。已授权设备仍通过“添加设备”生成码；没有任何授权设备时，UI 将恢复授权作为次要入口而不是伪造登录成功。
- **设备管理**：云端已有 owner-only `/v2/devices` 列表/撤销路由，但客户端此前没有接入。owner bootstrap credential 现在使用 `sync:read/write + live:read/write + devices:manage`；numeric pairing 仍只签发四项同步/live scope。桌面与移动端新增设备列表和“删除设备”，撤销后远端凭据立即失效；删除当前设备要求退出登录。
- **线上部署**：私有 `focuslink-sync` 已部署版本 `4ae939d8-8091-4e17-ac83-2821cfc71fc6`，公网 `foxlink-mcp` 已部署版本 `3b98acd8-1675-4595-a63a-ad7f49a74216`。公网 `/healthz` 回读 200，未携带设备凭据访问 `/sync/v2/devices` 回读 401 `device_credential_required`；bootstrap probe 仍为真实 `deployed-login-required`。
- **候选身份**：0.12.101 已安装 Windows/华为并完成基础回归；本轮交互变化提升为 0.12.102/1302。Windows 已静默覆盖并回读 `0.12.102 / ebf8eb4`，华为平板已 `adb install -r` 回读 `0.12.102/1302`；按用户新口径小米只做安装，但 `192.168.1.5:5555` 当前 ADB offline，未宣称三端完成。

## 2026-08-25 · v0.12.101 安装版 EPIPE 终止与最终三端重验

- **真实反证**：0.12.100 安装版由短命 PowerShell 启动、父管道关闭后，通过 CDP 调用 CLI 检测触发错误。同步 `try/catch` 不能捕获 stdout/stderr 延迟发出的 `EPIPE`；全局 `uncaughtException` 再次写 logger，形成递归。20 MiB 单文件上限避免了单文件再次达到 155 GB，但仍轮转出 715 个 `focuslink-2026-08-25*.log`，合计 `14,968,917,567 B`。
- **缓存处置**：先确认 FocusLink 未运行，再逐文件验证绝对路径均位于 `%APPDATA%/focuslink/logs`、名称严格匹配当日模式且不是 reparse point；只清空上述 715 个失控生成日志，释放全部 `14,968,917,567 B`。其他 6 个日期日志、SQLite、任务、设置与凭据均未改动。
- **根因修复**：packaged 环境完全禁止错误向父 stdout/stderr 镜像，只写有界文件日志；开发环境保留 console mirror，并为两个 process stream 注册异步 `error` guard，任一管道失效即关闭后续镜像。单物理文件 20 MiB 上限与 500 行内存缓冲继续保留。
- **候选身份**：0.12.100/1300 已真实安装且失败，不得复用。最终候选提升为 0.12.101/1301，继承 0.12.99 的任务清单、24 小时地图、移动 UI 与配对交互。
- **依赖安全**：2026-08-25 当前 npm 审计把早先 0 漏洞更新为 27 项（2 critical/20 high/5 moderate）。方案 A 只做非破坏 patch 仍留下 Electron/Vitest runtime/build 漏洞；方案 B 直接跳 Electron 44/Vite 8 会叠加当天新 stable 与 Rolldown 迁移风险。本轮采用受支持中间路径：Electron 43.4.1、Vite 7.3.6、Vitest 4.1.11、electron-builder 26.15.3、Wrangler 4.125.0；审计最终为 0。
- **SQLite ABI**：Electron 43 首次 selftest 捕获 `better-sqlite3` 11.10.0 的 ABI 125 与目标 148 不匹配；本机没有 Visual Studio C++ 工具链，未擅自安装系统级编译器。升级到首个 N-API 大版本 13.0.3 后不再按 Electron ABI 构建；内存库回读 SQLite 3.53.4，Electron selftest/task/device-sync DB/running+paused crash recovery 全部通过。
- **Bug-02（builder 误重建 N-API SQLite）**：electron-builder 26 首次 dist 仍因包内 `binding.gyp` 调用 node-gyp，未使用已通过回归的 N-API prebuild，并在 Python/MSVC 探测阶段失败。移除多余的直接 `@electron/rebuild` 与旧 `npm run rebuild`，在 builder 配置明确 `npmRebuild: false`；`asarUnpack` 继续带入 `better-sqlite3/prebuilds`。失败 dist 没有生成可发布 EXE。
- **Bug-03（Electron 43 外框与内容区分离）**：首个完整 packaged UI smoke 中 requested/viewport 为 `1280×720`，但无框窗口 outer bounds 为 `1294×728`；旧断言把 outer 强行限制到内容尺寸而失败。产品内容区和无溢出均正确，门禁改为以 `viewport` 验证 1280×720 与 980×660 内容合同，outer 只保留证据，不放宽内容尺寸。
- **验证状态**：production console gate、format/typecheck/lint、完整 Vitest `120 files / 889 tests`、cross-device `56/56`、npm audit 0、Cloud build、Vite 7 production build 与 Electron 原生回归通过。桌面 13 张截图、360/412/640/760/915×412 移动明暗四页面通过；Electron 43 初次 show 后重新锁定 content size，测试仍验证真实 CSS viewport。packaged 断管测试与 Windows/小米/华为实装将在本节继续回填。

## 2026-08-25 · v0.12.100 EPIPE 日志磁盘安全与最终候选

- **Bug-01（断开 stdout 导致 155,984,434,050 B 日志递归）**：0.12.99 Windows 静默安装后，应用由短命令行 PowerShell 启动并继承 stdout/stderr；父进程被终止后 `console.error` 同步抛 `EPIPE`，全局 `uncaughtException` 再调 `logger.error`，后者再次 `console.error`，形成无界递归。当日日志在停止增长时回读 `155,984,434,050 B`；确认 FocusLink 进程终止且文件可独占打开后，精确清空该生成日志，从 155,984,434,050 B 降为 0 B。该诊断内容不可恢复，用户任务/SQLite/凭据未触碰。
- **修复**：`writeConsoleErrorSafely` 捕获控制台 sink 异常，第一次失败后本进程不再写控制台；日志 stream 同步/异步错误均改为失效管道与有界 500 行内存缓冲，不使用 logger 报告 logger 错误。每个物理日志最大 20 MiB；启动时遇到已超限当日日志或运行中到达上限时切换到新时间后缀文件。
- **候选身份**：0.12.99/1299 已真实安装 Windows，之后发生 logger 源码修复，不得复用该版本号。最终三端候选提升为 0.12.100/1300，继承下方 0.12.99 全部任务/Dashboard/移动 UI 变更。
- **打包历史证据**：0.12.99 第一次 NSIS 返回 `Can't open output file`，第二次在生成卸载器时 `spawn UNKNOWN`；每次都精确清理未完成的 `release-v01299` 中间产物，第三次直接对同一份干净 `dist/dist-electron` 封装成功；packaged UI/mini/live fallback 回读 `0.12.99 / 73a8ff2` 通过。该产物因 logger 修复废弃，只作证据。
- **当前验证**：EPIPE synthetic sink 回归、日志单文件 20 MiB 上限合同、format/typecheck/lint 和完整 Vitest `120 files / 888 tests` 通过。0.12.100 干净提交、重打包、断开父管道的真实日志增长验证与三设备实装待后续回填。

## 2026-08-25 · v0.12.99 24 小时时间地图与独立清单系统

- **用户目标**：PC 基础界面可用，但 Dashboard 24 小时时间轴必须清晰可读；任务需要独立清单归属、清单颜色与跨清单移动；手机/平板的 UI、配对和功能要与 PC 大致一致。
- **官方产品调研**：滴答官方帮助把收集箱定义为不打断当前情境的临时中转站，任务后续移入某个普通清单；普通清单可独立设色，文件夹/全部/智能清单是聚合层；任务可长按/拖放到另一清单。FocusLink 只采用这个数据边界，不复制对方品牌外观。
- **模型取舍**：方案 A 把清单当多选标签，迁移简单但无法回答“任务到底在哪”；方案 B 令任务单一归属一个真实清单，全部/已完成仅作视图，标签仍可跨清单。采用 B，以 `local-inbox` 作稳定收件箱 ID。
- **清单能力**：新增共享颜色策略和七色语义调色板；首个普通清单从第二色开始，不与收件箱混淆。Electron 新增 `tasks:update-project` / `tasks:move`；父任务移动整个子树，单独移动子树会把根 `parentId` 置空，禁止跨清单树。
- **同步冲突防护**：项目快照 V1 没有单项目 `updatedAt`，如果本地改色后立即读到旧云快照，旧值会覆盖新值。本轮使用快照 `publishedAt` 与 SQLite `task_projects.updated_at` 比较：本地更新较新则保留，更新的跨端快照才接管。
- **Dashboard 方案**：放弃单条混色细带。单日固定显示 25 个整点刻度、24 个小时格和专注/暂停/空档三条同尺度轨道；00–07 / 22–24 仅作夜间背景，不伪造空档；今日显示当前时间线。桌面在最小窗宽也完整显示 24 小时，移动保持可读宽度并横向滑动。
- **三端 UI**：桌面左侧清单显示颜色和编辑入口，任务行/详情都显示归属，支持拖放与详情下拉移动。手机任务详情改为底部 sheet，平板保留树/详情双栏；移动清单管理提供名称/颜色，主触控目标不低于 44px。PC/移动配对都增加三步、剩余秒数和复制码。
- **当前验证**：format/typecheck/lint、完整 Vitest `120 files / 886 tests`、cross-device `56/56`、npm audit 0 漏洞、bootstrap `deployed-login-required`、Cloud build 与 Electron selftest/task/DB/crash-recovery 通过。桌面明暗/最小窗与 360/412/640/760/915×412 移动视口通过，桌面时间地图断言无横向压缩，移动时间地图断言 25 刻度/3 轨道/合法内部滚动；平板清单管理展开态也通过无溢出与 ≥44px 门禁。干净提交打包和三设备 0.12.99 实装待后续回填。

## 2026-08-25 · v0.12.98 可信设备 8 位短码配对、自动同步与安装器恢复

- **用户目标**：用户要求采用类似微信输入法的短码输入体验，登录快捷，并确保任务、实时专注和账本同步完整收敛；同时再次明确授权删除已隔离缓存。
- **方案比较**：可信设备短码无需邮件/短信供应商，既有设备可离线于电脑进程之外直接生成，但首台设备仍需恢复入口；邮箱/短信码可覆盖首台设备，却增加供应商、费用、滥用和找回模型。本轮采用前者，保留 Poyi owner 作为首台设备/恢复备用。
- **协议**：新增 8 位纯数字、10 分钟一次性 pairing code。普通已登录设备通过现有 `fl2 + sync:write` 显式创建 offer；dedicated pair-service authority 与 legacy nonce 继续兼容。新设备兑换提交 installationId/displayName/platform/deviceKind/appVersion，authority 以 installation HMAC 派生稳定 deviceId，签发独立 `fl2`。
- **权限**：短码兑换出的凭据固定为 `sync:read/write + live:read/write`，不能获得 `devices:manage/backups:manage`。private Worker 最终复验 token/scope；public gateway 只做格式、CORS、限流和 service binding 透传，不能自行冒充授权。
- **秘密与重放**：Durable Object 只保存 `code_hmac`，不保存明码；HMAC 域为 `focuslink-pair-code-v1`。创建响应只回显一次；使用 `used_at IS NULL` 原子消费，未知/过期/已用统一为 `pairing_expired`。短码唯一冲突至多有界重试，client/credential-hash 双限流避免暴力枚举；日志和错误响应不含 code/token。
- **客户端闭环**：Electron main 新增生成/兑换 IPC，renderer 不读取设备 token；移动端复用现有安全存储与 account generation/lease 事务。兑换成功后 Windows 立即 `runDeviceSync()`，移动端推进 connection epoch，任务快照、live long-poll、completed ledger 分别按原有链路启动。
- **Bug-01（桌面快速新建任务缺失 `parentId`）**：2026-08-25 用户截图中 `tasks:create` 真实抛出 `RangeError: Missing named parameter "parentId"`。SQLite `tasks_cache` upsert 必需 `@parentId`，但 `TaskCache` 误标为可选，`LocalTaskProvider.create` 因此漏传。修复后缓存合同改为必传 `string | null`，本地、dida CLI、OAuth 全部显式写入，DB 边界仍作 `null` 防御性归一；新增回归直接断言新任务的 `parentId=null`。Electron 真实 SQLite self-test 已成功新建两条中文任务并完成搜索/关联，不再出现命名参数异常。
- **Bug-02（移动配对 bearer 可能发往任意 HTTPS）**：`Luna · max` 审计实测证明生成码请求只检查 HTTPS，未用 token 触发 FocusLink canonical/failover 绑定。修复后与 live 链路共用同一 allowlist guard，并显式禁止 redirect/cookie/referrer；恶意 origin 回归断言 fetch 为 0 次。
- **Bug-03（WebView 生成码被 CORS 预检拦截）**：public gateway 之前只允许 `content-type`，而可信设备必须携带 `Authorization`。preflight 现回显允许 `authorization, content-type`，新增真实 OPTIONS 合同回归。
- **Bug-04（独立 MCP 类型门禁失败）**：nullable pair authority 传入 `RegExp.test` 是本轮新增错误，`URLSearchParams.keys()` 是 WebWorker lib 下的历史错误；两者已收口，MCP `typecheck` 与 `test:typecheck` 均 exit 0。
- **Bug-05（v0.12.97 静默覆盖被旧卸载器代码 2 阻断）**：干净提交 `36da9d8` 的 0.12.97 installer 打包/smoke 通过，但真实 `/S` 覆盖时旧 `Uninstall FocusLink.exe` 连续返回 2，安装器显示 `Failed to uninstall old application files`；注册表和已安装 EXE 仍为 0.12.96，因此不得宣称 0.12.97 安装成功。根因是 `build/installer.nsh` 的有界恢复宏依赖一次性 `postinstall` 修改 `node_modules` 模板，本次干净打包时该补丁未存在。`dist`/`dist:win` 现在打包前必定运行 `patch-electron-builder-nsis.cjs`，候选提升为 0.12.98/1298，0.12.97 产物废弃。
- **0.12.98 安装器反证**：打包起始日志明确回读 `[patch-electron-builder-nsis] applied`；同一台 Windows 对 0.12.96 静默覆盖 exit 0，注册表 `DisplayVersion=0.12.98`，已安装 EXE `FileVersion=0.12.98 / ProductVersion=0.12.98.0`，启动日志回读 `commit=284b82f`。失败的 0.12.97 未跟踪候选目录已按精确路径删除，不可恢复但可从对应提交重建。
- **三设备安装矩阵**：Windows 如上回读 0.12.98/`284b82f`；小米 xaga `192.168.1.5:5555` 的 `app.focuslink.mobile.staging.ui1294` 与华为 DBY-W09 `192.168.1.7:5555` 的 `app.focuslink.mobile.staging.test` 均 `adb install -r` 成功、启动并回读 `0.12.98/1298`。华为真机像素截图确认新 8 位码 sheet、底部导航与旧 WebView 实色边框；小米截图时用户正在游戏，未强制打断。
- **公网与首设备边界**：private Worker 版本 `0a531590-475f-4c98-9318-006aeae78f81`、public gateway 版本 `d690dbc1-2818-4a1f-98cc-3fdb374be525` 已真实部署；公网 CORS/no-credential 负测通过。但 Windows 安全凭据文件不存在，华为 UI 也明确显示“本机”；当前没有一台已授权的可信首设备，无法合法生成公网真实 8 位码。没有读取/伪造管理员凭据；首台设备完成恢复授权后再补任务 revision、live long-poll 和 completed-ledger 三路真实收敛。
- **最终资产**：`release-v01298` installer SHA-256 `5DBF44CD…7BA`，portable `9805B9B4…FD`，official Android APK `1E571642…C9`并已备份；packaged UI/mini/live fallback 均回读 `0.12.98 / 284b82f` 并通过。未创建 tag 或 GitHub Release（用户未要求正式发布）。
- **缓存权限反证**：8 个目标均为 `C:\Temp\focuslink-lfs-tmp-20260824-*` 普通目录，共 `109,504,409,006 B`，且执行前无 Git/LFS 进程；用户已明确授权删除，但当前桌面执行策略仍在进程创建前拒绝 `Remove-Item`。没有目录被删除，也没有触碰应用数据或 `.git/lfs/objects`。
- **自动化证据**：TypeScript/Cloudflare 与独立 MCP typecheck、根完整 Vitest `117 files / 874 tests`、cross-device `55/55`、cloud/mcp `10 files / 105 tests`、private Worker 本地真实 DO gate（生成 8 位码→兑换→新 token status→重放 410）、desktop/Web/cloud build、五组移动视口与桌面明暗/最小窗截图均通过；两个 Worker dry-run 成功。全仓 Prettier 与 ESLint 存量已收口，format/Lint 均 exit 0。

## 2026-08-24 · v0.12.96 华为旧 WebView 边框兼容修复

- **真机反证**：0.12.95 在华为 `app.focuslink.mobile.staging.test` 覆盖安装并回读 `0.12.95/1295` 后，真实截图显示主读数、主操作条和底部导航出现黑色粗边；同版 Chromium production viewport 没有该现象。
- **已验证根因**：通过该真机 WebView CDP 读取最终计算样式，三个容器边框都变成 `0.8px solid rgb(23, 32, 29)`，而普通任务准备区仍为浅灰 `rgb(224, 229, 225)`。旧 WebView 对 `color-mix()` 边框色的降级把颜色落为 `currentColor`，不是华为系统高对比度或强制颜色（两项 media query 均为 false）。
- **修复**：移动控制层的边框和背景改用现有实色语义 token，不再要求 `color-mix()` 才能保持浅色层级；同时保留 44px 触控、底部导航、华为 capsule 与小米系统表面合同。
- **候选身份**：0.12.95 已真实安装华为，不能在 UI 变化后复用。最终候选提升为 `0.12.96/1296`；0.12.95 只保留诊断事实，不补做 Windows/小米安装或正式资产。
- **回归证据**：新增旧 WebView 边框兼容合同，禁止移动控制层 border 再依赖 `color-mix()`；TypeScript/Cloudflare 类型检查、完整 Vitest `117 files / 861 tests` 与五组视口明暗四页面 production screenshot 通过。
- **最终构建与 smoke**：干净提交 `0ae54b4` 生成安装版与便携版；packaged UI、固定两态 mini、live fallback 全部回读 `0.12.96 / 0ae54b4` 并通过。Android official APK 回读 `0.12.96/1296`，JVM 36/36 与 lint 通过；其 SHA-256 为 `8E193CFC…25C86`。
- **三设备安装矩阵**：Windows 静默覆盖后卸载项 `FocusLink 0.12.96 / DisplayVersion=0.12.96`、安装 EXE `FileVersion=0.12.96 / ProductVersion=0.12.96.0`，启动日志回读 `commit=0ae54b4`。华为 DBY-W09 `192.168.1.7:5555` 的 `app.focuslink.mobile.staging.test` 与小米 xaga `192.168.1.5:5555` 的 `app.focuslink.mobile.staging.ui1294` 均 `adb install -r` 成功、启动并回读 `0.12.96/1296`；两台真实截图确认浅色兼容边框、底部导航与本机模式。
- **资产**：installer SHA-256 `613FA06F…F9C40`，portable `F76C3755…56C5E`；`release-v01296` 已收敛为四文件。0.12.95 未进入版本目录历史，打包中间产物移入 `.tmp`。
- **LFS 卫生与缓存阻断**：Git 观察器在旧 release 删除/新资产观察期间生成 `34,063,015,807 B`，LFS 正式暂存后又生成 `8,736,326,656 B` 临时文件；两次均确认无活动 Git/LFS 且大小稳定后移至独立 `C:\Temp\focuslink-lfs-tmp-20260824-v01296*`，仓库 `.git/lfs/tmp` 恢复 0。连同前六个隔离目录，当前待删除共 8 目录/1154 文件/`109,504,409,006 B`；用户已明确要求删除，但 `Remove-Item` 在进程启动前被执行策略拒绝，未绕过策略或假报清理。
- **发布状态**：源码已推送 GitHub `main`；未创建 tag 或 GitHub Release（用户未要求正式发布）。完整门禁中 format/Lint 仍只有未触及 `cloud/mcp` 的已记录存量阻断，本轮文件级检查通过。

## 2026-08-24 · v0.12.95 移动工作区重构、Dashboard 2.0 与设备授权诊断

- **用户证据**：用户明确反馈手机/平板 UI 比 PC 端差、审美混乱、界面逻辑失序；PC 基础可用但仍需升级，尤其是 Dashboard；同时反复登录无结果并要求清除缓存。
- **登录已验证事实**：canonical bootstrap 返回 HTTP 200 与严格 `login-required`，不是服务离线；真实 `poyi-oauth-as /owner/sign-in` 页面只有 `One-time code` 输入。服务端只消费符合 32 字节 base64url 形式的 43 位一次性管理员授权码，当前没有普通账号密码、注册、找回或自助取码入口。Windows 当日日志也没有完成设备登记的成功事件。
- **登录判断**：用户无法自然登录的根因是身份产品链未闭环且客户端此前误写成普通“账号登录”，不是用户操作错误。0.12.95 将入口改为“设备授权/多端同步”，明确三步、43 位管理员码和本机模式边界；没有通过写死验证码、展示 token 或清数据伪造成功。首台设备自助身份仍属未完成能力。
- **移动根因与修复**：0.12.94 同时显示顶栏标题、内页标题、双同步条、卡片舞台和浮动主操作，导致首屏被状态与容器占满；760px/横屏切入窄侧栏又压缩正文。0.12.95 移除重复内页标题和双同步条，计时主读数前置，任务/标题组成单一准备区；360/412/640/760/915×412 均使用底部导航，只有 ≥1040px 转侧栏，≥860px 只提升内容双栏。
- **Dashboard 与 PC**：移动看板改为结论 + 时间构成 + 四 KPI 的首屏组合；PC 零记录状态不再只显示一段空态文字，而是完整显示 0 分钟结论、四项零态指标和范围入口。桌面历史辅助会话轨收窄，分析画布采用有边界的主看板。
- **二次审美复核**：任务页把长期摊开的“新建清单”表单收为显式 disclosure，快速任务入口改为自然的“添加任务”；统计甜甜圈移除遗留分隔线。移动设置把六张字体预览卡收为单一选择行、五种强调色压成一行，并从普通页面移除会泄露 `Sync v2 ... HTTP 404` 的底层冲突管理面；账号、主题、强调色、字体与关于信息成为主路径。
- **自动化证据**：生产移动构建的 360×800、412×915、640×1024、760×1024、915×412 明暗四页面均无横向溢出、离屏元素或 <44px 主交互；横屏计时与主操作完整处于首屏。桌面明暗/最小窗四页面截图门禁通过；TypeScript/Cloudflare 类型检查、完整 Vitest `117 files / 860 tests` 与生产 desktop build 通过。全仓 format 仍被未触及 `cloud/mcp` 26 个存量文件阻断，Lint 仍为同目录 `tests/setup.ts` 的 namespace 存量错误及 2 个 warning；本轮改动文件级 Prettier/ESLint 无错误。dist、packaged smoke 与三设备同版实装待本轮后续追加。
- **缓存边界**：上一轮 6 个已从仓库隔离到 `C:\Temp` 的 LFS 临时目录合计 `66,705,066,543 B`；用户已明确要求删除，但本会话执行策略在命令启动前拒绝该删除。目录尚未删除，不得写成已清理；应用 SQLite、账号凭据、任务和会话数据从未进入删除目标。
- **Bug-01（Android JVM 测试路径与版本夹具）**：Android assemble 成功后，直接在中文工作区运行 JDK 21/Gradle test 时 7 个已生成 `.class` 全部报 `ClassNotFoundException`；响应文件 classpath 含中文路径，改用临时 ASCII `subst` 盘符后 35/36 真实执行，仅 `FocusLinkConfigTest` 仍把 `VERSION_NAME` 固定为历史 `0.12.87`。修复该断言为 `0.12.95`，后续 Android 门禁固定在 ASCII 盘符复跑；临时盘符在命令结束时解除，不改变仓库或系统持久配置。

## 2026-08-24 · v0.12.94 FocusLink 2.0 自有任务与三端视觉重做

- **需求证据**：用户明确表示 FocusLink 不应默认显示或依赖滴答清单，主要任务由用户在 FocusLink 内创建；三端 UI 与审美需要整体更新。
- **根因**：前一版虽已把本地任务设为数据主库，但 `DEFAULT_SETTINGS.taskSource` 仍为 `ticktick-cli`，任务刷新会在空本地库时探测并导入第三方；桌面任务、移动任务快照和错误态仍保留大量第三方语义。
- **修复**：默认 `taskSource=local`；本地模式下 `refreshTaskWorkspace` 只返回 FocusLink 本地任务，第三方 CLI/OAuth 只有在设置主动选择后才参与。任务页同步按钮在本地模式下不执行第三方任务队列。
- **UI**：桌面新增 FocusLink 2.0 视觉覆盖层，重做任务导航/执行列表/详情、专注仪表层、统计和设置的颜色、间距、边界和层级；移动端新增同源任务/专注/导航视觉层，手机和平板共享文案与状态语义。
- **自动化验证**：类型检查、桌面/移动生产构建、完整 Vitest `117 files / 860 tests` 通过；专项任务/设置/响应式合同 `9 files / 83 tests` 通过。移动 production screenshot 覆盖 360×800、412×915、640×1024、760×1024、915×412 的明暗四页面，均无横向溢出、离屏元素或低于 44px 的交互目标；桌面明暗与最小窗四页面截图门禁通过。本轮文件级 Prettier/ESLint 通过；全仓 `format:check` 仍被未触及的 `cloud/mcp` 26 个文件格式存量阻断，全仓 Lint 仍被 `cloud/mcp/tests/setup.ts` 的 namespace 存量规则阻断。
- **Windows 实装**：本地 dirty 候选安装器静默覆盖 exit 0；卸载项 `DisplayVersion=0.12.94`，安装目录 EXE 回读 `FileVersion=0.12.94 / ProductVersion=0.12.94.0`，应用已重启。该事实用于本轮验收，不冒充干净提交正式资产。
- **Android 签名边界**：正式 `app.focuslink.mobile` 在小米为 `0.12.87/1287`、华为为 `0.12.85/1285`，两台均因历史签名不同拒绝 `adb install -r`；未卸载正式包，数据保持原样。华为并存 `app.focuslink.mobile.staging.test`、小米并存 `app.focuslink.mobile.staging.ui1294` 均实际安装、启动并回读 `0.12.94/1294`。
- **真机视觉**：华为 DBY-W09 唤醒后截图确认新专注页、FocusLink 自有任务文案、单栏内容与底部导航真实渲染。小米 xaga 处于受凭据保护锁屏，像素截图为纯黑；WebView CDP 回读标题、完整 FocusLink 2.0 DOM、四项导航、`didaVisible=false`，故渲染结构已确认，锁屏后的可见像素验收仍为 **BLOCKED**。
- **Bug-09（深色主操作最终级联对比不足）**：packaged UI smoke 读取最终计算 token 后发现深色 `--app-accent` 仍配白色 `--app-accent-fg`，对比度仅 `1.92:1`。根因是 FocusLink 2.0 后置 `:root` 白色前景覆盖了基础层 `.dark` 的深色前景，而最终 `html.dark` 没有重新声明该 token。修复为在最终覆盖层显式设置深色前景，并新增直接解析最终层的 WCAG `>=4.5:1` 合同。
- **Bug-10（设置仪表预览超出固定舞台）**：packaged UI smoke 量得“游标标尺”和“制图描线”预览宽 `176px`，FocusLink 2.0 设置内容列的实际舞台仅约 `167.8px`，右缘超出约 8px。两种预览宽度收敛到 `160px`；smoke 同时更新为 2.0 的绿色/橙色语义 token，不再把旧版精确 RGB 当作不变产品合同。
- **packaged smoke 收口**：主界面 smoke 通过最终明暗操作对比、九套仪表完整舞台、idle/running/paused、沉浸、历史和设置链；mini smoke 通过固定两态、四边吸附、Win32 move-loop、长 `H:MM:SS`、长中文与 reduced-motion。live-fallback 夹具从已退役的任意 endpoint/synthetic token 更新为 canonical endpoint + 格式合法但认证失败的 `wrong-test` 设备凭据，证明账号实时握手未确认后本地 start/stop 仍成功，不放宽生产 endpoint/token 策略。
- **最终干净候选**：源码提交 `786c106` 生成 Windows 安装版与便携版，packaged UI/mini/live-fallback 三项 smoke 均回读相同构建身份并通过。安装版 SHA-256 `2D1DC7BE18976B0DDD38D1A5AD48B68FD6CFAD6B1C213381B657BDD2457A23EE`，便携版 `2DED12EEBC41C7D4933B86293681EDE333A7B32CBD5FD1C7FB20BB4ED05C1E10`；正式 Android debug APK 为 `4F8A9F6E808D7310F9BCE267620BA46B83D5E5D8DA9DC54CE64DC36FD3CA25E1`。
- **最终安装矩阵**：Windows 静默覆盖安装 exit 0，卸载项、EXE 文件版本均为 `0.12.94`，运行日志回读 `commit=786c106`。小米 xaga 最终地址 `192.168.1.4:5555`、华为 DBY-W09 `192.168.1.7:5555`，两台并存 staging 均覆盖安装、启动并回读 `0.12.94/1294`；正式包因历史签名保留旧版与数据。
- **发布卫生**：`.git/lfs/tmp` 三次被 Git 观察器分别写入 `4,674,849,792 B`、`3,413,861,376 B` 与 `12,546,168,996 B` 临时缓存；第三次由最旧 release 目录暂时进入删除态触发，恢复目录后消除该状态。每次均确认无活动 Git/LFS 进程后移至 `C:\Temp` 隔离，仓库临时目录恢复为 0；`.git/lfs/objects` 未动。Windows 打包首次因 winCodeSign 缓存创建 macOS 符号链接权限失败，使用本机已存在的完整 Windows 工具缓存后成功，未修改系统权限。

## 2026-08-23 · v0.12.93 华为平板真机连接与竖屏修复

- **连接**：华为 DBY-W09 已通过 `192.168.1.7:5555` 恢复 ADB，设备型号回读 `DBY_W09`。
- **签名边界**：正式 `app.focuslink.mobile` 是华为系统包/系统更新包，当前更新版 `0.12.85` 使用系统 debug 证书（SHA-256 `7eb76b41…`）；本机构建使用另一证书，`install -r` 返回 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`。未卸载正式包，旧数据保留。
- **安装**：移除无数据的旧 staging 测试包后，安装并启动并存的 `app.focuslink.mobile.staging.test`，版本回读 `0.12.93/1293`；通知权限已授予，前台 Activity 为 `app.focuslink.mobile.MainActivity`。
- **视觉复验**：0.12.91 首次截图发现 640 CSS 像素竖屏错误进入顶部导航/双栏；0.12.92 消除双栏但顶部导航仍受后置兼容样式覆盖；0.12.93 将高优先级覆盖置于 CSS 末端，真机截图确认品牌栏正常、内容单栏、四项导航固定底部。
- **同版状态**：Windows 已安装并启动 `0.12.93`；华为 staging 为 `0.12.93/1293`；小米当前 ADB offline，尚未安装。

## 2026-08-23 · v0.12.91 FocusLink 任务与账号同步闭环

- **任务主库**：FocusLink 本地任务和清单成为主数据源；滴答清单首次导入后转换为 `local` 任务，并保留父子关系和外部来源标记。
- **三端写回**：PC 和移动端可创建清单/任务；移动端完成/恢复任务通过账号任务快照写回。PC 刷新前拉取云端任务，按 ID 和 `updatedAt` 合并后再发布。
- **账号迁移**：旧 loopback 非账号凭据在升级时清除，设置切换到官方 HTTPS，等待用户通过正式账号入口登录。真实探针为 `deployed-login-required`，canonical/failover 健康检查均为 200。
- **UI**：手机与平板按短边阈值自动分层；手机使用底部浮动导航和计时优先首屏，平板使用顶部导航与宽屏内容结构；Android 默认启动图替换为 FocusLink 品牌图。
- **门禁**：完整 Vitest `117 files / 857 tests` 通过；PC build、Cloudflare typecheck、Android assembleDebug 通过。干净源码提交 `f1361e9` 重建后，Windows 注册表、安装目录 EXE 与运行日志均回读 `0.12.91 / f1361e9` 并已重启；手机和平板当前不在线，APK 未安装。

## 2026-08-22 · 番茄 To-do 手机不可见根因与状态分离

- **已验证根因（2026-08-22 23:11–23:17）**：电脑端 `cloudSyncGetStatus.isBound=true` 且上传接口成功，但小米手机番茄 To-do 进程连续记录 `UnknownHostException`，`CloudSyncManager` 明确报告无法下载 `pcd.fanqietodo.cn` 的专注记录。将应用 UID 加入后台联网与 Device Idle 白名单后，同一手机真实回执变为“文件下载成功”。这与四位配对码无关；云端账号绑定和电脑直连手机是两套状态。
- **第三方边界**：受控上传 17 条后，手机只下载 12 条，恰好对应最近 7 天；再单独投递窗口内 4 条，手机明确下载 4 条。番茄 To-do 的专注云文件是一次性批次投递，后一次批次可覆盖尚未消费的前一批次，且超过 7 天的记录会被静默过滤。不能把 `cloudSyncUploadRecord.success` 或本地 `isSynced=1` 表述为手机已显示。
- **修复**：TomaToDo bridge 增加可选 `syncToPhone` 路径，分别返回 `uploadConfirmed` / `phoneSyncConfirmed`；手机未直连时进入 `phone-pending`。桥接层同时拒绝把超过 7 天窗口的记录标成上传确认，返回 `tomatodo_record_outside_seven_day_window` 并保留 durable queue。产品不得静默篡改记录日期，历史补录需要用户明确选择可接受的新时间段。
- **门禁**：新增 7 天窗口回归后，TomaToDo 专项 Vitest `53/53` 通过，相关文件 Prettier 检查通过。根目录 typecheck 在平台分支仍受既有嵌套 Cloud/MCP tsconfig 包含范围影响，不能记作全量通过；Cloudflare MCP 自身 typecheck 已通过。真实手机云端下载回执已形成，直接手机通道仍为 `connectedCount=0`。

## 2026-08-23 · FocusLink 自有任务库第一阶段

- **判断**：滴答清单不再作为 FocusLink 的任务主库。它保留为迁移入口；首次读取后，任务、清单和父子关系归入 FocusLink 本地任务模型，再发布到登录账号的任务快照。
- **实现**：新增 `task_projects` 和 `tasks_cache.parent_id`，本地任务创建 IPC，桌面端快速创建入口，以及移动端列表/看板双视图。移动端任务文案改为 FocusLink 主库语义。
- **验证**：迁移去重、父子关系、任务工作台兼容、移动端任务树和云快照共 `32/32` 通过；完整 Vitest 的 `818` 个已执行断言通过，7 个 Electron 相关套件因当前 `node_modules/electron` 二进制缺失未能收集。

## 2026-08-23 · v0.12.88 本地验收构建

- **构建**：版本提升为 `0.12.88/1288`。补齐 OpenJDK、Android SDK 35/36、Build Tools 35 和 Electron Windows 二进制；桌面 `npm run build` 通过，Android `:app:assembleDebug` 通过。
- **资产**：APK 为 `FocusLink-0.12.88-1288-debug.apk`，SHA256 `9548F9207BF027F66084058B1248BDE21B06B0EE8434CF6732E23E77452639AD`；Windows 便携版 `FocusLink-0.12.88-x64-portable.exe`，SHA256 `6A7C05D1AA5B071709FA71F89C4EEDC93E134202F8F038C910E2E6C207B2E641`。
- **真实安装矩阵**：Windows NSIS 已静默覆盖安装，注册表 `DisplayVersion=0.12.88`、安装目录 EXE `FileVersion=0.12.88 / ProductVersion=0.12.88.0`、运行日志 `FocusLink version: 0.12.88`，应用已重启；小米与华为当前均未在线，ADB 安装未执行，不能标记为三端完成。

## 2026-08-12 · v0.12.87 候选身份升级与 UI 合同硬化

- **2026-08-18 GitHub 可下载交付证据**：按用户要求，远端 `main` 与 annotated tag `v0.12.87` 均回读到 release-record 提交 `9c9ab606bebaa930c2075bb59dbc118f5690a99f`；GitHub Release 为非草稿预发布，页面为 `https://github.com/666poyi666-collab/time-dida/releases/tag/v0.12.87`。安装版（170442233 B，SHA-256 `84181999DABFD53C0F20EA72CC40F66E60D02C42315E28A650D09AD4F37AAF4D`）、便携版（170218406 B，SHA-256 `B765B8C2D5A8E985858162C0897D9319091A14CFED75E670852DC3AC35EDBE0A`）、Android `FocusLink-0.12.87-1287-debug.apk`（26980020 B，SHA-256 `A91F65C96F96CA110AF6ADD5B1AEF135BFA124633DF662E3071BEDE0A0385A0E`）和 `SHA256SUMS.txt` 均为 `uploaded`，三个下载端点 HEAD 返回 HTTP 200；预发布不改变华为真机门禁 **BLOCKED** 状态。
- **Tag workflow 证据**：tag push 触发的 `Build and publish release` run `32087595307` 在 README 版本格式校验处失败，原因是工作流要求单独的精确行 `> 当前版本：v0.12.87`，不是构建、LFS、资产上传或下载失败。已在 `main` 后续提交修正 README；公开 tag 保持不可移动，手工创建的预发布资产继续以独立回读结果为准。
- **候选不可复用**：v0.12.86 的干净提交 `85c1155` 已完成 installer/portable、packaged smoke、Windows 与小米实装；华为 DBY-W09 未在线。此后 5-worker 审计推动桌面视觉 token/radius 合同与手机滚动到底部的 sticky CTA 几何门禁发生源码变化，因此旧 0.12.86 产物不得继续冒充当前候选。所有版本源统一提升为 `0.12.87/1287`，目标目录为 `release-v01287`；0.12.86 安装与哈希只保留为历史事实。
- **补修内容**：桌面主窗组件的非零 `border-radius` 统一通过 `--radius-*`；圆形和仪器槽位新增专用 token；literal 白/黑高光、遮罩与 dial shadow 改由主题高光 token 表达。`tests/styleContract.test.ts` 新增可失败合同，阻止散落圆角和 literal 高光回归。`mobile-viewport-screenshot.ts` 对 360/412 专注页新增滚动到底部后的 sticky CTA、底部导航和互不遮挡断言。
- **2026-08-12 人工视觉审计**：已查看桌面 idle/running/history/settings、mini running-expanded/light-paused-collapsed、移动 360/640/760/915×412 的代表性亮暗截图；未观察到裁切、重叠、黑边、绿边或嵌套卡片墙回归。该审计不替代多显示器混合 DPI 的真实拖放，也不替代华为平板实体 IME、capsule 与安装回读。
- **源码门禁结果**：Node `22.22.2` / npm `10.9.9` 下 format/typecheck/lint 均 exit 0；全量 Vitest `117 files / 850 tests` 通过；desktop `npm run build` 通过。Android `:app:testDebugUnitTest`、`:app:lintDebug`、`:app:compileDebugAndroidTestSources`、`:app:assembleDebug` 均成功。production mobile viewport 对 360/412/640/760/915×412 的亮暗四页面全部通过，无横向溢出，最小交互目标 44px；360/412 滚动到底部后的 sticky CTA 仍位于 bottom tabs 之上且无内容遮挡。
- **最终本地候选**：源码提交 `f4b3ce3` 的 `npm run dist` 精确生成 build identity `0.12.87 / f4b3ce3`，packaged UI、mini、live-fallback smoke 均 exit 0；`.git/lfs/tmp` 打包前后均为 `0 files / 0 B`。`release-v01287/` 恰为 installer、portable、SHA256、release notes 四文件，installer SHA-256 `84181999DABFD53C0F20EA72CC40F66E60D02C42315E28A650D09AD4F37AAF4D`，portable `B765B8C2D5A8E985858162C0897D9319091A14CFED75E670852DC3AC35EDBE0A`。Android APK 回读 `0.12.87/1287`，SHA-256 `A91F65C96F96CA110AF6ADD5B1AEF135BFA124633DF662E3071BEDE0A0385A0E`，备份为 `.tmp/android-apk-backups/FocusLink-0.12.87-1287-debug.apk`。
- **安装矩阵（2026-08-12）**：Windows 安装器 `/S` exit 0，卸载项 `DisplayVersion=0.12.87`，已安装 EXE `FileVersion=0.12.87 / ProductVersion=0.12.87.0`，应用已重启；小米 xaga 当前地址 `192.168.1.4:5555`，覆盖安装后回读 `0.12.87/1287` 并启动，旧 `192.168.50.250:5555` 只保留为 offline 历史。华为 DBY-W09 未出现在 `adb devices` 或 mDNS，历史 `192.168.1.7:5555`、`192.168.1.61:5555` 在有界探测内不可达，未安装。因此正式三设备同版门禁仍为 **BLOCKED（Huawei unreachable）**，本次按用户请求同步 GitHub `main` 并创建预发布候选，但不将其宣称为完整交付。
- **日期冲突证据**：packaged UI smoke 的历史页因主机异常时钟显示 2026-08-13；本轮权威当前日期、实施日志、安装矩阵和发布说明严格使用 2026-08-12，同时保留该冲突事实，不以错误时钟覆盖用户给定日期。
- **2026-08-12 第三方真实门禁补齐**：在现有登录态与隔离临时 marker 清理合同下，`npm run smoke:tomatodo:bridge`、`npm run smoke:tomatodo:real`、`npm run smoke:dida`、`npm run smoke:dida:state`、`npm run smoke:dida:ui -- <0.12.87 win-unpacked/FocusLink.exe>` 均 exit 0。TomaToDo bridge 通过标题与 `electronAPI` 身份校验且未重启用户进程；real smoke 回读 `cloudUploadConfirmed=true`、marker 幂等、本地 marker 清理成功，并准确保留 `cloudRecordReadbackSupported=false / remoteDeleteSupported=false / remoteCleanupVerified=false`。dida 覆盖中文评论、marker 恰一次、重复写跳过、30 秒原生 focus 与任务关联、普通任务完成/恢复，以及 packaged UI 的“完成 → 6 秒撤销 → 再完成 → 今日完成列表 → 恢复”可逆链；临时任务已删除。便携版也通过 `verify-startup.cjs`，回读 `0.12.87 / f4b3ce3` 与完整 Linear Workbench shell。
- **2026-08-12 小米系统表面结构证据**：当前 0.12.87/1287 暂停态通知为 foreground service（`ONGOING_EVENT | NO_CLEAR | FOREGROUND_SERVICE`）、启用 chronometer，并携带 `focuslink.systemSurface=xiaomi-island`、projection/business id 与 MIUI `param_island` 运行/暂停时间参数；`FocusNotificationService` 为 `isForeground=true`。这证明现行结构化 Xiaomi system-surface 路径正在产出系统托管通知对象，但不替代用户肉眼确认超级岛外观。`SYSTEM_ALERT_WINDOW` 已授权，当前窗口列表没有 FocusLink `APPLICATION_OVERLAY`，故 overlay 拖动/旋转/重启恢复仍为未执行人工门禁。
- **当前硬件边界**：Windows 会话实时枚举仅一台 `2560×1440 @ 100%` 显示器；不存在可用于多显示器混合 DPI 拖拽验收的当前硬件组合。mini smoke 明确只验证程序化四边放置与 `WM_ENTERSIZEMOVE/WM_EXITSIZEMOVE` 门禁，不把它写成真实鼠标拖拽。华为 DBY-W09 仍不在 ADB/mDNS，USB 历史接口未插入；因此华为安装、实体 IME/capsule、手机/平板真机任务树/overlay、0.12.87 PC-off 双机流程及多显示器混合 DPI 真实拖拽继续分别为 **BLOCKED / NOT_RUN**。OPPO OWW221 保持退役/冻结；本次按用户要求创建 `v0.12.87` GitHub 预发布候选并推送 `main`，不改变华为门禁未完成状态。

## 2026-08-12 · v0.12.86 UI 迭代（自动化与 packaged smoke 已完成，三设备实装待完成）

- **候选身份升级**：v0.12.85 已从干净提交完成三设备实装回读并推送 main；跨端 UI/行为继续迭代，按候选身份不可复用规则，本轮唯一源码版本升为 `0.12.86/1286`（release-v01286）。0.12.85 的 EXE/APK、卸载项版本与安装矩阵只保留为历史证据，不作为本轮安装矩阵。OPPO OWW221 按 2026-08-11 用户决定保持退役/冻结，本迭代不开发、不安装、不验证。
- **本轮方向（controller 已批准）**：桌面密度/断点打磨（980×660 仪器列与纪念碑级联冲突、账本宽度分层、辅助字号 ≥10px 下限）与固定两态 mini 打磨（不引入第三尺寸/自由缩放，保留置顶、吸附、320ms 收束折叠）；移动端连续工作面取代嵌套卡片、640 竖屏主操作粘性置于底部导航之上并预留高度、760 双栏（sidebar/树·详情）细化、清理半失效 legacy 620 覆盖层；IME/系统主题/a11y 修复（输入不遮挡粘性操作区、`system` 主题实时跟随、`partial` 状态完整换行与对比度/触控目标回归）。
- **诚实状态记录**：版本源已统一升为 `0.12.86/1286`。源码与本地回归已收口，Windows/小米/华为同版安装矩阵、最终四文件 release 目录、APK 备份与 GitHub `main` 推送仍未完成；未打 tag、未创建 GitHub Release。不得把 Android assemble、旧版本设备记录或离线 serial 写成本轮实装。
- **历史保留**：v0.12.85 的完整安装矩阵与既有 Bug-05/Bug-06/Bug-07 等记录原样保留，未改动；本轮不再新建平行 Bug 日志。
- **2026-08-12 验收审计与补修**：5 个锁定 `opencode-go/deepseek-v4-flash / max / 1M` worker 将 FL-REQ-20260811-UI-ITER 拆成桌面、mini、移动、同步后端与验收规范五条互斥证据线。新增 `tests/v01286UIIterationContracts.test.ts`（11 项）与 `tests/mobileTemporalRibbonPolicy.test.ts`（5 项）：锁定 IME 合同、移动首屏压缩带、侧栏事实行扁平化、空统计态、640 竖屏级联序、所有 focus-color 变体 token 的 WCAG 对比度，以及时间之带首分钟最多填充 2/3 且刻度可读。审计发现并已修复两项真实缺口：时间之带最小窗口由 60 秒提高到 90 秒；`--app-subtle` 与亮色 `--app-success`/focus-color 变体调整为在对应画布达到 ≥4.5:1。桌面/移动真实 Chromium viewport smoke 均 exit 0；Android `:app:testDebugUnitTest`、`:app:lintDebug`、`:app:compileDebugAndroidTestSources`、`:app:assembleDebug` 均 exit 0。另已清除误入快照提交且无产品引用的 73 个 `tmp/opencode-swarm-unbounded/**` runner 记录与 ignored `FocusLink/test-data/` 回归产物。Node `22.22.2` / npm `10.9.9` 下 format/typecheck/lint、全量 Vitest `117 files / 848 tests` 与 `npm run build` 已通过。
- **Bug-08（packaged mini smoke 随机 CDP 端口竞态）**：`mini-ui-smoke.cjs` 原先从固定 `9800..10199` 范围直接随机选端口，不检查监听占用；冲突时 Electron 本体可正常启动，但 smoke 的 `/json/list` fetch 连到错误/关闭端口并在 20 秒后报告 `Timed out waiting for main renderer: fetch failed`。独立 profile + 明确空闲端口实证 `59a12f3` 产物可返回主 renderer，排除产品启动和 business API authority 故障。修复为通过 Node `net.Server.listen(0, 127.0.0.1)` 让 OS 分配独立 loopback 端口，关闭预留 socket 后才启动候选；同时 smoke profile 显式禁用 Foxlink business API，避免与已安装实例 `127.0.0.1:18770` 冲突。修复后 packaged mini smoke exit 0，覆盖四边吸附/折叠、Win32 move-loop、明暗主题、长 `H:MM:SS`、中文 marquee 与 reduced-motion。稳定诊断见 `INSTALLER_TROUBLESHOOTING.md` `FL-INSTALL-007`。
- **最终候选与本地门禁**：最终干净打包身份为提交 `85c1155`，`npm run format:check`、typecheck、lint、全量 Vitest `117 files / 848 tests`、build、dist 全部 exit 0；`.git/lfs/tmp` 打包前后均为 `0 files / 0 B`。同一 `85c1155` 产物的 packaged UI、mini、live-fallback smoke 均 exit 0；UI 覆盖 1280×720/980×660、明暗主题、focus 状态与仪表预览，mini 覆盖固定两态、四边吸附、Win32 move-loop、长时长/中文 marquee/reduced-motion，live fallback 使用隔离 synthetic 凭据验证握手失败后的本地开始/结束。Android APK 经 `aapt` 回读 `versionName=0.12.86 / versionCode=1286`，SHA-256 `90518F6F1DBA9D4CB4B41D3BA17ADB7877606BBA45050E2DC8662616BAA90AA3`，备份位于 `.tmp/android-apk-backups/FocusLink-0.12.86-1286-debug.apk`。Windows 安装器 `/S` exit 0，卸载注册项、已安装 EXE 文件版本均回读 `0.12.86`，并已重启 `FocusLink.exe --hidden`。小米 xaga 通过 mDNS 当前地址 `192.168.1.4:5555` 在线，`adb install -r` 成功、回读 `0.12.86/1286` 并启动；旧 `192.168.50.250:5555` 继续作为 offline 历史事实保留。华为 DBY-W09 未出现在 `adb devices` 或 mDNS，历史 `192.168.1.7:5555` 与当前已发现邻居的 5555 均不可达，未执行安装；因此三设备同版门禁仍为 **BLOCKED（Huawei unreachable）**，不得写成完整交付或推送 main。`release-v01286/` 恰为 installer、portable、SHA256、release notes 四文件；installer SHA-256 `32EE1325CF5C4C4B1529A9E89C62918B125D5691413AC7EF0209F7B803A7B6D4`，portable `1D1DEE31DD8DECC156B4AD39691710EB46B73B538DCBBBF8F6A963F3D3D40E7A`。本轮未打 tag、未创建 GitHub Release。

## 2026-08-11 · v0.12.85 候选身份升级：loopback 端口安全与打包 smoke 收口

- **候选身份升级**：0.12.84 二进制从干净提交 `1c800a8` 打包，Windows/小米安装回读已作为候选证据记录；此后 loopback 同步服务器的 Fetch forbidden-port 修复与打包 smoke 收口（提交 `ba3ca82`）落地，当前源码已不再对应 0.12.84 二进制。按候选不可复用与三设备安装门禁规则，0.12.84 不得回填或复用，本轮唯一候选升为 `0.12.85/1285`（release-v01285）。0.12.84 的 EXE/APK 与卸载项版本只保留为历史证据，不作为本轮安装矩阵。
- **Bug-07（loopback 同步服务分配到 Fetch forbidden port 的间歇 flake）**：回环协议测试与嵌入测试后端在未显式指定端口时绑定动态端口 0，若 OS 分配的临时端口落入 WHATWG Fetch forbidden-port 列表（如 0、1、25、465、587、6000、6667、10080 等），客户端 `fetch` 会在发出前直接拒绝该 URL（`TypeError: fetch failed`），即使服务端实际正在监听，形成类似断线的间歇失败。修复契约：显式 forbidden port 在 bind 前拒绝；动态端口 0 至多有界重试（`MAX_DYNAMIC_PORT_BIND_ATTEMPTS=16`）且每次先关闭 forbidden listener 再重试；标准 forbidden 列表不可被测试 seam 绕开；并发 `listen()` 合并为同一次 in-flight bind 并返回同一地址；重试耗尽后服务保持关闭。回归见 `tests/deviceSyncServerPortSafety.test.ts`（标准端口判定、bind 前拒绝、seam 不可绕开、动态重绑、耗尽关闭、并发合并）。定向回归已在干净源码（提交 `e75e466`）复跑通过：全量 Vitest 114 文件 / 801 项全部通过，聚焦回归（`tests/releaseLfsHygiene.test.ts` + `tests/deviceSyncServerPortSafety.test.ts`）10/10 全部通过。
- **打包 smoke 收口**：live fallback 由 `scripts/smoke/write-synthetic-device-credential.cjs` 在隔离 userData 内用 Electron `safeStorage` 现场加密 synthetic 非生产令牌；helper 拒绝系统临时目录之外的目标与非 `focuslink-live-fallback-` 前缀目录，`safeStorage` 不可用或加解密失败时在有界超时内明确失败，不以 `SKIP` 计过；smoke 只读隔离 profile、绝不读取或复制当前账户真实凭据，端点使用已关闭的 loopback 端口验证“首次实时握手失败 → 本机计时可开始 → 可结束”。mini smoke 增加 bring-to-front 断言：置顶动作后收起态几何与 Win32 前台窗口身份（handle/processId/title）保持不变；临时 userData 清理采用有界重试且不覆盖首个产品/断言错误。上述脚本已在干净源码 `e75e466` 的 `npm run dist` 产物上实跑通过：packaged UI smoke、mini bring-to-front smoke、隔离 live fallback smoke 均 exit 0，产物内嵌 `APP_COMMIT='e75e466'` 且无 `-dirty`。
- **LFS 事故记录保持**：2026-08-10 Bug-06 的 1.02 GiB（1,094,854,656 B）事件时间线仍以本日志 Bug-06 与 `INSTALLER_TROUBLESHOOTING.md` `FL-INSTALL-006` 为唯一记录，不另建平行报告。
- **当前状态（主流程已回填）**：0.12.85 已从干净提交 `e75e466` 正式打包（installer/portable，`npm run dist`，Node 22.22.2），packaged UI/mini/live-fallback smoke 均通过。Windows、华为 DBY-W09（`f8630574`）和小米 xaga 均已安装同版 `0.12.85/1285` 并完成启动回读；三设备门禁已闭合。小米恢复证据按时间先后同时保留：恢复前旧 TCP serial `192.168.50.250:5555` 处于 offline；2026-08-11 起以 mDNS serial `adb-D68P65855TPBHYWS-P0OKFa._adb-tls-connect._tcp` 重新在线，并完成 `0.12.85/1285` 实装回读，旧 offline 不当作当前连接故障。OPPO OWW221 已按 2026-08-11 用户决定退役，不再开发或纳入新版本门禁。`release-v01285/` 恰为四文件；LFS 门禁回读 0 文件 / 0 B，正式 SHA-256 已回填。此前推送 main 受历史超大非 LFS blob 拒绝的阻塞已解除：完整最终树已干净 squash 整合并推送 GitHub main，提交 `40d6dec`（`feat: deliver FocusLink v0.12.85 focus guard`），历史超大非 LFS blob 已从该整合提交历史中剔除；历史推送失败仅按 Bug-06 / `FL-INSTALL-006` 保留为先前证据。本迭代未打 tag、未创建 GitHub Release——用户未要求正式发布。

## 2026-08-10 · v0.12.84 Electron 旧 chunk 构建事故收口

- **Bug-05（重复 build 污染 app.asar）**：0.12.82 打包后只读展开 `app.asar`，入口指向新 `main-CDnq42AK.js`，但 archive 同时残留上一轮 `main-BZNWRpZc.js`，并各有两份 `deviceSyncV2Service` chunks。根因是多套 Vite Electron build 共享 `dist-electron` 且总 build 前未清目录；版本/commit 虽正确且无 `-dirty`，候选仍必须作废。
- **Bug-06（Codex review 触发 LFS 临时文件暴涨）**：2026-08-10 09:56:10～09:59:40，0.12.84 dist 完成后 `.git/lfs/tmp` 从 0 增至 10 文件 / 1,094,854,656 B。现行进程链为 Codex desktop `ChatGPT.exe` → `git diff --no-index ... release-v01284/FocusLink-0.12.84-x64*.exe` → `git-lfs filter-process`，不是 builder、计划任务或普通 source diff。停止该精确扫描链并把两份 EXE 暂移到项目忽略目录后，目录连续 109 秒不再增长且无 git/git-lfs 进程；只删除 `.git/lfs/tmp` 后回读 0 文件 / 0 B，未触碰 `.git/lfs/objects`。后续按 `FL-INSTALL-006` 先以本地 `.git/info/exclude` 隔离未跟踪 EXE，再单件恢复并观察；正式暂存前必须移除本地 attributes guard 并复核 LFS 属性。
- **版本身份**：0.12.82 EXE/APK 已隔离且不得回填；并行隔离树已生成 `0.12.83/1283`，为避免复用任何已生成 build number，主线唯一候选升为 `0.12.84/1284`。
- **修复**：新增 `clean:desktop-build`，在 gen-version 后、TypeScript/Vite 前删除经过路径约束的当前工作区 `dist-electron`；隔离临时目录测试验证真实 stale chunk 被移除，并锁定 package build 顺序。后续 app.asar 必须只有当前入口引用的一套 main/preload/service chunks。
- **当前验证**：Node 22.22.2/npm 10.9.9 下 format/typecheck/lint 通过，全量 Vitest 113 文件/792 项通过，其中 desktop build hygiene 2/2 真实删除隔离 stale chunk；0.12.84 Windows app.asar 只含当前 `main-InPGSVQQ.js`、`deviceSyncV2Service-zqrX8mpq.js`、main/preload，内嵌版本 0.12.84、commit `1c800a8` 且无 `-dirty`。packaged mini smoke 最新实跑 exit 0（28.5 秒），隔离 live fallback smoke exit 0（2.3 秒）；live fallback 使用隔离 userData，由 Electron `safeStorage` helper 在临时 profile 生成 synthetic 非生产令牌，未读取或复制当前账户真实凭据；mini smoke 额外实测置顶调用不改变收起态位置、viewport 或吸附边。Windows 已静默覆盖并回读卸载项 `DisplayName=FocusLink 0.12.84`、`DisplayVersion=0.12.84` 和文件版本后重启。Android 0.12.84/1284 JVM 36/36、lint 0 error、AndroidTest 编译与 assemble 通过。小米 `192.168.50.250:5555` 当前在线并回读 `app.focuslink.mobile=0.12.84/1284`；华为 `192.168.1.7:5555` 当前已转 offline，本轮不能据此形成 0.12.84/1284 回读证据；OPPO/手表按用户要求本轮不处理。正式四端发布门禁继续未完成，不得把本地 APK 构建、单台版本回读或旧版本设备记录计为完整实装矩阵。
- **资产与 LFS 状态**：安装版 SHA-256 为 `D70A0DAFD54CCEF0A222F8BBB841B5992A17A0971E6DD0C1EF5EE7DC5ACB96B4`，便携版为 `3CD47A034D94A36565257246D81EF5A33D192EC2CF1F1D5620F7BD6F1035B510`。Bug-06 清理后 `.git/lfs/tmp` 回读 0 文件 / 0 B；但 `release-v01284/` 当前仍含 `win-unpacked/`、`builder-debug.yml` 和 blockmap，尚未达到四文件发布目录门禁。正式暂存前仍须移除本地 attributes 防护、复核两份 EXE 的 `filter: lfs` / `diff: lfs`，并再次确认 tmp 稳定为 0；这些步骤未发生前不得写成 LFS 发布门禁已通过。

## 2026-08-09 · v0.12.82 候选身份升级与实时连接修复收口

- **候选不可复用**：0.12.81 APK 生成后又修复了 Android failover-first、第二 origin 的 401/403 状态保真，以及移动备用域名 long-poll 的语义超时；因此 0.12.81 不得安装或回填，本轮唯一源码候选升为 `0.12.82/1282`。
- **本轮 Bug 结论**：保留 v0.12.81 的 Bug-01（workers.dev DNS/443 阻断）、Bug-02（前后台旧请求与备用长轮询超时）和 Bug-03（Android failover 顺序/身份状态）记录；当前实现已统一固定备用域名优先、权威 HTTP 结果不跨域吞掉、长轮询按请求语义等待。
- **Bug-04（renderer 仍猜测旧中文状态）**：终审发现设置 presenter 仍以中文正则兼容旧 transport/conflict 文案，违反 machine-code-only 合同。现已从 renderer 完全移除本地化正则；Electron 读取 durable meta 时通过共享纯函数把三类已知旧值迁移为 `network_error/timeout/conflict_present` 并原位回写，未知文本统一降为 `sync_failed`，不会跨 IPC 或泄露到 UI。
- **最终接线收口**：任何 HTTP 响应（包括 408/425/429/5xx）都视为当前 authority 的权威结果，只有 transport/network/timeout 才允许尝试另一固定 origin；Capacitor `appStateChange` 的 active 状态与 DOM visibility 分别持久保留，`pageshow` 不再把 native inactive 错写成 active；live effect 在创建请求前再次经过组件级 active/visibility gate，后台发生 online、凭据恢复或其他依赖更新也不能重新启动 long-poll；结构化连接原因同时进入顶部状态条和专注控制台详情，成功 snapshot 后立即清除，不再残留旧“自动重连”文案。
- **当前验证**：Node 22.22.2/npm 10.9.9 下全量 Vitest 112 文件/790 项，typecheck/lint/format 通过；Android JVM 36/36、lint 与 AndroidTest 编译通过。尚未构建或安装 0.12.82；Windows/Xiaomi/Huawei 同版安装、前后台/网络切换真机 smoke 待执行；按用户本轮要求不处理 OPPO/手表，正式四端发布门禁保持未完成。

## 2026-08-09 · v0.12.81 实时连接故障与桌面小窗置顶修复候选

- **Bug-01（真实 transport 阻断）**：小米 `D68P65855TPBHYWS` 与华为 `f8630574` 在 v0.12.80 前台实时控制均显示“实时连接中断 · 自动重试中”。只读证据显示两台设备都在普通 Wi‑Fi、无 VPN/HTTP 代理；`workers.dev` DNS 答案持续漂移到异常地址，TCP 443 在 TLS 前超时，未产生 401/403，因此不是凭据或权限错误。小米 WebView Resource Timing 的 `/sync/v2/live`、`/sync/v2/tasks`、`/sync/v2/status` 均 `transferSize=0`；native authority 也写入本轮 `network_error`。
- **根因与可逆处理**：当前网络对 `*.workers.dev` 存在持续 DNS/443 阻断。受控自定义同步域名 `https://focuslink.pyzzgk.dpdns.org` 在同一网络只读返回 `/healthz=200`、无凭据 `/sync/v2/status=401`，证明它仍指向同一云端 authority。客户端新增固定白名单 failover：实时控制、任务快照、移动 Sync v2 和 Android 原生 CloudClient 优先走该数据面备用域名，失败再回 canonical；不接受任意用户域名、不改变账号登录域、不得清 token/cache/checkpoint 掩盖故障。
- **Bug-02（生命周期重连与 long-poll timeout）**：WebView/Capacitor 隐藏时旧 live long-poll 未显式中止，OEM 恢复可能继续占用旧请求；同时 failover-first 接线仍把 `candidate !== stored endpoint` 的请求截为 8 秒，导致备用 origin 的合法 25 秒 bounded wait 在无 revision 变化时被客户端提前中止，随后误落到受阻 canonical。现在 document visibility、pageshow 与 Capacitor `appStateChange` 共用单一 lifecycle policy；inactive 立即 abort，active 以 generation/epoch 启动唯一新 loop；两个固定候选都保留当前请求的语义 timeout。401/403、协议错误和非重试拒绝不再显示“自动重试中”；网络、超时、409、5xx/rate-limit 保持有界退避。
- **Bug-03（Android failover 顺序与身份状态）**：候选回读发现 `FocusCloudClient` 仍先请求已知受阻的 canonical，最坏先等待 8 秒 connect timeout 才切备用域名；且首个 transport 失败后，第二个 origin 的 HTTP `CloudException` 被重新包装，401/403 的结构化状态丢失，账本 Worker 会把确定性身份拒绝误判为可恢复错误继续排程。现与 TypeScript 统一为固定备用 origin 优先、仅首个 `IOException` 后回 canonical；任一 origin 的 HTTP 响应都原样保留，未知 origin 不派生候选，401/403 可被 Worker 明确停止重试。
- **桌面小窗可用性**：新增独立 `mini:bring-to-front` IPC 与设置页“置于最顶层”按钮。动作只 `showInactive → setAlwaysOnTop(true) → moveTop()`，不抢焦点、不改变两态尺寸、位置、吸附或拖动语义。
- **当前验证**：Node 22.22.2/npm 10.9.9 下定向实时/生命周期/mini 与相邻回归已通过，全量 Vitest 112 文件/789 项，typecheck/lint/format 通过；Android unit 36/36、lint、AndroidTest 编译通过，新增 failover 顺序、未知 origin 与 401/403 保真回归。该 v0.12.81 候选已被 v0.12.82 取代，不得安装或回填；Windows/Xiaomi/Huawei 同版安装和真机前后台/备用域名 smoke 待在 v0.12.82 执行；按用户本轮明确要求不处理 OPPO/手表，正式四端发布门禁保持未完成。

## 2026-08-09 · v0.12.80 终态拒绝与 authority freshness 修正

- **候选身份升级**：v0.12.79 构建后又发现桌面 `rejected_operation` 仍被误报为整体“跨设备同步失败”、Android authority 将 terminal attention 混入 offline freshness，且旧 `dist-electron` 目录残留 `aba1f59-dirty` chunks。按四端候选不可复用规则，0.12.79 不晋级，版本升为 `0.12.80/1280`；旧 EXE/APK 不得回填。
- **状态语义修复**：桌面 presenter 将 `rejected_operation` 独立呈现为 warning“同步已连接，部分记录未同步”，保留记录并等待处理；Android `conflict_present/rejected_operation` 作为 attention，不再因 `lastAttemptAt > lastVerifiedAt` 伪报 offline；已有 verified projection 保持 fresh/stale，无 verified projection 保持 unknown 并继续脱敏。
- **时序 Bug 修复**：发现上一轮 ledger `network_error` 会在本轮 status 已完整校验、随后收到 terminal ACK 时继续污染 authority freshness。现由 `recordLedgerCheckpoint()` 在同一持久化提交中仅清除 ledger projection 的旧错误，live poll diagnostics 不受影响；新增隔离 instrumentation 序列断言 `network_error → validated checkpoint → terminal attention` 不再得到 `offline`。
- **构建卫生修复**：正式构建前清空 `dist-electron`，确保 app.asar 不含上一轮 dirty chunk；版本元数据由干净源码提交重新生成。
- **门禁**：Node `22.22.2` / npm `10.9.9` 下 format/typecheck/lint、全量 Vitest 110 文件/778 项、cross-device 6 文件/47 项、Android JVM 7 个 suite/32 个测试与 lint 0 error 已通过；干净 Windows app.asar 无旧 dirty hash。Windows 已静默安装并回读 0.12.80；小米 `D68P65855TPBHYWS`（`.4:5555`）与华为 `f8630574`（`.7:5555`）已安装同一 `0.12.80/1280` APK，启动无崩溃/ANR，terminal lifecycle instrumentation 各 4/4 真机通过；APK 已备份并复核 SHA256。旧 0.12.79 小米 instrumentation 首次执行暴露的 `nextCursor="isolated-cursor"` 夹具已改为合法 `c1`。OPPO OWW221（历史 `.44:5555`）仍不可达且无可核验序列号，四端正式门禁、最终四文件目录和发布仍未完成。

## 2026-08-08 · v0.12.79 同步连接事故语义收口

- **事故事实**：已安装 v0.12.78 的脱敏配置指向 canonical `foxlink-cloud-mcp` HTTPS origin，设备同步、自动同步和实时控制均启用。Windows 日志在 `2026-08-08T05:42:40Z`～`05:42:44Z` 记录两次 canonical Sync v2 `network_error`（periodic/resume），liveFocus 又在 `05:42:41Z`、`06:30:53Z`、`08:10:02Z` 记录连接丢失和 2 秒重试；这些是当时真实发生的失败，不能因后续恢复而删除或改写。
- **当前恢复证据**：同日稍后，系统 DNS 可解析但落入 `198.18.0.0/15` 合成地址范围，提示本机代理/TUN 路径；TCP 443 建连成功。公开 adapter 的正确匿名探针 `GET /healthz` 连续三次返回 HTTP 200（服务标识 `foxlink-cloud-mcp`），无认证 `GET /sync/v2/status` 返回 401，证明当前 DNS/TCP/TLS、adapter 路由和鉴权拒绝边界正常。旧 Node loopback 的 `/health` 在该公网 adapter 返回 404 属路径不匹配；bootstrap 为远端写操作，未用于探测。
- **Windows UI Bug 与修复**：同步成功后 Electron v2 服务会在存在未解决冲突时持久化机器码 `lastError=conflict_present`。`getDeviceSyncStatus()` 优先返回该 stored error，而 v0.12.78 设置页只匹配中文“未解决的跨设备冲突”，使机器码落入 danger/“跨设备同步失败”。v0.12.79 新增纯函数 presenter 并由 `SettingsPanel` 实际接线：transport、conflict、authentication、authorization 与协议/拒绝错误按机器码分域；`conflict_present` 只有在 `unresolvedConflicts > 0` 时显示“同步已连接，有记录待确认”，count 归零时忽略陈旧码并回到最近成功状态。组件接线契约禁止旧中文正则回流。
- **跨端同类修复**：移动账本只有 legacy/V2 pending、conflict、unresolved conflict 与 rejected 全为 0 时才显示“账本同步已确认”；任一非零都进入 `partial`，安全保留待处理数量和结构化诊断码，deferred V2 retry 也计入 UI 与原生投影。待处理数量按 completed-session identity 做 legacy/V2 并集，排除已绑定其他 device 的记录；未绑定 legacy record 由当前 device 一次性 CAS 认领，后续设备不可重新认领。分页/物化成功只更新 transport `lastSyncAt`，只有全 clean round 才更新 scoped `lastVerifiedAt`；partial、重启和 retry 均保留上次完整确认时间。Android completed-ledger 对 conflict/rejected ACK 写入独立 terminal sidecar，保留原始 outbox但从普通 WorkManager 队列排除；authority projection 合并 terminal 数量/安全错误码，其他记录成功不能清掉该 attention 状态。OPPO watch 对 applied/duplicate/conflict/rejected 四类 ACK 都明确展示结果，未知拒绝码不直接展示。
- **安全收口**：Windows 主进程 durable status、renderer 刷新失败与 presenter 未知输入全部压成 allowlisted code/固定安全文案，不持久化或回显任意上游 `error.message`。Android outbox 的 forbidden-key case fold 使用 `Locale.ROOT`，避免区域设置绕过敏感字段过滤。
- **根因与边界**：同一个 `lastError` 字符串混用了 transport/auth 错误和已成功同步后的 durable attention 状态，renderer 又以本地化文本正则推断类别。0.12.79 必须按稳定结构化 code + `unresolvedConflicts` + 最近成功证据渲染；不得通过清 token、清 checkpoint、删 SQLite、重做 bootstrap 或吞掉历史 `network_error` 修饰结果。
- **禁止复发门禁**：每轮开始前先读本日志、`SYNC_TROUBLESHOOTING.md` 对应稳定编号和完整 `TEST_AND_RELEASE.md`。桌面状态回归至少覆盖 `null/success`、`network_error`、timeout、401/403、`conflict_present`（count 0/>0）与 `rejected_operation`；移动账本必须分别断言 clean/applied、conflict、rejected 和 transport failure 的 projection、notice 与 pending 数；Android Worker 必须断言 applied/duplicate 才删除 outbox，conflict/rejected 进入可见的持久终态且不自动无限 retry，只有瞬时 transport/5xx/rate-limit 才退避重试；watch 必须逐一显示 applied/duplicate/conflict/rejected ack，且 conflict/rejected 不得静默或写成“已确认”。transport、auth、冲突和第三方投递文案不得互相冒充，并以“历史日志 → 当前无凭据 health/route → 产品结构化状态”的顺序留证。
- **Android terminal 修复闭环**：原始 outbox 仍在 conflict/rejected 后保留并退出普通 WorkManager 队列；用户先在电脑端处理，再在 Android 原生控制区显式点击“重新检查”。Plugin 先通过当前 device + connection lease barrier，再提交携带持久 expected device id 的独立 unique work + `REPLACE`；terminal marker 在执行前保持不变，普通 `KEEP` worker 永远不可读取，排程失败、进程重启和 A→B 账号切换都不能形成裸 pending。只有 expected device 仍匹配时，显式 Worker 才读取 terminal 记录；applied/duplicate 后删除 outbox 并同步清 sidecar，孤立/重复 marker 不计入 requeue 且会安全回收。隔离 SharedPreferences instrumentation 覆盖 terminal→排除普通 retry→显式 recheck→applied/duplicate→双清理、错误 device/lease、账号切换、排程失败与孤立/foreign marker 边界。
- **当前状态**：版本源已统一升为 `0.12.79/1279`。Node `22.22.2` / npm `10.9.9` 下 format/typecheck/lint、110 文件/778 项全量 Vitest、6 文件/47 项 cross-device、Web/Cloud/桌面 build、Electron regression、Cloudflare 本地协议与 production viewport smoke 已通过；Android JVM 31/31、lint 0 error，隔离 terminal lifecycle instrumentation 已编译通过但尚未在真机执行。干净提交、正式 dist/APK 和 Windows/小米/华为/OPPO 四设备同版实装仍未完成，不得写成发布完成。
- **真机门禁夹具修正**：首次在小米 runner 执行 terminal lifecycle 时，两个断言连锁失败；根因是 instrumentation 的 synthetic Sync v2 status 使用了不符合正式协议的 `nextCursor="isolated-cursor"`，而协议只接受 `^c[0-9a-z]+$`，Worker 因此在 status 校验阶段提前进入通用失败/重试分支。已将夹具改为合法 `c1`；这是测试数据合同错误，不是产品云端故障，后续新增夹具必须复用协议 validator 约束并先执行真实 runner。

## 2026-08-08 · v0.12.78 强制版本身份升级

- **候选替代**：`0.12.77/1277` 已在小米安装，之后继续修改移动横屏 UI 与 Cloudflare 同步行为；按三设备安装门禁，任何已安装候选在后续变更后均不可复用，当前版本统一升为 `0.12.78/1278`。
- **横屏首屏修复**：`915×412` 隐藏重复专注标题栏，主读数与操作区保持双列；production viewport smoke 直接校验操作区和主按钮完整处于视口内，并复跑 360/412/640/760、平板、亮暗主题、字体 profile 与两种 OPPO renderer。
- **任务快照防冻结合同**：Cloudflare Account DO 与 loopback store 对齐 `publishedAt <= serverTime + 5 分钟` 的上限；超限为 `422 task_snapshot_timestamp_too_far_ahead`，旧 `publishedAt` 仍为 `409 stale_task_snapshot`，同时间异文为 `409 task_snapshot_conflict`。持久化的 legacy far-future 快照允许被合法新快照恢复。桌面 pending 只在当前 scope/generation 的该 422 分支至多 GET 一次可信 `serverTime` 并重戳重试一次；stale 可清除，conflict、第二次 422 与所有读取/解析/重试失败都保留 pending。
- **Cloudflare gate 状态边界**：external run/verify 只允许显式 opt-in 的 loopback disposable Worker；`FOCUSLINK_TEST_STATE` 限定受控临时目录、直系允许文件名、真实目录/普通文件与 identity 复核，创建使用 exclusive create，状态序列化不含 credential。external verify 不自动删除外部状态文件；只有 local 隔离 gate 清理自己创建的临时状态与持久化目录。
- **平台合同收口**：Android Focus Guard 拒绝 same-root rotation，Windows root store 的共享 mutex/CAS、不可逆 `revoked`、account/generation key binding 与 main-process writer 边界完成复核。
- **Cloudflare 正式工具链升级**：Worker 保持 `compatibility_date: 2026-07-25`。Node `20.20.2` 下可运行的 Wrangler `4.86.0` 仅携带支持到 `2026-05-03` 的 workerd；支持当前日期的 Wrangler `4.114.0` 则要求 Node 22。正式运行时因此升为 Node `22.22.2` / npm `10.9.9`，并精确锁定 Wrangler `4.114.0` 与 `@cloudflare/workers-types` `5.20260724.1`；不通过回退 compatibility date 规避门禁。
- **代码与真实服务门禁**：format/typecheck/lint、107 文件/741 项 Vitest、Electron regression、44 项 cross-device、Web/Cloud/Android build、Android unit/lint 与 Focus Guard 5/5 均在 Node `22.22.2` / npm `10.9.9` 下通过。Cloudflare Sync v2 隔离 run/verify/persistence 连续通过，canonical bootstrap 为脱敏 `deployed-login-required`；真实 dida 与 TomaToDo bridge/upload smoke 通过，TomaToDo cleanup 仅为 `local-record-only`。
- **当前门禁**：v0.12.77 未完成 Windows、小米、华为与 OPPO OWW221 的四设备同版门禁，也未发布。v0.12.78 不继承旧候选的安装证据，须在重新构建后完成同版安装回读与强制验证。

## 2026-08-04 · v0.12.77 跨凭据 provider 回写与四端门禁收口

- **版本替代**：0.12.76 候选仅实装 Windows、小米、华为，强制 OPPO OWW221 未在线；候选生成后又补了跨端 UI 与 provider 行为，按硬规则作废并升为 `0.12.77/1277`，不复用旧安装包或 APK。
- **稳定 provider scope**：Sync v2 transport checkpoint 仍按 endpoint + 完整 device token 隔离；dida/TomaToDo durable queue 对 canonical `fl2` 改按 endpoint + `accountPublicId` 匿名哈希，同账号 token 轮换不会把旧工作永久搁置，legacy loopback 仍按凭据隔离。
- **历史回填**：每轮 canonical sync 从 `focus_ledger_v2` / `focus_metadata_v2` 的远端来源状态扫描已物化会话，在 SQLite 事务内幂等补齐 dida/TomaToDo 意图对；完整 pair 已存在时不再调用 enqueue，completed/pending/claimed 状态均不被重置。
- **Cloudflare Sync v2 任务快照**：Account DO 与 loopback store 都把 `publishedAt` 作为单调 register；相同 device/payload 可重放，较旧 timestamp 返回 `stale_task_snapshot`，同 timestamp 异文返回 `task_snapshot_conflict`，移动端仍只按 server revision 前进。
- **TomaToDo 清理语义**：`cloudSyncUploadRecord` success 仅为上传确认；当前没有 PCRecord 远端回读/删除 API，cleanup 固定为 `local-record-only`，不得写成远端删除已验证。
- **移动补漏**：production viewport 首轮发现 360px 设置页主题选择器只有 38px；源码复核又发现 640×1024 虽保持四列导航，旧 620px sidebar 的 `top/grid-auto-rows` 却把 fixed 控制层拉成整页覆盖。主题选择器提升到 44px，Apple base 显式重置遗留 geometry，smoke 新增导航 top/bottom/height 断言；修复后 360/412/640/760/915×412 的亮暗四页面、任务展开及 189×248/320×420 手表 renderer 全部通过，无横向溢出。
- **候选终止状态**：该版本在四设备实装前被后续横屏 UI 与 Cloudflare 修改取代；完整 107 文件/741 项测试、真实 dida/TomaToDo 与 Cloudflare 门禁结果归入 v0.12.78。0.12.77 不补做同版安装、最终资产或发布。

### Stage B 边界（2026-08-04）

- 32-byte account root、独立 recovery/rotation envelope、V1 guard payload crypto、Windows `safeStorage` vault 与 Android Keystore vault 已在本地源码和合成 fixture 中实现；V1 `focus_guard_*` envelope 字段未增加 root generation 或恢复字段。
- 覆盖 wrong root/account/AAD/entity/revision/operation、nonce/tag/ciphertext/AAD 篡改与截断、generation rollback/replay、corrupt/lost/recovery-required/revoked 和 secure-storage unavailable；安全存储失败不降级明文，root/recovery secret/解密明文不进入日志、WebView、renderer、APK 常量或云端 payload。
- 本阶段仅本地源码、JVM/Vitest 自动化与 Android unit test；未部署 Worker/DO/gateway，未读取或写入 production secret，未打包、未安装任何设备，未接入“不做手机控”的提交/解密桥。Stage C/D 仍需单独批准。
- 追加收口：Android Keystore alias 丢失时，READY 快照的恢复 high-water 自动推进到下一代；SharedPreferences 状态写入同时拒绝跨账号、generation 回退和从 revoked 状态降级，避免旧 recovery envelope 或篡改状态重新激活旧 root。
- Windows root store 按 root 文件共享 mutex，并以落盘前记录版本 CAS 防止多实例覆盖；加密 material 与 account/generation/keyId 三元组交叉校验，`revoked` 不可降级。writer 仍限 Electron main 本地 vault，未向 renderer/IPC 或 Cloudflare Sync v2 发布面暴露。

## 2026-08-03 · v0.12.76 移动端平台化 UI 与远端 provider 自动回写

- **移动交互**：主专注页删除 `<select> + 横排浏览按钮`，改为单一「从云端任务清单选择」disclosure；云端快照任务页保留项目分组、父子树、搜索、完整父路径、独立选择和开始动作。
- **视觉边界**：手机、平板和移动 Web 共用 Apple HIG 启发的 grouped content 与系统字体；内容层保持高可读标准材质，导航/控制层只允许克制材质增强并提供不支持 blur、减少透明度和减少动效回退。Windows renderer、两态 mini、华为胶囊、小米系统表面和手表 renderer 不改。
- **同步事务边界**：Sync v2 物化新的远端 completed bundle 时只在当前 SQLite 事务登记 `dida` / `tomatodo` 两条幂等意图；事务提交后的 coordinator 才执行外部副作用。每个 provider 独立 claim/lease、独立完成或指数退避，过期 lease 可跨重启回收。
- **队列复用**：滴答回写复用 marker 幂等的 `sync_queue`；番茄 To-Do 复用 durable segment 队列，后台路径不启动外部程序，桥不可用或未确认上传时继续保留 pending。
- **版本候选**：全端版本提升到 `0.12.76/1276`；测试、构建、实装和哈希证据在完成后追加到本节。

### 2026-08-03 · v0.12.76 操作日志 / 进度 / Bug 记录

- **进度**：代码（39 文件、+2902/-465）与版本源已在 8/3 自动快照提交（3d838d6/b69fda7）中就绪；本轮完成门禁、打包、三端实装与推送。
- **Bug-01（升版断言遗漏）**：`tests/mobileAccountBootstrap.test.ts:123` 的 `appVersion` 断言停在 `0.12.75`，升版到 0.12.76 后未同步，全量测试失败 1 项。修复：改为 `0.12.76`，提交 `6ee371c`。
- **Bug-02（格式漂移）**：`electron/sync/deviceSyncV2Service.ts`、`electron/sync/remoteWritebackStore.ts` 未过 prettier；`npm run format:check` 报 2 个文件。修复：`prettier --write` 归一，提交 `af4dfd7`。
- **门禁**：format/typecheck/lint 全过；104 个 Vitest 文件/709 项全部通过；Android `:app:testDebugUnitTest`/`:app:lintDebug`/`:app:assembleDebug` 通过；`npm run build` 通过。
- **打包**：干净提交 `af4dfd7` 生成 `release-v01276` 四件套；win-unpacked `FocusLink.exe` FileVersion `0.12.76`，打包内 commit 无 dirty；portable 启动存活。installer SHA-256 `392df75b...6f23f`，portable `1bb571ca...c5dbe`。
- **APK 备份**：`.tmp/android-apk-backups/FocusLink-0.12.76-1276-debug.apk`，SHA-256 `02ae4444...83e768`，`aapt2` 回读 `versionCode=1276 / versionName=0.12.76`。
- **三端实装矩阵**：Windows 静默覆盖退出码 0，卸载注册表 `DisplayVersion=0.12.76`，安装 EXE `FileVersion=0.12.76`；小米 `192.168.1.84:5555` 与华为 `192.168.1.61:5555` 均 `adb install -r` 成功并回读 `versionName=0.12.76`。OPPO 手表未在线，未纳入矩阵。
- **LFS 卫生**：打包前后 `.git/lfs/tmp` 保持 12K，无泄漏。
- **遗留**：远端回写（滴答/番茄）需要在真实远端会话导入后做一次端到端确认；移动端新 UI 的三视口浏览器验收与华为真机视觉检查待执行。

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

## 2026-08-02 · v0.12.75 华为登录障碍：workers.dev 域名 DNS 污染（环境事实）

- **现象**：华为平板（DBY-W09）点「登录」后云端一直收不到 flow；`curl https://foxlink-mcp...workers.dev/healthz` 超时
  （HTTP 000），而 `curl https://www.baidu.com` 正常（HTTP 200）。
- **根因**：华为在当前网络（Wi-Fi「咪咪白露の网」，DNS 走路由器 192.168.1.1）把 `*.workers.dev`
  解析到 Facebook/Meta 的 IP（`199.59.148.96` / `2a03:2880:...`），连接全部失败。用阿里公共
  DoH（`dns.alidns.com/resolve`）直接查询同一域名也返回 `199.59.150.49`——证明是**国内 DNS 层面
  对 workers.dev 域名的普遍投毒**，不是华为设备或路由器单独问题，也不是代码问题。
- **佐证**：小米能正常同步，是因为小米开着 Clash Meta VPN（`com.github.metacubex.clash.meta`，
  DNS 走 VPN 的 172.19.0.2），绕开了被污染的 DNS；仓库自定义域名 `focuslink.pyzzgk.dpdns.org`
  解析到 Cloudflare 真 IP（`2606:4700:3033::6815:1086`），华为可正常访问（HTTP 200）。
- **解决（不改代码）**：华为开启代理（Clash VPN，Uids 全量接管）后，workers.dev 解析到真实
  Cloudflare IP `159.106.121.75`，healthz 200。随后华为平板完成登录：验证码登录 owner →
  批准 flow `flow_PL7I4WTSnWXEVwpvCUNU2tOUmPvQ2yWGHZSXz60eTV9qcgCJU1ry2w` → 设备 poll 消费 →
  「实时状态已连接」+「账本同步已确认：补传 0，处理 362 条变更，现有 95 场会话」。
- **后续建议**：若要让无代理网络下的华为/其他设备直接可用，需给两个 worker（foxlink-mcp、
  poyi-oauth-as）都挂自定义域名并切换客户端 canonical origin（本轮未做，保持现状）。

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
