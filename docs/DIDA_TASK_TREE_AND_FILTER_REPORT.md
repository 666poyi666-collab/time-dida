# FocusLink - dida 任务树与过滤修复报告

生成时间：2026-06-29

## 一、问题背景

修复前用户反馈：

1. 已完成任务被显示在任务列表里
2. 父子任务用 `↳` 箭头堆在标题前，看起来很乱
3. 没有真正的任务树结构
4. 不能折叠 / 展开子任务

## 二、dida CLI 真实 JSON 结构（实测）

执行 `dida task filter --json` 返回的数组结构（关键字段）：

```json
{
  "id": "6a301960e4b004ec593210a9",
  "projectId": "6a30195ee4b029b3840a56ee",
  "sortOrder": -1781537104,
  "title": "Day2 — 2.3.1.1 斜二测 / 2.3.1.2 柱锥球台结构",
  "content": "...",
  "priority": 0,
  "completedTime": "2026-06-24T05:45:26.384+0000",
  "status": 2,
  "items": [
    {
      "id": "6a3b6e9ae4b09410f81e531a",
      "status": 1,
      "title": "2.3.1.1 斜二测",
      "sortOrder": 0
    },
    {
      "id": "6a3b6e9ae4b09410f81e531b",
      "status": 1,
      "title": "2.3.1.2 柱锥球台结构",
      "sortOrder": 0
    }
  ],
  "kind": "CHECKLIST",
  "modifiedTime": "2026-06-24T05:45:26.386+0000",
  "createdTime": "2026-06-15T15:25:20.674+0000"
}
```

### 关键发现

| 字段 | 含义 |
|------|------|
| `status` | 0=未完成，1=进行中，2=已完成 |
| `completedTime` | 已完成时间字符串，非空即已完成 |
| `items` | 子任务数组（嵌套结构，**非 parentId 引用**） |
| `sortOrder` | dida 排序字段，数值越小越靠前（通常为负数） |
| `priority` | 0=无，1=低，3=中，5=高 |
| `dueDate` | ISO 字符串 |

**dida 不用 parentId**，而是用 `items[]` 嵌套数组表达父子关系。所以归一化时要递归处理 items 数组，构建 `children: Task[]` 树。

## 三、修复内容

### 3.1 Task 类型扩展（shared/types.ts）

```typescript
export interface Task {
  // ... 原有字段
  parentId?: string | null;     // 父任务 ID（归一化时填充）
  children?: Task[];           // 子任务树（dida items[] 归一化）
  isCompleted?: boolean;       // 是否已完成
  sortOrder?: number | null;  // dida 排序字段
}
```

### 3.2 normalizeTasks 重写（electron/tasks/cliProvider.ts）

```typescript
function normalizeTasks(raw: unknown[], parentId?: string): Task[] {
  // status 数字归一化：0=pending, 1=in-progress, 2=completed
  // completedTime 非空也视为 completed
  // 递归处理 items[] → children[]
  // 子任务继承父任务的 projectId
  // 不再向 title 前加 ↳ 前缀
}
```

关键改动：

1. **不再污染标题**：移除 `st.title = '↳ ' + st.title` 这行
2. **构建 children 树**：递归调用 `normalizeTasks(obj.items, id)`，结果放到 `children` 字段
3. **填充 parentId**：子任务的 `parentId` 设为父任务 id
4. **派生 isCompleted**：`status === 2 || completedTime 非空`
5. **保留 sortOrder**：用于稳定排序

### 3.3 TaskPanel 重写（src/components/TaskPanel.tsx）

完整重写右侧任务区：

#### 默认隐藏已完成

```typescript
const [showCompleted, setShowCompleted] = useState(false); // 默认 false

// 过滤逻辑
const passCompletedFilter = showCompleted || !t.isCompleted;
if (!passCompletedFilter) continue;
```

#### 显示已完成开关

```tsx
<button onClick={() => setShowCompleted(v => !v)}>
  {showCompleted ? <Eye/> : <EyeOff/>}
  {showCompleted ? '已显示已完成任务' : '已隐藏已完成任务'}
</button>
{completedHidden > 0 && !showCompleted && (
  <span>已隐藏 {completedHidden} 个已完成任务</span>
)}
```

#### 任务树 UI（TaskTreeItem 递归组件）

```tsx
function TaskTreeItem({ task, depth, collapsed, ... }) {
  return (
    <>
      <div style={{ marginLeft: depth * 18 }}>
        {/* 折叠/展开按钮 */}
        <button onClick={() => onToggleCollapse(task.id)}>
          {hasChildren ? (isCollapsed ? <ChevronRight/> : <ChevronDown/>) : <span/>}
        </button>
        {/* 完成状态图标 */}
        {isCompleted ? <CheckCircle/> : <Circle/>}
        {/* 标题 + 元信息 */}
        <p className={isCompleted ? 'line-through opacity-50' : ''}>
          {task.title}
        </p>
        {/* 子任务数 / 截止日期 / 优先级 */}
        {/* 操作按钮：关联片段 / 设为会话 */}
      </div>
      {/* 子任务递归 */}
      {hasChildren && !isCollapsed && (
        task.children.map(child => <TaskTreeItem depth={depth+1} .../>)
      )}
    </>
  );
}
```

#### 折叠展开状态记忆

```typescript
const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
const toggleCollapse = (taskId: string) => {
  setCollapsed(prev => ({ ...prev, [taskId]: !prev[taskId] }));
};
```

#### 搜索时自动展开匹配父任务

```typescript
useEffect(() => {
  if (!query.trim()) return;
  const next = { ...collapsed };
  const expandMatching = (tasks: Task[]) => {
    for (const t of tasks) {
      if (t.children?.length > 0) {
        const childMatch = t.children.some(c => c.title.toLowerCase().includes(query.toLowerCase()));
        const selfMatch = t.title.toLowerCase().includes(query.toLowerCase());
        if (childMatch || selfMatch) {
          next[t.id] = false; // 展开
        }
        expandMatching(t.children);
      }
    }
  };
  expandMatching(ticktickTasks);
  setCollapsed(next);
}, [query]);
```

#### 排序规则

```typescript
// 1. 未完成在前
if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
// 2. 有截止日期优先
if (a.dueDate && !b.dueDate) return -1;
// 3. 按 dida sortOrder（更小的负值更靠前）
if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
// 4. 按 priority 降序
return (b.priority ?? 0) - (a.priority ?? 0);
```

### 3.4 已完成任务的视觉弱化

```tsx
<div className={isCompleted ? 'opacity-50' : ''}>
  <p className={isCompleted ? 'text-fg-subtle line-through' : 'text-fg font-semibold'}>
    {task.title}
  </p>
</div>
<CheckCircle className="text-emerald-500/70" />
```

- 灰色文字（`text-fg-subtle`）
- 标题加删除线（`line-through`）
- 透明度降低（`opacity-50`）
- 完成图标（`CheckCircle`）
- 已完成任务排在列表末尾

## 四、验收对照

| 验收项 | 状态 |
|--------|------|
| dida 任务默认不显示已完成任务 | ✅ `showCompleted` 默认 false，过滤 `!t.isCompleted` |
| 可以打开"显示已完成任务" | ✅ Eye/EyeOff 切换按钮 |
| 已完成任务有弱化样式 | ✅ line-through + opacity-50 + 灰色 + CheckCircle |
| 父子任务以树结构显示 | ✅ TaskTreeItem 递归 + depth*18 缩进 |
| 不再用难看的箭头污染标题 | ✅ 移除 ↳ 前缀，改用缩进 + 折叠箭头 |
| 父任务可折叠/展开 | ✅ ChevronRight/ChevronDown 切换 |
| 搜索时能找到子任务 | ✅ 搜索匹配保留父链 |
| 搜索时自动展开匹配父任务 | ✅ useEffect 监听 query 自动展开 |
| 子任务可单独关联到 Segment | ✅ 每个子任务都有 Link2 按钮 |
| 已完成任务数量统计 | ✅ "已隐藏 N 个已完成任务" |

## 五、仍未解决的问题

1. **`appendNoteCommand` 覆盖式写入**：dida `task update --content` 是覆盖而非追加。本轮按用户要求**不实现写回**。
2. **真正的搜索**：dida CLI 无全文搜索命令，`searchTasksCommand` 与 `listTasksCommand` 相同，搜索靠客户端标题过滤。
3. **按清单筛选**：`listTasksCommand` 模板未带 `--projects {{projectId}}` 参数，切换清单下拉时返回全部任务（未按清单过滤）。
4. **折叠状态持久化**：当前折叠状态只在内存中，重启后重置。可考虑持久化到 localStorage。
5. **任务状态切换**：dida `task complete` 未集成，无法在 FocusLink 内标记完成。
