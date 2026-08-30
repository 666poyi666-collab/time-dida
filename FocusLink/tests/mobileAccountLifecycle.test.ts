import { describe, expect, it, vi } from 'vitest';
import {
  createMobileAccountLifecycle,
  createMobileAccountRequestCoalescer,
  createMobileAccountRequestLifecycle,
  isMobileAccountRequestCommitCurrent,
  mobileAccountConnectionKey,
  runMobileAccountCommit,
  runMobileAccountLogout,
} from '../src/mobile/accountLifecycle';

describe('mobile account operation lifecycle', () => {
  it('invalidates stale account operations and gives the newest operation sole authority', () => {
    const lifecycle = createMobileAccountLifecycle();
    const restore = lifecycle.issue();
    expect(lifecycle.isCurrent(restore)).toBe(true);

    lifecycle.invalidate();
    expect(lifecycle.isCurrent(restore)).toBe(false);

    const login = lifecycle.issue();
    expect(lifecycle.isCurrent(login)).toBe(true);
    expect(lifecycle.isCurrent(restore)).toBe(false);
  });

  it('serializes an old Keystore write, logout clear and later login write', async () => {
    const lifecycle = createMobileAccountLifecycle();
    const events: string[] = [];
    let releaseOldWrite!: () => void;
    const oldWriteGate = new Promise<void>((resolve) => {
      releaseOldWrite = resolve;
    });

    const oldOperation = lifecycle.issue();
    const oldWrite = lifecycle.enqueueNative(async () => {
      events.push('old-write:start');
      await oldWriteGate;
      events.push('old-write:end');
    });
    lifecycle.invalidate();
    const clear = lifecycle.enqueueNative(async () => {
      events.push('logout:clear');
    });
    const newOperation = lifecycle.issue();
    const newWrite = lifecycle.enqueueNative(async () => {
      events.push('new-write');
    });

    expect(lifecycle.isCurrent(oldOperation)).toBe(false);
    expect(lifecycle.isCurrent(newOperation)).toBe(true);
    releaseOldWrite();
    await Promise.all([oldWrite, clear, newWrite]);
    expect(events).toEqual(['old-write:start', 'old-write:end', 'logout:clear', 'new-write']);
  });

  it('treats endpoint or token changes as different account-scoped state', () => {
    const current = mobileAccountConnectionKey({ endpoint: 'https://sync.test', token: 'token-a' });
    expect(mobileAccountConnectionKey({ endpoint: 'https://sync.test', token: 'token-a' })).toBe(
      current,
    );
    expect(
      mobileAccountConnectionKey({ endpoint: 'https://sync.test', token: 'token-b' }),
    ).not.toBe(current);
    expect(
      mobileAccountConnectionKey({ endpoint: 'https://other.test', token: 'token-a' }),
    ).not.toBe(current);
  });

  it('aborts an old live command lease and forbids its catch/finally UI commit after rebind', () => {
    const requests = createMobileAccountRequestLifecycle();
    const old = requests.issue('account-a');
    expect(old.isCurrent()).toBe(true);

    const current = requests.issue('account-b');
    expect(old.signal.aborted).toBe(true);
    expect(old.isCurrent()).toBe(false);
    expect(current.isCurrent()).toBe(true);

    old.finish();
    expect(current.isCurrent()).toBe(true);
    current.finish();
    expect(current.isCurrent()).toBe(false);
  });

  it('shares one same-account refresh between background cadence and a foreground mutation', async () => {
    const coalescer = createMobileAccountRequestCoalescer<number>();
    let resolve!: (value: number) => void;
    const operation = vi.fn(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    );

    const background = coalescer.run('account-a', operation);
    const foreground = coalescer.run('account-a', operation);
    expect(foreground).toBe(background);
    await Promise.resolve();
    expect(operation).toHaveBeenCalledTimes(1);
    resolve(71);
    await expect(Promise.all([background, foreground])).resolves.toEqual([71, 71]);
  });

  it('starts a new refresh for a different account without stale cleanup clearing it', async () => {
    const coalescer = createMobileAccountRequestCoalescer<string>();
    let resolveOld!: (value: string) => void;
    let resolveNew!: (value: string) => void;
    const old = coalescer.run(
      'account-a',
      () => new Promise<string>((resolve) => (resolveOld = resolve)),
    );
    const current = coalescer.run(
      'account-b',
      () => new Promise<string>((resolve) => (resolveNew = resolve)),
    );
    await Promise.resolve();
    resolveOld('old');
    await expect(old).resolves.toBe('old');
    expect(coalescer.run('account-b', () => Promise.resolve('unexpected'))).toBe(current);
    resolveNew('current');
    await expect(current).resolves.toBe('current');
  });

  it('blocks stale request commits throughout an account transition and after a key switch', () => {
    const baseline = {
      requestCurrent: true,
      requestConnectionKey: 'account-a',
      currentConnectionKey: 'account-a',
      transitionOperation: null,
    };
    expect(isMobileAccountRequestCommitCurrent(baseline)).toBe(true);
    expect(isMobileAccountRequestCommitCurrent({ ...baseline, transitionOperation: 7 })).toBe(
      false,
    );
    expect(
      isMobileAccountRequestCommitCurrent({ ...baseline, currentConnectionKey: 'account-b' }),
    ).toBe(false);
    expect(isMobileAccountRequestCommitCurrent({ ...baseline, requestCurrent: false })).toBe(false);
  });

  it('keeps a confirmed native login current when account-cache cleanup fails', async () => {
    const lifecycle = createMobileAccountLifecycle();
    const operation = lifecycle.issue();
    const result = await runMobileAccountCommit(
      lifecycle,
      operation,
      {
        async read() {
          return 'baseline';
        },
        async mutate() {
          return 'account-a';
        },
        async restore() {
          throw new Error('restore must not run for a current operation');
        },
      },
      async () => {
        throw new DOMException('IndexedDB unavailable', 'UnknownError');
      },
    );
    expect(result).toEqual({
      current: true,
      issues: ['account-cache'],
      nativeState: 'account-a',
    });
  });

  it('rejects logout when the durable native clear fails and never authorizes renderer commit', async () => {
    const lifecycle = createMobileAccountLifecycle();
    const operation = lifecycle.invalidate();
    await expect(
      runMobileAccountLogout(
        lifecycle,
        operation,
        {
          async read() {
            return 'account-a';
          },
          async mutate() {
            throw new Error('Keystore commit failed');
          },
          async restore() {
            throw new Error('restore must not run after a rejected clear');
          },
        },
        async () => [],
      ),
    ).rejects.toThrow('Keystore commit failed');
    expect(lifecycle.isCurrent(operation)).toBe(true);
  });

  it('rolls a blocked stale login back inside the native queue when its superseder never writes', async () => {
    const lifecycle = createMobileAccountLifecycle();
    const events: string[] = [];
    let nativeState = 'baseline';
    let releaseMutation!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const operation = lifecycle.issue();
    const pending = runMobileAccountCommit(
      lifecycle,
      operation,
      {
        async read() {
          events.push(`read:${nativeState}`);
          return nativeState;
        },
        async mutate() {
          events.push('apply:start');
          await gate;
          nativeState = 'account-a';
          events.push('apply:end');
          return nativeState;
        },
        async restore(baseline, applied) {
          events.push(`rollback:${applied}->${baseline}`);
          nativeState = baseline;
        },
      },
      async () => {
        events.push('reset');
        return [];
      },
    );

    await vi.waitFor(() => expect(events).toContain('apply:start'));
    lifecycle.issue();
    releaseMutation();

    await expect(pending).resolves.toEqual({ current: false, issues: [] });
    expect(nativeState).toBe('baseline');
    expect(events).toEqual([
      'read:baseline',
      'apply:start',
      'apply:end',
      'rollback:account-a->baseline',
    ]);
  });

  it('rolls a stale logout clear back before a waiting bootstrap can fail', async () => {
    const lifecycle = createMobileAccountLifecycle();
    let nativeState = 'account-a';
    let releaseClear!: () => void;
    let markClearStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });
    const clearStarted = new Promise<void>((resolve) => {
      markClearStarted = resolve;
    });
    const operation = lifecycle.invalidate();
    const pending = runMobileAccountLogout(
      lifecycle,
      operation,
      {
        async read() {
          return nativeState;
        },
        async mutate() {
          markClearStarted();
          await gate;
          nativeState = 'cleared';
          return nativeState;
        },
        async restore(baseline) {
          nativeState = baseline;
        },
      },
      async () => [],
    );

    await clearStarted;
    lifecycle.issue();
    releaseClear();
    await expect(pending).resolves.toEqual({ current: false, issues: [] });
    expect(nativeState).toBe('account-a');
  });

  it('never starts a native mutation for an operation that went stale in the queue', async () => {
    const lifecycle = createMobileAccountLifecycle();
    let releaseQueue!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const blocker = lifecycle.enqueueNative(() => gate);
    const operation = lifecycle.issue();
    const mutate = vi.fn(async () => 'account-a');
    const pending = runMobileAccountCommit(
      lifecycle,
      operation,
      {
        read: async () => 'baseline',
        mutate,
        restore: async () => undefined,
      },
      async () => [],
    );
    lifecycle.issue();
    releaseQueue();
    await blocker;

    await expect(pending).resolves.toEqual({ current: false, issues: [] });
    expect(mutate).not.toHaveBeenCalled();
  });
});
