/**
 * ReadingPanel — full-page markdown reading mode.
 * Replaces the canvas viewport entirely.
 * Shows rendered markdown with proper typography.
 */

import React, { useMemo } from 'react';
import './ReadingPanel.css';

/**
 * Lightweight markdown → HTML converter.
 * Handles: headings, bold, italic, code blocks, inline code,
 * lists, links, blockquotes, horizontal rules.
 */
function renderMarkdown(md) {
  if (!md) return '';

  // Escape HTML first
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre class="rp-code-block"><code>${code.trim()}</code></pre>`;
  });

  const lines = html.split('\n');
  const result = [];
  let inList = false;
  let listType = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Headings
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      const level = hMatch[1].length;
      result.push(`<h${level} class="rp-h${level}">${inlineFormat(hMatch[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      result.push('<hr class="rp-hr" />');
      continue;
    }

    // Blockquote
    if (/^\s*&gt;\s?(.*)$/.test(line)) {
      if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
      const text = line.replace(/^\s*&gt;\s?/, '');
      result.push(`<blockquote class="rp-quote">${inlineFormat(text)}</blockquote>`);
      continue;
    }

    // Unordered list
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

    // Ordered list
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

    // Close list on blank line
    if (inList && line.trim() === '') {
      result.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
    }

    // Empty line → spacer
    if (line.trim() === '') {
      result.push('<div class="rp-spacer"></div>');
      continue;
    }

    // Regular paragraph
    result.push(`<p class="rp-p">${inlineFormat(line)}</p>`);
  }

  if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>');

  return result.join('\n');
}

/** Inline formatting: bold, italic, code, links, strikethrough */
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

export function ReadingPanel({ path, content, file, blocked = false, onClose }) {
  const displayName = (file?.fileName || path.split('/').pop()).replace(/\.md$/i, '');
  const htmlContent = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div className="reading-panel-wrapper">
      <div className="reading-panel">
        <div className="rp-header">
          <button className="rp-back" onClick={onClose} title="Back to archive">←</button>
          <div className="rp-title">{displayName}</div>
        </div>
        <div className="rp-path">{path}</div>
        {blocked ? (
          <div className="rp-body">
            <div className="rp-private">
              <div className="rp-private__title">
                {file?.hasSensitiveContent
                  ? file?.hasHighRiskSensitiveContent
                    ? '🚨 Sensitive content hidden'
                    : '⚠ Sensitive content hidden'
                  : '🔒 Private file hidden'}
              </div>
              <p className="rp-private__copy">
                {file?.hasSensitiveContent
                  ? 'This file is marked private in the local viewer. Detected values are never shown here.'
                  : 'This file is marked private in the local viewer. Its contents are not displayed here.'}
              </p>
              {file?.privacyAutoUpgraded && (
                <div className="rp-private__privacy">🔴 Privacy auto-upgraded to private</div>
              )}
              {(file?.sensitiveFindings || []).map((finding) => (
                <div key={finding.id} className="rp-private__row">
                  <span>{finding.label}</span>
                  <span>{formatFindingCount(finding)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rp-body" dangerouslySetInnerHTML={{ __html: htmlContent }} />
        )}
      </div>
    </div>
  );
}
