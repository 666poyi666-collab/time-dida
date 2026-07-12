// 专注小窗渲染入口 - 独立窗口，显示当前计时状态
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import { MiniWindow } from './features/mini/MiniWindow';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles/mini.css';

document.documentElement.classList.add('mini-window-page');

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <MiniWindow />
      </MotionConfig>
    </ErrorBoundary>,
  );
}
