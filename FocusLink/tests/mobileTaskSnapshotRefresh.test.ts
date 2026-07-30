import { afterEach, describe, expect, it, vi } from 'vitest';
import { TASK_SNAPSHOT_REFRESH_INTERVAL_MS } from '../shared/sync/taskSnapshotProtocol';
import {
  createTaskSnapshotRequestLifecycle,
  startVisibleTaskSnapshotRefresh,
  type TaskSnapshotRequestLease,
} from '../src/mobile/taskSnapshotRefresh';

afterEach(() => vi.useRealTimers());

describe('mobile task snapshot foreground cadence', () => {
  it('refreshes every 15 seconds only while visible and stops cleanly', async () => {
    vi.useFakeTimers();
    let visible = true;
    const refresh = vi.fn();
    const stop = startVisibleTaskSnapshotRefresh(refresh, () => visible);

    expect(TASK_SNAPSHOT_REFRESH_INTERVAL_MS).toBe(15_000);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    visible = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    visible = true;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('cannot commit a delayed old-account revision after a new account starts at revision 1', async () => {
    const lifecycle = createTaskSnapshotRequestLifecycle();
    const commits: Array<{ account: string; revision: number }> = [];
    let resolveOld!: (revision: number) => void;
    let resolveNew!: (revision: number) => void;
    const oldResponse = new Promise<number>((resolve) => {
      resolveOld = resolve;
    });
    const newResponse = new Promise<number>((resolve) => {
      resolveNew = resolve;
    });
    const commitWhenCurrent = async (
      request: TaskSnapshotRequestLease,
      account: string,
      response: Promise<number>,
    ) => {
      const revision = await response;
      if (request.isCurrent()) commits.push({ account, revision });
      request.finish();
    };

    const oldRequest = lifecycle.issue('account-a');
    const oldCommit = commitWhenCurrent(oldRequest, 'account-a', oldResponse);
    const newRequest = lifecycle.issue('account-b');
    const newCommit = commitWhenCurrent(newRequest, 'account-b', newResponse);
    expect(oldRequest.signal.aborted).toBe(true);

    resolveNew(1);
    await newCommit;
    resolveOld(36);
    await oldCommit;
    expect(commits).toEqual([{ account: 'account-b', revision: 1 }]);
  });
});
