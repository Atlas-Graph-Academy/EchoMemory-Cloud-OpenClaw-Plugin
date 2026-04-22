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
      <div className="stat"><strong>{totalFiles ?? 0}</strong> files</div>
      <div className="stat-sep" />
      <div className="stat"><strong>{syncedCount ?? 0}</strong> synced</div>
      <div className="stat-sep" />
      <div className="stat"><strong>{sensitiveCount ?? 0}</strong> sensitive</div>
      {systemCount > 0 && (
        <>
          <div className="stat-sep" />
          <div className="stat"><strong>{systemCount}</strong> system</div>
        </>
      )}
      <div className="stat-right">
        <div className="local-dot" />
        {isConnected ? 'All data stays local until you sync' : 'Local-only — no data leaves this machine'}
        {version && <span className="stat-version">· v{version}</span>}
      </div>
    </div>
  );
}
