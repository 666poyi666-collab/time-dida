import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export interface ConnectionSheetProps {
  authenticated: boolean;
  accountLabel: string | null;
  busy: boolean;
  notice: string | null;
  onClose: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onClearCache: () => void;
}

export function ConnectionSheet({
  authenticated,
  accountLabel,
  busy,
  notice,
  onClose,
  onLogin,
  onLogout,
  onClearCache,
}: ConnectionSheetProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.documentElement.classList.add('connection-sheet-open');
    primaryRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      document.documentElement.classList.remove('connection-sheet-open');
      previousFocus?.focus();
    };
  }, [onClose]);

  const keepFocusInside = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <motion.div
      className="sheet-backdrop"
      role="presentation"
      onMouseDown={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0.12 : 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.section
        ref={dialogRef}
        className="connection-sheet account-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-title"
        onKeyDown={keepFocusInside}
        onMouseDown={(event) => event.stopPropagation()}
        initial={reduceMotion ? { opacity: 0 } : { y: '100%' }}
        animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
        transition={
          reduceMotion
            ? { duration: 0.12, ease: 'linear' }
            : { type: 'spring', stiffness: 380, damping: 30 }
        }
      >
        <div className="sheet-handle" aria-hidden="true" />
        <header>
          <div>
            <p className="eyebrow">FOCUSLINK ACCOUNT</p>
            <h2 id="connection-title">账号与云同步</h2>
          </div>
          <button
            className="sheet-close"
            type="button"
            onClick={onClose}
            aria-label={authenticated ? '关闭账号设置' : '关闭账号设置，返回本机模式'}
          >
            ×
          </button>
        </header>

        <div className="account-sheet-summary">
          <strong>{authenticated ? '已登录' : '登录后自动同步'}</strong>
          <p>
            {authenticated
              ? `${accountLabel ?? 'FocusLink 账号'} · 这台设备已加入云同步。`
              : '登录后可跨设备同步；不登录也可关闭此页，直接使用本机专注。'}
          </p>
        </div>

        {notice && (
          <p className="account-sheet-notice" role="status">
            {notice}
          </p>
        )}

        {!authenticated ? (
          <button
            ref={primaryRef}
            className="primary-button"
            type="button"
            onClick={onLogin}
            disabled={busy}
          >
            {busy ? '正在登录…' : '登录 FocusLink 账号'}
          </button>
        ) : (
          <div className="sheet-secondary-actions account-sheet-actions">
            <button ref={primaryRef} type="button" onClick={onClearCache} disabled={busy}>
              清除本机缓存
            </button>
            <button type="button" onClick={onLogout} disabled={busy}>
              退出登录
            </button>
          </div>
        )}
      </motion.section>
    </motion.div>
  );
}
