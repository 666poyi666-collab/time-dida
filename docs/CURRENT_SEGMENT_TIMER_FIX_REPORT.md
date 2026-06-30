# 当前片段计时统一修复报告

> 版本：v0.1.8
> Commit：`1ed0760ad2aa73a53d018a6d4ddc2f4c762a131e`
> 日期：2026-06-30

## 一、为什么之前没有统一

在 v0.1.8 首版中，TimerPanel 已改为显示「当前片段时间」，但 MiniWindow 仍沿用旧逻辑：

```ts
// MiniWindow 旧逻辑（错误）
const displayActive =
  state === 'running' && lastTick > 0
    ? baseActive + Math.max(0, Date.now() - lastTick)  // baseActive = snapshot.activeElapsedMs（累计值）
    : baseActive;
```

`baseActive` 是 `snapshot.activeElapsedMs`，即**所有专注片段的累计时长**。这导致 MiniWindow 的大时间在暂停后继续时不会从 0 开始，而是继续显示累计值。

同时，TimerPanel 内部用 `useDisplayValues` hook 自行计算显示值，MiniWindow 也各自写了一套计算逻辑，两个组件的口径不一致。

## 二、修复方案

### 1. 新建统一 selector

新增 [src/lib/timerSelectors.ts](../src/lib/timerSelectors.ts)，提供 7 个纯函数：

| Selector | 语义 | 计算方式 |
| --- | --- | --- |
| `getCurrentSegmentDisplayMs(snapshot, now)` | 当前专注片段时间 | `seg.activeElapsedMs + (now - lastTick)` |
| `getCurrentPauseDisplayMs(snapshot, now)` | 当前暂停片段时间 | `now - currentPauseStartedAt` |
| `getMainDisplayMs(snapshot, now)` | 大看板主显示 | paused 时返回暂停片段，否则返回专注片段 |
| `getCumulativeActiveMs(snapshot, now)` | 累计专注 | running 时 `activeElapsedMs + (now - lastTick)` |
| `getCumulativePauseMs(snapshot, now)` | 累计暂停 | paused 时 `pauseElapsedMs + (now - currentPauseStartedAt)` |
| `getWallElapsedMs(snapshot)` | 总历时 | `wallElapsedMs` |
| `getMinuteRhythmSec(snapshot, now)` | 分钟节奏秒数 | `floor(mainMs / 1000) % 60` |

### 2. 修复的显示位置

| 组件 | 修复前 | 修复后 |
| --- | --- | --- |
| **TimerPanel** | 用 `useDisplayValues` 内联计算 | 改为调用统一 selector |
| **MiniWindow（COLLAPSED）** | 显示累计 `activeElapsedMs` | 显示 `getMainDisplayMs()` |
| **MiniWindow（COMPACT）** | 显示累计 `activeElapsedMs` | 显示 `getMainDisplayMs()` |
| **MiniWindow（EXPANDED）** | 显示累计 `activeElapsedMs` | 显示 `getMainDisplayMs()` |
| **MiniWindow（暂停态）** | 不显示暂停片段时间，不区分颜色 | 显示当前暂停片段，橙色 `text-warning` |
| **SegmentTimeline** | 已正确（v0.1.8 首版改过） | 无需改 |
| **HistoryPanel** | 不涉及实时计时 | 无需改 |
| **TaskPicker** | 不涉及计时显示 | 无需改 |

### 3. 暂停态视觉一致性

MiniWindow 三种模式在暂停时：
- 大时间数字加 `text-warning`（橙色）
- 状态点已显示橙色（`bg-warning`）
- 状态标签已显示「已暂停」（`text-warning`）

## 三、验收对照

| # | 标准 | 状态 |
| --- | --- | --- |
| 1 | 所有「当前专注片段时间」都从 0 开始 | ✅ 统一走 `getCurrentSegmentDisplayMs` |
| 2 | 暂停后继续，新专注片段从 0 开始 | ✅ 每个 Segment 有独立 `activeElapsedMs` |
| 3 | 暂停时大时间显示当前暂停片段时间 | ✅ 统一走 `getCurrentPauseDisplayMs` |
| 4 | 累计专注时间正常增加 | ✅ `getCumulativeActiveMs` |
| 5 | 累计暂停时间正常增加 | ✅ `getCumulativePauseMs` |
| 6 | 总历时正常增加 | ✅ `getWallElapsedMs` |

## 四、验证

- `tsc --noEmit`：通过
- `npm test`：46/46 全绿
- `npm run build`：1912 模块通过
- `npm run dist:win`：安装包 + 免安装版生成成功
