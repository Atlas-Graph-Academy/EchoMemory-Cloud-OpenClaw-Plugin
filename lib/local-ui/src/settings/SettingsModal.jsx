import React, { useEffect, useRef, useState } from 'react';
import './SettingsModal.css';

const ECHO_PLATFORM_ICONS = [
  { label: 'OpenClaw', src: '/assets/platform_icons/OpenClaw-Logo.png' },
  { label: 'ChatGPT', src: '/assets/platform_icons/ChatGPT-Logo.svg' },
  { label: 'Claude', src: '/assets/platform_icons/Claude-Logo.png' },
  { label: 'Gemini', src: '/assets/platform_icons/Gemini-Logo.png' },
  { label: 'Perplexity', src: '/assets/platform_icons/Perplexity-Logo.png' },
  { label: 'DeepSeek', src: '/assets/platform_icons/DeepSeek-Logo.png' },
];

const COMMUNITY_AVATARS = [
  { initial: 'A', tone: 'mint' },
  { initial: 'M', tone: 'cream' },
  { initial: 'J', tone: 'blue' },
  { initial: 'K', tone: 'pink' },
];

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
  // encryption mode (lifted to App.jsx so OTP success can trigger PIN setup)
  encryptionMode,
  onEncryptionModeChange,
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
    config: false,
    updates: false,
  });
  // encryptionMode is now a controlled prop driven by App.jsx so the post-OTP
  // flow can read it. Don't shadow it with local state.

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
  const isOtpStep = emailConnectState === 'otp_sent' || emailConnectState === 'verifying';
  const title = showConnect ? 'Connect Echo Memory' : 'Echo Settings';
  const subtitle = showConnect
    ? 'Yours by default. Private by design.'
    : 'Echo Cloud is connected. Local controls are available below.';
  const toggle = (key) => setExpanded((p) => ({ ...p, [key]: !p[key] }));

  if (showConnect) {
    return (
      <>
        <div className="settings-overlay" onClick={onClose} aria-hidden="true" />
        <div
          className="settings-modal settings-modal--connect"
          role="dialog"
          aria-modal="true"
          aria-label="Connect Echo Memory"
          ref={panelRef}
          tabIndex={-1}
        >
          <div className="connect-card" data-tour="email-connect">
            <button
              type="button"
              className="connect-close"
              onClick={onClose}
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>

            <p className="connect-kicker">Connect Echo Memory</p>
            <h2 className="connect-title">Yours by default.</h2>
            <p className="connect-protected">Your memories, your call.</p>

            <ul className="connect-values">
              <li className="connect-value">
                <span className="connect-value__label">100% private</span>
                <span className="connect-value__copy">AES-256 encryption before sync.</span>
              </li>
              <li className="connect-value">
                <span className="connect-value__label">All memories in one account</span>
                <span className="connect-source-row" aria-label="Connected AI tools">
                  {ECHO_PLATFORM_ICONS.map((platform) => (
                    <span
                      key={platform.label}
                      className="connect-source-chip"
                      title={platform.label}
                    >
                      <img src={platform.src} alt="" aria-hidden="true" />
                    </span>
                  ))}
                </span>
              </li>
              <li className="connect-value">
                <span className="connect-value__label">Share and meet friends</span>
                <span className="connect-avatar-row" aria-label="Echo community members">
                  {COMMUNITY_AVATARS.map((avatar) => (
                    <span
                      key={avatar.initial}
                      className="connect-avatar"
                      data-tone={avatar.tone}
                      aria-hidden="true"
                    >
                      {avatar.initial}
                    </span>
                  ))}
                </span>
              </li>
            </ul>

            {!isOtpStep ? (
              <>
                <fieldset className="connect-mode-picker">
                  <div className="connect-mode-picker__legend">
                    <span>Choose a protection mode</span>
                    <span className="connect-status-pill">Protected</span>
                  </div>

                  <div className="connect-mode-grid">
                    <label
                      className={`connect-mode connect-mode--regular${encryptionMode === 'regular' ? ' is-checked' : ''}`}
                    >
                      <input
                        type="radio"
                        name="privacy-mode"
                        value="regular"
                        checked={encryptionMode === 'regular'}
                        onChange={() => onEncryptionModeChange?.('regular')}
                      />
                      <div className="connect-mode__top">
                        <span className="connect-mode__name">Regular</span>
                        <span className="connect-radio-mark" aria-hidden="true" />
                      </div>
                      <p className="connect-mode__copy">
                        Fast sync, full search, and Echo-managed encryption.
                      </p>
                      <span className="connect-mode__meta">Quick start</span>
                    </label>

                    <label
                      className={`connect-mode connect-mode--e2ee${encryptionMode === 'e2ee' ? ' is-checked' : ''}`}
                    >
                      <input
                        type="radio"
                        name="privacy-mode"
                        value="e2ee"
                        checked={encryptionMode === 'e2ee'}
                        onChange={() => onEncryptionModeChange?.('e2ee')}
                      />
                      <div className="connect-mode__top">
                        <span className="connect-mode__name">End-to-end</span>
                        <span className="connect-radio-mark" aria-hidden="true" />
                      </div>
                      <p className="connect-mode__copy">
                        AES-256 encryption before sync. Only this device holds the key.
                      </p>
                      <span className="connect-free-tag" aria-label="Free forever for beta users">
                        <span className="connect-free-tag__free">free</span>
                        <span className="connect-free-tag__copy">forever for beta users</span>
                      </span>
                    </label>
                  </div>
                </fieldset>

                <p className="connect-terms">
                  By continuing, you agree to Echo's{' '}
                  <a href="https://www.iditor.com/terms-of-use" target="_blank" rel="noopener noreferrer">
                    Terms of Use
                  </a>.
                </p>

                <div className="connect-actions">
                  <input
                    type="email"
                    className="connect-email"
                    value={connectEmail || ''}
                    placeholder="Your email"
                    autoComplete="email"
                    aria-label="Your email"
                    disabled={emailConnectState === 'sending'}
                    onChange={(e) => onConnectEmailChange?.(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && connectEmail) onSendOtp?.(); }}
                  />
                  <button
                    type="button"
                    className="connect-continue"
                    disabled={emailConnectState === 'sending' || !connectEmail}
                    onClick={onSendOtp}
                  >
                    {emailConnectState === 'sending' ? 'Sending…' : 'Continue'}
                  </button>
                </div>
              </>
            ) : (
              <div className="connect-otp-block">
                <div className="connect-otp__head">
                  <span className="connect-otp__title">Enter verification code</span>
                  <p className="connect-otp__label">
                    Sent to <strong>{connectEmail}</strong>
                  </p>
                </div>
                <div className="connect-otp__grid" onPaste={onOtpPaste}>
                  {otpDigits?.map((digit, index) => (
                    <input
                      key={`otp-${index}`}
                      ref={(node) => { if (otpInputRefs?.current) otpInputRefs.current[index] = node; }}
                      className="connect-otp__input"
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
                  className="connect-continue connect-continue--otp"
                  disabled={emailConnectState === 'verifying' || (otpValue?.length ?? 0) < (otpLength ?? 6)}
                  onClick={onVerifyOtp}
                >
                  {emailConnectState === 'verifying' ? 'Verifying…' : 'Verify'}
                </button>
                <div className="connect-otp__actions">
                  {resendCountdown > 0 ? (
                    <span className="connect-hint">Resend in {resendCountdown}s</span>
                  ) : (
                    <button type="button" className="connect-link" onClick={onSendOtp}>Resend code</button>
                  )}
                  <button type="button" className="connect-link" onClick={onResetQuickConnect}>
                    Use another email
                  </button>
                </div>
              </div>
            )}

            {connectError && <p className="connect-error">{connectError}</p>}

            {hasApiKey && (
              <div className="connect-existing-key">
                <span>There is already a saved Echo key on this machine.</span>
                <button
                  type="button"
                  className="connect-secondary"
                  disabled={setupSaving || disconnecting}
                  onClick={onDisconnect}
                >
                  {disconnecting ? 'Clearing…' : 'Clear saved key'}
                </button>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

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
            <h2 className="settings-title">{title}</h2>
            <p className="settings-subtitle">{subtitle}</p>
            <div className="settings-status">
              <span className="settings-pill settings-pill--ok">
                {authLabel || 'Connected'}
              </span>
            </div>
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close settings">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </header>

        <div className="settings-body">
          {!showConnect && (
            <section className="settings-hero settings-hero--connected">
              <div className="settings-hero__intro">
                <span className="settings-eyebrow">Connected</span>
                <h3>Your OpenClaw memories can sync to Echo Cloud.</h3>
                <p>
                  Echo keeps them in one end-to-end encrypted memory network across OpenClaw,
                  ChatGPT, Claude, Gemini, Perplexity, DeepSeek and more.
                </p>
              </div>
              <div className="settings-platforms" aria-label="Echo memory network">
                {ECHO_PLATFORM_ICONS.map((platform) => (
                  <span key={platform.label} className="settings-platform-icon" title={platform.label}>
                    <img src={platform.src} alt="" aria-hidden="true" />
                  </span>
                ))}
              </div>
              {hasApiKey && (
                <div className="settings-connected-actions">
                  <span>Your memories stay local if you disconnect. You can reconnect any time with the same email.</span>
                  <button
                    type="button"
                    className="settings-disconnect"
                    disabled={setupSaving || disconnecting}
                    onClick={onDisconnect}
                  >
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </div>
              )}
            </section>
          )}

          {/* ─── Configuration ─── */}
          <section className="settings-card settings-card--collapsible">
            <button
              type="button"
              className={`settings-card__toggle ${showConnect ? 'settings-card__toggle--disabled' : ''}`}
              aria-expanded={!showConnect && expanded.config}
              disabled={showConnect}
              onClick={() => {
                if (!showConnect) toggle('config');
              }}
            >
              <span className="settings-card__toggle-copy">
                <span>Advanced local settings</span>
                <small>API key, memory folder, autosync, timeouts.</small>
              </span>
              <span className={`settings-chevron ${expanded.config ? 'settings-chevron--open' : ''}`}>▸</span>
            </button>
            {!showConnect && expanded.config && (
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
                    Usually handled by Echo login. Paste a key only if you need a manual override from{' '}
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
                    <small>Scan and sync changed files on a schedule.</small>
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
                      Use <code>echo_memory_search</code> when cloud mode is available.
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
              className={`settings-card__toggle ${showConnect ? 'settings-card__toggle--disabled' : ''}`}
              aria-expanded={!showConnect && expanded.updates}
              disabled={showConnect}
              onClick={() => {
                if (!showConnect) toggle('updates');
              }}
            >
              <span>Plugin updates</span>
              <span className={`settings-chevron ${expanded.updates ? 'settings-chevron--open' : ''}`}>▸</span>
            </button>
            {!showConnect && expanded.updates && (
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
