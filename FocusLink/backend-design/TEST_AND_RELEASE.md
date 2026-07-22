# FocusLink 测试与发布规范

> 这是发布门禁，不是建议清单。任何版本只有在本页全部满足并创建 GitHub Release 后才算发布完成。
>
> 除非命令明确写了其他路径，本页所有 `npm` / `node` 命令都从仓库内 `FocusLink/` 执行。正式开发运行时固定为 Node.js 20.x / npm 10.x。

## 1. 测试层级

### 快速静态与单元验证

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm audit --omit=dev
```

测试必须覆盖状态机、三时间模型、崩溃恢复、任务树与排序、`completedAt`、CLI 优先/OAuth 后备、活动/完成分阶段加载、设置局部更新与旧设置兼容迁移（fontProfile 仅解析、timerStyle 旧值映射）、dida argv/checklist/marker、统计 request-id、renderer 受控恢复、logger Error 序列化、托盘监听幂等性、同步队列和番茄本地/云桥策略。

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
`cloud/docker-compose.yml` + `cloud/docker-compose.test.yml` 启动完全隔离的个人云环境。脚本使用随机项目名、
随机测试 token、独立临时卷和回环端口 `18080/18787`，验证自由专注、任务关联、幂等重放、revision 冲突、
PC 账本回收、容器重启持久化和停机恢复；无论成功失败都必须执行 `docker compose down --volumes`。
测试覆盖不替代 Coolify 公网 HTTPS、备份和恢复演练。
默认会从当前源码重建镜像；仅当 Docker Hub 暂时不可达且本机已有由当前源码生成的
`focuslink-cloud:local` / `focuslink-web:local` 时，允许临时设置 `FOCUSLINK_TEST_SKIP_BUILD=1` 使用缓存镜像，
同时必须单独通过 `npm run build:web` 与 `npm run build:cloud`，并在验收记录中注明未重新拉取基础镜像。

账本协议测试必须覆盖 Bearer 鉴权、精确 CORS、512 KiB bundle/1 MiB 请求与响应字节预算、`opId` 重放及正文回退、
`baseRevision` 冲突、按连接分区的原子检查点、耐久冲突状态、`invalid_cursor` 恢复、单调 cursor 分页与账号隔离。
实时协议额外覆盖 start/pause/resume/finish/abort 合法迁移、command id 重放与复用、expected revision 冲突、
错误 session、单账号唯一活动会话、running/paused 三时间增长、长轮询变化/超时/断连清理、进程重启恢复，
以及 finish/abort 与 completed ledger 的原子衔接。浏览器在 360×800 / 412×915 和平板横竖屏下验证首次拉取、
双客户端实时控制、并发冲突、断网本机推算与缓存、重连、错误 token、移除 token 与清除本机缓存；旧账号 cursor 收到结构化 `invalid_cursor` 后必须只清理本机旧账本并从空 cursor 重建一次；PWA
离线壳不能依赖已经打开第二次才缓存的 hash 资源，也不得缓存 Bearer 接口响应。

正式交付 Android APK 前，安装与工程要求匹配的 Android SDK 后从 `android/` 运行：

```bash
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
./gradlew :app:connectedDebugAndroidTest
```

至少覆盖当前 minSdk 24 与 targetSdk 35 设备；minSdk 不得低于按域 Network Security Config 生效的 API 24。
原生前台 Service 只显示云端已确认快照并转发通知/Tile 动作，不能复制业务计时状态机。必须验证通知权限允许/拒绝、
暂停/继续/结束、陈旧 revision、WebView 冷启动 drain/ack、进程杀死后安全恢复和结束后移除前台通知；未通过这些门禁
不得宣称 Android 已支持可靠后台控制。原生前台 Service 还必须在 WebView 进入后台后每 20 秒读取一次云端权威快照，
凭据使用 Android Keystore 加密，Web 会话存储丢失不得隐式删除原生凭据；网络中断时保留最后确认状态，另一设备结束后应在一个轮询周期内移除通知。通知/Tile 命令还必须在 WebView 被回收后由 Service 直接提交，断网保留、恢复重试、与 Web 并发重放只生效一次。真机门禁还需读取原生诊断计数，确认 WebView 退后台后至少连续成功三轮；注入低 revision 的 WebView 缓存不得覆盖新云端快照，idle revision 必须阻止已结束会话复活。华为、小米测试必须分别记录系统后台/自启动授权状态，未授权被 OEM 冻结应明确呈现为系统限制而不是假报在线。

原生 HTTP 必须经可注入的 `FocusCloudClient` 边界；JVM 测试至少覆盖 applied/duplicate/conflict/rejected、
错误 command id、非终态 ack、断网、非 200 和非法 JSON。Service 只有在匹配 command id 的终态 ack 后才可删除持久命令，
其他失败必须保留以便下一轮至少一次重放。OEM 候选的纯逻辑测试必须覆盖华为 action、小米显式组件及最终应用详情兜底。

个人云发布前必须运行 `npm run cloud:container:test` 和 `npm run build:cloud`，再在 Coolify 单实例应用中验证：HTTPS
强制、错误 token 为 401、错误 origin 为 403、限流为 429、`/health` 标记 production、容器重启后活动会话/任务快照/
完成账本仍存在。`focuslink-cloud-data` 卷必须配置备份并做一次恢复演练；未绑定有效 HTTPS 域名或未挂载持久卷时不得把
回环测试结果写成云端已上线。

Android 门禁限定 `:app:`，只测试最终可交付 APK；不要让 Gradle 根任务选择器额外构建 Capacitor
生成库中没有产品测试源码的 instrumentation APK。

网络 ADB 双机验证必须先用 `adb devices -l` 核对两个唯一序列号，安装、日志和反向端口命令均显式传
`adb -s <serial>`。测试云继续只监听 PC 回环地址；每台设备分别配置
`adb -s <serial> reverse tcp:8787 tcp:<host-port>`，App 仍连接 `http://127.0.0.1:8787`，不得为了真机
调试而放宽 Android 明文网络规则或让测试云监听局域网。逐台跑连接测试时设置 `ANDROID_SERIAL` 后执行
`:app:connectedDebugAndroidTest`，并核对两台设备各自的测试报告与安装版本。

instrumentation 中的 native store 测试必须使用隔离的 SharedPreferences，禁止清空真机正在使用的
`focus_runtime_native_v1`。Gradle connected 任务可能在收尾卸载目标调试包，因此只能在专用测试设备
或配置实时链路之前运行；需要保留已配置真机时，分别 `adb install -r` target/test APK、执行
`am instrument`，最后只卸载 `.test` 包，随后复核目标包、token/缓存和 native command 队列仍在。

单手机原生云端验收先以 PC 命令建立 running 会话，再通过设备 reverse 执行以下两项；参数缺失时测试必须报告
skipped，不得静默计为云端已验证：

```bash
adb -s <serial> shell am instrument -w -r \
  -e class 'app.focuslink.mobile.ExampleInstrumentedTest#backgroundServiceUploadsCommandsWithoutWebView' \
  -e focuslinkEndpoint 'http://127.0.0.1:8787' -e focuslinkToken '<temporary-token>' \
  app.focuslink.mobile.test/androidx.test.runner.AndroidJUnitRunner
adb -s <serial> shell am instrument -w -r \
  -e class 'app.focuslink.mobile.ExampleInstrumentedTest#backgroundServiceRetriesAfterConnectionRecovery' \
  -e focuslinkEndpoint 'http://127.0.0.1:8787' -e focuslinkToken '<temporary-token>' \
  app.focuslink.mobile.test/androidx.test.runner.AndroidJUnitRunner
```

`android/app/src/test/java/app/focuslink/mobile/FocusLinkConfigTest.java` 必须校验构建产物的
`BuildConfig.VERSION_NAME` 与本次 `android/app/build.gradle` 配置一致；该单元测试属于 Android APK
交付门禁，不得以 TypeScript 门禁已通过代替。

双机实时 smoke 必须在两个序列号上安装同一 APK、授予或显式拒绝通知权限并保持各自 reverse。设备 A 开始后
设备 B 应在一个长轮询周期内显示同一 session；依次从两台设备执行暂停/继续，确认 revision 单调且三时间守恒；
制造同 revision 并发动作时只能一个 applied，另一台刷新 conflict 快照。结束后两台都回到 idle、账本各出现且只出现
一份完整会话，前台通知消失。移除一台 reverse 后应保留缓存并标为离线推算，恢复后收敛；最后检查 logcat 无 crash、
ANR、ForegroundServiceStartNotAllowedException 或通知通道错误。

### UI smoke

- 主窗覆盖深浅主题的 idle、running、paused、任务、统计、设置和 TaskPicker。
- 契约断言覆盖六套真实界面字体、五套计时仪表、7×9 点阵、翻页 `fold/unfold/steady` DOM 闭环、canvas 时间之带实时渲染与 finished 冻结、统计日报的 KPI/双尺度单日时间轴/多日堆叠柱/100% 任务构成带/暂停损耗，以及 Electron 原生全屏沉浸覆盖层和进入过渡。
- 视觉断言要确认主工作面无大面积 `backdrop-filter`/blur/光晕，文字对比与字号下限符合前端规范，reduced-motion 无持续呼吸或位移。
- 覆盖默认尺寸、980×660 最小尺寸、1280×720、键盘焦点和无横向溢出；多日柱图的每日精确值必须可键盘聚焦。
- 小窗覆盖 expanded/collapsed、running/paused、实时主题/字体切换、透明边界、DPR、多显示器 work area 和四边吸附；Windows 原生拖拽必须由 `WM_ENTERSIZEMOVE` / `WM_EXITSIZEMOVE` 区分按住与释放，断言收起态仅有状态、当前时间、60 格当前分钟秒轨和展开入口，展开态在 `256×70` 外框内完整显示任务名、三项累计与全部控制，时间与按钮分区且按钮不换行；暂停粒子必须跟随消逝边界，并覆盖 320ms 收束与过渡中拖动取消。
- 小窗尺寸以 BrowserWindow 内容 viewport、填满 viewport 的 shell 和截图像素为三重事实；Chromium 的 `window.outerWidth/outerHeight` 在 Windows runner 可能包含不可见系统边框，只能用于诊断和重复命令前后不变性，不能作为固定内容尺寸的发布断言。
- 关闭 smoke 后删除临时 user-data 必须允许 Windows 日志尾写入的有界重试；清理错误不得覆盖首个产品/断言错误。
- 统计 smoke 连续快速展开不同会话、在计时 tick 中滚动/切换页面，确认旧请求不会覆盖新详情，退出页不拦截鼠标。
- 任务 smoke 必须用真实临时滴答任务完成整条可逆链路：“完成 → 6 秒内撤销 → 再次完成 → 已完成视图按 `completedAt` 找到 → 恢复未完成”。同时覆盖 30/90/365 天选项、名称/日期排序和超过 120 项时的逐步显示。
- UI smoke 输出放系统临时目录，不放仓库根目录。
- 跨设备实时控制改动必须运行 `npm run smoke:live-fallback -- <本次 win-unpacked\\FocusLink.exe>`：脚本使用隔离 userData、不可达 loopback 和当前账户加密令牌，断言首次握手失败后本机计时仍能开始并结束；输出 `SKIP` 只表示环境缺少可解密令牌，不计入通过。

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
- 未识别标题落入“学习”；已知学科映射正确。
- 重复写入 marker 不产生重复记录。
- `smoke:tomatodo:bridge` 必须无业务写入地验证标准路径按需启动、番茄 ToDo 标题与特征 electronAPI 方法校验，以及已运行普通实例绝不被结束；错误页面必须被拒绝。
- 修改已有 marker 的学科会请求重新上传；桥不可用或上传失败时必须留下 durable pending，旧 `isSynced=1` 不得掩盖新学科待上传状态。删除 smoke 只验证本地 marker 清理与幂等。当前 API 不支持远端记录删除，结果必须明确报告 `remoteDeleteSupported=false`、`remoteCleanupVerified=false`。
- smoke 从第一次写入尝试开始就在 `finally` 按唯一 marker 尽力清理，覆盖“写入已发生但响应丢失”；不得破坏用户既有记录。若需要确认云端无临时记录，只能在番茄 ToDo 服务端/其他已绑定端人工核对，不能由本 smoke 宣称。

## 2. 版本一致性

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

目录规则：`0.11.5 → release-v0115`，`0.2.10 → release-v0210`。发布目录位于源码工作区父级；仓库本地只保留最新三个 release 目录，更老的安装包由 GitHub Releases 长期保存。

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
   `build/installer.nsh` 只能在 `customInit` 中使用 `USERNAME eq %USERNAME%` 限定的退出命令处理当前账户，
   并以 `/IM` 覆盖 Electron 子进程；禁止使用会卡住 Chromium 进程树的 `/T`。关闭后只允许在当前安装器
   进程树内设置 `FOCUSLINK_INSTALLER_SKIP_CLOSE=1`，供 0.12.17 旧卸载器绕过全局扫描，禁止持久化该变量。
   禁止重新引入 `nsProcess` / `tasklist` 全局扫描、无用户名过滤的终止命令或预安装强杀钩子，否则安装器会
   把其他账户的 smoke 进程误判为安装阻塞，并在不可见提示框或“无法关闭”弹窗上永久等待。
   GitHub Actions 的干净 runner 必须不设置该变量，覆盖安装器默认路径。若 NSIS 在 runner 上以 Windows 访问冲突
   `0xC0000005` 退出，可清理隔离安装目录后重试一次；只允许该退出码，第二次或其他退出码必须立即失败。
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
