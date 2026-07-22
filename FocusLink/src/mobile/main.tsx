import ReactDOM from 'react-dom/client';
import { MobileApp } from './MobileApp';
import { applyMobileAppearance, loadMobileAppearance } from './appearance';
import './mobile.css';
import './mobile-confirm.css';

document.documentElement.dataset.runtime = 'mobile-focus';
applyMobileAppearance(loadMobileAppearance());

ReactDOM.createRoot(document.getElementById('root')!).render(<MobileApp />);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const serviceWorkerUrl = new URL('sw.js', document.baseURI);
    void navigator.serviceWorker.register(serviceWorkerUrl, { scope: './' }).catch(() => {
      // IndexedDB still keeps the ledger available when service-worker registration is unavailable.
    });
  });
}
