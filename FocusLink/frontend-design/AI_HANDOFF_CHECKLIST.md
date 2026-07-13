# 前端 AI 接手清单

本清单用于防止后续维护者只改“看起来像”的页面，却破坏产品边界、状态语义或真实功能。

> 所有 `npm` / `node` 命令默认从仓库内 `FocusLink/` 执行。

## 开始前

- [ ] 完整阅读 [README.md](README.md) 和 [FRONTEND_SPEC.md](FRONTEND_SPEC.md)。
- [ ] 阅读 [../backend-design/BACKEND_SPEC.md](../backend-design/BACKEND_SPEC.md) 中的三时间模型、任务 Provider、IPC 和同步不变量。
- [ ] 用 `rg --files src electron shared tests scripts` 确认真实目录，不创建平行源码树。
- [ ] 查看 `git status --short`，保留用户已有变更，不覆盖不相关文件。
- [ ] 运行现有应用或 smoke，记录 idle/running/paused、任务、统计、设置和小窗当前行为。
- [ ] 明确本次是修复、视觉调整还是契约变化；契约变化必须同时修改后端文档和测试。

## 实现中

- [ ] 四个顶级入口仍是专注、任务、统计、设置，没有重复管理入口。
- [ ] 颜色、间距、圆角、阴影和动效来自共享 token，不在组件内散落近似值。
- [ ] 主工作面使用中性画布、高不透明表面、折射边缘和单一低对比环境层；没有大面积 backdrop blur、文字发光或高频全屏扫光。
- [ ] 主窗可读/可操作文案不小于 11px，10px 只用于非核心辅助标签；小窗当前时间保持收起 25px / 展开 31px。
- [ ] `已关联` 与 `已同步` 没有混用；番茄本地写入没有冒充云端成功。
- [ ] 任务选择、任务树和任务搜索复用现有 feature，不复制算法。
- [ ] 任务页固定显示“滴答清单”，不把 CLI / OAuth 暴露成“任务来源”；两者只是连接方式。
- [ ] 任务完成/取消完成失败时回滚；CLI 空结果不能被当作成功。
- [ ] 任务列表先加载活动任务，完成历史仅在用户打开时按 30/90/365 天读取；完成后有 6 秒撤销，列表每批最多 120 项。
- [ ] 全屏页面不动画 transform/filter；环境层和控件动效不改变布局，并实现 reduced-motion 退化。
- [ ] 统计详情异步请求有 request id；快速切换会话时旧响应不会覆盖当前行，计时 tick 不会触发全页重渲染。
- [ ] 小窗仍只有两种固定状态；所有尺寸只从 `shared/miniWindowLayout.ts` 派生。
- [ ] 收起小窗仅有进度/状态、当前时间和展开入口，没有任务、累计统计或额外按钮。
- [ ] 边缘自动收起不在拖动中抢鼠标，吸附后有 320ms 可见收束，过渡中再拖动会取消，展开方向不越过 work area。
- [ ] 新图标有可访问名称，浮层有焦点管理和 Escape 行为。

## 结束前

- [ ] 更新 `FRONTEND_SPEC.md` 中受影响的界面、token、动效或尺寸规则。
- [ ] 运行 `npm run format:check`、`npm run typecheck`、`npm run lint`、`npm test` 和 `npm run build`。
- [ ] 截图验收深浅主题与所有关键状态；检查溢出、裁切、焦点环和文字对比度。
- [ ] 运行主窗与小窗 smoke；功能变化补上可重复的真实外部服务验证。
- [ ] 真实 UI smoke 覆盖“完成任务 → 6 秒内撤销 → 再次完成 → 已完成列表找到 → 恢复未完成”全链路。
- [ ] 在根目录 [CHANGELOG.md](../../CHANGELOG.md) 的新版本段落记录用户可见变化。
- [ ] 从 [.github/RELEASE_NOTES_TEMPLATE.md](../../.github/RELEASE_NOTES_TEMPLATE.md) 生成对应根级 `release-v*/RELEASE_NOTES.md`。
- [ ] 按 [../backend-design/TEST_AND_RELEASE.md](../backend-design/TEST_AND_RELEASE.md) 完成打包和 GitHub Release；不得只推 tag 不建 Release。
