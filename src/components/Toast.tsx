// Toast 通知 - v0.4.2 Apex Studio 级精致
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from './Icon';
import { useStore } from '../store/useStore';

const TOAST_DURATION = 2800;

type ToastType = 'success' | 'error' | 'info';

const TOAST_CONFIG: Record<
  ToastType,
  {
    IconComp: typeof Icon.Check;
    tone: 'success' | 'danger' | 'info';
    glowVar: string;
  }
> = {
  success: { IconComp: Icon.CheckCircle, tone: 'success', glowVar: '--app-success' },
  error: { IconComp: Icon.AlertCircle, tone: 'danger', glowVar: '--app-danger' },
  info: { IconComp: Icon.Info, tone: 'info', glowVar: '--app-info' },
};

export function Toast() {
  const { toasts, removeToast } = useStore();

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[320px] max-w-[90vw] flex-col gap-2">
      <AnimatePresence initial={false} mode="popLayout">
        {toasts.map((t) => (
          <ToastItem key={t.id} id={t.id} message={t.message} type={t.type} onRemove={removeToast} />
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
      initial={{ opacity: 0, y: 12, scale: 0.95, x: 8 }}
      animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
      exit={{ opacity: 0, x: 20, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.8 }}
      className="pointer-events-auto toast-shell relative flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg border border-border/60 px-3 py-2.5 glass-toast select-none"
      onClick={() => onRemove(id)}
    >
      {/* 左侧色条 + 光晕 */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: `rgb(var(${cfg.glowVar}))`, opacity: 0.8 }}
      />
      <div
        className="absolute left-0 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full"
        style={{
          background: `radial-gradient(circle, rgb(var(${cfg.glowVar}) / 0.18), transparent 70%)`,
          filter: 'blur(8px)',
        }}
      />

      {/* 图标 */}
      <div className="relative z-10">
        <IconComp size="sm" tone={cfg.tone} />
      </div>

      {/* 消息文本 */}
      <span className="relative z-10 flex-1 text-[12px] leading-snug text-fg">{message}</span>

      {/* 关闭按钮 */}
      <button
        className="toast-close relative z-10 flex h-5 w-5 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-subtle/60 hover:text-fg"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(id);
        }}
      >
        <Icon.X size="xs" />
      </button>

      {/* 进度条 */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden bg-bg-subtle/15">
        <motion.div
          className="h-full"
          style={{ background: `rgb(var(${cfg.glowVar}))`, opacity: 0.4 }}
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: TOAST_DURATION / 1000, ease: 'linear' }}
        />
      </div>
    </motion.div>
  );
}
