// Toast 通知 - v0.4.1 Raycast 级精致
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
    accent: string;
  }
> = {
  success: { IconComp: Icon.CheckCircle, tone: 'success', accent: 'bg-success' },
  error: { IconComp: Icon.AlertCircle, tone: 'danger', accent: 'bg-danger' },
  info: { IconComp: Icon.Info, tone: 'info', accent: 'bg-info' },
};

export function Toast() {
  const { toasts, removeToast } = useStore();

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[320px] max-w-[90vw] flex-col gap-2">
      <AnimatePresence initial={false}>
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
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 8, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 500, damping: 38, mass: 0.7 }}
      className="pointer-events-auto relative flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg border border-border/60 px-3 py-2 glass select-none"
      style={{ boxShadow: 'var(--shadow-modal)' }}
      onClick={() => onRemove(id)}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-[2.5px] ${cfg.accent}`} style={{ opacity: 0.75 }} />
      <IconComp size="sm" tone={cfg.tone} />
      <span className="text-[12px] leading-snug text-fg">{message}</span>
      <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden bg-bg-subtle/20">
        <motion.div
          className={`h-full ${cfg.accent}`}
          style={{ opacity: 0.35 }}
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: TOAST_DURATION / 1000, ease: 'linear' }}
        />
      </div>
    </motion.div>
  );
}
