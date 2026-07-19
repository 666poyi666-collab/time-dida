// 统计可视化的纯函数内核：日期×时刻矩阵覆盖、会话珠链几何。
// 与渲染解耦，供 HistoryInsights 与 vitest 共用。所有值都由真实会话起止导出，不虚构。
import type { FocusSession } from '@shared/types';

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

export interface MatrixDay {
  dayStart: number;
  label: string;
  active: number;
  pause: number;
  /** 24 小时每格：会话墙钟跨度覆盖到该小时的分钟数（精确切分） */
  cells: number[];
}

export function localDayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayListForRange(start: number, end: number): number[] {
  const days: number[] = [];
  for (let d = localDayStart(start); d <= localDayStart(end - 1); d += DAY_MS) {
    days.push(d);
  }
  return days;
}

/** 日期×时刻矩阵：单元格 = 会话跨度与该小时的精确重叠分钟；行合计 = 当日有效/暂停。 */
export function buildRhythmMatrix(
  sessions: FocusSession[],
  start: number,
  end: number,
): MatrixDay[] {
  const days = dayListForRange(start, end).map((dayStart) => ({
    dayStart,
    label: `${new Date(dayStart).getMonth() + 1}/${new Date(dayStart).getDate()}`,
    active: 0,
    pause: 0,
    cells: new Array(24).fill(0) as number[],
  }));
  for (const s of sessions) {
    const a = s.startedAt;
    const b = s.endedAt ?? a + s.wallElapsedMs;
    const day = days.find((x) => a >= x.dayStart && a < x.dayStart + DAY_MS);
    if (day) {
      day.active += s.activeElapsedMs;
      day.pause += s.pauseElapsedMs;
    }
    for (const x of days) {
      for (let h = 0; h < 24; h += 1) {
        const h0 = x.dayStart + h * HOUR_MS;
        const overlap = Math.max(0, Math.min(b, h0 + HOUR_MS) - Math.max(a, h0));
        if (overlap > 0) x.cells[h] += overlap / 60_000;
      }
    }
  }
  return days;
}

/** 矩阵行高：行数越多行越矮（密读优先） */
export function matrixRowHeight(dayCount: number): number {
  return dayCount > 21 ? 13 : dayCount > 10 ? 17 : 22;
}

/** 会话珠半径：单日大珠 4..13px，多日小珠 2.6..8px，随有效时长开方增长 */
export function beadRadiusPx(activeMs: number, singleDay: boolean): number {
  const min = activeMs / 60_000;
  return singleDay
    ? Math.min(13, 4 + Math.sqrt(min) * 1.1)
    : Math.min(8, 2.6 + Math.sqrt(min) * 0.55);
}

/** 单日珠链车道分配：同一车道相邻珠心距不足时换道（最多 4 道） */
export function beadLaneAssignments(xs: number[], radii: number[]): number[] {
  const lanes: number[] = [];
  return xs.map((x, i) => {
    let lane = 0;
    while (lanes[lane] !== undefined && x - lanes[lane] < (radii[i] * 2) / 60) lane += 1;
    lanes[lane] = x;
    return Math.min(lane, 3);
  });
}

/** 会话有效/暂停的合计与专注率（空输入安全） */
export function summarizeBeadSession(session: FocusSession): {
  rate: number;
  pauseShare: number;
  live: boolean;
} {
  const tracked = session.activeElapsedMs + session.pauseElapsedMs;
  return {
    rate: tracked > 0 ? session.activeElapsedMs / tracked : 0,
    pauseShare: tracked > 0 ? session.pauseElapsedMs / tracked : 0,
    live: session.status === 'active',
  };
}
