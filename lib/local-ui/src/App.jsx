import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Viewport } from './canvas/Viewport';
import { ReadingPanel } from './cards/ReadingPanel';
import { CloudSidebar } from './cloud/CloudSidebar';
import { Coachmark } from './onboarding/Coachmark';
import { buildTourSteps, ONBOARDING_STORAGE_KEY } from './onboarding/steps';
import { computeLayout, computeSystemLayout, getTier, isSessionLog } from './layout/masonry';
import {
  fetchFiles,
  fetchAllContents,
  fetchFileContent,
  saveFileContent,
  fetchAuthStatus,
  fetchSyncStatus,
  fetchBackendSources,
  triggerSync,
  triggerSyncSelected,
  connectSSE,
  fetchSetupStatus,
  fetchPluginUpdateStatus,
  reportUiPresence,
  saveSetupConfig,
  sendAuthOtp,
  triggerGatewayRestart,
  triggerPluginUpdate,
  verifyAuthOtp,
} from './sync/api';
import './styles/global.css';
import pluginPkg from '../../../package.json';

const UI_HEARTBEAT_INTERVAL_MS = 15000;
const TIME_GROUP_PATH_PREFIX = '__time_group__/';
const OTP_LENGTH = 6;

function normalizeEmailValue(value) {
  return String(value || '').trim().toLowerCase();
}

function sanitizeOtp(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildLocalUiClientId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `local-ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readOnboardingStorage() {
  if (typeof window === 'undefined') {
    return { completed: false, dismissed: false };
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) || '{}');
    return {
      completed: parsed.completed === true,
      dismissed: parsed.dismissed === true,
    };
  } catch {
    return { completed: false, dismissed: false };
  }
}

function writeOnboardingStorage(nextState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(nextState));
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function timeAgo(iso) {
  if (!iso) return 'Never synced';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Synced just now';
  if (min < 60) return `Synced ${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `Synced ${hrs}h ago`;
  return `Synced ${Math.floor(hrs / 24)}d ago`;
}

function buildAuthLabel(authStatus, hasApiKey) {
  if (authStatus?.connected) return 'Connected';
  if (!hasApiKey || authStatus?.reason === 'no_api_key') return 'Local-only mode';
  if (authStatus?.reason === 'auth_failed') return 'Key needs attention';
  return 'Offline';
}

function formatSourceLabel(field, setupState) {
  if (!field?.source) return 'unknown';
  if (field.source === 'local_only_override') {
    return 'local-only override';
  }
  if (field.source === 'plugin_config') {
    return `plugin config (${setupState?.configFile?.targetPath || 'openclaw.json'})`;
  }
  if (field.source === 'env_file') {
    return `env file (${setupState?.envFile?.targetPath || '.env'})`;
  }
  return field.source;
}

function normalizePathKey(rawPath) {
  if (!rawPath) return '';
  const normalized = String(rawPath).replace(/\\/g, '/');
  return normalized.toLowerCase();
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function basenameFromPath(relativePath) {
  if (!relativePath) return '';
  const parts = String(relativePath).split(/[\\/]/);
  return parts[parts.length - 1] || relativePath;
}

function parseDateInput(value, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
}

function formatShortDate(value) {
  if (!value) return 'Unknown date';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateRangeLabel(start, end) {
  if (!start || !end) return '';
  const startLabel = formatShortDate(start);
  const endLabel = formatShortDate(end);
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

function startOfIsoWeek(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay();
  next.setDate(next.getDate() + (day === 0 ? -6 : 1 - day));
  return next;
}

function getIsoWeekData(date) {
  const start = startOfIsoWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  const referenceThursday = new Date(start);
  referenceThursday.setDate(referenceThursday.getDate() + 3);
  const firstWeekReference = new Date(referenceThursday.getFullYear(), 0, 4);
  const firstWeekStart = startOfIsoWeek(firstWeekReference);
  const weekNumber = 1 + Math.round((start - firstWeekStart) / (7 * 24 * 60 * 60 * 1000));

  return {
    key: `${referenceThursday.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`,
    label: `Week of ${formatShortDate(start)}`,
    start,
    end,
  };
}

function getMonthData(date) {
  return {
    key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
    label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    start: new Date(date.getFullYear(), date.getMonth(), 1),
    end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}

function getFileAnchorDate(file) {
  const dailyMatch = String(file?.fileName || '').match(/^(\d{4}-\d{2}-\d{2})(?:-.+)?\.md$/i);
  if (dailyMatch) {
    const [year, month, day] = dailyMatch[1].split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }
  const modified = new Date(file?.modifiedTime || 0);
  return Number.isNaN(modified.getTime()) ? null : modified;
}

function compareFilesByDate(left, right) {
  if (left.fileType === 'daily' && right.fileType === 'daily') {
    return right.fileName.localeCompare(left.fileName);
  }
  if (left.dominantCluster !== right.dominantCluster) {
    return left.dominantCluster === 'timeline' ? -1 : 1;
  }
  return new Date(right.modifiedTime) - new Date(left.modifiedTime);
}

function fallbackSectionKey(file) {
  const ft = file?.fileType;
  if (ft === 'identity') return 'identity';
  if (ft === 'long-term') return 'long-term';
  if (ft === 'daily' || ft === 'memory') return 'journal';
  if (ft === 'tasks' || ft === 'projects' || ft === 'research' || ft === 'skills') return 'knowledge';
  if (String(ft || '').startsWith('agent:')) return 'system';
  if (ft === 'config' || ft === 'private' || ft === 'other') return 'system';
  return 'knowledge';
}

function resolveDisplaySectionKey(file) {
  if (!file || file._isSessionLog) return 'system';
  return file.clusterSectionKey || fallbackSectionKey(file);
}

function resolveTimeGroupBucket(file) {
  const sectionKey = resolveDisplaySectionKey(file);
  if (sectionKey === 'system') {
    const systemBucket = file?.fileType || file?.baseClass || 'other';
    return {
      sectionKey,
      bucketKey: `system:${systemBucket}`,
      systemBucket,
    };
  }
  return {
    sectionKey,
    bucketKey: `section:${sectionKey}`,
    systemBucket: null,
  };
}

function buildTimeGroupPath(mode, bucketKey, groupKey) {
  return `${TIME_GROUP_PATH_PREFIX}${mode}/${bucketKey}/${groupKey}`;
}

function isTimeGroupPath(path) {
  return typeof path === 'string' && path.startsWith(TIME_GROUP_PATH_PREFIX);
}

function buildTimeGroupedDisplayFiles(files, mode, expandedGroupKey) {
  if (mode === 'all') {
    return { items: files, groups: [] };
  }

  const groups = new Map();
  for (const file of files) {
    const anchorDate = getFileAnchorDate(file) || new Date(file.modifiedTime);
    if (Number.isNaN(anchorDate.getTime())) continue;
    const timeMeta = mode === 'week' ? getIsoWeekData(anchorDate) : getMonthData(anchorDate);
    const bucket = resolveTimeGroupBucket(file);
    const fullKey = `${bucket.bucketKey}/${timeMeta.key}`;
    if (!groups.has(fullKey)) {
      groups.set(fullKey, {
        ...bucket,
        key: timeMeta.key,
        fullKey,
        path: buildTimeGroupPath(mode, bucket.bucketKey, timeMeta.key),
        label: timeMeta.label,
        start: timeMeta.start,
        end: timeMeta.end,
        files: [],
        latestModifiedTime: file.modifiedTime,
      });
    }
    const group = groups.get(fullKey);
    group.files.push(file);
    if (new Date(file.modifiedTime) > new Date(group.latestModifiedTime)) {
      group.latestModifiedTime = file.modifiedTime;
    }
  }

  const groupsByBucket = new Map();
  for (const group of groups.values()) {
    if (!groupsByBucket.has(group.bucketKey)) groupsByBucket.set(group.bucketKey, []);
    groupsByBucket.get(group.bucketKey).push(group);
  }

  const items = [];
  const orderedGroups = [];

  for (const bucketGroups of groupsByBucket.values()) {
    bucketGroups.sort((left, right) => {
      const delta = right.start - left.start;
      if (delta !== 0) return delta;
      return String(right.key).localeCompare(String(left.key));
    });

    let groupSortOrder = 0;
    for (const group of bucketGroups) {
      const expanded = expandedGroupKey === group.fullKey;
      const groupFiles = [...group.files].sort(compareFilesByDate);
      const previewNames = groupFiles.slice(0, 3).map((file) => file.fileName.replace(/\.md$/i, ''));

      orderedGroups.push(group);
      items.push({
        fileName: group.label,
        relativePath: group.path,
        fileType: group.systemBucket || 'time-group',
        privacyLevel: 'safe',
        baseClass: group.systemBucket || 'time-group',
        dominantCluster: groupFiles[0]?.dominantCluster || null,
        clusterLabel: mode === 'week' ? 'weekly digest' : 'monthly digest',
        clusterSectionKey: group.sectionKey,
        clusterConfidence: 'high',
        sizeBytes: groupFiles.reduce((total, file) => total + (file.sizeBytes || 0), 0),
        modifiedTime: group.latestModifiedTime,
        isJournalGroup: true,
        _journalGroupKey: group.fullKey,
        _journalGroupLabel: group.label,
        _journalGroupMode: mode,
        _journalGroupExpanded: expanded,
        _journalGroupCount: groupFiles.length,
        _journalGroupPreviewNames: previewNames,
        _journalGroupRangeLabel: formatDateRangeLabel(group.start, group.end),
        _journalGroupLatestLabel: formatShortDate(group.latestModifiedTime),
        _groupSortOrder: groupSortOrder++,
        _visibleCount: expanded ? 0 : groupFiles.length,
      });

      if (expanded) {
        for (const file of groupFiles) {
          items.push({
            ...file,
            _journalGroupKey: group.fullKey,
            _groupSortOrder: groupSortOrder++,
            _visibleCount: 1,
          });
        }
      }
    }
  }

  return { items, groups: orderedGroups };
}

function formatStageLabel(stage) {
  if (!stage) return null;
  const normalized = String(stage).trim().toLowerCase();
  if (!normalized) return null;
  return normalized.replace(/[_-]+/g, ' ');
}

function buildSyncResultState(result) {
  const summary = result?.summary || {};
  const runResults = Array.isArray(result?.run_results) ? result.run_results : [];
  const failed = runResults.filter((item) => item?.status === 'failed');
  const parts = [];
  if (summary.new_memory_count > 0) parts.push(`${summary.new_memory_count} new memories`);
  if (summary.new_source_count > 0) parts.push(`${summary.new_source_count} files uploaded`);
  if (summary.skipped_count > 0) parts.push(`${summary.skipped_count} already synced`);
  if (summary.duplicate_count > 0) parts.push(`${summary.duplicate_count} duplicates`);
  if (summary.failed_file_count > 0) parts.push(`${summary.failed_file_count} failed`);

  let msg = parts.join(' | ') || 'Sync complete';
  if (failed.length > 0 && failed.length === runResults.length && runResults.length > 0) {
    msg = `All ${failed.length} selected file${failed.length === 1 ? '' : 's'} failed`;
  } else if (failed.length > 0) {
    msg = `Partial failure | ${msg}`;
  }

  return {
    ok: failed.length === 0,
    msg,
    failed,
  };
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [contentMap, setContentMap] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [authStatus, setAuthStatus] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);
  const [cardSyncState, setCardSyncState] = useState({});
  const [backendSources, setBackendSources] = useState(null);
  const [setupState, setSetupState] = useState(null);
  const [setupDraft, setSetupDraft] = useState({
    apiKey: '',
    memoryDir: '',
    autoSync: true,
    syncIntervalMinutes: '15',
    batchSize: '10',
    requestTimeoutMs: '300000',
    disableOpenClawMemoryToolsWhenConnected: false,
  });
  const [setupPanelsOpen, setSetupPanelsOpen] = useState({
    quickSetup: true,
    configuration: true,
    pluginUpdates: true,
  });
  const [setupSaving, setSetupSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [setupMessage, setSetupMessage] = useState(null);
  const [emailConnectState, setEmailConnectState] = useState('idle');
  const [connectEmail, setConnectEmail] = useState('');
  const [otpDigits, setOtpDigits] = useState(() => Array(OTP_LENGTH).fill(''));
  const [connectError, setConnectError] = useState(null);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [pluginUpdateState, setPluginUpdateState] = useState(null);
  const [pluginUpdateLoading, setPluginUpdateLoading] = useState(false);
  const [pluginUpdateBusy, setPluginUpdateBusy] = useState(false);
  const [gatewayRestartBusy, setGatewayRestartBusy] = useState(false);
  const [pluginUpdateMessage, setPluginUpdateMessage] = useState(null);
  const [view, setView] = useState('memories');
  const [journalViewMode, setJournalViewMode] = useState('all');
  const [onboarding, setOnboarding] = useState(() => ({
    active: false,
    stepIndex: 0,
    ...readOnboardingStorage(),
  }));
  const [tourTargetElement, setTourTargetElement] = useState(null);
  const [forcedCloudTab, setForcedCloudTab] = useState('memories');
  const [expandedJournalGroup, setExpandedJournalGroup] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);
  const [readingPath, setReadingPath] = useState(null);
  const [readingContent, setReadingContent] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [syncSelection, setSyncSelection] = useState(new Set());
  const [expandedWarnings, setExpandedWarnings] = useState({});
  const [cloudSidebarOpen, setCloudSidebarOpen] = useState(false);
  const now = useClock();
  const serverInstanceIdRef = useRef(null);
  const clientIdRef = useRef(buildLocalUiClientId());
  const otpInputRefs = useRef([]);

  const loadFiles = useCallback(async () => {
    try {
      const newFiles = await fetchFiles();
      setFiles(newFiles);
      fetchAllContents(newFiles)
        .then((contents) => {
          setContentMap(contents);
        })
        .catch(console.error);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const loadAuthStatus = useCallback(async () => {
    setAuthStatus(await fetchAuthStatus());
  }, []);

  const loadSyncStatus = useCallback(async () => {
    setSyncStatus(await fetchSyncStatus());
  }, []);

  const loadBackendSources = useCallback(async () => {
    const data = await fetchBackendSources();
    setBackendSources(data?.ok ? data : null);
  }, []);

  const loadSetupStatus = useCallback(async () => {
    const data = await fetchSetupStatus();
    setSetupState(data);
    if (data?.fields) {
      setSetupDraft({
        apiKey: data.fields.apiKey?.value || '',
        memoryDir: data.fields.memoryDir?.value || '',
        autoSync: data.fields.autoSync?.value !== false,
        syncIntervalMinutes: String(data.fields.syncIntervalMinutes?.value ?? 15),
        batchSize: String(data.fields.batchSize?.value ?? 10),
        requestTimeoutMs: String(data.fields.requestTimeoutMs?.value ?? 300000),
        disableOpenClawMemoryToolsWhenConnected: data.fields.disableOpenClawMemoryToolsWhenConnected?.value === true,
      });
    }
  }, []);

  const refreshSetupSurfaces = useCallback(async () => {
    await Promise.all([loadAuthStatus(), loadSyncStatus(), loadBackendSources(), loadSetupStatus()]);
  }, [loadAuthStatus, loadBackendSources, loadSetupStatus, loadSyncStatus]);

  const loadPluginUpdateStatus = useCallback(async () => {
    setPluginUpdateLoading(true);
    try {
      const data = await fetchPluginUpdateStatus();
      setPluginUpdateState(data);
    } catch (error) {
      setPluginUpdateState({
        ok: false,
        currentVersion: pluginPkg?.version || '',
        latestVersion: null,
        packageName: pluginPkg?.name || '',
        updateAvailable: false,
        canUpdate: false,
        installSource: 'unknown',
        installSourceLabel: 'Unknown',
        updateDisabledReason: null,
        checkedAt: new Date().toISOString(),
        error: String(error?.message ?? error),
      });
    } finally {
      setPluginUpdateLoading(false);
    }
  }, []);

  useEffect(() => {
    const sendPresence = (active = true) => reportUiPresence({
      clientId: clientIdRef.current,
      serverInstanceId: serverInstanceIdRef.current,
      active,
    });

    const sendInactivePresence = () => {
      const payload = JSON.stringify({
        clientId: clientIdRef.current,
        serverInstanceId: serverInstanceIdRef.current,
        active: false,
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/ui-presence', new Blob([payload], { type: 'application/json' }));
        return;
      }
      sendPresence(false);
    };

    sendPresence(true);
    const intervalId = window.setInterval(() => {
      sendPresence(true);
    }, UI_HEARTBEAT_INTERVAL_MS);
    window.addEventListener('beforeunload', sendInactivePresence);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('beforeunload', sendInactivePresence);
      sendPresence(false);
    };
  }, []);

  useEffect(() => {
    if (resendCountdown <= 0) return undefined;
    const id = window.setInterval(() => {
      setResendCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendCountdown]);

  useEffect(() => {
    loadFiles();
    loadAuthStatus();
    loadSyncStatus();
    loadBackendSources();
    loadSetupStatus();
    loadPluginUpdateStatus();
    const cleanup = connectSSE({
      onServerConnected: (event) => {
        const nextServerInstanceId = event?.serverInstanceId;
        if (!nextServerInstanceId) return;
        if (serverInstanceIdRef.current && serverInstanceIdRef.current !== nextServerInstanceId) {
          window.location.reload();
          return;
        }
        serverInstanceIdRef.current = nextServerInstanceId;
        reportUiPresence({
          clientId: clientIdRef.current,
          serverInstanceId: nextServerInstanceId,
          active: true,
        });
      },
      onFilesChanged: () => {
        loadFiles();
        loadSyncStatus();
      },
      onSyncProgress: (progress) => {
        if (!progress) return;
        setSyncProgress(progress);

        if (progress.phase === 'started') {
          setSyncing(true);
          setCardSyncState(() => {
            const next = {};
            for (const path of progress.queuedRelativePaths || []) {
              next[path] = 'queued';
            }
            return next;
          });
          return;
        }

        if (progress.phase === 'file-started') {
          setCardSyncState((prev) => {
            const next = { ...prev };
            for (const path of progress.currentRelativePaths || (progress.currentRelativePath ? [progress.currentRelativePath] : [])) {
              next[path] = 'syncing';
            }
            return next;
          });
          return;
        }

        if (progress.phase === 'file-stage') {
          setCardSyncState((prev) => {
            const next = { ...prev };
            for (const path of progress.currentRelativePaths || (progress.currentRelativePath ? [progress.currentRelativePath] : [])) {
              next[path] = 'syncing';
            }
            return next;
          });
          return;
        }

        if (progress.phase === 'file-finished') {
          setCardSyncState((prev) => {
            const next = { ...prev };
            const recentStatus = progress.recentFileResult?.status;
            const completedPaths = progress.completedRelativePaths || [];
            const failedPaths = progress.failedRelativePaths || [];
            for (const path of completedPaths) {
              next[path] = recentStatus === 'failed' ? 'failed' : 'done';
            }
            for (const path of failedPaths) {
              next[path] = 'failed';
            }
            return next;
          });
          return;
        }

        if (progress.phase === 'failed') {
          setSyncing(false);
          setCardSyncState((prev) => {
            const next = { ...prev };
            for (const path of progress.failedRelativePaths || progress.currentRelativePaths || []) {
              next[path] = 'failed';
            }
            return next;
          });
          return;
        }

        if (progress.phase === 'finished') {
          setSyncing(false);
          setCardSyncState((prev) => {
            const next = { ...prev };
            for (const path of progress.completedRelativePaths || []) {
              next[path] = 'done';
            }
            return next;
          });
        }
      },
    });
    return cleanup;
  }, [loadAuthStatus, loadBackendSources, loadFiles, loadPluginUpdateStatus, loadSetupStatus, loadSyncStatus]);

  useEffect(() => {
    setExpandedWarnings((prev) => {
      const next = {};
      const validPaths = new Set(files.map((file) => file.relativePath));
      for (const [key, value] of Object.entries(prev)) {
        if (value && validPaths.has(key)) next[key] = true;
      }
      return next;
    });
  }, [files]);

  const annotated = useMemo(
    () =>
      files.map((file) => ({
        ...file,
        _tier: getTier(file, contentMap),
        _isSessionLog: isSessionLog(file, contentMap),
      })),
    [files, contentMap],
  );

  const filteredAnnotated = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return annotated.filter((file) => {
      const modified = new Date(file.modifiedTime || 0);
      if (dateFrom) {
        const start = parseDateInput(dateFrom, false);
        if (start && modified < start) return false;
      }
      if (dateTo) {
        const end = parseDateInput(dateTo, true);
        if (end && modified > end) return false;
      }
      if (!query) return true;
      const content = contentMap?.get(file.relativePath) || '';
      const haystack = [
        file.fileName,
        file.relativePath,
        file.fileType,
        file.clusterLabel,
        file.dominantCluster,
        file.baseClass,
        content,
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [annotated, contentMap, dateFrom, dateTo, searchQuery]);

  const journalDisplay = useMemo(() => {
    const compactFiles = buildTimeGroupedDisplayFiles(filteredAnnotated, journalViewMode, expandedJournalGroup);
    return {
      files: compactFiles.items,
      groupedFileCount: filteredAnnotated.length,
      journalGroupCount: compactFiles.groups.length,
      groups: compactFiles.groups,
    };
  }, [expandedJournalGroup, filteredAnnotated, journalViewMode]);

  const journalGroupPaths = useMemo(
    () =>
      new Map(
        journalDisplay.groups.map((group) => [
          group.path,
          group,
        ]),
      ),
    [journalDisplay.groups, journalViewMode],
  );

  const [vpWidth, setVpWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handleResize = () => setVpWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const layout = useMemo(() => computeLayout(journalDisplay.files, vpWidth, contentMap), [journalDisplay.files, vpWidth, contentMap]);

  const systemLayout = useMemo(() => {
    if (view !== 'system') return null;
    return computeSystemLayout(layout.systemFiles || [], vpWidth, contentMap);
  }, [view, layout.systemFiles, vpWidth, contentMap]);

  const syncMetaByPath = useMemo(() => {
    const next = {};
    for (const status of syncStatus?.fileStatuses || []) {
      next[status.relativePath] = status;
    }
    return next;
  }, [syncStatus]);

  const syncMap = useMemo(() => {
    const next = {};

    if (syncStatus?.fileStatuses) {
      for (const status of syncStatus.fileStatuses) {
        if (status.status) next[status.relativePath] = status.status;
      }
    }

    if (backendSources?.sources) {
      const backendPaths = new Set(
        backendSources.sources
          .map((source) => normalizePathKey(source.filePath))
          .filter(Boolean),
      );
      for (const file of files) {
        const normalized = normalizePathKey(file.absolutePath || file.filePath);
        if (normalized && backendPaths.has(normalized) && !next[file.relativePath]) {
          next[file.relativePath] = 'synced';
        }
      }
    }

    for (const file of files) {
      if (file.privacyLevel === 'private') {
        next[file.relativePath] = 'sealed';
      } else if (!next[file.relativePath]) {
        next[file.relativePath] = 'new';
      }
    }

    return next;
  }, [syncStatus, backendSources, files]);

  const selectablePaths = useMemo(
    () =>
      new Set(
        (syncStatus?.fileStatuses || [])
          .filter((status) => status.syncEligible && ['new', 'modified', 'failed'].includes(status.status))
          .map((status) => status.relativePath),
      ),
    [syncStatus],
  );

  const toggleWarningExpansion = useCallback((filePath) => {
    if (!filePath) return;
    setExpandedWarnings((prev) => ({
      ...prev,
      [filePath]: !prev[filePath],
    }));
  }, []);

  const systemFileCount = layout.systemFileCount || 0;
  const visibleFileCount = layout.visibleFileCount || 0;
  const visibleCardCount = layout.visibleCardCount || layout.cards.length || 0;
  const visibleSectionCount = layout.visibleSectionCount || 0;

  const pendingCount = useMemo(() => {
    let count = 0;
    for (const status of Object.values(syncMap)) {
      if (status === 'new' || status === 'modified' || status === 'failed') count++;
    }
    return count;
  }, [syncMap]);

  const syncProgressPercent = useMemo(() => {
    if (!syncProgress?.totalFiles) return 0;
    return Math.max(0, Math.min(100, Math.round((syncProgress.completedFiles / syncProgress.totalFiles) * 100)));
  }, [syncProgress]);

  const readingFile = useMemo(
    () => files.find((file) => file.relativePath === readingPath) || null,
    [files, readingPath],
  );
  const hasApiKey = Boolean(setupDraft.apiKey);
  const isConnected = authStatus?.connected === true;
  const autoSyncEnabled = setupDraft.autoSync === true;
  const echoOnlyMemoryModeEnabled = setupDraft.disableOpenClawMemoryToolsWhenConnected === true;
  const activeLayout = view === 'system' && systemLayout ? systemLayout : layout;
  const representativeCardPath = useMemo(
    () => activeLayout?.cards?.find((card) => !isTimeGroupPath(card.key))?.key || activeLayout?.cards?.[0]?.key || null,
    [activeLayout],
  );
  const tourSteps = useMemo(
    () => buildTourSteps({ isConnected, pendingCount }),
    [isConnected, pendingCount],
  );
  const currentTourStep = onboarding.active ? tourSteps[onboarding.stepIndex] || null : null;

  const handleReadingSave = useCallback(async (nextContent) => {
    if (!readingPath) {
      throw new Error('No file selected');
    }

    const result = await saveFileContent(readingPath, nextContent);
    const nextFile = result?.file || null;
    const savedContent = typeof result?.content === 'string' ? result.content : nextContent;

    setReadingContent(savedContent);
    setContentMap((prev) => {
      const next = new Map(prev || []);
      next.set(readingPath, savedContent);
      return next;
    });
    if (nextFile?.relativePath) {
      setFiles((prev) => prev.map((file) => (
        file.relativePath === nextFile.relativePath ? nextFile : file
      )));
    }

    try {
      await loadSyncStatus();
    } catch {
      // The local write already succeeded; allow SSE or the next poll to refresh sync state.
    }
  }, [loadSyncStatus, readingPath]);

  const persistOnboardingState = useCallback((nextState) => {
    writeOnboardingStorage(nextState);
    setOnboarding((prev) => ({ ...prev, ...nextState }));
  }, []);

  const startOnboarding = useCallback(() => {
    persistOnboardingState({
      active: true,
      stepIndex: 0,
      completed: false,
      dismissed: false,
    });
  }, [persistOnboardingState]);

  const stopOnboarding = useCallback((nextState = {}) => {
    persistOnboardingState({
      active: false,
      stepIndex: 0,
      ...nextState,
    });
  }, [persistOnboardingState]);

  const goToTourStep = useCallback((direction) => {
    setOnboarding((prev) => {
      if (!prev.active) return prev;
      const nextIndex = Math.max(0, Math.min(tourSteps.length - 1, prev.stepIndex + direction));
      if (nextIndex === prev.stepIndex) {
        if (nextIndex === tourSteps.length - 1 && direction > 0) {
          writeOnboardingStorage({ completed: true, dismissed: false });
          return { ...prev, active: false, stepIndex: 0, completed: true, dismissed: false };
        }
        return prev;
      }
      return { ...prev, stepIndex: nextIndex };
    });
  }, [tourSteps.length]);

  const handleTourPrimaryAction = useCallback(() => {
    if (!currentTourStep) return;
    if (currentTourStep.id === 'welcome') {
      goToTourStep(1);
      return;
    }
    if (currentTourStep.id === 'completion') {
      if (!isConnected) {
        const emailInput = document.querySelector('[data-tour="email-connect"] input[type="email"]');
        emailInput?.focus();
        stopOnboarding({ completed: true, dismissed: false });
        return;
      }
      if (pendingCount > 0) {
        setSelectMode(true);
        stopOnboarding({ completed: true, dismissed: false });
        return;
      }
      window.open('https://www.iditor.com/memory-timeline-lab', '_blank', 'noopener,noreferrer');
      stopOnboarding({ completed: true, dismissed: false });
    }
  }, [currentTourStep, goToTourStep, isConnected, pendingCount, stopOnboarding]);

  useEffect(() => {
    if (onboarding.active) return;
    if (onboarding.completed || onboarding.dismissed) return;
    const timerId = window.setTimeout(() => {
      setOnboarding((prev) => (prev.completed || prev.dismissed || prev.active
        ? prev
        : { ...prev, active: true, stepIndex: 0 }));
    }, 500);
    return () => window.clearTimeout(timerId);
  }, [onboarding.active, onboarding.completed, onboarding.dismissed]);

  useEffect(() => {
    if (!currentTourStep) {
      setTourTargetElement(null);
      return;
    }

    setSetupPanelsOpen((prev) => ({
      ...prev,
      quickSetup: ['quick-setup'].includes(currentTourStep.id) ? true : prev.quickSetup,
      configuration: ['email-connect', 'configuration'].includes(currentTourStep.id) ? true : prev.configuration,
      pluginUpdates: currentTourStep.id === 'plugin-updates' ? true : prev.pluginUpdates,
    }));

    if (['select-files', 'sync', 'system-files', 'cloud-rail', 'cloud-memories', 'cloud-sources', 'completion'].includes(currentTourStep.id) && readingPath) {
      setReadingPath(null);
      setSelectedPath(null);
      setReadingContent(null);
    }

    if (currentTourStep.id === 'reading' && !readingPath) {
      const nextPath = selectedPath || representativeCardPath;
      if (nextPath && !isTimeGroupPath(nextPath)) {
        setReadingPath(nextPath);
        const existing = contentMap?.get(nextPath);
        if (existing) {
          setReadingContent(existing);
        } else {
          setReadingContent(null);
          fetchFileContent(nextPath).then((result) => {
            const content = result?.content ?? '';
            setReadingContent(content);
            setContentMap((prev) => {
              const next = new Map(prev || []);
              next.set(nextPath, content);
              return next;
            });
          });
        }
      }
    }

    if (currentTourStep.id === 'select-files' && pendingCount > 0) {
      setSelectMode(true);
    }

    if (['cloud-rail', 'cloud-memories'].includes(currentTourStep.id)) {
      setForcedCloudTab('memories');
    }
    if (currentTourStep.id === 'cloud-sources') {
      setForcedCloudTab('sources');
    }

    const query = `[data-tour="${currentTourStep.target}"]`;
    const rafId = window.requestAnimationFrame(() => {
      setTourTargetElement(document.querySelector(query));
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [contentMap, currentTourStep, pendingCount, readingPath, representativeCardPath, selectedPath]);

  useEffect(() => {
    if (journalViewMode === 'all' && expandedJournalGroup) {
      setExpandedJournalGroup(null);
    }
  }, [expandedJournalGroup, journalViewMode]);

  useEffect(() => {
    if (!expandedJournalGroup) return;
    if (journalDisplay.groups.some((group) => group.fullKey === expandedJournalGroup)) return;
    setExpandedJournalGroup(null);
  }, [expandedJournalGroup, journalDisplay.groups]);

  useEffect(() => {
    setSyncSelection((prev) => {
      const next = new Set([...prev].filter((path) => selectablePaths.has(path)));
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [selectablePaths]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncProgress(null);
    try {
      let result;
      if (selectMode && syncSelection.size > 0) {
        result = await triggerSyncSelected([...syncSelection]);
        setSyncSelection(new Set());
        setSelectMode(false);
      } else {
        result = await triggerSync();
      }
      setSyncResult(buildSyncResultState(result));
      loadSyncStatus();
      loadBackendSources();
    } catch (error) {
      setSyncResult({ ok: false, msg: String(error?.message || 'Sync failed') });
    } finally {
      setSyncing(false);
    }
  }, [loadBackendSources, loadSyncStatus, selectMode, syncSelection]);

  const toggleFileSelection = useCallback((filePath) => {
    if (!selectablePaths.has(filePath)) return;
    setSyncSelection((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, [selectablePaths]);

  const handleSetupFieldChange = useCallback((key, value) => {
    setSetupDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleSetupPanel = useCallback((key) => {
    setSetupPanelsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleSetupSave = useCallback(async () => {
    setSetupSaving(true);
    setSetupMessage(null);
    try {
      const result = await saveSetupConfig(setupDraft);
      setSetupState(result.setup || null);
      const nextMessage = setupDraft.disableOpenClawMemoryToolsWhenConnected
        ? [
            `Saved to ${result.targetPath}`,
            'To fully replace OpenClaw core memory retrieval, also add `"tools": {"deny": ["memory_search", "memory_get"]}` to `~/.openclaw/openclaw.json`, then restart `openclaw gateway`.',
          ].join(' ')
        : `Saved to ${result.targetPath}`;
      setSetupMessage({ ok: true, text: nextMessage });
      await refreshSetupSurfaces();
    } catch (error) {
      setSetupMessage({ ok: false, text: String(error?.message ?? error) });
    } finally {
      setSetupSaving(false);
    }
  }, [refreshSetupSurfaces, setupDraft]);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    setSetupMessage(null);
    setConnectError(null);
    try {
      const result = await saveSetupConfig({
        ...setupDraft,
        apiKey: '',
      });
      setSetupState(result.setup || null);
      setConnectEmail('');
      setEmailConnectState('idle');
      setResendCountdown(0);
      setOtpDigits(Array(OTP_LENGTH).fill(''));
      setSetupMessage({
        ok: true,
        text: `Disconnected this device from Echo Cloud and switched back to local-only mode. Saved to ${result.targetPath}.`,
      });
      await refreshSetupSurfaces();
    } catch (error) {
      setSetupMessage({ ok: false, text: String(error?.message ?? error) });
    } finally {
      setDisconnecting(false);
    }
  }, [refreshSetupSurfaces, setupDraft]);

  const focusOtpInput = useCallback((index) => {
    const nextInput = otpInputRefs.current[index];
    if (nextInput) {
      nextInput.focus();
      nextInput.select();
    }
  }, []);

  const clearOtpDigits = useCallback(() => {
    setOtpDigits(Array(OTP_LENGTH).fill(''));
  }, []);

  const handleSendOtp = useCallback(async () => {
    const email = normalizeEmailValue(connectEmail);
    if (!email) {
      setConnectError('Enter an email address to continue.');
      return;
    }

    setEmailConnectState('sending');
    setConnectError(null);
    try {
      await sendAuthOtp(email);
      setConnectEmail(email);
      clearOtpDigits();
      setResendCountdown(30);
      setEmailConnectState('otp_sent');
      window.requestAnimationFrame(() => focusOtpInput(0));
    } catch (error) {
      setConnectError(String(error?.message ?? error));
      setEmailConnectState('idle');
    }
  }, [clearOtpDigits, connectEmail, focusOtpInput]);

  const handleVerifyOtp = useCallback(async () => {
    const email = normalizeEmailValue(connectEmail);
    const otp = otpDigits.join('');
    if (!email || otp.length < OTP_LENGTH) {
      setConnectError('Enter the full 6-digit verification code.');
      return;
    }

    setEmailConnectState('verifying');
    setConnectError(null);
    try {
      const data = await verifyAuthOtp(email, otp);
      setConnectEmail(data?.email || email);
      clearOtpDigits();
      setResendCountdown(0);
      setEmailConnectState('connected');
      setSetupMessage({ ok: true, text: `Connected Echo Cloud and saved a new API key to ${data?.setup?.envFile?.targetPath || setupState?.envFile?.targetPath || '~/.openclaw/.env'}.` });
      refreshSetupSurfaces().catch((refreshError) => {
        console.error(refreshError);
      });
      loadFiles().catch((refreshError) => {
        console.error(refreshError);
      });
    } catch (error) {
      setConnectError(String(error?.message ?? error));
      setEmailConnectState('otp_sent');
    }
  }, [clearOtpDigits, connectEmail, loadFiles, otpDigits, refreshSetupSurfaces, setupState?.envFile?.targetPath]);

  const handleOtpDigitChange = useCallback((index, rawValue) => {
    const digits = sanitizeOtp(rawValue);
    setConnectError(null);

    if (!digits) {
      setOtpDigits((prev) => {
        const next = [...prev];
        next[index] = '';
        return next;
      });
      return;
    }

    setOtpDigits((prev) => {
      const next = [...prev];
      const chars = digits.slice(0, OTP_LENGTH - index).split('');
      chars.forEach((char, offset) => {
        next[index + offset] = char;
      });
      return next;
    });

    const nextIndex = Math.min(index + digits.length, OTP_LENGTH - 1);
    window.requestAnimationFrame(() => focusOtpInput(nextIndex));
  }, [focusOtpInput]);

  const handleOtpKeyDown = useCallback((index, event) => {
    if (event.key === 'Backspace' && !otpDigits[index] && index > 0) {
      event.preventDefault();
      setOtpDigits((prev) => {
        const next = [...prev];
        next[index - 1] = '';
        return next;
      });
      focusOtpInput(index - 1);
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      focusOtpInput(index - 1);
      return;
    }
    if (event.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      event.preventDefault();
      focusOtpInput(index + 1);
    }
  }, [focusOtpInput, otpDigits]);

  const handleOtpPaste = useCallback((event) => {
    const digits = sanitizeOtp(event.clipboardData?.getData('text') || '');
    if (!digits) return;
    event.preventDefault();
    const nextDigits = Array(OTP_LENGTH).fill('');
    digits.slice(0, OTP_LENGTH).split('').forEach((char, index) => {
      nextDigits[index] = char;
    });
    setOtpDigits(nextDigits);
    setConnectError(null);
    window.requestAnimationFrame(() => focusOtpInput(Math.min(digits.length, OTP_LENGTH) - 1));
  }, [focusOtpInput]);

  const resetQuickConnect = useCallback(() => {
    setEmailConnectState('idle');
    setConnectError(null);
    setResendCountdown(0);
    clearOtpDigits();
  }, [clearOtpDigits]);

  const handlePluginUpdate = useCallback(async () => {
    setPluginUpdateBusy(true);
    setPluginUpdateMessage(null);
    try {
      const result = await triggerPluginUpdate();
      setPluginUpdateMessage({ ok: true, text: result.message || 'Plugin updated successfully.' });
      await loadPluginUpdateStatus();
    } catch (error) {
      setPluginUpdateMessage({ ok: false, text: String(error?.message ?? error) });
    } finally {
      setPluginUpdateBusy(false);
    }
  }, [loadPluginUpdateStatus]);

  const handleGatewayRestart = useCallback(async () => {
    setGatewayRestartBusy(true);
    setPluginUpdateMessage(null);
    try {
      const result = await triggerGatewayRestart();
      setPluginUpdateMessage({
        ok: true,
        text: result.message || 'Triggered openclaw gateway restart. This page may reconnect automatically.',
      });
    } catch (error) {
      setPluginUpdateMessage({ ok: false, text: String(error?.message ?? error) });
    } finally {
      setGatewayRestartBusy(false);
    }
  }, []);

  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const authLabel = buildAuthLabel(authStatus, hasApiKey);
  const normalizedConnectEmail = normalizeEmailValue(connectEmail);
  const otpValue = otpDigits.join('');
  const quickConnectSupported = setupState?.capabilities?.emailQuickConnect !== false;
  const activeCardKeys = useMemo(
    () => new Set((activeLayout?.cards || []).map((card) => card.key)),
    [activeLayout],
  );
  const hasDateFilter = Boolean(dateFrom || dateTo);
  const hasSearchFilter = searchQuery.trim().length > 0;
  const compactJournalEnabled = journalViewMode !== 'all';
  const emptyStateMessage = hasSearchFilter && hasDateFilter
    ? 'No files match the current search and time range.'
    : hasSearchFilter
      ? `No files match "${searchQuery.trim()}"`
        : hasDateFilter
          ? 'No files fall inside the selected time range.'
          : 'No files available.';
  const compactModeLabel = journalViewMode === 'week' ? 'Week view' : journalViewMode === 'month' ? 'Month view' : 'View all';
  const pluginVersion = pluginPkg?.version || '';
  const displayPluginVersion = pluginUpdateState?.currentVersion || pluginVersion;
  const canTriggerPluginUpdate = Boolean(
    pluginUpdateState
    && pluginUpdateState.canUpdate !== false
    && (
      pluginUpdateState.updateAvailable
      || !pluginUpdateState.latestVersion
    ),
  );

  useEffect(() => {
    if (!selectedPath || readingPath) return;
    if (activeCardKeys.has(selectedPath)) return;
    setSelectedPath(null);
  }, [activeCardKeys, readingPath, selectedPath]);

  return (
    <div className={`app-shell ${cloudSidebarOpen ? 'app-shell--cloud-open' : ''}`}>
      <div className="app-atmosphere" />
      <div className="app-frame">
        <aside className="setup-sidebar" aria-label="Echo setup">
        <div className="setup-sidebar__rail">Setup</div>
        <div className="setup-sidebar__panel">
          <div className="setup-sidebar__header" data-tour="setup-header">
            <div>
              <h2>Echo Cloud Setup</h2>
              <p>Stay inside the local UI: enter your email, verify the code, and let the plugin save the cloud key for you.</p>
            </div>
            <div className="setup-sidebar__header-actions" data-tour="tour-entry">
              <span className={isConnected ? 'setup-pill setup-pill--ok' : 'setup-pill'}>{authLabel}</span>
              <button type="button" className="setup-secondary-btn setup-secondary-btn--inline" onClick={startOnboarding}>
                {onboarding.completed || onboarding.dismissed ? 'Replay onboarding' : 'Take tour'}
              </button>
            </div>
          </div>

          <div className="setup-card">
            <p className="setup-card__title">Current mode</p>
              <p className="setup-copy">
              {isConnected
                ? (echoOnlyMemoryModeEnabled
                    ? 'Cloud sync, graph links, and import status are active. OpenClaw default memory retrieval is suppressed for Echo-only recall.'
                    : 'Cloud sync, graph links, and import status are active.')
                : hasApiKey
                  ? (echoOnlyMemoryModeEnabled
                      ? 'The local UI is ready. Echo-only recall will take effect after cloud access is verified.'
                      : 'The local UI is ready. Save or verify your key to re-enable cloud features.')
                  : 'The local UI is running in local-only mode. Files remain fully viewable without an Echo API key.'}
            </p>
            {hasApiKey && (
              <div className="setup-actions setup-actions--stacked">
                <button
                  type="button"
                  className="setup-secondary-btn"
                  disabled={setupSaving || disconnecting}
                  onClick={handleDisconnect}
                >
                  {disconnecting ? 'Disconnecting...' : 'Disconnect this device'}
                </button>
                <p className="setup-copy">
                  This removes the saved local API key and returns the plugin to local-only mode on this device. Existing Echo API keys remain valid until you delete them from the website.
                </p>
              </div>
            )}
          </div>

          <div className="setup-card setup-card--collapsible" data-tour="quick-setup-card">
            <button
              type="button"
              className="setup-card__summary"
              aria-expanded={setupPanelsOpen.quickSetup}
              onClick={() => toggleSetupPanel('quickSetup')}
            >
              <span className="setup-card__title">Quick setup</span>
            </button>
            {setupPanelsOpen.quickSetup && (
              <div className="setup-card__content">
                <ol className="setup-steps">
                  <li>Enter your email and click <strong>Connect with email</strong>.</li>
                  <li>Paste the 6-digit code from your inbox.</li>
                  <li>The plugin creates or verifies your Echo account, saves a new API key locally, and reconnects automatically.</li>
                </ol>
                <p className="setup-copy">
                  Target env file: <code>{setupState?.envFile?.targetPath || 'Loading...'}</code>
                </p>
                <p className="setup-copy">
                  Manual API key entry still works below if you want to manage credentials yourself.
                </p>
              </div>
            )}
          </div>

          <div className="setup-card setup-card--collapsible" data-tour="configuration-card">
            <button
              type="button"
              className="setup-card__summary"
              aria-expanded={setupPanelsOpen.configuration}
              onClick={() => toggleSetupPanel('configuration')}
            >
              <span className="setup-card__title">Configuration</span>
            </button>
            {setupPanelsOpen.configuration && (
              <div className="setup-card__content">
                {quickConnectSupported && (
                  <div className="setup-quick-connect" data-tour="email-connect">
                    <div className="setup-quick-connect__header">
                      <p className="setup-card__title">Quick connect</p>
                      <span className={emailConnectState === 'connected' ? 'setup-pill setup-pill--ok' : 'setup-pill'}>
                        {emailConnectState === 'connected' ? 'Connected' : 'Email OTP'}
                      </span>
                    </div>
                    <p className="setup-copy">
                      New OpenClaw users can sign up here. You do not need to open the website or create an API key manually.
                    </p>

                    {(emailConnectState === 'idle' || emailConnectState === 'sending') && (
                      <>
                        {isConnected && !normalizedConnectEmail && (
                          <p className="setup-msg setup-msg--ok">Echo Cloud is already connected. Send a new code here if you want to replace the saved key.</p>
                        )}
                        <label className="setup-field">
                          <span>Email</span>
                          <input
                            type="email"
                            value={connectEmail}
                            placeholder="you@example.com"
                            autoComplete="email"
                            disabled={emailConnectState === 'sending'}
                            onChange={(event) => {
                              setConnectEmail(event.target.value);
                              setConnectError(null);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="setup-save-btn"
                          disabled={emailConnectState === 'sending' || !normalizedConnectEmail}
                          onClick={handleSendOtp}
                        >
                          {emailConnectState === 'sending' ? 'Sending code...' : 'Connect with email'}
                        </button>
                      </>
                    )}

                    {(emailConnectState === 'otp_sent' || emailConnectState === 'verifying') && (
                      <>
                        <p className="setup-copy">
                          Enter the 6-digit code sent to <strong>{normalizedConnectEmail}</strong>.
                        </p>
                        <div className="setup-otp-grid" onPaste={handleOtpPaste}>
                          {otpDigits.map((digit, index) => (
                            <input
                              key={`otp-${index}`}
                              ref={(node) => {
                                otpInputRefs.current[index] = node;
                              }}
                              className="setup-otp-input"
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              autoComplete={index === 0 ? 'one-time-code' : 'off'}
                              maxLength={1}
                              value={digit}
                              disabled={emailConnectState === 'verifying'}
                              onChange={(event) => handleOtpDigitChange(index, event.target.value)}
                              onKeyDown={(event) => handleOtpKeyDown(index, event)}
                            />
                          ))}
                        </div>
                        <div className="setup-actions">
                          <button
                            type="button"
                            className="setup-save-btn"
                            disabled={emailConnectState === 'verifying' || otpValue.length < OTP_LENGTH}
                            onClick={handleVerifyOtp}
                          >
                            {emailConnectState === 'verifying' ? 'Verifying...' : 'Verify and connect'}
                          </button>
                          <button
                            type="button"
                            className="setup-secondary-btn"
                            disabled={emailConnectState === 'verifying'}
                            onClick={resetQuickConnect}
                          >
                            Use another email
                          </button>
                        </div>
                        {resendCountdown > 0 ? (
                          <p className="setup-copy">Resend available in {resendCountdown}s.</p>
                        ) : (
                          <button type="button" className="setup-secondary-btn setup-secondary-btn--inline" onClick={handleSendOtp}>
                            Resend code
                          </button>
                        )}
                      </>
                    )}

                    {emailConnectState === 'connected' && (
                      <div className="setup-quick-connect__connected">
                        <p className="setup-msg setup-msg--ok">Connected as {normalizedConnectEmail || 'your verified email'}.</p>
                        <button type="button" className="setup-secondary-btn" onClick={resetQuickConnect}>
                          Connect another email
                        </button>
                      </div>
                    )}

                    {connectError && (
                      <p className="setup-msg setup-msg--error">{connectError}</p>
                    )}
                  </div>
                )}

                <details className="setup-advanced">
                  <summary className="setup-advanced__summary">Advanced: enter API key manually</summary>
                  <div className="setup-advanced__content">
                    <label className="setup-field">
                      <span>Echo API key</span>
                      <input
                        type="password"
                        value={setupDraft.apiKey}
                        placeholder={setupState?.fields?.apiKey?.maskedValue || 'ec_...'}
                        autoComplete="new-password"
                        onChange={(e) => handleSetupFieldChange('apiKey', e.target.value)}
                      />
                      <small>Source: {formatSourceLabel(setupState?.fields?.apiKey, setupState)}</small>
                    </label>
                  </div>
                </details>
                <label className="setup-field">
                  <span>Memory directory</span>
                  <input
                    type="text"
                    value={setupDraft.memoryDir || setupState?.fields?.memoryDir?.value || ''}
                    placeholder={setupState?.fields?.memoryDir?.value || ''}
                    onChange={(e) => handleSetupFieldChange('memoryDir', e.target.value)}
                  />
                  <small>Source: {formatSourceLabel(setupState?.fields?.memoryDir, setupState)}</small>
                  {(setupDraft.memoryDir || setupState?.fields?.memoryDir?.value) && (
                    <small>Current path: {setupDraft.memoryDir || setupState?.fields?.memoryDir?.value}</small>
                  )}
                </label>
                <label className="setup-field setup-checkbox-field">
                  <span>Autosync</span>
                  <div className="setup-checkbox-row">
                    <input
                      type="checkbox"
                      checked={autoSyncEnabled}
                      onChange={(e) => handleSetupFieldChange('autoSync', e.target.checked)}
                    />
                    <p>
                      Automatically scan the memory directory and sync changed files to Echo on the configured schedule.
                    </p>
                  </div>
                  <small>Source: {formatSourceLabel(setupState?.fields?.autoSync, setupState)}</small>
                </label>
                <label className="setup-field">
                  <span>Autosync interval (minutes)</span>
                  <input
                    type="number"
                    min="15"
                    step="1"
                    value={setupDraft.syncIntervalMinutes}
                    onChange={(e) => handleSetupFieldChange('syncIntervalMinutes', e.target.value)}
                  />
                  <small>Source: {formatSourceLabel(setupState?.fields?.syncIntervalMinutes, setupState)}</small>
                  <small>Minimum 15 minutes. Lower values are clamped when saved.</small>
                </label>
                <label className="setup-field">
                  <span>Sync batch size</span>
                  <input
                    type="number"
                    min="1"
                    max="25"
                    step="1"
                    value={setupDraft.batchSize}
                    onChange={(e) => handleSetupFieldChange('batchSize', e.target.value)}
                  />
                  <small>Source: {formatSourceLabel(setupState?.fields?.batchSize, setupState)}</small>
                  <small>Controls how many changed files are sent per sync request. Valid range: 1 to 25.</small>
                </label>
                <label className="setup-field">
                  <span>Request timeout (ms)</span>
                  <input
                    type="number"
                    min="1000"
                    max="900000"
                    step="1000"
                    value={setupDraft.requestTimeoutMs}
                    onChange={(e) => handleSetupFieldChange('requestTimeoutMs', e.target.value)}
                  />
                  <small>Source: {formatSourceLabel(setupState?.fields?.requestTimeoutMs, setupState)}</small>
                  <small>Applies to Echo API requests. Valid range: 1,000 to 900,000 ms.</small>
                </label>
                <label className="setup-field setup-checkbox-field">
                  <span>Echo-only memory retrieval</span>
                  <div className="setup-checkbox-row">
                    <input
                      type="checkbox"
                      checked={echoOnlyMemoryModeEnabled}
                      onChange={(e) => handleSetupFieldChange('disableOpenClawMemoryToolsWhenConnected', e.target.checked)}
                    />
                    <p>
                      Block OpenClaw `memory_search` and `memory_get` when Echo cloud mode is available, and steer retrieval to `echo_memory_search` instead.
                    </p>
                  </div>
                  <small>Source: {formatSourceLabel(setupState?.fields?.disableOpenClawMemoryToolsWhenConnected, setupState)}</small>
                  <small>
                    This only applies after cloud access is configured. For a stronger and more reliable swap, also add <code>{'"tools": {"deny": ["memory_search", "memory_get"]}'}</code> to `~/.openclaw/openclaw.json` and restart the gateway.
                  </small>
                  <small>
                    Local-only mode keeps OpenClaw&apos;s default memory tools available.
                  </small>
                </label>
                <button className="setup-save-btn" disabled={setupSaving} onClick={handleSetupSave}>
                  {setupSaving ? 'Saving...' : 'Save local settings'}
                </button>
                {setupMessage && (
                  <p className={setupMessage.ok ? 'setup-msg setup-msg--ok' : 'setup-msg setup-msg--error'}>
                    {setupMessage.text}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="setup-card setup-card--collapsible" data-tour="plugin-updates-card">
            <button
              type="button"
              className="setup-card__summary"
              aria-expanded={setupPanelsOpen.pluginUpdates}
              onClick={() => toggleSetupPanel('pluginUpdates')}
            >
              <span className="setup-card__title">Plugin updates</span>
            </button>
            {setupPanelsOpen.pluginUpdates && (
              <div className="setup-card__content">
                <div className="setup-update-grid">
                  <div className="setup-update-row">
                    <span>Current version</span>
                    <strong>{pluginUpdateState?.currentVersion ? `v${pluginUpdateState.currentVersion}` : `v${pluginVersion}`}</strong>
                  </div>
                  <div className="setup-update-row">
                    <span>Latest version</span>
                    <strong>
                      {pluginUpdateLoading
                        ? 'Checking...'
                        : pluginUpdateState?.latestVersion
                          ? `v${pluginUpdateState.latestVersion}`
                          : 'Unavailable'}
                    </strong>
                  </div>
                  <div className="setup-update-row">
                    <span>Install source</span>
                    <strong>{pluginUpdateState?.installSourceLabel || 'Loading...'}</strong>
                  </div>
                  <div className="setup-update-row">
                    <span>Status</span>
                    <strong>
                      {pluginUpdateLoading
                        ? 'Checking...'
                        : pluginUpdateState?.error
                          ? 'Check failed'
                          : pluginUpdateState?.updateAvailable
                            ? 'Update available'
                            : pluginUpdateState?.latestVersion
                              ? 'Up to date'
                              : 'Check required'}
                    </strong>
                  </div>
                </div>
                {pluginUpdateState?.checkedAt && (
                  <p className="setup-copy">Last checked: {timeAgo(pluginUpdateState.checkedAt)}</p>
                )}
                {pluginUpdateState?.updateDisabledReason && (
                  <p className="setup-copy">{pluginUpdateState.updateDisabledReason}</p>
                )}
                {pluginUpdateState?.error && (
                  <p className="setup-msg setup-msg--error">{pluginUpdateState.error}</p>
                )}
                <div className="setup-actions">
                  <button
                    type="button"
                    className="setup-secondary-btn"
                    onClick={loadPluginUpdateStatus}
                    disabled={pluginUpdateLoading || pluginUpdateBusy || gatewayRestartBusy}
                  >
                    {pluginUpdateLoading ? 'Checking...' : 'Check latest'}
                  </button>
                  <button
                    type="button"
                    className="setup-secondary-btn"
                    onClick={handlePluginUpdate}
                    disabled={
                      !pluginUpdateState
                      || !canTriggerPluginUpdate
                      || pluginUpdateLoading
                      || pluginUpdateBusy
                      || gatewayRestartBusy
                    }
                  >
                    {pluginUpdateBusy
                      ? 'Updating...'
                      : pluginUpdateState?.updateAvailable
                        ? 'Update plugin'
                        : 'Install latest'}
                  </button>
                  <button
                    type="button"
                    className="setup-secondary-btn"
                    onClick={handleGatewayRestart}
                    disabled={gatewayRestartBusy || pluginUpdateBusy}
                  >
                    {gatewayRestartBusy ? 'Restarting...' : 'Restart gateway'}
                  </button>
                </div>
                <p className="setup-copy">
                  Update installs the published npm package via <code>openclaw plugins install --dangerously-force-unsafe-install {pluginUpdateState?.packageName || pluginPkg?.name}</code>.
                  Restart the gateway afterward to load the new version.
                </p>
                <p className="setup-copy">
                  On OpenClaw 2026.4.8 and newer, keep <code>plugins.allow</code> configured for this plugin. Do not add <code>plugins.dangerousAllow</code> to <code>~/.openclaw/openclaw.json</code>; that key is invalid.
                </p>
                {pluginUpdateState?.releaseUrl && (
                  <p className="setup-copy">
                    <a href={pluginUpdateState.releaseUrl} target="_blank" rel="noopener noreferrer">View release page</a>
                  </p>
                )}
                {pluginUpdateMessage && (
                  <p className={pluginUpdateMessage.ok ? 'setup-msg setup-msg--ok' : 'setup-msg setup-msg--error'}>
                    {pluginUpdateMessage.text}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
        </aside>

        <header className="hdr">
          <div className="hdr-group hdr-group--title">
            <span className="hdr-icon">Archive</span>
            {readingPath ? (
              <>
                <span className="hdr-back" onClick={() => { setReadingPath(null); setSelectedPath(null); }}>
                  Back to archive
                </span>
                <span className="hdr-title">
                  {(readingFile?.fileName || '').replace(/\.md$/i, '')}
                </span>
              </>
            ) : view === 'memories' ? (
              <>
                <span className="hdr-title">OpenClaw Smart Clusters</span>
                {displayPluginVersion && <span className="hdr-version">v{displayPluginVersion}</span>}
              </>
            ) : (
              <>
                <span className="hdr-back" onClick={() => setView('memories')}>Back</span>
                <span className="hdr-title hdr-title-system">System Files</span>
                {displayPluginVersion && <span className="hdr-version">v{displayPluginVersion}</span>}
              </>
            )}
          </div>

          <div className="hdr-group hdr-group--filters" data-tour="topbar-filters">
            <input
              className="hdr-search"
              type="text"
              value={searchQuery}
              placeholder="Search files and content"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <input
              className="hdr-date"
              type="date"
              value={dateFrom}
              title="Only show files modified on or after this date"
              aria-label="Filter files from date"
              onChange={(event) => setDateFrom(event.target.value)}
            />
            <input
              className="hdr-date"
              type="date"
              value={dateTo}
              title="Only show files modified on or before this date"
              aria-label="Filter files to date"
              onChange={(event) => setDateTo(event.target.value)}
            />
            {hasDateFilter && (
              <button
                type="button"
                className="hdr-inline-btn"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
              >
                Clear dates
              </button>
            )}
            <select
              className="hdr-select"
              value={journalViewMode}
              title="Control how files are grouped"
              aria-label="File grouping view"
              onChange={(event) => {
                setJournalViewMode(event.target.value);
                setExpandedJournalGroup(null);
              }}
            >
              <option value="all">View All</option>
              <option value="month">By Month</option>
              <option value="week">By Week</option>
            </select>
            {compactJournalEnabled && expandedJournalGroup && (
              <button type="button" className="hdr-inline-btn" onClick={() => setExpandedJournalGroup(null)}>
                Collapse {journalViewMode}
              </button>
            )}
          </div>

          <div className="hdr-group hdr-group--meta" data-tour="topbar-status">
            <span className="hdr-meta"><b>{dateStr}</b> {timeStr}</span>
            <span className="hdr-meta">{timeAgo(syncStatus?.lastSyncAt)}</span>
            <span className="hdr-conn">
              {isConnected && <span className="conn-ok">{authLabel}</span>}
              {!isConnected && <span className="conn-off">{authLabel}</span>}
            </span>
          </div>
        </header>

        <main className={`app-main ${readingPath ? 'app-main--reading' : ''}`}>
          {readingPath ? (
            <ReadingPanel
              path={readingPath}
              content={readingContent ?? contentMap?.get(readingPath) ?? null}
              file={readingFile}
              onSave={handleReadingSave}
              onboardingActive={onboarding.active}
              onClose={() => {
                setReadingPath(null);
                setSelectedPath(null);
                setReadingContent(null);
              }}
            />
          ) : files.length === 0 ? (
            <div className="empty-state">Loading files...</div>
          ) : filteredAnnotated.length === 0 ? (
            <div className="empty-state">{emptyStateMessage}</div>
          ) : (
            <Viewport
              key={view}
              cards={activeLayout.cards}
              sections={activeLayout.sections}
              bounds={activeLayout.bounds}
              syncStatus={syncMap}
              syncMetaByPath={syncMetaByPath}
              transientStatusMap={cardSyncState}
              contentMap={contentMap}
              expandedWarnings={expandedWarnings}
              selectedPath={selectedPath}
              selectMode={selectMode}
              syncSelection={syncSelection}
              selectablePaths={selectablePaths}
              onboardingActive={onboarding.active}
              onboardingCardPath={representativeCardPath}
              onWarningToggle={toggleWarningExpansion}
              onCardClick={(path) => {
                if (selectMode) {
                  if (path && selectablePaths.has(path)) toggleFileSelection(path);
                  return;
                }
                if (path === null) {
                  setSelectedPath(null);
                  return;
                }
                setSelectedPath((prev) => (prev === path ? null : path));
              }}
              onCardExpand={(path) => {
                const journalGroup = journalGroupPaths.get(path);
                if (journalGroup) {
                  setExpandedJournalGroup((prev) => (prev === journalGroup.fullKey ? null : journalGroup.fullKey));
                  setSelectedPath(path);
                  return;
                }
                if (isTimeGroupPath(path)) return;
                setReadingPath(path);
                const existing = contentMap?.get(path);
                if (existing) {
                  setReadingContent(existing);
                  return;
                }
                setReadingContent(null);
                fetchFileContent(path).then((result) => {
                  const content = result?.content ?? '';
                  setReadingContent(content);
                  setContentMap((prev) => {
                    const next = new Map(prev || []);
                    next.set(path, content);
                    return next;
                  });
                });
              }}
            />
          )}
        </main>

        {syncProgress && (
          <div className="sync-progress-dock">
          <div className="sync-progress-top">
            <span className="sync-progress-title">
              {syncProgress.phase === 'failed'
                ? 'Sync failed'
                : syncProgress.phase === 'finished'
                  ? syncProgress.failedCount > 0
                    ? syncProgress.failedCount === syncProgress.totalFiles
                      ? 'All files failed'
                      : 'Sync finished with failures'
                    : 'Sync complete'
                  : 'Sync in progress'}
            </span>
            <span className="sync-progress-meta">
              {Math.max(syncProgress.currentFileIndex || syncProgress.completedFiles, syncProgress.completedFiles)} / {syncProgress.totalFiles} files
            </span>
            {syncProgress.currentRelativePath && (
              <span className="sync-progress-meta">
                File {basenameFromPath(syncProgress.currentRelativePath)}
              </span>
            )}
            {formatStageLabel(syncProgress.currentStage) && (
              <span className="sync-progress-meta">
                Stage {formatStageLabel(syncProgress.currentStage)}
              </span>
            )}
            <span className="sync-progress-meta">Elapsed {formatDuration(syncProgress.elapsedMs)}</span>
            {syncProgress.etaMs && syncProgress.phase !== 'finished' && syncProgress.phase !== 'failed' && (
              <span className="sync-progress-meta">ETA {formatDuration(syncProgress.etaMs)}</span>
            )}
            <span className="sync-progress-meta">
              OK {syncProgress.successCount} | Failed {syncProgress.failedCount}
            </span>
          </div>
          <div className="sync-progress-track">
            <div className="sync-progress-fill" style={{ width: `${syncProgressPercent}%` }} />
          </div>
          {syncProgress.recentFileResult?.status === 'failed' && (
            <div className="sync-progress-detail">
              Failed {basenameFromPath(syncProgress.recentFileResult.relativePath || syncProgress.currentRelativePath)}: {syncProgress.recentFileResult.lastError || 'Unknown error'}
            </div>
          )}
          </div>
        )}

        <footer className="ftr">
        {selectMode ? (
          <>
            <span className="selection-copy">
              <b>{syncSelection.size}</b> file{syncSelection.size !== 1 ? 's' : ''} selected
            </span>
            <button
              className="ftr-select-toggle"
              onClick={() => {
                const pending = (syncStatus?.fileStatuses || [])
                  .filter((status) => status.syncEligible && ['new', 'modified', 'failed'].includes(status.status))
                  .map((status) => status.relativePath);
                setSyncSelection(new Set(pending));
              }}
            >
              Select pending
            </button>
            <button className="ftr-select-toggle" onClick={() => setSyncSelection(new Set())}>Clear</button>
            <button className="ftr-select-toggle" onClick={() => { setSelectMode(false); setSyncSelection(new Set()); }}>
              Cancel
            </button>
          </>
        ) : view === 'memories' ? (
          <>
            <span>
              <b>{visibleSectionCount}</b> smart clusters | <b>{visibleCardCount}</b> visible cards | <b>{filteredAnnotated.length}</b> matching files
            </span>
            {compactJournalEnabled && journalDisplay.groupedFileCount > 0 && (
              <span>
                <b>{compactModeLabel}</b> | <b>{journalDisplay.journalGroupCount}</b> time groups | {expandedJournalGroup ? '1 expanded' : 'all folded'}
              </span>
            )}
            {systemFileCount > 0 && (
              <span className="ftr-system" data-tour="system-files-link" onClick={() => setView('system')} title="View system files">
                {systemFileCount} system files
              </span>
            )}
          </>
        ) : (
          <>
            <span>
              <b>{systemFileCount}</b> system files | hidden from smart clusters
            </span>
            {compactJournalEnabled && journalDisplay.groupedFileCount > 0 && (
              <span>
                <b>{compactModeLabel}</b> | <b>{journalDisplay.journalGroupCount}</b> time groups | {expandedJournalGroup ? '1 expanded' : 'all folded'}
              </span>
            )}
          </>
        )}
        <span className="ftr-spacer" />
        {syncResult && (
          <>
            <span className={syncResult.ok ? 'sync-result' : 'sync-error'}>{syncResult.msg}</span>
            {!syncResult.ok && syncResult.failed?.length > 0 && (
              <span className="sync-error">
                {syncResult.failed
                  .slice(0, 2)
                  .map((item) => `${basenameFromPath(item.filePath)}: ${item.lastError || 'Unknown error'}`)
                  .join(' | ')}
              </span>
            )}
          </>
        )}
        <div className="ftr-action-cluster" data-tour="footer-sync-area">
          {!selectMode && pendingCount > 0 && (
            <button className="ftr-select-toggle" onClick={() => setSelectMode(true)}>
              Select files
            </button>
          )}
          {selectMode ? (
            <button className="sync-btn" disabled={!isConnected || syncing || syncSelection.size === 0} onClick={handleSync}>
              {syncing ? 'Syncing...' : `Sync ${syncSelection.size} selected`}
            </button>
          ) : (
            <a
              href="https://www.iditor.com/memory-timeline-lab"
              target="_blank"
              rel="noopener noreferrer"
              className="explore-btn"
              aria-disabled={!isConnected}
              onClick={(event) => {
                if (!isConnected) event.preventDefault();
              }}
            >
              {isConnected ? 'Explore your memories' : 'Add Echo key in Setup'}
            </a>
          )}
        </div>
        </footer>
        <CloudSidebar
          isConnected={isConnected}
          apiKey={setupDraft.apiKey}
          localApiAvailable={setupState?.capabilities?.cloudSidebarApi === true}
          forcedOpen={onboarding.active && ['cloud-rail', 'cloud-memories', 'cloud-sources'].includes(currentTourStep?.id)}
          forcedTab={forcedCloudTab}
          onOpenChange={setCloudSidebarOpen}
        />
        {onboarding.active && currentTourStep && (
          <Coachmark
            step={currentTourStep}
            stepIndex={onboarding.stepIndex}
            totalSteps={tourSteps.length}
            targetElement={tourTargetElement}
            onPrev={() => goToTourStep(-1)}
            onNext={() => goToTourStep(1)}
            onSkip={() => stopOnboarding({ dismissed: true, completed: false })}
            onPrimaryAction={handleTourPrimaryAction}
          />
        )}
      </div>
    </div>
  );
}
