# 任务树 / TaskPicker 默认折叠统一（v0.1.5）

> 本轮将所有任务树组件统一为「父任务默认折叠」，修复任务关联流程里任务树默认展开导致混乱的问题。

---

## 一、背景与问题

v0.1.4 主任务区（TaskPanel）已默认折叠父任务，但任务关联流程里的任务树仍默认展开：

```
当前片段关联任务
设置本次默认任务
历史记录后补关联
批量关联任务
TaskPicker 选择任务
TimerPanel 任务选择器
```

任务一多，打开选择器就展开全部子任务，列表很长很乱。

---

## 二、统一规则

所有任务树组件遵循同一套规则：

```
1. 父任务（有 children）默认折叠
2. 点击父任务箭头才展开
3. 搜索命中子任务时自动展开父任务
4. 清空搜索后恢复搜索前折叠状态（不是全部展开）
5. 已完成任务仍默认隐藏
```

---

## 三、实现

### 3.1 共享工具 `src/components/taskTreeState.ts`

抽出统一函数（供所有任务树组件复用）：

```ts
/** 为所有有 children 的父任务初始化为折叠状态 */
createDefaultCollapsedState(tasks): Record<string, boolean>

/** 对新出现的父任务初始化折叠（不覆盖用户已手动展开/折叠的状态） */
initNewParentsCollapsed(prev, tasks): Record<string, boolean>

/** 搜索时展开包含匹配项的父任务 */
expandMatchingParents(prev, tasks, query): Record<string, boolean>
```

### 3.2 TaskPicker 默认折叠

`src/components/TaskPicker.tsx` 新增两个 `useEffect`：

**① 任务列表变化时初始化父任务折叠**

```ts
useEffect(() => {
  setCollapsed((prev) => {
    // 对 children.length > 0 且未在 prev 中出现的父任务，设为 true
    // 不覆盖用户已手动操作的折叠状态
  });
}, [localTasks, ticktickTasks]);
```

**② 搜索时自动展开匹配父任务 + 清空恢复**

```ts
useEffect(() => {
  const q = query.trim();
  if (!q) {
    // 清空搜索 → 恢复 beforeSearchRef 快照
    if (beforeSearchRef.current !== null) {
      setCollapsed(beforeSearchRef.current);
      beforeSearchRef.current = null;
    }
    return;
  }
  // 进入搜索 → 首次保存快照
  if (beforeSearchRef.current === null) {
    beforeSearchRef.current = { ...collapsed };
  }
  // 展开包含匹配子任务的父任务
  const next = { ...collapsed };
  expandMatching(tasks, q);
  setCollapsed(next);
}, [query]);
```

### 3.3 覆盖范围

TaskPicker 是所有任务关联流程的统一入口，因此修改 TaskPicker 即覆盖：

| 场景 | 调用方 | 是否覆盖 |
|------|--------|---------|
| 当前片段关联任务 | TimerPanel (`pickerMode='segment'`) | ✅ TaskPicker |
| 设置本次默认任务 | TimerPanel (`pickerMode='session'`) | ✅ TaskPicker |
| idle 预选任务 | TimerPanel (`pickerMode='preselect'`) | ✅ TaskPicker |
| 历史记录后补关联 | HistoryPanel (`target.kind='segment'`) | ✅ TaskPicker |
| 批量关联未关联片段 | HistoryPanel (`target.kind='batch-unlinked'`) | ✅ TaskPicker |
| 批量关联全部片段 | HistoryPanel (`target.kind='batch-all'`) | ✅ TaskPicker |
| 右侧 TaskPanel | TaskPanel（v0.1.4 已实现） | ✅ 已有 |

---

## 四、关键设计点

### 4.1 不覆盖用户操作

`initNewParentsCollapsed` 只对 `next[id] === undefined` 的父任务初始化折叠。
用户手动展开/折叠过的任务不会被列表刷新覆盖。

### 4.2 搜索快照恢复

- 进入搜索（query 非空）时，**首次**保存当前折叠状态到 `beforeSearchRef`
- 搜索期间展开匹配父任务，不影响其他父任务状态
- 清空搜索时恢复快照，而不是全部展开

### 4.3 递归处理嵌套

`expandMatching` 递归遍历子任务树，支持多级嵌套：
- 父任务的子任务匹配 → 展开父任务
- 继续递归子任务的子任务

---

## 五、验收对照

| 验收项 | 状态 |
|--------|------|
| 打开 TaskPicker，父任务默认折叠 | ✅ |
| 打开历史记录后补关联任务选择器，父任务默认折叠 | ✅ |
| 打开批量关联任务选择器，父任务默认折叠 | ✅ |
| 搜索子任务时父任务自动展开 | ✅ |
| 清空搜索后恢复默认折叠 | ✅ |
| 已完成任务仍默认隐藏 | ✅ |
| TypeScript 编译通过 | ✅ |
