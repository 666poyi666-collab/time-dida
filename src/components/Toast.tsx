// Toast 提示容器：轻量反馈 + 自动消失进度条
// v0.3.10: 迁移到 Icon 系统 + spring 入场动画
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from './Icon';
import type { IconTone } from './Icon';
import { useStore } from '../store/useStore';
import { useEffect } from 'react';

const TOAST_DURATION = 3200;

const typeConfig: Record<string, {
  icon: keyof typeof Icon;
  tone: IconTone;
  border: string;
  progressBg: string;
}> = {
  success: {
    icon: 'CheckCircleFilled',
    tone: 'success',
    border: 'border-l-success',
    progressBg: 'bg-success',
  },
  error: {
    icon: 'AlertCircle',
    tone: 'danger',
    border: 'border-l-danger',
    progressBg: 'bg-danger',
  },
  info: {
    icon: 'Info',
    tone: 'accent',
    border: 'border-l-accent',
    progressBg: 'bg-accent',
  },
};

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

  const cfg = typeConfig[type] ?? typeConfig.info;
  const IconComp = Icon[cfg.icon] as React.ComponentType<{ size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; tone?: IconTone; hover?: boolean }>;

  return (
    <motion.div
      key={id}
      layout
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
      className={`glass motion-base pointer-events-auto flex items-center gap-2.5 rounded-xl border border-border border-l-[3px] ${cfg.border} cursor-pointer select-none overflow-hidden px-4 py-2.5 shadow-soft`}
      onClick={() => onRemove(id)}
    >
      <IconComp size="sm" tone={cfg.tone} />
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
