import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface MobileConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Responsive counterpart of the desktop ConfirmDialog; never falls back to window.confirm. */
export function MobileConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: MobileConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (danger ? cancelRef : confirmRef).current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [danger, onCancel, open]);

  if (!open) return null;

  const keepFocusInside = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusables = [cancelRef.current, confirmRef.current].filter(
      (element): element is HTMLButtonElement => Boolean(element),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="mobile-confirm-layer" role="presentation" onClick={onCancel}>
      <div
        ref={dialogRef}
        className={`mobile-confirm-dialog ${danger ? 'is-danger' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mobile-confirm-title"
        aria-describedby="mobile-confirm-description"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={keepFocusInside}
      >
        <span className="mobile-confirm-mark" aria-hidden="true">
          !
        </span>
        <h2 id="mobile-confirm-title">{title}</h2>
        <p id="mobile-confirm-description">{description}</p>
        <div className="mobile-confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="mobile-confirm-cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="mobile-confirm-primary"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
