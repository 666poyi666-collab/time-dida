# FocusLink

全局快捷键驱动的专注时间记录器 + 滴答清单任务关联器。

> 它不是普通秒表，也不是普通番茄钟，而是一个 **Focus Session + Focus Segment 时间账本系统**。

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

Electron · React · TypeScript · Vite · SQLite (better-sqlite3) · Zustand · Tailwind CSS · Framer Motion · electron-store

## 快速开始

### 本机从哪里启动

- 开发调试：在 `C:\Users\poyi\Desktop\time1` 执行 `npm run dev`
- 当前新版安装包：`C:\Users\poyi\Desktop\time1\release-v017\FocusLink-0.1.7-x64.exe`
- 当前新版免安装启动：`C:\Users\poyi\Desktop\time1\release-v017\win-unpacked\FocusLink.exe`

```bash
# 安装依赖（含 better-sqlite3 原生模块编译）
npm install

# 重建原生模块以适配 Electron（如需要）
npm run rebuild

# 开发模式
npm run dev

# 类型检查 + 构建
npm run build

# 打包 Windows 安装包
npm run dist
# 或仅 Windows
npm run dist:win

# 运行测试
npm test
```

## Release 版本

仓库里的 `releases/` 目录保存安装包归档；本地 electron-builder 输出目录保留为 `release-v0xx`。

| 版本 | 安装包 |
| --- | --- |
| `0.1.0` | `releases/v0.1.0/FocusLink-0.1.0-x64.exe` |
| `0.1.1` | `releases/v0.1.1/FocusLink-0.1.1-x64.exe` |
| `0.1.2` | `releases/v0.1.2/FocusLink-0.1.2-x64.exe` |
| `0.1.3` | `releases/v0.1.3/FocusLink-0.1.3-x64.exe` |
| `0.1.4` | `releases/v0.1.4/FocusLink-0.1.4-x64.exe` |
| `0.1.5` | `releases/v0.1.5/FocusLink-0.1.5-x64.exe` |
| `0.1.6` | `releases/v0.1.6/FocusLink-0.1.6-x64.exe` |
| `0.1.7` | `releases/v0.1.7/FocusLink-0.1.7-x64.exe` |

## 全局快捷键

| 功能 | 默认快捷键 |
| --- | --- |
| 开始 / 暂停 / 继续 | `Ctrl + Alt + Space` |
| 结束当前专注 | `Ctrl + Alt + Enter` |
| 打开 / 隐藏主窗口 | `Ctrl + Alt + F` |
| 快速关联任务 | `Ctrl + Alt + T` |

快捷键可在设置页修改，修改后自动重新注册；注册失败（冲突）会弹出 Toast 提示，不会崩溃。

## 滴答清单 / TickTick 集成

### 架构

采用 Adapter 架构，**稳定官方任务同步 + 实验性 Focus 适配器 + 本地记录兜底**：

- **稳定通道**：TickTick / Dida365 Open API（`tasks:read` / `tasks:write` scope）
  - OAuth 授权（PKCE loopback）
  - 拉取清单/任务
  - **在任务备注/描述中追加专注记录**（默认同步模式）
- **实验性 Focus 适配器**：默认关闭，依赖非官方 V2/session API，不稳定
- **本地兜底**：所有专注记录先保存本地，同步失败进入 `sync_queue`，绝不丢数据

### 配置步骤

1. 前往 [TickTick 开发者平台](https://developer.ticktick.com/)（国内为 [滴答清单开放平台](https://developer.dida365.com/)）创建应用
2. 获取 `Client ID` 和 `Client Secret`
3. 将回调地址配置为：`http://localhost:18321/callback`
4. 在 FocusLink 设置页填写 Client ID / Secret，选择区域（国内/海外），点击「连接滴答清单」
5. 浏览器会打开授权页，授权后自动回到应用

### 同步模式

| 模式 | 说明 |
| --- | --- |
| 稳定 · 写入任务备注 | 在滴答任务备注中追加专注记录（默认） |
| 实验 · 写入 Focus 记录 | 尝试写入 Focus/Pomodoro（非官方 API，不稳定） |
| 仅本地 | 不同步，只保存本地 |

> 注意：官方 Open API 主要提供 `tasks:read` / `tasks:write`，Focus/Pomodoro 写入能力依赖非官方 V2/session API，不能当成稳定官方接口来依赖。

### Token 安全

OAuth token 通过 `electron-store` 加密文件保存（`focuslink-credentials`），**不存 localStorage**。生产环境可替换为 `keytar`（OS keychain）。

## 项目结构

```
time1/
├── electron/                  # 主进程
│   ├── main.ts                 # 入口：单实例锁、窗口、托盘、快捷键、电源事件
│   ├── preload.ts              # contextBridge 暴露类型安全 IPC
│   ├── ipc.ts                  # IPC 处理器
│   ├── tray.ts                 # 系统托盘（状态联动）
│   ├── hotkeys.ts              # 全局快捷键
│   ├── logger.ts               # 日志系统
│   ├── credentials.ts          # OAuth token 凭证存储
│   ├── settingsStore.ts        # 应用设置
│   ├── export.ts               # 数据导出（JSON/CSV/Markdown）
│   ├── cli.ts                  # CLI 预留（本地 HTTP server）
│   ├── db/
│   │   ├── schema.ts           # 内联 Schema
│   │   └── index.ts            # 数据库访问层
│   ├── timer/
│   │   ├── stateMachine.ts     # 纯状态机
│   │   └── manager.ts          # TimerManager（三时间账本 + 崩溃恢复）
│   ├── tasks/
│   │   └── localProvider.ts    # 本地任务
│   ├── providers/
│   │   ├── ticktickAdapter.ts  # TickTick 官方适配器
│   │   └── experimentalFocus.ts # 实验性 Focus 适配器（默认关闭）
│   └── sync/
│       └── syncService.ts      # sync_queue 处理
├── src/                        # 渲染进程 (React)
│   ├── App.tsx                 # 主壳 + 导航
│   ├── components/
│   │   ├── TimerPanel.tsx      # 左侧计时区
│   │   ├── TaskPanel.tsx       # 右侧任务区
│   │   ├── SegmentTimeline.tsx # 片段时间线
│   │   ├── HistoryPanel.tsx    # 历史记录
│   │   ├── SettingsPanel.tsx   # 设置
│   │   └── Toast.tsx
│   ├── store/useStore.ts       # Zustand
│   └── lib/time.ts             # 时间格式化
├── shared/types.ts             # 共享类型（主/渲染共用）
├── tests/                      # Vitest 测试
│   ├── stateMachine.test.ts    # 状态机测试
│   └── timeModel.test.ts       # 三时间模型测试
└── electron-builder.yml
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

覆盖：
- 状态机所有合法/非法转换
- Toggle 行为
- 完整专注流程（多次暂停/继续）
- **三时间模型核心场景**（45+5+45 → 90/5/95）
- 多次暂停累加
- 时间回退保护（不出现负时间）

## 常见问题

**Q: better-sqlite3 安装/启动报错？**
A: 运行 `npm run rebuild` 重新编译原生模块以适配 Electron。

**Q: 快捷键无效？**
A: 可能与其他软件冲突，查看设置页 Toast 提示；修改为其他组合键。

**Q: 滴答清单登录失败？**
A: 确认回调地址为 `http://localhost:18321/callback`；确认 Client ID/Secret 正确；确认区域选择正确（国内 dida365 / 海外 ticktick）。

**Q: 同步失败会丢数据吗？**
A: 不会。所有记录先保存本地，同步失败进入 `sync_queue`，可重试（最多 5 次后标记 failed）。

**Q: 关闭窗口后还在计时吗？**
A: 是。关闭窗口默认最小化到托盘，主进程继续计时。

## 后续扩展

- CLI 完整实现（`electron/cli.ts` 已预留本地 HTTP server）
- MCP Server（架构中预留，工具：`focuslink_get_status` / `focuslink_start_timer` 等）
- 实验性 Focus 适配器接入非官方 V2 API（需 session cookie，非账号密码）
- 统计图表（基于已有数据模型，无需重构）
- 打包 macOS/Linux

## 数据位置

- 数据库：`%APPDATA%/FocusLink/focuslink.db`
- 设置：`%APPDATA%/FocusLink/focuslink-settings.json`
- 凭证：`%APPDATA%/FocusLink/focuslink-credentials.json`（加密）
- 日志：`%APPDATA%/FocusLink/logs/focuslink-YYYY-MM-DD.log`
