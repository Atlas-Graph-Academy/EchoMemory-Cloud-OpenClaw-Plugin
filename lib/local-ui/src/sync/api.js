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

export async function fetchSetupStatus() {
  try {
    const res = await fetch('/api/setup-status');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function saveSetupConfig(payload) {
  const res = await fetch('/api/setup-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Setup save failed: HTTP ${res.status}`);
  }
  return data;
}

export async function triggerSync() {
  const res = await fetch('/api/sync', { method: 'POST' });
  if (!res.ok) throw new Error(`Sync failed: HTTP ${res.status}`);
  return await res.json();
}

export async function fetchBackendSources() {
  try {
    const res = await fetch('/api/backend-sources');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function triggerSyncSelected(paths) {
  const res = await fetch('/api/sync-selected', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) throw new Error(`Sync failed: HTTP ${res.status}`);
  return await res.json();
}

/**
 * Fetch content of a single markdown file.
 * Returns { fileName, content } or null on error.
 */
export async function fetchFileContent(relativePath) {
  try {
    const res = await fetch(`/api/file?path=${encodeURIComponent(relativePath)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch content for all files in parallel (fully concurrent).
 * Returns a Map<relativePath, content>.
 * All requests are local (127.0.0.1) so concurrency is safe.
 */
export async function fetchAllContents(files) {
  const map = new Map();
  const results = await Promise.all(
    files.map(f => fetchFileContent(f.relativePath).then(r => ({ path: f.relativePath, r })))
  );
  for (const { path, r } of results) {
    if (r && r.content != null) {
      map.set(path, r.content);
    }
  }
  return map;
}

/**
 * Connect to SSE for live file-change events.
 * Returns a cleanup function.
 */
export function connectSSE({ onFilesChanged, onSyncProgress } = {}) {
  const es = new EventSource('/api/events');
  es.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (data.type === 'files-changed' && onFilesChanged) {
        onFilesChanged(data);
      }
      if (data.type === 'sync-progress' && onSyncProgress) {
        onSyncProgress(data.progress || null);
      }
    } catch { /* ignore parse errors */ }
  };
  es.onerror = () => {
    // EventSource auto-reconnects
  };
  return () => es.close();
}
