# 专注历史与任务关联报告（v0.1.4）

## 1. 目标

解决"专注记录如何关联到任务"的核心问题，覆盖以下场景：
- a. 专注进行中关联任务到当前 Segment
- b. 设置 Session 默认任务
- c. 暂停后继续时新 Segment 继承 Session 默认任务
- d. 不同 Segment 可关联不同任务
- e. 历史记录显示每个 Segment 的关联任务
- f. 历史记录可后补关联
- g. 批量把未关联 Segment 关联到某任务

**本轮不写回 dida 任务备注**（dida task update --content 是覆盖式风险）。

## 2. 数据模型

### 2.1 复用现有 schema
不推倒重来，仍使用 `Session / Segment / PauseEvent / Task`。

### 2.2 Segment 关联字段（已有，未改动）
`focus_segments` 表：`task_id` / `task_source` / `title`（关联任务标题冗余存储）

### 2.3 Session 默认任务字段（新增）
`focus_sessions` 表新增 `default_task_title TEXT` 列（幂等迁移）：
```ts
function runMigrations(database: Database.Database): void {
  const hasCol = (table, col) => database.pragma(`table_info(${table})`).some(r => r.name === col);
  if (!hasCol('focus_sessions', 'default_task_title')) {
    database.exec('ALTER TABLE focus_sessions ADD COLUMN default_task_title TEXT');
  }
}
```
- `default_task_id` / `default_task_source` 已在 v0.1.3 schema 中存在
- `default_task_title` 是冗余存储，避免运行时反查 dida CLI

### 2.4 TimerSnapshot 扩展
新增字段用于渲染层高亮：
```ts
interface TimerSnapshot {
  // ... 已有字段
  sessionDefaultTaskId: string | null;      // Session 默认任务 id（任务区高亮"本次默认"）
  sessionDefaultTaskTitle: string | null;   // Session 默认任务标题（TimerPanel 显示）
}
```

## 3. 后端实现（TimerManager）

### 3.1 关联到当前片段
```ts
linkSegmentTask(segmentId, taskId, taskSource, taskTitle?) {
  seg.taskId = taskId;
  seg.taskSource = taskSource;
  if (taskTitle != null) seg.title = taskTitle;
  updateSegment(seg);
  // 同步 currentSegment 内存引用
}
```

### 3.2 设为 Session 默认任务
```ts
linkSessionTask(sessionId, taskId, taskSource, taskTitle?) {
  session.defaultTaskId = taskId;
  session.defaultTaskSource = taskSource;
  session.defaultTaskTitle = taskTitle ?? null;
  updateSession(session);
  // 若当前 segment 未单独指定，则同步关联
  if (currentSegment && !currentSegment.taskId) {
    currentSegment.taskId = taskId;
    currentSegment.taskSource = taskSource;
    if (taskTitle) currentSegment.title = taskTitle;
    updateSegment(currentSegment);
  }
}
```

### 3.3 暂停后继续 → 新 Segment 继承默认任务
`resume()` 中创建新 Segment 后：
```ts
if (this.session.defaultTaskId && this.session.defaultTaskSource) {
  seg.taskId = this.session.defaultTaskId;
  seg.taskSource = this.session.defaultTaskSource;
  if (this.session.defaultTaskTitle) seg.title = this.session.defaultTaskTitle;
  updateSegment(seg);
}
```
- 用户仍可手动改当前 Segment 的任务（调用 `linkSegmentTask` 覆盖）
- 若 Session 无默认任务，则新 Segment 为空任务

### 3.4 清除关联
- `clearSegmentTask(segmentId)`：清空 `taskId / taskSource / title`
- `clearSessionDefaultTask(sessionId)`：清空 `defaultTaskId / defaultTaskSource / defaultTaskTitle`（不影响已关联的 segment）

### 3.5 批量关联
```ts
linkSegmentsBatch(sessionId, taskId, taskSource, taskTitle, onlyUnlinked): number {
  const segs = listSegments(sessionId);
  let count = 0;
  for (const seg of segs) {
    if (onlyUnlinked && seg.taskId) continue;  // 已关联的跳过
    seg.taskId = taskId;
    seg.taskSource = taskSource;
    if (taskTitle != null) seg.title = taskTitle;
    updateSegment(seg);
    count++;
  }
  // 同步更新 session 默认任务（便于后续新建 segment 继承）
  if (count > 0) {
    session.defaultTaskId = taskId;
    session.defaultTaskSource = taskSource;
    session.defaultTaskTitle = taskTitle;
    updateSession(session);
  }
  return count;
}
```

### 3.6 快照返回值
`getSnapshot()` 新增：
```ts
sessionDefaultTaskId: this.session?.defaultTaskId ?? null,
sessionDefaultTaskTitle: this.session?.defaultTaskTitle ?? null,
```
`currentTaskTitle` 优先取 `currentSegment.title`，否则 fallback 到 `session.defaultTaskTitle`。

## 4. IPC + Preload

| IPC 通道 | Preload API | 说明 |
| --- | --- | --- |
| `timer:link-task` | `timer.linkTask(segmentId, taskId, taskSource, taskTitle?)` | 关联到当前片段 |
| `timer:link-session-task` | `timer.linkSessionTask(sessionId, taskId, taskSource, taskTitle?)` | 设为 Session 默认 |
| `timer:clear-segment-task` | `timer.clearSegmentTask(segmentId)` | 清除片段关联 |
| `timer:clear-session-default-task` | `timer.clearSessionDefaultTask(sessionId)` | 清除 Session 默认 |
| `timer:link-segments-batch` | `timer.linkSegmentsBatch(sessionId, taskId, taskSource, taskTitle, onlyUnlinked)` | 批量关联 |

IPC handler 中对 local 任务保留 fallback：未传 taskTitle 时从 `LocalTaskProvider.getById` 反查标题。dida 任务无反查，必须由前端传 taskTitle。

## 5. 前端实现

### 5.1 可复用 TaskPicker 组件
`src/components/TaskPicker.tsx`：
- 搜索 + 选择清单 + 隐藏已完成 + 任务树 + 点击确认 / 取消
- 内部复用 `filterTree` / `filterTreeByProject`（与 TaskPanel 一致）
- 用于：当前 Segment 关联、Session 默认任务、历史后补关联、批量补关联

### 5.2 TaskPanel 任务区高亮
`TaskPanel.tsx` 的 `TaskTreeItem` 新增两个高亮标识：
- **当前片段**（`currentSegmentTaskId === task.id`）：accent 色 pill
- **本次默认**（`sessionDefaultTaskId === task.id`）：emerald 色 pill

`currentSegmentTaskId` 从 `snapshot.segments` 中查找 `currentSegmentId` 对应的 `taskId`（区别于 `currentTaskId` 的 fallback 合并值）。

每个任务 hover 时仍显示「关联」/「会话」操作按钮，分别调用 `linkTask` / `linkSessionTask` 并传 `task.title`。

### 5.3 TimerPanel 当前专注区
`TimerPanel.tsx` 在专注进行中（running / paused）显示：
- **当前片段任务卡片**：有任务时显示标题 + 清除按钮；无任务时显示「未关联任务 · 点击选择」触发 TaskPicker
- **Session 默认任务卡片**：仅在设置了默认任务且与当前片段任务不同时显示
- **设为默认快捷入口**：当前片段已关联但未设默认时，提供「设为本次专注默认任务」按钮

TaskPicker 通过 `pickerMode` 状态区分 segment / session 目标。

### 5.4 HistoryPanel 历史记录
`HistoryPanel.tsx` 每条 Session 展开后显示：

1. **时间统计**：专注 / 暂停 / 总跨度
2. **Session 默认任务卡片**：
   - 显示当前默认任务标题（或「未设置」）
   - 「设置 / 更换」按钮 → TaskPicker（session-default 模式）
   - 「清除」按钮（已有默认任务时）
3. **批量操作**：
   - 「批量补关联未关联片段」→ TaskPicker（batch-unlinked 模式，onlyUnlinked=true）
   - 「全部片段改为同一任务」→ TaskPicker（batch-all 模式，onlyUnlinked=false）
4. **片段列表**（`SegmentRow` 组件）：
   - 时间区间 + 专注时长
   - 任务标题（已关联）或「未关联任务」
   - 已关联：「更换任务」「清除关联」
   - 未关联：「关联任务」（primary 按钮）→ TaskPicker（segment 模式）
5. **暂停列表** + **导出 / 删除**

所有关联操作完成后调用 `reloadDetail(expanded)` 刷新详情，UI 立即更新。

## 6. 验收场景对照

### 场景 A：专注中关联任务
| 步骤 | 实现 |
| --- | --- |
| 开始专注 | `timer.toggle()` → start() 创建 session + segment |
| 选择 dida 任务 A | TimerPanel「未关联任务 · 点击选择」→ TaskPicker |
| 点击「关联到当前片段」 | `timer.linkTask(segmentId, A.id, A.source, A.title)` |
| 当前 Segment 显示任务 A | snapshot.currentSegment.title = A.title → TaskCard 显示 |
| 结束专注 | `timer.stop()` |
| 历史记录中 Segment 1 显示任务 A | `sessions.get` 返回 segments[].title = A.title |

### 场景 B：Session 默认任务继承
| 步骤 | 实现 |
| --- | --- |
| 开始专注 + 设任务 A 为默认 | `linkSessionTask` → session.defaultTask* 写入 |
| 暂停 | `pause()` |
| 继续 | `resume()` 创建新 segment，继承 session.defaultTask* |
| Segment 2 自动继承任务 A | resume() 中 `seg.taskId = session.defaultTaskId` |
| 历史 Segment 1 + 2 都显示 A | segments 查询返回 |

### 场景 C：不同 Segment 关联不同任务
| 步骤 | 实现 |
| --- | --- |
| Segment 1 关联 A | `linkTask(seg1, A)` |
| 暂停 + 继续 | 新 Segment 2 继承默认 A |
| 手动改 Segment 2 为 B | `linkTask(seg2, B)` 覆盖 |
| 历史 Segment 1 → A, Segment 2 → B | ✅ |

### 场景 D：专注完成后补关联
| 步骤 | 实现 |
| --- | --- |
| 开始专注不关联 | segment.taskId = null |
| 结束 | stop() |
| 历史记录 → 该 Session 详情 | 展开显示 SegmentRow「未关联任务」 |
| 点击「关联任务」 | TaskPicker → `linkTask(segId, A)` |
| 历史立刻显示 Segment → A | `reloadDetail` 刷新 |

### 场景 E：批量补关联
| 步骤 | 实现 |
| --- | --- |
| Session 有多个未关联 Segment | segments[].taskId = null |
| 点击「批量补关联未关联片段」 | TaskPicker → `linkSegmentsBatch(sessionId, A, onlyUnlinked=true)` |
| 所有未关联 Segment 更新为 A | onlyUnlinked 跳过已关联 |
| 已关联 Segment 不被覆盖 | ✅ |

## 7. 验收标准对照

| # | 验收标准 | 实现 |
| --- | --- | --- |
| 5 | 专注中可以把当前 Segment 关联到任务 | ✅ TimerPanel + TaskPicker |
| 6 | 专注中可以设置本次 Session 默认任务 | ✅ linkSessionTask |
| 7 | 新 Segment 可以继承 Session 默认任务 | ✅ resume() 继承逻辑 |
| 8 | 不同 Segment 可以关联不同任务 | ✅ linkTask 覆盖 |
| 9 | 历史记录能显示每个 Segment 的关联任务 | ✅ SegmentRow |
| 10 | 历史记录里可以后补关联任务 | ✅ TaskPicker segment 模式 |
| 11 | 可以批量把未关联 Segment 关联到某任务 | ✅ linkSegmentsBatch onlyUnlinked=true |
| 12 | 本轮不写回 dida 任务内容 | ✅ 仅本地 DB 操作，不调用 appendNoteCommand |

## 8. 涉及文件
- `shared/types.ts`：`FocusSession.defaultTaskTitle`、`TimerSnapshot.sessionDefaultTaskId/Title`、IPC 类型
- `electron/db/index.ts`：幂等迁移 + Session CRUD 含 default_task_title
- `electron/timer/manager.ts`：linkSegmentTask / linkSessionTask / clearSegmentTask / clearSessionDefaultTask / linkSegmentsBatch + resume 继承 + getSnapshot 新字段
- `electron/ipc.ts`：5 个 IPC handler
- `electron/preload.ts`：timer API 暴露
- `src/components/TaskPicker.tsx`：可复用任务选择器（新建）
- `src/components/TaskPanel.tsx`：高亮当前片段 / 本次默认 + handleLink 传 title
- `src/components/TimerPanel.tsx`：当前片段 / 默认任务卡片 + TaskPicker 入口 + 清除按钮
- `src/components/HistoryPanel.tsx`：Segment 任务显示 + 后补关联 + 批量关联 + Session 默认任务管理

## 9. 设计决策
- **不写回 dida**：本轮仅本地关联，避免 `dida task update --content` 覆盖风险；写回备注的安全追加版本后续单独做
- **冗余存储 taskTitle**：避免运行时反查 dida CLI（CLI 无 getTask 稳定返回），前端关联时必须传 title
- **currentSegmentTaskId 独立计算**：snapshot.currentTaskId 是 fallback 合并值（segment → session default），无法区分高亮；改为从 segments 数组反查 currentSegmentId 对应的 taskId
