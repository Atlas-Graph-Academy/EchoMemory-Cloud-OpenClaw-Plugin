import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteCloudMemory,
  deleteCloudSource,
  fetchCloudMemories,
  fetchCloudSources,
  updateCloudMemory,
  updateCloudSource,
} from '../sync/api';
import { getPlatformIcon } from './platformIcons';
import './CloudSidebar.css';

const GRAPH_URL = 'https://www.iditor.com/memory-timeline-lab';

const CJK_CHAR_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const LATIN_ALNUM_RE = /[A-Za-z0-9]/;

function normalizeText(value) {
  return String(value || '').trim();
}

function isSyntheticSource(source) {
  return String(source?.id || '').startsWith('context:');
}

function formatSidebarDateLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown Date';
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatSidebarDetailDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function groupItemsByDate(items, getDateValue) {
  const map = new Map();
  for (const item of items) {
    const rawDate = getDateValue(item);
    const dt = rawDate ? new Date(rawDate) : new Date(NaN);
    const key = Number.isNaN(dt.getTime()) ? 'Unknown Date' : dt.toISOString().split('T')[0];
    const label = Number.isNaN(dt.getTime()) ? 'Unknown Date' : formatSidebarDateLabel(dt);
    const existing = map.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      map.set(key, { key, label, items: [item] });
    }
  }
  return Array.from(map.values());
}

function truncateSourceTitle(raw) {
  const cleaned = normalizeText(raw).replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const hasCjk = CJK_CHAR_RE.test(cleaned);
  const hasLatin = LATIN_ALNUM_RE.test(cleaned);
  if (hasCjk && hasLatin) return cleaned.replace(/\s+/g, '').slice(0, 10);
  if (hasCjk) return cleaned.replace(/\s+/g, '').slice(0, 10);
  return cleaned.split(/\s+/).slice(0, 8).join(' ');
}

function extractSourceTitleFromContent(content) {
  const lines = String(content || '').split(/\r?\n/);
  const explicitTitle = lines
    .map((line) => line.trim())
    .find((line) => /^title\s*[:ï¼š]\s*.+/i.test(line));
  if (explicitTitle) {
    return truncateSourceTitle(explicitTitle.replace(/^title\s*[:ï¼š]\s*/i, '').trim());
  }
  const flattened = String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[#>*_\-\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateSourceTitle(flattened);
}

function extractFileNameStem(filePath) {
  const normalized = normalizeText(filePath).replace(/\\/g, '/');
  if (!normalized) return '';
  const fileName = normalized.split('/').pop() || '';
  return fileName.replace(/\.[^.]+$/, '').trim();
}

function sourceDisplayTitle(source) {
  const sourceKey = normalizeText(source?.source).toLowerCase();
  const fileStem = extractFileNameStem(source?.file_path || source?.filePath);
  const sectionTitle = truncateSourceTitle(source?.section_title || '');
  if (sourceKey.includes('openclaw') && fileStem) {
    return fileStem;
  }
  if (sourceKey.includes('mcp') && normalizeText(source?.section_title)) {
    return normalizeText(source.section_title).split(/\s+/).slice(0, 10).join(' ');
  }
  const doorTitle = truncateSourceTitle(source?.door_title || '');
  if (sectionTitle) return sectionTitle;
  if (fileStem) return fileStem;
  if (doorTitle && isSyntheticSource(source)) return doorTitle;
  const contentTitle = extractSourceTitleFromContent(source?.content || '');
  if (contentTitle) return contentTitle;
  if (doorTitle) return doorTitle;
  if (isSyntheticSource(source)) return 'Conversation Source';
  return 'Untitled source';
}

function resolveMemoryTagColor(memory) {
  const key = normalizeText(memory?.category).toLowerCase();
  if (key.includes('work')) return { r: 108, g: 176, b: 210 };
  if (key.includes('learn')) return { r: 142, g: 162, b: 88 };
  if (key.includes('travel')) return { r: 75, g: 158, b: 107 };
  if (key.includes('personal')) return { r: 232, g: 145, b: 122 };
  return { r: 122, g: 174, b: 94 };
}

function resolveSourceTagColor(source) {
  const key = `${normalizeText(source?.source)} ${normalizeText(source?.door_title)}`.toLowerCase();
  if (key.includes('echochat') || key.includes('conversation')) return { r: 108, g: 176, b: 210 };
  if (key.includes('gemini') || key.includes('mcp')) return { r: 232, g: 145, b: 122 };
  if (key.includes('twitter') || key.includes('x.com')) return { r: 75, g: 158, b: 107 };
  return { r: 122, g: 174, b: 94 };
}

function memoryTitle(memory) {
  return normalizeText(memory?.keys || memory?.key || '') || 'Untitled memory';
}

function buildSyntheticConversationSources(memories, sources) {
  const sourceContextIds = new Set(
    sources
      .map((source) => normalizeText(source?.context_id))
      .filter(Boolean),
  );
  const contextSummary = new Map();
  const contextHasPublicMemory = new Map();

  for (const memory of memories) {
    const contextId = normalizeText(memory?.context_id);
    if (!contextId) continue;
    if (memory?.is_public) {
      contextHasPublicMemory.set(contextId, true);
    } else if (!contextHasPublicMemory.has(contextId)) {
      contextHasPublicMemory.set(contextId, false);
    }

    const description = normalizeText(memory?.description);
    const createdAt = memory?.created_at || memory?.time || new Date().toISOString();
    const existing = contextSummary.get(contextId);
    if (!existing) {
      contextSummary.set(contextId, {
        createdAt,
        descriptions: description ? [description] : [],
        doorTitle: normalizeText(memory?.door_title),
      });
      continue;
    }
    if (new Date(createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      existing.createdAt = createdAt;
    }
    if (description && existing.descriptions.length < 3) {
      existing.descriptions.push(description);
    }
  }

  return Array.from(contextSummary.entries())
    .filter(([contextId]) => !sourceContextIds.has(contextId))
    .map(([contextId, summary]) => ({
      id: `context:${contextId}`,
      context_id: contextId,
      created_at: summary.createdAt,
      source: 'EchoChat Conversation',
      section_title: null,
      source_url: null,
      is_processed: true,
      door_title: summary.doorTitle || null,
      is_public: Boolean(contextHasPublicMemory.get(contextId)),
      content: summary.descriptions.length > 0
        ? summary.descriptions.join('\n\n')
        : 'Conversation source. Open to inspect the linked memory thread.',
    }));
}

function matchesQuery(fields, query) {
  if (!query) return true;
  const lowered = query.toLowerCase();
  return fields.some((field) => String(field || '').toLowerCase().includes(lowered));
}

function PlatformPill({ source }) {
  const icon = getPlatformIcon(source || 'echochat');
  if (!icon) return null;
  return (
    <span className="memory-meta-pill memory-meta-pill-source" title={icon.label} aria-label={icon.label}>
      <span className="platform-icon-wrap">
        <img className="platform-icon" src={icon.iconSrc} alt={icon.label} />
      </span>
    </span>
  );
}

function ActiveDateChipEffect({ listRef, groups, activeTab, onActiveLabelChange }) {
  useEffect(() => {
    const pane = listRef.current;
    if (!pane) return undefined;

    const updateActiveChip = () => {
      const sections = Array.from(pane.querySelectorAll('[data-cloud-date-label]'));
      if (sections.length === 0) {
        onActiveLabelChange(activeTab, '');
        return;
      }
      const probe = pane.scrollTop + 18;
      let active = sections[0].dataset.cloudDateLabel || '';
      for (const section of sections) {
        if (section.offsetTop <= probe) {
          active = section.dataset.cloudDateLabel || active;
        } else {
          break;
        }
      }
      onActiveLabelChange(activeTab, active);
    };

    updateActiveChip();
    pane.addEventListener('scroll', updateActiveChip, { passive: true });
    return () => pane.removeEventListener('scroll', updateActiveChip);
  }, [activeTab, groups, listRef, onActiveLabelChange]);

  return null;
}

function CloudEditModal({ state, busy, onSave, onClose }) {
  const [keys, setKeys] = useState('');
  const [description, setDescription] = useState('');
  const [details, setDetails] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [content, setContent] = useState('');
  const [sectionTitle, setSectionTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');

  useEffect(() => {
    if (!state) return;
    if (state.type === 'memory') {
      setKeys(state.item?.keys || state.item?.key || '');
      setDescription(state.item?.description || '');
      setDetails(state.item?.details || '');
      setIsPublic(Boolean(state.item?.is_public));
      return;
    }
    setContent(state.item?.content || '');
    setSectionTitle(state.item?.section_title || state.item?.door_title || '');
    setSourceUrl(state.item?.source_url || '');
  }, [state]);

  if (!state) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (state.type === 'memory') {
      await onSave('memory', state.item.id, {
        keys: keys.trim() ? keys.trim() : null,
        description,
        details,
        is_public: isPublic,
      });
      return;
    }
    await onSave('source', state.item.id, {
      content: content.trim(),
      section_title: sectionTitle.trim() || null,
      source_url: sourceUrl.trim() || null,
    });
  };

  return (
    <div className="cloud-sidebar__detail-overlay" onClick={onClose}>
      <div className="memory-node-detail-card memory-node-detail-card--modal memory-edit-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={onClose} className="memory-node-detail-close" aria-label="Close edit dialog">
          x
        </button>

        <div className="memory-node-detail-time">{state.type === 'memory' ? 'Edit Memory' : 'Edit Source'}</div>
        <h3 className="memory-node-detail-title">
          {state.type === 'memory' ? memoryTitle(state.item) : sourceDisplayTitle(state.item)}
        </h3>
        <div className="memory-node-detail-tags">
          {state.type === 'memory' ? (
            <>
              {normalizeText(state.item?.category) && <span>{state.item.category}</span>}
              {normalizeText(state.item?.emotion) && <span>{state.item.emotion}</span>}
            </>
          ) : (
            <>
              {normalizeText(state.item?.source) && <span>{state.item.source}</span>}
              <span>{state.item?.is_processed ? 'Processed' : 'Pending'}</span>
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} className="memory-edit-form">
          {state.type === 'memory' ? (
            <>
              <div className="form-group">
                <label htmlFor="cloud-memory-title">Title</label>
                <input
                  id="cloud-memory-title"
                  type="text"
                  value={keys}
                  onChange={(event) => setKeys(event.target.value)}
                  disabled={busy}
                  placeholder="Memory title"
                />
              </div>

              <div className="form-group">
                <label htmlFor="cloud-memory-description">Description</label>
                <textarea
                  id="cloud-memory-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  disabled={busy}
                />
              </div>

              <div className="form-group">
                <label htmlFor="cloud-memory-details">Details</label>
                <textarea
                  id="cloud-memory-details"
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  rows={5}
                  disabled={busy}
                />
              </div>

              <div className="form-group">
                <label>Visibility</label>
                <div className="memory-visibility-toggle" role="group" aria-label="Memory visibility">
                  <button
                    type="button"
                    className={`memory-visibility-btn ${isPublic ? 'active' : ''}`}
                    onClick={() => setIsPublic(true)}
                    disabled={busy}
                  >
                    Public
                  </button>
                  <button
                    type="button"
                    className={`memory-visibility-btn ${!isPublic ? 'active' : ''}`}
                    onClick={() => setIsPublic(false)}
                    disabled={busy}
                  >
                    Private
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="cloud-source-title">Title</label>
                <input
                  id="cloud-source-title"
                  type="text"
                  value={sectionTitle}
                  onChange={(event) => setSectionTitle(event.target.value)}
                  disabled={busy}
                  placeholder="Source title"
                />
              </div>

              <div className="form-group">
                <label htmlFor="cloud-source-url">URL</label>
                <input
                  id="cloud-source-url"
                  type="text"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  disabled={busy}
                  placeholder="https://..."
                />
              </div>

              <div className="form-group">
                <label htmlFor="cloud-source-content">Content</label>
                <textarea
                  id="cloud-source-content"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  rows={8}
                  disabled={busy}
                />
              </div>
            </>
          )}

          <div className="memory-actions memory-actions--detail memory-edit-actions">
            <button type="button" onClick={onClose} className="memory-action-btn" disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="memory-action-btn" disabled={busy}>
              {busy ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CloudSidebar({ isConnected, apiKey, localApiAvailable, onOpenChange }) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('memories');
  const [cloudMemories, setCloudMemories] = useState([]);
  const [cloudSources, setCloudSources] = useState([]);
  const [loaded, setLoaded] = useState({ memories: false, sources: false });
  const [loading, setLoading] = useState({ memories: false, sources: false });
  const [error, setError] = useState({ memories: null, sources: null });
  const [searchQuery, setSearchQuery] = useState({ memories: '', sources: '' });
  const [activeDateChip, setActiveDateChip] = useState({ memories: '', sources: '' });
  const [detailState, setDetailState] = useState(null);
  const [editingState, setEditingState] = useState(null);
  const [mutationState, setMutationState] = useState(null);
  const listPaneRef = useRef(null);
  const isOpen = hoverOpen || focusOpen;

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (isConnected) return;
    setCloudMemories([]);
    setCloudSources([]);
    setLoaded({ memories: false, sources: false });
    setLoading({ memories: false, sources: false });
    setError({ memories: null, sources: null });
    setDetailState(null);
    setEditingState(null);
    setMutationState(null);
    setHoverOpen(false);
    setFocusOpen(false);
  }, [isConnected]);

  const loadCloudMemories = useCallback(async () => {
    setLoading((prev) => ({ ...prev, memories: true }));
    setError((prev) => ({ ...prev, memories: null }));
    try {
      const response = await fetchCloudMemories({ apiKey, localApiAvailable });
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to load cloud memories');
      }
      setCloudMemories(Array.isArray(response.data) ? response.data : []);
      setLoaded((prev) => ({ ...prev, memories: true }));
      setError((prev) => ({ ...prev, memories: null }));
    } catch (loadError) {
      setCloudMemories([]);
      setLoaded((prev) => ({ ...prev, memories: true }));
      setError((prev) => ({ ...prev, memories: String(loadError?.message || loadError) }));
    } finally {
      setLoading((prev) => ({ ...prev, memories: false }));
    }
  }, [apiKey, localApiAvailable]);

  const loadCloudSources = useCallback(async () => {
    setLoading((prev) => ({ ...prev, sources: true }));
    setError((prev) => ({ ...prev, sources: null }));
    try {
      const response = await fetchCloudSources({ apiKey, localApiAvailable });
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to load cloud sources');
      }
      setCloudSources(Array.isArray(response.data) ? response.data : []);
      setLoaded((prev) => ({ ...prev, sources: true }));
      setError((prev) => ({ ...prev, sources: null }));
    } catch (loadError) {
      setCloudSources([]);
      setLoaded((prev) => ({ ...prev, sources: true }));
      setError((prev) => ({ ...prev, sources: String(loadError?.message || loadError) }));
    } finally {
      setLoading((prev) => ({ ...prev, sources: false }));
    }
  }, [apiKey, localApiAvailable]);

  useEffect(() => {
    if (!isOpen || !isConnected) return;
    if (loaded.memories && loaded.sources) return;
    loadCloudMemories();
    loadCloudSources();
  }, [isConnected, isOpen, loaded.memories, loaded.sources, loadCloudMemories, loadCloudSources]);

  const mergedSources = useMemo(() => {
    const syntheticSources = buildSyntheticConversationSources(cloudMemories, cloudSources);
    return [...cloudSources, ...syntheticSources]
      .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
  }, [cloudMemories, cloudSources]);

  const sourceLookup = useMemo(() => {
    const byId = new Map();
    const byContext = new Map();
    for (const source of mergedSources) {
      byId.set(source.id, source);
      if (source.context_id) {
        byContext.set(source.context_id, source);
      }
    }
    return { byId, byContext };
  }, [mergedSources]);

  const filteredMemories = useMemo(() => {
    const query = normalizeText(searchQuery.memories);
    return [...cloudMemories]
      .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime())
      .filter((memory) => matchesQuery([
        memoryTitle(memory),
        memory?.description,
        memory?.details,
        memory?.category,
        memory?.object,
        memory?.emotion,
      ], query));
  }, [cloudMemories, searchQuery.memories]);

  const filteredSources = useMemo(() => {
    const query = normalizeText(searchQuery.sources);
    return mergedSources.filter((source) => matchesQuery([
      sourceDisplayTitle(source),
      source?.content,
      source?.source,
      source?.source_url,
      source?.context_id,
    ], query));
  }, [mergedSources, searchQuery.sources]);

  const memoryGroups = useMemo(
    () => groupItemsByDate(filteredMemories, (memory) => memory?.created_at || memory?.time),
    [filteredMemories],
  );
  const sourceGroups = useMemo(
    () => groupItemsByDate(filteredSources, (source) => source?.created_at),
    [filteredSources],
  );

  useEffect(() => {
    setActiveDateChip((prev) => ({
      ...prev,
      memories: memoryGroups[0]?.label || '',
    }));
  }, [memoryGroups]);

  useEffect(() => {
    setActiveDateChip((prev) => ({
      ...prev,
      sources: sourceGroups[0]?.label || '',
    }));
  }, [sourceGroups]);

  const handleRefresh = useCallback(() => {
    loadCloudMemories();
    loadCloudSources();
  }, [loadCloudMemories, loadCloudSources]);

  const openSourceForMemory = useCallback((memory) => {
    const firstSourceId = Array.isArray(memory?.source_of_truth_ids) ? memory.source_of_truth_ids[0] : null;
    const source = (
      (firstSourceId ? sourceLookup.byId.get(firstSourceId) : null)
      || (memory?.context_id ? sourceLookup.byContext.get(memory.context_id) : null)
      || null
    );
    setActiveTab('sources');
    if (!source) {
      if (!loading.sources) {
        loadCloudSources();
      }
      setDetailState(null);
      return;
    }
    setDetailState({ type: 'source', item: source });
  }, [loadCloudSources, loading.sources, sourceLookup.byContext, sourceLookup.byId]);

  const setCurrentDetailItem = useCallback((type, item) => {
    setDetailState((prev) => {
      if (!prev || prev.type !== type || prev.item?.id !== item?.id) return prev;
      return { type, item };
    });
  }, []);

  const handleSaveEdit = useCallback(async (type, id, updates) => {
    const actionKey = `${type}:${id}:save`;
    setMutationState(actionKey);
    try {
      if (type === 'memory') {
        const updated = await updateCloudMemory(id, updates, { apiKey });
        let nextMemory = null;
        setCloudMemories((prev) => prev.map((memory) => {
          if (memory.id !== id) return memory;
          nextMemory = { ...memory, ...updates, ...(updated || {}) };
          return nextMemory;
        }));
        if (nextMemory) {
          setCurrentDetailItem('memory', nextMemory);
        }
      } else {
        const updated = await updateCloudSource(id, updates, { apiKey });
        let nextSource = null;
        setCloudSources((prev) => prev.map((source) => {
          if (source.id !== id) return source;
          nextSource = { ...source, ...updates, ...(updated || {}) };
          return nextSource;
        }));
        if (nextSource) {
          setCurrentDetailItem('source', nextSource);
        }
      }
      setEditingState(null);
    } catch (saveError) {
      window.alert(String(saveError?.message || saveError || 'Failed to save changes'));
    } finally {
      setMutationState(null);
    }
  }, [apiKey, setCurrentDetailItem]);

  const handleDeleteMemory = useCallback(async (memory) => {
    if (!window.confirm('Are you sure you want to delete this memory?')) return false;
    const actionKey = `memory:${memory.id}:delete`;
    setMutationState(actionKey);
    try {
      await deleteCloudMemory(memory.id, { apiKey });
      setCloudMemories((prev) => prev.filter((item) => item.id !== memory.id));
      setDetailState((prev) => (prev?.type === 'memory' && prev.item?.id === memory.id ? null : prev));
      setEditingState((prev) => (prev?.type === 'memory' && prev.item?.id === memory.id ? null : prev));
      return true;
    } catch (deleteError) {
      window.alert(String(deleteError?.message || deleteError || 'Failed to delete memory'));
      return false;
    } finally {
      setMutationState(null);
    }
  }, [apiKey]);

  const handleDeleteSource = useCallback(async (source) => {
    if (isSyntheticSource(source)) {
      window.alert('Cannot delete a conversation context source directly here.');
      return false;
    }
    if (!window.confirm('Are you sure you want to delete this source?')) return false;
    const actionKey = `source:${source.id}:delete`;
    setMutationState(actionKey);
    try {
      await deleteCloudSource(source.id, { apiKey });
      setCloudSources((prev) => prev.filter((item) => item.id !== source.id));
      setDetailState((prev) => (prev?.type === 'source' && prev.item?.id === source.id ? null : prev));
      setEditingState((prev) => (prev?.type === 'source' && prev.item?.id === source.id ? null : prev));
      return true;
    } catch (deleteError) {
      window.alert(String(deleteError?.message || deleteError || 'Failed to delete source'));
      return false;
    } finally {
      setMutationState(null);
    }
  }, [apiKey]);

  const openMemoryEditor = useCallback((memory) => {
    setDetailState(null);
    setEditingState({ type: 'memory', item: memory });
  }, []);

  const openSourceEditor = useCallback((source) => {
    if (isSyntheticSource(source)) {
      window.alert('Cannot edit a conversation context source directly here.');
      return;
    }
    setDetailState(null);
    setEditingState({ type: 'source', item: source });
  }, []);

  const currentTabLabel = activeTab === 'memories' ? 'Memories' : 'Sources';
  const currentListLoading = activeTab === 'memories' ? loading.memories : loading.sources;
  const currentListError = activeTab === 'memories' ? error.memories : error.sources;
  const currentSearchQuery = activeTab === 'memories' ? searchQuery.memories : searchQuery.sources;
  const currentActiveDateChip = activeTab === 'memories' ? activeDateChip.memories : activeDateChip.sources;
  const currentGroups = activeTab === 'memories' ? memoryGroups : sourceGroups;
  const currentCount = activeTab === 'memories' ? filteredMemories.length : filteredSources.length;
  const totalCount = activeTab === 'memories' ? cloudMemories.length : mergedSources.length;

  const handleSetActiveDateLabel = useCallback((tab, label) => {
    setActiveDateChip((prev) => (prev[tab] === label ? prev : { ...prev, [tab]: label }));
  }, []);

  const isBusy = useCallback((type, id, action) => mutationState === `${type}:${id}:${action}`, [mutationState]);

  const handleSidebarBlur = useCallback((event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setFocusOpen(false);
  }, []);

  return (
    <aside
      className={`cloud-sidebar ${isOpen ? 'cloud-sidebar--open' : ''}`}
      aria-label="Echo cloud sidebar"
      onMouseEnter={() => setHoverOpen(true)}
      onMouseLeave={() => setHoverOpen(false)}
      onFocus={() => setFocusOpen(true)}
      onBlur={handleSidebarBlur}
    >
      <button
        type="button"
        className="cloud-sidebar__rail"
        aria-expanded={isOpen}
        onClick={() => {
          if (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) {
            setFocusOpen((prev) => !prev);
          }
        }}
      >
        <span>Cloud</span>
      </button>
      <div className="cloud-sidebar__panel">
        <div className="cloud-sidebar__panel-inner">
          <div className="cloud-sidebar__tabs">
            <button
              type="button"
              className={`cloud-sidebar__tab ${activeTab === 'memories' ? 'is-active' : ''}`}
              onClick={() => {
                setActiveTab('memories');
                setDetailState(null);
              }}
            >
              Memories
            </button>
            <button
              type="button"
              className={`cloud-sidebar__tab ${activeTab === 'sources' ? 'is-active' : ''}`}
              onClick={() => {
                setActiveTab('sources');
                setDetailState(null);
              }}
            >
              Sources
            </button>
          </div>

          {!isConnected ? (
            <div className="cloud-sidebar__empty">
              <p className="cloud-sidebar__empty-title">Echo cloud not connected</p>
              <p className="cloud-sidebar__empty-copy">
                Save a valid Echo API key in the left setup rail to unlock cloud memories and sources here.
              </p>
            </div>
          ) : (
            <div className="cloud-view">
              <div className="header">
                <div className="header-title-group">
                  <h2 className="view-header-title">My {currentTabLabel}</h2>
                  {activeTab === 'memories' && (
                    <a
                      className="header-link-btn"
                      href={GRAPH_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open memory graph in web app"
                      aria-label="Open memory graph in web app"
                    >
                      &rarr;
                    </a>
                  )}
                </div>
                <div className="header-actions">
                  <button type="button" className="secondary-btn" onClick={handleRefresh} disabled={currentListLoading}>
                    {currentListLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              </div>

              {activeTab === 'memories' ? (
                <div className="memory-metrics">
                  <div className="metric-card">
                    <span className="metric-value">
                      {cloudMemories.filter((memory) => Boolean(memory?.context_id)).length}
                    </span>
                    <span className="metric-label">With Source</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-value">{cloudMemories.length}</span>
                    <span className="metric-label">Total Memories</span>
                  </div>
                </div>
              ) : (
                <div className="source-metrics">
                  <div className="metric-card">
                    <span className="metric-value">{mergedSources.length}</span>
                    <span className="metric-label">Total Sources</span>
                  </div>
                </div>
              )}

              <div className="list-search">
                <input
                  type="text"
                  placeholder={activeTab === 'memories' ? 'Search memories...' : 'Search sources...'}
                  value={currentSearchQuery}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSearchQuery((prev) => ({ ...prev, [activeTab]: value }));
                  }}
                  aria-label={activeTab === 'memories' ? 'Search memories' : 'Search sources'}
                />
                {currentSearchQuery && (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setSearchQuery((prev) => ({ ...prev, [activeTab]: '' }))}
                    title="Clear search"
                    aria-label="Clear search"
                  >
                    X
                  </button>
                )}
                {currentSearchQuery && (
                  <span className="search-count">
                    {currentCount} / {totalCount}
                  </span>
                )}
              </div>

              <div className="memory-list-pane" ref={listPaneRef}>
                <ActiveDateChipEffect
                  listRef={listPaneRef}
                  groups={currentGroups}
                  activeTab={activeTab}
                  onActiveLabelChange={handleSetActiveDateLabel}
                />
                <div className="memory-time-chip">{currentActiveDateChip || 'No Date'}</div>
                {currentListLoading && currentGroups.length === 0 ? (
                  <div className="cloud-sidebar__empty"><p className="cloud-sidebar__empty-copy">Loading {currentTabLabel.toLowerCase()}...</p></div>
                ) : currentListError ? (
                  <div className="cloud-sidebar__empty">
                    <p className="cloud-sidebar__empty-title">Could not load {currentTabLabel.toLowerCase()}</p>
                    <p className="cloud-sidebar__empty-copy">{currentListError}</p>
                  </div>
                ) : currentGroups.length === 0 ? (
                  <div className="cloud-sidebar__empty">
                    <p className="cloud-sidebar__empty-title">
                      {currentSearchQuery ? `No ${currentTabLabel.toLowerCase()} match your search.` : `No ${currentTabLabel.toLowerCase()} yet.`}
                    </p>
                    <p className="cloud-sidebar__empty-copy">
                      {activeTab === 'memories'
                        ? 'Sync local markdown into Echo cloud to populate this panel.'
                        : 'Source records and conversation contexts will appear here once cloud memories are available.'}
                    </p>
                  </div>
                ) : (
                  <div className="memory-list">
                    {currentGroups.map((group) => (
                      <section className="memory-date-section" data-cloud-date-label={group.label} key={`${activeTab}-${group.key}`}>
                        <div className="memory-date-header">{group.label}</div>
                        {group.items.map((item) => {
                          if (activeTab === 'memories') {
                            const memory = item;
                            const tagColor = resolveMemoryTagColor(memory);
                            const firstSourceId = Array.isArray(memory?.source_of_truth_ids) ? memory.source_of_truth_ids[0] : null;
                            const linkedSource = (
                              (firstSourceId ? sourceLookup.byId.get(firstSourceId) : null)
                              || (memory?.context_id ? sourceLookup.byContext.get(memory.context_id) : null)
                              || null
                            );
                            const deleting = isBusy('memory', memory.id, 'delete');
                            const saving = isBusy('memory', memory.id, 'save');

                            return (
                              <div key={memory.id} className="memory-card">
                                <div className="memory-node-row">
                                  <div
                                    className={`memory-tag ${memory?.is_public ? 'memory-tag-public' : 'memory-tag-private'}`}
                                    style={memory?.is_public ? {
                                      '--r': String(tagColor.r),
                                      '--g': String(tagColor.g),
                                      '--b': String(tagColor.b),
                                    } : undefined}
                                  >
                                    <button
                                      type="button"
                                      className="memory-tag-title-btn"
                                      onClick={() => setDetailState({ type: 'memory', item: memory })}
                                      title="Open memory"
                                      aria-label={`Open memory: ${memoryTitle(memory)}`}
                                    >
                                      <span className="memory-tag-text">{memoryTitle(memory)}</span>
                                    </button>
                                  </div>
                                  <div className="memory-node-meta">
                                    {linkedSource && <PlatformPill source={linkedSource.source || 'echochat'} />}
                                  </div>
                                </div>
                                <div className="memory-actions">
                                  {linkedSource && (
                                    <button
                                      type="button"
                                      className="memory-action-btn"
                                      onClick={() => openSourceForMemory(memory)}
                                      disabled={deleting || saving}
                                    >
                                      Source
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="memory-action-btn"
                                    onClick={() => openMemoryEditor(memory)}
                                    disabled={deleting || saving}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="memory-action-btn memory-action-btn-delete"
                                    onClick={() => { void handleDeleteMemory(memory); }}
                                    disabled={deleting || saving}
                                  >
                                    {deleting ? 'Deleting...' : 'Delete'}
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          const source = item;
                          const sourceColor = resolveSourceTagColor(source);
                          const synthetic = isSyntheticSource(source);
                          const deleting = isBusy('source', source.id, 'delete');
                          const saving = isBusy('source', source.id, 'save');

                          return (
                            <div key={source.id} className="memory-card">
                              <div className="memory-node-row">
                                <div
                                  className={`memory-tag ${source?.is_public ? 'memory-tag-public' : 'memory-tag-private'}`}
                                  style={source?.is_public ? {
                                    '--r': String(sourceColor.r),
                                    '--g': String(sourceColor.g),
                                    '--b': String(sourceColor.b),
                                  } : undefined}
                                >
                                  <button
                                    type="button"
                                    className="memory-tag-title-btn"
                                    onClick={() => setDetailState({ type: 'source', item: source })}
                                    title="Open source"
                                    aria-label={`Open source: ${sourceDisplayTitle(source)}`}
                                  >
                                    <span className="memory-tag-text">{sourceDisplayTitle(source)}</span>
                                  </button>
                                </div>
                                <div className="memory-node-meta">
                                  <PlatformPill source={source?.source || 'echochat'} />
                                </div>
                              </div>
                              <div className="memory-actions">
                                <button
                                  type="button"
                                  className="memory-action-btn"
                                  onClick={() => setDetailState({ type: 'source', item: source })}
                                  disabled={deleting || saving}
                                >
                                  Source
                                </button>
                                {!synthetic && (
                                  <>
                                    <button
                                      type="button"
                                      className="memory-action-btn"
                                      onClick={() => openSourceEditor(source)}
                                      disabled={deleting || saving}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="memory-action-btn memory-action-btn-delete"
                                      onClick={() => { void handleDeleteSource(source); }}
                                      disabled={deleting || saving}
                                    >
                                      {deleting ? 'Deleting...' : 'Delete'}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {detailState && (
          <div className="cloud-sidebar__detail-overlay">
            <div className={`memory-node-detail-card ${detailState.type === 'source' ? 'source-detail-modal' : ''}`}>
              <button
                type="button"
                className="memory-node-detail-close"
                onClick={() => setDetailState(null)}
                aria-label="Close detail"
              >
                x
              </button>
              {detailState.type === 'memory' ? (
                <>
                  <div className="memory-node-detail-time">{formatSidebarDetailDate(detailState.item?.created_at || detailState.item?.time)}</div>
                  <h3 className="memory-node-detail-title">{memoryTitle(detailState.item)}</h3>
                  <div className="memory-node-detail-tags">
                    {normalizeText(detailState.item?.category) && <span>{detailState.item.category}</span>}
                    {normalizeText(detailState.item?.object) && <span>{detailState.item.object}</span>}
                    {normalizeText(detailState.item?.emotion) && <span>{detailState.item.emotion}</span>}
                    {detailState.item?.is_public ? <span>Public</span> : <span>Private</span>}
                  </div>
                  {normalizeText(detailState.item?.description) && (
                    <p className="memory-node-detail-desc">{detailState.item.description}</p>
                  )}
                  {normalizeText(detailState.item?.details) && (
                    <pre className="memory-detail-source-content">{detailState.item.details}</pre>
                  )}
                  <div className="memory-actions memory-actions--detail">
                    {((Array.isArray(detailState.item?.source_of_truth_ids) && detailState.item.source_of_truth_ids.length > 0) || detailState.item?.context_id) && (
                      <button
                        type="button"
                        className="memory-action-btn"
                        onClick={() => openSourceForMemory(detailState.item)}
                        disabled={isBusy('memory', detailState.item.id, 'delete') || isBusy('memory', detailState.item.id, 'save')}
                      >
                        View Source
                      </button>
                    )}
                    <button
                      type="button"
                      className="memory-action-btn"
                      onClick={() => openMemoryEditor(detailState.item)}
                      disabled={isBusy('memory', detailState.item.id, 'delete') || isBusy('memory', detailState.item.id, 'save')}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="memory-action-btn memory-action-btn-delete"
                      onClick={() => { void handleDeleteMemory(detailState.item); }}
                      disabled={isBusy('memory', detailState.item.id, 'delete') || isBusy('memory', detailState.item.id, 'save')}
                    >
                      {isBusy('memory', detailState.item.id, 'delete') ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="memory-node-detail-time">{formatSidebarDetailDate(detailState.item?.created_at)}</div>
                  <h3 className="memory-node-detail-title">{sourceDisplayTitle(detailState.item)}</h3>
                  <div className="memory-node-detail-tags">
                    {normalizeText(detailState.item?.source) && <span>{detailState.item.source}</span>}
                    {detailState.item?.is_public ? <span>Public</span> : <span>Private</span>}
                  </div>
                  {normalizeText(detailState.item?.source_url) && (
                    <div className="memory-detail-source-meta">
                      <a
                        className="memory-detail-source-link"
                        href={detailState.item.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {detailState.item.source_url}
                      </a>
                    </div>
                  )}
                  <pre className="memory-detail-source-content">{detailState.item?.content || 'No content available.'}</pre>
                  <div className="memory-actions memory-actions--detail">
                    {!isSyntheticSource(detailState.item) && (
                      <>
                        <button
                          type="button"
                          className="memory-action-btn"
                          onClick={() => openSourceEditor(detailState.item)}
                          disabled={isBusy('source', detailState.item.id, 'delete') || isBusy('source', detailState.item.id, 'save')}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="memory-action-btn memory-action-btn-delete"
                          onClick={() => { void handleDeleteSource(detailState.item); }}
                          disabled={isBusy('source', detailState.item.id, 'delete') || isBusy('source', detailState.item.id, 'save')}
                        >
                          {isBusy('source', detailState.item.id, 'delete') ? 'Deleting...' : 'Delete'}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <CloudEditModal
          state={editingState}
          busy={editingState ? isBusy(editingState.type, editingState.item.id, 'save') : false}
          onSave={handleSaveEdit}
          onClose={() => setEditingState(null)}
        />
      </div>
    </aside>
  );
}
