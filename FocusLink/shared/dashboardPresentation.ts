import type { SessionAnalyticsTask } from './ipc/api';

export type DashboardTaskAllocationTone = 'linked' | 'other' | 'unlinked' | 'legacy';

export interface DashboardTaskAllocationItem {
  key: string;
  title: string;
  activeMs: number;
  tone: DashboardTaskAllocationTone;
  alpha: number;
  share: number;
  width: number;
}

export interface DashboardTaskAllocation {
  items: DashboardTaskAllocationItem[];
  linkedCount: number;
}

/** Largest-remainder rounding keeps displayed shares integral and guarantees a 100% total. */
export function largestRemainderPercentages(values: readonly number[]): number[] {
  const normalized = values.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  const total = normalized.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);

  const raw = normalized.map((value) => (value / total) * 100);
  const result = raw.map(Math.floor);
  let remaining = 100 - result.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - result[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (let cursor = 0; remaining > 0; cursor += 1, remaining -= 1) {
    result[order[cursor % order.length].index] += 1;
  }
  return result;
}

/**
 * Shared desktop/mobile task composition model. It keeps the first linked tasks readable while
 * preserving unlinked and legacy time as explicit accounting categories.
 */
export function buildDashboardTaskAllocation(
  tasks: readonly SessionAnalyticsTask[],
  totalActiveMs: number,
  primaryLimit = 4,
): DashboardTaskAllocation {
  const source = tasks
    .filter((task) => Number.isFinite(task.activeMs) && task.activeMs > 0)
    .slice()
    .sort((left, right) => right.activeMs - left.activeMs || left.title.localeCompare(right.title));
  const linked = source.filter((task) => task.taskId !== null);
  const unlinked = source.filter((task) => task.taskId === null);
  const visibleLimit = Math.max(0, Math.floor(primaryLimit));
  const primary = linked.slice(0, visibleLimit).map((task, index) => ({
    key: task.key,
    title: task.title,
    activeMs: task.activeMs,
    tone: 'linked' as const,
    alpha: Math.max(0.52, 1 - index * 0.14),
  }));
  const otherLinkedMs = linked.slice(visibleLimit).reduce((sum, task) => sum + task.activeMs, 0);
  const unlinkedMs = unlinked.reduce((sum, task) => sum + task.activeMs, 0);
  const accountedMs = source.reduce((sum, task) => sum + task.activeMs, 0);
  const normalizedTotalActiveMs = Number.isFinite(totalActiveMs) ? Math.max(0, totalActiveMs) : 0;
  const legacyMs = Math.max(0, normalizedTotalActiveMs - accountedMs);
  const items = [
    ...primary,
    ...(otherLinkedMs > 0
      ? [
          {
            key: 'other-linked',
            title: `其他已关联任务（${Math.max(0, linked.length - visibleLimit)}）`,
            activeMs: otherLinkedMs,
            tone: 'other' as const,
            alpha: 0.32,
          },
        ]
      : []),
    ...(unlinkedMs > 0
      ? [
          {
            key: 'unlinked',
            title: `未关联任务（${unlinked.length}）`,
            activeMs: unlinkedMs,
            tone: 'unlinked' as const,
            alpha: 1,
          },
        ]
      : []),
    ...(legacyMs > 0
      ? [
          {
            key: 'legacy',
            title: '旧记录（无片段归类）',
            activeMs: legacyMs,
            tone: 'legacy' as const,
            alpha: 1,
          },
        ]
      : []),
  ];
  const shares = largestRemainderPercentages(items.map((item) => item.activeMs));
  const visualTotal = Math.max(
    1,
    items.reduce((sum, item) => sum + item.activeMs, 0),
  );

  return {
    items: items.map((item, index) => ({
      ...item,
      share: shares[index] ?? 0,
      width: (item.activeMs / visualTotal) * 100,
    })),
    linkedCount: linked.length,
  };
}
