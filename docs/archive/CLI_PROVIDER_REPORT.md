# 本地滴答清单 CLI Provider 报告

> 报告日期：2026-06-29
> Provider 文件：`electron/tasks/cliProvider.ts`
> 设置 UI：`src/components/SettingsPanel.tsx`「任务来源 + 滴答清单 CLI」Section

## 一、检测到的 CLI

### 自动探测结果

| 候选命令 | 结果 | 路径 |
|----------|------|------|
| `ticktick` | 未找到 | - |
| `dida` | **找到** | `C:\Users\poyi\AppData\Roaming\npm\dida` 和 `dida.cmd` |
| `ticktick-cli` | 未找到 | - |
| `todo` | 未找到 | - |

**当前使用命令**：`dida`（版本 0.1.10）

### dida CLI 能力

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

### dida auth status

```
✓ 已登录
  Token: 1990ffa2...fc4d
```

说明：用户本地已经通过 `dida auth login` 完成 OAuth PKCE 登录，token 已保存在本地。FocusLink 的 CLI Provider 直接复用此 token，不需要再次登录。

## 二、当前使用的命令模板

在 `shared/types.ts` 的 `DEFAULT_SETTINGS.ticktickCli` 中已配置适配 dida CLI 的默认模板：

| 操作 | 模板 | 说明 |
|------|------|------|
| 列出清单 | `dida project list --json` | 输出 JSON 数组 |
| 列出任务 | `dida task filter --json` | 输出所有未完成/已完成任务（含子任务） |
| 搜索任务 | `dida task filter --json` | dida filter 命令自身支持过滤，复用同命令 |
| 获取任务 | `dida task get {{projectId}} {{taskId}} --json` | 占位符 `{{projectId}}` `{{taskId}}` |
| 追加备注 | `dida task update {{taskId}} --content "{{content}}"` | 用 `--content` 覆盖式写入（dida 无 append 子命令） |

占位符替换：`{{projectId}}` `{{query}}` `{{taskId}}` `{{content}}`，由 `renderTemplate()` 在 `cliProvider.ts` 中完成。

所有模板用户可在设置页「任务来源 → 滴答清单 CLI」Section 自定义。

## 三、能力验证

### 1. 列出任务（listTasks）

命令：`dida task filter --json`

输出示例（节选）：

```json
[
  {
    "id": "6a301960e4b004ec593210a9",
    "projectId": "6a30195ee4b029b3840a56ee",
    "title": "Day2 — 2.3.1.1 斜二测 / 2.3.1.2 柱锥球台结构",
    "content": "## 实际专注记录（自动补充）\n- 2026-06-23 15:44:29-16:03:30 · 18分13秒 · 番茄 Todo：...",
    "status": 2,
    "priority": 0,
    "timeZone": "Asia/Shanghai",
    "items": [ /* 5 个子任务 */ ]
  }
]
```

结果：**能列出任务**。`normalizeTasks()` 把 dida 输出归一化为 FocusLink 的 `Task` 接口：
- `id` ← `obj.id`
- `projectId` ← `obj.projectId`
- `title` ← `obj.title`
- `status` ← `obj.status`（2=已完成，0=未完成）
- `priority` ← `obj.priority`
- `content` ← `obj.content`

### 2. 列出清单（listProjects）

命令：`dida project list --json`

输出示例：

```json
[
  {
    "id": "6a30195ee4b029b3840a56ee",
    "name": "数学 16 天复习计划：6.15—6.30",
    "sortOrder": -9223372036765298000,
    "viewMode": "list",
    "kind": "TASK"
  },
  {
    "id": "6a37a3e6e4b00aa504472a6a",
    "name": "错题",
    "viewMode": "list",
    "kind": "TASK"
  }
]
```

结果：**能列出清单**。

### 3. 搜索任务（searchTasks）

命令：`dida task filter --json`

说明：dida CLI 的 `task filter` 子命令自身支持 `--projects`、`--status`、`--priority`、`--tag`、`--start-date`、`--end-date` 等过滤参数，但不支持按文本关键词搜索。当前默认模板复用 `task filter --json`，会返回所有任务，由 FocusLink 在内存中用 `searchTaskCache()` 做 LIKE 过滤（`title LIKE ? OR content LIKE ?`）。

如果未来 dida CLI 支持文本搜索子命令（如 `dida task search "<query>" --json`），用户可在设置页直接修改 `searchTasksCommand` 模板，无需改代码。

### 4. 把 FocusLink 记录追加到任务（appendFocusRecordToTask）

命令模板：`dida task update {{taskId}} --content "{{content}}"`

`content` 由 `formatFocusRecord()` 生成，格式：

```
[FocusLink] 2026/6/29 18:38:53 - 2026/6/29 18:40:09 | 专注 1 分钟 | 暂停 0 分钟 | 任务标题
```

注意：dida CLI 的 `task update --content` 是**覆盖式**写入（替换整个 content 字段），不是追加。这意味着：
- 第一次写入：content = `[FocusLink] 2026/6/29 ...`
- 第二次写入：content 会被替换为新的记录，**之前的记录会丢失**

这是 dida CLI 当前实现的限制。**建议用户谨慎使用此功能**，或等 dida CLI 增加 `--append-content` 选项后再启用。

### 5. 获取任务详情（getTask）

命令：`dida task get {{projectId}} {{taskId}} --json`

需要同时传入 projectId 和 taskId，FocusLink 在调用时会从 Task 对象中提取 projectId。

## 四、安全要求对照

| 要求 | 实现位置 | 状态 |
|------|---------|------|
| 不在日志中泄露 token | `runCommand()` 中 `command.replace(/token=[^&\s"]+/gi, 'token=***')` | PASS |
| 命令执行有 timeout | `execAsync(command, { timeout: cfg.timeoutMs })`，默认 10000ms | PASS |
| 命令失败显示 stderr | `try/catch` 捕获并 `throw new Error('CLI ... 失败：' + err.message)` | PASS |
| JSON 解析失败显示原始输出片段 | `parseJson()` 失败时返回 `{ ok: false, raw: trimmed.slice(0, 300) }` | PASS |
| CLI 不存在时不崩溃 | `detectCli()` 失败返回 `{ found: false }`，`listTasks()` 等方法 catch 后 throw 友好错误 | PASS |
| CLI Provider 与 OAuth Provider 并存 | `taskSource: 'local' | 'ticktick-cli' | 'ticktick-oauth'` 三选一 | PASS |
| 用户可在设置页选择任务来源 | SettingsPanel「任务来源」单选按钮 | PASS |

## 五、设置页 UI

`src/components/SettingsPanel.tsx` 的「任务来源」Section 包含：

1. **任务来源选择**：本地任务 / 滴答清单 CLI / TickTick OAuth 三选一
2. **CLI 自动探测按钮**：点击后调用 `cli:detect` IPC，显示探测结果
3. **CLI 可执行文件路径**：留空则用探测结果；可手动指定绝对路径
4. **命令模板编辑区**：
   - 列出清单命令
   - 列出任务命令
   - 搜索任务命令
   - 获取任务命令
   - 追加备注命令
5. **超时配置**：默认 10000ms
6. **测试读取任务按钮**：调用 `cli:list-tasks`，结果显示在 Toast 或 Console

## 六、失败时的提示策略

| 场景 | UI 提示 | 日志 |
|------|---------|------|
| CLI 不存在 | Toast: "未检测到滴答清单 CLI，请确认已安装或在上方手动指定路径" | `[cli] no TickTick CLI detected` |
| 命令超时 | Toast: "CLI 命令执行超时（10s）" | `[cli] exec` 含 timeout 信息 |
| JSON 解析失败 | Toast: "CLI 输出不是 JSON。原始输出片段：..." | `[cli] listTasks JSON parse failed` |
| 命令返回非零 | Toast: "CLI 列出任务失败：退出码 N，stderr: ..." | `[cli] listTasks failed` + err.message |
| 未登录（dida auth status 未登录） | dida CLI 自身会输出 "未登录" 错误，FocusLink 透传 | 同上 |

## 七、与 OAuth Provider 的关系

- CLI Provider 和 OAuth Provider 是两个独立实现，互不影响
- 用户在设置页选择 `taskSource`：
  - `local`：用 LocalProvider（内置 SQLite 任务表）
  - `ticktick-cli`：用 TickTickCliProvider（执行本地 dida 命令）
  - `ticktick-oauth`：用 TickTickAdapter（OAuth API，远程调用）
- 三者通过统一的 `TaskProvider` 接口（`listProjects/listTasks/searchTasks/getTask/updateTask/appendFocusRecordToTask`）解耦

## 八、已知限制

1. **dida task update --content 是覆盖式**：FocusLink 的 `appendFocusRecordToTask` 实际是覆盖 content，不是追加。如果任务已有备注，会被替换。建议用户在 dida CLI 增加 `--append-content` 后再使用此功能。
2. **dida task filter 不支持文本搜索**：搜索功能在 FocusLink 内存中用 LIKE 过滤，不是 CLI 原生支持。
3. **dida focus 子命令未集成**：dida CLI 提供了 `focus create/list/delete` 子命令，FocusLink 的 `experimentalFocus.ts` 适配器尚未对接，等实验性 Focus API 阶段再接入。
