/**
 * ReadingPanel - full-page markdown reading mode.
 * Replaces the canvas viewport entirely.
 * Shows rendered markdown with proper typography and local edit controls.
 */

import React, { useEffect, useMemo, useState } from 'react';
import './ReadingPanel.css';

/**
 * Lightweight markdown -> HTML converter.
 * Handles: headings, bold, italic, code blocks, inline code,
 * lists, links, blockquotes, horizontal rules.
 */
function renderMarkdown(md) {
  if (!md) return '';

  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    return `<pre class="rp-code-block"><code>${code.trim()}</code></pre>`;
  });

  const lines = html.split('\n');
  const result = [];
  let inList = false;
  let listType = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      if (inList) {
        result.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
      }
      const level = hMatch[1].length;
      result.push(`<h${level} class="rp-h${level}">${inlineFormat(hMatch[2])}</h${level}>`);
      continue;
    }

    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      if (inList) {
        result.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
      }
      result.push('<hr class="rp-hr" />');
      continue;
    }

    if (/^\s*&gt;\s?(.*)$/.test(line)) {
      if (inList) {
        result.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
      }
      const text = line.replace(/^\s*&gt;\s?/, '');
      result.push(`<blockquote class="rp-quote">${inlineFormat(text)}</blockquote>`);
      continue;
    }

    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>');
        result.push('<ul class="rp-list">');
        inList = true;
        listType = 'ul';
      }
      result.push(`<li>${inlineFormat(ulMatch[2])}</li>`);
      continue;
    }

    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>');
        result.push('<ol class="rp-list">');
        inList = true;
        listType = 'ol';
      }
      result.push(`<li>${inlineFormat(olMatch[2])}</li>`);
      continue;
    }

    if (inList && line.trim() === '') {
      result.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
    }

    if (line.trim() === '') {
      result.push('<div class="rp-spacer"></div>');
      continue;
    }

    result.push(`<p class="rp-p">${inlineFormat(line)}</p>`);
  }

  if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>');

  return result.join('\n');
}

function inlineFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code class="rp-inline-code">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function formatFindingCount(finding) {
  if (!finding) return '';
  const label = finding.count === 1 ? finding.singular : finding.plural;
  return `${finding.count} ${label}`;
}

function formatFileTimestamp(file) {
  const candidates = [
    ['Modified', file?.modifiedTime || file?.updatedAt],
    ['Created', file?.createdTime],
  ];
  const found = candidates.find(([, value]) => {
    const time = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(time);
  });
  if (!found) return 'Timestamp unavailable';

  const [label, value] = found;
  const date = new Date(value);
  const formatted = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return `${label} ${formatted}`;
}

function displayFileName(file, fallbackPath = '') {
  return (file?.fileName || fallbackPath.split('/').pop() || 'Untitled').replace(/\.md$/i, '');
}

function compactPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts.slice(-3).join('/');
}

function WarningNotice({ file }) {
  if (!file?.hasSensitiveContent && file?.privacyLevel !== 'private') {
    return null;
  }

  return (
    <div className="rp-warning">
      <div className="rp-warning__title">
        {file?.hasSensitiveContent
          ? file?.hasHighRiskSensitiveContent
            ? 'Sensitive content warning'
            : 'Sensitive field warning'
          : 'Private file warning'}
      </div>
      <p className="rp-warning__copy">
        This local viewer is reading your markdown file directly from disk. Sensitive content is flagged here as a warning only and is still shown below.
      </p>
      {file?.privacyAutoUpgraded && (
        <div className="rp-warning__privacy">Privacy auto-upgraded this file to private for cloud-sync decisions.</div>
      )}
      {(file?.sensitiveFindings || []).map((finding) => (
        <div key={finding.id} className="rp-warning__row">
          <span>{finding.label}</span>
          <span>{formatFindingCount(finding)}</span>
        </div>
      ))}
    </div>
  );
}

export function ReadingPanel({
  path,
  content,
  file,
  syncStatus,
  galleryFiles = [],
  galleryTitle = '',
  onGalleryTitleChange,
  onNavigateFile,
  isConnected,
  syncing,
  onSyncFile,
  onClose,
  onSave,
  onboardingActive = false,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const displayName = displayFileName(file, path);
  const timestampLabel = formatFileTimestamp(file);
  const normalizedGallery = useMemo(() => {
    const seen = new Set();
    const items = [];
    for (const item of galleryFiles || []) {
      if (!item?.relativePath || seen.has(item.relativePath)) continue;
      seen.add(item.relativePath);
      items.push(item);
    }
    if (file?.relativePath && !seen.has(file.relativePath)) items.unshift(file);
    return items;
  }, [file, galleryFiles]);
  const galleryIndex = Math.max(0, normalizedGallery.findIndex((item) => item.relativePath === path));
  const hasGallery = normalizedGallery.length > 1;
  const effectiveGalleryTitle = galleryTitle || (hasGallery ? 'Memory stack' : displayName);
  const canRenameGallery = typeof onGalleryTitleChange === 'function';
  const isPrivateFile = file?.riskLevel === 'secret'
    || file?.riskLevel === 'private'
    || file?.privacyLevel === 'private'
    || syncStatus === 'sealed';
  const readingStatus = isPrivateFile ? 'private' : syncStatus === 'synced' ? 'synced' : 'ready';
  const isContentReady = typeof content === 'string';
  const resolvedContent = typeof content === 'string' ? content : '';
  const htmlContent = useMemo(() => renderMarkdown(resolvedContent), [resolvedContent]);
  const draftHtmlContent = useMemo(() => renderMarkdown(draftContent), [draftContent]);
  const hasUnsavedChanges = draftContent !== resolvedContent;

  useEffect(() => {
    setIsEditing(false);
    setDraftContent(typeof content === 'string' ? content : '');
    setSaveBusy(false);
    setSaveError('');
  }, [path]);

  useEffect(() => {
    if (!isEditing) {
      setDraftContent(typeof content === 'string' ? content : '');
    }
  }, [content, isEditing]);

  useEffect(() => {
    setTitleDraft(effectiveGalleryTitle);
    setIsEditingTitle(false);
  }, [effectiveGalleryTitle, path]);

  useEffect(() => {
    if (!hasGallery || isEditing) return undefined;
    const onKeyDown = (event) => {
      const tag = (event.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        navigateGallery(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        navigateGallery(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [galleryIndex, hasGallery, isEditing, normalizedGallery, onNavigateFile]);

  async function handleSave() {
    if (typeof onSave !== 'function' || saveBusy || !hasUnsavedChanges) return;
    try {
      setSaveBusy(true);
      setSaveError('');
      await onSave(draftContent);
      setIsEditing(false);
    } catch (error) {
      setSaveError(String(error?.message || error || 'Failed to save file'));
    } finally {
      setSaveBusy(false);
    }
  }

  function handleCancelEdit() {
    setDraftContent(resolvedContent);
    setIsEditing(false);
    setSaveError('');
  }

  function handleEditorKeyDown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      handleSave();
    }
  }

  function commitTitle() {
    const nextTitle = titleDraft.trim();
    setIsEditingTitle(false);
    if (!canRenameGallery) return;
    onGalleryTitleChange(nextTitle);
  }

  function navigateGallery(direction) {
    if (!hasGallery || isEditing || typeof onNavigateFile !== 'function') return;
    const nextIndex = (galleryIndex + direction + normalizedGallery.length) % normalizedGallery.length;
    const nextPath = normalizedGallery[nextIndex]?.relativePath;
    if (nextPath && nextPath !== path) onNavigateFile(nextPath);
  }

  return (
    <div className={`reading-panel-wrapper ${isEditing ? 'reading-panel-wrapper--editing' : ''} ${hasGallery && !isEditing ? 'reading-panel-wrapper--gallery' : ''}`}>
      <div className={`reading-panel reading-panel--${readingStatus}`}>
        <div className="rp-spine" aria-hidden="true">
          <span className="rp-punch" />
          <span className="rp-punch" />
          <span className="rp-punch" />
        </div>
        <div className="rp-dogear" aria-hidden="true" />
        <div className="rp-header" data-tour={onboardingActive ? 'reading-header' : undefined}>
          <div className="rp-titleblock">
            <div className="rp-title">{displayName}</div>
            <div className="rp-timestamp">{timestampLabel}</div>
          </div>
          {readingStatus === 'synced' ? (
            <span className="rp-sync-pill rp-sync-pill--synced" aria-label="File is synced to Echo">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2.5 6.2l2.3 2.3 4.7-4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Synced
            </span>
          ) : typeof onSyncFile === 'function' ? (
            <button
              type="button"
              className={`rp-sync-pill ${readingStatus === 'private' ? 'rp-sync-pill--private' : 'rp-sync-pill--pending'}`}
              onClick={() => onSyncFile(path)}
              disabled={!isConnected || syncing}
              title={!isConnected ? 'Connect to Echo to sync' : 'Sync this file to Echo'}
            >
              <span>{syncing ? 'Syncing…' : readingStatus === 'private' ? 'Sync' : 'To be synced'}</span>
              <svg className="rp-sync-pill__arrow" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2 6h7M6 3l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <span className={`rp-sync-pill ${readingStatus === 'private' ? 'rp-sync-pill--private' : 'rp-sync-pill--pending'}`} aria-label="File is ready to sync">
              {readingStatus === 'private' ? 'Sync' : 'To be synced'}
            </span>
          )}
          {typeof onSave === 'function' && isContentReady && !isEditing && (
            <button type="button" className="rp-action-btn rp-action-btn--ghost" data-tour={onboardingActive ? 'reading-edit' : undefined} onClick={() => setIsEditing(true)}>
              Edit
            </button>
          )}
          <button
            className="rp-back"
            data-tour={onboardingActive ? 'reading-back' : undefined}
            onClick={onClose}
            title="Close"
            aria-label="Close reading panel"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          {typeof onSave === 'function' && isContentReady && isEditing && (
            <div className="rp-actions">
              <span className={`rp-dirty-pill ${hasUnsavedChanges ? 'is-dirty' : ''}`}>
                {hasUnsavedChanges ? 'Unsaved changes' : 'No changes'}
              </span>
              <button
                type="button"
                className="rp-action-btn rp-action-btn--ghost"
                onClick={handleCancelEdit}
                disabled={saveBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rp-action-btn"
                data-tour={onboardingActive ? 'reading-save' : undefined}
                onClick={handleSave}
                disabled={saveBusy || !hasUnsavedChanges}
              >
                {saveBusy ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>
        <div className="rp-path">{path}</div>
        <div className="rp-body">
          <WarningNotice file={file} />
          {saveError && <div className="rp-save-error">{saveError}</div>}
          {isEditing ? (
            <div className="rp-editor-shell">
              <div className="rp-editor-pane">
                <div className="rp-pane-label">Markdown</div>
                <textarea
                  className="rp-editor"
                  value={draftContent}
                  onChange={(event) => setDraftContent(event.target.value)}
                  onKeyDown={handleEditorKeyDown}
                  spellCheck={false}
                  autoFocus
                />
                <div className="rp-editor-help">Ctrl/Cmd+S saves locally. Run sync afterward to push changes to Echo cloud.</div>
              </div>
              <div className="rp-preview-pane">
                <div className="rp-pane-label">Preview</div>
                <div className="rp-preview-body" dangerouslySetInnerHTML={{ __html: draftHtmlContent }} />
              </div>
            </div>
          ) : !isContentReady ? (
            <div className="rp-loading">Loading file content...</div>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
          )}
        </div>
        {hasGallery && !isEditing && (
          <div className="rp-nav">
            <button type="button" className="rp-nav__btn" onClick={() => navigateGallery(-1)} aria-label="Previous markdown">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <path d="M9.5 3.5 5.5 7.5l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="rp-nav__label">{galleryIndex + 1} of {normalizedGallery.length}</span>
            <button type="button" className="rp-nav__btn" onClick={() => navigateGallery(1)} aria-label="Next markdown">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <path d="m5.5 3.5 4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {hasGallery && !isEditing && (
        <aside className="rp-gallery" aria-label="Stack gallery">
          <div className="rp-gallery-head">
            <div className="rp-gallery-head__label">Stack</div>
            <div className="rp-gallery-head__row">
              {isEditingTitle ? (
                <input
                  className="rp-gallery-title-input"
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitTitle();
                    if (event.key === 'Escape') {
                      setTitleDraft(effectiveGalleryTitle);
                      setIsEditingTitle(false);
                    }
                  }}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className="rp-gallery-title-btn"
                  onClick={() => canRenameGallery && setIsEditingTitle(true)}
                  title={canRenameGallery ? 'Rename this pile' : undefined}
                >
                  {effectiveGalleryTitle}
                </button>
              )}
              <span className="rp-gallery-head__count">{galleryIndex + 1} / {normalizedGallery.length}</span>
            </div>
          </div>
          <div className="rp-gallery__rail">
            {normalizedGallery.map((item, index) => {
              const active = item.relativePath === path;
              const privateTone = item.riskLevel === 'secret' || item.riskLevel === 'private' || item.privacyLevel === 'private';
              return (
                <button
                  key={item.relativePath}
                  type="button"
                  className={`rp-gallery-card ${active ? 'is-active' : ''} ${privateTone ? 'is-private' : ''}`}
                  onClick={() => onNavigateFile?.(item.relativePath)}
                  style={{
                    '--rp-card-offset': `${Math.min(index, 8) * 12}px`,
                    '--rp-card-rotate': `${Math.max(-3.5, Math.min(3.5, (index - galleryIndex) * 0.32))}deg`,
                  }}
                >
                  <span className="rp-gallery-card__index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="rp-gallery-card__title">{displayFileName(item, item.relativePath)}</span>
                  <span className="rp-gallery-card__path">{compactPath(item.relativePath)}</span>
                </button>
              );
            })}
          </div>
        </aside>
      )}
    </div>
  );
}
