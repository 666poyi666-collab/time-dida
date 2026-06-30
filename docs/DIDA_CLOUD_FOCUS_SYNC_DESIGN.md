# dida 云端专注记录同步设计 (DIDA_CLOUD_FOCUS_SYNC_DESIGN)

> 版本：v0.2.0
> 状态：**设计稿 / 暂不实现**
> 结论：当前版本无法安全写入滴答清单云端专注记录，**暂不实现**，仅保留本地记录与任务备注追加两条稳定通道。

---

## 0. TL;DR

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| 本地 Session / Segment / PauseEvent 持久化 | ✅ 已实现 | SQLite，稳定 |
| dida CLI 读取任务 / 清单 | ✅ 已实现 | `dida task filter` / `dida project list` |
| 追加专注记录到任务备注（dida CLI） | ✅ 已实现 | `dida task update --content`，先读后拼，覆盖式 |
| TickTick OAuth 追加备注 | ✅ 已实现 | `task update` 接口 |
| **写入滴答云端"专注记录"（番茄钟记录）** | ❌ **未实现** | 见下文分析 |
| 实验性 V2/session Focus 适配器 | 🟡 占位骨架 | 仅 `logger.info`，不调用真实接口 |

**诚实结论**：FocusLink v0.2.0 **没有**写入滴答云端专注记录的能力。UI 中"本地 / 云端状态"面板会明确显示"滴答清单云端专注记录：未实现"。

---

## 1. 当前 dida CLI 能做什么

参考 [DIDA_CLI.md](./DIDA_CLI.md) 与 `dida --help` 输出，dida CLI 提供以下命令族：

```
auth            OAuth 登录与 token 存储
task            创建、更新与查询任务
project         列出并管理清单
habit           管理习惯与打卡
focus           创建、查询与删除专注（番茄钟）记录
tag             列出与创建标签
countdown       列出倒数日
```

FocusLink 当前实际使用的子命令：

| 操作 | 命令 | 用途 |
| --- | --- | --- |
| 列出清单 | `dida project list --json` | 任务面板左侧清单树 |
| 列出任务 | `dida task filter --json` | 任务面板任务树 |
| 搜索任务 | `dida task filter --json` | 任务搜索 |
| 获取单任务 | `dida task get {{projectId}} {{taskId}} --json` | 追加备注前读取原 content |
| 追加备注 | `dida task update {{taskId}} --content "{{content}}"` | 把专注记录拼接到任务备注 |
| 完成任务 | `dida task complete {{projectId}} {{taskId}}` | dida 任务完成 |

注意：**FocusLink 没有调用 `dida focus create`**。即 dida CLI 虽然暴露了 focus 子命令，但本仓库未集成。

---

## 2. 当前 dida CLI 不能做什么（在 FocusLink 中）

1. **没有调用 `dida focus create`**：即使 dida CLI 提供 focus 子命令，FocusLink 也没有用它写入云端专注记录。
2. **没有调用 `dida focus list` / `dida focus delete`**：无法回读或撤销云端专注记录。
3. **`dida task update --content` 是覆盖式**：没有 append 子命令，必须先读后写。
4. **没有原子锁**：先读 content 再写回期间，若用户在滴答端同步编辑该任务，会发生 lost update。
5. **没有官方专注记录写入 API**：滴答官方 Open API 仅覆盖 tasks:read / tasks:write，不含 Pomodoro/Focus 写入。

---

## 3. 是否存在官方专注记录 API

**结论：不存在稳定的官方专注记录写入 API。**

依据：

1. 滴答清单官方 Open API（<https://developer.ticktick.com/docs>）文档中，scopes 仅 `tasks:read` / `tasks:write`，没有 `focus:write` 或 `pomodoro:write`。
2. 专注/番茄钟记录在滴答客户端内是一个独立模块，写入路径走的是**非官方 V2/session API**（`api.ticktick.com/api/v2/...`），需要浏览器 session cookie，而非 OAuth access token。
3. 仓库中 `electron/providers/experimentalFocus.ts` 已注明：

   > TickTick 官方 Open API 主要是 tasks:read / tasks:write，
   > Focus/Pomodoro 写入能力依赖非官方 V2/session API 或第三方 SDK（ticktick-sdk），
   > 不稳定，不能当成稳定官方接口来依赖。

4. dida CLI 的 `focus` 子命令虽然存在，但其底层走的也是非官方接口，且 FocusLink 未验证其写入语义（是否会重复创建、能否回滚、字段是否齐全）。

---

## 4. 是否能安全追加到任务备注

**结论：可以，但仅作为"备注同步"，不是"云端专注记录"。已有实现，存在已知风险。**

### 4.1 现有实现

`electron/tasks/cliProvider.ts#appendFocusRecordToTask`：

```ts
async appendFocusRecordToTask(taskId: string, record: FocusRecord): Promise<void> {
  const cfg = getConfig();
  const task = await this.getTask(taskId);          // 1. 读取原 content
  const block = formatFocusRecord(record);          // 2. 格式化新记录
  const content = task?.content?.trim()
    ? `${task.content.trim()}\n\n${block}`           // 3. 拼接
    : block;
  const cmd = renderTemplate(cfg.appendNoteCommand, {
    taskId: task?.externalId ?? taskId,
    content,
  });
  const r = await execWithDiagnose(cmd, cfg.timeoutMs, 'na');
  if (r.record.status !== 'success') {
    throw new Error(`CLI 追加备注失败：${r.record.error ?? r.record.stderr.slice(0, 200)}`);
  }
}
```

### 4.2 已知风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 覆盖式写入 | `dida task update --content` 是整体覆盖 | 已用先读后拼缓解 |
| Lost update | 读 → 写之间用户在滴答端编辑该任务，新内容会被 FocusLink 的旧快照覆盖 | 无锁，仅靠短超时窗口 |
| 大 content 超时 | 任务备注累积过长时 `--content "..."` 命令行长度可能超限 | 默认 10s 超时，未做长度截断 |
| 并发追加 | 同一任务被多个 segment 同时追加，可能后写覆盖前写 | sync_queue 串行处理，但跨进程无锁 |
| 格式污染 | 备注里混入 FocusLink 格式化文本，用户可能不喜欢 | 已用清晰分隔符，但不可关闭 |

### 4.3 适用场景

- 用户主动点击"同步到滴答备注"
- 单次同步、可重试、失败不丢本地数据
- **不适合**作为自动后台同步的默认行为

---

## 5. `task update --content` 是否会覆盖原内容

**会。`dida task update --content` 是覆盖式写入。**

验证依据：

1. `docs/DIDA_CLI.md` 第 54 行明确注明：

   > **注意**：`dida task update --content` 是**覆盖式**写入（dida 无 append 子命令）。

2. `appendFocusRecordToTask` 实现中必须先 `getTask` 读取原 content，再拼接新 block，再整体写回——这本身就证明是覆盖式。

3. 若直接调用 `dida task update {{taskId}} --content "新内容"`，原任务备注会被完全替换为"新内容"。

---

## 6. 如何避免覆盖用户原任务内容

### 6.1 当前策略（已实现）

```
1. getTask(taskId)           → 拿到 task.content（原备注）
2. formatFocusRecord(record) → 生成新 block
3. content = 原 content + "\n\n" + block
4. task update --content content
```

### 6.2 仍然不安全的地方

- **读 → 写非原子**：步骤 1 和步骤 4 之间，用户在滴答端/App 端编辑该任务备注，步骤 4 会用步骤 1 的旧快照覆盖用户新编辑。
- **无 ETag / 版本号校验**：滴答 task 对象有 `modifiedTime`，但 FocusLink 当前没有用它做乐观锁。
- **无 diff 写入**：理想方案是用 `PATCH /tasks` 只追加字段，但 dida CLI / 官方 Open API 均不支持字段级 append。

### 6.3 改进建议（未实现）

1. **乐观锁**：读取时记录 `modifiedTime`，写入前再次 `getTask` 比对；若变化则中止并提示用户。
2. **长度截断**：当拼接后 content 超过阈值（如 32KB）时，截断旧备注或拒绝写入并报错。
3. **用户确认**：首次同步前弹窗预览最终 content，用户确认后才写入。
4. **备份**：写入前把原 content 备份到本地 `task_note_backup` 表，便于回滚。

以上 4 条**均未实现**，仅作为后续设计参考。

---

## 7. 本地 FocusLink 记录如何映射到 dida 云端

### 7.1 当前映射（仅备注同步通道）

```
FocusLink Segment
  ├─ sessionId         → 写入备注头部
  ├─ segmentId         → 写入备注头部
  ├─ taskTitle         → 写入备注
  ├─ startedAt         → 写入备注（ISO 时间）
  ├─ endedAt           → 写入备注（ISO 时间）
  ├─ activeElapsedMs   → 写入备注（人类可读时长）
  └─ note              → 写入备注
```

`formatFocusRecord(record)` 把上述字段拼成一段 Markdown 风格文本块，整体追加到任务 content。

### 7.2 理想映射（云端专注记录，未实现）

```
FocusLink Session   → dida focus record (aggregate)
  ├─ startedAt       → focus.start
  ├─ endedAt         → focus.end
  ├─ activeElapsedMs → focus.elapsed (专注时长)
  ├─ pauseElapsedMs  → (无对应字段，需备注携带)
  └─ taskId          → focus.taskId
```

问题：

1. dida focus record 的字段定义 FocusLink **未验证**（是否支持 pauseElapsedMs、是否支持 segment 级别记录、是否支持同一任务多条记录）。
2. dida `focus create` 的命令行参数 FocusLink **未实测**。
3. 即使能创建，也无法保证与滴答客户端显示的"专注记录"一致。

---

## 8. 同步失败如何回滚

### 8.1 当前行为

- `sync_queue` 表记录每条同步项的 `status` (`pending` / `synced` / `failed`)、`retryCount`、`lastError`。
- 失败时 `retryCount += 1`，达到 `MAX_RETRIES = 5` 后标记为 `failed`。
- **本地数据不会因同步失败而删除或回滚**——本地记录是 source of truth。
- **已写入云端的内容无法回滚**：`dida task update --content` 没有撤销接口，一旦覆盖写入，原 content 已被拼接后的内容替换。

### 8.2 风险

- 若步骤 4（写入）成功但步骤 1（读取）拿到的是过期快照，用户原备注已被覆盖，**无法恢复**。
- sync_queue 只追踪"是否执行过命令"，不追踪"命令是否造成了数据覆盖"。

### 8.3 改进建议（未实现）

1. 写入前备份原 content 到本地 `task_note_backup` 表。
2. 提供手动"恢复备注"按钮（仅能在备份后 7 天内恢复）。
3. 写入失败时不重试覆盖类操作，改为只追加新 block 到本地队列等待人工处理。

---

## 9. 同步队列如何设计

### 9.1 当前实现（已稳定）

```
sync_queue 表
  ├─ id (uuid)
  ├─ type ('segment-note' | 'session-note' | 'focus-record')
  ├─ payload (JSON: { segmentId?, sessionId?, taskId? })
  ├─ status ('pending' | 'synced' | 'failed')
  ├─ retryCount (0..5)
  ├─ lastError
  ├─ createdAt
  └─ updatedAt
```

- 入队：`enqueueSegmentSync(segmentId)` / `enqueueSessionSync(sessionId)`
- 去重：`findPendingPayload` 避免同一 segment 重复入队
- 执行：`runPending()` 串行处理所有 pending 项
- 重试：`retryItem(id)` 手动重置某项为 pending
- 本地模式：`syncMode === 'local-only'` 时直接跳过

### 9.2 设计原则

1. **本地优先**：所有记录先写 SQLite，再入队同步，失败不丢本地数据。
2. **串行执行**：避免并发覆盖。
3. **幂等性**：同一 segment 重复同步会追加多次备注（不幂等），但不会创建多条云端专注记录（因为压根没实现）。
4. **可观测**：每次执行记录 `lastError`，UI 可见。

### 9.3 未实现的队列能力

- 优先级（当前 FIFO）
- 退避策略（当前固定重试 5 次，无指数退避）
- 死信队列（`failed` 项只能手动 `retryItem`，无自动归档）
- 跨设备同步（队列只在本地 SQLite）

---

## 10. 是否需要用户手动确认

### 10.1 当前行为

- **备注同步**：需要用户在历史面板主动点击"同步到滴答备注"按钮，**不会自动执行**。
- **批量同步**：未实现批量自动同步，每个 segment 单独触发。
- **首次同步**：无额外确认弹窗（依赖用户主动点击即视为确认）。

### 10.2 建议策略（未实现）

1. **首次同步前**：弹窗预览最终 content，显示"将覆盖任务备注，原内容会保留在新内容开头"，用户确认后才写入。
2. **批量同步前**：弹窗显示"将同步 N 个专注片段到任务 X 的备注，可能产生较长文本"，用户确认。
3. **云端专注记录**（若未来实现）：必须默认关闭，用户在设置页显式开启"实验性云端专注记录"开关后方可使用，并在 UI 明确标注"实验性"。

---

## 11. 结论

### 11.1 当前版本（v0.2.0）能做什么

- ✅ 本地完整记录 Session / Focus Segment / Pause Event
- ✅ dida CLI 读取任务、清单
- ✅ 手动触发"同步到滴答备注"（先读后拼，覆盖式但有缓解）
- ✅ sync_queue 失败重试、本地不丢数据
- ✅ UI 明确显示"云端专注记录：未实现"

### 11.2 当前版本不能做什么

- ❌ 写入滴答云端"专注记录"（番茄钟模块）
- ❌ 回读云端专注记录
- ❌ 撤销已写入的任务备注
- ❌ 乐观锁防止 lost update
- ❌ 跨设备同步队列

### 11.3 为什么未实现

1. **无官方 API**：滴答官方 Open API 不提供专注记录写入能力。
2. **非官方接口不稳定**：V2/session API 需要 cookies，易失效，且违反 ToS 风险。
3. **dida focus 子命令未验证**：FocusLink 未实测 `dida focus create` 的字段语义与副作用。
4. **覆盖式写入风险**：`task update --content` 的 lost update 问题在未实现乐观锁前不适合自动化。
5. **用户数据安全优先**：在无法保证不覆盖用户原任务内容的前提下，不提供自动云端专注记录写入。

### 11.4 后续路线（不在 v0.2.0 范围）

1. 实测 `dida focus create --help` 输出，确认字段。
2. 小范围灰度：在设置页加"实验性云端专注记录"开关，默认关闭。
3. 实现乐观锁（基于 `modifiedTime`）。
4. 实现 content 备份表与恢复按钮。
5. 灰度收集失败率，确认稳定后再默认开启。

---

## 12. 相关文件

- 实现：[electron/tasks/cliProvider.ts](../electron/tasks/cliProvider.ts) — `appendFocusRecordToTask`
- 实现：[electron/providers/experimentalFocus.ts](../electron/providers/experimentalFocus.ts) — 占位骨架
- 实现：[electron/sync/syncService.ts](../electron/sync/syncService.ts) — sync_queue
- 类型：[shared/types.ts](../shared/types.ts) — `FocusRecord` / `SyncQueueItem`
- 文档：[DIDA_CLI.md](./DIDA_CLI.md) — dida CLI 集成说明
- 文档：[ARCHITECTURE.md](./ARCHITECTURE.md) — 同步服务在架构中的位置
