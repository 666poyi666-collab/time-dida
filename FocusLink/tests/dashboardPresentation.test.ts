import { describe, expect, it } from 'vitest';
import {
  buildDashboardTaskAllocation,
  largestRemainderPercentages,
} from '@shared/dashboardPresentation';
import type { SessionAnalyticsTask } from '@shared/ipc/api';

describe('dashboard presentation model', () => {
  it('uses largest-remainder rounding with a stable 100 percent total', () => {
    expect(largestRemainderPercentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(largestRemainderPercentages([0, Number.NaN, -5])).toEqual([0, 0, 0]);
  });

  it('shares the same linked, unlinked and legacy task accounting across renderers', () => {
    const tasks: SessionAnalyticsTask[] = [
      task('linked-1', '函数复习', 'task-1', 50),
      task('linked-2', '英语阅读', 'task-2', 30),
      task('linked-3', '化学订正', 'task-3', 20),
      task('linked-4', '物理题', 'task-4', 15),
      task('linked-5', '语文摘录', 'task-5', 10),
      task('unlinked-1', '临时复盘', null, 5),
    ];
    const allocation = buildDashboardTaskAllocation(tasks, 140);

    expect(allocation.linkedCount).toBe(5);
    expect(allocation.items.map((item) => item.tone)).toEqual([
      'linked',
      'linked',
      'linked',
      'linked',
      'other',
      'unlinked',
      'legacy',
    ]);
    expect(allocation.items.find((item) => item.tone === 'other')).toMatchObject({
      title: '其他已关联任务（1）',
      activeMs: 10,
    });
    expect(allocation.items.find((item) => item.tone === 'unlinked')).toMatchObject({
      title: '未关联任务（1）',
      activeMs: 5,
    });
    expect(allocation.items.find((item) => item.tone === 'legacy')).toMatchObject({
      title: '旧记录（无片段归类）',
      activeMs: 10,
    });
    expect(allocation.items.reduce((sum, item) => sum + item.share, 0)).toBe(100);
    expect(allocation.items.reduce((sum, item) => sum + item.width, 0)).toBeCloseTo(100);
  });
});

function task(
  key: string,
  title: string,
  taskId: string | null,
  activeMs: number,
): SessionAnalyticsTask {
  return { key, title, taskId, activeMs, segmentCount: 1 };
}
