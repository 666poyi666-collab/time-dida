// 统计可视化纯函数：日期×时刻矩阵、珠链几何、空数据安全
import { describe, expect, it } from 'vitest';
import {
  beadLaneAssignments,
  beadRadiusPx,
  buildRhythmMatrix,
  dayListForRange,
  localDayStart,
  matrixRowHeight,
  summarizeBeadSession,
} from '../src/features/history/insightsMath';
import type { FocusSession } from '../shared/types';

const DAY = 24 * 60 * 60_000;
const HOUR = 60 * 60_000;

function makeSession(overrides: Partial<FocusSession>): FocusSession {
  return {
    id: 's1',
    title: null,
    status: 'finished',
    startedAt: 0,
    endedAt: null,
    activeElapsedMs: 0,
    pauseElapsedMs: 0,
    wallElapsedMs: 0,
    defaultTaskId: null,
    defaultTaskSource: null,
    defaultTaskTitle: null,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('日期×时刻矩阵', () => {
  it('空数据：范围日期齐全且所有单元格为零', () => {
    const start = localDayStart(Date.now());
    const days = buildRhythmMatrix([], start, start + 7 * DAY);
    expect(days.length).toBe(7);
    for (const d of days) {
      expect(d.cells.length).toBe(24);
      expect(d.cells.every((v) => v === 0)).toBe(true);
      expect(d.active).toBe(0);
    }
  });

  it('会话跨度按小时精确切分，跨小时会话不重复计数', () => {
    const start = localDayStart(Date.now());
    const s = makeSession({
      startedAt: start + 9.5 * HOUR,
      endedAt: start + 11 * HOUR,
      wallElapsedMs: 1.5 * HOUR,
      activeElapsedMs: 80 * 60_000,
      pauseElapsedMs: 10 * 60_000,
    });
    const [day] = buildRhythmMatrix([s], start, start + DAY);
    expect(day.cells[9]).toBeCloseTo(30, 5);
    expect(day.cells[10]).toBeCloseTo(60, 5);
    expect(day.cells[11]).toBe(0);
    expect(day.cells[8]).toBe(0);
    expect(day.active).toBe(80 * 60_000);
    expect(day.pause).toBe(10 * 60_000);
  });

  it('跨午夜会话覆盖到两天', () => {
    const start = localDayStart(Date.now());
    const s = makeSession({
      startedAt: start + 23 * HOUR + 30 * 60_000,
      endedAt: start + DAY + 30 * 60_000,
      wallElapsedMs: HOUR,
    });
    const days = buildRhythmMatrix([s], start, start + 2 * DAY);
    expect(days[0].cells[23]).toBeCloseTo(30, 5);
    expect(days[1].cells[0]).toBeCloseTo(30, 5);
  });

  it('范围日期列表含首尾，跨年稳健', () => {
    const days = dayListForRange(localDayStart(Date.now()) - 2 * DAY, Date.now());
    expect(days.length).toBe(3);
  });

  it('行高随密度收缩', () => {
    expect(matrixRowHeight(7)).toBe(22);
    expect(matrixRowHeight(15)).toBe(17);
    expect(matrixRowHeight(30)).toBe(13);
  });
});

describe('会话珠链几何', () => {
  it('空统计安全：空珠链无车道分配，零时长远景珠有下限半径', () => {
    expect(beadLaneAssignments([], [])).toEqual([]);
    expect(beadRadiusPx(0, false)).toBeCloseTo(2.6, 5);
    expect(beadRadiusPx(0, true)).toBeCloseTo(4, 5);
  });

  it('珠半径随有效时长增长且封顶', () => {
    expect(beadRadiusPx(0, true)).toBeCloseTo(4, 5);
    expect(beadRadiusPx(25 * 60_000, true)).toBeCloseTo(9.5, 1);
    expect(beadRadiusPx(500 * 60_000, true)).toBe(13);
    expect(beadRadiusPx(500 * 60_000, false)).toBe(8);
  });

  it('车道避让：相邻过近的珠换道，远距离复用首道', () => {
    const lanes = beadLaneAssignments([10, 10.05, 10.8, 10.82], [8, 8, 8, 8]);
    expect(lanes[0]).toBe(0);
    expect(lanes[1]).toBe(1);
    expect(lanes[2]).toBe(0);
    expect(lanes[3]).toBeLessThanOrEqual(3);
  });

  it('会话质量口径：专注率、暂停占比、进行中标记，零时长安全', () => {
    const live = makeSession({
      status: 'active',
      activeElapsedMs: 3_600_000,
      pauseElapsedMs: 600_000,
    });
    expect(summarizeBeadSession(live)).toEqual({ rate: 6 / 7, pauseShare: 1 / 7, live: true });
    const empty = makeSession({ activeElapsedMs: 0, pauseElapsedMs: 0 });
    expect(summarizeBeadSession(empty)).toEqual({ rate: 0, pauseShare: 0, live: false });
  });
});
