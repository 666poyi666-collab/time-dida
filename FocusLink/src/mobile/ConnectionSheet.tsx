import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export interface ConnectionSheetProps {
  authenticated: boolean;
  accountLabel: string | null;
  busy: boolean;
  notice: string | null;
  pairingCode: string;
  pairingOffer: { code: string; expiresAt: number } | null;
  onClose: () => void;
  onLogin: () => void;
  onPairingCodeChange: (value: string) => void;
  onPair: () => void;
  onCreatePairingCode: () => void;
  onLogout: () => void;
  onClearCache: () => void;
}

export function ConnectionSheet({
  authenticated,
  accountLabel,
  busy,
  notice,
  pairingCode,
  pairingOffer,
  onClose,
  onLogin,
  onPairingCodeChange,
  onPair,
  onCreatePairingCode,
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
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'input:not(:disabled), button:not(:disabled)',
      ) ?? [],
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
            <p className="eyebrow">DEVICE SYNC</p>
            <h2 id="connection-title">多端同步</h2>
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
          <strong>{authenticated ? '这台设备已加入同步' : '本机模式可以直接使用'}</strong>
          <p>
            {authenticated
              ? `${accountLabel ?? 'FocusLink 账号'} · 这台设备已加入云同步。`
              : '任务、专注和统计都会保存在本机；设备授权只用于电脑、手机和平板之间同步。'}
          </p>
        </div>

        {notice && (
          <p className="account-sheet-notice" role="status">
            {notice}
          </p>
        )}

        {!authenticated ? (
          <>
            <form
              className="account-pairing-entry"
              onSubmit={(event) => {
                event.preventDefault();
                onPair();
              }}
            >
              <label htmlFor="focuslink-pairing-code">输入另一台设备显示的配对码</label>
              <input
                id="focuslink-pairing-code"
                value={pairingCode}
                onChange={(event) => onPairingCodeChange(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="0000 0000"
                aria-label="8 位设备配对码"
              />
              <button
                ref={primaryRef}
                className="primary-button"
                type="submit"
                disabled={busy || pairingCode.length !== 8}
              >
                {busy ? '正在加入同步…' : '加入多端同步'}
              </button>
            </form>
            <details className="account-owner-fallback">
              <summary>首台设备或账号恢复</summary>
              <p>没有任何已登录设备时，使用 Poyi 管理员恢复入口完成首台设备授权。</p>
              <button type="button" onClick={onLogin} disabled={busy}>
                打开管理员恢复页
              </button>
            </details>
          </>
        ) : (
          <>
            {pairingOffer && (
              <div className="account-pairing-offer" role="status">
                <span>在新设备输入</span>
                <strong>
                  {pairingOffer.code.slice(0, 4)} {pairingOffer.code.slice(4)}
                </strong>
                <small>一次性使用，10 分钟内有效</small>
              </div>
            )}
            <div className="sheet-secondary-actions account-sheet-actions">
              <button ref={primaryRef} type="button" onClick={onCreatePairingCode} disabled={busy}>
                {busy ? '正在生成…' : '添加设备'}
              </button>
              <button type="button" onClick={onClearCache} disabled={busy}>
                清除本机缓存
              </button>
              <button type="button" onClick={onLogout} disabled={busy}>
                退出登录
              </button>
            </div>
          </>
        )}
        {!authenticated && (
          <button className="account-sheet-local" type="button" onClick={onClose}>
            暂不授权，继续使用本机模式
          </button>
        )}
      </motion.section>
    </motion.div>
  );
}
