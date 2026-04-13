import React, { useMemo } from 'react';
import './Card.css';

const STATUS_PALETTE = {
  sealed: { bg: '#fdf2f2', border: '#c9a0a0', text: '#8b4c4c', content: '#7a4040' },
  new: { bg: '#ffffff', border: '#6a9cff', text: '#1a3a6a', content: '#1a2840' },
  modified: { bg: '#fefcf6', border: '#d4b882', text: '#7a6230', content: '#6b5228' },
  failed: { bg: '#fff5f5', border: '#d48b8b', text: '#9b4545', content: '#7c3d3d' },
  local: { bg: '#f5f4f0', border: '#bbb1a2', text: '#756b5c', content: '#5f574d' },
  synced: { bg: '#f3f3f5', border: '#c0c0c8', text: '#888890', content: '#6e6e78' },
  none: { bg: '#eaeaed', border: '#b8b8c0', text: '#808088', content: '#606068' },
};

const TIER_DEFAULTS = { 1: 'new', 2: 'none', 3: 'none' };
const MAX_PREVIEW_CHARS = 600;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
}

function formatRelativeDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor(diffMs / day);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function getPalette(syncStatus, tier) {
  if (syncStatus === 'sealed') return STATUS_PALETTE.sealed;
  if (syncStatus === 'new') return STATUS_PALETTE.new;
  if (syncStatus === 'modified') return STATUS_PALETTE.modified;
  if (syncStatus === 'failed') return STATUS_PALETTE.failed;
  if (syncStatus === 'local') return STATUS_PALETTE.local;
  if (syncStatus === 'synced') return STATUS_PALETTE.synced;
  return STATUS_PALETTE[TIER_DEFAULTS[tier] || 'none'];
}

function stripMarkdown(md, maxLen = MAX_PREVIEW_CHARS) {
  if (!md) return '';
  const raw = md.length > maxLen * 2 ? md.slice(0, maxLen * 2) : md;
  const stripped = raw
    .replace(/^---[\s\S]*?---\n?/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '')
    .replace(/^\s*[-*+]\s+/gm, '- ')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/^\s*\|.*\|.*$/gm, '')
    .replace(/^\s*[-=]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return stripped.length > maxLen ? stripped.slice(0, maxLen) : stripped;
}

const STAMP_CONFIG = {
  sealed: { label: 'SENSITIVE', cls: 'stamp-sealed' },
  new: { label: 'NEW', cls: 'stamp-new' },
  modified: { label: 'EDIT', cls: 'stamp-mod' },
  failed: { label: 'FAILED', cls: 'stamp-failed' },
  local: { label: 'LOCAL', cls: 'stamp-local' },
  synced: { label: 'SYNC', cls: 'stamp-synced' },
};

const TRANSIENT_STAMP_CONFIG = {
  queued: { label: 'QUEUE', cls: 'stamp-queued' },
  syncing: { label: 'SYNCING', cls: 'stamp-syncing' },
  done: { label: 'DONE', cls: 'stamp-done' },
  failed: { label: 'FAILED', cls: 'stamp-failed' },
};

function Stamp({ status }) {
  const cfg = STAMP_CONFIG[status];
  if (!cfg) return null;
  if (status === 'sealed') {
    return <div className={`stamp-overlay ${cfg.cls}`}>{cfg.label}</div>;
  }
  return <span className={`stamp ${cfg.cls}`}>{cfg.label}</span>;
}

function TransientStamp({ status }) {
  const cfg = TRANSIENT_STAMP_CONFIG[status];
  if (!cfg) return null;
  return <span className={`stamp stamp-transient ${cfg.cls}`}>{cfg.label}</span>;
}

function formatFindingCount(finding) {
  if (!finding) return '';
  const label = finding.count === 1 ? finding.singular : finding.plural;
  return `${finding.count} ${label}`;
}

function ClusterBadge({ file }) {
  if (!file?.clusterLabel) return null;
  const sectionKey = file._clusterSectionKey || file.clusterSectionKey || 'knowledge';
  const confidence = file.clusterConfidence || 'medium';
  return (
    <span
      className={`card-cluster-badge card-cluster-badge-${sectionKey}`}
      title={`Smart cluster: ${file.clusterLabel} (${confidence})`}
    >
      {String(file.clusterLabel).toUpperCase()}
    </span>
  );
}

function WarningBadge({ file }) {
  if (!file?.hasSensitiveContent) return null;
  const warningText = file.sensitiveSummary || 'Sensitive content';
  return (
    <button
      type="button"
      className={`card-warning-toggle${file.hasHighRiskSensitiveContent ? ' card-warning-toggle-high' : ''}`}
      title="Show sensitive field summary"
    >
      <span className="card-warning-toggle__icon">{file.hasHighRiskSensitiveContent ? '!!' : '!'}</span>
      <span className="card-warning-toggle__text">{warningText}</span>
    </button>
  );
}

function WarningPanel({ file }) {
  if (!file?.hasSensitiveContent) return null;
  return (
    <div className="card-warning-panel">
      <div className="card-warning-panel__header">
        <span>{file.hasHighRiskSensitiveContent ? 'Sensitive scan: high risk' : 'Sensitive scan'}</span>
        {file.privacyAutoUpgraded && <span className="card-warning-panel__privacy">PRIVATE</span>}
      </div>
      {(file.sensitiveFindings || []).map((finding) => (
        <div key={finding.id} className="card-warning-panel__row">
          <span>{finding.label}</span>
          <span>{formatFindingCount(finding)}</span>
        </div>
      ))}
    </div>
  );
}

function PrivateBadge({ file }) {
  if (!file?.privacyAutoUpgraded) return null;
  return <span className="card-private-badge">PRIVATE</span>;
}

function JournalGroupCard({ file, selected, selectMode }) {
  const modeLabel = file._journalGroupMode === 'week' ? 'WEEK' : 'MONTH';
  const countLabel = `${file._journalGroupCount} file${file._journalGroupCount === 1 ? '' : 's'}`;
  const previewNames = Array.isArray(file._journalGroupPreviewNames) ? file._journalGroupPreviewNames : [];
  const hint = file._journalGroupExpanded
    ? `Expanded. Other ${file._journalGroupMode} groups stay folded.`
    : `Open to focus this ${file._journalGroupMode} group only.`;

  return (
    <>
      <div className="card-header">
        <span className="card-journal-mode-badge">{modeLabel}</span>
        <div className="card-name">{file._journalGroupLabel || file.fileName}</div>
        <span className="card-journal-count">{countLabel}</span>
        {selected && !selectMode && (
          <button className="card-expand-btn" title={file._journalGroupExpanded ? 'Collapse group' : 'Expand group'}>
            {file._journalGroupExpanded ? '-' : '+'}
          </button>
        )}
      </div>
      <div className="card-journal-meta">
        <span>{file._journalGroupRangeLabel}</span>
        <span>Latest {file._journalGroupLatestLabel}</span>
      </div>
      {previewNames.length > 0 && (
        <div className="card-journal-preview">
          {previewNames.map((name) => (
            <span key={name} className="card-journal-preview__item">{name}</span>
          ))}
        </div>
      )}
      <div className="card-journal-hint">{hint}</div>
    </>
  );
}

export const Card = React.memo(function Card({
  card,
  syncStatus,
  syncMeta,
  transientStatus,
  content,
  warningExpanded,
  zoom = 1,
  selected,
  dimmed,
  selectMode,
  checked,
  selectable,
  onboardingActive,
  onboardingFeatured,
  onSyncFile,
}) {
  const { file, x, y, w, h } = card;
  const tier = file._tier || 3;
  const isLog = file._isSessionLog;
  const isJournalGroup = file.isJournalGroup === true;
  const effectiveStatus = syncStatus || null;
  const pal = isLog ? STATUS_PALETTE.none : getPalette(effectiveStatus, tier);
  const lod = zoom < 0.08 ? 0 : zoom < 0.18 ? 1 : 2;
  const isProcessing = transientStatus === 'syncing' || transientStatus === 'queued';
  const isNew = effectiveStatus === 'new';

  void syncMeta;

  if (lod === 0) {
    return (
      <div
        className={`card card-lod0${isNew ? ' card-new' : ''}${isProcessing ? ' card-processing' : ''}${checked ? ' card-picked' : ''}`}
        data-card-path={file.relativePath}
        data-tour={onboardingActive && onboardingFeatured ? 'representative-card' : undefined}
        style={{
          left: x,
          top: y,
          width: w,
          height: h,
          background: pal.bg,
          borderLeft: `3px solid ${pal.border}`,
        }}
      />
    );
  }

  const displayName = file.fileName.replace(/\.md$/i, '');

  if (lod === 1) {
    return (
      <div
        className={`card${isNew ? ' card-new' : ''}${isLog ? ' card-session-log' : ''}${isJournalGroup ? ' card-journal-group' : ''}${isProcessing ? ' card-processing' : ''}${checked ? ' card-picked' : ''}`}
        data-card-path={file.relativePath}
        data-tour={onboardingActive && onboardingFeatured ? 'representative-card' : undefined}
        style={{
          left: x,
          top: y,
          width: w,
          height: h,
          background: pal.bg,
          borderLeft: `3px solid ${pal.border}`,
        }}
      >
        <div className="card-header">
          {isJournalGroup && <span className="card-journal-mode-badge">{file._journalGroupMode === 'week' ? 'WEEK' : 'MONTH'}</span>}
          {isLog && <span className="session-badge">LOG</span>}
          <div className="card-name" style={{ color: isJournalGroup ? '#3f3528' : isLog ? '#999' : pal.text }}>
            {isJournalGroup ? file._journalGroupLabel || displayName : displayName}
          </div>
          {isJournalGroup ? (
            <span className="card-journal-count">{file._journalGroupCount} file{file._journalGroupCount === 1 ? '' : 's'}</span>
          ) : (
            <>
              <ClusterBadge file={file} />
              <PrivateBadge file={file} />
              <WarningBadge file={file} />
              {transientStatus && effectiveStatus !== 'sealed' && <TransientStamp status={transientStatus} />}
              <Stamp status={effectiveStatus} />
            </>
          )}
        </div>
      </div>
    );
  }

  const preview = useMemo(() => stripMarkdown(content), [content]);
  const classNames = [
    'card',
    isNew ? 'card-new' : '',
    isLog ? 'card-session-log' : '',
    isJournalGroup ? 'card-journal-group' : '',
    effectiveStatus === 'sealed' ? 'card-sealed' : '',
    selected ? 'card-selected' : '',
    dimmed ? 'card-dimmed' : '',
    selectMode && selectable === false ? 'card-unselectable' : '',
    isProcessing ? 'card-processing' : '',
    checked ? 'card-picked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const sizeLabel = formatBytes(file.sizeBytes);
  const dateLabel = formatRelativeDate(file.modifiedTime || file.updatedAt);
  const showInfoRow = !isJournalGroup && !isLog && (sizeLabel || dateLabel);

  return (
    <div
      className={classNames}
      data-card-path={file.relativePath}
      data-tour={onboardingActive && onboardingFeatured ? 'representative-card' : undefined}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        background: pal.bg,
        borderLeft: `3px solid ${pal.border}`,
      }}
    >
      {isJournalGroup ? (
        <JournalGroupCard file={file} selected={selected} selectMode={selectMode} />
      ) : (
        <>
        <div className="card-header">
          {selectMode && (
            <span className={`card-checkbox ${checked ? 'card-checkbox-on' : ''} ${selectable === false ? 'card-checkbox-disabled' : ''}`} data-checkbox="true">
              {checked ? '[x]' : '[ ]'}
            </span>
          )}
          {isLog && <span className="session-badge">LOG</span>}
          <div className="card-title-block">
            <div className="card-name" style={{ color: isLog ? '#999' : pal.text }}>
              {displayName}
            </div>
            <div className="card-meta-row">
              <ClusterBadge file={file} />
              <PrivateBadge file={file} />
            </div>
          </div>
          <div className="card-header-actions">
            <WarningBadge file={file} />
            {transientStatus && effectiveStatus !== 'sealed' && <TransientStamp status={transientStatus} />}
            {effectiveStatus !== 'sealed' && <Stamp status={effectiveStatus} />}
            {selected && !selectMode && (effectiveStatus === 'new' || effectiveStatus === 'modified') && onSyncFile && (
              <button className="card-sync-btn" data-sync-path={file.relativePath} title="Sync this file">
                Sync
              </button>
            )}
            {selected && !selectMode && (
              <button className="card-expand-btn" title="Read full document">
                {'->'}
              </button>
            )}
          </div>
        </div>
          {warningExpanded && <WarningPanel file={file} />}
          {showInfoRow && (
            <div className="card-info-row" style={{ color: pal.content }}>
              {sizeLabel && <span className="card-info-chip">{sizeLabel}</span>}
              {dateLabel && <span className="card-info-chip">{dateLabel}</span>}
              {isProcessing && <span className="card-info-chip card-info-chip-processing">processing</span>}
            </div>
          )}
          {preview && !isLog && (
            <div className="card-content" style={{ color: pal.content }}>
              {preview}
            </div>
          )}
          {isLog && preview && <div className="card-content card-content-log">{preview}</div>}
        </>
      )}
      {effectiveStatus === 'sealed' && <Stamp status="sealed" />}
    </div>
  );
});
