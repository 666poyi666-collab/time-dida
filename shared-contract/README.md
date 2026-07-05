# Shared Contract Area

> 当前版本：v0.2.29

FocusLink 前后端共享契约当前主要在 `shared/`。

职责：
- `types.ts`：Session、Segment、PauseEvent、Settings、IPC 类型。
- `version.ts` / `version.generated.ts`：版本与构建信息。
- `miniWindowLayout.ts`：小窗尺寸与展开/缩小策略。
- `autoSyncPolicy.ts`：完成专注后的自动同步判断。
- `startupPolicy.ts`：开机自启隐藏到托盘策略。

状态文案契约：
- `已关联 / 未关联` 只表示本地任务关联。
- `已同步 / 未同步 / 同步失败` 只表示同步到滴答清单的状态。
- 不使用“可同步”这类无法判断成功与否的词。
- 如果 session 有已关联片段但没有默认任务，折叠历史行不能显示“未关联”。

这里的代码应保持小而稳定，用于把关键行为从 UI 和主进程中抽出来做回归测试。
