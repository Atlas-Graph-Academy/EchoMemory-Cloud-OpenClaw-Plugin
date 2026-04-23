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

export function ReadingPanel({ path, content, file, onClose, onSave, onboardingActive = false }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const displayName = (file?.fileName || path.split('/').pop()).replace(/\.md$/i, '');
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

  return (
    <div className="reading-panel-wrapper">
      <div className="reading-panel">
        <div className="rp-spine" aria-hidden="true">
          <span className="rp-punch" />
          <span className="rp-punch" />
          <span className="rp-punch" />
        </div>
        <div className="rp-dogear" aria-hidden="true" />
        <div className="rp-header" data-tour={onboardingActive ? 'reading-header' : undefined}>
          <button className="rp-back" data-tour={onboardingActive ? 'reading-back' : undefined} onClick={onClose} title="Back to archive">
            {'<-'}
          </button>
          <div className="rp-title">{displayName}</div>
          {typeof onSave === 'function' && isContentReady && !isEditing && (
            <button type="button" className="rp-action-btn" data-tour={onboardingActive ? 'reading-edit' : undefined} onClick={() => setIsEditing(true)}>
              Edit
            </button>
          )}
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
      </div>
    </div>
  );
}
