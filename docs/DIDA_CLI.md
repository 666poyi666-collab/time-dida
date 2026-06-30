# dida CLI 集成 (DIDA_CLI)

> 版本：v0.1.7
> 本文说明 FocusLink 如何通过本地 `dida` 命令行工具读取滴答清单任务、写入专注记录、诊断故障。

## 1. 概述

FocusLink 的「dida CLI」任务来源（`taskSource: 'ticktick-cli'`）复用本地 `dida` 命令行工具已登录的 OAuth token，不重复做账号登录。这是**推荐的任务来源**，比 TickTick OAuth 适配器更轻量稳定。

核心实现：[electron/tasks/cliProvider.ts](../electron/tasks/cliProvider.ts)

## 2. 前置条件

1. 安装 dida CLI（Node 全局命令）：`npm i -g dida`（或官方发布渠道）
2. 在终端完成一次 OAuth 登录：`dida auth login`
3. 验证登录：`dida auth status`（应输出 `✓ 已登录`）

FocusLink 启动后会自动探测 `dida` / `ticktick` / `ticktick-cli` / `todo` 候选命令（Windows 用 `where`，其他系统用 `which`）。

## 3. dida CLI 能力（参考）

```
Usage: dida [options] [command]
DIDA CLI – 在终端管理滴答清单的任务、清单、习惯与专注

Commands:
  auth            OAuth 登录与 token 存储
  task            创建、更新与查询任务
  project         列出并管理清单
  habit           管理习惯与打卡
  focus           创建、查询与删除专注（番茄钟）记录
  tag             列出与创建标签
  countdown       列出倒数日
```

## 4. 命令模板

默认模板定义在 [shared/types.ts](../shared/types.ts) 的 `DEFAULT_SETTINGS.ticktickCli`（`DIDA_DEFAULT_TEMPLATES`）：

| 操作 | 默认模板 | 占位符 |
| --- | --- | --- |
| 列出清单 | `dida project list --json` | 无 |
| 列出任务 | `dida task filter --json` | `{{projectId}}` |
| 搜索任务 | `dida task filter --json` | `{{query}}` |
| 获取任务 | `dida task get {{projectId}} {{taskId}} --json` | `{{projectId}}` `{{taskId}}` |
| 追加备注 | `dida task update {{taskId}} --content "{{content}}"` | `{{taskId}}` `{{content}}` |
| 完成任务 | `dida task complete {{projectId}} {{taskId}}`（硬编码） | - |
| 默认超时 | `10000` ms | - |

占位符替换由 `renderTemplate()` 完成，双引号会被转义。

所有模板可在设置页「任务来源 → 滴答清单 CLI」自定义。

> **注意**：`dida task update --content` 是**覆盖式**写入（dida 无 append 子命令）。FocusLink 的 `appendFocusRecordToTask` 会先读取任务原有 content，拼接新记录后再整体写回，避免覆盖。

## 5. 自动迁移

当探测到 `dida` 命令，且当前模板仍包含 `ticktick` 字面量（旧版本残留）时，`applyDidaDefaults()` 会自动把模板迁移为 dida 默认模板并持久化。判定函数：`templatesContainTicktick()`。

## 6. 任务归一化（normalizeTasks）

dida CLI 返回的 JSON 结构会被归一化为统一 `Task` 模型：

- `id` ← `id` / `_id` / `taskId` / 数组下标
- `title` ← `title` / `name` / `content`
- `projectId` ← `projectId` / `project`（子任务继承父任务）
- `status`：数字 `0/1/2` → `pending` / `in-progress` / `completed`；`completedTime` 非空也视为已完成
- `isCompleted`：`status===2` 或 `completed===true` 或 `completedTime` 非空
- `priority` / `dueDate` / `sortOrder` / `tags`
- `items[]` 递归 → `children[]` 树结构（**不再用 `↳` 前缀**，用缩进表达层级）

## 7. 诊断面板（设置页）

点击「完整诊断」会执行 6 步并返回完整记录（`CliDiagnoseResult`）：

| 步骤 | 命令 | 检查 |
| --- | --- | --- |
| 1. 探测 CLI | `where dida` / `which dida` | 是否存在 |
| 2. 版本检测 | `dida --version` | 可执行 |
| 3. 登录状态 | `dida auth status` | 是否已登录 |
| 4. 项目列表 | `dida project list --json` | JSON 解析 |
| 5. 任务列表 | `dida task filter --json` | JSON 解析 + 归一化 |
| 6. 搜索任务 | `dida task filter --json`（query=test） | 连通性 |

每步记录：`command` / `cwd` / `timeoutMs` / `exitCode` / `stdout` / `stderr` / `durationMs` / `status` / `parseResult` / `error`。

`status` 取值：`success` / `failed` / `timeout` / `not-found` / `parse-failed`。

「测试命令」按钮可执行任意命令并返回 `CliExecRecord`，用于自定义模板调试。

## 8. 安全

- 命令执行有 `timeoutMs` 超时（默认 10s）
- 日志中 token 会被 `maskSecret()` 脱敏（`token=***`）
- CLI 不存在时不会崩溃，返回 `not-found` 状态供 UI 展示
- `windowsHide: true` 隐藏命令行窗口
- 任务关联**不修改外部任务内容**（除显式「追加备注」操作）

## 9. IPC 通道

| 通道 | 作用 |
| --- | --- |
| `cli:detect` | 探测本地 CLI |
| `cli:get-current-provider` | 当前 provider 类型 + 模板 + 是否含旧 ticktick 字面量 |
| `cli:apply-dida-defaults` | 应用 dida 默认模板 |
| `cli:list-projects` | 列出清单 |
| `cli:list-tasks` | 列出任务（可选 projectId） |
| `cli:search-tasks` | 搜索任务 |
| `cli:diagnose` | 完整 6 步诊断 |
| `cli:test-command` | 测试任意命令 |

所有 `cli:list-*` / `cli:search` / `cli:diagnose` / `cli:test-command` 返回 `{ ok: true, data } | { ok: false, error }` 结构，错误信息带完整诊断。

## 10. 常见问题

**Q: 提示「CLI 命令不存在」？**
A: 在终端执行 `where dida`（Windows）确认命令在 PATH 中；若未安装，`npm i -g dida`；或在设置页手动填写 `executable` 路径。

**Q: 任务列表为空？**
A: 先在终端 `dida auth login` 登录；再用「完整诊断」检查登录状态与项目列表；确认所选项目下确实有任务。

**Q: 追加备注失败？**
A: dida CLI 无 append 子命令，FocusLink 用 `dida task update --content` 覆盖式写入（先读后拼）。若任务 content 过大可能超时，可调大 `timeoutMs`。

**Q: 输出不是 JSON？**
A: 确认命令模板含 `--json` 参数；用「测试命令」查看原始 stdout；部分 dida 版本输出可能与模板不匹配，可在设置页自定义模板。

## 11. 相关文档

- [架构说明](ARCHITECTURE.md) — cliProvider 在主进程中的位置
- [产品规格](PRODUCT_SPEC.md) — 任务来源与同步模式
- 历史调试记录见 `docs/archive/`（CLI_PROVIDER_REPORT.md、DIDA_CLI_DEBUG_REPORT.md、DIDA_PROVIDER_FIX_REPORT.md）
