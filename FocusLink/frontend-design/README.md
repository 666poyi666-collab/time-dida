# FocusLink 前端设计索引

> 适用版本：v0.12.x 系列；当前对应 v0.12.25「全端粒子时间带与移动连接诊断」
>
> 文档责任：只描述产品体验、renderer 结构和可验收的视觉/交互规则。

这个目录是 FocusLink 前端设计的唯一规范入口。旧截图、一次性改版报告和已经废弃的视觉概念不具有约束力；发现实现与文档冲突时，先核对当前测试与运行行为，再在同一个变更中修正文档。

## 前端档案

### 产品与交互

- [FRONTEND_SPEC.md](FRONTEND_SPEC.md)：界面信息架构、主题 token、字体、计时仪表、时间之带、账本、小窗和验收标准的单一真相。

### 开发与维护

- [AI_HANDOFF_CHECKLIST.md](AI_HANDOFF_CHECKLIST.md)：开始修改、视觉验收和交付前必须逐项核对的清单。

### 后端边界

- [../backend-design/BACKEND_SPEC.md](../backend-design/BACKEND_SPEC.md)：IPC、数据、任务 Provider 和同步事实。
- [../backend-design/TEST_AND_RELEASE.md](../backend-design/TEST_AND_RELEASE.md)：自动化、真实服务、打包和发布门禁。

## 源码责任

| 路径 | 责任 |
| --- | --- |
| `src/app/` | 应用骨架、顶级导航和 renderer 状态编排 |
| `src/features/focus/` | 专注计时、五套计时仪表（TimerDial）、canvas 时间之带与当前会话账本 |
| `src/features/tasks/` | 固定滴答语义的任务工作台、完成历史和统一任务选择器 |
| `src/features/history/` | 结论优先统计、双尺度单日时间轴、堆叠日柱、任务构成带与带请求版本保护的历史详情 |
| `src/features/settings/` | 连接、同步与体验设置 |
| `src/features/mini/` | 固定两态小窗及边缘自动收起表现 |
| `src/mobile/` | Web/PWA/Android 共用的多端专注控制台与同步账本；能力边界与桌面端分开声明 |
| `src/ui/` | 无业务含义的基础 UI 组件 |
| `mobile/` | 移动端 HTML、manifest、service worker 与图标，不保存业务逻辑 |
| `src/styles/` | `main.css` / `mini.css`（入口组合导入）、`temporal-foundation.css`（token/字体）、`legacy-support.css`（沿用规则清理版）、`linear-workbench.css`（唯一表现层）、`temporal-mini.css`（小窗） |
| `shared/focus/bandMath.ts` | 时间之带缩放/步进/变焦纯函数内核 |
| `shared/timerInstruments.ts` | 7×9 像素点阵、翻页状态机与专注核心几何 |
| `shared/ipc/api.ts` | renderer 唯一允许调用的主进程 API 类型 |

## 文档维护规则

- 不新增 `FINAL_REPORT.md`、`FIX_REPORT.md`、截图证据或第二份“设计总纲”。可复用结论直接并入 `FRONTEND_SPEC.md`。
- 功能入口、状态文案、尺寸、主题 token 或动效节奏发生变化时，必须同步更新前端规范和 AI 清单。
- IPC 或数据语义改变时，只在前端文稿说明用户可见结果，底层真值写入后端规范。
- 发布说明不放在本目录；每个发布目录保存自己的 `RELEASE_NOTES.md`，GitHub Release 使用同一份正文。
