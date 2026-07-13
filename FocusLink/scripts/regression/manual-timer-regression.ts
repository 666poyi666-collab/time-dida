// 手动回归脚本：模拟 5/3/4/2/6 计时场景，输出真实数据供验收
// 用法：
//   npx vitest run scripts/regression/manual-timer-regression.ts
//   或 npm run manual-test
//
// 场景：开始专注 5s → 暂停 3s → 继续 4s → 暂停 2s → 继续 6s → 结束
// 期望：
//   Segment 1 ≈ 5s, Segment 2 ≈ 4s (非 9s 累计), Segment 3 ≈ 6s (非 15s 累计)
//   Pause 1 ≈ 3s, Pause 2 ≈ 2s
//   累计专注 ≈ 15s, 累计暂停 ≈ 5s, 总历时 ≈ 20s
//   mixedTimelineItems = 5 条 (3 专注 + 2 暂停)
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { APP_VERSION } from '../../shared/version';

const realDateNow = Date.now;

// 纯 JS 内存数据库（模拟 focus_sessions / focus_segments / pause_events 三张表）
// 避免 better-sqlite3 native module 版本冲突
function createMemDb() {
  const sessions: any[] = [];
  const segments: any[] = [];
  const pauses: any[] = [];
  const metaStore = new Map<string, string>();
  return {
    sessions,
    segments,
    pauses,
    insertSession: (s: any) => sessions.push({ ...s }),
    updateSession: (s: any) => {
      const i = sessions.findIndex((x) => x.id === s.id);
      if (i >= 0) sessions[i] = { ...s };
    },
    getSession: (id: string) => sessions.find((x) => x.id === id) || null,
    getActiveSession: () => sessions.find((x) => x.status === 'active') || null,
    insertSegment: (s: any) => segments.push({ ...s }),
    updateSegment: (s: any) => {
      const i = segments.findIndex((x) => x.id === s.id);
      if (i >= 0) segments[i] = { ...s };
    },
    listSegments: (sessionId: string) =>
      segments.filter((x) => x.sessionId === sessionId).sort((a, b) => a.startedAt - b.startedAt),
    getSegment: (id: string) => segments.find((x) => x.id === id) || null,
    deleteSegment: (id: string) => {
      const i = segments.findIndex((x) => x.id === id);
      if (i >= 0) segments.splice(i, 1);
    },
    insertPause: (p: any) => pauses.push({ ...p }),
    updatePause: (p: any) => {
      const i = pauses.findIndex((x) => x.id === p.id);
      if (i >= 0) pauses[i] = { ...p };
    },
    getOpenPause: (sessionId: string) =>
      pauses
        .filter((x) => x.sessionId === sessionId && x.pauseEndedAt == null)
        .sort((a, b) => b.pauseStartedAt - a.pauseStartedAt)[0] || null,
    listPauses: (sessionId: string) =>
      pauses
        .filter((x) => x.sessionId === sessionId)
        .sort((a, b) => a.pauseStartedAt - b.pauseStartedAt),
    getMeta: (k: string) => metaStore.get(k) ?? null,
    setMeta: (k: string, v: string) => metaStore.set(k, v),
  };
}

const memDb = createMemDb();

vi.mock('../../electron/db/index', () => ({
  initDatabase: () => null,
  getDb: () => null,
  getActiveSession: () => memDb.getActiveSession(),
  insertSession: (s: any) => memDb.insertSession(s),
  updateSession: (s: any) => memDb.updateSession(s),
  getSession: (id: string) => memDb.getSession(id),
  insertSegment: (s: any) => memDb.insertSegment(s),
  updateSegment: (s: any) => memDb.updateSegment(s),
  listSegments: (sid: string) => memDb.listSegments(sid),
  getSegment: (id: string) => memDb.getSegment(id),
  deleteSegment: (id: string) => memDb.deleteSegment(id),
  insertPause: (p: any) => memDb.insertPause(p),
  updatePause: (p: any) => memDb.updatePause(p),
  getOpenPause: (sid: string) => memDb.getOpenPause(sid),
  listPauses: (sid: string) => memDb.listPauses(sid),
  getMeta: (k: string) => memDb.getMeta(k),
  setMeta: (k: string, v: string) => memDb.setMeta(k, v),
}));

import { TimerManager } from '../../electron/timer/manager';
import { buildMixedTimelineItems } from '../../shared/focus/timeline';
import {
  getMainDisplayMs,
  getCurrentSegmentDisplayMs,
  getCurrentPauseDisplayMs,
  getCumulativeActiveMs,
  getCumulativePauseMs,
  getWallElapsedMs,
  getCurrentTaskTitle,
} from '../../shared/focus/selectors';
import { formatDuration } from '../../src/lib/time';

describe('manual-timer-regression: 5/3/4/2/6 场景', () => {
  let timer: TimerManager;

  beforeAll(() => {
    timer = new TimerManager('new-segment');
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  it('执行场景并输出完整验收数据', () => {
    const T0 = 1_000_000;
    let fakeNow = T0;
    Date.now = () => fakeNow;

    const steps: Array<{ step: string; snap: any; now: number }> = [];

    // 1. 开始专注
    let snap = timer.start();
    steps.push({ step: 'start', snap, now: fakeNow });

    // 跑 5 秒
    fakeNow += 5000;
    (timer as any).settleActive(fakeNow);
    (timer as any).lastTick = fakeNow;

    // 2. 暂停
    snap = timer.pause();
    steps.push({ step: 'pause-1', snap, now: fakeNow });
    const seg1 = snap.segments[0];
    const pause1Start = fakeNow;

    // 跑 3 秒（暂停中）
    fakeNow += 3000;

    // 3. 继续
    snap = timer.resume();
    steps.push({ step: 'resume-1', snap, now: fakeNow });

    // 跑 4 秒
    fakeNow += 4000;
    (timer as any).settleActive(fakeNow);
    (timer as any).lastTick = fakeNow;

    // 4. 再次暂停
    snap = timer.pause();
    steps.push({ step: 'pause-2', snap, now: fakeNow });

    // 跑 2 秒（暂停中）
    fakeNow += 2000;

    // 5. 再次继续
    snap = timer.resume();
    steps.push({ step: 'resume-2', snap, now: fakeNow });

    // 跑 6 秒
    fakeNow += 6000;
    (timer as any).settleActive(fakeNow);
    (timer as any).lastTick = fakeNow;

    // 6. 停止
    snap = timer.stop();
    steps.push({ step: 'stop', snap, now: fakeNow });

    const finalSnap = snap;

    // ===== 断言 =====
    expect(finalSnap.segments).toHaveLength(3);
    expect(finalSnap.pauseEvents).toHaveLength(2);

    const [s1, s2, s3] = finalSnap.segments;
    const [p1, p2] = finalSnap.pauseEvents;

    // 各片段独立时长（不是累计）
    expect(s1.activeElapsedMs).toBeGreaterThanOrEqual(4900);
    expect(s1.activeElapsedMs).toBeLessThanOrEqual(5100);
    expect(s2.activeElapsedMs).toBeGreaterThanOrEqual(3900);
    expect(s2.activeElapsedMs).toBeLessThanOrEqual(4100);
    expect(s3.activeElapsedMs).toBeGreaterThanOrEqual(5900);
    expect(s3.activeElapsedMs).toBeLessThanOrEqual(6100);
    // 关键：segment 2/3 不是累计值
    expect(s2.activeElapsedMs).toBeLessThan(8000);
    expect(s3.activeElapsedMs).toBeLessThan(12000);

    // 暂停时长
    expect(p1.durationMs).toBeGreaterThanOrEqual(2900);
    expect(p1.durationMs).toBeLessThanOrEqual(3100);
    expect(p2.durationMs).toBeGreaterThanOrEqual(1900);
    expect(p2.durationMs).toBeLessThanOrEqual(2100);

    // 累计
    expect(finalSnap.activeElapsedMs).toBeGreaterThanOrEqual(14900);
    expect(finalSnap.activeElapsedMs).toBeLessThanOrEqual(15100);
    expect(finalSnap.pauseElapsedMs).toBeGreaterThanOrEqual(4900);
    expect(finalSnap.pauseElapsedMs).toBeLessThanOrEqual(5100);

    // ===== 混合时间线 =====
    const items = buildMixedTimelineItems({
      segments: finalSnap.segments,
      pauseEvents: finalSnap.pauseEvents,
      currentSegmentId: finalSnap.currentSegmentId,
      state: finalSnap.state,
      now: fakeNow,
    });
    expect(items).toHaveLength(5);
    const focusItems = items.filter((i) => i.type === 'focus');
    const pauseItems = items.filter((i) => i.type === 'pause');
    expect(focusItems).toHaveLength(3);
    expect(pauseItems).toHaveLength(2);

    // ===== Selector 显示值（TimerPanel / MiniWindow 统一口径） =====
    const now = fakeNow;
    const mainDisplay = getMainDisplayMs(finalSnap, now);
    const currentSeg = getCurrentSegmentDisplayMs(finalSnap, now);
    const currentPause = getCurrentPauseDisplayMs(finalSnap, now);
    const cumActive = getCumulativeActiveMs(finalSnap, now);
    const cumPause = getCumulativePauseMs(finalSnap, now);
    const wall = getWallElapsedMs(finalSnap);
    const taskTitle = getCurrentTaskTitle(finalSnap);

    // ===== 输出完整验收报告 =====
    console.log('\n');
    console.log('========================================================');
    console.log(`  FocusLink v${APP_VERSION} Manual Timer Regression Test`);
    console.log('  场景: start 5s → pause 3s → resume 4s → pause 2s → resume 6s → stop');
    console.log('========================================================\n');

    console.log('--- snapshot.segments (3 个专注片段，每段从 0 开始) ---');
    finalSnap.segments.forEach((s: any, i: number) => {
      console.log(
        `  Segment ${i + 1}: activeMs=${s.activeElapsedMs} (${Math.round(s.activeElapsedMs / 1000)}s)` +
          ` | startedAt=${new Date(s.startedAt).toISOString()}` +
          ` | endedAt=${s.endedAt ? new Date(s.endedAt).toISOString() : 'null'}`,
      );
    });

    console.log('\n--- snapshot.pauseEvents (2 个暂停片段) ---');
    finalSnap.pauseEvents.forEach((p: any, i: number) => {
      console.log(
        `  Pause ${i + 1}: durationMs=${p.durationMs} (${Math.round(p.durationMs / 1000)}s)` +
          ` | started=${new Date(p.pauseStartedAt).toISOString()}` +
          ` | ended=${p.pauseEndedAt ? new Date(p.pauseEndedAt).toISOString() : 'null'}`,
      );
    });

    console.log('\n--- mixedTimelineItems (5 条，专注与暂停交替) ---');
    items.forEach((item: any, i: number) => {
      const label = item.type === 'focus' ? `专注片段` : '暂停片段';
      console.log(
        `  [${i + 1}] ${label} | ${new Date(item.startedAt).toISOString()} → ${new Date(item.endedAt).toISOString()} | ${item.durationMs}ms`,
      );
    });

    console.log('\n--- TimerPanel 显示值 (大看板) ---');
    console.log(`  状态: ${finalSnap.state}`);
    console.log(`  大时间 (当前片段): ${formatDuration(mainDisplay)}  (${mainDisplay}ms)`);
    console.log(`  累计专注: ${formatDuration(cumActive)}  (${cumActive}ms, 期望 ~15s)`);
    console.log(`  累计暂停: ${formatDuration(cumPause)}  (${cumPause}ms, 期望 ~5s)`);
    console.log(`  总历时: ${formatDuration(wall)}  (${wall}ms, 期望 ~20s)`);
    console.log(`  当前任务: ${taskTitle ?? '未关联'}`);

    console.log('\n--- MiniWindow 显示值 (展开态核心信息) ---');
    console.log(`  状态: ${finalSnap.state}`);
    console.log(`  当前任务: ${taskTitle ?? '未关联'}`);
    console.log(`  当前专注: ${formatDuration(currentSeg)}  (${currentSeg}ms)`);
    console.log(`  累计专注: ${formatDuration(cumActive)}  (${cumActive}ms)`);
    console.log(`  当前暂停: ${formatDuration(currentPause)}  (${currentPause}ms)`);
    console.log(`  累计暂停: ${formatDuration(cumPause)}  (${cumPause}ms)`);
    console.log(`  总历时: ${formatDuration(wall)}  (${wall}ms)`);

    console.log('\n--- History detail 值 ---');
    console.log(`  Session ID: ${finalSnap.sessionId}`);
    console.log(`  专注片段数: ${finalSnap.segments.length}`);
    console.log(`  暂停片段数: ${finalSnap.pauseEvents.length}`);
    console.log(`  累计专注: ${formatDuration(finalSnap.activeElapsedMs)}`);
    console.log(`  累计暂停: ${formatDuration(finalSnap.pauseElapsedMs)}`);
    console.log(`  总历时: ${formatDuration(finalSnap.wallElapsedMs)}`);
    const linked = finalSnap.segments.filter((s: any) => s.taskId).length;
    const unlinked = finalSnap.segments.length - linked;
    console.log(`  已关联: ${linked} | 未关联: ${unlinked}`);

    console.log('\n--- 验收断言 ---');
    console.log(`  ✓ Segment 1 ≈ 5s  (实际 ${Math.round(s1.activeElapsedMs / 1000)}s)`);
    console.log(`  ✓ Segment 2 ≈ 4s  (实际 ${Math.round(s2.activeElapsedMs / 1000)}s, 非累计 9s)`);
    console.log(`  ✓ Segment 3 ≈ 6s  (实际 ${Math.round(s3.activeElapsedMs / 1000)}s, 非累计 15s)`);
    console.log(`  ✓ Pause 1 ≈ 3s    (实际 ${Math.round(p1.durationMs / 1000)}s)`);
    console.log(`  ✓ Pause 2 ≈ 2s    (实际 ${Math.round(p2.durationMs / 1000)}s)`);
    console.log(`  ✓ 累计专注 ≈ 15s  (实际 ${Math.round(cumActive / 1000)}s)`);
    console.log(`  ✓ 累计暂停 ≈ 5s   (实际 ${Math.round(cumPause / 1000)}s)`);
    console.log(`  ✓ mixedTimelineItems = ${items.length} 条 (3 专注 + 2 暂停)`);
    console.log('\n========================================================\n');

    Date.now = realDateNow;
  });
});
