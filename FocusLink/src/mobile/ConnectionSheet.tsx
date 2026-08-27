import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { normalizeFocusLinkPairingCode } from '@shared/sync/pairingProtocol';
import type { DeviceSyncManagedDevice } from '@shared/ipc/api';

export interface ConnectionSheetProps {
  authenticated: boolean;
  accountLabel: string | null;
  busy: boolean;
  notice: string | null;
  pairingCode: string;
  pairingOffer: { code: string; expiresAt: number; requestToken?: string } | null;
  devices: DeviceSyncManagedDevice[];
  onClose: () => void;
  onPairingCodeChange: (value: string) => void;
  onPair: (value?: string) => void;
  onCreatePairingCode: () => void;
  onRevokeDevice: (deviceId: string) => void;
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
  devices,
  onClose,
  onPairingCodeChange,
  onPair,
  onCreatePairingCode,
  onRevokeDevice,
  onLogout,
  onClearCache,
}: ConnectionSheetProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const pairingInputRef = useRef<HTMLInputElement>(null);
  const autoSubmittedCodeRef = useRef('');
  const reduceMotion = useReducedMotion();
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!pairingOffer) {
      setRemainingSeconds(0);
      setCopied(false);
      return;
    }
    const update = () =>
      setRemainingSeconds(Math.max(0, Math.ceil((pairingOffer.expiresAt - Date.now()) / 1_000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [pairingOffer]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.documentElement.classList.add('connection-sheet-open');
    pairingInputRef.current?.focus();
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
  }, [authenticated, onClose]);

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

  const pairingEntry = (
    <form
      className="account-pairing-entry"
      onSubmit={(event) => {
        event.preventDefault();
        onPair();
      }}
    >
      <label htmlFor="focuslink-pairing-code">输入另一台设备显示的本机配对码</label>
      <input
        ref={pairingInputRef}
        id="focuslink-pairing-code"
        value={pairingCode}
        onChange={(event) => {
          const next = normalizeFocusLinkPairingCode(event.target.value);
          onPairingCodeChange(next);
          if (next.length < 8) autoSubmittedCodeRef.current = '';
          if (next.length === 8 && autoSubmittedCodeRef.current !== next) {
            autoSubmittedCodeRef.current = next;
            onPair(next);
          }
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={9}
        placeholder="0000 0000"
        aria-label="8 位设备配对码"
        aria-describedby="focuslink-pairing-code-status"
      />
      <span id="focuslink-pairing-code-status" className="account-pairing-hint">
        输入后会把两台设备连到同一同步空间
      </span>
      <button
        ref={primaryRef}
        className="primary-button"
        type="submit"
        disabled={busy || pairingCode.length !== 8}
      >
        {busy ? '正在处理…' : authenticated ? '连接设备' : '加入同步'}
      </button>
    </form>
  );

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
            aria-label={authenticated ? '关闭设备同步' : '关闭设备同步，返回本机模式'}
          >
            ×
          </button>
        </header>

        <div className="account-sheet-summary">
          <strong>{authenticated ? '这台设备已加入同步' : '每台设备都有自己的配对码'}</strong>
          <p>
            {authenticated
              ? `${accountLabel ?? 'FocusLink 同步空间'} · 这台设备已加入多端同步。`
              : '任务、专注和统计都会保存在本机；输入另一台设备的 8 位码即可加入同一同步空间。'}
          </p>
        </div>

        {notice && (
          <p className="account-sheet-notice" role="status">
            {notice}
          </p>
        )}

        {pairingOffer && (
          <div className="account-pairing-offer" role="status">
            <span>本机配对码 · 请在另一台设备输入</span>
            <strong>
              {pairingOffer.code.slice(0, 4)} {pairingOffer.code.slice(4)}
            </strong>
            <small>
              有效期内输错可重试 · 剩余 {Math.floor(remainingSeconds / 60)}:
              {String(remainingSeconds % 60).padStart(2, '0')}
            </small>
            <button
              type="button"
              onClick={() => {
                const copy = navigator.clipboard?.writeText(pairingOffer.code);
                if (!copy) return;
                void copy
                  .then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1_500);
                  })
                  .catch(() => setCopied(false));
              }}
            >
              {copied ? '已复制' : '复制配对码'}
            </button>
          </div>
        )}

        {!authenticated ? (
          <>
            <div className="account-pairing-simple">
              <strong>把任一设备的码输入另一台</strong>
              <p>输入一次就会把两台设备连到同一同步空间。</p>
            </div>
            {pairingEntry}
            <button
              type="button"
              className="account-refresh-pairing"
              onClick={onCreatePairingCode}
              disabled={busy}
            >
              {pairingOffer ? '刷新本机配对码' : '显示本机配对码'}
            </button>
          </>
        ) : (
          <>
            {pairingEntry}
            {devices.length > 0 && (
              <div className="account-device-roster" aria-label="已配对设备">
                {devices.map((device) => (
                  <div className="account-device-row" key={device.deviceId}>
                    <div>
                      <strong>{device.displayName}</strong>
                      <span>{device.stale ? '久未同步' : '最近在线'}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`删除“${device.displayName}”？`))
                          onRevokeDevice(device.deviceId);
                      }}
                      disabled={busy}
                    >
                      删除设备
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="sheet-secondary-actions account-sheet-actions">
              <button type="button" onClick={onCreatePairingCode} disabled={busy}>
                {busy ? '正在生成…' : pairingOffer ? '刷新本机配对码' : '显示本机配对码'}
              </button>
              <button type="button" onClick={onClearCache} disabled={busy}>
                清除本机缓存
              </button>
              <button type="button" onClick={onLogout} disabled={busy}>
                退出此设备同步
              </button>
            </div>
          </>
        )}
        {!authenticated && (
          <button className="account-sheet-local" type="button" onClick={onClose}>
            暂不配对，继续本机使用
          </button>
        )}
      </motion.section>
    </motion.div>
  );
}
