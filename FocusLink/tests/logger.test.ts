import { describe, expect, it } from 'vitest';
import {
  MAX_LOG_FILE_BYTES,
  serializeLogMeta,
  shouldMirrorErrorToConsole,
  writeConsoleErrorSafely,
} from '../electron/logger';

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

describe('logger output safety', () => {
  it('swallows a detached stderr EPIPE instead of creating an exception loop', () => {
    const error = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
    expect(
      writeConsoleErrorSafely('fatal diagnostic', () => {
        throw error;
      }),
    ).toBe(false);
  });

  it('caps each physical log file at a bounded diagnostic size', () => {
    expect(MAX_LOG_FILE_BYTES).toBe(20 * 1024 * 1024);
  });

  it('never mirrors packaged errors into inherited stdout or stderr pipes', () => {
    expect(shouldMirrorErrorToConsole(true, true)).toBe(false);
    expect(shouldMirrorErrorToConsole(false, true)).toBe(true);
    expect(shouldMirrorErrorToConsole(false, false)).toBe(false);
  });
});
