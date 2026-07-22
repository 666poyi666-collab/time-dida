// 通用确认弹窗 —— v0.12 弹层系统统一实现，替换原生 confirm()。
// 契约（见 frontend-design/FRONTEND_SPEC.md 4/9 节与 styles/features/overlays.css 头部）：
// - 材质：.overlay-surface（不透明 elevated + shadow-modal + 边缘高光），遮罩 .overlay-backdrop；
// - 动画：framer-motion 驱动 —— 背板以可见初态挂载，面板从几何中心偏上
//   （transform-origin 50% 42%）以 spring(380/30) 轻微上浮弹出；opacity 初态始终为 1，
//   避免运行时 motion preference 切换后动画未提交时留下透明弹窗；退出 150ms 标准缓动收束，
//   reduced-motion 由 App 根 MotionConfig(reducedMotion="user") 压成仅透明度过渡，
//   JS 侧 requestClose 同步跳过退出延时直接落定；
// - 焦点：打开时默认按钮首焦（danger 时落在「取消」上，防误确认），Tab 在弹层内循环，
//   关闭后焦点返回触发元素；
// - 键盘：Esc 取消；危险操作加 .tone-danger，主按钮走 .btn-danger 语义。
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, type Transition } from 'framer-motion';
import { Icon } from './Icon';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 支持 \n 换行（.confirm-desc 为 pre-line） */
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作：图标与主按钮切换为独立 danger 深红语义 */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 与面板/背板退出过渡（150ms 标准缓动）匹配的退出等待时长 */
const EXIT_MS = 150;

// 全组统一弹层语言：背板纯淡入 200ms；面板 spring(380/30) 轻微上浮弹出；
// 退出统一 150ms 移动缓动收束，与 EXIT_MS 对齐。
const BACKDROP_ENTER: Transition = { duration: 0.2, ease: [0.16, 1, 0.3, 1] };
const BACKDROP_EXIT: Transition = { duration: 0.15, ease: [0.4, 0, 0.2, 1] };
const PANEL_SPRING: Transition = { type: 'spring', stiffness: 380, damping: 30 };
const PANEL_EXIT: Transition = { duration: 0.15, ease: [0.4, 0, 0.2, 1] };

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [closing, setClosing] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  // 打开瞬间捕获触发元素：关闭后焦点返回依赖它
  const triggerRef = useRef<HTMLElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const closingRef = useRef(false);
  const exitTimerRef = useRef<number | null>(null);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  /** 真正落定：焦点还给触发元素后再回调（回调通常会关闭本弹窗） */
  const finishClose = useCallback((action: 'confirm' | 'cancel') => {
    const trigger = triggerRef.current;
    if (trigger && trigger.isConnected) {
      trigger.focus({ preventScroll: true });
    }
    if (action === 'confirm') {
      onConfirmRef.current();
    } else {
      onCancelRef.current();
    }
  }, []);

  /** 统一关闭入口：播放反向收束动画后再回调；reduced-motion 与重复调用都直接落定 */
  const requestClose = useCallback(
    (action: 'confirm' | 'cancel') => {
      if (closingRef.current) return;
      closingRef.current = true;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        finishClose(action);
        return;
      }
      setClosing(true);
      exitTimerRef.current = window.setTimeout(() => finishClose(action), EXIT_MS);
    },
    [finishClose],
  );

  // 关闭后立即复位；打开瞬间捕获触发元素，并让危险确认默认聚焦取消。
  useEffect(() => {
    if (!open) {
      closingRef.current = false;
      setClosing(false);
      return;
    }
    closingRef.current = false;
    setClosing(false);
    triggerRef.current = document.activeElement as HTMLElement | null;
    const target = danger ? cancelRef.current : confirmRef.current;
    target?.focus();
    // 仅在 open 边沿执行；danger 在弹窗存活期内不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose('cancel');
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, requestClose]);

  // 卸载兜底：父级直接移除弹窗（未走 requestClose）时，仍把焦点还给触发元素
  useEffect(
    () => () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
      const trigger = triggerRef.current;
      if (trigger && trigger.isConnected && document.activeElement === document.body) {
        trigger.focus({ preventScroll: true });
      }
    },
    [],
  );

  /** Tab 焦点圈：焦点只在弹层内的按钮间循环，不泄露出弹层 */
  const handleShellKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const shell = shellRef.current;
    if (!shell) return;
    const focusables = Array.from(
      shell.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"])'),
    ).filter((el) => el.getClientRects().length > 0);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const focusOutside = !active || !shell.contains(active);
    if (event.shiftKey && (focusOutside || active === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (focusOutside || active === last)) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="confirm-layer fixed inset-0 flex items-center justify-center"
      onClick={() => requestClose('cancel')}
      data-testid="confirm-dialog-layer"
    >
      <motion.div
        className="overlay-backdrop absolute inset-0"
        aria-hidden="true"
        initial={{ opacity: 1 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={closing ? BACKDROP_EXIT : BACKDROP_ENTER}
      />
      <motion.div
        ref={shellRef}
        className={`confirm-shell overlay-surface ${danger ? 'tone-danger' : ''} z-10`}
        style={{ transformOrigin: '50% 42%' }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        initial={{ opacity: 1, y: 8, scale: 0.97 }}
        animate={
          closing
            ? { opacity: 0, y: 6, scale: 0.99, transition: PANEL_EXIT }
            : { opacity: 1, y: 0, scale: 1, transition: PANEL_SPRING }
        }
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleShellKeyDown}
      >
        <div className="confirm-title" id={titleId}>
          <span className="confirm-icon">
            <Icon.AlertCircle size="sm" />
          </span>
          {title}
        </div>
        {description && (
          <p className="confirm-desc" id={descriptionId}>
            {description}
          </p>
        )}
        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn-outline"
            onClick={() => requestClose('cancel')}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={danger ? 'btn-danger' : 'btn-accent'}
            onClick={() => requestClose('confirm')}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
