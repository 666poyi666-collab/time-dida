import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const installerScript = readFileSync(resolve('build/installer.nsh'), 'utf8');
const builderConfig = readFileSync(resolve('electron-builder.yml'), 'utf8');

describe('Windows installer process policy', () => {
  it('keeps the smoke bypass and closes current-user instances without enumeration', () => {
    expect(builderConfig).toContain('include: build/installer.nsh');
    expect(installerScript).toContain('FOCUSLINK_INSTALLER_SKIP_CLOSE');
    expect(installerScript).toContain('/fi "USERNAME eq %USERDOMAIN%\\%USERNAME%"');
    expect(installerScript).not.toContain('/fi "USERNAME eq %USERNAME%"');
    expect(installerScript).toContain("Get-Process -Name 'FocusLink'");
    expect(installerScript).toContain('StartsWith($$profile');
    expect(installerScript).toContain('Stop-Process -Force');
    expect(installerScript).toContain('/f /im "${APP_EXECUTABLE_FILENAME}"');
    expect(
      installerScript.match(/\/f \/im "\$\{APP_EXECUTABLE_FILENAME\}"/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(installerScript).toContain('Sleep 1600');
    expect(installerScript).toContain('$SYSDIR\\cmd.exe');
    expect(installerScript).not.toContain('%SYSTEMROOT%');
    expect(installerScript).toContain('!macro customInit');
    expect(installerScript).toContain('Kernel32::SetEnvironmentVariable');
  });

  it('never scans other accounts or walks the Chromium process tree', () => {
    expect(installerScript).not.toMatch(/nsProcess::/);
    expect(installerScript).not.toMatch(/\btasklist\b/i);
    expect(installerScript).not.toMatch(/taskkill[^\r\n]*\/t\b/i);
    expect(installerScript).not.toContain('FileOpen');
    expect(installerScript).not.toContain('NSIS_HOOK_PREINSTALL');
  });
});
