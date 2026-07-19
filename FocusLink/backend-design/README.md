# FocusLink 后端设计索引

> 适用版本：v0.12.x
>
> 文档责任：Electron 主进程、SQLite、IPC、任务 Provider、同步、测试与发布。

这个目录是后端设计与维护的唯一规范入口。`electron/` 和 `shared/` 是运行时事实，本文档负责解释不变量与验收边界；不再维护 `docs/`、`backend/` 或 `shared-contract/` 的平行文稿。

## 阅读顺序

1. [BACKEND_SPEC.md](BACKEND_SPEC.md)：架构、数据、IPC、计时、任务和双同步的单一真相。
2. [TEST_AND_RELEASE.md](TEST_AND_RELEASE.md)：自动化、真实服务、打包、校验和 GitHub Release 门禁。
3. [AI_HANDOFF_CHECKLIST.md](AI_HANDOFF_CHECKLIST.md)：新 AI 或维护者的接手/交付清单。
4. [v0.12.13 发布正文](../../release-v01213/RELEASE_NOTES.md)：完成发布后必须与本地发布目录和 GitHub Release 一致；历史 Release 正文源见 releases/ 目录。
5. [releases/v0.11.2.md](releases/v0.11.2.md)：被发布记录路径契约阻断后的离线发布记录；公开 tag 不移动，未创建 GitHub Release。
6. [releases/v0.11.1.md](releases/v0.11.1.md)：更早的离线发布记录。
7. [../frontend-design/FRONTEND_SPEC.md](../frontend-design/FRONTEND_SPEC.md)：用户可见行为、主题、动效与小窗表现。

## 源码责任

| 路径 | 责任 |
| --- | --- |
| `electron/main.ts` | 生命周期、窗口、renderer 受控恢复、托盘、开机启动和后台任务 |
| `electron/ipc.ts` / `preload.ts` | IPC 实现与 context-isolated API |
| `electron/timer/` | 状态机、三时间账本、持久化与恢复 |
| `electron/db/` | SQLite schema、迁移、查询和事务 |
| `electron/tasks/` | 滴答工作台、本地兼容任务与 dida CLI Provider |
| `electron/integrations/` | TickTick OAuth 与番茄 To-do 适配 |
| `electron/sync/` | dida 队列与番茄持久补传 |
| `shared/` | 跨进程类型、IPC API 和纯策略 |
| `tests/` | 快速、隔离、可重复的回归测试 |
| `scripts/` | 构建、回归和真实 smoke |

## 文档维护规则

- 稳定规则只写一处；前端文稿描述体验，后端文稿描述事实和副作用。
- 一次性调试报告、命令输出、截图和生成 JSON 不进入仓库。
- 新增 IPC、数据字段、Provider 能力或同步状态时，同一变更必须更新后端规范、类型、测试和 Release 正文源。
- 每个发布目录只保留安装版、便携版、`SHA256SUMS.txt` 与 `RELEASE_NOTES.md`。
