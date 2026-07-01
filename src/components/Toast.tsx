// Toast 提示容器 — v0.27: 增强动画 + 自动消失进度条
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useEffect, useState } from 'react';

const TOAST_DURATION = 3200;

const typeConfig = {
  success: {
    Icon: CheckCircle2,
    iconColor: 'text-success',
    border: 'border-l-success',
    glow: 'shadow-[0_0_16px_rgb(var(--success)/0.18)]',
    progressBg: 'bg-success',
  },
  error: {
    Icon: AlertCircle,
    iconColor: 'text-danger',
    border: 'border-l-danger',
    glow: 'shadow-[0_0_16px_rgb(var(--danger)/0.18)]',
    progressBg: 'bg-danger',
  },
  info: {
    Icon: Info,
    iconColor: 'text-accent',
    border: 'border-l-accent',
    glow: 'shadow-[0_0_16px_rgb(var(--accent)/0.18)]',
    progressBg: 'bg-accent',
  },
} as const;

function ToastItem({ id, message, type, onRemove }: { id: string; message: string; type: string; onRemove: (id: string) => void }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const frame = requestAnimationFrame(function tick() {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / TOAST_DURATION) * 100, 100);
      setProgress(pct);
      if (pct < 100) requestAnimationFrame(tick);
    });
    const timer = setTimeout(() => onRemove(id), TOAST_DURATION);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [id, onRemove]);

  const cfg = typeConfig[type as keyof typeof typeConfig] ?? typeConfig.info;

  return (
    <motion.div
      key={id}
      layout
      initial={{ opacity: 0, y: 20, scale: 0.92, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -10, scale: 0.92, filter: 'blur(4px)' }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      className={`glass motion-base pointer-events-auto flex items-center gap-2.5 rounded-xl border border-border border-l-[3px] ${cfg.border} px-4 py-2.5 shadow-soft ${cfg.glow} cursor-pointer select-none overflow-hidden`}
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
