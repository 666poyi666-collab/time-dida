# FocusLink 架构说明 (ARCHITECTURE)

> 版本：v0.1.7
> 本文写给功能 AI / 维护者，描述代码分层、数据流、关键模块与不可修改的契约。

## 1. 技术栈

| 层 | 技术 |
| --- | --- |
| 主进程 | Electron 31 (CommonJS output, ESM source via vite-plugin-electron) |
| 渲染进程 | React 18 + TypeScript 5 |
| 构建 | Vite 5（主进程 / preload / 渲染进程统一构建） |
| 数据库 | better-sqlite3 (SQLite) |
| 状态管理 | Zustand |
| 样式 | Tailwind CSS + Framer Motion |
| 图标 | lucide-react |
| 字体 | @fontsource/inter、@fontsource/inter-tight（本地，无 CDN） |
| 持久化 | 自研 `JsonStore`（XOR 混淆 + base64），**不使用 electron-store** |
| 打包 | electron-builder 24（NSIS） |

## 2. 分层架构

```
┌─────────────────────────────────────────────────────────┐
│  渲染进程 (src/)                                          │
│  React 组件 → useStore (Zustand) → window.focuslink.*    │
└────────────────────────────┬────────────────────────────┘
                             │ contextBridge IPC
┌────────────────────────────┴────────────────────────────┐
│  主进程 (electron/)                                       │
│  ipc.ts ──► timer/manager.ts ──► db/index.ts ──► SQLite │
│          ├─► tasks/cliProvider.ts (dida CLI)             │
│          ├─► providers/ticktickAdapter.ts (OAuth)        │
│          ├─► sync/syncService.ts (sync_queue)            │
│          ├─► hotkeys.ts (globalShortcut)                 │
│          ├─► tray.ts (Tray)                              │
│          └─► settingsStore.ts / credentials.ts (JsonStore)│
└─────────────────────────────────────────────────────────┘
```

## 3. 目录职责

### 3.1 主进程 `electron/`

| 文件 | 职责 | 可修改性 |
| --- | --- | --- |
| `main.ts` | 入口：单实例锁、主窗口 + 小窗、托盘、快捷键、电源事件、snapshot 推送 | 仅视觉构造参数 |
| `preload.ts` | contextBridge 暴露类型安全 IPC（`window.focuslink.*`） | ⛔ 禁止 |
| `ipc.ts` | IPC 处理器 + `detectChangedDomains` 按域分流副作用 | ⛔ 禁止 |
| `tray.ts` | 系统托盘（状态联动菜单） | 文案/图标可改 |
| `hotkeys.ts` | 全局快捷键：debounce + 失败检测 + 广播 | ⛔ 禁止 |
| `logger.ts` | 日志系统（按天滚动） | - |
| `credentials.ts` | OAuth token 凭证存储（JsonStore 加密） | - |
| `jsonStore.ts` | 轻量 JSON 存储（替代 electron-store） | - |
| `settingsStore.ts` | 应用设置读写 + v0.1.5 迁移 | - |
| `export.ts` | 数据导出（JSON/CSV/Markdown） | - |
| `cli.ts` | CLI 预留（本地 HTTP server） | - |
| `db/schema.ts` | 内联 SQL Schema | ⛔ 禁止 |
| `db/index.ts` | 数据访问层 | ⛔ 禁止 |
| `timer/stateMachine.ts` | 纯状态机 `transition()` | ⛔ 禁止 |
| `timer/manager.ts` | TimerManager：三时间账本 + 崩溃恢复 | ⛔ 禁止 |
| `tasks/cliProvider.ts` | dida CLI Provider + 诊断 | ⛔ 核心逻辑禁止 |
| `tasks/localProvider.ts` | 本地任务 Provider | - |
| `providers/ticktickAdapter.ts` | TickTick OAuth 适配器 | - |
| `providers/experimentalFocus.ts` | 实验性 Focus 适配器（默认关闭） | - |
| `sync/syncService.ts` | sync_queue 处理 | - |

### 3.2 渲染进程 `src/`

| 文件 | 职责 |
| --- | --- |
| `App.tsx` | 主壳 + 顶部导航 + 左右分栏 |
| `mini.tsx` | 专注小窗渲染入口 |
| `main.tsx` | 主窗口渲染入口 |
| `index.css` | 设计 tokens（`--app-*`）+ 字体 + Tailwind |
| `components/TimerPanel.tsx` | 计时区：大计时数字、idle 预选任务、控制按钮 |
| `components/TaskPanel.tsx` | 任务树（默认折叠、搜索展开、项目过滤） |
| `components/TaskPicker.tsx` | 可复用任务选择器（搜索/项目/树） |
| `components/MiniWindow.tsx` | 专注小窗（展开/紧凑/收起三模式） |
| `components/HistoryPanel.tsx` | 历史记录 + 后补关联 + 批量关联 |
| `components/SegmentTimeline.tsx` | 片段时间线 |
| `components/SettingsPanel.tsx` | 设置（外观/任务/快捷键/小窗/同步/关于） |
| `components/Toast.tsx` | Toast 通知 |
| `components/taskTreeState.ts` | 任务树折叠状态管理（搜索后恢复） |
| `store/useStore.ts` | Zustand store（UI 状态 + IPC 调用封装） |
| `lib/time.ts` | 时间格式化 |
| `lib/historyStats.ts` | 历史统计 |
| `lib/paneLayout.ts` | 左右分栏拖拽 |
| `lib/syncStatus.ts` | 同步状态 |

### 3.3 共享 `shared/`

| 文件 | 职责 |
| --- | --- |
| `types.ts` | 全部共享类型 + IPC 通道契约 + `DEFAULT_SETTINGS` |

### 3.4 测试 `tests/`

| 文件 | 覆盖 |
| --- | --- |
| `stateMachine.test.ts` | 状态机合法/非法转换 |
| `timeModel.test.ts` | 三时间模型 45+5+45 |
| `hotkeys.test.ts` | 快捷键格式校验 |
| `paneLayout.test.ts` | 分栏布局计算 |
| `historyStats.test.ts` | 历史统计 |
| `syncStatus.test.ts` | 同步状态 |

## 4. 数据流

### 4.1 计时实时刷新（核心）

```
TimerManager (主进程)
  │ 每 1s tick → 更新内存 snapshot
  │ 每 5s 持久化 activeElapsedMs 到 segment + app_meta(lastTick)
  ▼
onSnapshot listener (main.ts pushSnapshot)
  │
  ├─► mainWindow.webContents.send('tick', snap)
  └─► miniWindow.webContents.send('tick', snap)
  │
  ▼
渲染进程 useStore 订阅 'tick' → 重新渲染计时数字
```

### 4.2 状态转换

```
快捷键 / UI 按钮
  ▼
ipc.ts handler → TimerManager.toggle/pause/resume/stop
  ▼
stateMachine.transition() 校验合法性
  ▼
写库 (session/segment/pause) + emit snapshot
  ▼
pushSnapshot → 渲染进程 + 状态转换副作用（小窗自动显示/隐藏）
```

### 4.3 任务关联

```
idle 预选任务 → timer:start-with-task（原子：Session 默认任务 + 第一个 Segment 任务）
专注中换任务 → timer:link-task（改当前 Segment）
设默认任务   → timer:link-session-task
结束后补     → timer:link-task / timer:link-segments-batch（批量）
```

### 4.4 同步

```
Segment/Session 写库 → sync:enqueue-segment / enqueue-session
  ▼
sync_queue (status=pending)
  ▼
sync:run-pending → 调用 cliProvider.appendFocusRecordToTask / ticktickAdapter
  ▼
成功 → status=synced；失败 → retryCount++，最多 5 次后 status=failed
```

## 5. IPC 通道契约（不可修改）

定义于 `shared/types.ts`，由 `electron/ipc.ts` 实现、`electron/preload.ts` 暴露。

| 域 | 通道前缀 | 示例 |
| --- | --- | --- |
| Timer | `timer:*` | `timer:toggle` / `timer:start-with-task` / `timer:link-task` / `timer:link-segments-batch` |
| Tasks | `tasks:*` | `tasks:list-local` / `tasks:complete` |
| CLI | `cli:*` | `cli:diagnose` / `cli:list-tasks` / `cli:test-command` |
| TickTick | `ticktick:*` | `ticktick:login` / `ticktick:list-tasks` |
| Sessions | `sessions:*` | `sessions:list` / `sessions:export` |
| Settings | `settings:*` | `settings:set` / `settings:set-hotkey` |
| Hotkey | `hotkey:*` | `hotkey:reset-defaults` / `hotkey:test` |
| Sync | `sync:*` | `sync:enqueue-segment` / `sync:run-pending` |
| Window | `window:*` | `window:minimize-to-tray` / `window:quit` |
| Mini | `mini:*` | `mini:show` / `mini:collapse` / `mini:get-config` |

**主进程 → 渲染进程事件**：

- `tick` (TimerSnapshot)
- `timer:state-changed`
- `settings:changed` + `settings:domain-changed`
- `hotkey:registered`
- `toast:show`
- `navigate`

## 6. 设置分域（detectChangedDomains）

设置变更按域分流副作用，避免主题保存触发快捷键重注册：

| 域 | 触发条件 | 副作用 |
| --- | --- | --- |
| `theme` | theme / accentColor 变更 | 广播给所有窗口 |
| `hotkeys` | hotkeys 变更 | 重新注册快捷键 |
| `miniWindow` | miniWindow 变更 | 广播给小窗 |
| `taskProvider` | taskSource / ticktickCli 变更 | 广播 |
| `layout` | layout 变更 | 广播 |
| `general` | 计时行为/同步/系统行为等 | 计时行为更新 + 开机自启 + 托盘重建 |

## 7. 不可修改的契约（功能 AI / UI AI 必须遵守）

```
⛔ electron/timer/manager.ts        — 状态机 + 三时间账本 + 崩溃恢复
⛔ electron/timer/stateMachine.ts   — 纯状态机
⛔ electron/db/*.ts                 — SQLite schema 与访问层
⛔ electron/tasks/cliProvider.ts    — dida CLI 核心逻辑（execWithDiagnose / normalizeTasks / 模板）
⛔ electron/hotkeys.ts              — 快捷键注册逻辑
⛔ electron/ipc.ts                  — IPC handler 逻辑
⛔ electron/preload.ts              — IPC 接口契约
⛔ shared/types.ts                  — 类型契约（除非新增字段，不改现有）
```

UI AI 只能改展示层（`src/components/*.tsx`、`src/index.css`、`tailwind.config.js`、`mini.html`、`src/mini.tsx`、`electron/main.ts` 的视觉构造参数、`electron/tray.ts` 的文案/图标）。

## 8. 构建与打包

### 8.1 Vite 多入口

`vite.config.ts` 配置三个构建目标：

- 渲染主窗口：`index.html`
- 渲染小窗：`mini.html`
- 主进程：`electron/main.ts` → `dist-electron/main.js`
- preload：`electron/preload.ts` → `dist-electron/preload.js`

路径别名：`@` → `src/`，`@shared` → `shared/`。

### 8.2 electron-builder

`electron-builder.yml`：

- 输出目录：`release-v017`
- 目标：NSIS（`oneClick: false`，可选安装路径，创建快捷方式）
- `asar: true`，`better-sqlite3` 通过 `asarUnpack` 解包
- 产物：`FocusLink-0.1.7-x64.exe`（安装包）+ `win-unpacked/FocusLink.exe`（免安装）

### 8.3 原生模块

`better-sqlite3` 需要通过 `npm run rebuild`（`electron-rebuild`）重新编译以适配 Electron。`postinstall` 钩子自动执行 `electron-builder install-app-deps`。

## 9. 日志

`electron/logger.ts`：按天滚动，写入 `userData/logs/focuslink-YYYY-MM-DD.log`。

作用域：`main` / `timer` / `hotkey` / `ipc` / `cli` / `database` / `jsonStore` / `settings` / `credentials` / `sync` 等。

格式：`[ISO timestamp] [LEVEL] [scope] msg {meta}`。

## 10. 相关文档

- [产品规格](PRODUCT_SPEC.md)
- [UI 规格](UI_SPEC.md)
- [dida CLI 集成](DIDA_CLI.md)
- [测试指南](TESTING.md)
- [变更日志](CHANGELOG.md)
