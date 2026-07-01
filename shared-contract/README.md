# Shared Contract Area

FocusLink 前后端共享契约当前主要在 `shared/`。

职责：
- `types.ts`：Session、Segment、PauseEvent、Settings、IPC 类型。
- `version.ts` / `version.generated.ts`：版本与构建信息。
- `miniWindowLayout.ts`：小窗尺寸与展开/缩小策略。
- `autoSyncPolicy.ts`：完成专注后的自动同步判断。
- `startupPolicy.ts`：开机自启隐藏到托盘策略。

这里的代码应保持小而稳定，用于把关键行为从 UI 和主进程中抽出来做回归测试。
