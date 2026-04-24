/**
 * sessionStorage-backed cache for the cloud memory log.
 *
 * Scoped per userId so a key cached for account A can never be read by
 * account B — mirrors the extension's encryption-key storage model. The
 * cache is a UX accelerator, not a source of truth: the App layer always
 * re-fetches from the backend, the cached value just paints the first
 * frame while the request is in flight.
 *
 * No TTL. Freshness is driven by explicit invalidation events (sync
 * complete, user-triggered refresh, future realtime push) — this avoids
 * the "stale cache judged fresh" class of bugs.
 */

const PREFIX = 'echomem_cloud_cache';

function scopedKey(userId, kind) {
  return `${PREFIX}:${userId || '_anon'}:${kind}`;
}

export function readCache(userId) {
  try {
    const mem = sessionStorage.getItem(scopedKey(userId, 'memories'));
    const src = sessionStorage.getItem(scopedKey(userId, 'sources'));
    const stats = sessionStorage.getItem(scopedKey(userId, 'stats'));
    if (mem == null && src == null && stats == null) return null;
    return {
      memories: mem ? JSON.parse(mem) : [],
      sources: src ? JSON.parse(src) : [],
      stats: stats ? JSON.parse(stats) : { totalCount: 0, countWithSource: 0 },
    };
  } catch {
    return null;
  }
}

export function writeCache(userId, payload) {
  try {
    sessionStorage.setItem(
      scopedKey(userId, 'memories'),
      JSON.stringify(payload?.memories || []),
    );
    sessionStorage.setItem(
      scopedKey(userId, 'sources'),
      JSON.stringify(payload?.sources || []),
    );
    sessionStorage.setItem(
      scopedKey(userId, 'stats'),
      JSON.stringify(payload?.stats || { totalCount: 0, countWithSource: 0 }),
    );
  } catch {
    // Quota exceeded, private mode, etc — next read will just miss and
    // the UI will fall back to its loading state.
  }
}

export function clearCache(userId) {
  try {
    sessionStorage.removeItem(scopedKey(userId, 'memories'));
    sessionStorage.removeItem(scopedKey(userId, 'sources'));
    sessionStorage.removeItem(scopedKey(userId, 'stats'));
  } catch {
    // Ignore.
  }
}
