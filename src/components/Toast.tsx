// Toast 提示容器
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useStore } from '../store/useStore';

const typeConfig = {
  success: {
    Icon: CheckCircle2,
    iconColor: 'text-emerald-400',
    border: 'border-l-emerald-400',
    glow: 'shadow-[0_0_12px_rgba(52,211,153,0.12)]',
  },
  error: {
    Icon: AlertCircle,
    iconColor: 'text-rose-400',
    border: 'border-l-rose-400',
    glow: 'shadow-[0_0_12px_rgba(251,113,133,0.12)]',
  },
  info: {
    Icon: Info,
    iconColor: 'text-accent',
    border: 'border-l-accent',
    glow: 'shadow-[0_0_12px_rgba(var(--accent),0.12)]',
  },
} as const;

export function Toast() {
  const { toasts, removeToast } = useStore();

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {toasts.map((t) => {
          const cfg = typeConfig[t.type] ?? typeConfig.info;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={`glass pointer-events-auto flex items-center gap-2 rounded-lg border border-border border-l-[3px] ${cfg.border} px-3.5 py-2 shadow-soft ${cfg.glow} cursor-pointer select-none transition-[box-shadow,backdrop-filter] duration-200 hover:brightness-110`}
              onClick={() => removeToast(t.id)}
            >
              <cfg.Icon size={15} className={`shrink-0 ${cfg.iconColor}`} />
              <span className="text-[13px] leading-snug text-fg">{t.message}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
