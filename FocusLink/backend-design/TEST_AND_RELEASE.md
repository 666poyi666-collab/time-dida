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

使用 `scripts/regression/` 的自测与崩溃恢复流程时，所有 user data 和结果写入项目忽略的 `test-data/` 或系统临时目录。生成的 `dist-selftest/`、`*-result.json` 与测试数据完成后删除，不进入 release。

### UI smoke

- 主窗覆盖深浅主题的 idle、running、paused、任务、统计、设置和 TaskPicker。
- 契约断言覆盖四套真实界面字体、五套计时仪表、canvas 时间之带实时渲染、统计日报的 KPI/单日时间轴/多日趋势/任务排行/最近会话表，以及 Electron 原生全屏沉浸覆盖层和进入过渡。
- 视觉断言要确认主工作面无大面积 `backdrop-filter`/blur/光晕，文字对比与字号下限符合前端规范，reduced-motion 无持续呼吸或位移。
- 覆盖默认尺寸、最小尺寸、1280×720、键盘焦点和无横向溢出。
- 小窗覆盖 expanded/collapsed、running/paused、实时主题/字体切换、透明边界、DPR、多显示器 work area 和四边吸附；Windows 原生拖拽必须由 `WM_ENTERSIZEMOVE` / `WM_EXITSIZEMOVE` 区分按住与释放，断言收起态仅有进度/状态、当前时间、2px 进度轨和展开入口，展开态在 `280×84` 内完整显示任务名、三项累计与全部控制且时间与按钮分行，并覆盖 320ms 收束与过渡中拖动取消。
- 小窗尺寸以 BrowserWindow 内容 viewport、填满 viewport 的 shell 和截图像素为三重事实；Chromium 的 `window.outerWidth/outerHeight` 在 Windows runner 可能包含不可见系统边框，只能用于诊断和重复命令前后不变性，不能作为固定内容尺寸的发布断言。
- 关闭 smoke 后删除临时 user-data 必须允许 Windows 日志尾写入的有界重试；清理错误不得覆盖首个产品/断言错误。
- 统计 smoke 连续快速展开不同会话、在计时 tick 中滚动/切换页面，确认旧请求不会覆盖新详情，退出页不拦截鼠标。
- 任务 smoke 必须用真实临时滴答任务完成整条可逆链路：“完成 → 6 秒内撤销 → 再次完成 → 已完成视图按 `completedAt` 找到 → 恢复未完成”。同时覆盖 30/90/365 天选项、名称/日期排序和超过 120 项时的逐步显示。
- UI smoke 输出放系统临时目录，不放仓库根目录。

### 真实 dida 临时任务

正式发布前运行：

```bash
npm run smoke:dida
npm run smoke:dida:state
npm run smoke:dida:ui -- ../release-v0115/win-unpacked/FocusLink.exe
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
- 修改学科会请求重新上传；删除 smoke 只验证本地 marker 清理与幂等。当前 API 不支持远端记录删除，结果必须明确报告 `remoteDeleteSupported=false`、`remoteCleanupVerified=false`。
- smoke 从第一次写入尝试开始就在 `finally` 按唯一 marker 尽力清理，覆盖“写入已发生但响应丢失”；不得破坏用户既有记录。若需要确认云端无临时记录，只能在番茄 ToDo 服务端/其他已绑定端人工核对，不能由本 smoke 宣称。

## 2. 版本一致性

版本号变更必须在同一次提交中同步：

- `package.json`
- `package-lock.json`
- `shared/version.ts`
- `electron-builder.yml` 的输出目录
- 根目录 `README.md`
- 根目录 `CHANGELOG.md`
- `frontend-design/` 与 `backend-design/` 的适用版本
- 当前版本 `release-v*/RELEASE_NOTES.md`

目录规则：`0.11.5 → release-v0115`，`0.2.10 → release-v0210`。发布目录位于源码工作区父级；仓库本地只保留最新三个 release 目录，更老的安装包由 GitHub Releases 长期保存。

## 3. 正式构建

1. 完成功能源码提交，确认 `git status --short` 为空；该提交是 Release notes 中的“对应提交”。
2. 在这个干净源码提交上执行全部测试与 `npm run dist`；正式包写到父级 `release-v*`，`shared/version.generated.ts` 与包内元数据不得含 `-dirty`。
3. 对安装版与便携版计算 SHA256，写入 `SHA256SUMS.txt`，并运行安装版与便携版 smoke；不能只验证 `win-unpacked`。
   本机若已有不能中断的 FocusLink 会话，只允许在启动安装器的父进程临时设置
   `FOCUSLINK_INSTALLER_SKIP_CLOSE=1`，并用 `/D=<系统临时目录>` 安装后验收；不得把该变量写入系统环境。
   隔离安装前还必须备份并临时隐藏当前用户的 FocusLink 卸载注册项，避免 Electron Builder 把本次验证识别成升级并卸载正在运行的正式安装；
   桌面/开始菜单快捷方式也要先保存，并在 `finally` 中连同卸载注册项原样恢复。验证结束后必须确认原进程仍在、注册版本与两个快捷方式目标均未改变。
   `build/installer.nsh` 的同名开关必须同时绕过自定义关闭和内置 `CHECK_APP_RUNNING`，否则静默安装会在不可见提示框上挂起。
   GitHub Actions 的干净 runner 必须不设置该变量，覆盖安装器默认路径。若 NSIS 在 runner 上以 Windows 访问冲突
   `0xC0000005` 退出，可清理隔离安装目录后重试一次；只允许该退出码，第二次或其他退出码必须立即失败。
4. 填完两份完全一致的 Release notes，记录上一步的源码提交和真实 SHA256；不可变元数据固定为
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

GitHub Actions 会复跑可自动化的静态检查、源码构建和隔离回归，并重新 smoke 已提交的便携版与安装版；它不会重新生成另一套哈希不同的发布包。workflow 会核对 package-lock 的根版本、annotated tag、源码提交祖先关系、两份一致的 notes、四文件目录和 SHA256，再原样发布这些已验证资产。它不能替代需要本机登录态的 dida、番茄 To-do 真实临时数据验收，也不能替代最终人工视觉检查。只有本地全部门禁通过后才能推送版本 tag；tag 是“允许自动发布”的明确授权，不是开始测试的快捷方式。

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
