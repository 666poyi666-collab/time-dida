# FocusLink UI 重设计交接方案

> 本文档写给负责重做 FocusLink 界面的 UI AI。请仔细阅读后再开始动手。
> **核心原则：只改展示层，不要重写底层业务逻辑。**

---

## 〇、v0.1.5 重要更新（必读）

本节是 v0.1.5 轮次对交互流程的关键调整，UI AI 必须在这些约束下重做界面：

### 0.1 小窗 UI 当前不合格，列为 P0 重做对象

- 专注小窗（`src/components/MiniWindow.tsx` + `mini.html`）当前 UI 差、展开状态也不好看，**必须重做视觉**。
- **贴边自动收纳在 v0.1.5 已默认关闭**，原因是当前实现不自然（会乱跳、乱缩放、挡屏幕）。
- **UI AI 不要沿用现有的贴边收纳实现**（`edgeAutoCollapse` / `hoverToExpand` / `autoCollapseOnFocusStart` 相关动画与检测逻辑已移除或禁用），需要重新设计贴边交互。
- v0.1.5 已做的稳定性处理（保留）：手动收起/展开、托盘控制、主窗口隐藏时自动显示小窗、专注开始时主窗口不在前台则自动显示小窗。这些**交互入口必须保留**，只重做视觉。
- 收起/展开在主进程已改为直接 `setBounds`（无动画），UI AI 如需过渡动画，请在渲染层用 CSS/transform 实现，**不要在主进程做 incremental setBounds 动画**（会引起窗口乱跳）。

### 0.2 任务选择流程已改为"先选任务，再开始"

- v0.1.5 起，idle 状态下用户可先预选任务，再点击"开始专注"。
- 主进程新增 `timer:start-with-task` 原子启动接口：开始专注时**同时**写入 `Session.defaultTaskId/Source/Title` 与第一个 `Segment.taskId/Source/Title`，避免"先 start 再 link"的脏状态。
- TimerPanel 已实现 idle 预选任务 UI（"即将专注任务：xxx" + 更换/清除按钮）。
- **UI AI 重做 TimerPanel 时必须保留此预选流程**，并保留 `window.focuslink.timer.startWithTask(taskId, taskSource, taskTitle?)` 调用。
- 不选任务直接开始仍然允许（走原 `timer.toggle()` 路径），后续仍可在专注中关联当前片段、设置默认任务、结束后后补关联。

### 0.3 TaskPicker / TaskTree 默认折叠是硬要求

- 所有任务树组件（TaskPanel、TaskPicker、HistoryPanel 任务选择器、TimerPanel 任务选择器、批量关联选择器）**必须默认折叠父任务**。
- 统一规则：父任务默认折叠 → 点击箭头才展开 → 搜索命中子任务时自动展开父任务 → 清空搜索后恢复搜索前折叠状态（不是全部展开）。
- 已完成任务仍默认隐藏。
- **UI AI 重做任务树视觉时，必须保留这套默认折叠 + 搜索展开/恢复逻辑**，否则任务一多就会很乱。

### 0.4 不可破坏的业务契约（再次强调）

- **不要破坏任务关联逻辑**：Segment 与 Task 的绑定关系（`taskId/taskSource/title`）是核心数据，UI 只能读取和调用 IPC 修改，不能在渲染层自行改写。
- **不要破坏 Segment 与任务的绑定关系**：暂停后继续会新建 Segment 并继承 Session 默认任务；当前 Segment 可单独换任务；历史记录可后补关联。这些流程的 IPC 调用必须保留。
- **不要重写 Timer 状态机**：`idle → running → paused → running → finished` 的转换、Session/Segment/Pause 三时间账本、崩溃恢复逻辑都在主进程，UI 只能通过 `timer:*` IPC 调用。

---

## 一、产品定位

FocusLink 是：

```
全局快捷键驱动的专注计时器 + dida/滴答清单任务关联工具
```

核心交互入口**不是主界面**，而是：

```
快捷键 → 专注小窗 → 托盘菜单 → 任务关联 → 历史记录
```

主界面只是**管理面板**，用于配置、查看历史、关联任务，不应该喧宾夺主。优秀的 UI 应该让用户**大部分时间不需要打开主界面**，靠小窗 + 快捷键 + 托盘就能完成日常专注流程。

---

## 二、当前核心功能状态

### 2.1 已可用（不要破坏）

```
✅ 双击启动（NSIS 打包，无需 PowerShell）
✅ 全局快捷键开始/暂停/继续/结束/显示窗口/关联任务/切换小窗
✅ 托盘菜单控制（开始/暂停/结束/显示主窗口/小窗 5 项控制/退出）
✅ 专注小窗（可调大小、可手动收起/展开、跟随主题）
   ⚠️ v0.1.5：贴边自动收纳已默认关闭（不稳定，待 UI AI 重做）
✅ 计时器实时跳动（每秒刷新，主进程推送 tick 事件）
✅ SQLite 本地记录（Session/Segment/Pause/FocusRecord）
✅ 历史记录重启后保留
✅ dida CLI 任务读取（dida task filter --json）
✅ 任务树展示（父任务 + 子任务递归）
✅ 默认隐藏已完成任务 + 显示开关
✅ 所有任务树/TaskPicker 默认折叠父任务（v0.1.5 硬要求）
✅ Segment 关联到 dida 任务
✅ Session 默认任务设置
✅ idle 状态预选任务 + startWithTask 原子启动（v0.1.5 新增）
✅ 暂停后继续新建 Segment 并继承 Session 默认任务
✅ 历史记录后补关联 + 批量关联
✅ CLI 诊断面板（探测/版本/登录/项目/任务/搜索 6 步）
✅ 主题色切换（indigo/violet/emerald/rose/amber/sky）
✅ 主界面左右分栏可拖拽
```

### 2.2 绝对不能动（业务逻辑层）

```
⛔ Timer 状态机：electron/timer/manager.ts
   - idle → running → paused → running → finished
   - Session / Segment / PauseEvent 数据模型
   - 崩溃恢复逻辑（recover 方法）

⛔ SQLite schema：electron/db/schema.ts + electron/db/*.ts
   - sessions / segments / pause_events / focus_records / tasks / projects
   - 迁移逻辑

⛔ dida CLI Provider 核心逻辑：electron/tasks/cliProvider.ts
   - execWithDiagnose / diagnoseCli / testCommand
   - normalizeTasks（status 数字归一化、items[] 递归）
   - DIDA_DEFAULT_TEMPLATES / applyDidaDefaults

⛔ 快捷键注册逻辑：electron/hotkeys.ts
   - registerSingle / registerAllHotkeys / unregisterAll
   - globalShortcut.register 的封装
   - 失败检测与广播

⛔ IPC 接口契约：electron/ipc.ts + electron/preload.ts
   - cli:* / timer:* / settings:* / mini:* / hotkey:* / sync:* / tasks:* / ticktick:*
   - 不要改 IPC 通道名和参数结构
   - v0.1.5 新增 timer:start-with-task（原子启动：Session 默认任务 + 第一个 Segment 任务同时写入）

⛔ 设置分域逻辑：electron/ipc.ts 的 detectChangedDomains
   - theme / hotkeys / miniWindow / taskProvider / layout / general
   - 按域分流副作用（主题保存不触发快捷键重注册）

⛔ 任务归一化逻辑：normalizeTasks
   - status 数字 → isCompleted 布尔
   - items[] 递归 → children[] 树
   - sortOrder 保留用于排序

⛔ 崩溃恢复：timer.recover()
```

UI AI 只能改**展示层**：

```
✅ 可改：src/components/*.tsx（React 组件）
✅ 可改：src/index.css + tailwind.config.js（样式）
✅ 可改：src/App.tsx（主窗口布局结构）
✅ 可改：src/store/useStore.ts（仅 UI 状态，不动业务字段）
✅ 可改：mini.html + src/mini.tsx + src/components/MiniWindow.tsx（小窗渲染）
✅ 可改：electron/main.ts 的 BrowserWindow 构造参数（仅视觉相关：frame/transparent/backgroundColor）
✅ 可改：electron/tray.ts 的菜单文案和图标
```

---

## 三、需要重做的界面

| 界面 | 文件 | 优先级 | 说明 |
|------|------|--------|------|
| **专注小窗** | `src/components/MiniWindow.tsx` + `mini.html` | **P0 极高** | v0.1.5 列为 P0 重做对象；UI 差、贴边收纳不稳定；不要沿用现有贴边实现 |
| 主窗口 | `src/App.tsx` + `src/components/TimerPanel.tsx` + `src/components/TaskPanel.tsx` | 高 | 当前布局粗糙，左右分栏已有但要优化视觉；TimerPanel 已有 idle 预选任务流程，保留 |
| 任务区 | `src/components/TaskPanel.tsx` + `src/components/TaskPicker.tsx` | 高 | 任务树已有但视觉简陋；默认折叠是硬要求（v0.1.5） |
| 设置页 | `src/components/SettingsPanel.tsx` | 中 | 功能完整但视觉杂乱，需重新组织；贴边收纳开关已禁用 |
| 历史记录页 | `src/components/HistoryPanel.tsx` | 中 | 已有后补关联/批量关联，需查看并优化视觉 |
| 托盘菜单文案 | `electron/tray.ts` | 低 | 文案已可用，图标可优化 |
| Toast | `src/components/Toast.tsx` | 低 | 视觉统一即可 |
| 空状态 | 各组件内 | 中 | 任务列表空、历史空、未连接等 |
| 错误状态 | CLI 错误、连接失败 | 中 | 当前是红色文字框，可更友好 |

---

## 四、设计目标

### 4.1 风格方向

```
现代 / 轻量 / 干净 / 高效工具感
不要像传统 Windows 小工具
不要像半成品网页
不要花哨的渐变和阴影堆叠
```

### 4.2 参考产品

```
Raycast      - 命令面板的紧凑感、键盘优先
Linear       - 卡片层级、字重对比、间距节奏
TickTick      - 任务列表的清晰度、checkbox 设计
Notion Calendar - 时间维度的呈现
Arc           - 现代浏览器的简洁感
Cron Calendar - 时间数字的优雅排版
```

### 4.3 设计原则

1. **键盘优先**：所有操作都能用快捷键完成，UI 是辅助
2. **信息密度适中**：不要太空旷，也不要堆砌
3. **状态可见**：计时状态、连接状态、任务关联状态一目了然
4. **响应迅速**：动画不超过 200ms，避免阻塞感
5. **主题一致**：深色/浅色都要好看，accent 色全局统一

---

## 五、字体要求

当前字体很差（系统默认）。**强烈建议替换**：

### 5.1 字体方案

| 用途 | 推荐字体 | 备选 | 字重 |
|------|---------|------|------|
| 中文 | Microsoft YaHei UI | HarmonyOS Sans SC / 思源黑体 Noto Sans SC | Regular / Medium / Semibold |
| 英文 | Inter | SF Pro / Segoe UI | Regular / Medium / Semibold |
| 数字（计时） | Inter Tight | JetBrains Mono / Geist Mono | Semibold / Bold |
| 数字（小窗） | Inter Tight | SF Pro Display | Bold |

### 5.2 字号层级

```
H1 标题：18px / Semibold
H2 区块：14px / Medium
正文：13px / Regular
辅助文字：11px / Regular
计时数字（主窗口）：48-56px / Bold / tabular-nums
计时数字（小窗）：24-32px / Bold / tabular-nums
计时数字（收起横条）：13px / Bold / tabular-nums
```

### 5.3 CSS 实现

```css
:root {
  --font-sans: 'Inter', 'Microsoft YaHei UI', 'PingFang SC', system-ui, sans-serif;
  --font-mono: 'Inter Tight', 'JetBrains Mono', ui-monospace, monospace;
}

body {
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.timer-digit {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
  letter-spacing: -0.02em;
}
```

### 5.4 字体加载

建议用 `@fontsource/inter` 或本地字体文件，避免依赖网络 CDN：

```bash
npm install @fontsource/inter @fontsource/inter-tight
```

```ts
// src/index.css
@import '@fontsource/inter/400.css';
@import '@fontsource/inter/500.css';
@import '@fontsource/inter/600.css';
@import '@fontsource/inter-tight/600.css';
@import '@fontsource/inter-tight/700.css';
```

---

## 六、CSS Variables / Design Tokens

当前已有部分 CSS 变量（见 `src/index.css`），但不够系统。**建议扩展为完整 design tokens**：

```css
:root {
  /* 背景层级 */
  --app-bg: 11 14 20;              /* 最底层背景 */
  --app-surface: 21 25 35;        /* 卡片背景 */
  --app-surface-2: 28 33 45;      /* 次级背景（hover/subtle） */
  --app-overlay: 0 0 0 / 0.5;     /* 遮罩 */

  /* 文字层级 */
  --app-text: 233 237 244;        /* 主文字 */
  --app-muted: 148 163 184;       /* 次要文字 */
  --app-subtle: 100 116 139;      /* 辅助文字 */
  --app-inverse: 255 255 255;     /* 反色文字 */

  /* 边框 */
  --app-border: 39 45 60;         /* 默认边框 */
  --app-border-strong: 51 65 85;  /* 强调边框 */
  --app-border-subtle: 28 33 45;  /* 弱化边框 */

  /* 主题色（accent） */
  --app-accent: 99 102 241;       /* indigo 默认 */
  --app-accent-hover: 129 140 248;
  --app-accent-soft: 99 102 241 / 0.12;  /* 软背景 */
  --app-accent-fg: 255 255 255;   /* accent 上的文字 */

  /* 状态色 */
  --app-success: 16 185 129;
  --app-warning: 245 158 11;
  --app-danger: 244 63 94;
  --app-info: 14 165 233;

  /* 圆角 */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;

  /* 阴影 */
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 12px -2px rgb(0 0 0 / 0.15);
  --shadow-lg: 0 12px 32px -8px rgb(0 0 0 / 0.25);
  --shadow-glow: 0 0 32px -4px rgb(var(--app-accent) / 0.4);

  /* 间距（spacing scale） */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
}

/* 浅色主题 */
.light {
  --app-bg: 248 250 252;
  --app-surface: 255 255 255;
  --app-surface-2: 241 245 249;
  --app-text: 15 23 42;
  --app-muted: 71 85 105;
  --app-subtle: 100 116 139;
  --app-border: 226 232 240;
  --app-border-strong: 203 213 225;
}
```

### 6.1 Tailwind 配置同步

```js
// tailwind.config.js
extend: {
  colors: {
    bg: {
      base: 'rgb(var(--app-bg) / <alpha-value>)',
      card: 'rgb(var(--app-surface) / <alpha-value>)',
      subtle: 'rgb(var(--app-surface-2) / <alpha-value>)',
    },
    fg: {
      DEFAULT: 'rgb(var(--app-text) / <alpha-value>)',
      muted: 'rgb(var(--app-muted) / <alpha-value>)',
      subtle: 'rgb(var(--app-subtle) / <alpha-value>)',
    },
    border: 'rgb(var(--app-border) / <alpha-value>)',
    accent: {
      DEFAULT: 'rgb(var(--app-accent) / <alpha-value>)',
      fg: 'rgb(var(--app-accent-fg) / <alpha-value>)',
      soft: 'rgb(var(--app-accent) / 0.12)',
    },
  },
  fontFamily: {
    sans: ['Inter', 'Microsoft YaHei UI', 'sans-serif'],
    mono: ['Inter Tight', 'JetBrains Mono', 'monospace'],
  },
}
```

---

## 七、主窗口设计建议

主窗口是**管理面板**，不是核心操作区。

### 7.1 布局建议

```
┌─────────────────────────────────────────────────────┐
│ 顶部导航（轻量）                                       │
├──────────────┬──────────────────────────────────────┤
│              │                                       │
│ 左侧         │ 右侧                                  │
│ 专注状态     │ 任务树                                │
│ 当前 Session │ ┌─────────────────────────────┐       │
│ Segment 时间 │ │ 父任务                       │       │
│ 线           │ │   ├ 子任务 1                 │       │
│              │ │   ├ 子任务 2                 │       │
│ 大计时数字   │ │   └ 子任务 3                 │       │
│              │ └─────────────────────────────┘       │
│ 控制按钮     │ 搜索 / 显示已完成开关                  │
│              │                                       │
├──────────────┴──────────────────────────────────────┤
│ 底部状态栏（同步状态 / CLI 状态 / 版本）              │
└─────────────────────────────────────────────────────┘
```

### 7.2 关键设计点

1. **左右分栏可拖拽**：已实现（`settings.layout.leftPaneWidth`），左 360px ~ 右 420px，双击恢复默认
2. **任务树清晰**：父任务卡片 + 子任务缩进 16-24px + 折叠箭头
3. **空状态好看**：未关联任务时显示「按 Ctrl+Alt+L 关联任务」引导
4. **错误状态明确**：CLI 失败显示具体原因 + 「打开诊断」按钮
5. **底部状态栏**：显示同步状态、CLI 连接状态、版本号

### 7.3 计时区域设计

```
┌────────────────────────────┐
│   专注中                    │  ← 状态徽章
│                            │
│   23:45                    │  ← 大号计时（48-56px Bold）
│   active time              │  ← 辅助说明
│                            │
│   ━━━━━━━━━━━━━━━━ 75%    │  ← 进度条（目标 30 分钟）
│                            │
│   当前任务                  │  ← 当前关联任务标题
│   Day2 — 2.3.1.1 斜二测    │
│                            │
│   [暂停]  [结束]  [+片段]  │  ← 主操作按钮
│                            │
│   ── Segment 时间线 ──     │
│   ▓▓▓░░ ▓▓▓▓ ▓▓░          │  ← 段落进度可视化
└────────────────────────────┘
```

---

## 八、专注小窗设计建议

> ⚠️ **v0.1.5 重点提示**：小窗 UI 当前不合格，列为 **P0 重做对象**。
> 贴边自动收纳的现有实现**不要沿用**（已默认关闭，原因是会乱跳/乱缩放/挡屏幕）。
> UI AI 需重新设计贴边交互与视觉，但必须保留：手动收起/展开、托盘控制、主窗口隐藏时自动显示、专注开始时主窗口不在前台则自动显示。
> 收起/展开动画请在渲染层用 CSS/transform 实现，**不要在主进程做 incremental setBounds 动画**。

**小窗才是核心交互入口**。需要支持三种模式：

### 8.1 展开模式（默认）

```
┌─────────────────────────────┐
│ ● 专注中          [▢] [▼]  │  ← 状态点 + 标题 + 主窗口/收起按钮
│                             │
│      23:45                  │  ← 大号计时（24-32px Bold）
│                             │
│   Day2 — 2.3.1.1 斜二测    │  ← 当前任务（truncate）
│                             │
│  ━━━━━━━━━━━━━━━━━━━ 75%   │  ← 进度条
│                             │
│   [⏸ 暂停]  [⏹ 结束]       │  ← 主操作
└─────────────────────────────┘
```

尺寸：300×132（默认），可拖拽到 240×88 ~ 520×240

### 8.2 紧凑模式（宽度 < 260px）

当宽度太小时切换为紧凑布局：

```
┌──────────────────┐
│ ● 23:45  ⏸ ⏹ ▢ │  ← 单行：状态点 + 时间 + 按钮
└──────────────────┘
```

### 8.3 贴边收纳模式（收起为横条）

```
┌──────────────────────────────────┐
│ ● 23:45 专注中  ━━━━━━━  [▲]    │  ← 单行：状态点 + 时间 + 进度条 + 展开
└──────────────────────────────────┘
```

高度：40px

### 8.4 小窗技术约束

```typescript
// BrowserWindow 构造参数（已实现，可参考）
{
  frame: false,
  transparent: true,
  resizable: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  minWidth: 240, minHeight: 88,
  maxWidth: 520, maxHeight: 240,
  // 透明度通过 settings.miniWindow.opacity 控制（0.6 ~ 1.0）
}
```

### 8.5 小窗必须支持的交互

```
✅ 拖动调整大小（resizable: true，已实现）
✅ 拖动移动位置（-webkit-app-region: drag）
✅ 手动收起/展开（mini:collapse / mini:expand IPC，v0.1.5 已改为无动画直接 setBounds）
⚠️ 贴边自动收纳（v0.1.5 已默认关闭，UI AI 需重新设计，不要沿用现有实现）
✅ 透明度调节（settings.miniWindow.opacity）
✅ 跟随主界面主题（settings.miniWindow.followMainTheme）
⚠️ 鼠标悬停展开（收起状态下悬停 → 展开）当前未实现，UI AI 可在渲染层添加
✅ 托盘菜单控制（已实现）
✅ 位置和大小重启后保留（已实现，启动时校验离谱尺寸）
✅ 主窗口隐藏到托盘时自动显示小窗（已实现，保留）
✅ 专注开始时主窗口不在前台则自动显示小窗（已实现，保留）
```

### 8.6 小窗字体优先级

```
1. 计时数字：Inter Tight Bold（tabular-nums）
2. 任务标题：Inter Medium（truncate）
3. 状态文字：Inter Regular Small Caps
```

---

## 九、任务区设计建议

### 9.1 任务树组件

```
┌────────────────────────────────────────┐
│ 🔍 搜索任务标题...      [👁 隐藏已完成]  │
├────────────────────────────────────────┤
│                                        │
│ ▼ 📋 Day2 — 2.3.1.1 斜二测            │  ← 父任务（展开）
│   ┌──────────────────────────────┐    │
│   │ ○ 2.3.1.1 斜二测     [🔗][⚙] │    │  ← 子任务（缩进 + 圆形 checkbox）
│   │ ○ 2.3.1.2 柱锥球台结构 [🔗][⚙] │    │
│   │ ✓ 练习：第1节方法册   [🔗][⚙] │    │  ← 已完成子任务（删除线 + 灰色）
│   └──────────────────────────────┘    │
│                                        │
│ ▶ 📋 Day3 — 2.3.2 旋转体            │  ← 父任务（折叠）
│                                        │
│ ○ 📋 单独任务                       │  ← 无子任务
│                                        │
└────────────────────────────────────────┘
```

### 9.2 设计要求

1. **层级清晰**：父任务卡片，子任务缩进 16-24px
2. **已完成默认隐藏**：`showCompleted` 默认 false，开关在搜索栏旁
3. **子任务缩进**：用 padding-left 或 margin-left，配合左侧细线
4. **父任务可折叠**：ChevronRight/ChevronDown 切换
5. **搜索时展开匹配**：搜索时自动展开包含匹配项的父任务
6. **当前关联任务高亮**：accent 色边框 + 软背景
7. **任务标题不要被箭头污染**：不要 `↳` 前缀，用缩进表达层级
8. **大任务和子任务视觉区分**：父任务字号稍大 + 字重 Semibold
9. **元信息行**：截止日期 + 子任务数 + 优先级标签

### 9.3 已完成任务样式

```css
.task-completed {
  color: var(--app-subtle);
  text-decoration: line-through;
  opacity: 0.5;
}
```

### 9.4 当前已实现（不要破坏）

```typescript
// TaskTreeItem 递归组件已实现：
- 折叠/展开状态（collapsed: Record<string, boolean>）
- 搜索时自动展开匹配父任务
- 排序：未完成在前 → 有截止日期 → sortOrder → priority
- 已完成视觉弱化（line-through + opacity-50）
- 子任务可单独关联到 Segment
- 已完成数量统计「已隐藏 N 个已完成任务」
```

UI AI 可重写视觉样式，但**保留这些交互逻辑**。

---

## 十、设置页设计建议

当前设置页功能完整但视觉杂乱。建议分组为 Tab 或折叠面板：

### 10.1 建议分组

```
[外观]  [任务]  [快捷键]  [小窗]  [同步]  [关于]

外观 Tab:
  - 主题：深色 / 浅色
  - 主题色：6 种 accent 变体
  - 字体大小（可选）

任务 Tab:
  - 任务来源：本地 / dida CLI / TickTick OAuth
  - dida CLI 诊断面板（6 步 + 测试按钮）
  - 应用 dida 默认模板按钮
  - 当前 Provider 显示

快捷键 Tab:
  - 5 个快捷键配置
  - 冲突检测
  - 恢复默认

小窗 Tab:
  - 跟随主界面主题
  - 小窗主题：跟随系统 / 深色 / 浅色
  - 透明度滑块
  - 贴边自动收纳
  - 收起 / 展开 / 重置按钮

同步 Tab:
  - 同步模式：note / experimental-focus / local-only
  - 立即同步按钮
  - 同步状态

关于 Tab:
  - 版本号
  - GitHub 链接
  - 反馈
```

### 10.2 CLI 诊断面板保留

当前 `CliDiagnosticPanel` 组件已实现：

- 完整诊断按钮（6 步）
- 测试项目/任务/搜索按钮
- 复制诊断信息
- 6 步可展开查看 stdout/stderr/exitCode

UI AI 可重写视觉，但**保留所有功能按钮和 IPC 调用**。

---

## 十一、响应式规则

### 11.1 主窗口

```
最小：960×640
默认：1180×760
左栏：360px ~ 50%（可拖拽）
右栏：≥420px
```

### 11.2 小窗

```
最小：240×88
默认：300×132
最大：520×240
收起：宽度保留，高度 40px
```

### 11.3 断点

```
< 260px 宽（小窗紧凑模式）
< 360px 宽（小窗极简，只显示时间）
< 720px 高（主窗口隐藏 Segment 时间线）
```

---

## 十二、空状态 / 错误状态

### 12.1 空状态设计

```
任务列表空：
  ┌──────────────────────────┐
  │       📋                  │
  │   暂无任务                │
  │                          │
  │   点击刷新加载 dida 任务  │
  │   或在设置页切换任务来源  │
  └──────────────────────────┘

历史空：
  ┌──────────────────────────┐
  │       📊                  │
  │   还没有专注记录           │
  │                          │
  │   按 Ctrl+Alt+Space 开始  │
  └──────────────────────────┘

未关联任务：
  ┌──────────────────────────┐
  │       🔗                  │
  │   当前片段未关联任务      │
  │                          │
  │   按 Ctrl+Alt+L 关联任务  │
  └──────────────────────────┘
```

### 12.2 错误状态

```
CLI 连接失败：
  ┌──────────────────────────┐
  │  ⚠ dida CLI 未连接       │
  │                          │
  │  原因：'ticktick' 不是   │
  │  内部或外部命令           │
  │                          │
  │  [打开诊断]  [应用模板]  │
  └──────────────────────────┘
```

---

## 十三、交互细节

### 13.1 动画

```
过渡时间：150-200ms（不超过 250ms）
缓动函数：cubic-bezier(0.4, 0, 0.2, 1)
避免：弹跳、旋转、复杂路径动画
```

### 13.2 悬停反馈

```
任务卡片：背景变浅 + 边框变 accent 色
按钮：亮度提升 + 轻微 scale(1.02)
图标：颜色加深
```

### 13.3 焦点状态

```
所有可交互元素都要有 focus-visible 样式：
outline: 2px solid rgb(var(--app-accent) / 0.5);
outline-offset: 2px;
```

### 13.4 滚动条

```css
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgb(var(--app-border));
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgb(var(--app-muted));
}
```

---

## 十四、设计交付物要求

UI AI 最终应交付：

```
✅ 设计说明文档（docs/UI_DESIGN_SPEC.md）
   - 设计理念
   - 色彩系统
   - 字体系统
   - 间距系统
   - 组件清单

✅ 组件拆分方案
   - 每个组件的职责
   - Props 接口
   - 状态管理

✅ 页面结构
   - 主窗口布局
   - 小窗布局
   - 设置页布局

✅ CSS Variables / Design Tokens
   - 完整的 :root 变量
   - 浅色/深色主题映射
   - accent 变体

✅ 主窗口重构方案
   - App.tsx 重新布局
   - TimerPanel 重设计
   - TaskPanel 视觉优化（保留任务树逻辑）

✅ 小窗重构方案
   - 三种模式（展开/紧凑/收纳）
   - 字体替换
   - 响应式断点

✅ 任务树组件方案
   - TaskTreeItem 视觉重做
   - 折叠/展开动画
   - 搜索高亮

✅ 响应式规则
   - 断点定义
   - 紧凑模式触发条件

✅ 空状态 / 错误状态
   - 插图或图标
   - 文案
   - 引导操作

✅ 交互细节
   - 动画时长
   - 悬停反馈
   - 焦点状态
```

---

## 十五、技术约束

### 15.1 必须保留的接口

```
✅ window.focuslink.* 所有 IPC 接口（preload.ts 定义）
✅ Task / Project / TimerSnapshot 等类型（shared/types.ts）
✅ settings:changed / settings:domain-changed 事件
✅ tick 事件（计时器实时刷新）
✅ timer:state-changed 事件
✅ navigate 事件（托盘跳转到指定页面）
✅ hotkey:registered 事件
✅ toast:show 事件
```

### 15.2 不可修改的文件

```
⛔ electron/timer/manager.ts
⛔ electron/db/*.ts
⛔ electron/tasks/cliProvider.ts（核心逻辑）
⛔ electron/hotkeys.ts
⛔ electron/ipc.ts（IPC handler 逻辑）
⛔ electron/preload.ts（IPC 接口契约）
⛔ electron/settingsStore.ts
⛔ shared/types.ts（类型契约，除非新增字段）
```

### 15.3 可修改的文件

```
✅ src/App.tsx
✅ src/components/*.tsx
✅ src/index.css
✅ src/mini.tsx
✅ src/store/useStore.ts（仅 UI 状态）
✅ tailwind.config.js
✅ mini.html
✅ package.json（仅添加字体依赖）
```

### 15.4 验证步骤

UI AI 完成后必须验证：

```
1. npm run dev 启动开发模式
2. 主窗口视觉正常
3. 小窗视觉正常（展开/紧凑/收纳三种模式）
4. 主题切换正常（深色/浅色 + 6 种 accent）
5. 任务树展示正常（折叠/展开/搜索）
6. 快捷键仍可用
7. 托盘菜单仍可用
8. dida CLI 任务仍能读取
9. 计时器实时跳动
10. npm run build 打包成功
```

---

## 十六、当前 UI 截图位置

当前 UI 截图和设计参考可在以下位置查看：

```
- 主窗口：src/App.tsx（已实现左右分栏可拖拽）
- 小窗：src/components/MiniWindow.tsx（已实现收起/展开）
- 任务区：src/components/TaskPanel.tsx（已实现任务树）
- 设置页：src/components/SettingsPanel.tsx（已实现 CLI 诊断面板）
- 计时区：src/components/TimerPanel.tsx
- 历史页：src/components/HistoryPanel.tsx
- Toast：src/components/Toast.tsx
- Segment 时间线：src/components/SegmentTimeline.tsx
```

UI AI 应先用 `npm run dev` 启动应用，**实际体验当前 UI**，再决定重做方案。

---

## 十七、优先级建议

如果 UI AI 时间有限，按以下优先级处理：

```
P0（必须）：
  1. 小窗视觉重做（展开模式 + 紧凑模式 + 收纳模式）⚠️ v0.1.5 重点，不要沿用现有贴边实现
  2. 字体替换（Inter + Microsoft YaHei UI + Inter Tight）
  3. 主窗口计时区视觉优化（保留 idle 预选任务流程 + startWithTask 调用）
  4. 任务树视觉优化（保留逻辑，默认折叠是硬要求）

P1（重要）：
  5. 设置页分组（Tab 或折叠面板）
  6. 空状态设计
  7. 错误状态优化
  8. 深色/浅色主题完善

P2（可选）：
  9. 动画细节
  10. 响应式断点
  11. 托盘菜单图标
  12. 历史记录页重做
```

---

## 十八、联系方式

如有疑问，可通过以下方式确认：

```
- 项目目录：c:\Users\poyi\Desktop\time1
- 当前版本：0.1.5
- 主分支：main
- 报告文档：docs/*.md
```

**请勿修改 docs/*.md 中的报告文档**，这些是历史记录。
