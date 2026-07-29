import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Capacitor } from '@capacitor/core';
import type { MobileConnectionPreferences } from './preferences';
import { exchangeDeviceSyncPairingCode } from './syncClient';
import { normalizePairingCodeInput } from './pairingInput';

export interface ConnectionSheetProps {
  value: MobileConnectionPreferences;
  syncing: boolean;
  hasSavedToken: boolean;
  initialPairingCode?: string;
  onChange: (value: MobileConnectionPreferences) => void;
  onPairedDeviceId: (deviceId: string) => void;
  onClose: () => void;
  onSave: () => void;
  onForgetToken: () => void;
  onClearCache: () => void;
}

export function ConnectionSheet({
  value,
  syncing,
  hasSavedToken,
  initialPairingCode,
  onChange,
  onPairedDeviceId,
  onClose,
  onSave,
  onForgetToken,
  onClearCache,
}: ConnectionSheetProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const endpointRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();
  const [pairingCode, setPairingCode] = useState(initialPairingCode ?? '');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingNotice, setPairingNotice] = useState<string | null>(null);

  useEffect(() => {
    if (initialPairingCode) setPairingCode(initialPairingCode);
  }, [initialPairingCode]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.documentElement.classList.add('connection-sheet-open');
    endpointRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
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
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
        className="connection-sheet"
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
            <p className="eyebrow">MULTI-DEVICE CONNECTION</p>
            <h2 id="connection-title">连接同步服务</h2>
          </div>
          <button className="sheet-close" type="button" onClick={onClose} aria-label="关闭连接设置">
            ×
          </button>
        </header>

        <div className="form-field">
          <label htmlFor="sync-endpoint">服务地址</label>
          <input
            ref={endpointRef}
            id="sync-endpoint"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://sync.example.com"
            value={value.endpoint}
            onChange={(event) => onChange({ ...value, endpoint: event.target.value })}
          />
          <small>
            手机/平板仅连接 HTTPS 云端 authority；localhost、ADB reverse 和局域网 HTTP 已退役。
          </small>
        </div>

        <div className="form-field">
          <label htmlFor="sync-pairing-code">电脑一次性配对码</label>
          <input
            id="sync-pairing-code"
            type="text"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            maxLength={128}
            placeholder="粘贴完整一次性配对码"
            value={pairingCode}
            onChange={(event) => setPairingCode(normalizePairingCodeInput(event.target.value))}
          />
          <small>在电脑端“同步”设置中生成；成功换取令牌后立即失效。</small>
          <button
            className="field-quick-action"
            type="button"
            disabled={pairingBusy || pairingCode.length < 32}
            onClick={() => {
              setPairingBusy(true);
              setPairingNotice(null);
              void exchangeDeviceSyncPairingCode({
                endpoint: value.endpoint,
                code: pairingCode,
                device: {
                  platform: Capacitor.isNativePlatform() ? 'android' : 'web',
                  appVersion: 'focuslink-mobile-v2',
                  displayName: 'FocusLink Mobile',
                },
              })
                .then((paired) => {
                  onChange({ ...value, token: paired.accessToken });
                  onPairedDeviceId(paired.deviceId);
                  setPairingCode('');
                  setPairingNotice('配对成功；请点击“保存并连接”完成设置。');
                })
                .catch((error) =>
                  setPairingNotice(error instanceof Error ? error.message : String(error)),
                )
                .finally(() => setPairingBusy(false));
            }}
          >
            {pairingBusy ? '正在配对…' : '使用一次性配对码'}
          </button>
          {pairingNotice && <small role="status">{pairingNotice}</small>}
        </div>

        <div className="form-field">
          <label htmlFor="sync-token">访问令牌</label>
          <input
            id="sync-token"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="粘贴访问令牌"
            value={value.token}
            onChange={(event) => onChange({ ...value, token: event.target.value })}
          />
          <small>令牌只放在请求头，不会写入会话 IndexedDB。</small>
          <button
            className="field-quick-action"
            type="button"
            onClick={() =>
              void navigator.clipboard
                .readText()
                .then((token) => onChange({ ...value, token: token.trim() }))
                .catch(() => undefined)
            }
          >
            从剪贴板粘贴令牌
          </button>
        </div>

        <label className="remember-row">
          <input
            type="checkbox"
            checked={value.rememberToken}
            onChange={(event) => onChange({ ...value, rememberToken: event.target.checked })}
          />
          <span>
            <strong>在此设备记住令牌</strong>
            <small>
              关闭时 Web 仅保存到当前标签会话；Android 活动通知会用系统密钥加密保存后台连接。
            </small>
          </span>
        </label>

        <div className="security-note">
          <LockIcon />
          <p>
            连接后，此设备可以读取电脑任务快照、提交开始/暂停/继续/结束命令并拉取完成账本。滴答清单与番茄
            To-do 的写入仍只在桌面端操作。
          </p>
        </div>

        <button className="primary-button" type="button" onClick={onSave} disabled={syncing}>
          {syncing ? '正在连接…' : '保存并连接'}
        </button>
        <div className="sheet-secondary-actions">
          {hasSavedToken && (
            <button type="button" onClick={onForgetToken}>
              移除令牌
            </button>
          )}
          <button type="button" onClick={onClearCache} disabled={syncing}>
            清除本机缓存
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
