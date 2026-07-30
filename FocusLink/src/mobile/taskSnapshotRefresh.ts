import { TASK_SNAPSHOT_REFRESH_INTERVAL_MS } from '@shared/sync/taskSnapshotProtocol';
import {
  createMobileAccountRequestLifecycle,
  type MobileAccountRequestLease,
  type MobileAccountRequestLifecycle,
} from './accountLifecycle';

export type TaskSnapshotRequestLease = MobileAccountRequestLease;
export type TaskSnapshotRequestLifecycle = MobileAccountRequestLifecycle;

export function createTaskSnapshotRequestLifecycle(): TaskSnapshotRequestLifecycle {
  return createMobileAccountRequestLifecycle();
}

export function startVisibleTaskSnapshotRefresh(
  refresh: () => void,
  isVisible: () => boolean,
): () => void {
  const timer = globalThis.setInterval(() => {
    if (isVisible()) refresh();
  }, TASK_SNAPSHOT_REFRESH_INTERVAL_MS);
  return () => globalThis.clearInterval(timer);
}
