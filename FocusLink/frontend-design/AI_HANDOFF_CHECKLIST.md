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
- [ ] 主窗可读/可操作文案不小于 11px，10px 只用于非核心辅助标签；小窗当前时间保持收起 25px / 展开至少 21px。
- [ ] 颜色、间距、圆角、阴影和动效来自共享 token（`temporal-foundation.css`），表现层只有 `linear-workbench.css` 一套；`legacy-support.css` 只保留任务/设置/浮层的清理版规则，不新增主题。
- [ ] 所选强调色同时映射 `--app-accent*` 与 `--app-success*` 并贯穿导航、按钮、任务、统计和专注；暂停红与危险深红保持独立。
- [ ] `已关联` 与 `已同步` 没有混用；番茄使用“上传已确认”，本地写入和上传 success 都没有冒充独立云端回读/远端删除。
- [ ] Web/Android 使用「实时控制台 + 已结束账本」边界；云端实时确认、离线本机推算、账本缓存、dida 投递和番茄上传没有互相冒充。
- [ ] 移动端只控制 FocusLink 云端活动会话，不渲染窗口、CLI、小窗或 TomaToDo 本地桥的假控制；Electron live adapter 未接入时不声称已控制桌面计时。
- [ ] start/pause/resume/finish 均携带幂等 command id 与 expected revision；冲突刷新权威快照，页面隐藏/换账号/卸载会取消旧长轮询。
- [ ] Android 前台通知与快捷设置只转发带 session/revision 的动作，原生层不复制计时状态机；云端未确认前不先行翻转状态，冷启动待处理动作可重放并显式确认。
- [ ] 令牌默认只保存当前会话，记住令牌必须由用户显式选择；切换 endpoint/token 会清空旧账号缓存和实时快照。
- [ ] 番茄手动同步可显示按需连接；已普通运行但无桥时明确要求“完全退出后再连接”，不声称会杀进程或自动重启。
- [ ] 番茄后台周期重试不会启动外部应用，界面不给出相反暗示。
- [ ] 已有番茄 marker 的学科修改若外部更新失败会进入 durable queue；队列未清空前不能把旧记录的 `isSynced=1` 显示成新学科“上传已确认”。
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
- [ ] 小窗仍只有两种固定状态（收起 184×35 / 展开 256×70）；所有尺寸只从 `shared/miniWindowLayout.ts` 派生。
- [ ] 收起小窗仅有进度/状态、当前时间和展开入口，没有任务、累计统计或额外按钮；展开小窗在 74px 内容盒内完整显示，按钮不换行，任务名不用省略号/渐隐，字体切换后重新测量。
- [ ] 小窗暂停粒子从当前分钟进度边界按真实毫秒相位分批消散，不无限循环固定 CSS 轨迹；结束态主读数等于本轮累计专注，长任务名在 reduced-motion 下可聚焦横向滚动。
- [ ] 时间之带为 canvas 单一渲染面并使用真实墙钟横轴；每段专注以连续可读但上下羽化、非矩形的绿色粒子时间体保留完整跨度，不是实心条、规则点阵矩形、纤维线或 confetti。
- [ ] paused 保持秒级近景；红色低透明度残留层保存从暂停起点到现在的完整长度，活动层粒子错峰剥离、漂移、缩小、褪色和死亡。旧端更散淡、当前端更密，但无红色实线、连接或实心填充块。
- [ ] resume 保留历史红色残留并从其后开始新的绿色粒子段，绿—红—绿顺序与账本一致。reduced-motion 下完整区间静态保留，不播放活动 cohort；历史粒子不因区间增长按百分比重排。
- [ ] 本次专注账本的全部专注/暂停条目都有对应强调色/暂停红状态轨、刻点、标题和时长；不是只有当前条目有颜色。
- [ ] 手机、平板/Web 专注页均存在紧凑时间之带 canvas；运行→暂停→继续时能看到完整绿—红—绿真实时段，旧缓存缺少 segments/pauses 时安全降级为空数组，不影响计时控制。
- [ ] 六套本地界面字体（Noto/文楷/新致宋/漫黑/新晰黑/得意黑）使用真实不同字形骨架，不以同字体粗细冒充选项。
- [ ] 五套计时仪表（standard/flip/pixel/thin/segment）宽度稳定不跳位；翻页完整走 `fold → unfold → steady`，快速变化只保留最新数字，idle/finished 与 reduced-motion 静态提交。
- [ ] 沉浸模式复用同一 TimerDial 与时间之带，占满原生全屏，仅显示完整专注界面，进入有过渡且 reduced-motion 可退化。
- [ ] 统计按结论→四 KPI→双尺度单日时间轴/多日堆叠柱→100% 任务构成带→暂停损耗顺读；Dashboard 不重复最近会话表，百分比合计 100%，全部来自真实 analytics 数据，无珠链、马赛克或假图。
- [ ] 边缘自动收起不在拖动中抢鼠标，吸附后有 320ms 可见收束，过渡中再拖动会取消，展开方向不越过 work area。
- [ ] 新图标有可访问名称，浮层有焦点管理和 Escape 行为。

## 结束前

- [ ] 更新 `FRONTEND_SPEC.md` 中受影响的界面、token、动效或尺寸规则。
- [ ] 运行 `npm run format:check`、`npm run typecheck`、`npm run lint`、`npm test` 和 `npm run build`。
- [ ] 多端改动额外运行 `npm run build:web`、`npm run build:cloud` 和 `npm run android:sync`；360×800 / 412×915 验收离线缓存与 safe-area。
- [ ] 截图验收深浅主题与所有关键状态；检查溢出、裁切、焦点环和文字对比度。
- [ ] 运行主窗与小窗 smoke；功能变化补上可重复的真实外部服务验证。
- [ ] 真实 UI smoke 覆盖“完成任务 → 6 秒内撤销 → 再次完成 → 已完成列表找到 → 恢复未完成”全链路。
- [ ] 在根目录 [CHANGELOG.md](../../CHANGELOG.md) 的新版本段落记录用户可见变化。
- [ ] 从 [.github/RELEASE_NOTES_TEMPLATE.md](../../.github/RELEASE_NOTES_TEMPLATE.md) 生成对应根级 `release-v*/RELEASE_NOTES.md`。
- [ ] 按 [../backend-design/TEST_AND_RELEASE.md](../backend-design/TEST_AND_RELEASE.md) 完成打包和 GitHub Release；不得只推 tag 不建 Release。
