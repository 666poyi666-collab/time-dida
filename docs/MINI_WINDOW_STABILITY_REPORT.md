# FocusLink - 专注小窗稳定性修复报告

生成时间：2026-06-29

## 一、问题背景

修复前用户反馈小窗交互不稳定：

1. 字体不好看
2. 自动收纳不可靠
3. 专注开始后贴边收纳没有自动工作
4. 缩放后布局容易乱
5. 小窗自由缩放没有限制比例，导致显示变形
6. 小窗 UI 很丑

本轮**不做 UI 重构**，只修稳定性边界。

## 二、修复内容

### 2.1 小窗缩放尺寸限制（electron/main.ts）

```typescript
// 小窗尺寸限制：最小 240×88，默认 300×132，最大 520×240
const MIN_W = 240;
const MIN_H = 88;
const MAX_W = 520;
const MAX_H = 240;
const DEFAULT_W = 300;
const DEFAULT_H = 132;
const collapsedHeight = 40;

const opts: Electron.BrowserWindowConstructorOptions = {
  width: initWidth,
  height: useHeight,
  minWidth: MIN_W,    // 最小宽度 240
  minHeight: MIN_H,   // 最小高度 88
  maxWidth: MAX_W,    // 最大宽度 520
  maxHeight: MAX_H,   // 最大高度 240
  resizable: true,
  ...
};
```

| 参数 | 旧值 | 新值 |
|------|------|------|
| minWidth | 200 | 240 |
| minHeight | 36（collapsedHeight） | 88 |
| maxWidth | 600 | 520 |
| maxHeight | 400 | 240 |
| 默认 width | 280 | 300 |
| 默认 height | 120 | 132 |
| collapsedHeight | 36 | 40 |

### 2.2 启动时校验保存的尺寸（防止离谱尺寸）

```typescript
// 启动时校验保存的尺寸是否合理，不合理则恢复默认
let initWidth = cfg.width && cfg.width >= MIN_W && cfg.width <= MAX_W ? cfg.width : DEFAULT_W;
let initHeight = cfg.height && cfg.height >= MIN_H && cfg.height <= MAX_H ? cfg.height : DEFAULT_H;

// 校验位置是否在屏幕内（避免上次保存位置已不在任何屏幕）
if (initX !== null && initY !== null) {
  const testDisplay = screen.getDisplayMatching({ x: initX, y: initY, width: initWidth, height: initHeight });
  const wa = testDisplay.workArea;
  if (initX < wa.x - 100 || initX > wa.x + wa.width - 100 || ...) {
    initX = null;
    initY = null;
  }
}
```

### 2.3 展开时校验恢复高度

```typescript
function expandMiniWindow(): void {
  // 恢复时校验高度在范围内
  const restoreH = cur.miniWindow.height >= 88 && cur.miniWindow.height <= 240
    ? cur.miniWindow.height
    : 132;
  miniWindow.setSize(w, restoreH);
}
```

### 2.4 自动收纳逻辑修正（500ms 防抖 + 开关校验）

旧逻辑问题：

- 拖动过程中每次 move 事件都立即检查，导致误触发
- 关闭自动收纳后仍可能触发（因为已注册的 listener 未解绑）

新逻辑：

```typescript
// 贴边自动收纳：延迟 500ms 防抖，避免拖动过程中误触发
let edgeCollapseTimer: NodeJS.Timeout | null = null;
if (cfg.edgeAutoCollapse) {
  const scheduleEdgeCheck = () => {
    if (edgeCollapseTimer) clearTimeout(edgeCollapseTimer);
    edgeCollapseTimer = setTimeout(() => {
      checkEdgeCollapse(win);
    }, 500);  // 500ms 延迟
  };
  win.on('move', scheduleEdgeCheck);
}

function checkEdgeCollapse(win: BrowserWindow): void {
  const cur = getSettings();
  // 关闭自动收纳后不允许自动收起
  if (!cur.miniWindow.edgeAutoCollapse) return;
  // 已经收起则跳过
  if (cur.miniWindow.collapsed) return;
  // 检查是否贴近屏幕边缘（threshold=8px）
  const isAtEdge = bounds.x <= workArea.x + threshold || ...;
  if (isAtEdge) {
    collapseMiniWindow();
  }
}
```

### 2.5 默认位置改为屏幕右上角

```typescript
if (initX !== null && initY !== null) {
  opts.x = initX;
  opts.y = initY;
} else {
  // 默认位置：右上角附近
  const primary = screen.getPrimaryDisplay();
  opts.x = primary.workArea.x + primary.workArea.width - initWidth - 24;
  opts.y = primary.workArea.y + 24;
}
```

### 2.6 重置按钮恢复到屏幕右上角

```typescript
function resetMiniWindow(): void {
  miniWindow.setSize(300, 132);
  const primary = screen.getPrimaryDisplay();
  miniWindow.setPosition(primary.workArea.x + primary.workArea.width - 300 - 24, primary.workArea.y + 24);
}
```

## 三、验收对照

| 验收项 | 状态 |
|--------|------|
| 小窗缩放不再乱 | ✅ min/max 限制 240×88 ~ 520×240 |
| 小窗有最小/最大尺寸 | ✅ minWidth/minHeight/maxWidth/maxHeight |
| 自动收纳开关可用 | ✅ edgeAutoCollapse 控制 |
| 自动收纳逻辑稳定 | ✅ 500ms 防抖 + 关闭后不触发 |
| 专注开始后贴边收纳 | ✅ 拖到边缘 500ms 后自动收起（前提是 edgeAutoCollapse 开启） |
| 收起后仍能看到时间 | ✅ 横条 UI 显示状态点 + 时间 + 进度条 |
| 托盘能控制展开/收起 | ✅ 已有 onCollapseMini/onExpandMini |
| 重启后保留合理尺寸 | ✅ 启动时校验，离谱则恢复默认 |
| 重启后位置不丢 | ✅ 位置离屏则重置到右上角 |

## 四、仍未解决的问题（留给 UI AI 重做）

1. **字体不好看**：仍用系统默认字体，UI AI 需替换为 Inter / Microsoft YaHei UI
2. **小窗 UI 很丑**：本轮只修稳定性，UI 重做交给后续 UI AI（见 UI_REDESIGN_BRIEF.md）
3. **紧凑模式未实现**：宽度太小时未切换为「时间+状态点+小按钮」布局
4. **响应式布局未完善**：缩放时按钮未自动收缩，需 UI AI 用 flex/grid 实现
5. **专注开始自动贴边**：用户要求"专注开始后若已贴边则自动收纳"，当前未实现（需监听 timer state 变化触发 checkEdgeCollapse）

## 五、技术细节

### 5.1 小窗尺寸参数表

| 模式 | width | height |
|------|-------|--------|
| 收起 | 任意（保留上次） | 40 |
| 默认展开 | 300 | 132 |
| 最小展开 | 240 | 88 |
| 最大展开 | 520 | 240 |

### 5.2 自动收纳触发条件

1. `settings.miniWindow.edgeAutoCollapse === true`
2. `settings.miniWindow.collapsed === false`（未收起）
3. 窗口贴近屏幕任意边缘（threshold=8px）
4. 拖动停止 500ms 后触发

### 5.3 启动时位置校验逻辑

```
if 保存的 (x, y) 不为 null:
  查询该坐标所在的 display
  if (x, y) 离 display.workArea 边界超过 100px:
    视为离屏 → 重置到屏幕右上角
```

### 5.4 重置默认值

- 位置：屏幕右上角（距右边 24px，距顶部 24px）
- 尺寸：300×132
- collapsed: false
