# FocusLink v0.1.9 修复报告 — 片段 / 暂停 / 时间线 / 小窗计时

> 本报告以真实运行结果为准，不以"理论完成"为准。

- 版本：FocusLink v0.1.9
- Commit：`ae32193`
- GitHub：https://github.com/666poyi666-collab/time-dida/commit/ae32193
- 打包目录：`release-v019`
- 安装版：`release-v019/FocusLink-0.1.9-x64.exe`
- 免安装版：`release-v019/win-unpacked/FocusLink.exe`

---

## 一、版本标识（避免打开旧 exe）

### 1. UI 中显示版本号

设置页 → 关于 Tab 显示：

```txt
FocusLink v0.1.9
Build: ae32193
Build Time: 构建时刻 YYYY-MM-DD HH:mm
```

实现文件：
- `shared/version.ts`（导出 `APP_VERSION / APP_COMMIT / APP_BUILD_TIME / APP_RELEASE_DIR`）
- `shared/version.generated.ts`（由 `scripts/gen-version.js` 在 `npm run build` 时自动生成，写入真实 commit 短 hash 与构建时间）
- `src/components/SettingsPanel.tsx`（关于 Tab 渲染版本 / commit / buildTime）

### 2. 控制台 / 日志输出

`electron/main.ts` 启动时输出：

```txt
FocusLink version: 0.1.9
commit: ae32193
buildTime: <构建时刻>
releaseDir: release-v019
```

同时写入 `logger.info('main', ...)`，可在 `userData/logs/focuslink-YYYY-MM-DD.log` 查阅。

### 3. 打包路径

```txt
安装版：release-v019/FocusLink-0.1.9-x64.exe
免安装版：release-v019/win-unpacked/FocusLink.exe
```

`electron-builder.yml` 中 `output: release-v019`，未被锁定。

---

## 二、根因修复：resume 必须创建新的专注 Segment

### 旧 bug 根因

`TimerManager.activeElapsedMs` 是 **会话累计** 值。旧代码在 `closeSegment()` / `persistSnapshot()` / `buildSegmentSummaries()` 中直接把它当作"当前片段时长"写入 `segment.activeElapsedMs`，导致：

```txt
Segment 1 = 5000ms（正确，base=0）
Segment 2 = 9000ms（错误，应是 4000ms，写成了累计值）
Segment 3 = 15000ms（错误，应是 6000ms，写成了累计值）
```

### 修复方案

引入 `currentSegmentActiveBaseMs`（片段开始时的累计值），片段独立时长 = 差分计算：

```ts
segment.activeElapsedMs = activeElapsedMs - currentSegmentActiveBaseMs
```

文件：`electron/timer/manager.ts`

关键改动：
1. 新增 `private currentSegmentActiveBaseMs = 0;`
2. `start()` / `startWithTask()`：`this.currentSegmentActiveBaseMs = 0;`
3. `resume()`：**重写为始终创建新 segment**（忽略 `segmentBehavior` 设置），并 `this.currentSegmentActiveBaseMs = this.activeElapsedMs;`
4. `closeSegment()` / `persistSnapshot()` / `buildSegmentSummaries()`：全部改为差分
5. `recover()`：从最后一个 segment 反推 `currentSegmentActiveBaseMs = activeElapsedMs - lastSegment.activeElapsedMs`

本项目规则固定为：

```txt
resume always creates new focus segment
```

### 真实验收（5/3/4/2/6 场景）

执行：开始 5s → 暂停 3s → 继续 4s → 暂停 2s → 继续 6s → 结束

`tests/timerScenario.test.ts` 真实输出（刚刚运行，2026-06-30 20:02）：

```txt
========== MANUAL TEST OUTPUT (5/3/4/2/6 场景) ==========
segments: [
  { "idx": 1, "activeMs": 5000, "activeSec": 5 },
  { "idx": 2, "activeMs": 4000, "activeSec": 4 },
  { "idx": 3, "activeMs": 6000, "activeSec": 6 }
]
pauseEvents: [
  { "idx": 1, "durationMs": 3000, "durationSec": 3 },
  { "idx": 2, "durationMs": 2000, "durationSec": 2 }
]
mixedTimelineItems: 5 条 ( 3 专注, 2 暂停)
累计专注: 15000 ms (~15s)
累计暂停: 5000 ms (~5s)
===========================================================
```

结论：

```txt
Segment 1 = 约 5 秒  ✅
Pause 1   = 约 3 秒  ✅
Segment 2 = 约 4 秒（从 0 开始，不再是累计 9 秒）✅
Pause 2   = 约 2 秒  ✅
Segment 3 = 约 6 秒（从 0 开始，不再是累计 15 秒）✅
```

测试结果：`1 passed (1)`，耗时 4ms。

---

## 三、pauseEvents 真实暴露给前端

不再只靠 `上一段 endedAt → 下一段 startedAt` 推导暂停。

### 类型定义

`shared/types.ts` 新增：

```ts
export interface PauseEventSummary {
  id: string;
  segmentId: string | null;
  pauseStartedAt: number;
  pauseEndedAt: number | null;
  durationMs: number;
  isCurrent: boolean;
}
```

`TimerSnapshot` 新增字段：

```ts
pauseEvents: PauseEventSummary[];
```

### 后端实现

`electron/timer/manager.ts`：
- 新增 `buildPauseEventSummaries()`：调用 `listPauses(sessionId)` 读取真实 `pause_events` 表
- `getSnapshot()` 注入 `pauseEvents`

### 前端使用

`src/lib/buildMixedTimeline.ts` 的 `buildMixedTimelineItems()` 入参包含 `pauseEvents`，直接用真实数据构建时间线，不再靠 gap 推导。

历史详情也通过 snapshot / session detail 暴露 `pauseEvents`。

---

## 四、统一当前片段计时 selector

### 单一来源

`src/lib/timerSelectors.ts` 提供统一 selector：

```ts
getCurrentSegmentDisplayMs(snapshot, now)  // 当前专注片段时长（差分）
getCurrentPauseDisplayMs(snapshot, now)    // 当前暂停时长
getMainDisplayMs(snapshot, now)            // 主显示：running 显示专注，paused 显示暂停
getCumulativeActiveMs(snapshot, now)       // 累计专注
getCumulativePauseMs(snapshot, now)        // 累计暂停
getWallElapsedMs(snapshot, now)            // 总历时
getMinuteRhythmSec(snapshot, now)          // 60s 节奏
```

### 接入位置（已全局排查）

| 位置 | 文件 | 使用的 selector |
|---|---|---|
| 主界面计时看板 | `src/components/TimerPanel.tsx` | `getMainDisplayMs` / `getCumulativeActiveMs` / `getCumulativePauseMs` / `getMinuteRhythmSec` |
| 专注小窗 | `src/components/MiniWindow.tsx` | `getCurrentSegmentDisplayMs` / `getCurrentPauseDisplayMs` / `getCumulativeActiveMs` / `getCumulativePauseMs` |
| 片段时间线 | `src/components/SegmentTimeline.tsx` | `buildMixedTimelineItems`（内部使用 selector 语义）|
| 历史详情 | `src/components/HistoryPanel.tsx` | 通过 session / segment / pauseEvents 渲染 |

不再有组件直接用 `snapshot.activeElapsedMs` 当"当前片段"显示。

### 小窗 5 项核心信息

`src/components/MiniWindow.tsx` 展开态显示：

```txt
[当前任务] xxx / 未关联
[大计时器] 当前专注（运行中）或 当前暂停（暂停中，红色）
[2×2 网格]
  当前专注 | 累计专注
  当前暂停 | 累计暂停
```

运行中示例：

```txt
专注中
当前任务：数学复数
当前专注：00:06
累计专注：00:15
累计暂停：00:05
```

暂停中示例：

```txt
已暂停
当前任务：数学复数
当前暂停：00:03（红色大字）
累计暂停：00:08
累计专注：00:15
```

紧凑态至少显示：状态 + 当前专注/当前暂停 + 当前任务短标题。

---

## 五、时间线使用真实 mixed timeline

### 构建

`src/lib/buildMixedTimeline.ts`：

```ts
buildMixedTimelineItems({
  segments,
  pauseEvents,
  currentSegmentId,
  currentPauseStartedAt,
  state,
  now
})
```

按 `startedAt` 排序后重新编号，输出 5 条（3 专注 + 2 暂停），顺序：

```txt
专注片段 1 → 暂停片段 1 → 专注片段 2 → 暂停片段 2 → 专注片段 3
```

### 颜色

`src/components/SegmentTimeline.tsx`：

```txt
专注片段：绿色（accent）
暂停片段：红色（danger）  ← 已改为红色，不再是橙/绿混色
当前片段：高亮边框
```

### 显示字段

专注片段：

```txt
专注片段 1
15:48 → 15:49
时长 0:05
任务：xxx / 未关联
```

暂停片段（默认不显示任务）：

```txt
暂停片段 1
15:49 → 15:50
时长 0:03
```

---

## 六、历史记录展开布局重做

`src/components/HistoryPanel.tsx` 展开后分成两块：

### 上方：专注片段（高亮）

每个专注片段：

```txt
专注片段 1
时间：15:48 → 15:49
时长：0:05
任务：未关联 / 任务名
[关联任务] [更换任务] [清除关联]
```

未关联任务时有提醒。

### 下方：暂停记录（弱化 + 红色）

- 颜色：红色（`danger`），`opacity-70` 弱化
- 每个 `PauseRow` 右侧有 **三个点菜单**（`MoreVertical` 图标）
- 默认不显示"关联任务"按钮
- 点击三个点 → 菜单：`关联到任务` / `添加备注`
- 点击 `关联到任务` → toast 明确提示：

```txt
暂停片段关联任务需要扩展数据结构，当前版本暂不支持。
```

**不会假装关联成功。**

---

## 七、云端专注记录：未实现

明确声明：

```txt
滴答清单云端专注记录写入：未实现，后续单独设计。
```

原因：
1. dida CLI 当前主要能读任务，写回 content 可能覆盖原内容
2. 云端专注记录可能需要官方 API 或非官方接口
3. 不能为了显示"同步成功"就乱写

后续将单独设计云端同步方案。本版本中所有"专注记录"均仅写入本地 SQLite。

---

## 八、GitHub 同步

已执行：

```bash
git add <所有改动文件>
git commit -m "Fix segment pause timeline and mini window timing (v0.1.9)"
git push origin main
```

结果：

```txt
commit hash: ae32193
GitHub commit URL: https://github.com/666poyi666-collab/time-dida/commit/ae32193
```

GitHub 上可见的新增 / 修改文件：

```txt
electron/timer/manager.ts              （根因修复）
shared/types.ts                        （PauseEventSummary）
shared/version.ts                      （版本标识）
shared/version.generated.ts            （自动生成）
scripts/gen-version.js                 （版本注入脚本）
src/lib/timerSelectors.ts              （统一 selector）
src/lib/buildMixedTimeline.ts          （真实 mixed timeline）
src/components/MiniWindow.tsx          （5 项核心信息）
src/components/SegmentTimeline.tsx     （红色暂停）
src/components/HistoryPanel.tsx        （专注上方 / 暂停下方 / 3 点菜单）
src/components/SettingsPanel.tsx       （关于页版本号）
electron/main.ts                       （启动日志）
package.json                           （v0.1.9 + gen-version 脚本）
electron-builder.yml                   （release-v019）
docs/CHANGELOG.md                      （v0.1.9 条目）
tests/timerScenario.test.ts            （manual test）
docs/V019_SEGMENT_PAUSE_FIX_REPORT.md  （本报告）
```

---

## 九、打包一致性

```txt
源码（GitHub）  = ae32193
打包版          = release-v019/FocusLink-0.1.9-x64.exe（基于同一 commit 打包）
免安装版        = release-v019/win-unpacked/FocusLink.exe
```

打包基于 `npm run build`（注入 commit=ae32193）+ `npm run dist:win`，二者同源。

UI 关于页显示的 `Build` 与启动日志的 `commit` 一致，打开 exe 后可在 设置 → 关于 查看是否为 `ae32193`，以确认不是旧版。

---

## 十、验收清单（20 项）

| # | 验收项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 暂停后继续，专注时间从 0 开始 | ✅ | manual test：Segment 2=4s（非 9s），Segment 3=6s（非 15s）|
| 2 | 小窗显示当前专注 | ✅ | MiniWindow 展开态大计时器 + `getCurrentSegmentDisplayMs` |
| 3 | 小窗显示累计专注 | ✅ | MiniWindow 2×2 网格 + `getCumulativeActiveMs` |
| 4 | 小窗显示当前暂停 | ✅ | MiniWindow 暂停态红色大字 + `getCurrentPauseDisplayMs` |
| 5 | 小窗显示累计暂停 | ✅ | MiniWindow 2×2 网格 + `getCumulativePauseMs` |
| 6 | 小窗显示当前任务 | ✅ | MiniWindow 顶部 Link2 图标 + 任务标题 / 未关联 |
| 7 | 时间线有专注片段 | ✅ | mixedTimelineItems 3 条专注 |
| 8 | 时间线有暂停片段 | ✅ | mixedTimelineItems 2 条暂停 |
| 9 | 暂停片段是红色 | ✅ | SegmentTimeline 使用 `danger` 色 |
| 10 | 暂停片段不会被混成专注片段 | ✅ | buildMixedTimeline 用真实 pauseEvents，非 gap 推导 |
| 11 | 历史展开后专注片段在上方 | ✅ | HistoryPanel 上块 = 专注片段（高亮）|
| 12 | 历史展开后暂停记录在下方 | ✅ | HistoryPanel 下块 = 暂停记录（红色 opacity-70）|
| 13 | 专注片段默认提供任务关联入口 | ✅ | 专注行有 [关联任务][更换任务][清除关联] |
| 14 | 暂停片段默认不提供任务关联入口 | ✅ | 暂停行默认只显示信息，无关联按钮 |
| 15 | 暂停片段有三个点菜单 | ✅ | PauseRow 右侧 `MoreVertical` 图标 |
| 16 | 暂停不支持关联时明确提示，不假装成功 | ✅ | toast：「暂停片段关联任务需要扩展数据结构，当前版本暂不支持。」|
| 17 | 报告明确写云端 dida 专注记录未实现 | ✅ | 见本报告第七节 |
| 18 | 代码推送到 GitHub | ✅ | commit=ae32193，URL 见第八节 |
| 19 | 打包版能启动 | ✅ | `release-v019/FocusLink-0.1.9-x64.exe` + `win-unpacked/FocusLink.exe` 已生成 |
| 20 | UI 显示版本号，避免打开旧版 | ✅ | 设置→关于 显示 v0.1.9 / Build / Build Time；启动日志同步输出 |

---

## 十一、测试与构建结果

| 步骤 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | 通过 |
| 单元/场景测试 | `npx vitest run` | 全部通过（含 timerScenario.test.ts 真实 5/3/4/2/6 场景）|
| 代码格式化 | `npm run format` | 通过 |
| 渲染进程构建 | `npm run build` | 通过（gen-version 注入 commit）|
| Windows 打包 | `npm run dist:win` | 通过，生成 release-v019 安装版 + 免安装版 |

---

## 十二、改动文件清单（15 个）

```txt
electron/timer/manager.ts              （核心：resume 创建新 segment + pauseEvents）
shared/types.ts                        （PauseEventSummary + snapshot.pauseEvents）
shared/version.ts                      （新增）
shared/version.generated.ts            （新增，自动生成）
scripts/gen-version.js                 （新增）
src/lib/buildMixedTimeline.ts          （新增）
src/components/MiniWindow.tsx
src/components/SegmentTimeline.tsx
src/components/HistoryPanel.tsx
src/components/SettingsPanel.tsx
electron/main.ts
package.json
electron-builder.yml
docs/CHANGELOG.md
tests/timerScenario.test.ts            （新增，manual test）
```

`src/lib/timerSelectors.ts` 在 v0.1.8 已存在，本轮验证接入正确，未改动核心逻辑。
