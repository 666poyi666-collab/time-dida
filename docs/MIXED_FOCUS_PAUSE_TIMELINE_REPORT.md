# 混合专注 / 暂停时间线报告

> 版本：v0.1.8
> Commit：`1ed0760ad2aa73a53d018a6d4ddc2f4c762a131e`
> 日期：2026-06-30

## 一、设计目标

用户的真实使用方式是「专注 → 暂停 → 继续 → 暂停 → 继续」，时间线必须反映这一交替过程，而非只列出专注片段。

## 二、暂停片段如何推导

后端（SQLite）只存储 `FocusSegment`（专注片段）和 `PauseEvent`（暂停事件），没有直接返回「时间线条目」。

### SegmentTimeline（主界面实时时间线）

从 `snapshot.segments`（专注片段数组）的间隙推导暂停：

```ts
// 若该片段已结束且存在下一片段，推导中间的暂停
if (seg.endedAt && i < segments.length - 1) {
  const nextSeg = segments[i + 1];
  if (nextSeg.startedAt > seg.endedAt) {
    // 暂停片段 = seg.endedAt → nextSeg.startedAt
  }
}

// 当前进行中的暂停
if (state === 'paused' && currentPauseStartedAt) {
  // 暂停片段 = currentPauseStartedAt → now
}
```

### HistoryPanel（历史记录详情）

直接使用后端返回的 `detail.pauses`（PauseEvent[]），每个 PauseEvent 有 `pauseStartedAt`、`pauseEndedAt`、`durationMs`。

## 三、TimelineItem 结构

主界面 SegmentTimeline 使用内部类型：

```ts
type TimelineEntry =
  | { kind: 'focus'; id: string; index: number; seg: SegmentSummary; isCurrent: boolean; isOngoing: boolean }
  | { kind: 'pause'; id: string; index: number; startedAt: number; endedAt: number | null; isCurrent: boolean; isOngoing: boolean };
```

## 四、时间线如何混合显示

### 主界面 SegmentTimeline

```
专注片段 1   15:48 → 15:49   0:26   （绿色）
暂停片段 1   15:49 → 15:50   0:18   （橙色）
专注片段 2   15:50 → 15:51   1:09   （绿色）
暂停片段 2   15:51 → 15:52   0:24   （橙色）
专注片段 3   15:52 → 进行中   0:28   （绿色 + 高亮 + ring）
```

- 专注片段：绿色节点（`border-accent` / `bg-accent`）、绿色 chip
- 暂停片段：橙色节点（`border-warning` / `bg-warning`）、橙色 chip
- 当前进行中片段：高亮 + ring + 「进行中」标记 + 实时增长
- 专注片段可显示关联任务，暂停片段不显示任务
- 标题统计：`(N 专注 · M 暂停)`

### 历史记录 HistoryPanel

- **专注片段区**（上方，重点展示）：绿色图标 + 加粗标题 + 完整关联任务入口
- **暂停记录区**（下方，弱化显示）：70% 透明度 + 橙色淡边框 + 三点菜单

## 五、颜色区分

| 类型 | 节点边框 | 节点填充 | chip | 行边框 |
| --- | --- | --- | --- | --- |
| 专注片段 | `border-accent` | `bg-accent` | `bg-accent/10 text-accent` | `border-accent/35` |
| 暂停片段 | `border-warning` | `bg-warning` | `bg-warning/10 text-warning` | `border-warning/40` |

## 六、验收对照

| # | 标准 | 状态 |
| --- | --- | --- |
| 7 | 时间线显示专注片段 | ✅ |
| 8 | 时间线显示暂停片段 | ✅ 从间隙推导 |
| 9 | 专注片段和暂停片段颜色不同 | ✅ 绿色 / 橙色 |
| 10 | 当前专注片段高亮 | ✅ ring + 进行中标记 |
| 11 | 当前暂停片段高亮 | ✅ ring + 进行中标记 |

## 四、验证

- `tsc --noEmit`：通过
- `npm test`：46/46 全绿
- `npm run build`：通过
- `npm run dist:win`：通过
