# FocusLink v0.8.0

> 本地候选构建日期：2026-07-12
>
> 状态：未发布；没有对应 tag 或 GitHub Release，仅保留本机候选资产。

## 本次更新

- 全面重建主窗与固定两态小窗，统一状态光场、材质、深浅主题和动效 token。
- 任务选择统一为 TaskPicker，历史和设置移除重复卡片、无效说明与低频首屏交互。
- 修复短专注持久化、崩溃恢复、dida checklist 父任务解析、队列 Provider 隔离和重新关联一致性。
- 番茄 To-do 增强离线待上传、云桥补传、“学习”兜底和 Windows 原子写盘重试。
- 前端、后端集成、shared 与脚本按稳定职责重新分区。

## 验证

- 通过 format、typecheck、lint、186 项自动化测试、生产构建与打包。
- 通过隔离自测、崩溃恢复、Windows 写盘压力测试、主窗/小窗 smoke。
- 真实 dida 临时任务验证中文评论、marker 幂等、短原生 focus 与清理。

## 已知限制

- 当前任务管理仍以关联流程为主；独立任务工作台和取消完成计划在 v0.9.0 提供。

## 下载与校验

| 文件 | SHA256 |
| --- | --- |
| `FocusLink-0.8.0-x64.exe` | `EA3E4C0F68F20050B06F2AC753D5A77099332AFE8B6EC14877238584C6EC7E34` |
| `FocusLink-0.8.0-x64-portable.exe` | `40793D52502655AAB0AE0A89C2BA8014D5F4977BDECE0BD2F62D3ECFCF530229` |

完整校验记录见 `SHA256SUMS.txt`。
