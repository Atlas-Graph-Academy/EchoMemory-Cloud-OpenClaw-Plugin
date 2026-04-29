import { useEffect, useMemo, useRef, useState } from 'react';
import './PassphraseModal.css';

const PIN_LENGTH = 5;
const EMPTY_PIN = Array.from({ length: PIN_LENGTH }, () => '');

function pinToString(pin) {
  return pin.join('');
}

/**
 * PassphraseModal — 5-digit PIN entry for unlocking the cached encryption
 * key or initial setup, depending on `mode`. Visual layout follows the
 * Echo "Encryption mode" onboarding design (paper card, glass PIN inputs,
 * Caveat headlines, script-font warning).
 *
 * mode = 'unlock' → cloud config exists; verify PIN → derive → cache.
 * mode = 'setup'  → no cloud config; create one with this new PIN.
 *
 * `onSubmit(pin)` should resolve on success or throw with a user-facing
 * message on failure. The modal handles its own error/loading state.
 */
export function PassphraseModal({ open, mode, onSubmit, onCancel }) {
  const [pin, setPin] = useState(EMPTY_PIN);
  const [pinConfirm, setPinConfirm] = useState(EMPTY_PIN);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const pinRefs = useRef([]);
  const confirmRefs = useRef([]);

  const isSetup = mode === 'setup';

  useEffect(() => {
    if (!open) {
      setPin(EMPTY_PIN);
      setPinConfirm(EMPTY_PIN);
      setError(null);
      setBusy(false);
      return;
    }
    const t = setTimeout(() => pinRefs.current[0]?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  const filledPin = useMemo(() => pinToString(pin), [pin]);
  const filledConfirm = useMemo(() => pinToString(pinConfirm), [pinConfirm]);

  function refsFor(field) {
    return field === 'primary' ? pinRefs.current : confirmRefs.current;
  }

  function setterFor(field) {
    return field === 'primary' ? setPin : setPinConfirm;
  }

  function fillFrom(field, startIndex, raw) {
    const digits = (raw.match(/[0-9]/g) || []).slice(0, PIN_LENGTH - startIndex);
    if (digits.length === 0) return;
    const setter = setterFor(field);
    const refs = refsFor(field);
    setter((prev) => {
      const next = [...prev];
      for (let i = 0; i < digits.length; i += 1) next[startIndex + i] = digits[i];
      return next;
    });
    setError(null);
    const focusIndex = Math.min(startIndex + digits.length, PIN_LENGTH - 1);
    refs[focusIndex]?.focus();
  }

  function handleDigitChange(field, index, raw) {
    if (raw.length > 1) {
      fillFrom(field, index, raw);
      return;
    }
    const digit = /^[0-9]$/.test(raw) ? raw : '';
    setterFor(field)((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    setError(null);
    const refs = refsFor(field);
    if (digit && index < PIN_LENGTH - 1) refs[index + 1]?.focus();
  }

  function handleKeyDown(field, index, event) {
    const values = field === 'primary' ? pin : pinConfirm;
    const refs = refsFor(field);
    if (event.key === 'Backspace' && !values[index] && index > 0) {
      refs[index - 1]?.focus();
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      refs[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < PIN_LENGTH - 1) {
      refs[index + 1]?.focus();
    }
  }

  function handlePaste(field, event) {
    const text = (event.clipboardData?.getData('text') || '').trim();
    if (!text) return;
    event.preventDefault();
    fillFrom(field, 0, text);
  }

  if (!open) return null;

  const headline = isSetup ? 'Set your PIN.' : 'Enter your PIN.';
  const kicker = isSetup ? 'Encryption mode' : 'Unlock encryption';
  const submitLabel = isSetup ? 'Lock it' : 'Unlock';

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (filledPin.length !== PIN_LENGTH) {
      setError(`Enter all ${PIN_LENGTH} digits`);
      return;
    }
    if (isSetup) {
      if (filledConfirm.length !== PIN_LENGTH) {
        setError(`Enter the same ${PIN_LENGTH} numbers twice`);
        return;
      }
      if (filledPin !== filledConfirm) {
        setError(`Enter the same ${PIN_LENGTH} numbers twice`);
        return;
      }
    }
    setBusy(true);
    try {
      await onSubmit(filledPin);
    } catch (err) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const submitDisabled =
    busy
    || filledPin.length !== PIN_LENGTH
    || (isSetup && filledConfirm.length !== PIN_LENGTH);

  return (
    <div
      className="pin-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={headline}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel?.();
      }}
    >
      <form className="pin-modal" onSubmit={handleSubmit}>
        <button
          type="button"
          className="pin-modal__close"
          onClick={onCancel}
          disabled={busy}
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <p className="pin-modal__kicker">{kicker}</p>
        <h1 className="pin-modal__headline">{headline}</h1>

        <div className="pin-card">
          <label className="pin-label">{`Enter ${PIN_LENGTH} numbers`}</label>
          <div className="pin-row" onPaste={(e) => handlePaste('primary', e)}>
            {pin.map((digit, index) => (
              <input
                key={index}
                ref={(el) => { pinRefs.current[index] = el; }}
                className="pin-input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={1}
                value={digit}
                disabled={busy}
                onChange={(e) => handleDigitChange('primary', index, e.target.value)}
                onKeyDown={(e) => handleKeyDown('primary', index, e)}
                aria-label={`PIN digit ${index + 1}`}
              />
            ))}
          </div>

          {isSetup && (
            <>
              <label className="pin-label">Enter them again</label>
              <div className="pin-row" onPaste={(e) => handlePaste('confirm', e)}>
                {pinConfirm.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => { confirmRefs.current[index] = el; }}
                    className="pin-input"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={1}
                    value={digit}
                    disabled={busy}
                    onChange={(e) => handleDigitChange('confirm', index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown('confirm', index, e)}
                    aria-label={`Confirm PIN digit ${index + 1}`}
                  />
                ))}
              </div>
            </>
          )}

          {isSetup && (
            <p className="pin-warning">
              Write the PIN somewhere else safely.
            </p>
          )}

          {error && (
            <p className="pin-error" role="alert">{error}</p>
          )}
        </div>

        <div className="pin-modal__actions">
          <button
            type="submit"
            className="pin-modal__continue"
            disabled={submitDisabled}
          >
            {busy ? 'Working…' : submitLabel}
          </button>
          <button
            type="button"
            className="pin-modal__back"
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
