import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveMobileLiveLifecycleAction } from '../src/mobile/liveConnectionLifecycle';

const mobileAppSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'mobile', 'MobileApp.tsx'),
  'utf8',
);

describe('mobile live connection lifecycle', () => {
  it('cancels the foreground long poll whenever the app or document becomes inactive', () => {
    expect(
      resolveMobileLiveLifecycleAction({
        appActive: false,
        documentVisible: true,
        online: true,
        configured: true,
      }),
    ).toBe('suspend');
    expect(
      resolveMobileLiveLifecycleAction({
        appActive: true,
        documentVisible: false,
        online: true,
        configured: true,
      }),
    ).toBe('suspend');
  });

  it('starts a replacement loop only when visible, online, and configured', () => {
    expect(
      resolveMobileLiveLifecycleAction({
        appActive: true,
        documentVisible: true,
        online: true,
        configured: true,
      }),
    ).toBe('reconnect');
    expect(
      resolveMobileLiveLifecycleAction({
        appActive: true,
        documentVisible: true,
        online: false,
        configured: true,
      }),
    ).toBe('wait');
    expect(
      resolveMobileLiveLifecycleAction({
        appActive: true,
        documentVisible: true,
        online: true,
        configured: false,
      }),
    ).toBe('wait');
  });

  it('wires both browser and native lifecycle signals to the single request owner', () => {
    expect(mobileAppSource).toContain("CapacitorApp.addListener('appStateChange'");
    expect(mobileAppSource).toContain("document.addEventListener('visibilitychange'");
    expect(mobileAppSource).toContain("window.addEventListener('pageshow'");
    expect(mobileAppSource).toContain('const mobileAppActive = useRef(true);');
    expect(mobileAppSource).toContain('mobileAppActive.current = isActive;');
    expect(mobileAppSource).not.toContain(
      'const reconnectAfterPageShow = () => applyLifecycle(true)',
    );
    expect(mobileAppSource).toContain('liveRequest.current?.abort()');
    expect(mobileAppSource).toContain('resolveMobileLiveLifecycleAction({');
    expect(mobileAppSource).toContain('if (!failure.retryable) return;');
    expect(mobileAppSource).toContain('setLiveConnectionNotice(');
    expect(mobileAppSource).toContain('liveConnectionNotice ?? connectionTitle(liveConnection)');
    expect(mobileAppSource).toContain('connectionNotice={liveConnectionNotice}');
    expect(mobileAppSource).not.toContain('实时连接中断 · 自动重试中');
  });

  it('gates effect-driven restarts while the native app or document is inactive', () => {
    const liveEffectStart = mobileAppSource.indexOf(
      '  useEffect(() => {\n    liveRequest.current?.abort();',
    );
    const controllerStart = mobileAppSource.indexOf(
      'const controller = new AbortController();',
      liveEffectStart,
    );
    const liveEffectGuard = mobileAppSource.slice(liveEffectStart, controllerStart);

    expect(liveEffectStart).toBeGreaterThan(-1);
    expect(controllerStart).toBeGreaterThan(liveEffectStart);
    expect(liveEffectGuard).toContain('resolveMobileLiveLifecycleAction({');
    expect(liveEffectGuard).toContain('appActive: mobileAppActive.current');
    expect(liveEffectGuard).toContain("document.visibilityState === 'visible'");
    expect(liveEffectGuard).toContain("!== 'reconnect'");
  });
});
