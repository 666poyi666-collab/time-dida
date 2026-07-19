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
- [ ] 主工作面使用冷瓷白 / 深墨蓝画布、高不透明哑光表面、1px 发丝边界；全局没有 backdrop blur、文字发光或高频全屏扫光。
- [ ] 主窗可读/可操作文案不小于 11px，10px 只用于非核心辅助标签；小窗当前时间保持收起 25px / 展开 27px。
- [ ] 颜色、间距、圆角、阴影和动效来自共享 token（`temporal-foundation.css`），表现层只有 `linear-workbench.css` 一套；`legacy-support.css` 只保留任务/设置/浮层的清理版规则，不新增主题。
- [ ] 所选强调色同时映射 `--app-accent*` 与 `--app-success*` 并贯穿导航、按钮、任务、统计和专注；暂停红与危险深红保持独立。
- [ ] `已关联` 与 `已同步` 没有混用；番茄使用“上传已确认”，本地写入和上传 success 都没有冒充独立云端回读/远端删除。
- [ ] 番茄手动同步可显示按需连接；已普通运行但无桥时明确要求“完全退出后再连接”，不声称会杀进程或自动重启。
- [ ] 番茄后台周期重试不会启动外部应用，界面不给出相反暗示。
- [ ] 任务选择、任务树和任务搜索复用现有 feature，不复制算法。
- [ ] 任务页固定显示“滴答清单”，不把 CLI / OAuth 暴露成“任务来源”；两者只是连接方式。
- [ ] 任务行没有无说明的符号：优先级小旗必须带 `aria-label` / `title` 完整名称；清单与截止信息保持单行，“专注中”有可见文字。
- [ ] 任务完成/取消完成失败时回滚；CLI 空结果不能被当作成功。
- [ ] 任务列表先加载活动任务，完成历史仅在用户打开时按 30/90/365 天读取；完成后有 6 秒撤销，列表每批最多 120 项。
- [ ] 全屏页面不动画 transform/filter；环境层和控件动效不改变布局，并实现 reduced-motion 退化。
- [ ] 统计详情异步请求有 request id；快速切换会话时旧响应不会覆盖当前行，计时 tick 不会触发全页重渲染。
- [ ] 统计默认今天，单日左右导航不会进入未来；近 7 / 15 / 30 天和自定义仍能重算真实图表。
- [ ] 真实点击“开始专注”后可见“专注中”、开始时间、计时增长、活动轨和片段账本；smoke 不绕过按钮直接启动。
- [ ] 设置 Switch 在亮色关闭态仍有明确轮廓，尺寸、滑块位置、`role="switch"` 与 `aria-checked` 一致。
- [ ] 小窗仍只有两种固定状态（收起 184×35 / 展开 280×84）；所有尺寸只从 `shared/miniWindowLayout.ts` 派生。
- [ ] 收起小窗仅有进度/状态、当前时间和展开入口，没有任务、累计统计或额外按钮；展开小窗任务名单行完整显示或克制滚动，不用省略号/渐隐。
- [ ] 时间之带为 canvas 单一渲染面：近景/远景可手动选择，专注与暂停都秒级更新，状态切换 720ms 变焦，当前边界有不遮挡刻度的衰减粒子。
- [ ] 五套计时仪表（standard/flip/pixel/thin/segment）宽度稳定不跳位；翻页快速变化不会留下旧数字。
- [ ] 沉浸模式复用同一 TimerDial 与时间之带，占满原生全屏，仅显示完整专注界面，进入有过渡且 reduced-motion 可退化。
- [ ] 统计按结论→四 KPI→单日时间轴/多日趋势→任务排行→最近会话表顺读；全部来自真实 analytics 数据，无环形图、珠链、马赛克或假图。
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
