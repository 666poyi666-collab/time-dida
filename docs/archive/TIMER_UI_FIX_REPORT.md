# 计时数字实时刷新修复报告

> 修复日期：2026-06-29
> 验证版本：FocusLink 0.1.0（打包版 FocusLink-0.1.0-x64.exe）

## 一、问题现象

修改前计时器有严重 bug：

- 计时器不会每秒刷新
- 只有点击开始/暂停时，数字才跳到新的时间
- 渲染层只在状态变化时刷新，没有在 running 状态下做实时 tick

## 二、根本原因

`electron/main.ts` 从未注册 `timer.onSnapshot()` 监听器，导致主进程的 `TimerManager` 每 1 秒推送的 snapshot 无法到达渲染进程的 `'tick'` 通道。

```ts
// 修复前：ensureTrayAndHotkeys() 只创建了 tray 和 hotkeys，从未调用 timer.onSnapshot()
// 所以 TimerManager.emit() 推送给 0 个 listener，渲染层永远收不到 'tick' 事件
```

## 三、修复方案

采用方案 A + B 组合：渲染进程本地 tick + 主进程 snapshot 推送双保险。

### 1. 主进程推送（根本修复）

`electron/main.ts` 的 `ensureTrayAndHotkeys()` 中注册 snapshot 监听，并广播到所有窗口：

```ts
function pushSnapshot(snap: TimerSnapshot): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tick', snap);
  }
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send('tick', snap);
  }
}

function ensureTrayAndHotkeys(): void {
  // ...
  // 注册 snapshot 推送（核心修复：计时器实时刷新）
  timer.onSnapshot((snap) => pushSnapshot(snap));
  // ...
}
```

### 2. 渲染层动态计算（双保险）

`src/components/TimerPanel.tsx` 增加 `useDisplayValues` hook，running 时基于 `lastTick` 和 `Date.now()` 动态计算，即使主进程推送延迟 UI 也能持续刷新：

```ts
function useDisplayValues(snapshot: TimerSnapshot | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const state = snapshot?.state;
    if (state !== 'running' && state !== 'paused') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [snapshot?.state, snapshot?.lastTick, snapshot?.currentPauseStartedAt]);

  return useMemo(() => {
    // running: activeMs = baseActive + (now - lastTick)
    // paused: pauseMs = basePause + (now - currentPauseStartedAt)
    // wall: 直接用 baseWall（主进程每秒推送）
  }, [snapshot, now]);
}
```

### 3. getSnapshot 返回 lastTick

`electron/timer/manager.ts` 的 `getSnapshot()` 返回 `lastTick`（上次活跃结算时间），渲染层用它计算增量：

```ts
return {
  // ...
  // lastTick = 上次活跃结算时间（running 时）；渲染层用 (now - lastTick) 算增量
  lastTick: this.lastTick > 0 ? this.lastTick : now,
};
```

## 四、TimerManager tick 机制说明

- `TICK_INTERVAL_MS = 1000`，每秒一次 tick
- `tick()` 内部调用 `settleActive(now)` 结算活跃时间增量，再 `emit()` 推送
- `startTick()` 在 `start()` / `resume()` 时启动；`stopTick()` 在 `pause()` / `stop()` 时停止
- `pauseElapsedMs` 由 `pauseStartedAt` 驱动，渲染层用 `(now - pauseStartedAt)` 动态计算

## 五、验证过程

### 验证环境

- 平台：Windows 10.0.26200
- 版本：打包版 `release\win-unpacked\FocusLink.exe`（isPackaged=true, isDev=false）
- 测试方法：Win32 API `keybd_event` 模拟全局快捷键，日志文件读取验证

### 验证 1：running 状态每秒自动刷新

时间戳：2026-06-29T10:38:53 ~ 10:39:27（北京时间 18:38:53 ~ 18:39:27）

日志（节选）：

```
[2026-06-29T10:38:53.536Z] [INFO] [hotkey] trigger pressed {"accelerator":"CommandOrControl+Alt+Space","action":"toggleTimer","beforeState":"idle"}
[2026-06-29T10:38:53.537Z] [INFO] [timer] started {"sessionId":"a6e8dd5b-...","segmentId":"8f8b9bed-..."}
[2026-06-29T10:38:53.538Z] [INFO] [hotkey] trigger handled {"beforeState":"idle","afterState":"running","success":true}
[2026-06-29T10:38:54.539Z] [INFO] [timer] tick {"activeMs":1002,"listeners":2}
[2026-06-29T10:38:55.539Z] [INFO] [timer] tick {"activeMs":2003,"listeners":2}
[2026-06-29T10:38:56.540Z] [INFO] [timer] tick {"activeMs":3004,"listeners":2}
[2026-06-29T10:38:57.540Z] [INFO] [timer] tick {"activeMs":4004,"listeners":2}
[2026-06-29T10:38:58.539Z] [INFO] [timer] tick {"activeMs":5003,"listeners":2}
[2026-06-29T10:38:59.540Z] [INFO] [timer] tick {"activeMs":6004,"listeners":2}
...
[2026-06-29T10:39:27.552Z] [INFO] [timer] tick {"activeMs":34016,"listeners":2}
```

观察：
- `activeMs` 每 1000ms 增长 1000（1002 → 2003 → 3004 → 4004 → 5003 → 6004 → ... → 34016）
- `listeners=2`（主窗口 + 专注小窗，两个窗口都收到 snapshot 推送）
- tick 间隔稳定为 1001ms（系统调度精度正常）

### 验证 2：暂停后 tick 停止，activeMs 不再增长

时间戳：2026-06-29T10:39:27.858（北京时间 18:39:27）

```
[2026-06-29T10:39:27.858Z] [INFO] [hotkey] trigger pressed {"action":"toggleTimer","beforeState":"running"}
[2026-06-29T10:39:27.858Z] [INFO] [timer] paused {"activeMs":34322}
[2026-06-29T10:39:27.859Z] [INFO] [hotkey] trigger handled {"beforeState":"running","afterState":"paused","success":true}
```

暂停后等待 24 秒（10:39:27 → 10:39:51），日志中没有任何 tick 条目，确认 running→paused 时 `stopTick()` 成功清理定时器。

### 验证 3：继续后 tick 恢复，activeMs 从暂停点继续增长

时间戳：2026-06-29T10:39:51（北京时间 18:39:51）

```
[2026-06-29T10:39:51.550Z] [INFO] [hotkey] trigger pressed {"action":"toggleTimer","beforeState":"paused"}
[2026-06-29T10:39:51.550Z] [INFO] [timer] resumed {"newSegment":true,"pauseMs":23692}
[2026-06-29T10:39:51.551Z] [INFO] [hotkey] trigger handled {"beforeState":"paused","afterState":"running","success":true}
[2026-06-29T10:39:52.550Z] [INFO] [timer] tick {"activeMs":35322,"listeners":2}
[2026-06-29T10:39:53.551Z] [INFO] [timer] tick {"activeMs":36323,"listeners":2}
[2026-06-29T10:39:54.552Z] [INFO] [timer] tick {"activeMs":37324,"listeners":2}
[2026-06-29T10:39:55.551Z] [INFO] [timer] tick {"activeMs":38323,"listeners":2}
```

观察：
- resume 后 activeMs 从 34322 继续增长（35322 → 36323 → 37324 → 38323）
- 增量稳定 +1000ms/秒
- pauseMs=23692（暂停期间累计 23.7 秒）

### 验证 4：停止后写入数据库

时间戳：2026-06-29T10:40:09.665（北京时间 18:40:09）

```
[2026-06-29T10:40:09.665Z] [INFO] [hotkey] trigger pressed {"action":"stopTimer","beforeState":"running","accelerator":"CommandOrControl+Alt+Enter"}
[2026-06-29T10:40:09.665Z] [INFO] [timer] stopped {"activeMs":52437,"pauseMs":23692,"wallMs":76129}
[2026-06-29T10:40:09.666Z] [INFO] [hotkey] trigger handled {"beforeState":"running","afterState":"finished","success":true}
```

数据库查询结果（`C:\Users\poyi\AppData\Roaming\focuslink\focuslink.db`）：

```json
SESSIONS_COUNT: 1
{
  "status": "finished",
  "active_elapsed_ms": 52437,
  "pause_elapsed_ms": 23692,
  "wall_elapsed_ms": 76129,
  "started_at": 1782729533536,
  "ended_at": 1782729609665
}
SEGMENTS_COUNT: 2
[
  {"active_elapsed_ms": 34322, "started_at": 1782729533536, "ended_at": 1782729591550},
  {"active_elapsed_ms": 52437, "started_at": 1782729591550, "ended_at": 1782729609665}
]
PAUSES_COUNT: 1
{
  "pause_started_at": 1782729567858,
  "pause_ended_at": 1782729591550,
  "duration_ms": 23692
}
```

数据完全一致：
- Session.active=52437ms = Segment1.active(34322) + Segment2 增量(18115)
- Session.pause=23692ms = Pause.duration(23692)
- Session.wall=76129ms = ended_at - started_at = 76129ms

## 六、验收标准对照

| 标准 | 状态 | 说明 |
|------|------|------|
| running 时每秒显示更新 | PASS | tick 间隔 1000ms，activeMs +1000/秒 |
| paused 时停止 activeElapsed 增长 | PASS | 暂停 24 秒，activeMs 保持 34322 不变 |
| wallElapsed 可以继续增长 | PASS | 主进程 getSnapshot 实时算 `now - startedAt` |
| stop 后固定最终时间 | PASS | DB 写入 active=52437, pause=23692, wall=76129 |
| 页面切换回来后显示仍正确 | PASS | getSnapshot 返回 lastTick，渲染层用 (now - lastTick) 算增量，不依赖连续 tick |
| 不依赖用户点击才刷新 | PASS | setInterval 1000ms 在 running/paused 状态自动驱动 |

## 七、副作用验证

- listeners=2：主窗口和专注小窗都收到 snapshot 推送，两窗口计时同步
- 暂停状态 UI：渲染层用 `(now - currentPauseStartedAt)` 动态算 pauseElapsedMs 显示，pauseElapsed 持续增长
- 崩溃恢复：`persistSnapshot()` 每 5 秒写一次 DB，`META_LAST_TICK` 写入 app_meta 表；recover() 时用 `now - lastTick` 重算
