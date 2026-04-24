/**
 * API client — thin wrapper around the local server endpoints.
 */

const ECHOMEM_BASE_URL = 'https://echo-mem-chrome.vercel.app';

async function parseJsonOrNull(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestCloudJson(path, { apiKey, method = 'GET', body } = {}) {
  if (!apiKey) {
    throw new Error('Cloud sidebar requires a saved Echo API key');
  }

  const res = await fetch(`${ECHOMEM_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await parseJsonOrNull(res);
  if (!res.ok) {
    throw new Error(data?.details || data?.error || `Cloud fetch failed: HTTP ${res.status}`);
  }
  return data;
}

export async function fetchFiles() {
  const res = await fetch('/api/files');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.files || [];
}

export async function fetchCanvasLayout() {
  try {
    const res = await fetch('/api/canvas-layout');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function saveCanvasLayout(layout) {
  const res = await fetch('/api/canvas-layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.details || data?.error || `Canvas layout save failed: HTTP ${res.status}`);
  }
  return data;
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

export async function fetchPluginUpdateStatus() {
  const res = await fetch('/api/plugin-update-status');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Plugin update status failed: HTTP ${res.status}`);
  }
  return data;
}

export async function triggerPluginUpdate({ restartGateway = false } = {}) {
  const res = await fetch('/api/plugin-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ restartGateway }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Plugin update failed: HTTP ${res.status}`);
  }
  return data;
}

export async function triggerGatewayRestart() {
  const res = await fetch('/api/plugin-restart-gateway', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Gateway restart failed: HTTP ${res.status}`);
  }
  return data;
}

export async function reportUiPresence(payload = {}) {
  try {
    await fetch('/api/ui-presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Ignore heartbeat failures while the gateway is restarting.
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

export async function sendAuthOtp(email) {
  const res = await fetch('/api/auth/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Failed to send code: HTTP ${res.status}`);
  }
  return data;
}

export async function verifyAuthOtp(email, otp) {
  const res = await fetch('/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Verification failed: HTTP ${res.status}`);
  }
  return data;
}

export async function triggerSync() {
  const res = await fetch('/api/sync', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.details || data?.error || `Sync failed: HTTP ${res.status}`);
  return data;
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

export async function fetchCloudMemories({ apiKey, localApiAvailable = true } = {}) {
  if (!localApiAvailable) {
    try {
      return await requestCloudJson('/api/extension/memories?limit=250&offset=0', { apiKey });
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch('/api/cloud-memories');
    if (res.status === 404) {
      return await requestCloudJson('/api/extension/memories?limit=250&offset=0', { apiKey });
    }
    if (!res.ok) return null;
    return await res.json();
  } catch {
    try {
      return await requestCloudJson('/api/extension/memories?limit=250&offset=0', { apiKey });
    } catch {
      return null;
    }
  }
}

export async function fetchCloudSources({ apiKey, localApiAvailable = true } = {}) {
  if (!localApiAvailable) {
    try {
      return await requestCloudJson('/api/extension/sources?limit=250&offset=0', { apiKey });
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch('/api/cloud-sources');
    if (res.status === 404) {
      return await requestCloudJson('/api/extension/sources?limit=250&offset=0', { apiKey });
    }
    if (!res.ok) return null;
    return await res.json();
  } catch {
    try {
      return await requestCloudJson('/api/extension/sources?limit=250&offset=0', { apiKey });
    } catch {
      return null;
    }
  }
}

export async function updateCloudMemory(id, updates, { apiKey } = {}) {
  return requestCloudJson(`/api/extension/memories/${encodeURIComponent(id)}`, {
    apiKey,
    method: 'PATCH',
    body: updates,
  });
}

export async function deleteCloudMemory(id, { apiKey } = {}) {
  return requestCloudJson(`/api/extension/memories/${encodeURIComponent(id)}`, {
    apiKey,
    method: 'DELETE',
  });
}

export async function updateCloudSource(id, updates, { apiKey } = {}) {
  return requestCloudJson(`/api/extension/sources/${encodeURIComponent(id)}`, {
    apiKey,
    method: 'PATCH',
    body: updates,
  });
}

export async function deleteCloudSource(id, { apiKey } = {}) {
  return requestCloudJson(`/api/extension/sources/${encodeURIComponent(id)}`, {
    apiKey,
    method: 'DELETE',
  });
}

export async function triggerReextractSelected(paths) {
  const res = await fetch('/api/reextract-selected', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.details || data?.error || `Re-extract failed: HTTP ${res.status}`);
  return data;
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

export async function saveFileContent(relativePath, content) {
  const res = await fetch('/api/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: relativePath,
      content,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.details || data?.error || `Save failed: HTTP ${res.status}`);
  }
  return data;
}

/**
 * Fetch content for all files in parallel (fully concurrent).
 * Returns a Map<relativePath, content>.
 * All requests are local (127.0.0.1) so concurrency is safe.
 */
export async function fetchAllContents(files) {
  const map = new Map();
  const results = await Promise.all(
    files
      .map((f) => fetchFileContent(f.relativePath).then((r) => ({ path: f.relativePath, r })))
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
export function connectSSE({ onFilesChanged, onSyncProgress, onServerConnected } = {}) {
  const es = new EventSource('/api/events');
  es.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (data.type === 'server-connected' && onServerConnected) {
        onServerConnected(data);
      }
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
