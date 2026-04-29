/**
 * In-memory cache for the user's derived encryption key.
 *
 * Lives only for the lifetime of the gateway process — gateway restart drops
 * the key, just like ssh-agent. Bound to a userId so an account switch
 * automatically invalidates a stale key.
 *
 * The cached value is a base64-encoded raw AES-256 key (44 chars). It is
 * the same wire format used by the X-Encryption-Key header upstream.
 */

let cached = null; // { userId, keyBase64, unlockedAt }

export function setKey(userId, keyBase64) {
  if (!userId || !keyBase64) {
    throw new Error("encryption-cache.setKey: userId and keyBase64 are required");
  }
  cached = { userId, keyBase64, unlockedAt: Date.now() };
}

/** Returns the cached key if it belongs to `userId`, else null. */
export function getKey(userId) {
  if (!cached || !userId || cached.userId !== userId) return null;
  return cached.keyBase64;
}

export function isUnlocked(userId) {
  return getKey(userId) !== null;
}

export function clear() {
  cached = null;
}

/** Snapshot for /api/encryption-state — never returns the key itself. */
export function describe(userId) {
  if (!cached) return { unlocked: false, unlockedAt: null };
  if (userId && cached.userId !== userId) {
    return { unlocked: false, unlockedAt: null, mismatchedUser: true };
  }
  return { unlocked: true, unlockedAt: cached.unlockedAt };
}
