// 集成测试：验证 5/3/4/2/6 场景下 segment 与 pauseEvents 的真实数据
// 用纯 JS 内存 mock 代替 better-sqlite3（避免 native module 版本冲突），
// 验证 TimerManager 的核心逻辑：resume 创建新 segment + activeElapsedMs 差值计算 + pauseEvents 暴露
import { describe, it, expect, beforeAll, vi } from 'vitest';

// 纯 JS 内存数据库（模拟 focus_sessions / focus_segments / pause_events 三张表）
function createMemDb() {
  const sessions: any[] = [];
  const segments: any[] = [];
  const pauses: any[] = [];
  const metaStore = new Map<string, string>();
  return {
    sessions,
    segments,
    pauses,
    // session 操作
    insertSession: (s: any) => sessions.push({ ...s }),
    updateSession: (s: any) => {
      const i = sessions.findIndex((x) => x.id === s.id);
      if (i >= 0) sessions[i] = { ...s };
    },
    getSession: (id: string) => sessions.find((x) => x.id === id) || null,
    getActiveSession: () => sessions.find((x) => x.status === 'active') || null,
    // segment 操作
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
    // pause 操作
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
    // meta
    getMeta: (k: string) => metaStore.get(k) ?? null,
    setMeta: (k: string, v: string) => metaStore.set(k, v),
  };
}

const memDb = createMemDb();

vi.mock('../electron/db/index', () => ({
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

import { TimerManager } from '../electron/timer/manager';
import { buildMixedTimelineItems } from '../src/lib/buildMixedTimeline';

describe('TimerManager 真实场景：开始5s → 暂停3s → 继续4s → 暂停2s → 继续6s', () => {
  let timer: TimerManager;

  beforeAll(() => {
    timer = new TimerManager('new-segment');
  });

  it('场景执行后应有 3 个专注片段 + 2 个暂停片段，且每段从 0 开始', () => {
    const T0 = 1_000_000;
    let fakeNow = T0;
    const realDateNow = Date.now;
    Date.now = () => fakeNow;

    // 1. 开始专注
    let snap = timer.start();
    expect(snap.state).toBe('running');
    expect(snap.segments).toHaveLength(1);

    // 跑 5 秒
    fakeNow += 5000;
    (timer as any).settleActive(fakeNow);
    (timer as any).lastTick = fakeNow;

    // 2. 暂停
    snap = timer.pause();
    expect(snap.state).toBe('paused');
    expect(snap.pauseEvents).toHaveLength(1);
    const seg1 = snap.segments[0];
    // Segment 1 应约为 5 秒（独立时长，不是累计）
    expect(seg1.activeElapsedMs).toBeGreaterThanOrEqual(4900);
    expect(seg1.activeElapsedMs).toBeLessThanOrEqual(5100);

    // 跑 3 秒（暂停中）
    fakeNow += 3000;

    // 3. 继续
    snap = timer.resume();
    expect(snap.state).toBe('running');
    // 应有 2 个 segment（新 segment 从 0 开始）
    expect(snap.segments).toHaveLength(2);
    const seg2 = snap.segments[1];
    expect(seg2.activeElapsedMs).toBe(0);
    // 暂停 1 应已结算，约 3 秒
    expect(snap.pauseEvents).toHaveLength(1);
    const pause1 = snap.pauseEvents[0];
    expect(pause1.durationMs).toBeGreaterThanOrEqual(2900);
    expect(pause1.durationMs).toBeLessThanOrEqual(3100);
    expect(pause1.pauseEndedAt).not.toBeNull();

    // 跑 4 秒
    fakeNow += 4000;
    (timer as any).settleActive(fakeNow);
    (timer as any).lastTick = fakeNow;

    // 4. 再次暂停
    snap = timer.pause();
    expect(snap.pauseEvents).toHaveLength(2);
    const seg2After = snap.segments[1];
    // Segment 2 应约为 4 秒（独立时长，不是累计 5+4=9）
    expect(seg2After.activeElapsedMs).toBeGreaterThanOrEqual(3900);
    expect(seg2After.activeElapsedMs).toBeLessThanOrEqual(4100);
    // 关键断言：segment 2 不是累计值
    expect(seg2After.activeElapsedMs).toBeLessThan(8000);

    // 跑 2 秒（暂停中）
    fakeNow += 2000;

    // 5. 再次继续
    snap = timer.resume();
    expect(snap.state).toBe('running');
    expect(snap.segments).toHaveLength(3);
    const seg3 = snap.segments[2];
    expect(seg3.activeElapsedMs).toBe(0);
    expect(snap.pauseEvents).toHaveLength(2);
    const pause2 = snap.pauseEvents[1];
    expect(pause2.durationMs).toBeGreaterThanOrEqual(1900);
    expect(pause2.durationMs).toBeLessThanOrEqual(2100);

    // 跑 6 秒
    fakeNow += 6000;
    (timer as any).settleActive(fakeNow);
    (timer as any).lastTick = fakeNow;

    // 6. 停止
    snap = timer.stop();
    expect(snap.state).toBe('finished');
    const seg3Final = snap.segments[2];
    expect(seg3Final.activeElapsedMs).toBeGreaterThanOrEqual(5900);
    expect(seg3Final.activeElapsedMs).toBeLessThanOrEqual(6100);

    // 累计专注 = 5 + 4 + 6 = 15 秒
    expect(snap.activeElapsedMs).toBeGreaterThanOrEqual(14900);
    expect(snap.activeElapsedMs).toBeLessThanOrEqual(15100);
    // 累计暂停 = 3 + 2 = 5 秒
    expect(snap.pauseElapsedMs).toBeGreaterThanOrEqual(4900);
    expect(snap.pauseElapsedMs).toBeLessThanOrEqual(5100);

    // 混合时间线构建验证
    const items = buildMixedTimelineItems({
      segments: snap.segments,
      pauseEvents: snap.pauseEvents,
      currentSegmentId: snap.currentSegmentId,
      state: snap.state,
      now: fakeNow,
    });
    expect(items).toHaveLength(5);
    const focusItems = items.filter((i) => i.type === 'focus');
    const pauseItems = items.filter((i) => i.type === 'pause');
    expect(focusItems).toHaveLength(3);
    expect(pauseItems).toHaveLength(2);

    // 打印真实数据供报告引用
    console.log('\n========== MANUAL TEST OUTPUT (5/3/4/2/6 场景) ==========');
    console.log(
      'segments:',
      JSON.stringify(
        snap.segments.map((s, i) => ({
          idx: i + 1,
          activeMs: s.activeElapsedMs,
          activeSec: Math.round(s.activeElapsedMs / 1000),
        })),
        null,
        2,
      ),
    );
    console.log(
      'pauseEvents:',
      JSON.stringify(
        snap.pauseEvents.map((p, i) => ({
          idx: i + 1,
          durationMs: p.durationMs,
          durationSec: Math.round(p.durationMs / 1000),
        })),
        null,
        2,
      ),
    );
    console.log(
      'mixedTimelineItems:',
      items.length,
      '条 (',
      focusItems.length,
      '专注,',
      pauseItems.length,
      '暂停)',
    );
    console.log('累计专注:', snap.activeElapsedMs, 'ms (~15s)');
    console.log('累计暂停:', snap.pauseElapsedMs, 'ms (~5s)');
    console.log('===========================================================\n');

    Date.now = realDateNow;
  });
});
