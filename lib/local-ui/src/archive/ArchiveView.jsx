/**
 * ArchiveView — full-screen file navigator with tree panel + grid cards.
 *
 * Opens as an overlay on top of the main dashboard. The left tree panel
 * mirrors the workspace directory structure; clicking a node filters the
 * right-hand grid to that subtree. Status filters (All / Private / Ready /
 * Synced) narrow the grid further.
 *
 * Props come straight from App.jsx — same data, different presentation.
 * Backend APIs are NOT called here; the parent owns data fetching.
 */

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import './ArchiveView.css';

// ── Classification ───────────────────────────────────────────────────────

function classifyForArchive(file, syncMap) {
  if (
    file?.riskLevel === 'secret' ||
    file?.riskLevel === 'private' ||
    file?.privacyLevel === 'private'
  ) {
    return 'private';
  }
  const status = syncMap?.[file?.relativePath];
  if (status === 'sealed') return 'private';
  if (status === 'synced') return 'synced';
  return 'ready';
}

// ── Formatting helpers ───────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}kb`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
}

function formatRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffDays = Math.floor((Date.now() - then) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function getTypeTag(file) {
  const ft = (file?.fileType || '').toLowerCase();
  const cl = (file?.clusterLabel || file?._clusterLabel || '').toLowerCase();
  if (ft === 'daily' || /timeline|journal/.test(cl)) return { label: 'Timeline', cls: 'arch-tag--tl' };
  if (/technical|config/.test(ft) || /technical/.test(cl)) return { label: 'Technical', cls: 'arch-tag--tech' };
  if (/identity|long-term/.test(ft)) return { label: 'System', cls: 'arch-tag--sys' };
  if (/private|diary/.test(ft)) return { label: 'Private', cls: 'arch-tag--priv' };
  if (/people/.test(cl)) return { label: 'People', cls: 'arch-tag--ppl' };
  if (file?.hasSensitiveContent) return { label: 'Sensitive', cls: 'arch-tag--sens' };
  return { label: ft || 'Note', cls: 'arch-tag--default' };
}

function getStatusTag(status) {
  if (status === 'private') return { label: 'Private', cls: 'arch-tag--priv' };
  if (status === 'synced') return { label: 'Synced', cls: 'arch-tag--sync' };
  if (status === 'ready') return { label: 'Local', cls: 'arch-tag--local' };
  return null;
}

function getPreviewText(file, contentMap) {
  const content = contentMap?.get(file?.relativePath) || '';
  if (!content) return '';
  let text = content.replace(/^---[\s\S]*?---\n?/, '');
  text = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[_*~`]/g, '');
  return text.trim().slice(0, 200);
}

// ── Tree builder ─────────────────────────────────────────────────────────

function buildFileTree(files, syncMap) {
  const root = { name: 'workspace', path: '', type: 'dir', children: [], fileCount: 0 };
  const dirMap = new Map([['', root]]);

  for (const file of files) {
    if (!file?.relativePath) continue;
    const parts = file.relativePath.split('/');
    const fileName = parts.pop();

    let currentPath = '';
    let currentNode = root;
    for (const part of parts) {
      const nextPath = currentPath ? `${currentPath}/${part}` : part;
      if (!dirMap.has(nextPath)) {
        const dir = { name: part, path: nextPath, type: 'dir', children: [], fileCount: 0 };
        currentNode.children.push(dir);
        dirMap.set(nextPath, dir);
      }
      currentPath = nextPath;
      currentNode = dirMap.get(nextPath);
    }

    const status = classifyForArchive(file, syncMap);
    currentNode.children.push({
      name: fileName,
      path: file.relativePath,
      type: 'file',
      status,
      file,
    });
  }

  function countAndSort(node) {
    if (node.type === 'file') return 1;
    let count = 0;
    for (const child of node.children) count += countAndSort(child);
    node.fileCount = count;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return count;
  }
  countAndSort(root);
  return root;
}

// ── TreeNode (recursive) ─────────────────────────────────────────────────

const MAX_TREE_FILES = 8;

function TreeNode({ node, expandedDirs, selectedPath, treeQuery, classified, onToggle, onSelect, depth }) {
  const normQuery = treeQuery.toLowerCase();

  if (node.type === 'file') {
    if (normQuery && !node.name.toLowerCase().includes(normQuery)) return null;
    const status = classified?.get(node.path) || 'ready';
    const dotCls =
      status === 'private' ? 'arch-td--priv' :
      status === 'synced'  ? 'arch-td--sync' :
      status === 'ready'   ? 'arch-td--ready' : 'arch-td--sys';

    return (
      <div
        className={`arch-tree-node${selectedPath === node.path ? ' arch-tree-node--active' : ''}`}
        onClick={() => onSelect(node.path)}
      >
        <div className="arch-tree-indent" style={{ width: depth * 16 + 8 }} />
        <span className="arch-tree-toggle arch-tree-toggle--leaf" />
        <div className={`arch-tree-dot ${dotCls}`} />
        <span className="arch-tree-name">{node.name}</span>
      </div>
    );
  }

  // Directory node
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = selectedPath === node.path;
  const hasDirChildren = node.children.some((c) => c.type === 'dir');
  const fileChildren = node.children.filter((c) => c.type === 'file');
  const dirChildren = node.children.filter((c) => c.type === 'dir');

  // Filter visibility in search mode
  if (normQuery) {
    const hasMatch = node.children.some((c) =>
      c.name.toLowerCase().includes(normQuery),
    );
    if (!hasMatch && !node.name.toLowerCase().includes(normQuery)) return null;
  }

  const visibleFiles = fileChildren.slice(0, MAX_TREE_FILES);
  const hiddenCount = fileChildren.length - visibleFiles.length;

  return (
    <>
      <div
        className={`arch-tree-node${isSelected ? ' arch-tree-node--active' : ''}`}
        onClick={() => {
          onSelect(node.path);
          if (!isExpanded) onToggle(node.path);
        }}
      >
        <div className="arch-tree-indent" style={{ width: depth * 16 + 8 }} />
        {hasDirChildren || fileChildren.length > 0 ? (
          <button
            className={`arch-tree-toggle${isExpanded ? ' arch-tree-toggle--open' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}
          >
            {'\u25B6'}
          </button>
        ) : (
          <span className="arch-tree-toggle arch-tree-toggle--leaf" />
        )}
        <span className="arch-tree-icon">{depth === 0 ? '' : '\uD83D\uDCC1'}</span>
        <span className="arch-tree-name">{node.name}</span>
        {node.fileCount > 0 && <span className="arch-tree-count">{node.fileCount}</span>}
      </div>
      {isExpanded && (
        <div className="arch-tree-children">
          {dirChildren.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              expandedDirs={expandedDirs}
              selectedPath={selectedPath}
              treeQuery={treeQuery}
              classified={classified}
              onToggle={onToggle}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
          {visibleFiles.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              expandedDirs={expandedDirs}
              selectedPath={selectedPath}
              treeQuery={treeQuery}
              classified={classified}
              onToggle={onToggle}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
          {hiddenCount > 0 && (
            <div
              className="arch-tree-node"
              style={{ opacity: 0.6 }}
              onClick={() => onSelect(node.path)}
            >
              <div className="arch-tree-indent" style={{ width: (depth + 1) * 16 + 8 }} />
              <span className="arch-tree-toggle arch-tree-toggle--leaf" />
              <span className="arch-tree-more">+{hiddenCount} more...</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ─�� ArchiveCard ──────────────────────────────────────────────────────────

function ArchiveCard({ file, status, contentMap, onClick }) {
  const typeTag = getTypeTag(file);
  const statusTag = getStatusTag(status);
  const preview = getPreviewText(file, contentMap);
  const size = formatBytes(file.sizeBytes);
  const date = formatRelative(file.modifiedTime || file.updatedAt);
  const isPrivate = status === 'private';

  const cardCls = [
    'arch-gcard',
    isPrivate && 'arch-gcard--priv',
    status === 'synced' && 'arch-gcard--sync',
  ].filter(Boolean).join(' ');

  const dotCls =
    isPrivate          ? 'arch-gs--priv' :
    status === 'synced' ? 'arch-gs--sync' :
    status === 'ready'  ? 'arch-gs--ready' : 'arch-gs--sys';

  return (
    <div className={cardCls} onClick={onClick}>
      <div className="arch-gc-head">
        <div className="arch-gc-fname">{file.fileName}</div>
        <div className="arch-gc-tags">
          <span className={`arch-tag ${typeTag.cls}`}>{typeTag.label}</span>
          {statusTag && <span className={`arch-tag ${statusTag.cls}`}>{statusTag.label}</span>}
          {file.hasSensitiveContent && status === 'private' && (
            <span className="arch-tag arch-tag--sens">
              {file.sensitiveSummary || 'Sensitive'}
            </span>
          )}
        </div>
      </div>
      <div className="arch-gc-body">
        <div className={`arch-gc-preview${isPrivate ? ' arch-gc-preview--blurred' : ''}`}>
          {preview || file.fileName}
        </div>
        {isPrivate && (
          <div className="arch-gc-priv-overlay">
            <div className="arch-gc-lock">{'\uD83D\uDD12'}</div>
            <div className="arch-gc-lock-lbl">Protected</div>
          </div>
        )}
      </div>
      <div className="arch-gc-foot">
        <span className="arch-gc-meta">{[size, date].filter(Boolean).join(' \u00B7 ')}</span>
        <div className={`arch-gc-status ${dotCls}`} />
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────

const FILTER_LABELS = {
  all: 'All',
  private: 'Private',
  ready: 'Ready',
  synced: 'Synced',
};

export function ArchiveView({
  open,
  files,
  syncMap,
  contentMap,
  initialFilter,
  onClose,
  onFileClick,
}) {
  const [filter, setFilter] = useState(initialFilter || 'all');
  const [selectedTreePath, setSelectedTreePath] = useState('');
  const [expandedDirs, setExpandedDirs] = useState(() => new Set(['', 'memory']));
  const [treeQuery, setTreeQuery] = useState('');

  // Sync filter when archive opens with a specific section
  useEffect(() => {
    if (open && initialFilter) setFilter(initialFilter);
  }, [open, initialFilter]);

  // Reset tree search when closing
  useEffect(() => {
    if (!open) setTreeQuery('');
  }, [open]);

  const tree = useMemo(
    () => buildFileTree(files || [], syncMap),
    [files, syncMap],
  );

  const classified = useMemo(() => {
    const map = new Map();
    for (const file of files || []) {
      map.set(file.relativePath, classifyForArchive(file, syncMap));
    }
    return map;
  }, [files, syncMap]);

  const filteredFiles = useMemo(() => {
    let list = files || [];

    // Tree selection
    if (selectedTreePath) {
      list = list.filter((f) => {
        const rel = f.relativePath || '';
        // Exact file match or directory prefix match
        return rel === selectedTreePath || rel.startsWith(selectedTreePath + '/');
      });
    }

    // Status filter
    if (filter !== 'all') {
      list = list.filter((f) => classified.get(f.relativePath) === filter);
    }

    // Sort by modified time desc
    return [...list].sort((a, b) => {
      const at = new Date(a.modifiedTime || 0).getTime();
      const bt = new Date(b.modifiedTime || 0).getTime();
      return bt - at;
    });
  }, [files, selectedTreePath, filter, classified]);

  const toggleDir = useCallback((path) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectTreeNode = useCallback((path) => {
    setSelectedTreePath((prev) => (prev === path ? '' : path));
  }, []);

  // ESC to close
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const breadcrumb = selectedTreePath
    ? `workspace / ${selectedTreePath.replace(/\//g, ' / ')}`
    : 'workspace /';
  const sectionTitle = selectedTreePath
    ? selectedTreePath.split('/').pop()
    : 'All files';

  return (
    <div className="arch-overlay">
      {/* Top bar */}
      <div className="arch-topbar">
        <button className="arch-back" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L3 7L9 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Dashboard
        </button>
        <div className="arch-divider" />
        <div className="arch-breadcrumb">{breadcrumb}</div>
        <div className="arch-gap" />
        <div className="arch-filter-row">
          {Object.entries(FILTER_LABELS).map(([key, label]) => (
            <button
              key={key}
              className={`arch-filter${filter === key ? ' arch-filter--active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="arch-divider" />
        <div className="arch-count">{filteredFiles.length} files</div>
      </div>

      <div className="arch-layout">
        {/* Tree panel */}
        <div className="arch-tree-panel">
          <div className="arch-tree-search">
            <input
              type="text"
              placeholder="Filter files..."
              value={treeQuery}
              onChange={(e) => setTreeQuery(e.target.value)}
            />
          </div>
          <div className="arch-tree-body">
            <div className="arch-tree-section-label">Workspace</div>
            <TreeNode
              node={tree}
              expandedDirs={expandedDirs}
              selectedPath={selectedTreePath}
              treeQuery={treeQuery}
              classified={classified}
              onToggle={toggleDir}
              onSelect={selectTreeNode}
              depth={0}
            />
          </div>
        </div>

        {/* Grid content */}
        <div className="arch-content">
          <div className="arch-section-hdr">
            <div className="arch-section-title">{sectionTitle}</div>
            <div className="arch-section-path">{breadcrumb}</div>
          </div>
          {filteredFiles.length === 0 ? (
            <div className="arch-empty">No files match this filter</div>
          ) : (
            <div className="arch-grid">
              {filteredFiles.map((file) => (
                <ArchiveCard
                  key={file.relativePath}
                  file={file}
                  status={classified.get(file.relativePath)}
                  contentMap={contentMap}
                  onClick={() => onFileClick?.(file.relativePath)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
