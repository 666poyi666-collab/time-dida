# FocusLink 测试与发布规范

> 这是发布门禁，不是建议清单。任何版本只有在本页全部满足并创建 GitHub Release 后才算发布完成。

## 1. 测试层级

### 快速静态与单元验证

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm audit --omit=dev
```

测试必须覆盖状态机、三时间模型、崩溃恢复、任务树与排序、`completedAt`、CLI 优先/OAuth 后备、活动/完成分阶段加载、设置局部更新、dida argv/checklist/marker、统计 request-id、renderer 受控恢复、logger Error 序列化、托盘监听幂等性、同步队列和番茄本地/云桥策略。

### 构建与隔离回归

```bash
npm run build
npm run regression:electron
```

使用 `scripts/regression/` 的自测与崩溃恢复流程时，所有 user data 和结果写入项目忽略的 `test-data/` 或系统临时目录。生成的 `dist-selftest/`、`*-result.json` 与测试数据完成后删除，不进入 release。

### UI smoke

- 主窗覆盖深浅主题的 idle、running、paused、任务、统计、设置和 TaskPicker。
- 视觉断言要确认主工作面无大面积 `backdrop-filter`/blur/光晕，文字对比与字号下限符合前端规范，reduced-motion 无持续呼吸或位移。
- 覆盖默认尺寸、最小尺寸、1280×720、键盘焦点和无横向溢出。
- 小窗覆盖 expanded/collapsed、running/paused、实时主题切换、透明边界、DPR、多显示器 work area 和四边吸附；断言收起态仅有进度/状态、当前时间和展开入口，字号为 23.5px / 30px。
- 统计 smoke 连续快速展开不同会话、在计时 tick 中滚动/切换页面，确认旧请求不会覆盖新详情，退出页不拦截鼠标。
- 任务 smoke 必须用真实临时滴答任务完成整条可逆链路：“完成 → 6 秒内撤销 → 再次完成 → 已完成视图按 `completedAt` 找到 → 恢复未完成”。同时覆盖 30/90/365 天选项、名称/日期排序和超过 120 项时的逐步显示。
- UI smoke 输出放系统临时目录，不放仓库根目录。

### 真实 dida 临时任务

正式发布前运行：

```bash
npm run smoke:dida
npm run smoke:dida:state
npm run smoke:dida:ui -- release-v0100/win-unpacked/FocusLink.exe
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

客户端处于已登录可同步状态后运行 `npm run smoke:tomatodo:real`，并核对以下结果：

- 客户端关闭：写入本地记录，状态保持待上传。
- 客户端运行且已登录：批量上传后回读云确认，再标记已同步。
- 未识别标题落入“学习”；已知学科映射正确。
- 重复写入 marker 不产生重复记录。
- 修改学科和删除 FocusLink 记录能清理对应记录。
- 测试使用临时数据并清理；不得破坏用户既有记录。

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

目录规则：`0.10.0 → release-v0100`，`0.2.10 → release-v0210`。仓库本地只保留最新三个 release 目录；更老的安装包由 GitHub Releases 长期保存。

## 3. 正式构建

1. 完成功能提交，确认 `git status --short` 没有遗漏的源码变更。
2. 在目标 commit 上执行全部测试。
3. 执行 `npm run dist`；正式包必须由干净 commit 生成，`shared/version.generated.ts` 不得含 `-dirty`。
4. 对安装版与便携版计算 SHA256，写入 `SHA256SUMS.txt`。
5. 运行安装版和便携版 smoke；不能只验证 `win-unpacked`。
6. 清理 release 目录，只留下：

```text
release-vXYZ/
├── FocusLink-x.y.z-x64.exe
├── FocusLink-x.y.z-x64-portable.exe
├── SHA256SUMS.txt
└── RELEASE_NOTES.md
```

`win-unpacked/`、`builder-debug.yml`、`*.blockmap`、日志、截图和测试 JSON 都不是发布资产。

## 4. Release notes

- 从 [../.github/RELEASE_NOTES_TEMPLATE.md](../.github/RELEASE_NOTES_TEMPLATE.md) 复制并填写。
- 内容必须与 `CHANGELOG.md` 同版本段落一致，但面向用户组织，不粘贴内部流水账。
- 只列已经实现并验证的内容；未完成项保留在下一版本草稿，不能写进发布正文。
- 必须记录升级提示、已知限制、验证摘要和两个资产的 SHA256。
- 本地 `release-v*/RELEASE_NOTES.md` 与 GitHub Release 正文保持一致，是离线发布记录。

## 5. GitHub 发布门禁

GitHub Actions 会复跑可自动化的检查、隔离回归、打包、主窗/小窗以及安装版/便携版 smoke，但不能替代需要本机登录态的 dida、番茄 To-do 真实临时数据验收，也不能替代最终人工视觉检查。只有本地全部门禁通过后才能推送版本 tag；tag 是“允许自动发布”的明确授权，不是开始测试的快捷方式。

顺序固定：

1. 推送目标分支并确认远端 commit。
2. 创建并推送与版本完全一致的 annotated tag，例如 `v0.10.0`。
3. 创建 GitHub Release，标题使用 `FocusLink v0.10.0`，正文使用本地 `RELEASE_NOTES.md`。
4. 上传安装版、便携版和 `SHA256SUMS.txt`。
5. 回读 Release 页面，确认 tag、正文、资产名称、文件大小和下载链接正确。
6. 在仓库首页/README 更新当前版本链接（若版本链接存在）。

只执行 `git push` 或只推 tag 不等于发布。GitHub Release 创建失败时，报告为“构建完成，发布受阻”，不得宣告版本已发布。

## 6. 发布后审计

- 安装包 SHA256 与本地/Release 附件一致。
- GitHub Release 的 target commit 与构建元数据一致。
- 最新 release 不是 draft（除非明确进行预发布验收），附件均可下载。
- 本地只保留最新三个规范 release 目录。
- 工作区没有 `win-unpacked`、`dist-selftest`、`test-data`、结果 JSON 或散落报告。
- 根目录 `CHANGELOG.md` 顶部版本、README 和应用内版本一致。
