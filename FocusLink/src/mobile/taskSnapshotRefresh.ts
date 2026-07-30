import { TASK_SNAPSHOT_REFRESH_INTERVAL_MS } from '@shared/sync/taskSnapshotProtocol';

export function startVisibleTaskSnapshotRefresh(
  refresh: () => void,
  isVisible: () => boolean,
): () => void {
  const timer = globalThis.setInterval(() => {
    if (isVisible()) refresh();
  }, TASK_SNAPSHOT_REFRESH_INTERVAL_MS);
  return () => globalThis.clearInterval(timer);
}
