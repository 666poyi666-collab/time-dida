import { describe, expect, it } from 'vitest';
import { MAIN_WINDOW_DEFAULT_SIZE, MAIN_WINDOW_MIN_SIZE } from '../shared/mainWindowLayout';

describe('main window layout policy', () => {
  it('keeps the redesigned default and minimum bounds explicit', () => {
    expect(MAIN_WINDOW_DEFAULT_SIZE).toEqual({ width: 1240, height: 800 });
    expect(MAIN_WINDOW_MIN_SIZE).toEqual({ width: 980, height: 660 });
    expect(MAIN_WINDOW_DEFAULT_SIZE.width).toBeGreaterThan(MAIN_WINDOW_MIN_SIZE.width);
    expect(MAIN_WINDOW_DEFAULT_SIZE.height).toBeGreaterThan(MAIN_WINDOW_MIN_SIZE.height);
  });
});
