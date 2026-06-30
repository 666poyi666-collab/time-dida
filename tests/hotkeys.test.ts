import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/types';
import type { AppSettings } from '@shared/types';

let blockedAccelerators: Set<string>;
let registeredCallbacks: Map<string, () => void>;
let registerCalls: string[];
let unregisterCalls: string[];

vi.mock('electron', () => ({
  globalShortcut: {
    register: vi.fn((accelerator: string, callback: () => void) => {
      registerCalls.push(accelerator);
      if (blockedAccelerators.has(accelerator)) return false;
      registeredCallbacks.set(accelerator, callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => {
      unregisterCalls.push(accelerator);
      registeredCallbacks.delete(accelerator);
    }),
  },
  BrowserWindow: class BrowserWindow {},
}));

async function loadHotkeys() {
  vi.resetModules();
  return import('../electron/hotkeys.js');
}

function settingsWithHotkeys(hotkeys: Partial<AppSettings['hotkeys']>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    hotkeys: {
      ...DEFAULT_SETTINGS.hotkeys,
      ...hotkeys,
    },
  };
}

describe('hotkey registration regression guards', () => {
  beforeEach(() => {
    blockedAccelerators = new Set();
    registeredCallbacks = new Map();
    registerCalls = [];
    unregisterCalls = [];
  });

  it('moves the active toggle shortcut when changing to Ctrl+A', async () => {
    const hotkeys = await loadHotkeys();
    const settings = settingsWithHotkeys({
      toggleTimer: 'CommandOrControl+Alt+Space',
    });

    hotkeys.registerAllHotkeys(settings);
    const result = hotkeys.registerSingle('toggleTimer', 'CommandOrControl+A');

    expect(result.success).toBe(true);
    expect(hotkeys.getRegistrationStatus().registered.toggleTimer?.accelerator).toBe(
      'CommandOrControl+A'
    );
    expect(registeredCallbacks.has('CommandOrControl+A')).toBe(true);
    expect(registeredCallbacks.has('CommandOrControl+Alt+Space')).toBe(false);
  });

  it('restores the old shortcut when the new accelerator cannot be registered', async () => {
    const hotkeys = await loadHotkeys();
    const settings = settingsWithHotkeys({
      toggleTimer: 'CommandOrControl+Alt+Space',
    });

    hotkeys.registerAllHotkeys(settings);
    blockedAccelerators.add('CommandOrControl+A');
    const result = hotkeys.registerSingle('toggleTimer', 'CommandOrControl+A');

    expect(result.success).toBe(false);
    expect(hotkeys.getRegistrationStatus().registered.toggleTimer?.accelerator).toBe(
      'CommandOrControl+Alt+Space'
    );
    expect(registeredCallbacks.has('CommandOrControl+Alt+Space')).toBe(true);
    expect(registeredCallbacks.has('CommandOrControl+A')).toBe(false);
  });

  it('does not unregister a currently active FocusLink shortcut while testing it', async () => {
    const hotkeys = await loadHotkeys();
    const settings = settingsWithHotkeys({
      toggleTimer: 'CommandOrControl+A',
    });

    hotkeys.registerAllHotkeys(settings);
    unregisterCalls = [];
    const ok = hotkeys.testAccelerator('CommandOrControl+A');

    expect(ok).toBe(true);
    expect(unregisterCalls).not.toContain('CommandOrControl+A');
    expect(registeredCallbacks.has('CommandOrControl+A')).toBe(true);
    expect(hotkeys.getRegistrationStatus().registered.toggleTimer?.accelerator).toBe(
      'CommandOrControl+A'
    );
  });

  it('rejects duplicate assignment without moving either existing shortcut', async () => {
    const hotkeys = await loadHotkeys();
    const settings = settingsWithHotkeys({
      toggleTimer: 'CommandOrControl+A',
      stopTimer: 'CommandOrControl+Alt+Enter',
    });

    hotkeys.registerAllHotkeys(settings);
    const result = hotkeys.registerSingle('stopTimer', 'CommandOrControl+A');

    expect(result.success).toBe(false);
    expect(hotkeys.getRegistrationStatus().registered.toggleTimer?.accelerator).toBe(
      'CommandOrControl+A'
    );
    expect(hotkeys.getRegistrationStatus().registered.stopTimer?.accelerator).toBe(
      'CommandOrControl+Alt+Enter'
    );
  });
});
