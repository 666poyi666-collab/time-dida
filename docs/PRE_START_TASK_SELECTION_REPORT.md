# 专注开始流程：先选任务再开始（v0.1.5）

> 本轮将专注启动流程从「先开始再关联」改为「先选任务再开始」的原子启动，
> 同时保留不选任务直接开始与中途关联的能力。

---

## 一、背景与问题

v0.1.4 及之前的启动流程偏向：

```
先开始专注 → 再关联任务
```

这会导致历史记录里出现「开始时无任务，后面才补关联」的脏状态：
- Session 创建时 `defaultTaskId = null`
- 第一个 Segment 创建时 `taskId = null`
- 用户开始后才点「关联到当前片段」补任务

不符合真实使用习惯：正常流程应该是先想好专注什么任务，再开始计时。

---

## 二、方案

### 2.1 idle 预选任务

TimerPanel 在 idle 状态新增「即将专注任务」预选区：

- **未选任务**：显示「尚未选择任务 · 点击选择」，点击打开 TaskPicker（`preselect` 模式）
- **已选任务**：显示「即将专注任务：xxx」+「更换任务」+「清除」按钮

预选任务仅保存在前端 state（`preSelectedTask`），不写库，不调用 IPC。
离开 idle 状态时自动清空（避免下次进入 idle 仍显示旧选择）。

### 2.2 原子启动 `startWithTask`

主进程新增 `timer:start-with-task` IPC，**不使用「先 start 再 link」的假逻辑**：

```ts
timer.startWithTask(taskId, taskSource, taskTitle?) : TimerSnapshot
```

启动时直接写入：
- `Session.defaultTaskId / defaultTaskSource / defaultTaskTitle` = 用户选择的任务
- 第一个 `Segment.taskId / taskSource / title` = 用户选择的任务

这样历史记录里**永远不会出现「开始时无任务」的脏状态**（当用户预选了任务时）。

### 2.3 不选任务也允许开始

若用户不预选任务直接点「开始专注」，走原 `timer.toggle()` → `start()` 路径：
- `Session.defaultTask = null`
- `Segment.task = null`

之后仍可：
- 专注中关联当前片段（`linkTask`）
- 设置本次专注默认任务（`linkSessionTask`）
- 结束后后补关联（HistoryPanel）
- 批量关联未关联片段（`linkSegmentsBatch`）

### 2.4 暂停后切换任务

`resume()` 创建新 Segment 时继承 `Session.defaultTask*`（v0.1.4 已实现，本轮保留）：

- 若 Session 有默认任务 → 新 Segment 自动继承
- 用户想换任务 → 当前 Segment 可单独 `linkTask` 改成其他任务

### 2.5 当前任务显示

TimerPanel 明确显示三个状态：

| 状态 | 显示 |
|------|------|
| idle 已预选 | 「即将专注任务：xxx」 |
| running/paused | 「当前片段任务：xxx」+ 「本次专注默认：xxx」（若不同） |

---

## 三、实现变更

### 3.1 后端 `electron/timer/manager.ts`

新增 `startWithTask(taskId, taskSource, taskTitle?)` 方法：

- 复用 `transition(state, 'START')` 状态机校验
- 创建 Session 时直接写入 `defaultTaskId/Source/Title`
- 创建第一个 Segment 后立即 `updateSegment` 写入 `taskId/Source/title`
- 原子性：Session + Segment + 任务关联在同一调用内完成，无中间脏状态

### 3.2 IPC `electron/ipc.ts`

新增 handler：

```ts
ipcMain.handle('timer:start-with-task', (_e, args) => {
  // local 任务支持反查 title
  return timer.startWithTask(args.taskId, args.taskSource, title);
});
```

### 3.3 Preload `electron/preload.ts`

暴露 API：

```ts
startWithTask: (taskId, taskSource, taskTitle?) =>
  ipcRenderer.invoke('timer:start-with-task', { taskId, taskSource, taskTitle })
```

### 3.4 类型 `shared/types.ts`

`TimerIPC` 新增：

```ts
'timer:start-with-task': (args: {
  taskId: string;
  taskSource: TaskSource;
  taskTitle?: string
}) => Promise<TimerSnapshot>;
```

### 3.5 前端 `src/components/TimerPanel.tsx`

- 新增 `preSelectedTask` state + `pickerMode: 'preselect'` 模式
- 新增 idle 预选任务 UI 区（已选/未选两种状态）
- `handleToggle` 在 idle + 有预选任务时调用 `startWithTask`，否则走 `toggle`
- 离开 idle 自动清空 `preSelectedTask`

---

## 四、历史记录场景验证（逻辑路径）

### 场景 A：先选任务再开始 ✅

```
idle → 预选任务 A → startWithTask(A)
  → Session.defaultTaskId = A
  → Segment 1.taskId = A
→ stop
→ 历史记录：Session 默认任务 = A，Segment 1 = A
```

### 场景 B：不选任务开始，中途关联 ✅

```
idle → toggle() (无预选)
  → Session.defaultTaskId = null
  → Segment 1.taskId = null
→ linkTask(segment1, A)
  → Segment 1.taskId = A
→ stop
→ 历史记录：Segment 1 = A
```

### 场景 C：不同片段不同任务 ✅

```
idle → startWithTask(A)
  → Session.defaultTaskId = A
  → Segment 1.taskId = A
→ pause → resume (new-segment)
  → Segment 2 继承 Session.defaultTaskId = A
→ linkTask(segment2, B)
  → Segment 2.taskId = B
→ stop
→ 历史记录：Segment 1 = A，Segment 2 = B
```

### 场景 D：结束后后补关联 ✅

```
idle → toggle() (无预选)
  → Segment 1.taskId = null
→ stop
→ 历史记录 → 选择 Segment 1 → TaskPicker → linkTask(segment1, A)
  → Segment 1.taskId = A
→ 历史记录立即显示 Segment 1 = A
```

---

## 五、验收对照

| 验收项 | 状态 |
|--------|------|
| idle 状态下可以先选择任务 | ✅ 预选任务 UI |
| 选择任务后再开始专注 | ✅ handleToggle 分流 |
| 开始后第一个 Segment 自动关联该任务 | ✅ startWithTask 原子写入 |
| Session 默认任务自动设置为该任务 | ✅ startWithTask 原子写入 |
| 不选任务也可以直接开始 | ✅ toggle() 路径保留 |
| 专注中仍可关联当前片段 | ✅ linkTask 保留 |
| 暂停后继续的新片段仍可换任务 | ✅ resume 继承 + linkTask 覆盖 |
| 历史记录能显示先选任务再开始的关联结果 | ✅ 场景 A 验证 |
