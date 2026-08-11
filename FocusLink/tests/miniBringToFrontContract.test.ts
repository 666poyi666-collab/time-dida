import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]) => fs.readFileSync(path.join(process.cwd(), ...parts), 'utf8');
const mainSource = read('electron', 'main.ts');
const preloadSource = read('electron', 'preload.ts');
const apiSource = read('shared', 'ipc', 'api.ts');
const settingsSource = read('src', 'features', 'settings', 'SettingsPanel.tsx');
const miniSource = read('src', 'features', 'mini', 'MiniWindow.tsx');

describe('mini window bring-to-front contract', () => {
  it('exposes one dedicated request from settings to the native window owner', () => {
    expect(apiSource).toContain('bringToFront(): Promise<boolean>');
    expect(preloadSource).toContain("ipcRenderer.invoke('mini:bring-to-front')");
    expect(mainSource).toContain("ipcMain.handle('mini:bring-to-front'");
    expect(settingsSource).toContain('置于最顶层');
    expect(settingsSource).toContain('window.focuslink.mini.bringToFront()');
  });

  it('reasserts topmost order without changing bounds, settings, or focus', () => {
    const start = mainSource.indexOf('function bringMiniWindowToFront()');
    const end = mainSource.indexOf('function toggleMainWindow()', start);
    const implementation = mainSource.slice(start, end);

    expect(implementation).toContain('showInactive()');
    expect(implementation).toContain('setAlwaysOnTop(true)');
    expect(implementation).toContain('moveTop()');
    expect(implementation).not.toContain('setBounds(');
    expect(implementation).not.toContain('updateSettings(');
    expect(implementation).not.toContain('.focus(');
  });

  it('does not add another control to either fixed mini renderer state', () => {
    expect(miniSource).not.toContain('bringToFront');
    expect(miniSource).not.toContain('置于最顶层');
  });
});
