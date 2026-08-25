import { describe, expect, it } from 'vitest';

import { readBoundedBody } from '../src/bounded-body';

describe('bounded stream reader', () => {
  it('cancels immediately when declared content length exceeds the limit', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readBoundedBody(body, new Headers({ 'content-length': '11' }), 10),
    ).rejects.toMatchObject({ reason: 'too_large' });
    expect(cancelled).toBe(true);
  });

  it('stops streaming at the byte boundary instead of buffering the full body', async () => {
    let cancelled = false;
    let emitted = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        emitted += 1;
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readBoundedBody(body, new Headers(), 10)).rejects.toMatchObject({
      reason: 'too_large',
    });
    expect(emitted).toBe(3);
    expect(cancelled).toBe(true);
  });

  it('returns an exact byte sequence under the limit', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    expect([...(await readBoundedBody(body, new Headers(), 3))]).toEqual([1, 2, 3]);
  });
});
