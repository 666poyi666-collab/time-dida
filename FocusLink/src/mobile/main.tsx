import ReactDOM from 'react-dom/client';
import { MobileApp } from './MobileApp';
import { WatchApp } from './WatchApp';
import { applyMobileAppearance, loadMobileAppearance } from './appearance';
import './mobile.css';
import './mobile-confirm.css';

// 手表（OPPO OWW221 = 189×248 dp）跑的是同一个 APK；按视口分流到专用壳层。
// 完整控制台是为 393dp+ 设计的，塞进 189dp 只会得到一屏折行 + 130px 横向溢出。
// 手机最小也有 ~640dp 长边（分屏也到不了 320），这个阈值不会误伤。
const isWatchViewport = Math.max(window.innerWidth, window.innerHeight) <= 320;

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
