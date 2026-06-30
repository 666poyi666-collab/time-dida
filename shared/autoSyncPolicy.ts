import type { AppSettings, TaskSource } from './types';

export type AutoSyncSegmentLike = {
  taskId: string | null | undefined;
  taskSource: TaskSource | null | undefined;
};

export function hasTicktickLinkedSegments(segments: readonly AutoSyncSegmentLike[]): boolean {
  return segments.some((segment) => Boolean(segment.taskId) && segment.taskSource === 'ticktick');
}

export function shouldAutoSyncFinishedSession(
  syncMode: AppSettings['syncMode'],
  segments: readonly AutoSyncSegmentLike[],
): boolean {
  if (syncMode === 'local-only') return false;
  return hasTicktickLinkedSegments(segments);
}
