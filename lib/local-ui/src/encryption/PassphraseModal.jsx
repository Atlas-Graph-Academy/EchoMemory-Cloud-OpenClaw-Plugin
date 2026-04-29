import { useEffect, useRef, useState } from 'react';
import './PassphraseModal.css';

const PIN_LENGTH = 5;
const PIN_MIN = 5;
const EMPTY_PIN = Array.from({ length: PIN_LENGTH }, () => '');

function pinToString(pin) {
  return pin.join('');
}

/**
 * PassphraseModal — passphrase entry for unlocking the cached encryption
 * key or initial setup, depending on `mode`.
 *
 * Two input modes (toggled by the user):
 *   - 'slots'  → 5-character grid (default; visual clarity, alphanumeric + symbols)
 *   - 'phrase' → single text field, no length cap (for users who want longer)
 *
 * Setup flow is split into two steps:
 *   - 'enter'   → first entry, shown in clear text
 *   - 'confirm' → second entry, masked by default with a Show/Hide toggle
 *
 * Unlock flow is a single masked entry with the same Show/Hide toggle.
 *
 * `onSubmit(passphrase)` should resolve on success or throw with a user-facing
 * message on failure. The modal owns its own error/loading state.
 */
export function PassphraseModal({ open, mode, onSubmit, onCancel }) {
  const [pin, setPin] = useState(EMPTY_PIN);
  const [pinConfirm, setPinConfirm] = useState(EMPTY_PIN);
  const [phrase, setPhrase] = useState('');
  const [phraseConfirm, setPhraseConfirm] = useState('');
  const [passphraseMode, setPassphraseMode] = useState('slots');
  const [setupStep, setSetupStep] = useState('enter');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const pinRefs = useRef([]);
  const confirmRefs = useRef([]);
  const phraseRef = useRef(null);
  const phraseConfirmRef = useRef(null);

  const isSetup = mode === 'setup';

  useEffect(() => {
    if (!open) {
      setPin(EMPTY_PIN);
      setPinConfirm(EMPTY_PIN);
      setPhrase('');
      setPhraseConfirm('');
      setPassphraseMode('slots');
      setSetupStep('enter');
      setReveal(false);
      setError(null);
      setBusy(false);
      return;
    }
    setSetupStep('enter');
    setReveal(false);
    setError(null);
    setBusy(false);
    const t = setTimeout(() => {
      // Focus first input — defer to slot mode default
      pinRefs.current[0]?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [open]);

  function clearAllInputs() {
    setPin(EMPTY_PIN);
    setPinConfirm(EMPTY_PIN);
    setPhrase('');
    setPhraseConfirm('');
  }

  function getValue(field) {
    if (passphraseMode === 'slots') {
      return field === 'enter' ? pinToString(pin) : pinToString(pinConfirm);
    }
    return field === 'enter' ? phrase : phraseConfirm;
  }

  function isValid(value) {
    return value.length >= PIN_MIN && !/\s/.test(value);
  }

  function focusFirst(field) {
    if (passphraseMode === 'slots') {
      const refs = field === 'enter' ? pinRefs.current : confirmRefs.current;
      refs[0]?.focus();
    } else {
      const ref = field === 'enter' ? phraseRef : phraseConfirmRef;
      ref.current?.focus();
    }
  }

  function handleSwitchMode(newMode) {
    if (newMode === passphraseMode) return;
    setPassphraseMode(newMode);
    // Slot input and phrase input aren't interchangeable — wipe everything
    // and drop back to the first step so the two halves can't desync.
    clearAllInputs();
    setSetupStep('enter');
    setReveal(false);
    setError(null);
    setTimeout(() => focusFirst('enter'), 60);
  }

  function handleSlotChange(field, index, raw) {
    if (raw.length > 1) {
      fillFrom(field, index, raw);
      return;
    }
    const ch = raw.replace(/\s/g, '').slice(-1);
    const setter = field === 'enter' ? setPin : setPinConfirm;
    setter((prev) => {
      const next = [...prev];
      next[index] = ch;
      return next;
    });
    setError(null);
    if (ch && index < PIN_LENGTH - 1) {
      const refs = field === 'enter' ? pinRefs.current : confirmRefs.current;
      refs[index + 1]?.focus();
    }
  }

  function fillFrom(field, startIndex, raw) {
    const chars = (raw.match(/\S/g) || []).slice(0, PIN_LENGTH - startIndex);
    if (chars.length === 0) return;
    const setter = field === 'enter' ? setPin : setPinConfirm;
    setter((prev) => {
      const next = [...prev];
      for (let i = 0; i < chars.length; i += 1) next[startIndex + i] = chars[i];
      return next;
    });
    setError(null);
    const refs = field === 'enter' ? pinRefs.current : confirmRefs.current;
    refs[Math.min(startIndex + chars.length, PIN_LENGTH - 1)]?.focus();
  }

  function handleSlotKeyDown(field, index, event) {
    const values = field === 'enter' ? pin : pinConfirm;
    const refs = field === 'enter' ? pinRefs.current : confirmRefs.current;
    if (event.key === 'Backspace' && !values[index] && index > 0) {
      refs[index - 1]?.focus();
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) refs[index - 1]?.focus();
    else if (event.key === 'ArrowRight' && index < PIN_LENGTH - 1) refs[index + 1]?.focus();
    else if (event.key === 'Enter') {
      event.preventDefault();
      void handleNext();
    }
  }

  function handlePhraseChange(field, value) {
    const cleaned = value.replace(/\s/g, '');
    if (field === 'enter') setPhrase(cleaned);
    else setPhraseConfirm(cleaned);
    setError(null);
  }

  function handlePaste(field, event) {
    const text = (event.clipboardData?.getData('text') || '').trim();
    if (!text) return;
    event.preventDefault();
    fillFrom(field, 0, text);
  }

  async function handleNext() {
    if (busy) return;
    setError(null);

    if (!isSetup) {
      const value = getValue('enter');
      if (!value) {
        setError('Enter your passphrase to unlock.');
        return;
      }
      setBusy(true);
      try {
        await onSubmit(value);
      } catch (err) {
        setError(err?.message || 'Something went wrong');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (setupStep === 'enter') {
      const value = getValue('enter');
      if (!isValid(value)) {
        setError(`Use at least ${PIN_MIN} characters, no spaces.`);
        return;
      }
      setReveal(false);
      setSetupStep('confirm');
      setTimeout(() => focusFirst('confirm'), 60);
      return;
    }

    const setupValue = getValue('enter');
    const confirmValue = getValue('confirm');
    if (!isValid(confirmValue)) {
      setError(`Use at least ${PIN_MIN} characters, no spaces.`);
      return;
    }
    if (setupValue !== confirmValue) {
      setError("Passphrases don't match — try again.");
      setPinConfirm(EMPTY_PIN);
      setPhraseConfirm('');
      setTimeout(() => focusFirst('confirm'), 60);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(setupValue);
    } catch (err) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function handleBack() {
    setSetupStep('enter');
    setReveal(false);
    setError(null);
    setPinConfirm(EMPTY_PIN);
    setPhraseConfirm('');
    setTimeout(() => focusFirst('enter'), 60);
  }

  if (!open) return null;

  const showingConfirm = isSetup && setupStep === 'confirm';
  const currentField = showingConfirm ? 'confirm' : 'enter';
  const showEye = !isSetup || showingConfirm;
  const inputType = showEye && !reveal ? 'password' : 'text';

  const headline = isSetup
    ? (showingConfirm ? 'One more time.' : 'Lock it down.')
    : 'Welcome back.';
  const kicker = isSetup
    ? (showingConfirm ? 'Confirm passphrase' : 'Encrypted vault')
    : 'Unlock vault';
  const fieldLabel = isSetup
    ? (showingConfirm ? 'Confirm your passphrase' : 'Set a passphrase')
    : 'Your passphrase';
  const submitLabel = isSetup
    ? (showingConfirm ? 'Lock it' : 'Continue')
    : 'Unlock';

  const submitDisabled = busy || !isValid(getValue(currentField));

  function renderSlots(field) {
    const values = field === 'enter' ? pin : pinConfirm;
    const refs = field === 'enter' ? pinRefs : confirmRefs;
    const slotType = field === 'enter' && !showEye ? 'text' : inputType;
    return (
      <div className="pin-row" onPaste={(e) => handlePaste(field, e)}>
        {values.map((char, index) => (
          <input
            key={index}
            ref={(el) => { refs.current[index] = el; }}
            className="pin-input"
            type={slotType}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            maxLength={1}
            value={char}
            disabled={busy}
            onChange={(e) => handleSlotChange(field, index, e.target.value)}
            onKeyDown={(e) => handleSlotKeyDown(field, index, e)}
            aria-label={`${field === 'enter' ? 'Passphrase' : 'Confirm'} character ${index + 1}`}
          />
        ))}
      </div>
    );
  }

  function renderPhrase(field) {
    const value = field === 'enter' ? phrase : phraseConfirm;
    const ref = field === 'enter' ? phraseRef : phraseConfirmRef;
    const phraseType = field === 'enter' && !showEye ? 'text' : inputType;
    const placeholder = field === 'enter'
      ? (isSetup ? `At least ${PIN_MIN} characters` : 'Type your passphrase')
      : 'Type your passphrase again';
    return (
      <input
        ref={ref}
        className="pin-passphrase-input"
        type={phraseType}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="off"
        value={value}
        placeholder={placeholder}
        disabled={busy}
        onChange={(e) => handlePhraseChange(field, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleNext(); } }}
      />
    );
  }

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
      <form className="pin-modal" onSubmit={(e) => { e.preventDefault(); void handleNext(); }}>
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
          <label className="pin-label">{fieldLabel}</label>
          {passphraseMode === 'slots' ? renderSlots(currentField) : renderPhrase(currentField)}

          {/* Hint — only on setup enter step. Two voices: mono row gives the
              rule, Caveat row gives guidance. No "no spaces" scolding. */}
          {isSetup && !showingConfirm && (
            <div className="pin-hint">
              <span className="pin-hint__mono">a &middot; A &middot; 0&ndash;9 &middot; !, . ?</span>
              <span className="pin-hint__script">case matters &middot; spaces are skipped</span>
            </div>
          )}

          {/* Mode toggle — only on setup enter step. Confirm inherits mode silently. */}
          {isSetup && !showingConfirm && (
            <button
              type="button"
              className="pin-mode-switch"
              onClick={() => handleSwitchMode(passphraseMode === 'slots' ? 'phrase' : 'slots')}
              disabled={busy}
            >
              {passphraseMode === 'slots' ? 'Use a longer passphrase →' : '← Use the 5-character mode'}
            </button>
          )}

          {/* Show / Hide eye — only when input is masked (confirm step or unlock) */}
          {showEye && (
            <button
              type="button"
              className="pin-eye-toggle"
              onClick={() => setReveal((v) => !v)}
              disabled={busy}
              aria-label={reveal ? 'Hide passphrase' : 'Show passphrase'}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>{reveal ? 'Hide' : 'Show'}</span>
            </button>
          )}

          {isSetup && !showingConfirm && (
            <p className="pin-warning">
              Save this passphrase somewhere safe. If you lose it, no one &mdash; not even Echo &mdash; can recover your encrypted memories.
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
          {showingConfirm ? (
            <button
              type="button"
              className="pin-modal__back"
              onClick={handleBack}
              disabled={busy}
            >
              ← Change my passphrase
            </button>
          ) : (
            <button
              type="button"
              className="pin-modal__back"
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
