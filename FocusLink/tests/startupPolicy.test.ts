import { describe, expect, it } from 'vitest';
import {
  HIDDEN_START_ARG,
  getLoginItemSettings,
  shouldAutoSelectDidaTaskSource,
  shouldStartHiddenToTray,
  shouldRunDeviceSyncAtLogin,
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

  it('keeps the desktop resident when authenticated auto sync is enabled', () => {
    expect(
      shouldRunDeviceSyncAtLogin({ autoStart: false, syncEnabled: true, autoSync: true }),
    ).toBe(true);
    expect(
      shouldRunDeviceSyncAtLogin({ autoStart: false, syncEnabled: true, autoSync: false }),
    ).toBe(false);
    expect(
      shouldRunDeviceSyncAtLogin({ autoStart: true, syncEnabled: false, autoSync: false }),
    ).toBe(true);
  });

  it('hides the main window only for explicit hidden startup modes', () => {
    expect(shouldStartHiddenToTray(false, ['FocusLink.exe'])).toBe(false);
    expect(shouldStartHiddenToTray(true, ['FocusLink.exe'])).toBe(true);
    expect(shouldStartHiddenToTray(false, ['FocusLink.exe', '--hidden'])).toBe(true);
    expect(shouldStartHiddenToTray(false, ['FocusLink.exe', '--start-minimized'])).toBe(true);
  });

  it('selects an installed dida CLI once without overriding an explicit source later', () => {
    expect(
      shouldAutoSelectDidaTaskSource({
        migrationDone: false,
        didaInstalled: true,
        taskSource: 'local',
      }),
    ).toBe(true);
    expect(
      shouldAutoSelectDidaTaskSource({
        migrationDone: true,
        didaInstalled: true,
        taskSource: 'local',
      }),
    ).toBe(false);
    expect(
      shouldAutoSelectDidaTaskSource({
        migrationDone: false,
        didaInstalled: true,
        taskSource: 'ticktick-oauth',
      }),
    ).toBe(false);
  });
});
