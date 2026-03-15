/**
 * API client — thin wrapper around the local server endpoints.
 */

export async function fetchFiles() {
  const res = await fetch('/api/files');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.files || [];
}

export async function fetchAuthStatus() {
  try {
    const res = await fetch('/api/auth-status');
    if (!res.ok) return { connected: false, reason: 'http_error' };
    return await res.json();
  } catch {
    return { connected: false, reason: 'network_error' };
  }
}

export async function fetchSyncStatus() {
  try {
    const res = await fetch('/api/sync-status');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function triggerSync() {
  const res = await fetch('/api/sync', { method: 'POST' });
  if (!res.ok) throw new Error(`Sync failed: HTTP ${res.status}`);
  return await res.json();
}

/**
 * Connect to SSE for live file-change events.
 * Returns a cleanup function.
 */
export function connectSSE(onFilesChanged) {
  const es = new EventSource('/api/events');
  es.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (data.type === 'files-changed') {
        onFilesChanged(data);
      }
    } catch { /* ignore parse errors */ }
  };
  es.onerror = () => {
    // EventSource auto-reconnects
  };
  return () => es.close();
}
