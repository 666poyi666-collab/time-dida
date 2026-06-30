# FocusLink - 专注小窗 UX 改进报告

生成时间：2026-06-29

## 一、问题背景

用户反馈当前专注小窗体验问题：

1. 小窗颜色很丑
2. 主界面切到亮色主题后，小窗还是黑色，主题不统一
3. 小窗大小固定，不能调整
4. 小窗只能通过托盘显示，交互不够顺手
5. 希望支持贴边收纳，可开关

要求：
- 不要大改主界面，现在只改专注小窗
- 深色/浅色主题统一
- 主界面不要影响核心功能
- 不要为了 UI 重构核心代码

## 二、修复方案与实现

### 2.1 新增配置项（shared/types.ts）

```typescript
export interface MiniWindowConfig {
  followMainTheme: boolean;        // 是否跟随主界面主题
  themeMode: 'system' | 'dark' | 'light';  // 强制主题
  opacity: number;                  // 透明度 0.6-1.0
  width: number;                    // 宽度
  height: number;                   // 高度
  x: number | null;                 // X 位置
  y: number | null;                 // Y 位置
  collapsed: boolean;                // 是否收起
  edgeAutoCollapse: boolean;        // 是否启用贴边自动收纳
}
```

默认值：
```typescript
miniWindow: {
  followMainTheme: true,
  themeMode: 'system',
  opacity: 0.92,
  width: 280,
  height: 120,
  x: null,
  y: null,
  collapsed: false,
  edgeAutoCollapse: false,
}
```

### 2.2 小窗主题同步（MiniWindow.tsx）

**实现策略**：通过 CSS 变量 `--bg-base` / `--fg-default` / `--accent` 等控制小窗颜色。

`MiniWindow.tsx` 新增 `applyThemeClass(s)` 函数：
1. 读取 `settings.miniWindow.followMainTheme` 判断是否跟随主界面
2. 跟随时使用 `settings.theme`（'dark' / 'light'）
3. 不跟随时按 `themeMode` 决定：
   - `system`：使用 `window.matchMedia('(prefers-color-scheme: light)')`
   - `dark`：强制深色
   - `light`：强制浅色
4. 应用主题色 `accent-{name}` 类（与主界面相同的 6 种主题色：indigo / violet / emerald / rose / amber / sky）
5. 应用到 `document.documentElement.classList`

**主题同步流程**：
1. 小窗启动时调用 `window.focuslink.settings.get()` 读取设置，应用主题
2. 监听 `'settings:changed'` 事件（来自主进程广播）
3. 设置页修改主题时，主进程 `settings:set` 通过 `BrowserWindow.getAllWindows().forEach(w => w.webContents.send('settings:changed', next))` 广播给所有窗口，小窗收到后重新 `applyThemeClass`

**修复前**：小窗始终深色，与主界面主题不同步
**修复后**：小窗跟随主界面主题实时变化，主题色（accentColor）也同步

### 2.3 小窗尺寸可调整（main.ts createMiniWindow）

```typescript
const opts: Electron.BrowserWindowConstructorOptions = {
  width: cfg.width,
  height: useHeight,  // 收起时为 36，展开时为 cfg.height
  minWidth: 200,
  minHeight: 36,
  maxWidth: 600,
  maxHeight: 400,
  resizable: true,  // ← 关键：允许拖动调整大小
  ...
};
```

**位置和大小持久化**：
- 监听 `win.on('resize', scheduleSave)` 和 `win.on('move', scheduleSave)`
- `scheduleSave` 节流 400ms 避免频繁写盘
- 保存到 `settings.miniWindow.{width, height, x, y}`
- 启动时读取 `cfg.x/cfg.y/cfg.width/cfg.height` 应用
- 收起状态下不保存高度（保留上次展开高度）

**默认大小**：280×120
**最大**：600×400
**最小**：200×36

### 2.4 小窗手动收起/展开

**收起状态 UI**：变成一个小横条
- 左侧：状态点（pulse 动画表示运行中） + 计时数字 + 状态文字
- 右侧：进度条（25 分钟为满）+ 展开按钮 ChevronUp
- 双击横条展开

**展开状态 UI**（原 UI 增强）：
- 顶部：状态点 + 状态文字 + 工具栏（Maximize2 打开主窗口 / ChevronDown 收起）
- 中部：大号计时 + 任务标题
- 底部：开始/暂停/继续 + 结束 按钮

**IPC 通道**：
- `mini:collapse` → `collapseMiniWindow()`：高度变为 36，更新 settings.collapsed=true
- `mini:expand` → `expandMiniWindow()`：高度恢复，更新 settings.collapsed=false
- `mini:reset` → `resetMiniWindow()`：恢复 280×120，位置 (50,50)

**Preload 暴露**：
```typescript
mini: {
  show, hide, toggle,
  collapse, expand, reset,
  getConfig, setOpacity,
}
```

**状态记忆**：`settings.miniWindow.collapsed` 持久化，重启后保持上次的收起状态

### 2.5 贴边自动收纳（实验性，可开关）

**实现**：
- `settings.miniWindow.edgeAutoCollapse = true` 时启用
- 监听 `win.on('move', () => checkEdgeCollapse(win))`
- 检查窗口边界是否贴近 `screen.getDisplayMatching(bounds).workArea` 边缘（阈值 8px）
- 顶/底/左/右任一边触发即自动收起
- 收起后小窗显示横条，可手动展开

**注意**：当前为简化版，不区分方向收起。鼠标悬停展开未实现（需要监听 mouse-enter，且小窗始终 ontop 会有覆盖问题），先用手动展开按钮代替。

### 2.6 透明度配置

**实现**：通过 `BrowserWindow.setOpacity(opacity)` 设置整个窗口透明度。

**设置页**：
- 滑块范围 0.6 - 1.0，步进 0.02
- 实时应用：拖动时立即调用 `window.focuslink.mini.setOpacity(v)`
- 保存到 `settings.miniWindow.opacity`

### 2.7 托盘菜单增强（tray.ts）

新增 5 个菜单项（在原「显示专注小窗」之后）：
- 显示专注小窗
- 隐藏专注小窗
- 收起小窗为横条
- 展开小窗
- 重置小窗位置和大小

每个菜单项对应主进程的 `showMiniWindow / hideMiniWindow / collapseMiniWindow / expandMiniWindow / resetMiniWindow` 函数。

### 2.8 设置页 UI（SettingsPanel.tsx）

新增「专注小窗」Section：
- 跟随主界面主题：开关
- 小窗主题：跟随系统 / 深色 / 浅色（仅当不跟随主界面时显示）
- 透明度滑块（带百分比显示）
- 贴边自动收纳：开关
- 当前尺寸显示：`280 × 120 (已收起)`
- 操作按钮：收起 / 展开 / 恢复默认大小

## 三、修复前后对比

| 项目 | 修复前 | 修复后 |
|------|--------|--------|
| 主题同步 | 固定深色，主界面切亮色不跟随 | 实时跟随主界面，含主题色 |
| 尺寸调整 | 固定 280×120，resizable:false | 可拖动 200×36 ~ 600×400 |
| 位置记忆 | 固定 (50,50) | 自动保存上次位置，重启恢复 |
| 收起/展开 | 无 | 手动按钮 + 托盘菜单 + 双击横条展开 |
| 收起后显示 | 无 | 状态点 + 时间 + 进度条 |
| 透明度 | 无 | 60% - 100% 可调 |
| 贴边收纳 | 无 | 可开关，自动收起为横条 |
| 托盘控制 | 只有「显示小窗」 | 显示/隐藏/收起/展开/重置 5 项 |
| 打开主窗口 | 无 | Maximize2 图标按钮 |
| 主题色 | 单一 indigo | 6 种 accent 色可选 |

## 四、验收标准达成

| 验收项 | 状态 |
|--------|------|
| 深色/浅色主题同步 | ✅ 通过 `settings:changed` 事件广播 |
| 小窗可以调整大小 | ✅ resizable:true，min/max 限制 |
| 小窗位置和大小重启后保留 | ✅ 节流 400ms 保存到 settings.json |
| 可以手动收起/展开 | ✅ 按钮 + 托盘菜单 + 双击 |
| 贴边收纳（简化版） | ✅ edgeAutoCollapse 开关，自动收起 |
| 收起后仍能看到时间 | ✅ 横条显示时间和状态点 |
| 托盘能控制小窗显示/隐藏/展开/收起 | ✅ 5 个菜单项 |

## 五、仍未实现 / 已知限制

1. **鼠标悬停展开**：收起状态下鼠标悬停不会自动展开（需要监听 mouse-enter，但小窗 alwaysOnTop 会与其他窗口冲突）
2. **方向化贴边收纳**：当前贴边任意方向都收起为顶部横条，没有区分左右上下不同方向
3. **小窗位置预览**：移动小窗时没有半透明预览，直接拖动
4. **主题色变化动画**：主题切换时无过渡动画（用户明确要求「不要复杂动画」）
5. **多显示器支持**：贴边收纳仅检查当前 `display.workArea`，多显示器场景未充分测试

## 六、验证步骤

1. 双击 `release/FocusLink-0.1.0-x64.exe` 启动应用
2. 主界面正常显示
3. 设置页 → 专注小窗 → 启用「跟随主界面主题」
4. 设置页 → 外观 → 主题 → 切换为「浅色」
5. 应看到主界面变浅色
6. 点击托盘菜单「显示专注小窗」
7. 小窗出现，颜色与主界面一致（浅色背景 + 浅色 accent）
8. 拖动小窗右下角调整大小，应能缩放（200×36 到 600×400）
9. 拖动小窗到屏幕左上角，松开手，应能保存位置
10. 重启应用，小窗应出现在上次位置
11. 点击小窗右上角 ChevronDown 按钮，小窗收起为横条
12. 横条显示状态点 + 时间 + 进度条
13. 双击横条，小窗展开
14. 点击 Maximize2 图标，应打开/聚焦主窗口
15. 设置页 → 专注小窗 → 拖动透明度滑块，小窗透明度实时变化
16. 启用「贴边自动收纳」，把小窗拖到屏幕顶部边缘，应自动收起
17. 托盘菜单 → 「展开小窗」→ 应展开

## 七、技术细节

### 7.1 主进程 IPC 处理

```typescript
// electron/main.ts
ipcMain.on('mini:collapse', () => collapseMiniWindow());
ipcMain.on('mini:expand', () => expandMiniWindow());
ipcMain.on('mini:reset', () => resetMiniWindow());
ipcMain.handle('mini:get-config', () => getSettings().miniWindow);
ipcMain.on('mini:set-opacity', (_e, opacity: number) => {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.setOpacity(Math.max(0.6, Math.min(1.0, opacity)));
  }
});
```

### 7.2 收起/展开实现

```typescript
function collapseMiniWindow(): void {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const cur = getSettings();
  if (cur.miniWindow.collapsed) return;
  const [w, _h] = miniWindow.getSize();
  miniWindow.setSize(w, 36);  // 高度变为 36
  updateSettings({ miniWindow: { ...cur.miniWindow, collapsed: true } });
}

function expandMiniWindow(): void {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const cur = getSettings();
  if (!cur.miniWindow.collapsed) return;
  const [w, _h] = miniWindow.getSize();
  miniWindow.setSize(w, cur.miniWindow.height);  // 恢复保存的高度
  updateSettings({ miniWindow: { ...cur.miniWindow, collapsed: false } });
}
```

### 7.3 位置保存节流

```typescript
let saveTimer: NodeJS.Timeout | null = null;
const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!miniWindow || miniWindow.isDestroyed()) return;
    const bounds = miniWindow.getBounds();
    updateSettings({
      miniWindow: { ...cur.miniWindow, width: bounds.width, height: ..., x: bounds.x, y: bounds.y },
    });
  }, 400);
};
win.on('resize', scheduleSave);
win.on('move', scheduleSave);
```

### 7.4 主题广播

```typescript
// electron/ipc.ts
ipcMain.handle('settings:set', (_e, settings) => {
  const next = saveSettings(settings);
  onSettingsChanged();
  // 广播到所有窗口，让小窗等独立窗口能同步主题
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send('settings:changed', next);
    }
  }
  return next;
});
```

```typescript
// src/components/MiniWindow.tsx
useEffect(() => {
  const unsub = window.focuslink.on('settings:changed', (...args: unknown[]) => {
    const s = args[0] as AppSettings;
    if (s) {
      setSettings(s);
      setCollapsed(s.miniWindow.collapsed);
      applyThemeClass(s);
    }
  });
  return () => unsub();
}, []);
```

## 八、打包验证

- ✅ TypeScript 编译通过（`npx tsc --noEmit`）
- ✅ Vite build 成功
- ✅ electron-builder NSIS 打包成功
- ✅ 产物：`release/FocusLink-0.1.0-x64.exe`（83 MB）
- ✅ 双击可启动（无 PowerShell 依赖）
