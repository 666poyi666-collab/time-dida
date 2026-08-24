import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConnectionSheet } from '../src/mobile/ConnectionSheet';

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

  it('lets a new credential-free profile stay in and return to local focus mode', () => {
    const mobile = fs.readFileSync(
      path.join(projectRoot, 'src', 'mobile', 'MobileApp.tsx'),
      'utf8',
    );
    const sheet = fs.readFileSync(
      path.join(projectRoot, 'src', 'mobile', 'ConnectionSheet.tsx'),
      'utf8',
    );
    const markup = renderToStaticMarkup(
      createElement(ConnectionSheet, {
        authenticated: false,
        accountLabel: null,
        busy: false,
        notice: null,
        onClose: () => undefined,
        onLogin: () => undefined,
        onLogout: () => undefined,
        onClearCache: () => undefined,
      }),
    );

    expect(mobile).toContain('const [configOpen, setConfigOpen] = useState(false);');
    expect(mobile).toContain('onClose={() => setConfigOpen(false)}');
    expect(markup).toContain('aria-label="关闭账号设置，返回本机模式"');
    expect(markup).toContain('本机模式可以直接使用');
    expect(markup).toContain('打开设备授权页');
    expect(markup).toContain('43 位一次性管理员授权码');
    expect(markup).toContain('暂不授权，继续使用本机模式');
    expect(markup).not.toContain('这台设备已加入云同步');
    expect(sheet).toContain('onMouseDown={onClose}');
    expect(sheet).toContain("if (event.key !== 'Escape') return;");
  });
});
