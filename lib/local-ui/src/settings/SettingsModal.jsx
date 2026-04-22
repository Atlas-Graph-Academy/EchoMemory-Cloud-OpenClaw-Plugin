import React, { useEffect, useRef, useState } from 'react';
import './SettingsModal.css';

/**
 * SettingsModal — a single, discoverable home for all backend config
 * that the old permanent left sidebar used to host.
 *
 * Sections:
 *  - Connect (email + OTP)  — shown when not connected
 *  - Connection             — shown when connected (disconnect)
 *  - Configuration          — api key, memory dir, autosync, batch, timeout, echo-only
 *  - Plugin updates         — version info, check, update, restart gateway
 *
 * All handlers are passed in from App.jsx so this component stays presentational.
 */
export function SettingsModal({
  open,
  onClose,
  // connection
  isConnected,
  hasApiKey,
  authLabel,
  // connect (OTP) flow
  emailConnectState,
  connectEmail,
  onConnectEmailChange,
  onSendOtp,
  otpDigits,
  onOtpDigitChange,
  onOtpKeyDown,
  onOtpPaste,
  onVerifyOtp,
  otpValue,
  otpLength,
  otpInputRefs,
  resendCountdown,
  onResetQuickConnect,
  connectError,
  // disconnect
  onDisconnect,
  disconnecting,
  // configuration
  setupState,
  setupDraft,
  autoSyncEnabled,
  echoOnlyMemoryModeEnabled,
  onSetupFieldChange,
  onSetupSave,
  setupSaving,
  setupMessage,
  formatSourceLabel,
  // plugin updates
  pluginVersion,
  pluginUpdateState,
  pluginUpdateLoading,
  pluginUpdateBusy,
  gatewayRestartBusy,
  canTriggerPluginUpdate,
  onLoadPluginUpdateStatus,
  onPluginUpdate,
  onGatewayRestart,
  pluginUpdateMessage,
  pluginPackageName,
  timeAgo,
}) {
  const [expanded, setExpanded] = useState({
    config: true,
    updates: false,
  });

  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && panelRef.current) {
      panelRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  const showConnect = !isConnected;
  const toggle = (key) => setExpanded((p) => ({ ...p, [key]: !p[key] }));

  return (
    <>
      <div className="settings-overlay" onClick={onClose} aria-hidden="true" />
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="settings-head">
          <div className="settings-head__main">
            <h2 className="settings-title">Settings</h2>
            <div className="settings-status">
              <span className={`settings-pill ${isConnected ? 'settings-pill--ok' : ''}`}>
                {authLabel || (isConnected ? 'Connected' : 'Local-only')}
              </span>
              {hasApiKey && (
                <>
                  <button
                    type="button"
                    className="settings-disconnect"
                    disabled={setupSaving || disconnecting}
                    onClick={onDisconnect}
                  >
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                  <span className="settings-status__hint">
                    You can reconnect any time with the same email — your memories stay local.
                  </span>
                </>
              )}
            </div>
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close settings">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </header>

        <div className="settings-body">
          {/* ─── Connect (OTP) ─── */}
          {showConnect && (
            <section className="settings-card">
              <h3 className="settings-card__title">Connect to Echo Cloud</h3>
              <p className="settings-card__blurb">
                One memory layer across all your AI tools. Enter your email — we send a code, you're in.
              </p>

              {(emailConnectState === 'idle' || emailConnectState === 'sending') && (
                <div className="settings-row">
                  <input
                    type="email"
                    className="settings-input"
                    value={connectEmail || ''}
                    placeholder="you@example.com"
                    autoComplete="email"
                    disabled={emailConnectState === 'sending'}
                    onChange={(e) => onConnectEmailChange?.(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && connectEmail) onSendOtp?.(); }}
                  />
                  <button
                    type="button"
                    className="sync-cta settings-send"
                    disabled={emailConnectState === 'sending' || !connectEmail}
                    onClick={onSendOtp}
                  >
                    {emailConnectState === 'sending' ? 'Sending…' : 'Get code →'}
                  </button>
                </div>
              )}

              {(emailConnectState === 'otp_sent' || emailConnectState === 'verifying') && (
                <div className="settings-otp">
                  <p className="settings-otp__label">
                    Enter the 6-digit code sent to <strong>{connectEmail}</strong>
                  </p>
                  <div className="settings-otp__row">
                    <div className="settings-otp__grid" onPaste={onOtpPaste}>
                      {otpDigits?.map((digit, index) => (
                        <input
                          key={`otp-${index}`}
                          ref={(node) => { if (otpInputRefs?.current) otpInputRefs.current[index] = node; }}
                          className="settings-otp__input"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete={index === 0 ? 'one-time-code' : 'off'}
                          maxLength={1}
                          value={digit}
                          disabled={emailConnectState === 'verifying'}
                          onChange={(e) => onOtpDigitChange?.(index, e.target.value)}
                          onKeyDown={(e) => onOtpKeyDown?.(index, e)}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="sync-cta"
                      disabled={emailConnectState === 'verifying' || (otpValue?.length ?? 0) < (otpLength ?? 6)}
                      onClick={onVerifyOtp}
                    >
                      {emailConnectState === 'verifying' ? 'Verifying…' : 'Verify →'}
                    </button>
                  </div>
                  <div className="settings-otp__actions">
                    {resendCountdown > 0 ? (
                      <span className="settings-hint">Resend in {resendCountdown}s</span>
                    ) : (
                      <button type="button" className="settings-linkbtn" onClick={onSendOtp}>Resend code</button>
                    )}
                    <button type="button" className="settings-linkbtn" onClick={onResetQuickConnect}>
                      Use another email
                    </button>
                  </div>
                </div>
              )}

              {connectError && <p className="settings-msg settings-msg--error">{connectError}</p>}
            </section>
          )}

          {/* ─── Configuration ─── */}
          <section className="settings-card settings-card--collapsible">
            <button
              type="button"
              className="settings-card__toggle"
              aria-expanded={expanded.config}
              onClick={() => toggle('config')}
            >
              <span>Configuration</span>
              <span className={`settings-chevron ${expanded.config ? 'settings-chevron--open' : ''}`}>▸</span>
            </button>
            {expanded.config && (
              <div className="settings-card__body">
                <label className="settings-field">
                  <span>Echo API key</span>
                  <input
                    type="password"
                    value={setupDraft?.apiKey || ''}
                    placeholder={setupState?.fields?.apiKey?.maskedValue || 'ec_…'}
                    autoComplete="new-password"
                    onChange={(e) => onSetupFieldChange?.('apiKey', e.target.value)}
                  />
                  <small>
                    Auto-saved to <code>~/.openclaw/.env</code> when you connect with email.
                    To rotate: disconnect above, then reconnect — a fresh key is issued each time.
                    Or paste one from{' '}
                    <a href="https://iditor.com/account/api-keys" target="_blank" rel="noopener noreferrer">
                      iditor.com/account/api-keys ↗
                    </a>.
                  </small>
                  <small className="settings-field__source">
                    Source: {formatSourceLabel?.(setupState?.fields?.apiKey, setupState) || '—'}
                  </small>
                </label>

                <label className="settings-field">
                  <span>Memory directory</span>
                  <input
                    type="text"
                    value={setupDraft?.memoryDir || setupState?.fields?.memoryDir?.value || ''}
                    placeholder={setupState?.fields?.memoryDir?.value || ''}
                    onChange={(e) => onSetupFieldChange?.('memoryDir', e.target.value)}
                  />
                  <small>
                    Folder Echo scans for markdown memories. Defaults to <code>~/.openclaw/workspace/memory</code>.
                    Drop new <code>.md</code> files here and they'll show up in the dashboard automatically.
                  </small>
                  <small className="settings-field__source">
                    Source: {formatSourceLabel?.(setupState?.fields?.memoryDir, setupState) || '—'}
                  </small>
                </label>

                <label className="settings-field settings-field--check">
                  <input
                    type="checkbox"
                    checked={!!autoSyncEnabled}
                    onChange={(e) => onSetupFieldChange?.('autoSync', e.target.checked)}
                  />
                  <div>
                    <span>Autosync</span>
                    <small>Scan the memory directory and sync changed files on a schedule.</small>
                  </div>
                </label>

                <label className="settings-field">
                  <span>Autosync interval (minutes)</span>
                  <input
                    type="number"
                    min="15"
                    step="1"
                    value={setupDraft?.syncIntervalMinutes ?? ''}
                    onChange={(e) => onSetupFieldChange?.('syncIntervalMinutes', e.target.value)}
                  />
                  <small>Minimum 15 minutes.</small>
                </label>

                <label className="settings-field">
                  <span>Sync batch size</span>
                  <input
                    type="number"
                    min="1"
                    max="25"
                    step="1"
                    value={setupDraft?.batchSize ?? ''}
                    onChange={(e) => onSetupFieldChange?.('batchSize', e.target.value)}
                  />
                  <small>Files per sync request. Range 1–25.</small>
                </label>

                <label className="settings-field">
                  <span>Request timeout (ms)</span>
                  <input
                    type="number"
                    min="1000"
                    max="900000"
                    step="1000"
                    value={setupDraft?.requestTimeoutMs ?? ''}
                    onChange={(e) => onSetupFieldChange?.('requestTimeoutMs', e.target.value)}
                  />
                  <small>Echo API request timeout. Range 1,000–900,000 ms.</small>
                </label>

                <label className="settings-field settings-field--check">
                  <input
                    type="checkbox"
                    checked={!!echoOnlyMemoryModeEnabled}
                    onChange={(e) => onSetupFieldChange?.('disableOpenClawMemoryToolsWhenConnected', e.target.checked)}
                  />
                  <div>
                    <span>Echo-only memory retrieval</span>
                    <small>
                      Steer retrieval to <code>echo_memory_search</code> when cloud mode is available. Requires connected state.
                    </small>
                  </div>
                </label>

                <div className="settings-actions">
                  <button className="sync-cta" disabled={setupSaving} onClick={onSetupSave}>
                    {setupSaving ? 'Saving…' : 'Save settings'}
                  </button>
                </div>

                {setupMessage && (
                  <p className={`settings-msg ${setupMessage.ok ? 'settings-msg--ok' : 'settings-msg--error'}`}>
                    {setupMessage.text}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* ─── Plugin updates ─── */}
          <section className="settings-card settings-card--collapsible">
            <button
              type="button"
              className="settings-card__toggle"
              aria-expanded={expanded.updates}
              onClick={() => toggle('updates')}
            >
              <span>Plugin updates</span>
              <span className={`settings-chevron ${expanded.updates ? 'settings-chevron--open' : ''}`}>▸</span>
            </button>
            {expanded.updates && (
              <div className="settings-card__body">
                <div className="settings-version">
                  <div className="settings-version__row">
                    <strong>
                      v{pluginUpdateState?.currentVersion || pluginVersion || '—'}
                    </strong>
                    <span className="settings-version__arrow">→</span>
                    <strong>
                      {pluginUpdateLoading
                        ? 'checking…'
                        : pluginUpdateState?.latestVersion
                          ? `v${pluginUpdateState.latestVersion}`
                          : '—'}
                    </strong>
                    <span className={`settings-version__badge ${
                      pluginUpdateState?.updateAvailable ? 'settings-version__badge--update' : ''
                    }`}>
                      {pluginUpdateLoading
                        ? 'checking'
                        : pluginUpdateState?.error
                          ? 'check failed'
                          : pluginUpdateState?.updateAvailable
                            ? 'update available'
                            : pluginUpdateState?.latestVersion
                              ? 'up to date'
                              : 'not checked'}
                    </span>
                  </div>
                  <small className="settings-hint">
                    Installed from {pluginUpdateState?.installSourceLabel || '—'}
                    {pluginUpdateState?.checkedAt && ` · ${timeAgo?.(pluginUpdateState.checkedAt)}`}
                  </small>
                </div>

                {pluginUpdateState?.updateDisabledReason && (
                  <small className="settings-hint">{pluginUpdateState.updateDisabledReason}</small>
                )}
                {pluginUpdateState?.error && (
                  <p className="settings-msg settings-msg--error">{pluginUpdateState.error}</p>
                )}

                <div className="settings-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={onLoadPluginUpdateStatus}
                    disabled={pluginUpdateLoading || pluginUpdateBusy || gatewayRestartBusy}
                  >
                    {pluginUpdateLoading ? 'Checking…' : 'Check latest'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={onPluginUpdate}
                    disabled={
                      !pluginUpdateState
                      || !canTriggerPluginUpdate
                      || pluginUpdateLoading
                      || pluginUpdateBusy
                      || gatewayRestartBusy
                    }
                  >
                    {pluginUpdateBusy
                      ? 'Updating…'
                      : pluginUpdateState?.updateAvailable ? 'Update plugin' : 'Install latest'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={onGatewayRestart}
                    disabled={gatewayRestartBusy || pluginUpdateBusy}
                  >
                    {gatewayRestartBusy ? 'Restarting…' : 'Restart gateway'}
                  </button>
                </div>

                <small className="settings-hint">
                  Update installs the published npm package. Restart the gateway afterward to load the new version.
                </small>
                {pluginUpdateState?.releaseUrl && (
                  <small className="settings-hint">
                    <a href={pluginUpdateState.releaseUrl} target="_blank" rel="noopener noreferrer">View release page ↗</a>
                  </small>
                )}
                {pluginUpdateMessage && (
                  <p className={`settings-msg ${pluginUpdateMessage.ok ? 'settings-msg--ok' : 'settings-msg--error'}`}>
                    {pluginUpdateMessage.text}
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
