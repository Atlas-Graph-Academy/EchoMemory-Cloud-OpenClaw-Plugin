import React, { useEffect, useMemo, useRef, useState } from 'react';
import './HomeView.css';
import { HomeCard } from './HomeCard';
import { CardPile } from './CardPile';

const MAX_PER_SECTION = 4;

function classifyForHome(file, syncStatus) {
  if (file?.riskLevel === 'secret') return 'private';
  if (file?.riskLevel === 'private' || file?.privacyLevel === 'private') return 'private';
  if (syncStatus === 'sealed') return 'private';
  if (syncStatus === 'synced') return 'synced';
  return 'ready';
}

function bucketFiles(files, syncMap, searchQuery) {
  const q = (searchQuery || '').trim().toLowerCase();
  const buckets = { private: [], ready: [], synced: [] };
  for (const file of files || []) {
    if (!file?.relativePath) continue;
    if (q) {
      const name = (file.fileName || '').toLowerCase();
      const rel = (file.relativePath || '').toLowerCase();
      if (!name.includes(q) && !rel.includes(q)) continue;
    }
    const syncStatus = syncMap?.[file.relativePath] || null;
    const key = classifyForHome(file, syncStatus);
    buckets[key].push({ file, syncStatus });
  }
  // Sort: private first by risk severity, then ready/synced by recency
  buckets.private.sort((a, b) => {
    const aSecret = a.file.riskLevel === 'secret' ? 0 : 1;
    const bSecret = b.file.riskLevel === 'secret' ? 0 : 1;
    if (aSecret !== bSecret) return aSecret - bSecret;
    return dateDesc(a.file, b.file);
  });
  buckets.ready.sort((a, b) => dateDesc(a.file, b.file));
  buckets.synced.sort((a, b) => dateDesc(a.file, b.file));
  return buckets;
}

function dateDesc(a, b) {
  const at = new Date(a.modifiedTime || a.updatedAt || 0).getTime();
  const bt = new Date(b.modifiedTime || b.updatedAt || 0).getTime();
  return bt - at;
}

export function HomeView({
  files,
  syncMap,
  contentMap,
  searchQuery,
  cardSyncState,
  syncing,
  onOpenCard,
  onOpenArchive,
  onSyncReady,
  canSync,
  syncedExpandedRef,
  justSynced,
}) {
  const buckets = useMemo(() => bucketFiles(files, syncMap, searchQuery), [files, syncMap, searchQuery]);

  const [syncedOpen, setSyncedOpen] = useState(false);
  const syncedSectionRef = useRef(null);

  // Expose a setter so App can auto-open after a sync
  useEffect(() => {
    if (!syncedExpandedRef) return;
    syncedExpandedRef.current = {
      open: () => setSyncedOpen(true),
      scrollIntoView: () => {
        syncedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    };
  }, [syncedExpandedRef]);

  // When justSynced flips true, open and scroll
  useEffect(() => {
    if (justSynced) {
      setSyncedOpen(true);
      // small defer so the DOM has expanded before we scroll
      const id = window.setTimeout(() => {
        syncedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      return () => window.clearTimeout(id);
    }
  }, [justSynced]);

  const privList = buckets.private;
  const readyList = buckets.ready;
  const syncedList = buckets.synced;

  const readyCount = readyList.length;
  const privateCount = privList.length;
  const syncedCount = syncedList.length;

  const isEmpty = privateCount === 0 && readyCount === 0 && syncedCount === 0;

  if (isEmpty) {
    return (
      <main className="home-main">
        <div className="home-empty">
          <div className="home-empty__icon" aria-hidden="true">✦</div>
          <h2 className="home-empty__title">No memories yet</h2>
          <p className="home-empty__sub">
            Drop markdown files into your memory directory and Echo will surface them here, classified by privacy risk.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="home-main">
      {/* ─── Keep Private ─── */}
      {privateCount > 0 && (
        <section className="home-section">
          <div className="home-sec-top">
            <div>
              <h2 className="home-sec-title">
                <span className="home-sec-icon" aria-hidden="true">🔒</span>
                Keep Private
                <span className="count-pill">{privateCount}</span>
              </h2>
              <p className="home-sec-desc">
                Sensitive data or private paths detected. These files never leave your machine.
              </p>
            </div>
          </div>
          <div className="home-cards-row">
            {privList.slice(0, MAX_PER_SECTION).map(({ file, syncStatus }) => (
              <CardPile key={file.relativePath} onClick={() => onOpenCard?.(file.relativePath)}>
                <HomeCard
                  file={file}
                  syncStatus={syncStatus}
                  variant="private"
                  content={contentMap?.get?.(file.relativePath)}
                  cardSyncState={cardSyncState?.[file.relativePath]}
                />
              </CardPile>
            ))}
            {privateCount > MAX_PER_SECTION && (
              <MorePill
                count={privateCount - MAX_PER_SECTION}
                onClick={() => onOpenArchive?.('private')}
              />
            )}
          </div>
        </section>
      )}

      {/* ─── Ready to Sync ─── */}
      {readyCount > 0 && (
        <section className="home-section">
          <div className="home-sec-top">
            <div>
              <h2 className="home-sec-title">
                <span className="home-sec-icon" aria-hidden="true">✦</span>
                Ready to Sync
                <span className="count-pill">{readyCount}</span>
              </h2>
              <p className="home-sec-desc">
                Reviewed and safe to share. Upload them all with one click.
              </p>
            </div>
            {canSync && (
              <button
                type="button"
                className="sync-cta"
                onClick={onSyncReady}
                disabled={syncing}
              >
                {syncing
                  ? 'Syncing…'
                  : `Sync ${readyCount} file${readyCount === 1 ? '' : 's'} to Echo`}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
          <div className="home-cards-row">
            {readyList.slice(0, MAX_PER_SECTION).map(({ file, syncStatus }) => (
              <HomeCard
                key={file.relativePath}
                file={file}
                syncStatus={syncStatus}
                variant="ready"
                content={contentMap?.get?.(file.relativePath)}
                cardSyncState={cardSyncState?.[file.relativePath]}
                onClick={() => onOpenCard?.(file.relativePath)}
              />
            ))}
            {readyCount > MAX_PER_SECTION && (
              <MorePill
                count={readyCount - MAX_PER_SECTION}
                onClick={() => onOpenArchive?.('ready')}
              />
            )}
          </div>
        </section>
      )}

      {/* ─── Already Synced ─── */}
      {syncedCount > 0 && (
        <section className="home-section" ref={syncedSectionRef}>
          <div className="home-sec-top">
            <div>
              <h2 className="home-sec-title">
                <span className="home-sec-icon" aria-hidden="true">✓</span>
                Already Synced
                <span className="count-pill">{syncedCount}</span>
              </h2>
              <p className="home-sec-desc">
                Living in Echo Cloud — accessible from every connected surface.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="sync-bar"
            onClick={() => setSyncedOpen((v) => !v)}
            aria-expanded={syncedOpen}
          >
            <span className="sync-circle" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3.5 8.5L7 12L12.5 5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
            <span className="sync-bar__info">
              <span className="sync-bar__title">
                {syncedCount} file{syncedCount === 1 ? '' : 's'} in Echo Cloud
              </span>
              <span className="sync-bar__sub">
                Retrievable from every tool connected to your Echo account
              </span>
            </span>
            <span className="sync-bar__toggle">
              {syncedOpen ? 'Hide ↑' : 'Show files ↓'}
            </span>
          </button>
          {syncedOpen && (
            <div className="home-cards-row home-cards-row--expanded">
              {syncedList.slice(0, MAX_PER_SECTION).map(({ file, syncStatus }) => (
                <HomeCard
                  key={file.relativePath}
                  file={file}
                  syncStatus={syncStatus}
                  variant="synced"
                  content={contentMap?.get?.(file.relativePath)}
                  cardSyncState={cardSyncState?.[file.relativePath]}
                  onClick={() => onOpenCard?.(file.relativePath)}
                />
              ))}
              {syncedCount > MAX_PER_SECTION && (
                <MorePill
                  count={syncedCount - MAX_PER_SECTION}
                  onClick={() => onOpenArchive?.('synced')}
                />
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function MorePill({ count, onClick }) {
  return (
    <button type="button" className="more-pill" onClick={onClick}>
      <span className="more-pill__n">+{count}</span>
      <span className="more-pill__lbl">more</span>
    </button>
  );
}
