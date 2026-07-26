import './compat';
import ReactDOM from 'react-dom/client';
import { MobileApp } from './MobileApp';
import { WatchApp } from './WatchApp';
import { applyMobileAppearance, loadMobileAppearance } from './appearance';
import './mobile.css';
import './mobile-confirm.css';

// 手表（OPPO OWW221，378×496 物理像素）跑的是同一个 APK；按视口分流到专用壳层。
// 注意 Android WebView 有 320px 的视口下限：手表上 width=device-width 实际得到
// 320×420 CSS @ dpr 1.18，而不是按密度算出的 189×248。以 CSS 长边 ≤460 为界：
// 手表 420，手机竖屏长边最少也有 ~640（本机小米 895、华为 1024），不会误伤。
const isWatchViewport = Math.max(window.innerWidth, window.innerHeight) <= 460;

document.documentElement.dataset.runtime = isWatchViewport ? 'watch-focus' : 'mobile-focus';
if (isWatchViewport) document.documentElement.classList.add('watch-runtime');
applyMobileAppearance(loadMobileAppearance());

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
