# 变更日志 (CHANGELOG)

> 本仓库遵循简易版本记录。每个版本对应一个 `release-vXXX/` 打包目录。
> 历史修复细节见 `docs/archive/` 下的各报告文档。

## v0.2.9 (2026-07-01)

### checklist 子项同步打通 + 小窗质感继续打磨

- 找到历史同步仍失败的真实原因：用户关联的是 dida checklist 子项，`dida task get/update 子项ID` 会返回 `undefined` 或假成功，不能按普通任务处理。
- dida CLI provider 新增 checklist 子项上下文识别：同步备注时写入父任务内容，并标注 `子任务：xxx`，避免子项不支持备注导致丢写。
- dida 写操作改为 `execFile` 参数数组执行，绕过 Windows shell 对中文、换行和 JSON 的破坏；已用临时 dida 任务验证中文备注、换行和 `[FocusLink]` 能真实写入云端。
- “完成任务”支持 checklist 子项：通过更新父任务 `items` 数组把当前子项置为完成，已用临时 dida checklist 验证云端状态从 0 变为 2。
- dida 写操作会把 `undefined` 输出视为失败，不再把“假成功”标记为同步成功。
- 小窗固定为缩小/展开两种尺寸，移除手动拖拽缩放；外观增加状态顶线、柔和边框、专门按钮和统计卡样式。

## v0.2.8 (2026-07-01)

### dida 批量同步继续修复 + 队列交互打磨

- 继续修复 dida CLI 写回任务备注：`task update` 还要求 `--project <projectId>`，默认模板改为 `dida task update {{taskId}} --id {{taskId}} --project {{projectId}} --content "{{content}}"`。
- 新增旧设置二次迁移：已经迁移过 `--id` 但缺少 `--project` 的用户配置会自动修正。
- 历史 Session 同步时按任务分组，同一个任务的多个片段会合并成一次备注写入，避免连续多次 update 覆盖前一条记录。
- 同步队列会复用已有 pending/failed 项并重置为 pending，避免同一个 session 重复入队；手动重试也会清空 retryCount。
- 同步队列错误文案增加完整 hover 提示，长错误不会撑坏任务区布局。

## v0.2.7 (2026-07-01)

### 历史同步修复 + 删除后空白防护 + 小窗空闲态优化

- 修复历史记录批量同步到 dida 任务失败：dida CLI 的 `task update` 既需要位置参数，也需要 `--id <id>`，默认模板改为 `dida task update {{taskId}} --id {{taskId}} --content "{{content}}"`。
- 新增旧设置自动迁移：已保存的旧 dida 追加备注模板会在读取设置时自动修正，现有同步队列可直接重试。
- 同步队列卡片现在会把带 `lastError` 的 pending 项也显示为问题项，并展示具体错误，避免只看到“有记录等待同步”。
- 修复历史删除后回到计时页可能空白：删除当前运行/暂停会话会被阻止；删除当前已结束会话后会重置计时快照，避免引用已删除 session。
- 小窗空闲态优化：未开始或已结束时显示“待开始 / 准备开始”，大时间归零，减少上一段专注残留造成的误解。

## v0.2.6 (2026-07-01)

### 真实前端视觉重构 + 版本线回正

- 删除未接入真实应用的 `.design_library/` 副产物，避免后续设计 AI 把概念文件误认为 FocusLink 实际界面。
- 主窗口从过量毛玻璃、滑动切页和发光动效收敛为稳定桌面工作台：顶栏、分段导航、左右栏背景、拖拽分割线统一为边框主导的灰阶层级。
- 全局 tokens 重新整理为 FocusLink 自有系统：浅色灰阶、薄荷绿主色、橙色暂停语义、克制阴影、更圆润但不膨胀的卡片半径。
- 左侧计时看板移除持续脉冲遮罩和发光按钮，强化当前片段、累计统计、任务入口与快捷键提示的阅读秩序。
- 右侧任务树新增统一 `task-row` 样式：父任务、子任务、当前片段、本次默认、完成态通过边框、缩进线和 chip 区分，保持列表密度。
- 专注小窗继续保留固定两态，圆角增大到 24/28px，外壳改为更实体的透明窗口卡片，减少方角露底和内容挤压风险。
- Toast 降低动画强度，并移除旧改动留下的未使用进度状态。
- 纠正另一轮改动写入的 `0.27.0 / release-v027` 版本线，正式交付回到 `0.2.6 / release-v026`。

## v0.2.5 (2026-07-01)

### 小窗两态重做 + 开机自启托盘化 + 前端交接目录

- 小窗从“三模式 + 40px 横条”收敛为两种固定产品状态：260×88 缩小卡、420×184 展开详情卡。
- 缩小态只显示当前专注/暂停与累计专注/暂停；展开态显示当前任务、当前片段、累计专注/暂停、总历时和控制按钮。
- mini 页面背景改为透明，小窗外壳独立圆角与克制阴影，避免透明窗口露出方角。
- 旧小窗尺寸配置会归一化到 420×184 展开尺寸，收起状态只改变窗口 bounds，不覆盖展开尺寸。
- 开机自启动注册时带 `--hidden` 参数，主进程识别后默认隐藏主界面到托盘；手动双击启动仍显示主界面。
- 新增 `frontend-design/`、`backend/`、`shared-contract/` 三块交接目录，并新增 `frontend-design/FOCUSLINK_FRONTEND_HANDOFF.md` 给后续 UI 设计 AI 使用。
- 新增 `startupPolicy.test.ts`，更新 `miniWindowLayout.test.ts`，防止小窗尺寸和自启动行为回退。

## v0.2.4 (2026-06-30)

### 小窗布局策略回归保护 + 验收日志修正

- 小窗三档固定尺寸、默认尺寸、收起高度和紧凑模式判断抽到共享策略，主进程与小窗组件共用同一套规则。
- 新增小窗布局策略测试，固定 260×88 / 320×144 / 420×184 三档吸附和 40px 收起高度。
- 手动计时回归日志改为读取当前 `APP_VERSION`，不再输出过期的 `v0.2.0`。
- 手动计时回归脚本新增 `Date.now` 兜底还原，避免失败时污染后续测试。
- 当前版本切到 `0.2.4`，打包目录切到 `release-v024`，历史归档滚动为最近三版：`0.2.2` / `0.2.3` / `0.2.4`。

## v0.2.3 (2026-06-30)

### 自动同步回归保护 + release 滚动

- 把“完成专注后是否应该自动同步”的判断抽成共享策略，主进程和测试共用同一套规则。
- 新增自动同步策略回归测试：本地模式不自动同步、无滴答关联不自动同步、有滴答关联才自动同步。
- 保持结束专注后的非阻塞同步队列逻辑：已关联滴答任务的 session 会入队并尝试写入任务备注，失败仍留在队列里可重试。
- 当前版本切到 `0.2.3`，打包目录切到 `release-v023`。
- README 下载路径与历史归档滚动为最近三版：`0.2.1` / `0.2.2` / `0.2.3`。

## v0.2.2 (2026-06-30)

### 真实主界面 UI 深度打磨 + 同步闭环修复

#### 1. 设计语言
- 基于 `Doubao Copy.zip` 的 dashboard UI kit 提炼 tokens：低阴影、边框分层、紧凑密度、圆角控制、搜索/按钮/卡片状态。
- FocusLink 保留薄荷绿主色，背景与卡片改为更稳定的灰阶系统。
- 全局字体继续使用 `"Microsoft YaHei UI", "Inter", "Segoe UI", system-ui, sans-serif`，计时数字保持 tabular nums。

#### 2. 主界面与任务区
- 主界面分栏约束调整为更合理的左右可拖范围，分割线从粗控件改为细线 + 精致手柄。
- 任务树保留父任务默认折叠、搜索展开父任务、隐藏已完成逻辑；叶子任务不再显示像按钮的空箭头位。
- 暂停色统一回到橙色 warning，专注绿色 / 暂停橙色的语义在主计时、时间线、历史、小窗里保持一致。

#### 3. 历史记录
- 展开 Session 后优先展示紧凑摘要与专注/暂停混合时间线。
- 本地 / 云端状态从大块面板收敛为小 chip：本地保存、滴答备注可同步、未关联数、同步状态。
- 历史里后补关联滴答任务、批量关联、设置默认任务后，会自动入队并尝试写入滴答任务备注。

#### 4. 同步与小窗
- 结束专注后如存在已关联滴答任务的片段，会自动加入同步队列并非阻塞运行同步；失败保留在队列中可重试。
- 专注小窗吸附为三档固定尺寸：260×88、320×144、420×184，避免拖到尴尬尺寸后内容残缺。
- 设置页快捷键显示改为用户可读的 `Ctrl + ...`，同时继续显示真实注册状态。

#### 5. 版本与打包
- `package.json` / `shared/version.ts` → 0.2.2
- `electron-builder.yml` 输出目录 → `release-v022`
- README 当前版本与下载路径同步到 v0.2.2，并仅保留最近三版归档。

## v0.2.1 (2026-06-30)

### UI/UX 打磨 + 全局动效系统（克制、统一、无感但高级）

> 详见 `docs/V021_FINAL_FLOW_REPORT.md`。本轮不改任何底层逻辑，仅动表现层。

#### 1. 全局动效 tokens 系统（核心新增）
- `src/index.css` 新增动画节奏 tokens：`--motion-fast`(120ms) / `--motion-normal`(180ms) / `--motion-slow`(260ms)
- 新增 3 条统一缓动：`--ease-out` / `--ease-in-out` / `--ease-soft`
- 新增缩放 tokens：`--scale-hover`(1.02) / `--scale-active`(0.98)
- 新增 12 个动效工具类：`motion-base/smooth/lift/scale/press/digit/fade-up/fade-in/breathe/rhythm-fill/state-bg/accordion`
- 支持 `prefers-reduced-motion` 无障碍降级（关闭所有 transition/animation）
- Framer Motion easing 统一为 `[0.22, 1, 0.36, 1]`（180ms），与 CSS 对齐

#### 2. 各组件动效改造
- **MiniWindow**：进度条 `motion-state-bg`，状态切换颜色渐变，数字稳定
- **TimerPanel**：CumStat `motion-state-bg` + `motion-digit`，header/subtitle `motion-fade-up`，按钮 `motion-press`
- **TaskPanel**：空状态 `motion-fade-in` + `motion-breathe`，当前 segment badge subtle glow，子任务 `motion-fade-in`
- **HistoryPanel**：Session 卡片 `motion-lift`，AnimatePresence `duration:0.18`，三点菜单 `motion-fade-in`
- **SegmentTimeline**：空状态 `motion-fade-in`，时间线项 `motion-base`，时长 `motion-digit`
- **SettingsPanel / Toast / App / TaskPicker**：统一替换零散 `transition-colors/duration` 为 `motion-base/press`

#### 3. 语义色一致性修复
- `TimerPanel.tsx` CumStat paused tone：`warning`（橙）→ `danger`（红）
- `index.css` `.pause-glow`：`rgb(var(--warning)/...)` → `rgb(var(--danger)/...)`

#### 4. 版本与打包
- `package.json` / `shared/version.ts` / `electron/main.ts` → 0.2.1
- `electron-builder.yml`：输出目录 `release-v021`，新增 `portable` target，`publish:null`
- `.gitignore`：排除 `design-pack/`（设计参考包）
- 产物：`FocusLink-0.2.1-x64.exe`（NSIS 86.61MB）+ `FocusLink-0.2.1-x64-portable.exe`（86.39MB）

### 未触碰的核心逻辑
- TimerManager / state machine / SQLite / dida CLI Provider / pauseEvents / mixedTimelineItems / IPC / 快捷键 / 托盘 / 云端写入 — 全部原样

### 验证
- `npm run format` 通过
- `npm run typecheck` 通过
- `npm test` 通过（48/48 全绿）
- `npm run build` 通过
- `npx electron-builder --win` 通过（NSIS + portable 双产物）

### 提交
- `5bd74ef` Polish UI/UX with unified motion system (v0.2.1)

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
