# FocusLink 前端设计索引

> 适用版本：v0.11.x 设计基线（当前实现 v0.11.1）
>
> 文档责任：只描述产品体验、renderer 结构和可验收的视觉/交互规则。

这个目录是 FocusLink 前端设计的唯一规范入口。旧截图、一次性改版报告和已经废弃的视觉概念不具有约束力；发现实现与文档冲突时，先核对当前测试与运行行为，再在同一个变更中修正文档。

## 阅读顺序

1. [FRONTEND_SPEC.md](FRONTEND_SPEC.md)：产品界面、信息架构、主题、token、动效、小窗和验收标准的单一真相。
2. [AI_HANDOFF_CHECKLIST.md](AI_HANDOFF_CHECKLIST.md)：任何 AI 或新维护者开始和结束工作时必须逐项核对的清单。
3. [../backend-design/BACKEND_SPEC.md](../backend-design/BACKEND_SPEC.md)：IPC、数据、任务 Provider 和同步语义。
4. [../backend-design/TEST_AND_RELEASE.md](../backend-design/TEST_AND_RELEASE.md)：测试、打包和 GitHub Release 门禁。

## 源码责任

| 路径 | 责任 |
| --- | --- |
| `src/app/` | 应用骨架、顶级导航和 renderer 状态编排 |
| `src/features/focus/` | 专注计时与当前会话账本 |
| `src/features/tasks/` | 固定滴答语义的任务工作台、完成历史和统一任务选择器 |
| `src/features/history/` | 统计摘要、带请求版本保护的历史会话和同步状态 |
| `src/features/settings/` | 连接、同步与体验设置 |
| `src/features/mini/` | 固定两态小窗及边缘自动收起表现 |
| `src/ui/` | 无业务含义的基础 UI 组件 |
| `src/styles/` | token、主题、动效、主窗与小窗样式 |
| `shared/ipc/api.ts` | renderer 唯一允许调用的主进程 API 类型 |

## 文档维护规则

- 不新增 `FINAL_REPORT.md`、`FIX_REPORT.md`、截图证据或第二份“设计总纲”。可复用结论直接并入 `FRONTEND_SPEC.md`。
- 功能入口、状态文案、尺寸、主题 token 或动效节奏发生变化时，必须同步更新前端规范和 AI 清单。
- IPC 或数据语义改变时，只在前端文稿说明用户可见结果，底层真值写入后端规范。
- 发布说明不放在本目录；每个发布目录保存自己的 `RELEASE_NOTES.md`，GitHub Release 使用同一份正文。
