import React from 'react';
import './StatusBar.css';

export function StatusBar({
  totalFiles,
  syncedCount,
  sensitiveCount,
  systemCount,
  isConnected,
  version,
}) {
  return (
    <div className="statusbar" role="status" aria-live="polite">
      <div className="statusbar-story">
        <span className="statusbar-kicker">Transparent local memory</span>
        <span className="statusbar-line">
          Review what stays private. Choose what travels. Let your agents know you through memory.
        </span>
      </div>
      <div className="statusbar-metrics">
        <div className="stat"><strong>{totalFiles ?? 0}</strong> files</div>
        <div className="stat-sep" />
        <div className="stat"><strong>{syncedCount ?? 0}</strong> synced</div>
        <div className="stat-sep" />
        <div className="stat"><strong>{sensitiveCount ?? 0}</strong> private</div>
        {systemCount > 0 && (
          <>
            <div className="stat-sep" />
            <div className="stat"><strong>{systemCount}</strong> sealed</div>
          </>
        )}
      </div>
      <div className="stat-right">
        <div className="local-dot" />
        {isConnected ? 'Connected, still local-first' : 'Local-only, no data leaves this machine'}
        {version && <span className="stat-version">· v{version}</span>}
      </div>
    </div>
  );
}
