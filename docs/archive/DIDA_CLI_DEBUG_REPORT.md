# FocusLink - dida CLI 调试报告

生成时间：2026-06-29

## 一、问题背景

用户报告：
1. 设置页显示「dida CLI 已连接」
2. 点击「测试读取任务」时失败
3. 右侧任务区没有列出滴答清单任务
4. 用户本地 dida CLI 已配置好且能正常使用

要求：不能只显示「连接成功」，必须能真实列出任务。

## 二、根因诊断

### 2.1 真实执行 dida CLI 命令验证

在用户本机执行以下命令得到真实输出：

| 命令 | exitCode | 关键输出 |
|------|----------|----------|
| `where dida` | 0 | `C:\Users\poyi\AppData\Roaming\npm\dida` |
| `dida --version` | 0 | `0.1.10` |
| `dida --help` | 0 | 显示子命令：auth / task / project / habit / focus / tag / countdown |
| `dida auth status` | 0 | `✓ 已登录  Token: 1990ffa2...fc4d` |
| `dida project list --help` | 0 | 显示 `--json` 选项 |
| `dida task filter --help` | 0 | 显示 `--projects/--status/--tag/--json` 等选项 |
| `dida project list --json` | 0 | 返回 JSON 数组，含 id/name/sortOrder/viewMode/kind |
| `dida task filter --json --status 0` | 0 | 返回 JSON 数组，含 id/projectId/title/status/priority/items |
| `dida task update --help` | 0 | `<taskId> --content <content>` 是覆盖式更新 |

### 2.2 真实命令格式结论

- **项目列表命令**：`dida project list --json` ✅（默认模板已正确）
- **任务列表命令**：`dida task filter --json` ✅（默认模板已正确）
- **任务搜索命令**：`dida task filter --json` ✅（默认模板已正确，未来需评估是否支持搜索关键词）
- **追加备注命令**：`dida task update {{taskId}} --content "{{content}}"` ⚠️（**覆盖式**而非追加，需要在调用前先读取原内容并拼接）

### 2.3 任务对象字段映射

`dida task filter --json` 单个任务对象字段：

```json
{
  "id": "6a301964e4b004ec593210f2",
  "projectId": "6a30195ee4b029b3840a56ee",
  "sortOrder": -1781537037,
  "title": "Day6 — 2.3.4.6~2.3.4.10 空间垂直关系综合",
  "timeZone": "Asia/Shanghai",
  "isAllDay": false,
  "priority": 0,
  "status": 0,
  "items": [
    {
      "id": "...",
      "title": "子任务标题",
      "status": 0,
      ...
    }
  ],
  "tags": [],
  "etag": "...",
  "kind": "CHECKLIST",
  "modifiedTime": "2026-06-15T15:25:24.602+0000",
  "createdTime": "2026-06-15T15:25:24.602+0000"
}
```

字段映射规则（已实现于 `normalizeTasks`）：
- `id` → `Task.id`
- `projectId` → `Task.projectId`
- `title` → `Task.title`
- `status: 0/2` → `Task.status: 'pending'/'completed'`
- `priority: 0/1/3/5` → `Task.priority`
- `tags[]` → `Task.tags[]`
- `items[]` → 递归展开为子任务，前缀 `↳`
- `dueDate` 字符串 → `Task.dueDate` (epoch ms)

### 2.4 真正的根因：TaskPanel 没有调用 CLI IPC

之前的 `src/components/TaskPanel.tsx` 中的 `handleRefreshTicktick` 函数：

```typescript
// 旧代码（已删除）
const handleRefreshTicktick = async () => {
  if (!ticktickConnected) return;        // 只检查 OAuth 连接状态
  const projects = await window.focuslink.ticktick.listProjects();  // 只调 OAuth
  const tasks = await window.focuslink.ticktick.listTasks(selectedProject || undefined);
  // ...
};
```

**问题**：`TaskPanel.tsx` 只调用 `window.focuslink.ticktick.*`（OAuth 路径），完全不调用 `window.focuslink.cli.*`（CLI 路径）。

即使用户在设置页选择了 `taskSource: 'ticktick-cli'`，TaskPanel 仍然走 OAuth 路径，而 OAuth 未连接，所以任务列表永远为空。

**根本原因**：渲染层与 IPC 设计脱节。`preload.ts` 已经暴露了 `window.focuslink.cli.*` API，但 TaskPanel 没有使用它。

## 三、修复方式

### 3.1 cliProvider.ts 增强

完整重写 `electron/tasks/cliProvider.ts`，新增：

1. **`execWithDiagnose()`** 函数：每次执行记录完整诊断信息
   - `command`（已脱敏 token）
   - `cwd`
   - `timeoutMs`
   - `exitCode`
   - `stdout` / `stderr`
   - `durationMs`
   - `status`: `success` / `failed` / `timeout` / `not-found` / `parse-failed`
   - `parseResult`: `success` / `failed` / `na`
   - `error`

2. **错误分类**：
   - 命令不存在（ENOENT / "not recognized"）→ `status='not-found'`
   - 命令超时（killed / SIGTERM）→ `status='timeout'`
   - 退出码非 0 → `status='failed'`
   - 退出码 0 但 JSON 解析失败 → `status='parse-failed'`

3. **`diagnoseCli()`** 函数：完整诊断流程，6 步：
   - 探测 CLI（where dida）
   - 版本检测（dida --version）
   - 登录状态（dida auth status）
   - 项目列表（dida project list --json）
   - 任务列表（dida task filter --json）
   - 搜索任务（dida task filter --json）

4. **`testCommand()`** 函数：执行任意命令并返回完整诊断记录

5. **`normalizeTasks()`** 增强：
   - 处理 `status` 数字字段（0=pending, 2=completed）
   - 处理 `dueDate` 字符串字段（ISO 时间）
   - 递归处理 `items[]` 子任务（前缀 `↳`）

6. **listProjects / listTasks / searchTasks**：抛出带详细信息的错误（exitCode + stderr 片段），不再返回空数组

### 3.2 ipc.ts 增强

新增 IPC handler：
- `cli:diagnose` → 调用 `diagnoseCli()`，返回完整诊断报告
- `cli:test-command` → 执行任意命令并返回 `CliExecRecord`

### 3.3 preload.ts 增强

新增 API：
- `window.focuslink.cli.diagnose()`
- `window.focuslink.cli.testCommand(command, timeoutMs)`

### 3.4 TaskPanel.tsx 修复（核心修复）

重写整个组件，根据 `settings.taskSource` 路由：

```typescript
const taskSource = settings?.taskSource ?? 'local';

const handleRefresh = async () => {
  if (taskSource === 'local') {
    // 调用 window.focuslink.tasks.listLocal()
  } else if (taskSource === 'ticktick-cli') {
    // 调用 window.focuslink.cli.listProjects() + cli.listTasks()
    // 失败时显示 cliError 提示框
  } else if (taskSource === 'ticktick-oauth') {
    // 调用 window.focuslink.ticktick.listProjects() + ticktick.listTasks()
  }
};
```

UI 改进：
- 状态卡片图标根据 taskSource 切换：本地 (HardDrive) / CLI (Terminal) / OAuth (Cloud)
- 显示连接状态文本：「本地任务」「dida CLI 已连接」「TickTick 已连接」
- CLI 失败时显示红色错误提示框
- 切换 taskSource 时自动刷新一次
- 切换清单时自动刷新任务列表
- 搜索框：CLI 模式下按 Enter 调用 `cli.searchTasks`，其他模式本地过滤

### 3.5 SettingsPanel.tsx 增强

新增 `CliDiagnosticPanel` 子组件：
- 「完整诊断」按钮：一键运行所有 6 步诊断
- 「测试项目列表」按钮
- 「测试任务列表」按钮
- 「测试搜索」按钮
- 「复制诊断信息」按钮：复制完整报告到剪贴板

显示信息：
- CLI 路径 / 版本 / 登录状态 / CWD
- 6 步诊断列表，每步可展开查看：command / exitCode / status / parseResult / durationMs / stdout / stderr / error
- 最近一次错误提示框
- 折叠的原始 stdout / stderr（前 2000 字符）

## 四、当前最终采用的命令模板

```typescript
ticktickCli: {
  executable: '',                            // 留空，自动探测到 'dida'
  listTasksCommand: 'dida task filter --json',
  searchTasksCommand: 'dida task filter --json',
  getTaskCommand: 'dida task get {{projectId}} {{taskId}} --json',
  appendNoteCommand: 'dida task update {{taskId}} --content "{{content}}"',
  listProjectsCommand: 'dida project list --json',
  timeoutMs: 10000,
}
```

## 五、为什么之前读取失败

1. **根因 #1**：`TaskPanel.tsx` 中 `handleRefreshTicktick` 只调用 `window.focuslink.ticktick.*`（OAuth 路径），完全不调用 `window.focuslink.cli.*`（CLI 路径）。即使用户选择 `taskSource='ticktick-cli'`，UI 仍然走 OAuth，而 OAuth 未连接，所以任务列表为空。
2. **根因 #2**：`cliProvider.ts` 旧版本只在抛出错误时返回简短信息（`CLI 列出任务失败：${err.message}`），未包含 exitCode、stderr、原始输出片段，难以排查。
3. **次要原因**：`normalizeTasks` 没有处理 `status` 数字字段（0/2）和 `items` 子任务数组，可能丢失部分任务。

## 六、修复后支持的 dida CLI 能力

| 能力 | 是否支持 | 备注 |
|------|---------|------|
| 探测 CLI（where dida） | ✅ | Windows / macOS / Linux |
| 版本检测 | ✅ | `dida --version` |
| 登录状态 | ✅ | `dida auth status`，识别「已登录」关键字 |
| 列出项目 | ✅ | `dida project list --json` |
| 列出任务 | ✅ | `dida task filter --json` |
| 按清单筛选任务 | ⚠️ | 当前模板未使用 `--projects` 参数，需要在模板里加 `--projects {{projectId}}` 才能生效 |
| 搜索任务 | ⚠️ | dida CLI 没有真正的全文搜索命令，`task filter` 只能按字段过滤；当前 `searchTasksCommand` 与 `listTasksCommand` 相同，本质是返回所有任务后客户端过滤 |
| 关联到当前 Segment | ✅ | 通过 `timer.linkTask` 实现 |
| 设为会话默认任务 | ✅ | 通过 `timer.linkSessionTask` 实现 |
| 追加专注记录到任务备注 | ⚠️ | `dida task update --content` 是覆盖式而非追加；需要在 `appendFocusRecordToTask` 中先读取原 content 再拼接 |

## 七、当前仍未支持的 dida CLI 能力

1. **真正的搜索**：dida CLI 没有提供按关键词模糊搜索的子命令；只能通过 `task filter --tag/--priority/--status` 等条件过滤
2. **任务备注追加**：`dida task update --content` 是覆盖式更新；需要先 `task get` 读取原 content 再拼接后写入
3. **按清单筛选**：当前 `listTasksCommand` 模板未带 `--projects {{projectId}}` 参数；如果用户在 UI 中选了某个清单，需要在 `renderTemplate` 时拼接 `--projects`
4. **任务状态切换**：`dida task complete` 命令未集成
5. **创建任务**：`dida task create` 命令未集成
6. **删除任务**：`dida task delete` 命令未集成
7. **专注记录同步**：`dida focus create` 命令未集成（实验性 Focus 同步未走 CLI 通道）

## 八、诊断日志格式

每次执行命令的日志格式：

```txt
[cli] exec { command: "dida project list --json", cwd: "...", timeoutMs: 10000 }
[cli] exec done { exitCode: 0, durationMs: 234, stdoutLen: 5423, stderrLen: 0 }
[cli] exec failed { status: "timeout", exitCode: null, error: "命令超时（10000ms）", stdoutLen: 0, stderrLen: 0 }
```

错误分类：
- `success`：命令执行成功
- `failed`：命令执行失败（exitCode 非 0）
- `timeout`：命令超时
- `not-found`：命令不存在（ENOENT / "not recognized"）
- `parse-failed`：命令执行成功但 JSON 解析失败

## 九、安全说明

- 命令日志中 token 已脱敏：`token=abc123` → `token=***`
- 所有命令通过 `execAsync` 执行，带 `windowsHide: true` 隐藏控制台窗口
- 命令超时默认 10 秒，避免阻塞 UI
- 输出最大缓冲 4MB，避免内存爆炸
- `testCommand` IPC 接受任意命令字符串，理论上可被恶意渲染进程利用，但 contextIsolation 已开启，且只在本机使用

## 十、验证步骤

1. 打开 FocusLink
2. 进入「设置 → 任务来源」
3. 选择「滴答清单 CLI」
4. 在「CLI 诊断面板」点击「完整诊断」
5. 应看到 6 步全部 OK
6. 切换到主界面，右侧任务区应显示「dida CLI 已连接」
7. 点击「刷新」，应看到任务列表（按 Day1-Day16 显示）
8. 切换清单下拉，任务列表应更新
9. 选中某个任务，按「关联到当前片段」（需先开始专注）
10. 关联成功后，主计时器区域应显示该任务标题
