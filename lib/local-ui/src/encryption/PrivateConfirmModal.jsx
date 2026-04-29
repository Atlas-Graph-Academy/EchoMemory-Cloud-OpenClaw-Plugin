import './PrivateConfirmModal.css';

/**
 * PrivateConfirmModal — confirmation prompt for syncing files the
 * privacy classifier flagged. Two layers of guidance:
 *
 * - When E2EE is OFF: encourage the user to set it up before uploading
 *   private/sensitive content (the suggestion is a CTA; the user can
 *   still proceed without it if they really want to).
 * - When E2EE is ON: a plain "are you sure?" — the upload will be
 *   encrypted client-side anyway, so the friction is just to make sure
 *   the user means it.
 *
 * confirmablePaths shape (from the server's 409 response):
 *   [{ path, reason: 'private' | 'sensitive_content', riskLevel: 'private' | 'secret' }, ...]
 */
export function PrivateConfirmModal({
  open,
  encryptionState,
  confirmablePaths,
  onConfirm,
  onCancel,
  onSetupEncryption,
  busy,
}) {
  if (!open) return null;

  const e2eeOn = encryptionState === 'unlocked' || encryptionState === 'locked';
  const items = Array.isArray(confirmablePaths) ? confirmablePaths : [];
  const hasSecret = items.some((p) => p?.riskLevel === 'secret');
  const hasPrivate = items.some((p) => p?.riskLevel !== 'secret');

  let headline;
  let kicker;
  if (hasSecret && hasPrivate) {
    headline = 'These files are private — and one looks sensitive.';
    kicker = 'Confirm extract';
  } else if (hasSecret) {
    headline = 'This file looks like it has secrets in it.';
    kicker = 'Confirm extract';
  } else {
    headline = 'These files are marked private.';
    kicker = 'Confirm extract';
  }

  return (
    <div
      className="private-confirm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={headline}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel?.();
      }}
    >
      <form
        className="private-confirm"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          onConfirm?.();
        }}
      >
        <button
          type="button"
          className="private-confirm__close"
          onClick={onCancel}
          disabled={busy}
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <p className="private-confirm__kicker">{kicker}</p>
        <h1 className="private-confirm__headline">{headline}</h1>

        <div className="private-confirm__body">
          <ul className="private-confirm__list">
            {items.map((item, index) => (
              <li key={`${item.path}-${index}`} className={`private-confirm__item private-confirm__item--${item.riskLevel || 'private'}`}>
                <span className="private-confirm__path" title={item.path}>{item.path}</span>
                <span className="private-confirm__tag">
                  {item.riskLevel === 'secret' ? 'Sensitive' : 'Private'}
                </span>
              </li>
            ))}
          </ul>

          {!e2eeOn && (
            <div className="private-confirm__hint private-confirm__hint--cta">
              <p>
                Your account doesn't have end-to-end encryption yet. Setting it up
                first means the cloud only sees ciphertext for these memories.
              </p>
              {onSetupEncryption && (
                <button
                  type="button"
                  className="private-confirm__btn private-confirm__btn--ghost"
                  onClick={onSetupEncryption}
                  disabled={busy}
                >
                  Set up encryption first
                </button>
              )}
            </div>
          )}

          {e2eeOn && (
            <p className="private-confirm__hint">
              These will be encrypted client-side before upload — the cloud only
              ever sees ciphertext for the body. Make sure you actually want
              them in your synced library.
            </p>
          )}
        </div>

        <div className="private-confirm__actions">
          <button
            type="submit"
            className="private-confirm__btn private-confirm__btn--primary"
            disabled={busy}
          >
            {busy ? 'Working…' : 'Yes, extract anyway'}
          </button>
          <button
            type="button"
            className="private-confirm__btn private-confirm__btn--cancel"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
