import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import './TreePanel.css';

/**
 * Build a nested folder tree from file relativePaths.
 *
 * Returns:
 *   { name, path, folders: Tree[], files: [{ file, relativePath }] }
 */
function buildTree(files) {
  const root = { name: '', path: '', folders: new Map(), files: [] };

  for (const file of files || []) {
    const rel = file?.relativePath;
    if (!rel) continue;
    const parts = rel.split('/');
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

/** Count total files under a node (recursive). */
function countFiles(node) {
  let n = node.files.length;
  for (const child of node.folders) n += countFiles(child);
  return n;
}

export function TreePanel({
  files,
  syncMap,
  selectedFolder,
  onSelectFolder,
  onOpenFile,
  isOpen = true,
  onClose,
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [openSet, setOpenSet] = useState(() => new Set(['']));

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
          <span className="tree-panel__total">{countFiles(tree)} files</span>
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

      <div className="tree-panel__body">
        <FolderNode
          node={tree}
          depth={0}
          openSet={openSet}
          toggle={toggle}
          selectedFolder={selectedFolder}
          onSelectFolder={onSelectFolder}
          onOpenFile={onOpenFile}
          syncMap={syncMap}
        />
      </div>
    </motion.aside>
  );
}

function FolderNode({
  node, depth, openSet, toggle, selectedFolder, onSelectFolder, onOpenFile, syncMap,
}) {
  const isRoot = depth === 0;
  const isOpen = isRoot || openSet.has(node.path);
  const childFolders = node.folders || [];
  const childFiles = node.files || [];
  const total = countFiles(node);
  const isSelected = selectedFolder === node.path;

  return (
    <div className="tree-node" style={{ '--depth': depth }}>
      {!isRoot && (
        <button
          type="button"
          className={`tree-folder ${isSelected ? 'is-selected' : ''}`}
          onClick={() => {
            toggle(node.path);
            onSelectFolder?.(isSelected ? null : node.path);
          }}
        >
          <span className={`tree-chev ${isOpen ? 'is-open' : ''}`} aria-hidden="true">▸</span>
          <span className="tree-folder__name">{node.name}</span>
          <span className="tree-folder__count">{total}</span>
        </button>
      )}

      {isOpen && (
        <div className="tree-children">
          {childFolders.map((child) => (
            <FolderNode
              key={child.path}
              node={child}
              depth={depth + 1}
              openSet={openSet}
              toggle={toggle}
              selectedFolder={selectedFolder}
              onSelectFolder={onSelectFolder}
              onOpenFile={onOpenFile}
              syncMap={syncMap}
            />
          ))}
          {childFiles.map(({ file, relativePath }) => {
            const status = syncMap?.[relativePath];
            const isPrivate = file.riskLevel === 'secret' || file.riskLevel === 'private' || file.privacyLevel === 'private' || status === 'sealed';
            const isSynced = status === 'synced';
            const iconCls = isPrivate ? 'is-priv' : isSynced ? 'is-sync' : 'is-ready';
            return (
              <button
                key={relativePath}
                type="button"
                className="tree-file"
                onClick={() => onOpenFile?.(relativePath)}
                title={relativePath}
              >
                <span className={`tree-file__dot ${iconCls}`} aria-hidden="true" />
                <span className="tree-file__name">{file.fileName || relativePath.split('/').pop()}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
