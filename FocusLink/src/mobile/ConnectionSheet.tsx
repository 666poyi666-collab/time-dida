import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { MobileConnectionPreferences } from './preferences';

export interface ConnectionSheetProps {
  value: MobileConnectionPreferences;
  syncing: boolean;
  hasSavedToken: boolean;
  onChange: (value: MobileConnectionPreferences) => void;
  onClose: () => void;
  onSave: () => void;
  onForgetToken: () => void;
  onClearCache: () => void;
}

export function ConnectionSheet({
  value,
  syncing,
  hasSavedToken,
  onChange,
  onClose,
  onSave,
  onForgetToken,
  onClearCache,
}: ConnectionSheetProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const endpointRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

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
          <small>生产环境仅接受 HTTPS；本机调试可使用 localhost。</small>
          <button
            className="field-quick-action"
            type="button"
            onClick={() => onChange({ ...value, endpoint: 'http://127.0.0.1:18787' })}
          >
            使用本机 / ADB 地址
          </button>
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
