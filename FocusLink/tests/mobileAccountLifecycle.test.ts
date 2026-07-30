import { describe, expect, it } from 'vitest';
import {
  createMobileAccountLifecycle,
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

  it('keeps a confirmed native login current when account-cache cleanup fails', async () => {
    const lifecycle = createMobileAccountLifecycle();
    const operation = lifecycle.issue();
    const result = await runMobileAccountCommit(
      lifecycle,
      operation,
      async () => undefined,
      async () => {
        throw new DOMException('IndexedDB unavailable', 'UnknownError');
      },
    );
    expect(result).toEqual({ current: true, issues: ['account-cache'] });
  });

  it('rejects logout when the durable native clear fails and never authorizes renderer commit', async () => {
    const lifecycle = createMobileAccountLifecycle();
    const operation = lifecycle.invalidate();
    await expect(
      runMobileAccountLogout(lifecycle, operation, async () => {
        throw new Error('Keystore commit failed');
      }),
    ).rejects.toThrow('Keystore commit failed');
    expect(lifecycle.isCurrent(operation)).toBe(true);
  });
});
