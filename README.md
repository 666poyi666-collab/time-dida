# FocusLink

全局快捷键驱动的专注时间记录器 + 滴答清单任务关联器。

> 当前版本：**v0.2.10**
> 仓库：https://github.com/666poyi666-collab/time-dida

它不是普通秒表，也不是普通番茄钟，而是一个 **Focus Session + Focus Segment 时间账本系统**。

## 核心理念

一次「专注」可以包含多个时间段；每个时间段都可以独立关联任务，也可以合并到同一个任务；暂停期间要记录间隔，但不算入专注时长。

### 三时间模型

| 时间 | 含义 |
| --- | --- |
| `activeElapsedMs` | 真正专注时长（不含暂停） |
| `pauseElapsedMs` | 暂停总时长 |
| `wallElapsedMs` | 从开始到结束的自然总跨度 |

**核心场景验证**：专注 45 分钟 → 暂停 5 分钟 → 专注 45 分钟 → 结束

- 专注时长 = 90 分钟
- 暂停时长 = 5 分钟
- 总跨度 = 95 分钟

### 数据模型

- **Focus Session**：一次完整专注会话，可包含多个 Segment
- **Focus Segment**：会话中的一个时间段，关联一个任务
- **Pause Event**：暂停事件，记录间隔，不属于任何 Segment

规则：一个 Session 可有多个 Segment；一个 Segment 只有一个主任务；Segment 可覆盖 Session 默认任务；暂停不属于任何 Segment；可合并/拆分 Segment。

## 技术栈

- **Electron 31** + **React 18** + **TypeScript 5**
- **Vite 5** 构建（含 `vite-plugin-electron`）
- **better-sqlite3** 本地数据库（SQLite）
- **Zustand** 状态管理
- **Tailwind CSS** + **Framer Motion** 样式与动画
- **lucide-react** 图标
- **@fontsource/inter** / **@fontsource/inter-tight** 本地字体
- 持久化使用自研轻量 `JsonStore`（XOR 混淆 + base64），**不使用 electron-store**

## 项目分区

从 v0.2.5 起，交接资料按三块独立存放：

| 分区 | 目录 | 用途 |
| --- | --- | --- |
| 前端设计 | `frontend-design/` | UI 设计交接、视觉规范、给其他 UI AI 的详细说明 |
| 后端 | `backend/` | Electron 主进程、计时、同步、dida Provider 的后端说明 |
| 共享契约 | `shared-contract/` | 前后端共享类型、策略与行为边界说明 |

源码仍保持当前稳定路径：前端实现位于 `src/`，后端实现位于 `electron/`，共享代码位于 `shared/`。

## 快速开始

```bash
# 安装依赖（含 better-sqlite3 原生模块编译）
npm install

# 重建原生模块以适配 Electron（如需要）
npm run rebuild

# 开发模式（主窗口 + 专注小窗热更新）
npm run dev

# 类型检查 + 构建
npm run build

# 打包 Windows 安装包
npm run dist:win

# 运行测试
npm test

# 代码格式化 / 检查
npm run format
npm run format:check
```

开发服务器默认端口 `5174`，专注小窗开发地址为 `http://localhost:5174/mini.html`。

## 下载与安装

每个版本构建后会生成两类产物（位于仓库根目录的 `release-vXXX/` 文件夹，当前版本为 `release-v0210/`）：

| 类型 | 路径 | 说明 |
| --- | --- | --- |
| 安装包 | `release-v0210/FocusLink-0.2.10-x64.exe` | NSIS 安装程序，双击即可安装，无需 PowerShell |
| 免安装版 | `release-v0210/FocusLink-0.2.10-x64-portable.exe` | 单文件便携版，双击即可运行 |

安装版默认安装到 `%LOCALAPPDATA%\Programs\FocusLink\`，会创建桌面快捷方式和开始菜单项。

历史版本归档（仅保留最近三版）：

| 版本 | 安装包 |
| --- | --- |
| `0.2.8` | `release-v028/FocusLink-0.2.8-x64.exe` |
| `0.2.9` | `release-v029/FocusLink-0.2.9-x64.exe` |
| `0.2.10` | `release-v0210/FocusLink-0.2.10-x64.exe` |

## 全局快捷键

| 功能 | 默认快捷键 |
| --- | --- |
| 开始 / 暂停 / 继续 | `Ctrl + Alt + Space` |
| 结束当前专注 | `Ctrl + Alt + Enter` |
| 打开 / 隐藏主窗口 | `Ctrl + Alt + F` |
| 快速关联任务 | `Ctrl + Alt + T` |
| 显示 / 隐藏专注小窗 | `Ctrl + Alt + M` |

快捷键统一使用 `Ctrl+Alt+` 修饰键以避免系统冲突。可在设置页修改，修改后自动重新注册；注册失败（冲突）会弹出 Toast 提示，不会崩溃，并自动恢复旧快捷键。

## 滴答清单 / TickTick 集成

### 架构

采用 Adapter 架构，**稳定官方任务同步 + 实验性 Focus 适配器 + 本地记录兜底**：

- **dida CLI（推荐）**：复用本地 `dida` 命令行工具的 OAuth token，读取清单/任务，并优先把专注记录写入任务评论；评论失败时回退到任务内容
- **TickTick / Dida365 Open API**：OAuth 授权（PKCE loopback），拉取清单/任务，在任务备注中追加专注记录
- **实验性 Focus 适配器**：默认关闭，依赖非官方 V2/session API，不稳定
- **本地兜底**：所有专注记录先保存本地，同步失败进入 `sync_queue`，绝不丢数据

> 详细命令模板、诊断步骤见 [docs/DIDA_CLI.md](docs/DIDA_CLI.md)。

### 同步模式

| 模式 | 说明 |
| --- | --- |
| 稳定 · 写入任务评论 | 在滴答任务评论中追加专注记录；评论失败时回退到任务内容 |
| 实验 · 写入 Focus 记录 | 尝试写入 Focus/Pomodoro（非官方 API，不稳定） |
| 仅本地 | 不同步，只保存本地 |

### Token 安全

OAuth token 通过 `JsonStore` 加密文件保存（`focuslink-credentials.json`，XOR 混淆 + base64），**不存 localStorage**。生产环境可替换为 `keytar`（OS keychain）。

## 项目结构

```
time-dida/
├── electron/                  # 主进程
│   ├── main.ts                # 入口：单实例锁、窗口、托盘、快捷键、电源事件
│   ├── preload.ts             # contextBridge 暴露类型安全 IPC
│   ├── ipc.ts                 # IPC 处理器（按域分流副作用）
│   ├── tray.ts                # 系统托盘（状态联动）
│   ├── hotkeys.ts             # 全局快捷键（debounce + 失败检测）
│   ├── logger.ts              # 日志系统
│   ├── credentials.ts         # OAuth token 凭证存储
│   ├── jsonStore.ts           # 轻量 JSON 存储（替代 electron-store）
│   ├── settingsStore.ts       # 应用设置
│   ├── export.ts              # 数据导出（JSON/CSV/Markdown）
│   ├── cli.ts                 # CLI 预留（本地 HTTP server）
│   ├── db/                    # SQLite 数据访问层 + Schema
│   ├── timer/                 # 状态机 + TimerManager（三时间账本 + 崩溃恢复）
│   ├── tasks/                 # 本地任务 + dida CLI Provider
│   ├── providers/             # TickTick OAuth 适配器 + 实验性 Focus 适配器
│   └── sync/                  # sync_queue 处理
├── src/                       # 渲染进程 (React)
│   ├── App.tsx                # 主壳 + 导航
│   ├── mini.tsx               # 专注小窗入口
│   ├── components/            # TimerPanel / TaskPanel / MiniWindow / HistoryPanel / ...
│   ├── store/useStore.ts      # Zustand
│   └── lib/                   # time / historyStats / paneLayout / syncStatus
├── shared/types.ts            # 共享类型（主/渲染共用，IPC 契约）
├── tests/                     # Vitest 测试
├── docs/                      # 产品/架构/UI/CLI/测试/变更文档
└── electron-builder.yml       # 打包配置
```

## 关键设计

### 状态机

`idle + START -> running + PAUSE -> paused + RESUME -> running + STOP -> finished + RESET -> idle`

不允许散乱 boolean，所有转换通过 `transition()` 纯函数校验，非法转换被拒绝。

### 崩溃恢复

- 每 5 秒持久化 `activeElapsedMs` 快照到 segment + `app_meta(lastTick)`
- 程序重启后 `recover()`：
  - 若存在 active session 且有未关闭 pause → 恢复为 `paused`
  - 若重启前是 `running` → 按 `lastTick` 与当前时间重算 `activeElapsedMs`
- 系统睡眠/唤醒：`powerMonitor` 监听，唤醒后强制刷新快照

### 数据完整性

数据库触发器强制：

- `segment_ended_at` 不能早于 `segment_started_at`
- `pause_ended_at` 不能早于 `pause_started_at`
- 不允许负时间
- `ON DELETE CASCADE` 删除 session 时联动清理

### 单实例

`app.requestSingleInstanceLock()`，第二个实例启动时唤起已有窗口。

## 测试

```bash
npm test
```

覆盖：状态机所有合法/非法转换、Toggle 行为、完整专注流程（多次暂停/继续）、三时间模型核心场景（45+5+45 → 90/5/95）、多次暂停累加、时间回退保护。详见 [docs/TESTING.md](docs/TESTING.md)。

## 数据与日志位置

应用数据全部位于 Electron 的 `userData` 目录，Windows 下为 `%APPDATA%/FocusLink/`：

| 类型 | 路径 |
| --- | --- |
| 数据库 | `%APPDATA%/FocusLink/focuslink.db` |
| 设置 | `%APPDATA%/FocusLink/focuslink-settings.json` |
| 凭证 | `%APPDATA%/FocusLink/focuslink-credentials.json`（XOR 混淆） |
| 日志 | `%APPDATA%/FocusLink/logs/focuslink-YYYY-MM-DD.log` |

日志按天滚动，记录所有关键操作（timer/hotkey/ipc/cli/database/jsonStore 等作用域）。

## 常见问题

**Q: better-sqlite3 安装/启动报错？**
A: 运行 `npm run rebuild` 重新编译原生模块以适配 Electron。

**Q: 快捷键无效？**
A: 可能与其他软件冲突，查看设置页 Toast 提示；修改为其他组合键。`Ctrl+Alt+M` 在部分系统会被占用，可改用 `Ctrl+Alt+Shift+M`。

**Q: 滴答清单登录失败？**
A: 确认回调地址为 `http://localhost:18321/callback`；确认 Client ID/Secret 正确；确认区域选择正确（国内 dida365 / 海外 ticktick）。使用 dida CLI 时先在终端执行 `dida auth login` 完成登录。

**Q: 同步失败会丢数据吗？**
A: 不会。所有记录先保存本地，同步失败进入 `sync_queue`，可重试（最多 5 次后标记 failed）。

**Q: 关闭窗口后还在计时吗？**
A: 是。关闭窗口默认最小化到托盘，主进程继续计时。退出只能通过托盘菜单的「退出」。

## 文档

完整文档位于 `docs/`：

- [产品规格](docs/PRODUCT_SPEC.md)
- [架构说明](docs/ARCHITECTURE.md)
- [UI 规格](docs/UI_SPEC.md)
- [dida CLI 集成](docs/DIDA_CLI.md)
- [测试指南](docs/TESTING.md)
- [变更日志](docs/CHANGELOG.md)

历史修复报告归档于 `docs/archive/`。

## 后续扩展

- CLI 完整实现（`electron/cli.ts` 已预留本地 HTTP server）
- MCP Server（架构中预留，工具：`focuslink_get_status` / `focuslink_start_timer` 等）
- 实验性 Focus 适配器接入非官方 V2 API（需 session cookie，非账号密码）
- 统计图表（基于已有数据模型，无需重构）
- 打包 macOS/Linux

## License

MIT
