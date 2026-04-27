import React, { memo, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import './TreePanel.css';

const MEMORY_PREFIX = 'workspace/memory/';
const PROFILE_FILES = ['SOUL.md', 'USER.md', 'IDENTITY.md', 'MEMORY.md'];

/**
 * Build a nested folder tree from file relativePaths.
 * Only includes files under workspace/memory/.
 */
function buildMemoryTree(files) {
  const root = { name: 'memory', path: 'workspace/memory', folders: new Map(), files: [] };

  for (const file of files || []) {
    const rel = file?.relativePath;
    if (!rel || !rel.startsWith(MEMORY_PREFIX)) continue;
    const inner = rel.slice(MEMORY_PREFIX.length);
    if (!inner) continue;
    const parts = inner.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.folders.has(seg)) {
        const path = node.path ? `${node.path}/${seg}` : seg;
        node.folders.set(seg, { name: seg, path, folders: new Map(), files: [] });
      }
      node = node.folders.get(seg);
    }
    node.files.push({ file, relativePath: rel });
  }

  const sortNode = (n) => {
    const folders = [...n.folders.values()].map(sortNode).sort((a, b) => a.name.localeCompare(b.name));
    const files = [...n.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return { ...n, folders, files };
  };

  return sortNode(root);
}

/**
 * Extract profile files (SOUL.md, USER.md, etc.) from the workspace/ root.
 */
function extractProfile(files) {
  const out = [];
  for (const file of files || []) {
    const rel = file?.relativePath;
    if (!rel) continue;
    const name = rel.split('/').pop();
    if (rel.startsWith('workspace/') && !rel.startsWith('workspace/memory/') && PROFILE_FILES.includes(name)) {
      // Only take files directly under workspace/ (depth 1)
      if (rel.split('/').length === 2) {
        out.push({ file, relativePath: rel });
      }
    }
  }
  return out.sort((a, b) => {
    const ai = PROFILE_FILES.indexOf(a.file.fileName || a.relativePath.split('/').pop());
    const bi = PROFILE_FILES.indexOf(b.file.fileName || b.relativePath.split('/').pop());
    return ai - bi;
  });
}

/** Count total files under a node (recursive). */
function countFiles(node) {
  let n = node.files.length;
  for (const child of node.folders) n += countFiles(child);
  return n;
}

function matchesQuery(file, relativePath, q) {
  const name = (file?.fileName || relativePath.split('/').pop() || '').toLowerCase();
  return name.includes(q) || relativePath.toLowerCase().includes(q);
}

/** Return a copy of the tree with only files (and their ancestor folders) matching q. */
function filterTreeByQuery(node, q) {
  const folders = node.folders
    .map((child) => filterTreeByQuery(child, q))
    .filter(Boolean);
  const files = node.files.filter(({ file, relativePath }) => matchesQuery(file, relativePath, q));
  if (folders.length === 0 && files.length === 0) return null;
  return { ...node, folders, files };
}

export const TreePanel = memo(function TreePanel({
  files,
  syncMap,
  onOpenFile,
  query,
  isOpen = true,
  onClose,
}) {
  const q = (query || '').trim().toLowerCase();
  const isFiltering = q.length > 0;
  const fullTree = useMemo(() => buildMemoryTree(files), [files]);
  const fullProfile = useMemo(() => extractProfile(files), [files]);
  const tree = useMemo(
    () => (isFiltering ? filterTreeByQuery(fullTree, q) : fullTree),
    [fullTree, isFiltering, q],
  );
  const profile = useMemo(
    () => (isFiltering
      ? fullProfile.filter(({ file, relativePath }) => matchesQuery(file, relativePath, q))
      : fullProfile),
    [fullProfile, isFiltering, q],
  );
  const total = useMemo(
    () => (tree ? countFiles(tree) : 0) + profile.length,
    [tree, profile],
  );
  const [openSet, setOpenSet] = useState(() => new Set(['workspace/memory', '__profile']));
  const isEmpty = isFiltering && total === 0;

  const toggle = (path) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  return (
    <motion.aside
      className="tree-panel"
      aria-label="Memory directory"
      aria-hidden={!isOpen}
      initial={false}
      animate={{
        x: isOpen ? 0 : 'calc(-100% - 24px)',
        opacity: isOpen ? 1 : 0,
      }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      style={{ pointerEvents: isOpen ? 'auto' : 'none' }}
    >
      <div className="tree-panel__head">
        <div className="tree-panel__title">
          <span className="tree-panel__icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M2 3.5h3.5l1.2 1.4H12a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"
                stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"
              />
            </svg>
          </span>
          <span>Memory</span>
        </div>
        <div className="tree-panel__meta">
          <span className="tree-panel__total">
            {isFiltering ? `${total} match${total === 1 ? '' : 'es'}` : `${total} files`}
          </span>
          {onClose && (
            <button
              type="button"
              className="panel-close"
              onClick={onClose}
              title="Collapse sidebar ( [ )"
              aria-label="Collapse memory sidebar"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M7.5 3L4.5 6L7.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="tree-panel__path">
        <span className="tree-panel__path-seg">~/.openclaw</span>
        <span className="tree-panel__path-sep">/</span>
        <span className="tree-panel__path-seg">workspace</span>
        <span className="tree-panel__path-sep">/</span>
        <span className="tree-panel__path-seg tree-panel__path-seg--active">memory</span>
      </div>

      <div className="tree-panel__body">
        {isEmpty && (
          <div className="tree-panel__empty">
            No files match &ldquo;{query}&rdquo;
          </div>
        )}
        {/* ─── Profile section ─── */}
        {!isEmpty && profile.length > 0 && (
          <div className="tree-section">
            <button
              type="button"
              className="tree-section__head"
              onClick={() => toggle('__profile')}
            >
              Profile
            </button>
            {(isFiltering || openSet.has('__profile')) && (
              <div className="tree-section__children">
                {profile.map(({ file, relativePath }) => {
                  const status = syncMap?.[relativePath];
                  const isPrivate = file.riskLevel === 'secret'
                    || file.riskLevel === 'private'
                    || file.privacyLevel === 'private'
                    || status === 'sealed';
                  return (
                    <div key={relativePath} className="tree-branch__item">
                      <button
                        type="button"
                        className={`tree-branch__leaf tree-branch__leaf--profile ${isPrivate ? 'is-priv' : ''}`}
                        onClick={() => onOpenFile?.(relativePath)}
                        title={relativePath}
                      >
                        {file.fileName || relativePath.split('/').pop()}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Memory tree ─── */}
        {!isEmpty && tree && (
          <TreeBranch
            node={tree}
            isRoot
            depth={0}
            openSet={openSet}
            toggle={toggle}
            onOpenFile={onOpenFile}
            syncMap={syncMap}
            forceOpen={isFiltering}
          />
        )}
      </div>
    </motion.aside>
  );
});

function TreeBranch({ node, isRoot, depth = 0, openSet, toggle, onOpenFile, syncMap, forceOpen = false }) {
  const isOpen = isRoot || forceOpen || openSet.has(node.path);
  const childFolders = node.folders || [];
  const childFiles = node.files || [];
  const hasChildren = childFolders.length > 0 || childFiles.length > 0;

  return (
    <div className={`tree-branch ${isRoot ? 'tree-branch--root' : ''}`} style={{ '--depth': depth }}>
      {!isRoot && (
        <button
          type="button"
          className="tree-branch__label"
          onClick={() => toggle(node.path)}
        >
          {node.name}
        </button>
      )}

      {isOpen && hasChildren && (
        <div className="tree-branch__children">
          {childFolders.map((child) => (
            <div key={child.path} className="tree-branch__item">
              <TreeBranch
                node={child}
                depth={depth + 1}
                openSet={openSet}
                toggle={toggle}
                onOpenFile={onOpenFile}
                syncMap={syncMap}
                forceOpen={forceOpen}
              />
            </div>
          ))}
          {childFiles.map(({ file, relativePath }) => {
            const status = syncMap?.[relativePath];
            const isPrivate = file.riskLevel === 'secret'
              || file.riskLevel === 'private'
              || file.privacyLevel === 'private'
              || status === 'sealed';
            const isSynced = status === 'synced';
            return (
              <div key={relativePath} className="tree-branch__item">
                <button
                  type="button"
                  className={`tree-branch__leaf ${isPrivate ? 'is-priv' : isSynced ? 'is-sync' : ''}`}
                  onClick={() => onOpenFile?.(relativePath)}
                  title={relativePath}
                >
                  {file.fileName || relativePath.split('/').pop()}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
