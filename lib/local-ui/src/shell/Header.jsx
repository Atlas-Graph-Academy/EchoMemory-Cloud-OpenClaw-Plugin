import React from 'react';
import './Header.css';

export function Header({
  searchQuery,
  onSearchChange,
  isConnected,
  authLabel,
  lastSyncLabel,
  cloudMemoryOpen,
  cloudMemoryCount,
  newMemoryCount,
  canvasControls,
  onCloudMemoryClick,
  onOpenSettings,
  onOpenArchive,
}) {
  const actions = canvasControls?.actions || {};
  const memoryCount = Number.isFinite(Number(cloudMemoryCount)) ? Number(cloudMemoryCount) : 0;
  const freshCount = Number.isFinite(Number(newMemoryCount)) ? Number(newMemoryCount) : 0;
  const memoryLabel = isConnected
    ? `${memoryCount.toLocaleString()} ${memoryCount === 1 ? 'memory' : 'memories'}`
    : null;

  return (
    <header className="hdr">
      <a
        href="#"
        className="logo"
        onClick={(e) => e.preventDefault()}
      >
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

      {canvasControls && (
        <div className="hdr-canvas" aria-label="Canvas navigation">
          <button
            type="button"
            className={`hdr-canvas__btn hdr-canvas__btn--directory ${canvasControls.treeOpen ? 'is-active' : ''}`}
            onClick={actions.toggleTree}
            title="Toggle directory"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 2.7h3.1l1 1.1H12a.6.6 0 0 1 .6.6v6.9a.6.6 0 0 1-.6.6H2a.6.6 0 0 1-.6-.6v-8a.6.6 0 0 1 .6-.6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              <path d="M3.2 6h7.6M3.2 8.2h5.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity=".58" />
            </svg>
            <span>Directory</span>
          </button>
          <button
            type="button"
            className={`hdr-canvas__btn ${canvasControls.syncOpen ? 'is-active' : ''}`}
            onClick={actions.toggleSync}
            title="Toggle sync panel"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{canvasControls.syncing ? 'Syncing' : 'Sync'}</span>
          </button>
        </div>
      )}

      <div className="hdr-r">
        <button
          type="button"
          className={`conn ${isConnected ? 'conn--ok' : 'conn--off'} ${cloudMemoryOpen ? 'is-active' : ''}`}
          onClick={onCloudMemoryClick}
          title={isConnected ? 'Open cloud memories' : 'Connect to Echo Cloud'}
          aria-label={isConnected ? `Echo Cloud connected, ${memoryLabel}` : 'Connect to Echo Cloud'}
        >
          <div className="conn-dot" />
          <span>{authLabel || (isConnected ? 'Connected' : 'Local-only')}</span>
          {memoryLabel && <span className="conn-meta">{memoryLabel}</span>}
          {freshCount > 0 && <span className="conn-badge">+{freshCount}</span>}
        </button>

        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Last sync time"
          title={lastSyncLabel}
        >
          {lastSyncLabel}
        </button>

        {typeof onOpenArchive === 'function' && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onOpenArchive('all')}
            aria-label="Browse all files"
            title="Browse all files"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            Archive
          </button>
        )}

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
      </div>
    </header>
  );
}
