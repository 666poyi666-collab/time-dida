# Backend Area

> 当前版本：v0.2.28

FocusLink 后端代码当前主要在 `electron/`。

职责：
- Electron 主进程窗口管理。
- 托盘、快捷键、开机自启。
- TimerManager 与计时状态恢复。
- SQLite 数据读写。
- dida / 滴答清单任务 Provider。
- 同步队列与任务备注写入。

关键同步规则：
- dida CLI 同步优先写任务评论，评论失败才回退到任务内容。
- 每条记录必须包含 `[FocusLink:segment:<id>]` marker。
- 写入前要读取已有评论/内容并跳过重复 marker。
- 任务不存在、CLI 返回 `undefined`、缺少清单 ID 都必须视为失败，不能把队列标记为已同步。
- 完成 checklist 子项时更新父任务 `items` 数组，把目标子项 status 设为 `2`。

UI 设计任务不要随意移动或重写这里的代码。若未来做物理目录迁移，应先完成路径迁移测试，再改构建配置。
