import React from 'react';
import './Header.css';

export function Header({
  searchQuery,
  onSearchChange,
  isConnected,
  authLabel,
  lastSyncLabel,
  readyCount,
  syncing,
  canSync,
  onSyncNow,
  onOpenSettings,
}) {
  const primaryLabel = syncing
    ? 'Syncing…'
    : readyCount > 0
      ? `Sync ${readyCount} file${readyCount === 1 ? '' : 's'} to Echo`
      : 'Sync now';

  return (
    <header className="hdr">
      <a href="#" className="logo" onClick={(e) => e.preventDefault()}>
        <div className="logo-mark" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="3.5" stroke="white" strokeWidth="1.2"/>
            <circle cx="6" cy="6" r="1.4" fill="white"/>
          </svg>
        </div>
        Echo Memory
      </a>

      <div className="search-wrap">
        <svg className="search-ico" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="5.8" cy="5.8" r="4.2" stroke="#B5B0A8" strokeWidth="1.3"/>
          <path d="M9 9L12 12" stroke="#B5B0A8" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        <input
          type="text"
          value={searchQuery || ''}
          placeholder="Search files and content…"
          onChange={(e) => onSearchChange?.(e.target.value)}
          aria-label="Search files and content"
        />
      </div>

      <div className="hdr-gap" />

      <div className="hdr-r">
        <div className={`conn ${isConnected ? 'conn--ok' : 'conn--off'}`}>
          <div className="conn-dot" />
          {authLabel || (isConnected ? 'Connected' : 'Local-only')}
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Last sync time"
          title={lastSyncLabel}
        >
          {lastSyncLabel}
        </button>

        <button
          type="button"
          className="btn-icon"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="1.4"/>
          </svg>
        </button>

        <button
          type="button"
          className="btn btn-dark hdr-sync"
          onClick={onSyncNow}
          disabled={!canSync || syncing}
          title={!canSync ? 'Connect to Echo to sync' : primaryLabel}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M10 6A4 4 0 1 1 6 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <path d="M6 .5L8.5 2.5L6 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
          {primaryLabel}
        </button>
      </div>
    </header>
  );
}
