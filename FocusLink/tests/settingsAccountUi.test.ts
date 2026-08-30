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

  it('offers direct local pairing, sync status and logout', () => {
    expect(source).toContain('FocusLink 设备配对');
    expect(source).toContain('8 位设备配对码');
    expect(source).toContain('显示本机配对码');
    expect(source).toContain('已配对设备');
    expect(source).toContain('删除设备');
    expect(source).toContain('输入一次就能把两台连起来');
    expect(source).not.toContain('首次授权（只需一次）');
    expect(source).toContain('本机功能不依赖账号');
    expect(source).toContain('退出此设备同步');
    expect(source).toContain("deviceSyncBusyAction === 'pair-code'");
    expect(source).toContain("deviceSyncBusyAction === 'redeem'");
    expect(source).toContain('<Icon.Refresh size="xs" />');
  });

  it('offers eight distinct desktop interface-font previews', () => {
    for (const profile of [
      'noto',
      'noto-serif',
      'wenkai',
      'zhisong',
      'marker',
      'xihei',
      'smiley',
      'kuaile',
    ]) {
      expect(source).toContain(`id: '${profile}'`);
    }
    expect(source).toContain("label: '思源宋体'");
    expect(source).toContain("label: '站酷快乐体'");
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
    expect(source).toContain("} from './deviceSyncStatusPresentation';");
    expect(source).toMatch(
      /presentDeviceSyncError\(\s*deviceSyncStatus\?\.lastError,\s*deviceSyncStatus\?\.unresolvedConflicts,\s*\)/,
    );
    expect(source).not.toContain('deviceSyncTransportUnavailable');
    expect(source).not.toContain('deviceSyncConflictOnly');
    expect(source).not.toContain('无法连接跨设备同步服务|跨设备同步请求超时');
    expect(source).toContain('presentDeviceSyncOverview(deviceSyncStatus)');
    expect(source).toContain('deviceSyncOverview.latestSuccess');
    expect(source).toContain('settings-diagnostic-kind');
    expect(source).not.toContain('当前设备 · 正在同步');
  });

  it('separates TomaToDo local, bridge, upload and phone-delivery facts', () => {
    expect(source).toContain("label: '本机写入'");
    expect(source).toContain("label: '上传队列'");
    expect(source).toContain("label: '手机端显示'");
    expect(source).toContain('presentTomatodoBridgeStatus(tomatodoBridge)');
    expect(source).toContain('上传确认不能代替手机投递确认');
    expect(source).toContain('检查状态');
    expect(source).not.toContain("return tomatodoBridge.error || '连接失败，可重新尝试'");
  });

  it('does not expose retired endpoint, token or pairing writes through renderer IPC', () => {
    expect(preloadSource).not.toContain('device-sync:configure');
    expect(preloadSource).not.toContain('device-sync:quick-setup');
    expect(preloadSource).not.toContain('device-sync:create-pairing-offer');
    expect(ipcSource).not.toContain("ipcMain.handle('device-sync:configure'");
    expect(ipcSource).not.toContain("ipcMain.handle('device-sync:quick-setup'");
    expect(ipcSource).not.toContain("ipcMain.handle('device-sync:create-pairing-offer'");
    expect(preloadSource).toContain('device-sync:create-pairing-code');
    expect(preloadSource).toContain('device-sync:poll-pairing-code');
    expect(preloadSource).toContain('device-sync:approve-pairing-code');
    expect(preloadSource).toContain('device-sync:redeem-pairing-code');
    expect(ipcSource).toContain("ipcMain.handle('device-sync:create-pairing-code'");
    expect(ipcSource).toContain("ipcMain.handle('device-sync:poll-pairing-code'");
    expect(ipcSource).toContain("ipcMain.handle('device-sync:approve-pairing-code'");
    expect(ipcSource).toContain("ipcMain.handle('device-sync:redeem-pairing-code'");
    expect(ipcSource).toContain('sanitizeRendererSettingsPatch(requested)');
  });
});
