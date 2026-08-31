import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const settingsSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'mobile', 'SettingsView.tsx'),
  'utf8',
);
const controlsSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'mobile', 'NativeSystemControls.tsx'),
  'utf8',
);

describe('mobile 1.3 settings UI', () => {
  it('uses plain sync labels and explains ledger freshness without mixing task state', () => {
    expect(settingsSource).toContain('label="账本新鲜度"');
    expect(settingsSource).toContain('label="任务同步"');
    expect(settingsSource).toContain('label="本机专注记录"');
    expect(settingsSource).toContain('它不是网速，也不代表任务同步状态');
    expect(settingsSource).not.toContain('label="任务快照"');
    expect(settingsSource).not.toContain('label="本机会话"');
  });

  it('renders themes and every font as immediate, accessible choices', () => {
    expect(settingsSource).toContain('className="appearance-segmented"');
    expect(settingsSource).toContain('aria-pressed={appearance.theme === value}');
    expect(settingsSource).toContain('className="appearance-font-choices"');
    expect(settingsSource).toContain('data-font-profile={profile}');
    expect(settingsSource).toContain('aria-pressed={appearance.fontProfile === profile}');
    expect(settingsSource).toContain('className="appearance-font-sample"');
    expect(settingsSource).not.toMatch(/appearance-font-controls[\s\S]{0,800}<select/);
  });

  it('shows a batch permission action backed by per-item readback states', () => {
    expect(controlsSource).toContain('requestNativeAllPermissions');
    expect(controlsSource).toContain('一键获取全部权限');
    expect(controlsSource).toContain("item.state === 'granted'");
    expect(controlsSource).toContain("state: 'manual-required'");
    expect(controlsSource).toContain('root 已确认；可自动项已执行并回读，自启动需手动');
    expect(controlsSource).toContain('setStatus(null)');
    expect(controlsSource).toContain('await refreshStatus().catch(() => undefined)');
  });
});
