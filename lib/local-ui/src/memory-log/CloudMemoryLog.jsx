import { useCallback, useMemo, useState } from 'react';
import { MemoryList, looksEncrypted } from '@echomem/memory_log_ui';

const TIMELINE_HREF = 'https://www.iditor.com';
const DISMISS_STORAGE_KEY = 'echomem_newmemories_dismissed_at';

/**
 * Plugin can't decrypt — it has no passphrase or PBKDF2 salt. Before handing
 * a memory to the shared MemoryList, swap the card title when it's
 * ciphertext so the card shows "🔒 Encrypted memory" instead of a base64
 * blob. description / details are left as-is so MemoryDetailModal's own
 * looksEncrypted() detection triggers the "encrypted — view on iditor.com"
 * hint.
 */
function maskEncryptedFields(memory) {
  const rawTitle = memory.keys ?? memory.key ?? '';
  if (!looksEncrypted(rawTitle)) return memory;
  return {
    ...memory,
    keys: '🔒 Encrypted memory',
    key: '🔒 Encrypted memory',
  };
}

function readDismissedAt() {
  try {
    const stored = Number(localStorage.getItem(DISMISS_STORAGE_KEY) || 0);
    return Number.isFinite(stored) ? stored : 0;
  } catch {
    return 0;
  }
}

/**
 * Pure presentational wrapper — all data comes from App.jsx. Mounts/unmounts
 * when the panel toggles don't re-fetch, which is what lets the SWR cache
 * in App.jsx actually work.
 */
export function CloudMemoryLog({
  isAuthenticated,
  memories,
  sources,
  loading,
  error,
  totalCount,
  countWithSource,
  onRefresh,
  onClose,
}) {
  const [newMemoriesDismissedAt, setNewMemoriesDismissedAt] = useState(readDismissedAt);

  const handleDismissNewMemories = useCallback(() => {
    const now = Date.now();
    setNewMemoriesDismissedAt(now);
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, String(now));
    } catch {
      // Ignore storage failures (private mode, quota, etc).
    }
  }, []);

  const maskedMemories = useMemo(
    () => (memories || []).map(maskEncryptedFields),
    [memories],
  );

  return (
    <MemoryList
      memories={maskedMemories}
      sources={sources || []}
      isAuthenticated={isAuthenticated}
      loading={loading}
      hasMore={false}
      totalCount={totalCount}
      countWithSource={countWithSource}
      onRefresh={onRefresh}
      onLoadMore={() => {}}
      timelineHref={TIMELINE_HREF}
      newMemoriesDismissedAt={newMemoriesDismissedAt}
      onDismissNewMemories={handleDismissNewMemories}
      encryptedHomepageHref={TIMELINE_HREF}
      errorMessage={error}
      onClose={onClose}
    />
  );
}
