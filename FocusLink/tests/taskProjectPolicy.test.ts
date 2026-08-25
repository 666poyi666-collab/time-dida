import { describe, expect, it } from 'vitest';
import {
  defaultTaskProjectColor,
  FOCUSLINK_INBOX_PROJECT_ID,
  isFocusLinkInboxProject,
  normalizeTaskProjectColor,
  TASK_PROJECT_COLOR_PALETTE,
} from '../shared/taskProjectPolicy';

describe('FocusLink task project policy', () => {
  it('keeps the inbox as a stable real project identity', () => {
    expect(FOCUSLINK_INBOX_PROJECT_ID).toBe('local-inbox');
    expect(isFocusLinkInboxProject('local-inbox')).toBe(true);
    expect(isFocusLinkInboxProject(null)).toBe(false);
  });

  it('assigns independent palette values deterministically', () => {
    expect(defaultTaskProjectColor(0)).toBe(TASK_PROJECT_COLOR_PALETTE[0]);
    expect(defaultTaskProjectColor(1)).toBe(TASK_PROJECT_COLOR_PALETTE[1]);
    expect(defaultTaskProjectColor(TASK_PROJECT_COLOR_PALETTE.length)).toBe(
      TASK_PROJECT_COLOR_PALETTE[0],
    );
  });

  it('fails closed to the FocusLink accent for arbitrary CSS values', () => {
    expect(normalizeTaskProjectColor('#2F6FED')).toBe('#2f6fed');
    expect(normalizeTaskProjectColor('url(javascript:alert(1))')).toBe('#16899f');
  });
});
