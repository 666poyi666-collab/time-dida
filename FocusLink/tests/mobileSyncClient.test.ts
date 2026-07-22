import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLiveFocusSnapshot,
  isInvalidDeviceSyncCursorError,
  pullDeviceSyncPage,
} from '../src/mobile/syncClient';

describe('mobile sync client request recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('times out a dead connection instead of leaving the live loop hung forever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        });
      }),
    );

    const request = fetchLiveFocusSnapshot({
      endpoint: 'https://sync.example.test',
      token: 'test-token',
    });
    const assertion = expect(request).rejects.toThrow('实时同步请求超时，正在重连');
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it('preserves an explicit caller abort so stale account requests stay silent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        });
      }),
    );
    const controller = new AbortController();
    const request = fetchLiveFocusSnapshot({
      endpoint: 'https://sync.example.test',
      token: 'test-token',
      signal: controller.signal,
    });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('preserves the invalid_cursor error code for one-shot account cache recovery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'invalid_cursor', message: 'cursor is invalid for this account' },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const request = pullDeviceSyncPage({
      endpoint: 'https://sync.example.test',
      token: 'test-token',
      deviceId: 'tablet',
      cursor: 'old-account-cursor',
    });
    await expect(request).rejects.toSatisfy(isInvalidDeviceSyncCursorError);
  });
});
