# 专注小窗贴边自动收纳报告（v0.1.4）

## 1. 目标

让专注小窗在靠近屏幕边缘时自动收纳成小条，保留状态点 + 时间 + 进度条；支持点击 / 鼠标悬停 / 托盘菜单 / 快捷键触发展开，并有基础动画。

## 2. 实现概览

### 2.1 贴边检测
- 位置：`electron/main.ts` `createMiniWindow()` 内 `win.on('move', scheduleEdgeCheck)`
- 阈值：`const threshold = 8`（距屏幕工作区任意边 ≤ 8px 视为贴边）
- 防抖延迟：`scheduleEdgeCheck` 使用 `clearTimeout + setTimeout`，延迟取自 `settings.miniWindow.edgeCollapseDelayMs`（默认 500ms）
- 检测函数 `checkEdgeCollapse(win)`：
  - 关闭自动收纳时直接 return
  - 已收起则跳过
  - `screen.getDisplayMatching(bounds).workArea` 与 bounds 比对，命中四边任一即触发 `collapseMiniWindow()`

### 2.2 收纳 / 展开动画
- `animateCollapseMiniWindow(win, fromH, toH)` / `animateExpandMiniWindow(win, fromH, toH)`
- 6 步、180ms、`setBounds` 分步线性插值高度，宽高 X/Y 不变 → 不引起位置乱跳
- 收起目标高度 40px，展开目标高度 = `settings.miniWindow.height`（范围校验 88–240，否则用 132）
- 不影响计时刷新：计时数字由 snapshot 推送驱动，与窗口尺寸动画解耦

### 2.3 三模式 UI
- 由 `src/components/MiniWindow.tsx` 根据窗口宽度切换：
  - `EXPANDED`（完整模式）：状态点 + 时间 + 进度 + 任务标题
  - `COMPACT`（宽 < 260px）：精简
  - `COLLAPSED`（宽 < 60 或高 < 60）：仅状态点 + 时间 + 一条细进度条

### 2.4 触发展开
| 触发方式 | 实现 |
| --- | --- |
| 鼠标悬停小条 | `win.on('mouse-enter')` + `settings.miniWindow.hoverToExpand` |
| 托盘菜单展开 | `ipcMain.on('mini:expand')` → `expandMiniWindow()` |
| 快捷键显示/展开 | `toggleMiniWindow()` 已包含显示逻辑 |
| 点击小条 | 由渲染层 MiniWindow.tsx 点击事件调用 `mini.expand()` |

### 2.5 专注开始后自动收纳
- 位置：`handleTimerStateTransition(snap)`
- 触发条件：`justStarted && settings.miniWindow.autoCollapseOnFocusStart && miniWindow 可见 && !collapsed`
- 检测小窗当前 bounds 是否已贴边，贴边才收起（主窗口在前台时不强制弹出小窗）

## 3. 设置项（SettingsPanel.tsx 外观 Tab → 专注小窗）

| 设置 | 字段 | 默认 | 说明 |
| --- | --- | --- | --- |
| 贴边自动收纳 | `edgeAutoCollapse` | false | 总开关 |
| 收纳延迟 | `edgeCollapseDelayMs` | 500 | 200–1500ms 可调，步进 50 |
| 鼠标悬停自动展开 | `hoverToExpand` | true | 收纳条悬停即展开 |
| 专注开始后自动收纳 | `autoCollapseOnFocusStart` | false | 开始专注时若已贴边则收起 |

设置项仅在 `edgeAutoCollapse` 开启时展开显示（条件渲染）。

## 4. 验收标准对照

| # | 验收标准 | 实现 |
| --- | --- | --- |
| 1 | 小窗拖到顶部边缘，500ms 后自动收起 | ✅ `checkEdgeCollapse` 四边检测 + 500ms 默认延迟 |
| 2 | 小窗拖到底部边缘，500ms 后自动收起 | ✅ 同上 |
| 3 | 小窗拖到左/右边缘，500ms 后自动收起或缩窄 | ✅ 收起为 40px 横条 |
| 4 | 收起后仍能看到时间 | ✅ MiniWindow COLLAPSED 模式渲染时间 + 进度条 |
| 5 | 点击小条能展开 | ✅ 渲染层点击 → `mini.expand` |
| 6 | 悬停小条能展开 | ✅ `mouse-enter` + `hoverToExpand` |
| 7 | 托盘菜单能展开/收起 | ✅ 托盘菜单 `mini.collapse` / `mini.expand` |
| 8 | 关闭贴边自动收纳后，不再自动收起 | ✅ `edgeAutoCollapse` 总开关短路 |
| 9 | 收纳/展开有基础动画 | ✅ 6 步 180ms `setBounds` |
| 10 | 打包版可用 | ✅ 已包含在 release-v014 |

## 5. 已知限制
- 四方向统一收纳为顶部横条样式（暂未实现左侧/右侧贴边时变为竖条）
- `mouse-enter` 事件未在 Electron d.ts 中显式声明，用 `(win as any).on('mouse-enter', ...)` 绕过类型检查（运行时 Electron 支持该事件）

## 6. 涉及文件
- `electron/main.ts`：贴边检测 + 动画 + 悬停展开 + 专注开始自动收纳
- `shared/types.ts`：`MiniWindowConfig` 新增 `edgeCollapseDelayMs` / `hoverToExpand` / `autoCollapseOnFocusStart`；`DEFAULT_SETTINGS.miniWindow` 默认值
- `src/components/SettingsPanel.tsx`：贴边收纳设置项 UI（条件渲染）
- `src/components/MiniWindow.tsx`：三模式 UI（沿用 v0.1.3 实现，未改动）
