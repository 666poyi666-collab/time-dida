import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src', 'features', 'settings', 'SettingsPanel.tsx'),
  'utf8',
);
const preloadSource = fs.readFileSync(path.join(process.cwd(), 'electron', 'preload.ts'), 'utf8');
const ipcSource = fs.readFileSync(path.join(process.cwd(), 'electron', 'ipc.ts'), 'utf8');

describe('desktop FocusLink account settings', () => {
  it('keeps service internals out of the normal settings surface', () => {
    expect(source).not.toContain('服务地址');
    expect(source).not.toContain('访问令牌');
    expect(source).not.toContain('配对码');
    expect(source).not.toContain('编辑连接');
    expect(source).not.toContain('deviceSync.endpoint');
    expect(source).not.toContain('deviceSyncToken');
  });

  it('offers account login, sync status and logout instead', () => {
    expect(source).toContain('登录 FocusLink 账号');
    expect(source).toContain('登录后自动同步专注状态、任务和历史记录');
    expect(source).toContain('退出登录');
  });

  it('does not expose retired endpoint, token or pairing writes through renderer IPC', () => {
    expect(preloadSource).not.toContain('device-sync:configure');
    expect(preloadSource).not.toContain('device-sync:quick-setup');
    expect(preloadSource).not.toContain('device-sync:create-pairing-offer');
    expect(ipcSource).not.toContain("ipcMain.handle('device-sync:configure'");
    expect(ipcSource).not.toContain("ipcMain.handle('device-sync:quick-setup'");
    expect(ipcSource).not.toContain("ipcMain.handle('device-sync:create-pairing-offer'");
    expect(ipcSource).toContain('sanitizeRendererSettingsPatch(requested)');
  });
});
