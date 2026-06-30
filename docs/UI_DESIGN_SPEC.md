# FocusLink UI Design Spec

## 1. Direction

FocusLink is a compact desktop focus ledger: the UI should make it clear which task each focus segment belongs to. The redesign uses a quiet tool style inspired by Raycast, Linear, TickTick, and the supplied Doubao token kit: compact spacing, border-led separation, restrained shadows, and clear state badges.

## 2. Design Tokens

Core tokens live in `src/index.css` under the `--app-*` namespace:

- `--app-bg`, `--app-surface`, `--app-surface-2`, `--app-elevated`
- `--app-text`, `--app-muted`, `--app-subtle`
- `--app-border`, `--app-border-strong`, `--app-border-subtle`
- `--app-accent`, `--app-accent-hover`, `--app-accent-soft`, `--app-accent-fg`
- `--app-success`, `--app-warning`, `--app-danger`, `--app-info`
- `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`
- `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-glow`

Legacy Tailwind variables such as `--bg-base`, `--fg-default`, and `--accent` remain as aliases so existing components keep working.

## 3. Typography

- Sans: Inter, Microsoft YaHei UI, HarmonyOS Sans SC, PingFang SC, system UI.
- Timer digits: Inter Tight with tabular numerals.
- Timer digit rule: `font-variant-numeric: tabular-nums` and `font-feature-settings: "tnum"`.
- Letter spacing stays neutral for readable Chinese and stable timer digits.

## 4. Component Rules

- Cards use 8px radius through `.card`; floating/shadow-heavy cards are avoided.
- Buttons use icon-leading controls where possible: primary, outline, and ghost variants.
- Inputs use border and focus ring rather than heavy elevation.
- Status chips use soft accent backgrounds and explicit labels like `[当前片段]`, `[本次默认]`, `[已完成]`, `[子任务 N]`.

## 5. Main Window

- The app shell uses a compact top navigation and a bordered work surface.
- Timer pane has a fixed safe maximum width, preventing old saved layouts from clipping the task tree.
- Idle state explicitly shows the upcoming focus task selection:
  - no task: `尚未选择任务 · 点击选择`
  - task selected: `即将专注任务`
  - direct start remains available through the main start button.
- Running/paused state keeps separate surfaces for current segment task and session default task.

## 6. Mini Window Modes

- Expanded: status, large timer, current task, progress, start/pause, stop, collapse, open main window.
- Compact: status dot, timer, short task label, start/pause, stop. The layout is flow-based so the two action buttons stay visible at very narrow widths.
- Collapsed: 40px strip with status dot, timer, state label, progress, and expand action.
- Edge auto-collapse remains off; manual collapse/expand uses existing main-process IPC.

## 7. Task Tree And Picker

- Existing behavior is preserved: parent tasks default collapsed, search expands matching parents, clearing search restores prior collapsed state, completed tasks are hidden by default.
- Visual hierarchy:
  - root tasks use bordered rows;
  - child tasks use indentation and a left rail;
  - current segment and session default labels use accent/emerald soft chips;
  - completed tasks are muted and marked.

## 8. History

- History emphasizes the value proposition: each session expands into time stats, default task, bulk linking actions, and segment rows.
- Unlinked segment rows use a warning-tinted dashed treatment to make missing associations easy to find.
- Batch association and per-segment association retain the existing `TaskPicker` flow.

## 9. Settings

- Settings are organized into tabs: appearance, tasks, hotkeys, mini window, sync, and about.
- CLI diagnostics remain in the tasks area with the existing test, diagnose, and copy actions.
- Mini-window controls are separated into their own tab to reduce visual clutter.

## 10. Verification Notes

- `npm run build` must pass after UI changes.
- `npm run dist` should produce both installer and portable artifacts under the release output directory.
- Functional contracts intentionally untouched: timer state machine, SQLite schema, dida CLI provider, hotkey registration, IPC channel names, and task-linking data model.
