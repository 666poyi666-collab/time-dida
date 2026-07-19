# FocusLink

FocusLink 是一个本地优先的 Windows 桌面专注工具：主进程精确记录专注、暂停与自然跨度，把片段关联到滴答清单任务，并通过彼此独立的队列同步滴答清单与番茄 To-do。

> 当前版本：v0.12.8
>
> 版本主题：清晰字形 · 五套计时仪表 · 原生全屏沉浸 · 单目标统计分析

## 产品边界

- 专注计时与崩溃恢复。
- Session / Segment / PauseEvent 三层时间账本。
- 滴答任务关联与操作；dida CLI 优先，TickTick OAuth 后备。
- 滴答专注/评论同步与番茄 To-do 本地优先云补传。
- 主窗口、托盘、全局快捷键和固定两态小窗。

FocusLink 不是聊天应用、营销页或通用仪表盘。界面和实现规范分别以 [前端设计](FocusLink/frontend-design/README.md) 与 [后端设计](FocusLink/backend-design/README.md) 为准。

## 三时间模型

| 字段 | 含义 |
| --- | --- |
| `activeElapsedMs` | 真正专注时长，不含暂停 |
| `pauseElapsedMs` | 暂停累计 |
| `wallElapsedMs` | 会话开始到结束的自然跨度 |

例如 45 分钟专注、5 分钟暂停、45 分钟专注，结果固定为 90 分钟有效专注、5 分钟暂停、95 分钟总历时。暂停后继续会创建新 Segment，并继承会话默认任务。

## 快速开始

环境：Windows 10/11、Node.js 20.x、npm 10.x。SQLite 原生依赖按 Node 20 与 Electron ABI 构建，不要使用 Node 24 安装依赖。

```bash
cd FocusLink
npm install
npm run dev
```

常用命令：

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run dist
```

完整测试、真实外部服务和发布门禁见 [FocusLink/backend-design/TEST_AND_RELEASE.md](FocusLink/backend-design/TEST_AND_RELEASE.md)。

## 任务与同步

### 滴答清单 / dida CLI

FocusLink 的任务页固定表达“滴答清单”，不再把本地、CLI 和 OAuth 显示成并列的任务来源。CLI 与 OAuth 只是连接方式：刷新时先探测 dida CLI，不可用时才使用已登录 OAuth。CLI 按以下顺序解析：

1. 设置中的手动 executable。
2. 用户 npm 全局目录内 dida 的真实 Node 入口。
3. 当前环境 PATH。

写操作使用参数数组，不把中文、换行或 JSON 拼入 shell。专注摘要优先写任务评论，失败才回退到任务正文；每个片段使用 `[FocusLink:segment:<id>]` marker 去重。checklist 子项通过父任务 `items` 更新，不伪装成普通任务。

任务工作台首次只加载活动任务；已完成历史按需读取近 30 / 90 / 365 天并以 `completedAt` 稳定排序。完成后有 6 秒一键撤销，之后仍可在已完成列表找到并恢复；超长列表以每批最多 120 项逐步显示。

### 番茄 To-do

FocusLink 先以稳定 marker 原子写入本地 PCRecord，再通过经过身份校验的原生桥批量上传。用户手动同步时，若番茄 To-do 未运行，FocusLink 可以使用参数数组按需启动客户端并指定 `--remote-debugging-port=0`，只在标题与特征 API 都通过后连接。若客户端已以普通模式运行却没有可验证桥接，FocusLink 绝不自动杀进程或重启，界面会要求完全退出番茄 To-do 后再连接。FocusLink 启动和后台周期重试只会使用已存在的可验证桥，不会擅自启动外部应用。

只有 `cloudSyncUploadRecord` 明确返回 success 且本地同步状态持久化后才记为“上传已确认”。当前番茄 To-do 1.6.2 不提供专注记录的独立云端回读或远端删除接口，诊断会明确区分“上传已确认”和“本地 marker 已清理”，不会虚报云端回读/删除。无法识别学科的 FocusLink 记录归入“学习”，不会迁移用户的其他记录。

两个同步域互相独立。本地写入、任务关联和云端同步在界面上使用不同状态文案。

## 界面与稳定性基线

- 默认亮色为「时间仪器」单一工作面：连续浅色画布、1px 发丝线分区，无圆角卡片墙、玻璃拟态与环境动效层；暗色为同一 token 体系映射，主题仅明亮/深色/跟随系统。
- 颜色只有四种语义：界面蓝 = 操作、专注绿 = 运行（四档专注色可选）、暂停红 = 损耗（主计时暂停时以红色显示本次暂停经过）、深红 = 危险操作。
- 主计时有标准等宽、翻页机械、像素点阵、极细编辑四套仪表，设置页实时渲染预览并持久化，旧计时样式设置自动迁移；字体为本地嵌入的 Geist Variable + MiSans + JetBrains Mono，仪表字形使用 Inter Tight / Oswald，像素数字为自绘点阵。
- 时间之带是单一 canvas：刻度即进度，专注为秒级近景、暂停时 720ms 对数变焦拉远到 30 分钟大格远景、继续第一帧即变绿，逐秒 130ms 离散步进，reduced-motion 下瞬时切换。
- 统计页先给自然语言结论（计入进行中会话并标注），再展开 24 小时时间织带、日期×时段节律矩阵、单次质量珠链与时间去向马赛克；详情请求有 request id 保护，不会因计时 tick 每秒重渲染整页。
- 沉浸模式全屏呈现当前任务、四套仪表之一、累计三项、全部控制与放大约 1/4 屏高的时间之带，Esc 退出。
- renderer 无响应时在有界预算内受控重载，主进程计时不中断；日志保留 Error 的 name/message/stack/cause，托盘与 snapshot 监听只初始化一次。
- 小窗尺寸保持收起 `184×35`、展开 `320×116`；展开态完整显示任务名（无省略号/渐隐）、当前时间、累计专注/暂停/总历时与全部控制，时间与按钮分行不重叠，收起态底部显示 3px 真实专注占比进度轨。拖拽释放后先吸附，再播放 320ms 收束过渡后折叠，过渡期间重新拖动会取消折叠。

## 项目结构

```text
time1/
├── FocusLink/              # 唯一源码工作区
│   ├── src/                # renderer：app / features / ui / styles
│   ├── electron/           # 主进程、SQLite、计时、Provider、同步和系统能力
│   ├── shared/             # 跨进程类型、IPC API、尺寸常量和纯策略
│   ├── tests/              # 自动化回归
│   ├── scripts/            # build / regression / smoke
│   ├── frontend-design/    # 唯一前端设计与交接规范
│   └── backend-design/     # 唯一后端、测试与发布规范
├── .github/                # Issue 表单、Release 模板与自动发布 workflow
├── release-v*/             # 最近三个版本的正式资产与 Release notes
├── AGENTS.md               # AI 必须遵守的仓库规则
└── CHANGELOG.md            # 全版本变化历史
```

不要重新创建 `docs/`、`backend/`、`shared-contract/`、设计归档或一次性修复报告。可再生成的 `dist/`、`dist-electron/`、`dist-selftest/`、`test-data/` 和结果 JSON 不属于项目结构。

## 架构摘要

```text
React renderer
  -> window.focuslink
  -> context-isolated preload
  -> validated IPC
  -> timer / task / sync services
  -> SQLite / dida / TickTick / 番茄 To-do / Windows
```

- renderer 不直接访问 Node、数据库、文件系统或 shell。
- Electron 主进程持有计时、窗口和外部副作用事实。
- `FocusLink/shared/ipc/api.ts` 是 renderer API 的唯一类型真值。
- dida 队列与番茄补传先保证本地持久化，再异步收敛云端。

## 数据与日志

| 类型 | 默认位置 |
| --- | --- |
| 安装版 SQLite | `%APPDATA%/FocusLink/focuslink.db` |
| 安装版设置 | `%APPDATA%/FocusLink/settings.json` |
| 日志 | `%APPDATA%/FocusLink/logs/` |
| 便携版数据 | 可执行文件同目录的 `focuslink-data/` |

回归和自测必须使用隔离目录，不得读取或修改真实用户数据。凭据不写入日志或导出。

## 发布资产

每个 `release-vXYZ/` 只保留四类文件：

```text
FocusLink-x.y.z-x64.exe
FocusLink-x.y.z-x64-portable.exe
SHA256SUMS.txt
RELEASE_NOTES.md
```

当前本地保留的版本资产（线上状态以 GitHub Releases 为准）：

| 版本 | 本地安装版 | 版本说明 |
| --- | --- | --- |
| 0.12.6 | `release-v0126/FocusLink-0.12.6-x64.exe` | [v0.12.6](release-v0126/RELEASE_NOTES.md) |
| 0.12.7 | `release-v0127/FocusLink-0.12.7-x64.exe` | [v0.12.7](release-v0127/RELEASE_NOTES.md) |
| 0.12.8 | `release-v0128/FocusLink-0.12.8-x64.exe`（待构建） | [v0.12.8](release-v0128/RELEASE_NOTES.md) |

每次版本迭代必须同步更新 `CHANGELOG.md`、本地 `RELEASE_NOTES.md` 和 GitHub Release，并上传安装版、便携版与 SHA256。只推送代码或 tag 不算发布完成。

v0.12.8 的本地发布状态以同目录 `RELEASE_NOTES.md` 为准，线上状态以 GitHub Releases 回读结果为准。每个新版本都必须由 tag workflow 复验已提交产物，并回读正文、目标提交、附件名称、字节数、下载链接与下载后 SHA256；不能移动失败的旧 tag，也不能补造未完成门禁的历史 Release。

## 文档入口

- [前端设计索引](FocusLink/frontend-design/README.md)
- [前端单一真相](FocusLink/frontend-design/FRONTEND_SPEC.md)
- [前端 AI 接手清单](FocusLink/frontend-design/AI_HANDOFF_CHECKLIST.md)
- [后端设计索引](FocusLink/backend-design/README.md)
- [后端与共享契约](FocusLink/backend-design/BACKEND_SPEC.md)
- [测试与发布门禁](FocusLink/backend-design/TEST_AND_RELEASE.md)
- [后端 AI 接手清单](FocusLink/backend-design/AI_HANDOFF_CHECKLIST.md)
- [当前版本 v0.12.8 Release 正文](release-v0128/RELEASE_NOTES.md)
- [v0.11.2 离线发布记录](FocusLink/backend-design/releases/v0.11.2.md)
- [v0.11.1 离线发布记录](FocusLink/backend-design/releases/v0.11.1.md)
- [v0.11.0 离线发布记录](FocusLink/backend-design/releases/v0.11.0.md)
- [版本历史](CHANGELOG.md)

## License

[MIT](LICENSE)
