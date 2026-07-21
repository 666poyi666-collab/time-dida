// 全局轻量通知：不阻断计时操作，自动消退并支持点击关闭。
// 动画语言与全组统一动效规范一致：从触发方向（右下角屏幕边缘）滑入 + 淡入 240ms
// （--ease-out-expo），退出反向收束 160ms（--ease-standard）；多条堆叠时靠
// framer-motion layout 以 240ms 标准缓动做位置重排。三类语义色全部来自 token
// （.toast-tone-success / .toast-tone-error / .toast-tone-info，见 main-window.css）。
import '../styles/ui-motion.css';
import { useEffect } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
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

// 触发方向 = 右下屏幕边缘：进入从右侧滑入并轻微放大落位（240ms 入场缓动），
// 退出反向收束（160ms 移动缓动）；各档 transition 写在 variant 内，互不干扰。
// reduced-motion：App 根的 MotionConfig(reducedMotion="user") 会把位移/缩放/layout
// 压成即时呈现、仅保留透明度过渡，无需额外分支。
const TOAST_VARIANTS: Variants = {
  initial: { opacity: 0, x: 28, scale: 0.96 },
  animate: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    x: 24,
    scale: 0.97,
    transition: { duration: 0.16, ease: [0.4, 0, 0.2, 1] },
  },
};

// 多条堆叠时的位置重排：240ms 移动/交换缓动（落在常规档上限内）。
// 作为 motion.div 的基础 transition：variant 内的过渡只覆盖各自动画的值，
// layout 重排不属于任何 variant，回落到这里。
const TOAST_LAYOUT_TRANSITION = { duration: 0.24, ease: [0.4, 0, 0.2, 1] } as const;

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
      transition={TOAST_LAYOUT_TRANSITION}
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
