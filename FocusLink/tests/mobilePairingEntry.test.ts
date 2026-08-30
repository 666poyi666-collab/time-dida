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
        pairingCode: '12345678',
        pairingOffer: null,
        devices: [],
        onClose: () => undefined,
        onPairingCodeChange: () => undefined,
        onPair: () => undefined,
        onCreatePairingCode: () => undefined,
        onRevokeDevice: () => undefined,
        onLogout: () => undefined,
        onClearCache: () => undefined,
      }),
    );

    expect(mobile).toContain('const [configOpen, setConfigOpen] = useState(false);');
    expect(mobile).toContain('onClose={() => setConfigOpen(false)}');
    expect(markup).toContain('aria-label="关闭设备同步，返回本机模式"');
    expect(markup).toContain('每台设备都有自己的配对码');
    expect(markup).toContain('输入另一台设备显示的本机配对码');
    expect(markup).toContain('显示本机配对码');
    expect(markup).toContain('输入一次就会把两台设备连到同一同步空间');
    expect(markup).not.toContain('首次设备授权');
    expect(markup).toContain('暂不配对，继续本机使用');
    expect(markup).not.toContain('这台设备已加入云同步');
    expect(sheet).toContain('onMouseDown={onClose}');
    expect(sheet).toContain("if (event.key !== 'Escape') return;");
  });

  it('shows one-time code generation on an already enrolled mobile device', () => {
    const markup = renderToStaticMarkup(
      createElement(ConnectionSheet, {
        authenticated: true,
        connection: 'live',
        online: true,
        lastSyncAt: Date.now() - 60_000,
        accountLabel: 'Poyi',
        busy: false,
        notice: null,
        pairingCode: '',
        pairingOffer: { code: '87654321', expiresAt: Date.now() + 600_000 },
        devices: [],
        onClose: () => undefined,
        onPairingCodeChange: () => undefined,
        onPair: () => undefined,
        onCreatePairingCode: () => undefined,
        onRevokeDevice: () => undefined,
        onLogout: () => undefined,
        onClearCache: () => undefined,
      }),
    );
    expect(markup).toContain('8765 4321');
    expect(markup).toContain('本机配对码');
    expect(markup).toContain('输入另一台设备显示的本机配对码');
    expect(markup).toContain('加入同步');
    expect(markup).not.toContain('accessToken');
  });

  it('keeps current, regular and invalid/test devices in separate roster levels', () => {
    const markup = renderToStaticMarkup(
      createElement(ConnectionSheet, {
        authenticated: true,
        connection: 'live',
        online: true,
        lastSyncAt: Date.now() - 60_000,
        accountLabel: 'Poyi',
        busy: false,
        notice: null,
        pairingCode: '',
        pairingOffer: null,
        currentDeviceId: 'device-current01',
        devices: [
          {
            deviceId: 'device-current01',
            devicePublicId: 'current01',
            displayName: '当前小米',
            platform: 'android',
            deviceKind: 'phone',
            appVersion: '0.12.104',
            expiresAt: Date.now() + 60_000,
            revokedAt: null,
            lastSeenAt: Date.now(),
            stale: false,
            registeredAt: Date.now(),
          },
          {
            deviceId: 'device-tablet01',
            devicePublicId: 'tablet01',
            displayName: 'FocusLink 平板',
            platform: 'android',
            deviceKind: 'tablet',
            appVersion: '0.12.102',
            expiresAt: Date.now() + 60_000,
            revokedAt: null,
            lastSeenAt: Date.now(),
            stale: false,
            registeredAt: Date.now(),
          },
          {
            deviceId: 'device-smoke01',
            devicePublicId: 'smoke01',
            displayName: 'FocusLink protocol smoke device',
            platform: 'web',
            deviceKind: 'desktop',
            appVersion: 'protocol-test',
            expiresAt: Date.now() + 60_000,
            revokedAt: null,
            lastSeenAt: Date.now(),
            stale: false,
            registeredAt: Date.now(),
          },
        ],
        onClose: () => undefined,
        onPairingCodeChange: () => undefined,
        onPair: () => undefined,
        onCreatePairingCode: () => undefined,
        onRevokeDevice: () => undefined,
        onLogout: () => undefined,
        onClearCache: () => undefined,
      }),
    );
    expect(markup).toContain('已配对设备');
    expect(markup).toContain('手机 · 当前在线');
    expect(markup).toContain('账本最后成功');
    expect(markup).not.toContain('当前设备 · 正在同步');
    expect(markup).toContain('其他设备');
    expect(markup).toContain('无效与测试设备');
    expect(markup).toContain('FocusLink 平板');
    expect(markup).toContain('删除设备');
  });
});
