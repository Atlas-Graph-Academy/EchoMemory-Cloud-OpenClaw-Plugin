import { useCallback, useEffect, useState } from 'react';
import { MemoryList, looksEncrypted } from '@echomem/memory_log_ui';
import { fetchCloudMemories, fetchCloudSources } from '../sync/api';

const TIMELINE_HREF = 'https://www.iditor.com';
const DISMISS_STORAGE_KEY = 'echomem_newmemories_dismissed_at';

/**
 * Plugin can't decrypt — it has no passphrase or PBKDF2 salt. Before handing a
 * memory to the shared MemoryList, swap any ciphertext fields for a plain
 * placeholder so the card shows "🔒 Encrypted memory" instead of a base64 blob.
 * MemoryDetailModal will still render an "encrypted — open in extension" hint
 * because no `onRequestDecrypt` callback is provided.
 */
function maskEncryptedFields(memory) {
  // Only replace the card title when it's ciphertext — leave description and
  // details as-is so MemoryDetailModal's own looksEncrypted() detection
  // triggers and shows the "encrypted — view on iditor.com" hint instead of
  // falling back to "No description".
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

export function CloudMemoryLog({ isConnected, onStatsChange }) {
  const [memories, setMemories] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [totalCount, setTotalCount] = useState(0);
  const [countWithSource, setCountWithSource] = useState(0);
  const [newMemoriesDismissedAt, setNewMemoriesDismissedAt] = useState(readDismissedAt);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [memResult, srcResult] = await Promise.all([
        fetchCloudMemories(),
        fetchCloudSources(),
      ]);
      const data = Array.isArray(memResult?.data) ? memResult.data : [];
      const nextTotalCount = Number(memResult?.count) || data.length;
      const nextCountWithSource = Number(memResult?.countWithSource) || 0;
      setMemories(data.map(maskEncryptedFields));
      setTotalCount(nextTotalCount);
      setCountWithSource(nextCountWithSource);
      onStatsChange?.({
        totalCount: nextTotalCount,
        countWithSource: nextCountWithSource,
      });

      const list = Array.isArray(srcResult?.data) ? srcResult.data : [];
      setSources(list);
    } catch (err) {
      setError(err?.message || 'Failed to load memories');
    } finally {
      setLoading(false);
    }
  }, [onStatsChange]);

  useEffect(() => {
    if (!isConnected) {
      setMemories([]);
      setSources([]);
      setTotalCount(0);
      setCountWithSource(0);
      onStatsChange?.({ totalCount: 0, countWithSource: 0 });
      setError(null);
      setLoading(false);
      return;
    }
    loadAll();
  }, [isConnected, loadAll]);

  const handleDismissNewMemories = useCallback(() => {
    const now = Date.now();
    setNewMemoriesDismissedAt(now);
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, String(now));
    } catch {
      // Ignore storage failures (private mode, quota, etc).
    }
  }, []);

  return (
    <MemoryList
      memories={memories}
      sources={sources}
      isAuthenticated={isConnected}
      loading={loading}
      hasMore={false}
      totalCount={totalCount}
      countWithSource={countWithSource}
      onRefresh={loadAll}
      onLoadMore={() => {}}
      timelineHref={TIMELINE_HREF}
      newMemoriesDismissedAt={newMemoriesDismissedAt}
      onDismissNewMemories={handleDismissNewMemories}
      encryptedHomepageHref={TIMELINE_HREF}
      errorMessage={error}
    />
  );
}
