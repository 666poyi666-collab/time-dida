// Toast 提示容器：轻量反馈 + 自动消失进度条
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useEffect } from 'react';

const TOAST_DURATION = 3200;

const typeConfig = {
  success: {
    Icon: CheckCircle2,
    iconColor: 'text-success',
    border: 'border-l-success',
    progressBg: 'bg-success',
  },
  error: {
    Icon: AlertCircle,
    iconColor: 'text-danger',
    border: 'border-l-danger',
    progressBg: 'bg-danger',
  },
  info: {
    Icon: Info,
    iconColor: 'text-accent',
    border: 'border-l-accent',
    progressBg: 'bg-accent',
  },
} as const;

function ToastItem({
  id,
  message,
  type,
  onRemove,
}: {
  id: string;
  message: string;
  type: string;
  onRemove: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(id), TOAST_DURATION);
    return () => {
      clearTimeout(timer);
    };
  }, [id, onRemove]);

  const cfg = typeConfig[type as keyof typeof typeConfig] ?? typeConfig.info;

  return (
    <motion.div
      key={id}
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`glass motion-base pointer-events-auto flex items-center gap-2.5 rounded-xl border border-border border-l-[3px] ${cfg.border} cursor-pointer select-none overflow-hidden px-4 py-2.5 shadow-soft`}
      onClick={() => onRemove(id)}
    >
      <cfg.Icon size={15} className={`shrink-0 ${cfg.iconColor}`} />
      <span className="text-[13px] leading-snug text-fg">{message}</span>
      {/* 自动消失进度条 */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden rounded-b-xl bg-bg-subtle/40">
        <motion.div
          className={`h-full ${cfg.progressBg} opacity-50`}
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: TOAST_DURATION / 1000, ease: 'linear' }}
        />
      </div>
    </motion.div>
  );
}

export function Toast() {
  const { toasts, removeToast } = useStore();

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col-reverse items-center gap-2.5">
      <AnimatePresence>
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
