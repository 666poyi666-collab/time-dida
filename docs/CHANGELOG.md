# 变更日志 (CHANGELOG)

> 本仓库遵循简易版本记录。每个版本对应一个 `release-vXXX/` 打包目录。
> 历史修复细节见 `docs/archive/` 下的各报告文档。

## v0.2.0 (2026-06-30)

### 稳定版交付：计时核心 + 小窗 + 时间线 + 历史记录全链路验收

#### 1. 版本标识升级到 v0.2.0
- `package.json` 版本号 → 0.2.0
- `shared/version.ts` APP_VERSION / APP_RELEASE_DIR → 0.2.0 / release-v020
- `scripts/gen-version.js` 改为从 package.json 读取版本，避免多处硬编码不同步
- `electron-builder.yml` 输出目录 → release-v020
- `electron/main.ts` 启动日志输出 FocusLink version: 0.2.0
- 设置页关于页显示 v0.2.0 + Build commit + Build Time + Release 目录

#### 2. 小窗三形态完整修复
- 新增 `getCurrentTaskTitle` selector（`src/lib/timerSelectors.ts`）
- MiniWindow EXPANDED 态新增「总历时」信息（6 项核心信息齐全）
  - 当前任务 / 当前专注 / 累计专注 / 当前暂停 / 累计暂停 / 总历时
- MiniWindow 暂停态颜色统一改为红色（danger），不再用橙色（warning）
  - STATE_DOT.paused: bg-warning → bg-danger
  - STATE_TEXT.paused: text-warning → text-danger
  - COLLAPSED / COMPACT 态同步修正
- 所有显示值统一走 selector，不再直接读 snapshot.activeElapsedMs

#### 3. 历史记录页面信息密度优化
- Session 总览：总历时 / 累计专注 / 累计暂停 / 专注片段数 / 暂停片段数 / 未关联数（6 项统计）
- 新增「本地 / 云端状态」面板，明确显示「滴答清单云端专注记录：未实现」
- 新增批量关联区域：批量补关联 / 全部改为同一任务 / 只看未关联 / 只看已关联
- 专注片段改为紧凑单行布局（替代大卡片），未关联片段高亮虚线边框
- 暂停记录默认折叠，展开后紧凑红色列表，三点菜单提供「关联到任务 / 添加备注」
- 暂停片段关联任务提示明确：「暂停片段关联任务需要扩展数据结构，当前版本暂不支持」
- 「同步可视度」改名为「本地 / 云端状态」
- 「同步到滴答」改名为「同步到滴答备注」

#### 4. dida 云端专注记录设计文档
- 新增 `docs/DIDA_CLOUD_FOCUS_SYNC_DESIGN.md`
- 诚实结论：当前版本无法安全写入滴答云端专注记录，**暂不实现**
- 文档覆盖：dida CLI 能力边界、官方 API 缺失、覆盖式写入风险、同步队列设计、回滚策略

#### 5. 手动回归测试脚本
- 新增 `scripts/manual-timer-regression.ts`
- 模拟 5/3/4/2/6 场景，输出 segments / pauseEvents / mixedTimelineItems / TimerPanel 值 / MiniWindow 值 / History 值
- 新增 `npm run manual-test` 命令
- vitest.config.ts include 加入该脚本

#### 6. 计时核心逻辑回归验证（未改动，仅验证）
- 5/3/4/2/6 场景：Segment 1=5s, Segment 2=4s（非 9s 累计）, Segment 3=6s（非 15s 累计）
- Pause 1=3s, Pause 2=2s
- 累计专注=15s, 累计暂停=5s, 总历时=20s
- mixedTimelineItems=5 条（3 专注 + 2 暂停）
- TimerPanel / MiniWindow / History 显示值全部通过 selector 统一口径验证

### 未触碰的核心逻辑
- Timer 状态机、SQLite schema、dida CLI Provider、快捷键、IPC 通道 — 全部原样
- 右侧 dida 任务区 — 未改

### 验证
- `npm run format` 通过
- `npm run typecheck` 通过
- `npm test` 通过（47/47 全绿）
- `npm run manual-test` 通过（5/3/4/2/6 场景全断言通过）
- `npm run build` 通过
- `npm run dist:win` 通过（release-v020/）

## v0.1.9 (2026-06-30)

### 核心计时 Bug 真正修复（基于真实运行测试）

#### 1. 修复 resume 后专注时间不从 0 开始的根本 Bug
- **根因**：`TimerManager.activeElapsedMs` 是 session 累计值，但 `closeSegment` 和 `buildSegmentSummaries` 之前直接把它当成当前 segment 的值，导致每个 segment 拿到的都是累计值而非本段时长
- **修复**：引入 `currentSegmentActiveBaseMs` 字段，记录当前 segment 开始时的累计 activeElapsedMs 基准
  - segment 独立时长 = `activeElapsedMs - currentSegmentActiveBaseMs`（差值计算）
  - resume 创建新 segment 时重置基准，新 segment 从 0 开始
  - closeSegment / persistSnapshot / buildSegmentSummaries 全部改用差值
- **强制规则**：resume 始终创建新 segment，无视 `segmentBehavior` 设置

#### 2. 真实 pauseEvents 暴露给前端
- TimerSnapshot 新增 `pauseEvents: PauseEventSummary[]` 字段
- 新增 `PauseEventSummary` 类型（含 isCurrent 标记）
- `TimerManager.getSnapshot()` 调用 `buildPauseEventSummaries()` 从 `listPauses` 返回真实暂停事件
- 前端不再靠 Segment 间隙推导暂停，避免暂停片段丢失或被混成专注片段

#### 3. MiniWindow 显示 5 项核心信息
- 当前任务、当前专注、累计专注、当前暂停、累计暂停
- EXPANDED 模式 2×2 网格布局
- 暂停态大时间和「当前暂停」用红色（danger）

#### 4. SegmentTimeline 用真实 pauseEvents + 暂停红色
- 新增 `src/lib/buildMixedTimeline.ts` 公共构建器
- 暂停片段改用红色（danger），不再用橙色（warning）
- 用 `snapshot.pauseEvents` 真实数据构建，不再靠间隙推导

#### 5. HistoryPanel 暂停记录改红色
- 暂停记录区边框/图标/文字改用 danger（红色）
- PauseRow 三点菜单提示文案明确：「暂停片段关联任务需要扩展数据结构，当前版本暂不支持」

#### 6. 版本标识 v0.1.9
- 新增 `shared/version.ts` + `scripts/gen-version.js`（build 时注入 commit/buildTime）
- 主进程启动日志输出 version/commit/buildTime/releaseDir
- 设置页关于页显示 v0.1.9 + Build commit + Build Time

#### 7. 真实场景测试通过（5/3/4/2/6）
- 新增 `tests/timerScenario.test.ts`，用纯 JS 内存 mock 验证真实场景
- 测试输出：Segment 1=5s, Pause 1=3s, Segment 2=4s, Pause 2=2s, Segment 3=6s
- 累计专注=15s, 累计暂停=5s, 混合时间线=5 条（3 专注 + 2 暂停）

### 云端同步
- **滴答清单云端专注记录写入：未实现，后续单独设计**

### 验证
- `tsc --noEmit` 通过
- `npm test` 通过（47/47 全绿，含 5/3/4/2/6 真实场景测试）
- `npm run build` 通过（1915 模块）
- `npm run dist:win` 通过（release-v019/FocusLink-0.1.9-x64.exe）

## v0.1.8 (2026-06-30)

### 计时 UI 语义修正 + 历史记录交互重构

#### 1. 统一计时 selector（新增）
- 新增 `src/lib/timerSelectors.ts`，提供统一口径的 5 个 selector 函数：
  - `getCurrentSegmentDisplayMs` — 当前专注片段时间
  - `getCurrentPauseDisplayMs` — 当前暂停片段时间
  - `getMainDisplayMs` — 大看板主显示（自动选择专注/暂停片段）
  - `getCumulativeActiveMs` — 累计专注时间
  - `getCumulativePauseMs` — 累计暂停时间
  - `getWallElapsedMs` — 总历时
  - `getMinuteRhythmSec` — 分钟节奏条秒数
- 所有显示位置（TimerPanel / MiniWindow）统一走 selector，不再各写一套

#### 2. MiniWindow 计时 bug 修复
- **修复关键 bug**：MiniWindow 大时间之前显示累计 `activeElapsedMs`，现在统一显示当前片段时间
- running 显示当前专注片段（从 0 开始），paused 显示当前暂停片段
- 暂停态大时间改为橙色，与主面板语义一致
- 三种模式（COLLAPSED / COMPACT / EXPANDED）全部修正

#### 3. 大看板计时语义（v0.1.8 首版已改，本次统一到 selector）
- 大时间 = 当前片段时间（专注片段或暂停片段），不是累计总专注时间
- 新开始专注片段后从 0 重新开始
- 读条改为 60 秒循环分钟节奏条（专注绿 / 暂停橙）
- 三项累计统计：累计专注 / 累计暂停 / 总历时
- 「跨度」改名为「总历时」

#### 4. 片段时间线混合显示
- 专注片段（绿色）与暂停片段（橙色）按真实顺序交替排列
- 暂停片段从「上一片段 endedAt → 下一片段 startedAt」间隙推导，无需改后端
- 当前进行中片段高亮 + ring + 「进行中」标记
- 专注片段显示关联任务，暂停片段不显示任务
- 每条显示：开始时间 → 结束时间 + 持续时长

#### 5. 历史记录交互重构
- 专注片段区移至上方重点展示（绿色图标 + 加粗标题）
- 暂停记录区移至下方弱化显示（70% 透明度 + 橙色淡边框）
- 「总跨度」改名为「总历时」（2 处）
- 暂停记录新增 `PauseRow` 组件，带三点菜单（MoreVertical）
- 三点菜单提供「关联到任务」「添加备注」两个选项
- 暂停片段关联任务提示为后续版本功能（需扩展本地数据结构）
- 专注片段默认提供「关联任务 / 更换任务 / 清除关联 / 完成任务」入口

#### 6. 云端同步策略
- **云端写入 dida 专注记录：后续任务，当前版本不做**
- 原因：dida CLI 无安全追加接口、`update --content` 为覆盖式有数据风险
- 当前版本只保证本地数据库正确保存 Session / Focus Segment / Pause Segment / Segment 任务关联 / 历史记录关联状态

### 未触碰的核心逻辑
- Timer 状态机、SQLite schema、dida CLI Provider、快捷键、IPC 通道 — 全部原样
- 右侧 dida 任务区、任务关联写入逻辑 — 未改
- 整体浅色简洁风格、字体系统、配色 token — 未改

### 验证
- `tsc --noEmit` 通过
- `npm run build` 通过（1912 模块）
- `npm test` 通过（46/46 全绿）
- `npm run dist:win` 通过（安装包 + 免安装版生成）

## v0.1.7 (2026-06-30)

### 仓库整理（本次）
- README 重写：去除本机绝对路径，改用通用开发命令，明确版本与安装包/免安装版路径
- 修正技术栈描述：移除不存在的 `electron-store`，改为自研 `JsonStore`
- 明确数据 / 日志 / 设置 / 凭证位置（`%APPDATA%/FocusLink/`）
- 新建权威文档：`docs/PRODUCT_SPEC.md`、`ARCHITECTURE.md`、`UI_SPEC.md`、`DIDA_CLI.md`、`TESTING.md`、`CHANGELOG.md`
- 旧 AI 修复报告归档到 `docs/archive/`（不删除）
- 引入 Prettier 代码格式化（`.prettierrc` / `.prettierignore` + `format` / `format:check` 脚本）
- 清理无用依赖（`clsx` / `tailwind-merge` / `date-fns` / `zod`）
- 增加 GitHub Issue 模板（bug report / feature request / UI improvement）
- 不修改任何核心业务逻辑（Timer 状态机 / SQLite schema / dida CLI Provider / 快捷键 / IPC 通道）

## v0.1.6

### 维护
- 沿用 v0.1.5 功能集，稳定性与打包迭代
- 详见 `docs/archive/` 相关报告

## v0.1.5

### 功能
- idle 状态预选任务 + `timer:start-with-task` 原子启动（Session 默认任务 + 第一个 Segment 任务同时写入）
- 任务树默认折叠父任务（硬要求），搜索命中子任务时自动展开父任务，清空搜索后恢复搜索前折叠状态
- 任务按项目过滤（保留父子结构，子任务继承父任务 projectId）
- 历史记录后补关联 + 批量关联未关联 segment
- CLI 诊断面板（探测 / 版本 / 登录 / 项目 / 任务 / 搜索 6 步）
- 主题色切换（indigo / violet / emerald / rose / amber / sky）
- 主界面左右分栏可拖拽

### 变更
- 贴边自动收纳（`edgeAutoCollapse`）默认关闭：实现不稳定，会乱跳 / 乱缩放 / 挡屏幕，交给 UI AI 重做
- 收起/展开改为直接 `setBounds` 无动画，避免窗口乱跳
- 一次性迁移：强制重置 `edgeAutoCollapse=false`

详见 `docs/archive/PRE_START_TASK_SELECTION_REPORT.md`、`TASK_TREE_DEFAULT_COLLAPSE_REPORT.md`、`TASK_FILTER_BY_PROJECT_REPORT.md`、`FOCUS_TASK_LINKING_REPORT.md`、`MINI_WINDOW_EDGE_COLLAPSE_REPORT.md`、`MINI_WINDOW_STABILITY_REPORT.md`、`MINI_WINDOW_UX_REPORT.md`、`UI_REDESIGN_BRIEF.md`。

## v0.1.4

### 功能
- dida CLI Provider：自动探测 `dida` 命令，复用本地 OAuth token
- 旧 `ticktick` 命令模板自动迁移为 `dida` 默认模板
- 任务归一化（`normalizeTasks`）：status 数字归一化、`items[]` 递归为 `children[]` 树
- CLI 执行诊断（`execWithDiagnose`）：记录 command / exitCode / stdout / stderr / status

详见 `docs/archive/CLI_PROVIDER_REPORT.md`、`DIDA_CLI_DEBUG_REPORT.md`、`DIDA_PROVIDER_FIX_REPORT.md`、`DIDA_TASK_TREE_AND_FILTER_REPORT.md`。

## v0.1.3

### 功能
- 专注小窗：可调大小、手动收起/展开、跟随主题、位置/尺寸持久化
- 小窗主窗口隐藏时自动显示、专注开始时主窗口不在前台则自动显示
- 设置分域（`detectChangedDomains`）：主题保存不再触发快捷键重注册

详见 `docs/archive/MINI_WINDOW_STABILITY_REPORT.md`、`MINI_WINDOW_UX_REPORT.md`。

## v0.1.2

### 功能
- Segment 任务关联：专注中换任务、Session 默认任务设置
- 暂停后继续新建 Segment 并继承 Session 默认任务
- Segment 时间线可视化

详见 `docs/archive/FOCUS_TASK_LINKING_REPORT.md`、`TIMER_UI_FIX_REPORT.md`。

## v0.1.1

### 功能
- TickTick / Dida365 OAuth 适配器（PKCE loopback）
- 同步队列（`sync_queue`）：失败重试，最多 5 次后标记 failed
- 数据导出（JSON / CSV / Markdown）

## v0.1.0

### 首发
- 全局快捷键驱动的专注计时器（`Ctrl+Alt+` 修饰键）
- Focus Session + Segment + PauseEvent 三时间账本
- SQLite 本地存储，崩溃恢复（按 `lastTick` 重算）
- 系统托盘（状态联动菜单）
- 单实例锁，关闭窗口最小化到托盘
- 本地任务 Provider
- NSIS 安装包 + 免安装版双产物

详见 `docs/archive/PACKAGE_EVIDENCE_REPORT.md`、`EVIDENCE_REPORT.md`。

---

> 说明：v0.1.1 ~ v0.1.4 的版本划分基于归档报告的主题推断，精确到提交的变更历史以 git log 为准。
