import './compat';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { MobileApp } from './MobileApp';
import { WatchApp } from './WatchApp';
import { applyMobileAppearance, loadMobileAppearance } from './appearance';
import { isTabletFocusViewport, isWatchFocusViewport } from './viewportPolicy';
import './mobile.css';
import './mobile-confirm.css';

// 手表（OPPO OWW221，378×496 物理像素）跑的是同一个 APK；按视口分流到专用壳层。
// OWW221 的 WebView 实测会报告 189×248，也有固件报告 320×420；viewportPolicy
// 同时保留 native physical-size fallback，避免 WebView 升级后暴露完整 378×496 时误进手机版。
const isWatchViewport = isWatchFocusViewport(window.innerWidth, window.innerHeight, {
  native: Capacitor.isNativePlatform(),
  pixelRatio: window.devicePixelRatio,
});
const isTabletViewport =
  !isWatchViewport && isTabletFocusViewport(window.innerWidth, window.innerHeight);

document.documentElement.dataset.runtime = isWatchViewport ? 'watch-focus' : 'mobile-focus';
document.documentElement.dataset.deviceTier = isWatchViewport
  ? 'watch'
  : isTabletViewport
    ? 'tablet'
    : 'phone';
if (isWatchViewport) document.documentElement.classList.add('watch-runtime');
// AMOLED 防烧屏：手表一律深色运行（watch.css 再把画布压到纯黑），
// 存储的浅色偏好只对手机/平板生效。
const appearance = loadMobileAppearance();
applyMobileAppearance(isWatchViewport ? { ...appearance, theme: 'dark' } : appearance);

ReactDOM.createRoot(document.getElementById('root')!).render(
  isWatchViewport ? <WatchApp /> : <MobileApp />,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const serviceWorkerUrl = new URL('sw.js', document.baseURI);
    void navigator.serviceWorker.register(serviceWorkerUrl, { scope: './' }).catch(() => {
      // IndexedDB still keeps the ledger available when service-worker registration is unavailable.
    });
  });
}
