import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('mobile owner account entry', () => {
  it('keeps one canonical account callback and no public connection fields', () => {
    const manifest = fs.readFileSync(
      path.join(projectRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
      'utf8',
    );
    const gradle = fs.readFileSync(
      path.join(projectRoot, 'android', 'app', 'build.gradle'),
      'utf8',
    );
    const mobile = fs.readFileSync(
      path.join(projectRoot, 'src', 'mobile', 'MobileApp.tsx'),
      'utf8',
    );
    const sheet = fs.readFileSync(
      path.join(projectRoot, 'src', 'mobile', 'ConnectionSheet.tsx'),
      'utf8',
    );
    const watch = fs.readFileSync(path.join(projectRoot, 'src', 'mobile', 'WatchApp.tsx'), 'utf8');

    expect(manifest).toContain('android:name="android.intent.category.BROWSABLE"');
    expect(manifest).toContain('android:scheme="${appScheme}"');
    expect(manifest).toContain('android:host="auth"');
    expect(gradle).toContain('manifestPlaceholders = [appScheme: "focuslink"]');
    expect(gradle).not.toContain('applicationIdSuffix ".staging"');
    expect(mobile).toContain("CapacitorApp.addListener('appUrlOpen'");
    expect(mobile).toContain('ownerAccountBootstrapApi');
    expect(watch).toContain('从手机登录');
    for (const forbidden of ['服务地址', '访问令牌', '电脑一次性配对码', '保存并连接']) {
      expect(sheet).not.toContain(forbidden);
      expect(watch).not.toContain(forbidden);
    }
  });
});
