# FocusLink

FocusLink 是一个本地优先的 Windows 桌面专注工具：主进程精确记录专注、暂停与自然跨度，把片段关联到滴答清单任务，并通过彼此独立的队列同步滴答清单与番茄 To-do。

> 当前版本：v0.12.16
>
> 版本主题：翻页状态机 · 六套艺术字体 · 可读统计 Dashboard · 消蚀时间之带 · 256×70 小窗

## 产品边界

- 专注计时与崩溃恢复。
- Session / Segment / PauseEvent 三层时间账本。
- 滴答任务关联与操作；dida CLI 优先，TickTick OAuth 后备。
- 滴答专注/评论同步与番茄 To-do 本地优先云补传。
- 实验性的 FocusLink 跨设备账本同步，以及共用一套界面的 Web/PWA/Android 实时专注控制台。
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

多端纵向切片的开发命令：

```bash
npm run dev:cloud   # 需先设置 FOCUSLINK_CLOUD_TEST_TOKEN
npm run dev:web
npm run build:web
npm run build:cloud
npm run android:sync
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

只有 `cloudSyncUploadRecord` 明确返回 success 且本地同步状态持久化后才记为“上传已确认”。已有 marker 的学科修改若暂时无法写入番茄桥，会进入持久补传队列，旧学科的 `isSynced=1` 不会冒充新学科已上传。当前番茄 To-do 1.6.2 不提供专注记录的独立云端回读或远端删除接口，诊断会明确区分“上传已确认”和“本地 marker 已清理”，不会虚报云端回读/删除。无法识别学科的 FocusLink 记录归入“学习”，不会迁移用户的其他记录。

### FocusLink 跨设备同步（测试阶段）

桌面端可把已结束的 Session / Segment / PauseEvent 原子账本上传到独立测试服务，Web/PWA 与
Capacitor Android 使用同一界面按服务端 cursor 增量拉取，并在 IndexedDB 保留离线缓存。
同一测试账号还拥有唯一活动会话：Web/Android 可开始、暂停、继续和结束，服务端 revision、幂等
command id 与有界长轮询负责多设备收敛；断线时只按最后确认状态本机推算并锁定控制。结束命令会
原子闭合完整账本，不会生成重复 Session。

Android 壳只提供可见前台通知、暂停/继续/结束动作、快捷设置 Tile 与至少一次原生命令队列；业务
状态机仍在共享协议和 Web 层，陈旧 session/revision 动作不会作用于下一轮。移动端不直接执行 dida
或番茄 To-do 投递，也没有接管 Electron 桌面计时；结束账本同步回桌面后，第三方投递仍需在桌面端
真实操作并确认。

`FocusLink/cloud/` 目前是 loopback-first 测试后端，不具备生产账号、备份、监控或多实例能力；
启动必须显式设置测试 token，禁止公开部署。当前多端控制通过回环测试服务验证，不等于公共云已
上线，也不能替代桌面端的本地账本、任务关联和第三方同步能力。

三个同步域互相独立。本地任务关联、FocusLink 多端账本、滴答投递和番茄上传在界面上使用不同状态文案。

## 界面与稳定性基线

- 默认亮色为「时间仪器」单一工作面：连续浅色画布、1px 发丝线分区，无圆角卡片墙、玻璃拟态与环境动效层；暗色为同一 token 体系映射，主题仅明亮/深色/跟随系统。
- 五种强调色会同时驱动导航、按钮、任务选中态、统计图、专注读数与时间之带；暂停红和危险深红保持独立，不再出现跨页面蓝绿割裂。
- 界面提供 Noto Sans SC、霞鹜文楷、霞鹜新致宋、霞鹜漫黑、霞鹜新晰黑与得意黑六套本地字体；选择态、导航与仪表统一跟随全局强调色。
- 翻页机械从零改为 `steady → fold → unfold → commit` 状态机，动画中只保留最新目标，idle/finished 与 reduced-motion 静态提交；像素点阵升级为高对比 7×9 整数网格，标准仪表改成固定数字槽工业读数。
- 时间之带是单一 canvas：专注秒级近景、暂停远景都按秒更新，状态转换使用 720ms 变焦；暂停边界以红色方形碎片表达节律被消耗，idle/finished 在最后记录锚点冻结并停止持续重绘。
- 统计页重构为顺读日报：结论与四项 KPI、带全天定位的活跃时段双车道、多日专注/暂停堆叠日柱、百分比守恒的任务构成带和暂停损耗；最近会话只保留下方唯一账本。
- 沉浸模式以原生全屏呈现当前任务、仪表、累计三项、控制与占屏 36% 的时间之带，进入使用 520ms 收束展开过渡，Esc 退出。
- renderer 无响应时在有界预算内受控重载，主进程计时不中断；日志保留 Error 的 name/message/stack/cause，托盘与 snapshot 监听只初始化一次。
- 小窗尺寸保持收起 `184×35`、展开 `256×70`；展开态以主时间/60 格秒轨和三项累计/控制组成紧密双区，完整任务与窗口操作保留在上栏。暂停粒子从真实秒轨前沿侵蚀；长任务名在字体切换后重新测量。拖拽释放后先吸附，再播放 320ms 收束过渡后折叠。

## 项目结构

```text
time1/
├── FocusLink/              # 唯一源码工作区
│   ├── src/                # renderer：app / features / ui / styles
│   ├── electron/           # 主进程、SQLite、计时、Provider、同步和系统能力
│   ├── shared/             # 跨进程类型、IPC API、尺寸常量和纯策略
│   ├── cloud/              # FocusLink 跨设备同步测试后端
│   ├── mobile/             # PWA 入口、manifest、service worker 与静态图标
│   ├── android/            # Capacitor Android 壳，不复制 TypeScript 业务逻辑
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
- `FocusLink/shared/sync/deviceProtocol.ts` 是 Web/Android/桌面跨设备传输契约；它与 Electron IPC、dida 队列分开。

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
| 0.12.13 | `release-v01213/FocusLink-0.12.13-x64.exe`（正式发布） | [v0.12.13](release-v01213/RELEASE_NOTES.md) |
| 0.12.14 | `release-v01214/FocusLink-0.12.14-x64.exe`（时间仪器版） | [v0.12.14](FocusLink/backend-design/releases/v0.12.14.md) |
| 0.12.15 | `release-v01215/FocusLink-0.12.15-x64.exe`（多端候选，版本身份冲突） | [v0.12.15](release-v01215/RELEASE_NOTES.md) |
| 0.12.16 | `release-v01216/FocusLink-0.12.16-x64.exe`（本版） | [v0.12.16](release-v01216/RELEASE_NOTES.md) |

每次版本迭代必须同步更新 `CHANGELOG.md`、本地 `RELEASE_NOTES.md` 和 GitHub Release，并上传安装版、便携版与 SHA256。只推送代码或 tag 不算发布完成。

v0.12.11 因校验表格式被阻断；v0.12.12 的源码、回归和便携版门禁已通过，但 GitHub Windows runner 上 NSIS 连续两次出现已知的瞬时访问冲突。公开 tag 均保持不移动，v0.12.13 保留真实安装验收并增加有界重试与递增退避。线上状态以 GitHub Releases 回读结果为准。

## 文档入口

- [前端设计索引](FocusLink/frontend-design/README.md)
- [前端单一真相](FocusLink/frontend-design/FRONTEND_SPEC.md)
- [前端 AI 接手清单](FocusLink/frontend-design/AI_HANDOFF_CHECKLIST.md)
- [后端设计索引](FocusLink/backend-design/README.md)
- [后端与共享契约](FocusLink/backend-design/BACKEND_SPEC.md)
- [测试与发布门禁](FocusLink/backend-design/TEST_AND_RELEASE.md)
- [后端 AI 接手清单](FocusLink/backend-design/AI_HANDOFF_CHECKLIST.md)
- [当前版本 v0.12.16 Release 正文](release-v01216/RELEASE_NOTES.md)
- [v0.11.2 离线发布记录](FocusLink/backend-design/releases/v0.11.2.md)
- [v0.11.1 离线发布记录](FocusLink/backend-design/releases/v0.11.1.md)
- [v0.11.0 离线发布记录](FocusLink/backend-design/releases/v0.11.0.md)
- [版本历史](CHANGELOG.md)

## License

[MIT](LICENSE)
