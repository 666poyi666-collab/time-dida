# FocusLink 产品规格 (PRODUCT_SPEC)

> 版本：v0.1.7
> 状态：维护期（不再新增功能，准备交接给 UI AI / 功能 AI）

## 1. 产品定位

FocusLink 是一个**全局快捷键驱动的专注时间记录器 + 滴答清单任务关联器**。

它不是普通秒表，也不是普通番茄钟，而是一个 **Focus Session + Focus Segment 时间账本系统**：一次专注可以包含多个时间段，每个时间段独立关联任务，暂停期间记录间隔但不算入专注时长。

核心交互入口**不是主界面**，而是：

```
快捷键 → 专注小窗 → 托盘菜单 → 任务关联 → 历史记录
```

主界面是**管理面板**，用于配置、查看历史、关联任务。优秀的体验应让用户大部分时间不需要打开主界面，靠小窗 + 快捷键 + 托盘就能完成日常专注流程。

## 2. 三时间模型

| 字段 | 含义 |
| --- | --- |
| `activeElapsedMs` | 真正专注时长（不含暂停） |
| `pauseElapsedMs` | 暂停总时长 |
| `wallElapsedMs` | 从开始到结束的自然总跨度 |

**核心场景**：专注 45 分钟 → 暂停 5 分钟 → 专注 45 分钟 → 结束

- 专注时长 = 90 分钟
- 暂停时长 = 5 分钟
- 总跨度 = 95 分钟

## 3. 数据模型

| 实体 | 说明 |
| --- | --- |
| **FocusSession** | 一次完整专注会话，可包含多个 Segment；可设置 `defaultTaskId` 默认任务 |
| **FocusSegment** | 会话中的一个时间段，关联一个任务；暂停后继续会新建 Segment 并继承 Session 默认任务 |
| **PauseEvent** | 暂停事件，记录间隔，不属于任何 Segment |
| **TaskCache** | 任务缓存（本地 + 滴答清单），用于离线展示 |
| **SyncQueueItem** | 同步队列项，专注记录异步写入滴答清单 |

**规则**：

- 一个 Session 可有多个 Segment
- 一个 Segment 只有一个主任务
- Segment 可覆盖 Session 默认任务
- 暂停不属于任何 Segment
- 可合并/拆分 Segment
- Session 默认任务会被新建 Segment 继承（恢复专注后）

## 4. 核心功能清单（v0.1.7，共 20 项，不可破坏）

| # | 功能 | 入口 |
| --- | --- | --- |
| 1 | 双击启动（NSIS 安装包，无需 PowerShell） | 安装包 / 免安装 exe |
| 2 | 全局快捷键开始/暂停/继续/结束/显示窗口/关联任务/切换小窗 | 系统全局 |
| 3 | 托盘菜单控制（开始/暂停/结束/主窗口/小窗 5 项控制/退出） | 系统托盘 |
| 4 | 专注小窗（可调大小、可手动收起/展开、跟随主题） | 小窗 |
| 5 | 计时器实时跳动（每秒刷新，主进程推送 `tick` 事件） | 主窗口 + 小窗 |
| 6 | SQLite 本地记录（Session/Segment/Pause） | 后台 |
| 7 | 历史记录重启后保留 | 历史页 |
| 8 | dida CLI 任务读取（`dida task filter --json`） | 任务区 |
| 9 | 任务树展示（父任务 + 子任务递归） | 任务区 |
| 10 | 默认隐藏已完成任务 + 显示开关 | 任务区 |
| 11 | 所有任务树/TaskPicker 默认折叠父任务 | 任务区/选择器 |
| 12 | Segment 关联到 dida 任务 | 时间线/任务区 |
| 13 | Session 默认任务设置 | 任务区 |
| 14 | idle 状态预选任务 + `start-with-task` 原子启动 | 计时区 |
| 15 | 暂停后继续新建 Segment 并继承 Session 默认任务 | 计时区 |
| 16 | 历史记录后补关联 + 批量关联 | 历史页 |
| 17 | CLI 诊断面板（探测/版本/登录/项目/任务/搜索 6 步） | 设置页 |
| 18 | 主题色切换（indigo/violet/emerald/rose/amber/sky） | 设置页 |
| 19 | 主界面左右分栏可拖拽 | 主窗口 |
| 20 | 崩溃恢复（断电/异常退出后按 `lastTick` 重算） | 后台 |

## 5. 快捷键

| 功能 | 默认快捷键 |
| --- | --- |
| 开始 / 暂停 / 继续 | `Ctrl + Alt + Space` |
| 结束当前专注 | `Ctrl + Alt + Enter` |
| 打开 / 隐藏主窗口 | `Ctrl + Alt + F` |
| 快速关联任务 | `Ctrl + Alt + T` |
| 显示 / 隐藏专注小窗 | `Ctrl + Alt + M` |

- 统一使用 `Ctrl+Alt+` 修饰键以避免系统冲突
- 200ms debounce 防连按
- 注册失败（冲突）弹 Toast，不崩溃，自动恢复旧快捷键
- 设置页可修改、测试、恢复默认

## 6. 任务来源（三种）

| 来源 | `taskSource` 值 | 说明 |
| --- | --- | --- |
| 本地任务 | `local` | FocusLink 内置任务，存 `tasks_cache` |
| dida CLI | `ticktick-cli` | 复用本地 `dida` 命令行工具的 OAuth token |
| TickTick OAuth | `ticktick-oauth` | TickTick / Dida365 Open API（PKCE loopback） |

## 7. 同步模式

| 模式 | 说明 |
| --- | --- |
| 稳定 · 写入任务备注 | 在滴答任务备注中追加专注记录（默认） |
| 实验 · 写入 Focus 记录 | 尝试写入 Focus/Pomodoro（非官方 API，不稳定，默认关闭） |
| 仅本地 | 不同步，只保存本地 |

**数据安全**：所有专注记录先保存本地，同步失败进入 `sync_queue`，可重试（最多 5 次后标记 `failed`），绝不丢数据。

## 8. 状态机

```
idle + START -> running + PAUSE -> paused + RESUME -> running + STOP -> finished + RESET -> idle
```

- 不允许散乱 boolean，所有转换通过 `transition()` 纯函数校验
- 非法转换被拒绝
- `toggle` 行为：idle→START、running→PAUSE、paused→RESUME

## 9. 崩溃恢复

- 每 5 秒持久化 `activeElapsedMs` 快照到 segment + `app_meta(lastTick)`
- 重启后 `recover()`：
  - 存在 active session 且有未关闭 pause → 恢复为 `paused`
  - 重启前是 `running` → 按 `lastTick` 与当前时间重算 `activeElapsedMs`
- `powerMonitor` 监听系统睡眠/唤醒，唤醒后强制刷新快照

## 10. 数据完整性约束（SQLite 触发器）

- `segment_ended_at` 不能早于 `segment_started_at`
- `pause_ended_at` 不能早于 `pause_started_at`
- 不允许负时间（`active_elapsed_ms` / `pause_elapsed_ms` / `wall_elapsed_ms`）
- `ON DELETE CASCADE`：删除 session 时联动清理 segment / pause

## 11. 单实例与退出

- `app.requestSingleInstanceLock()`：第二个实例启动时唤起已有窗口
- 关闭主窗口默认最小化到托盘（`closeToTray`），主进程继续计时
- **退出只能通过托盘菜单的「退出」**（`isQuitting` 标记）

## 12. 数据与日志位置

Windows 下 `userData` = `%APPDATA%/FocusLink/`：

| 类型 | 路径 |
| --- | --- |
| 数据库 | `%APPDATA%/FocusLink/focuslink.db` |
| 设置 | `%APPDATA%/FocusLink/focuslink-settings.json` |
| 凭证 | `%APPDATA%/FocusLink/focuslink-credentials.json`（XOR 混淆） |
| 日志 | `%APPDATA%/FocusLink/logs/focuslink-YYYY-MM-DD.log` |

## 13. 后续扩展（未实现，架构已预留）

- CLI 完整实现（`electron/cli.ts` 已预留本地 HTTP server）
- MCP Server（工具：`focuslink_get_status` / `focuslink_start_timer` 等）
- 实验性 Focus 适配器接入非官方 V2 API
- 统计图表（基于已有数据模型，无需重构）
- 打包 macOS/Linux

## 14. 相关文档

- [架构说明](ARCHITECTURE.md)
- [UI 规格](UI_SPEC.md)
- [dida CLI 集成](DIDA_CLI.md)
- [测试指南](TESTING.md)
- [变更日志](CHANGELOG.md)
