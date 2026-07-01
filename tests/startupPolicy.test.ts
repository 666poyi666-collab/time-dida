import { describe, expect, it } from 'vitest';
import {
  HIDDEN_START_ARG,
  getLoginItemSettings,
  shouldStartHiddenToTray,
} from '../shared/startupPolicy';

describe('startup policy', () => {
  it('registers auto-start with a hidden launch argument', () => {
    expect(getLoginItemSettings(true)).toEqual({
      openAtLogin: true,
      args: [HIDDEN_START_ARG],
    });
    expect(getLoginItemSettings(false)).toEqual({
      openAtLogin: false,
      args: [],
    });
  });

  it('hides the main window only for explicit hidden startup modes', () => {
    expect(shouldStartHiddenToTray(false, ['FocusLink.exe'])).toBe(false);
    expect(shouldStartHiddenToTray(true, ['FocusLink.exe'])).toBe(true);
    expect(shouldStartHiddenToTray(false, ['FocusLink.exe', '--hidden'])).toBe(true);
    expect(shouldStartHiddenToTray(false, ['FocusLink.exe', '--start-minimized'])).toBe(true);
  });
});
