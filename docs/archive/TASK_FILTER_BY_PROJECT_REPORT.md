# dida 清单筛选任务报告（v0.1.4）

## 1. 目标

用户选择清单后，任务区只显示该清单下的任务；搜索只在当前清单范围内生效；保留父子结构；空清单显示友好空状态。

## 2. 实现方案

### 2.1 数据来源
- dida CLI `dida project list --json` 返回项目列表，归一化为 `Project[]`（含 `externalId` / `name`）
- dida CLI `dida task filter --json` 返回任务，`cliProvider.normalizeTasks` 已处理 `projectId` 字段，且**子任务继承父任务 projectId**（子任务自身无 projectId 时回填父值）

### 2.2 本地过滤（不依赖 CLI 参数）
dida CLI 没有稳定的项目过滤参数，采用本地过滤。

`TaskPanel.tsx` 的 `filterAndBuildTree(tasks, query, projectId, showCompleted)`：
1. **第一步**：按 projectId 过滤 → `filterTreeByProject(tasks, projectId)`
2. **第二步**：按已完成过滤 + 搜索匹配（保留父链）

### 2.3 父子任务过滤规则
```ts
function filterTreeByProject(tasks: Task[], projectId: string): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    const children = t.children ? filterTreeByProject(t.children, projectId) : [];
    const selfMatch = t.projectId === projectId;
    if (selfMatch || children.length > 0) {
      out.push({ ...t, children: children.length > 0 ? children : undefined });
    }
  }
  return out;
}
```
- 父任务属于该清单 → 保留父任务及其子任务
- 子任务属于该清单但父任务未命中 → 仍保留父链（避免子任务孤立）
- 子任务无 projectId 时由 `cliProvider.normalizeTasks` 继承父值

### 2.4 清单下拉框
- 位置：`TaskPanel.tsx` 状态卡内（搜索框上方）
- 数据源：`ticktickProjects`（来自 `cli.listProjects()` 或 `ticktick.listProjects()`）
- 仅在非 local 任务源且有项目时显示
- 选项：「所有清单」+ 各项目 `name`
- 切换时：`setSelectedProject` + `setTimeout(() => handleRefresh(), 0)` 重新拉取（CLI 支持传 projectId 给 `listTasks`）

### 2.5 搜索范围
- 搜索框 query 在 `filterAndBuildTree` 第二步与 projectId 过滤后的结果上叠加 → **搜索只在当前清单范围内**
- 搜索时仍保留父链（子任务匹配则展开父任务，由 v0.1.3 已实现的 `expandMatching` 逻辑处理）

## 3. UI 显示

### 3.1 状态卡描述
选择清单后，状态卡副标题显示：
```
当前清单：xxx · 共 N 个任务
```
- `currentProjectName` memo：从 `ticktickProjects` 查找 `externalId === selectedProject`
- `currentProjectTaskCount` memo：递归统计 `sourceTasks` 中 `projectId === selectedProject` 的任务数（含子任务）

### 3.2 空状态
当 `filteredTree.length === 0` 且 `selectedProject && currentProjectTaskCount === 0` 时显示：
```
当前清单暂无未完成任务
该清单下没有未完成任务，可切换为"所有清单"查看全部
```

### 3.3 标题区域
状态卡顶部标题保持「dida CLI 已连接」，副标题动态切换：
- 未选清单：「通过命令行同步滴答清单」
- 选了清单：「当前清单：xxx · 共 N 个任务」

## 4. 验收标准对照

| # | 验收标准 | 实现 |
| --- | --- | --- |
| 1 | 清单下拉框能显示 dida project list 的清单 | ✅ `ticktickProjects` 渲染 `<select>` |
| 2 | 选择"所有清单"显示全部任务 | ✅ `selectedProject=''` 时不过滤 |
| 3 | 选择某个清单只显示该清单任务 | ✅ `filterTreeByProject` 递归过滤 |
| 4 | 已完成任务仍默认隐藏 | ✅ `showCompleted` 默认 false，`isCompleted` 任务被过滤 |
| 5 | 搜索在当前清单范围内搜索 | ✅ `filterAndBuildTree` 第二步在 projectId 过滤后结果上叠加 query |
| 6 | 子任务不丢失 | ✅ `filterTreeByProject` 保留父链 + cliProvider 子任务继承父 projectId |
| 7 | 父子结构不被破坏 | ✅ 递归保留 children 树结构 |
| 8 | 空清单显示友好空状态 | ✅ 空状态文案 + 切换提示 |

## 5. 涉及文件
- `src/components/TaskPanel.tsx`：清单下拉框 + 状态卡显示 + 空状态 + `filterTreeByProject`
- `src/components/TaskPicker.tsx`：复用相同过滤逻辑（`filterTree` 内部调用 `filterTreeByProject`）
- `electron/tasks/cliProvider.ts`：`normalizeTasks` 子任务继承父 projectId（v0.1.3 已实现，未改动）

## 6. 备注
- 本轮未修改 CLI Provider，过滤完全在前端本地完成
- `TaskPicker`（可复用任务选择器）也实现了相同的清单过滤，保证行为一致
