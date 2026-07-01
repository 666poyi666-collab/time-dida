# FocusLink UI 规格 (UI_SPEC)

> 版本：v0.1.7
> 本文写给 UI AI，是当前 UI 的权威规格。完整历史设计资料见 `docs/archive/`（UI_DESIGN_SPEC.md、UI_REDESIGN_BRIEF.md、UI_HANDOFF_UPDATE_REPORT.md）。
> **核心原则：只改展示层，不要重写底层业务逻辑。**

## 1. 设计方向

FocusLink 是紧凑的桌面专注账本：UI 要让「每个时间段属于哪个任务」一目了然。风格参考 Raycast、Linear、TickTick：紧凑间距、边框分隔、克制阴影、清晰状态徽章。

```
现代 / 轻量 / 干净 / 高效工具感
不要像传统 Windows 小工具
不要花哨的渐变和阴影堆叠
```

核心交互入口**不是主界面**，而是：快捷键 → 专注小窗 → 托盘菜单 → 任务关联 → 历史记录。主界面是管理面板，不应喧宾夺主。

## 2. 设计 Tokens

核心 tokens 在 `src/index.css` 的 `--app-*` 命名空间：

- 背景：`--app-bg` / `--app-surface` / `--app-surface-2` / `--app-elevated`
- 文字：`--app-text` / `--app-muted` / `--app-subtle`
- 边框：`--app-border` / `--app-border-strong` / `--app-border-subtle`
- 主题色：`--app-accent` / `--app-accent-hover` / `--app-accent-soft` / `--app-accent-fg`
- 状态色：`--app-success` / `--app-warning` / `--app-danger` / `--app-info`
- 圆角：`--radius-sm` (6px) / `--radius-md` (10px) / `--radius-lg` (14px) / `--radius-xl` (20px)
- 阴影：`--shadow-sm` / `--shadow-md` / `--shadow-lg` / `--shadow-glow`
- 间距：`--space-1` (4px) ~ `--space-8` (32px)

旧 Tailwind 变量（`--bg-base` / `--fg-default` / `--accent`）保留为别名，确保旧组件继续工作。浅色主题通过 `.light` 类覆盖。

## 3. 字体

| 用途 | 推荐字体 | 备选 | 字重 |
| --- | --- | --- | --- |
| 中文 | Microsoft YaHei UI | HarmonyOS Sans SC / 思源黑体 | Regular / Medium / Semibold |
| 英文 | Inter | SF Pro / Segoe UI | Regular / Medium / Semibold |
| 计时数字（主窗口） | Inter Tight | JetBrains Mono / Geist Mono | Semibold / Bold |
| 计时数字（小窗） | Inter Tight | SF Pro Display | Bold |

字号层级：

```
H1 标题：18px / Semibold
H2 区块：14px / Medium
正文：13px / Regular
辅助文字：11px / Regular
计时数字（主窗口）：48-56px / Bold / tabular-nums
计时数字（小窗）：24-32px / Bold / tabular-nums
计时数字（收起横条）：13px / Bold / tabular-nums
```

CSS 实现：

```css
:root {
  --font-sans: 'Inter', 'Microsoft YaHei UI', 'PingFang SC', system-ui, sans-serif;
  --font-mono: 'Inter Tight', 'JetBrains Mono', ui-monospace, monospace;
}
.timer-digit {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
  letter-spacing: -0.02em;
}
```

字体通过 `@fontsource/inter` / `@fontsource/inter-tight` 本地加载，**不依赖 CDN**。已在 `src/index.css` 引入 400/500/600（Inter）和 600/700（Inter Tight）。

## 4. 组件规则

- 卡片用 8px 圆角（`.card`），避免厚重阴影
- 按钮：图标前置，primary / outline / ghost 三种变体
- 输入框用边框 + focus ring，不用厚重立体感
- 状态徽章用软背景 + 明确文案：`[当前片段]` `[本次默认]` `[已完成]` `[子任务 N]`
- 所有可交互元素都要有 `focus-visible` 样式
- 动画 150-200ms（不超过 250ms），缓动 `cubic-bezier(0.4, 0, 0.2, 1)`，避免弹跳/旋转

## 5. 主窗口

```
┌─────────────────────────────────────────────┐
│ 顶部导航（轻量）                              │
├──────────────┬──────────────────────────────┤
│ 左侧          │ 右侧                          │
│ 专注状态      │ 任务树                        │
│ 大计时数字    │ 父任务 / ├ 子任务             │
│ Segment 时间线│ 搜索 / 显示已完成开关          │
│ 控制按钮      │                              │
├──────────────┴──────────────────────────────┤
│ 底部状态栏（同步 / CLI / 版本）               │
└─────────────────────────────────────────────┘
```

- 尺寸：最小 960×640，默认 1180×760
- 左右分栏可拖拽（`settings.layout.leftPaneWidth`），左 360px~50%，右 ≥420px，双击恢复默认
- TimerPanel 计时区有固定安全最大宽度，防止旧布局裁切任务树
- **idle 状态必须显示预选任务 UI**（`尚未选择任务 · 点击选择` 或 `即将专注任务：xxx`），保留 `window.focuslink.timer.startWithTask(...)` 调用
- running/paused 状态：当前片段任务、本次默认任务分两个 surface 展示

## 6. 专注小窗（P0 重做对象）

小窗是**核心交互入口**，从 v0.2.5 起固定为两种产品状态：

| 模式 | 内容 | 尺寸 |
| --- | --- | --- |
| 缩小 | 状态 + 展开按钮 + 当前专注/当前暂停 + 累计专注/累计暂停 | 260×88 |
| 展开（默认） | 状态 + 当前任务 + 当前片段大计时 + 当前/累计专注 + 当前/累计暂停 + 总历时 + 控制按钮 | 420×184 |

### v0.1.5 关键约束（必须遵守）

- 贴边自动收纳（`edgeAutoCollapse` / `hoverToExpand` / `autoCollapseOnFocusStart`）**已默认关闭**，现有实现**不要沿用**（会乱跳/乱缩放/挡屏幕）
- 缩小/展开在主进程使用**直接 `setBounds` 无动画**；如需过渡动画，在渲染层用 CSS/transform 实现，**不要在主进程做 incremental setBounds 动画**
- 必须保留的交互入口：手动收起/展开、托盘控制、主窗口隐藏时自动显示小窗、专注开始时主窗口不在前台则自动显示小窗

### BrowserWindow 构造参数（已实现，可参考）

```ts
{
  frame: false, transparent: true, resizable: true,
  alwaysOnTop: true, skipTaskbar: true,
  minWidth: 260, minHeight: 88, maxWidth: 420, maxHeight: 184,
  // 透明度通过 settings.miniWindow.opacity (0.6~1.0) 控制
}
```

### 小窗必须支持

- 拖动移动位置，大小只吸附到 260×88 或 420×184
- 手动收起/展开（`mini:collapse` / `mini:expand` IPC）
- 透明度调节、跟随主界面主题
- 位置和大小重启后保留（启动时校验离谱尺寸/离屏位置）
- 托盘菜单控制

## 7. 任务树 / TaskPicker

**默认折叠是硬要求**。所有任务树组件（TaskPanel、TaskPicker、HistoryPanel、TimerPanel、批量关联选择器）统一规则：

- 父任务默认折叠 → 点击箭头展开 → 搜索命中子任务时自动展开父任务 → 清空搜索后恢复搜索前折叠状态（**不是全部展开**）
- 已完成任务默认隐藏，有显示开关
- 任务标题**不要用 `↳` 前缀**，用缩进表达层级
- 父任务：边框行，字号稍大 + Semibold
- 子任务：缩进 16-24px + 左侧细线（left rail）
- 当前片段任务 / 本次默认任务：accent / emerald 软背景徽章
- 已完成任务：删除线 + opacity 0.5 + 灰色
- 排序：未完成在前 → 有截止日期 → sortOrder → priority
- 项目过滤：只显示所选 dida 项目任务，保留父子结构（子任务继承父任务 projectId）
- 空状态：所选项目无任务时显示空状态

## 8. 历史页

- 每个 session 展开后显示：时间统计（active/pause/wall）、默认任务、批量关联操作、segment 行
- **未关联 segment** 用 warning 色虚线样式，便于发现缺失关联
- 批量关联 + 单 segment 关联都复用 `TaskPicker` 流程
- 历史 segment 可后补关联任务（`timer:link-task`），可批量关联未关联 segment（`timer:link-segments-batch`）

## 9. 设置页

分组为 Tab：`[外观] [任务] [快捷键] [小窗] [同步] [关于]`

- 外观：主题（深/浅）、主题色（6 种 accent）、字体大小（可选）
- 任务：任务来源（本地 / dida CLI / TickTick OAuth）、dida CLI 诊断面板（6 步 + 测试 + 复制）、应用 dida 默认模板按钮、当前 Provider 显示
- 快捷键：5 个快捷键配置、冲突检测、恢复默认
- 小窗：跟随主界面主题、小窗主题、透明度滑块、收起/展开/重置按钮（贴边收纳开关已禁用）
- 同步：同步模式、立即同步按钮、同步状态
- 关于：版本号、GitHub 链接、反馈

CLI 诊断面板保留所有功能按钮和 IPC 调用（`cli:diagnose` / `cli:test-command` / `cli:apply-dida-defaults`）。

## 10. 空状态 / 错误状态

- 任务列表空：📋 暂无任务 + 引导刷新或切换来源
- 历史空：📊 还没有专注记录 + 引导按 Ctrl+Alt+Space 开始
- 未关联任务：🔗 当前片段未关联任务 + 引导按 Ctrl+Alt+T
- CLI 失败：⚠ 具体原因 + [打开诊断] [应用模板] 按钮

## 11. 响应式

```
主窗口：最小 960×640，默认 1180×760
小窗：缩小 260×88，默认展开 420×184
断点：小窗不再依赖宽度断点；主窗口 < 720px 高时隐藏 Segment 时间线
```

## 12. 滚动条

```css
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgb(var(--app-border)); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: rgb(var(--app-muted)); }
```

## 13. 不可破坏的业务契约（再次强调）

- **不要破坏任务关联逻辑**：Segment 与 Task 的绑定关系（`taskId/taskSource/title`）是核心数据，UI 只能读取和调用 IPC 修改
- **不要破坏 Segment 继承**：暂停后继续新建 Segment 并继承 Session 默认任务
- **不要重写 Timer 状态机**：`idle → running → paused → running → finished`、三时间账本、崩溃恢复都在主进程
- **不要改 IPC 通道名和参数结构**
- **不要改设置分域逻辑**（`detectChangedDomains`）

### 可修改 / 不可修改文件

```
✅ 可改：src/App.tsx、src/components/*.tsx、src/index.css、tailwind.config.js
✅ 可改：mini.html、src/mini.tsx、src/components/MiniWindow.tsx
✅ 可改：src/store/useStore.ts（仅 UI 状态，不动业务字段）
✅ 可改：electron/main.ts 的 BrowserWindow 构造参数（仅视觉）
✅ 可改：electron/tray.ts 的菜单文案和图标

⛔ 禁止：electron/timer/*、electron/db/*、electron/tasks/cliProvider.ts
⛔ 禁止：electron/hotkeys.ts、electron/ipc.ts、electron/preload.ts
⛔ 禁止：electron/settingsStore.ts、shared/types.ts（除非新增字段）
```

## 14. UI AI 验证步骤

1. `npm run dev` 启动开发模式
2. 主窗口视觉正常
3. 小窗视觉正常（展开/紧凑/收起三种模式）
4. 主题切换正常（深色/浅色 + 6 种 accent）
5. 任务树展示正常（折叠/展开/搜索/项目过滤）
6. 快捷键仍可用
7. 托盘菜单仍可用
8. dida CLI 任务仍能读取
9. 计时器实时跳动
10. `npm run build` 打包成功

## 15. 优先级

```
P0：小窗视觉重做（三种模式，不沿用贴边实现）+ 字体替换 + 主窗口计时区 + 任务树视觉
P1：设置页分组 + 空状态 + 错误状态 + 深浅主题完善
P2：动画细节 + 响应式断点 + 托盘图标 + 历史页重做
```

## 16. 相关文档

- [产品规格](PRODUCT_SPEC.md) — 功能清单
- [架构说明](ARCHITECTURE.md) — 可改/不可改文件清单
- 完整历史设计资料：`docs/archive/UI_DESIGN_SPEC.md`、`docs/archive/UI_REDESIGN_BRIEF.md`、`docs/archive/UI_HANDOFF_UPDATE_REPORT.md`
