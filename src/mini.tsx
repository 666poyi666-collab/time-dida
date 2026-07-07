// 专注小窗渲染入口 - 独立窗口，显示当前计时状态
import { createRoot } from 'react-dom/client';
import { MiniWindow } from './components/MiniWindow';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

document.documentElement.classList.add('mini-window-page');

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <ErrorBoundary>
      <MiniWindow />
    </ErrorBoundary>,
  );
}
