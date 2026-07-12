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

export function shouldDeleteDidaFocusRecord(
  segment: { taskSource: TaskSource | null | undefined; cloudFocusId: string | null | undefined },
  configuredTaskSource: AppSettings['taskSource'],
): boolean {
  // A persisted cloud id is authoritative even if the user switched providers later. Without an
  // id, ticktick is only a local association label; marker lookup belongs to the dida provider.
  return (
    Boolean(segment.cloudFocusId) ||
    (segment.taskSource === 'ticktick' && configuredTaskSource !== 'ticktick-oauth')
  );
}
