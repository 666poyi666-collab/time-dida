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
    expect(source).not.toContain('编辑连接');
    expect(source).not.toContain('deviceSync.endpoint');
    expect(source).not.toContain('deviceSyncToken');
  });

  it('offers trusted-device pairing, recovery, sync status and logout', () => {
    expect(source).toContain('FocusLink 设备授权');
    expect(source).toContain('输入 8 位配对码');
    expect(source).toContain('添加设备');
    expect(source).toContain('首台设备或恢复账号');
    expect(source).toContain('本机功能不依赖登录');
    expect(source).toContain('退出登录');
  });

  it('keeps external task adapters behind an explicit collapsed import entry', () => {
    expect(source).toContain('settings-external-task-disclosure');
    expect(source).toContain('外部任务导入');
    expect(source).toContain("section.id === 'dida-sync'");
    expect(source).toContain("settings.taskSource !== 'local'");
    expect(source).toContain("section.id === 'dida-oauth'");
    expect(source).toContain("settings.taskSource === 'ticktick-oauth'");
  });

  it('renders device-sync health from the machine-code presentation with its durable conflict count', () => {
    expect(source).toContain(
      "import { presentDeviceSyncError } from './deviceSyncStatusPresentation';",
    );
    expect(source).toMatch(
      /presentDeviceSyncError\(\s*deviceSyncStatus\?\.lastError,\s*deviceSyncStatus\?\.unresolvedConflicts,\s*\)/,
    );
    expect(source).not.toContain('deviceSyncTransportUnavailable');
    expect(source).not.toContain('deviceSyncConflictOnly');
    expect(source).not.toContain('无法连接跨设备同步服务|跨设备同步请求超时');
  });

  it('does not expose retired endpoint, token or pairing writes through renderer IPC', () => {
    expect(preloadSource).not.toContain('device-sync:configure');
    expect(preloadSource).not.toContain('device-sync:quick-setup');
    expect(preloadSource).not.toContain('device-sync:create-pairing-offer');
    expect(ipcSource).not.toContain("ipcMain.handle('device-sync:configure'");
    expect(ipcSource).not.toContain("ipcMain.handle('device-sync:quick-setup'");
    expect(ipcSource).not.toContain("ipcMain.handle('device-sync:create-pairing-offer'");
    expect(preloadSource).toContain('device-sync:create-pairing-code');
    expect(preloadSource).toContain('device-sync:redeem-pairing-code');
    expect(ipcSource).toContain("ipcMain.handle('device-sync:create-pairing-code'");
    expect(ipcSource).toContain("ipcMain.handle('device-sync:redeem-pairing-code'");
    expect(ipcSource).toContain('sanitizeRendererSettingsPatch(requested)');
  });
});
