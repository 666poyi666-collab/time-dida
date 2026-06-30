# FocusLink - dida Provider 模板修复报告

生成时间：2026-06-29

## 一、之前为什么检测到 dida 却执行 ticktick

### 1.1 现象

设置页显示「探测到：dida」，但命令模板仍为：

```txt
ticktick tasks list --json
ticktick tasks search "{{query}}" --json
ticktick tasks note append "{{taskId}}" "{{content}}"
```

执行时报错：

```txt
'ticktick' is not recognized as an internal or external command
```

### 1.2 根因

1. **旧版本残留**：早期代码的 `DEFAULT_SETTINGS.ticktickCli` 使用的是 `ticktick` 命令模板。用户首次启动时保存了这套模板到 `settings.json`。
2. **探测与模板分离**：`detectCli()` 只负责探测可执行文件名（返回 `dida`），不会更新已保存的命令模板。即使探测到 dida，`ticktickCli.listTasksCommand` 仍是旧的 `ticktick tasks list --json`。
3. **deepMerge 不覆盖已存在值**：`settingsStore.getSettings()` 用 `deepMerge(DEFAULT_SETTINGS, saved)`，已保存的 `ticktick` 字符串会覆盖默认的 `dida` 字符串，所以默认值更新对老用户无效。
4. **Provider 类名误导**：`TickTickCliProvider` 类名含 "TickTick"，但实际是通用 CLI Provider，执行的是 `settings.ticktickCli` 里的命令模板。

### 1.3 任务来源切换失效的次要原因

`TaskPanel.tsx` 已按 `taskSource` 三路分发（local/cli/oauth），但当 `taskSource='ticktick-cli'` 时调用 `cli.listTasks()` 执行的是 `ticktick tasks list --json`，命令失败 → 右侧任务区显示「dida CLI 未连接」+ 错误。若用户未在设置里切换 `taskSource`（仍为 `local`），则右侧始终显示本地任务。

## 二、修复了哪些文件

| 文件 | 修改内容 |
|------|---------|
| `shared/types.ts` | 新增 `SettingsDomain` 类型、`LayoutConfig` 接口；`AppSettings` 新增 `layout` 字段 |
| `electron/tasks/cliProvider.ts` | 新增 `DIDA_DEFAULT_TEMPLATES`、`TICKTICK_DEFAULT_TEMPLATES`、`templatesContainTicktick()`、`applyDidaDefaults()`；`detectCli()` 探测到 dida 时若模板含 ticktick 字面量则自动迁移 |
| `electron/ipc.ts` | 新增 `cli:apply-dida-defaults`、`cli:get-current-provider` IPC handler；`settings:set` 按域分流副作用（`detectChangedDomains`）；只有 hotkeys 域变更才重新注册快捷键 |
| `electron/main.ts` | `onSettingsChanged` 回调改为接收 `(domains, next)`，按域分别处理：general→计时行为/自启/托盘，hotkeys→重新注册 |
| `electron/preload.ts` | 暴露 `cli.applyDidaDefaults()`、`cli.getCurrentProvider()` |
| `src/components/SettingsPanel.tsx` | 新增 provider 信息卡（当前 CLI 类型 / 可执行文件 / 路径 / 模板是否含 ticktick 警告）；新增「应用 dida 默认模板」按钮（应用后立即测试任务读取）；新增当前生效命令显示 |
| `src/components/App.tsx` | 可拖拽分割线（左 360px ~ 右 420px 限制，双击恢复默认，持久化到 `settings.layout.leftPaneWidth`）；导航激活态用 `nav-active` 类（accent 软背景） |
| `src/index.css` | 新增 `.nav-active`、`.progress-bar`、`.selected-accent`、`.state-dot-running` 等使用 accent 色的样式 |
| `tailwind.config.js` | 新增 `accent.soft` 颜色映射 |

## 三、dida 默认模板

```typescript
export const DIDA_DEFAULT_TEMPLATES: TickTickCliConfig = {
  executable: '',
  listTasksCommand: 'dida task filter --json',
  searchTasksCommand: 'dida task filter --json',
  getTaskCommand: 'dida task get {{projectId}} {{taskId}} --json',
  appendNoteCommand: 'dida task update {{taskId}} --content "{{content}}"',
  listProjectsCommand: 'dida project list --json',
  timeoutMs: 10000,
};
```

## 四、实际执行命令

修复后点击「测试读取任务」时实际执行：

```bash
dida task filter --json
```

点击「测试项目列表」时实际执行：

```bash
dida project list --json
```

不再执行 `ticktick tasks list --json`。

## 五、任务读取结果

修复后流程：

1. 设置页 → 任务来源 → 选择「滴答清单 CLI」
2. CLI 配置区显示「当前 CLI 类型：dida」「可执行文件：dida」
3. 若模板仍含 ticktick → 显示红色警告 + 「应用 dida 默认模板」按钮
4. 点击「应用 dida 默认模板」→ 写入 dida 模板 → 立即测试 `dida task filter --json`
5. 测试成功 → Toast「dida 任务读取成功：N 个任务」
6. 右侧任务区标题显示「dida CLI 已连接」
7. 任务列表显示真实 dida 任务（含子任务前缀 ↳）

## 六、右侧任务区是否显示任务

是。修复后：

- `taskSource='ticktick-cli'` 时，TaskPanel 调用 `cli.listProjects()` + `cli.listTasks()`
- `cli.listTasks()` 执行 `dida task filter --json` → 返回 JSON 数组
- `normalizeTasks()` 处理 status 数字字段（0=pending, 2=completed）、递归展开 items 子任务（前缀 ↳）、解析 dueDate
- 任务显示在右侧「滴答任务 (CLI)」分组下
- 失败时显示红色错误框 + Toast 具体原因

## 七、仍未解决的问题

1. **appendNoteCommand 覆盖式写入**：`dida task update --content` 是覆盖而非追加。当前版本按用户要求**暂不实现写回**，仅支持读取和关联。
2. **真正的搜索**：dida CLI 没有全文搜索命令，`searchTasksCommand` 与 `listTasksCommand` 相同，搜索靠客户端过滤。
3. **按清单筛选**：`listTasksCommand` 模板未带 `--projects {{projectId}}` 参数，切换清单下拉时不会按清单过滤（返回全部任务）。
4. **任务状态切换/创建/删除**：`dida task complete/create/delete` 未集成。

## 八、设置分域修复（附带修复 Bug 1）

切换主题色不再触发快捷键重注册：

```typescript
// electron/ipc.ts
ipcMain.handle('settings:set', (_e, settings) => {
  const prev = getSettings();
  const next = saveSettings(settings);
  const domains = detectChangedDomains(prev, next);  // 计算变更域
  onSettingsChanged(domains, next);  // 按域分流副作用
  ...
});

// electron/main.ts
registerIpc(timer, mainWindow, (domains, s) => {
  if (domains.includes('hotkeys')) {  // 只有 hotkeys 域变更才重新注册
    unregisterAll();
    registerAllHotkeys(s);
  }
  ...
});
```

变更域：`theme` / `hotkeys` / `miniWindow` / `taskProvider` / `layout` / `general`

## 九、验证步骤

1. 双击启动 FocusLink
2. 设置 → 外观 → 主题色 → 切换为「翠绿」
   - 导航激活按钮变绿色软背景
   - 头部 Logo 变绿色
   - 计时 running 状态徽章变绿色
   - **不再弹「快捷键注册失败」**
3. 设置 → 任务来源 → 选择「滴答清单 CLI」
4. CLI 配置区显示「当前 CLI 类型：dida」
5. 若显示红色 ticktick 警告 → 点击「应用 dida 默认模板」
6. Toast「dida 任务读取成功：N 个任务」
7. 切换到计时页 → 右侧任务区显示「dida CLI 已连接」+ 任务列表
8. 拖动中间分割线 → 左右宽度实时变化
9. 双击分割线 → 恢复默认比例
10. 重启应用 → 分栏宽度保留
