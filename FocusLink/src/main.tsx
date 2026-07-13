import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { APP_COMMIT, APP_VERSION } from '@shared/version';
import './styles/main.css';

document.documentElement.dataset.appVersion = APP_VERSION;
document.documentElement.dataset.appCommit = APP_COMMIT;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
