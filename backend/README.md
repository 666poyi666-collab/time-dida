# Backend Area

FocusLink 后端代码当前主要在 `electron/`。

职责：
- Electron 主进程窗口管理。
- 托盘、快捷键、开机自启。
- TimerManager 与计时状态恢复。
- SQLite 数据读写。
- dida / 滴答清单任务 Provider。
- 同步队列与任务备注写入。

UI 设计任务不要随意移动或重写这里的代码。若未来做物理目录迁移，应先完成路径迁移测试，再改构建配置。
