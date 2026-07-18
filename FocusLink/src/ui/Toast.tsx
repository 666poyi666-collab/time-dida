// 全局轻量通知：不阻断计时操作，自动消退并支持点击关闭。
// 动画语言与 motion.css 弹层规范一致：从触发方向（右下角屏幕边缘）滑入、
// 反向收束滑出；spring 手感落在 --motion-slow 档；三类语义色全部来自 token
// （.toast-tone-success / .toast-tone-error / .toast-tone-info，见 main-window.css）。
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from './Icon';
import { useStore } from '../app/store';

const TOAST_DURATION = 2800;

type ToastType = 'success' | 'error' | 'info';

const TOAST_CONFIG: Record<
  ToastType,
  {
    IconComp: typeof Icon.Check;
    toneClass: string;
    iconTone: 'success' | 'danger' | 'info';
    label: string;
  }
> = {
  success: {
    IconComp: Icon.CheckCircle,
    toneClass: 'toast-tone-success',
    iconTone: 'success',
    label: '成功',
  },
  error: {
    IconComp: Icon.AlertCircle,
    toneClass: 'toast-tone-error',
    iconTone: 'danger',
    label: '错误',
  },
  info: { IconComp: Icon.Info, toneClass: 'toast-tone-info', iconTone: 'info', label: '信息' },
};

// 触发方向 = 右下屏幕边缘：进入从右侧滑入并轻微放大落位，退出反向收束。
// MotionConfig(reducedMotion="user") 会把位移/缩放压成即时呈现，无需额外分支。
const TOAST_VARIANTS = {
  initial: { opacity: 0, x: 28, scale: 0.96 },
  animate: { opacity: 1, x: 0, scale: 1 },
  exit: { opacity: 0, x: 24, scale: 0.97 },
};

const TOAST_TRANSITION = { type: 'spring', stiffness: 380, damping: 32, mass: 0.8 } as const;

export function Toast() {
  const { toasts, removeToast } = useStore();

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[320px] max-w-[90vw] flex-col gap-2">
      <AnimatePresence initial={false} mode="popLayout">
        {toasts.map((t) => (
          <ToastItem
            key={t.id}
            id={t.id}
            message={t.message}
            type={t.type}
            onRemove={removeToast}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({
  id,
  message,
  type,
  onRemove,
}: {
  id: string;
  message: string;
  type: ToastType;
  onRemove: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(id), TOAST_DURATION);
    return () => clearTimeout(timer);
  }, [id, onRemove]);

  const cfg = TOAST_CONFIG[type];
  const IconComp = cfg.IconComp;

  return (
    <motion.div
      key={id}
      layout
      variants={TOAST_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={TOAST_TRANSITION}
      className={`toast-item ${cfg.toneClass} pointer-events-auto cursor-pointer select-none`}
      onClick={() => onRemove(id)}
      role="status"
      aria-label={`${cfg.label}通知：${message}`}
    >
      {/* 语义图标 */}
      <span className="toast-icon">
        <IconComp size="sm" tone={cfg.iconTone} />
      </span>

      {/* 消息文本（长文本任意点断行，最多四行） */}
      <span className="toast-message">{message}</span>

      {/* 关闭按钮 */}
      <button
        className="toast-close"
        aria-label="关闭通知"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(id);
        }}
      >
        <Icon.X size="xs" />
      </button>
    </motion.div>
  );
}
