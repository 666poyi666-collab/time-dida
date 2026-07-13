import { describe, expect, it } from 'vitest';
import { serializeLogMeta } from '../electron/logger';

describe('serializeLogMeta', () => {
  it('preserves Error identity, message, stack and nested cause', () => {
    const cause = new Error('network unavailable');
    const error = new Error('sync failed', { cause });

    const parsed = JSON.parse(serializeLogMeta(error)) as {
      name: string;
      message: string;
      stack: string;
      cause: { message: string };
    };

    expect(parsed.name).toBe('Error');
    expect(parsed.message).toBe('sync failed');
    expect(parsed.stack).toContain('sync failed');
    expect(parsed.cause.message).toBe('network unavailable');
  });

  it('handles circular objects and bigint without throwing', () => {
    const meta: { count: bigint; self?: unknown } = { count: 7n };
    meta.self = meta;

    expect(JSON.parse(serializeLogMeta(meta))).toEqual({
      count: '7',
      self: '[Circular]',
    });
  });
});
