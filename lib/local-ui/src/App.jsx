import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Header } from './shell/Header';
import { SettingsModal } from './settings/SettingsModal';
import { HomeView } from './home/HomeView';
import { Desktop } from './desktop/Desktop';
import { ReadingPanel } from './cards/ReadingPanel';
import { ArchiveView } from './archive/ArchiveView';
import { ProcessingTheater } from './sync/ProcessingTheater';
import {
  fetchFiles,
  fetchAllContents,
  fetchFileContent,
  saveFileContent,
  fetchAuthStatus,
  fetchSyncStatus,
  fetchBackendSources,
  fetchCloudMemories,
  fetchCloudSources,
  triggerSync,
  cancelSync,
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
  fetchEncryptionState,
  unlockEncryption,
  lockEncryption,
  setupEncryption,
} from './sync/api';
import { CloudMemoryLog } from './memory-log/CloudMemoryLog';
import { PassphraseModal } from './encryption/PassphraseModal';
import { PrivateConfirmModal } from './encryption/PrivateConfirmModal';
import { FileDiffModal } from './diff/FileDiffModal';
import { UpdatesPanel } from './diff/UpdatesPanel';
import { clearCache as clearCloudCache, readCache as readCloudCache, writeCache as writeCloudCache } from './memory-log/cloudCache';
import '@echomem/memory_log_ui/theme.css';
import '@echomem/memory_log_ui/styles.css';
import './styles/global.css';
import pluginPkg from '../../../package.json';

const UI_HEARTBEAT_INTERVAL_MS = 15000;
const OTP_LENGTH = 6;
const OTP_RESEND_SECONDS = 120;

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
  if (field.source === 'local_only_override') return 'local-only override';
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
  return String(rawPath).replace(/\\/g, '/').toLowerCase();
}

function buildSyncResultState(result) {
  // Run-level error (e.g. ENCRYPTION_LOCKED, missing key, scan failure):
  // sync.js returns the state with `error` set and `run_results: []`. The
  // per-file summary is all zeros, so without this branch the UI silently
  // shows "Sync complete" while nothing actually happened.
  if (result?.error) {
    return {
      ok: false,
      msg: String(result.error),
      errorCode: result?.error_code || null,
      failed: [],
    };
  }
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
  return { ok: failed.length === 0, msg, errorCode: null, failed };
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [contentMap, setContentMap] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [authStatus, setAuthStatus] = useState(null);
  const [encryptionState, setEncryptionState] = useState(null); // { connected, enabled, unlocked, salt, iterations }
  const [passphraseModalMode, setPassphraseModalMode] = useState(null); // null | 'unlock' | 'setup'
  // Pending private/sensitive sync — set when sync-selected returns 409 with
  // requiresConfirmation. Holds the selected paths and the server's
  // confirmable list so the modal can list which files trip the warning.
  const [pendingPrivateSync, setPendingPrivateSync] = useState(null);
  // Path of the file currently being viewed in the FileDiffModal. Set when
  // user opens a file flagged as `needsUserNotice: true` so they can see
  // exactly which sections changed before pushing the sync.
  const [diffModalPath, setDiffModalPath] = useState(null);
  // Whether the "X updates" panel (triaged list of files needing review)
  // is open. Triggered from the header badge.
  const [updatesPanelOpen, setUpdatesPanelOpen] = useState(false);
  // User's choice in the connect modal's mode picker. Lifted from SettingsModal
  // so handleVerifyOtp can branch on it: e2ee → open PassphraseModal in setup
  // mode immediately after a successful OTP. 'regular' → no follow-up (no E2EE).
  const [encryptionMode, setEncryptionMode] = useState('e2ee');
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);
  const [streamedMemories, setStreamedMemories] = useState([]);
  const [totalStreamedCount, setTotalStreamedCount] = useState(0);
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
  const [readingPath, setReadingPath] = useState(null);
  const [readingContent, setReadingContent] = useState(null);
  const [readingGroup, setReadingGroup] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveInitialFilter, setArchiveInitialFilter] = useState('all');
  const [justSynced, setJustSynced] = useState(false);
  const [canvasControls, setCanvasControls] = useState(null);
  const [cloudMemoryOpen, setCloudMemoryOpen] = useState(false);
  const [cloudMemoryStats, setCloudMemoryStats] = useState({ totalCount: 0, countWithSource: 0 });
  const [cloudMemories, setCloudMemories] = useState([]);
  const [cloudSources, setCloudSources] = useState([]);
  const [cloudMemoriesLoading, setCloudMemoriesLoading] = useState(false);
  const [cloudMemoriesError, setCloudMemoriesError] = useState(null);

  const serverInstanceIdRef = useRef(null);
  const clientIdRef = useRef(buildLocalUiClientId());
  const otpInputRefs = useRef([]);
  const syncedExpandedRef = useRef(null);

  const loadFiles = useCallback(async () => {
    try {
      const newFiles = await fetchFiles();
      setFiles(newFiles);
      fetchAllContents(newFiles)
        .then((contents) => setContentMap(contents))
        .catch(console.error);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const loadAuthStatus = useCallback(async () => {
    setAuthStatus(await fetchAuthStatus());
  }, []);

  const loadEncryptionState = useCallback(async () => {
    setEncryptionState(await fetchEncryptionState());
  }, []);

  const loadSyncStatus = useCallback(async () => {
    setSyncStatus(await fetchSyncStatus());
  }, []);

  const loadBackendSources = useCallback(async () => {
    const data = await fetchBackendSources();
    setBackendSources(data?.ok ? data : null);
  }, []);

  // Stale-While-Revalidate loader for the cloud memory log.
  //   force=false: paint from sessionStorage cache first (instant first frame),
  //                then re-fetch and overwrite.
  //   force=true:  skip the cache-paint; used after invalidateAndReloadCloud
  //                clears the cache (sync-complete, refresh button, future
  //                realtime events).
  // Cache is scoped per userId so an account switch can't leak data.
  const loadCloudData = useCallback(async ({ force = false } = {}) => {
    const userId = authStatus?.userId || null;
    if (!force) {
      const cached = readCloudCache(userId);
      if (cached) {
        setCloudMemories(cached.memories);
        setCloudSources(cached.sources);
        setCloudMemoryStats(cached.stats);
      }
    }
    setCloudMemoriesLoading(true);
    setCloudMemoriesError(null);
    try {
      const [memResult, srcResult] = await Promise.all([
        fetchCloudMemories(),
        fetchCloudSources(),
      ]);
      const memories = Array.isArray(memResult?.data) ? memResult.data : [];
      const sources = Array.isArray(srcResult?.data) ? srcResult.data : [];
      const parsedTotal = Number(memResult?.count);
      const parsedWithSource = Number(memResult?.countWithSource);
      const stats = {
        totalCount: Number.isFinite(parsedTotal) ? parsedTotal : memories.length,
        countWithSource: Number.isFinite(parsedWithSource) ? parsedWithSource : 0,
      };
      setCloudMemories(memories);
      setCloudSources(sources);
      setCloudMemoryStats(stats);
      writeCloudCache(userId, { memories, sources, stats });
    } catch (err) {
      setCloudMemoriesError(err?.message || 'Failed to load memories');
    } finally {
      setCloudMemoriesLoading(false);
    }
  }, [authStatus?.userId]);

  // Invalidation hook — call whenever server state is known to have changed
  // (sync finished, user pressed refresh, future realtime events). Clears
  // the cache then forces a fresh fetch. Idempotent.
  const invalidateAndReloadCloud = useCallback(() => {
    const userId = authStatus?.userId || null;
    clearCloudCache(userId);
    return loadCloudData({ force: true });
  }, [authStatus?.userId, loadCloudData]);

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
    await Promise.all([
      loadAuthStatus(),
      loadSyncStatus(),
      loadBackendSources(),
      loadSetupStatus(),
      loadEncryptionState(),
    ]);
  }, [loadAuthStatus, loadBackendSources, loadEncryptionState, loadSetupStatus, loadSyncStatus]);

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

  // UI presence heartbeat
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
    const intervalId = window.setInterval(() => sendPresence(true), UI_HEARTBEAT_INTERVAL_MS);
    window.addEventListener('beforeunload', sendInactivePresence);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('beforeunload', sendInactivePresence);
      sendPresence(false);
    };
  }, []);

  // OTP resend countdown
  useEffect(() => {
    if (resendCountdown <= 0) return undefined;
    const id = window.setInterval(() => {
      setResendCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendCountdown]);

  // Initial load + SSE
  useEffect(() => {
    loadFiles();
    loadAuthStatus();
    loadSyncStatus();
    loadBackendSources();
    loadSetupStatus();
    loadPluginUpdateStatus();
    loadEncryptionState();
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

        if (progress.latestMemory) {
          const mem = progress.latestMemory;
          setStreamedMemories((prev) => {
            const next = [...prev, mem];
            return next.length > 12 ? next.slice(next.length - 12) : next;
          });
          if (typeof progress.totalMemoriesStreamed === 'number') {
            setTotalStreamedCount(progress.totalMemoriesStreamed);
          } else {
            setTotalStreamedCount((n) => n + 1);
          }
        }

        if (progress.phase === 'started') {
          setSyncing(true);
          setStreamedMemories([]);
          setTotalStreamedCount(0);
          setCardSyncState(() => {
            const next = {};
            for (const path of progress.queuedRelativePaths || []) {
              next[path] = 'queued';
            }
            return next;
          });
          return;
        }

        if (progress.phase === 'file-started' || progress.phase === 'file-stage') {
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
            for (const path of progress.completedRelativePaths || []) {
              next[path] = recentStatus === 'failed' ? 'failed' : 'done';
            }
            for (const path of progress.failedRelativePaths || []) {
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

        if (progress.phase === 'finished' || progress.phase === 'stopped') {
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

  // Re-fetch encryption state when the connected userId changes — covers the
  // initial connect, OTP login, and account switches. Without this the
  // panel's lock pill would be stuck on the value from before the user
  // signed in.
  useEffect(() => {
    if (authStatus?.userId) loadEncryptionState();
  }, [authStatus?.userId, loadEncryptionState]);

  // Derived state
  // Set of relativePaths the backend flagged as `needsUserNotice: true` —
  // these files have updates that must NOT auto-sync; user has to click into
  // them to see what changed and trigger the sync explicitly. Used by the
  // file-click handler to route to the diff modal instead of the reader.
  const pendingUpdatePaths = useMemo(() => {
    const set = new Set();
    if (syncStatus?.fileStatuses) {
      for (const status of syncStatus.fileStatuses) {
        if (status.needsUserNotice) set.add(status.relativePath);
      }
    }
    return set;
  }, [syncStatus]);
  const pendingUpdateCount = pendingUpdatePaths.size;

  const syncMap = useMemo(() => {
    const next = {};
    if (syncStatus?.fileStatuses) {
      for (const status of syncStatus.fileStatuses) {
        if (status.status) next[status.relativePath] = status.status;
      }
    }
    if (backendSources?.sources) {
      const backendPaths = new Set(
        backendSources.sources.map((source) => normalizePathKey(source.filePath)).filter(Boolean),
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

  const readingFile = useMemo(
    () => files.find((file) => file.relativePath === readingPath) || null,
    [files, readingPath],
  );
  const hasApiKey = Boolean(setupDraft.apiKey);
  const isConnected = authStatus?.connected === true;
  const autoSyncEnabled = setupDraft.autoSync === true;
  const echoOnlyMemoryModeEnabled = setupDraft.disableOpenClawMemoryToolsWhenConnected === true;
  const authLabel = buildAuthLabel(authStatus, hasApiKey);
  const normalizedConnectEmail = normalizeEmailValue(connectEmail);
  const otpValue = otpDigits.join('');

  // Derive the 3-state encryption indicator the shared MemoryList consumes.
  // 'off'      — no cloud config (user has never set up E2EE)
  // 'locked'   — cloud config exists but plugin process has no derived key cached
  // 'unlocked' — plugin has key cached and can encrypt before upload
  const derivedEncryptionState = !encryptionState?.connected
    ? undefined
    : !encryptionState.enabled
      ? 'off'
      : encryptionState.unlocked
        ? 'unlocked'
        : 'locked';

  const handleRequestUnlock = useCallback(() => {
    setPassphraseModalMode('unlock');
  }, []);

  const handleRequestEncryptionSetup = useCallback(() => {
    setPassphraseModalMode('setup');
  }, []);

  // Setup is opt-in, never trapped — Skip closes the modal and drops the
  // user into Regular mode (no E2EE config touched). Distinct from Cancel
  // only in labeling: makes the off-ramp obvious so a user who reached
  // setup via the connect-flow E2EE pick can change their mind.
  const handleSkipEncryptionSetup = useCallback(() => {
    setPassphraseModalMode(null);
    setEncryptionMode('regular');
  }, []);

  const handlePassphraseSubmit = useCallback(async (passphrase) => {
    if (passphraseModalMode === 'setup') {
      await setupEncryption(passphrase);
    } else {
      await unlockEncryption(passphrase);
    }
    // Self-test before declaring the modal a success. If the gateway and
    // upstream don't agree that we're enabled+unlocked at this moment, the
    // operation is in a half-broken state — surface that as an error so the
    // user retries instead of believing E2EE is on when it isn't.
    const finalState = await fetchEncryptionState();
    if (!finalState?.connected || !finalState?.enabled || !finalState?.unlocked) {
      const reason = !finalState?.connected
        ? 'authentication lost'
        : !finalState?.enabled
          ? 'encryption config did not persist on the server'
          : 'derived key was not cached locally';
      throw new Error(`Encryption setup did not complete cleanly (${reason}). Please try again.`);
    }
    setEncryptionState(finalState);
    setPassphraseModalMode(null);
    // Flush the SWR cache and re-fetch — the ciphertext rows fetched while
    // locked are now stale; the gateway will return decrypted bodies once
    // it can use the cached key.
    invalidateAndReloadCloud();
  }, [invalidateAndReloadCloud, passphraseModalMode]);

  // Ready count gates the Sync CTA
  const readyCount = useMemo(() => {
    let ready = 0;
    for (const f of files) {
      if (!f?.relativePath) continue;
      const status = syncMap?.[f.relativePath];
      const isPrivate = f.riskLevel === 'secret' || f.riskLevel === 'private' || f.privacyLevel === 'private' || status === 'sealed';
      if (!isPrivate && status !== 'synced') ready++;
    }
    return ready;
  }, [files, syncMap]);

  const canSync = isConnected && readyCount > 0;

  useEffect(() => {
    if (!isConnected) {
      setCloudMemoryOpen(false);
      setCloudMemoryStats({ totalCount: 0, countWithSource: 0 });
      setCloudMemories([]);
      setCloudSources([]);
      setCloudMemoriesError(null);
      setCloudMemoriesLoading(false);
      return;
    }
    loadCloudData();
  }, [isConnected, loadCloudData]);

  // Lightweight polling for cross-device freshness while the panel is open.
  // Local sync events already invalidate + refetch (handleSyncProgress,
  // handleSyncSelected, handlePassphraseSubmit), but memories created on
  // *other* devices (Chrome extension, web) wouldn't otherwise show up
  // until the next manual action. 30s is a fair tradeoff between latency
  // and chatter — the SWR cache writes overwrite silently, so the only
  // visible effect is new rows appearing.
  useEffect(() => {
    if (!isConnected || !cloudMemoryOpen) return undefined;
    const intervalId = window.setInterval(() => {
      loadCloudData({ force: true });
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [isConnected, cloudMemoryOpen, loadCloudData]);

  const pluginVersion = pluginPkg?.version || '';
  const canTriggerPluginUpdate = Boolean(
    pluginUpdateState
    && pluginUpdateState.canUpdate !== false
    && (pluginUpdateState.updateAvailable || !pluginUpdateState.latestVersion),
  );

  // Handlers
  const openReadingFor = useCallback((path, context = null) => {
    if (!path) return;
    // If this file has a pending update flagged by backend (review/private
    // files that changed since last sync), route the user into the diff
    // modal instead of the regular reader. The user explicitly asked: don't
    // auto-replace, surface the changes, let them confirm via sync.
    if (pendingUpdatePaths.has(path)) {
      setDiffModalPath(path);
      return;
    }
    setReadingPath(path);
    if (context?.paths?.length) {
      const normalizedPaths = Array.from(new Set(context.paths.filter(Boolean)));
      setReadingGroup({
        paths: normalizedPaths,
        name: context.name || '',
        onRename: typeof context.onRename === 'function' ? context.onRename : null,
      });
    } else {
      setReadingGroup(null);
    }
    const existing = contentMap?.get?.(path);
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
  }, [contentMap, pendingUpdatePaths]);

  const openReadingPathInGroup = useCallback((path) => {
    openReadingFor(path, readingGroup);
  }, [openReadingFor, readingGroup]);

  const handleReadingSave = useCallback(async (nextContent) => {
    if (!readingPath) throw new Error('No file selected');
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
    try { await loadSyncStatus(); } catch {}
  }, [loadSyncStatus, readingPath]);

  const handleReadingGroupRename = useCallback((nextName) => {
    readingGroup?.onRename?.(nextName);
    setReadingGroup((prev) => (prev ? { ...prev, name: nextName } : prev));
  }, [readingGroup]);

  const handleSync = useCallback(async () => {
    setCloudMemoryOpen(false);
    setSyncing(true);
    setSyncResult(null);
    setSyncProgress(null);
    setStreamedMemories([]);
    setTotalStreamedCount(0);
    setJustSynced(false);
    try {
      const result = await triggerSync();
      const nextResult = buildSyncResultState(result);
      setSyncResult(nextResult);
      // Encryption is enabled but locked → guide the user straight into
      // the unlock modal instead of leaving them with a stale "Sync failed"
      // theater and no hint about what to do.
      if (nextResult.errorCode === 'ENCRYPTION_LOCKED') {
        setSyncProgress(null);
        setPassphraseModalMode('unlock');
      }
      loadSyncStatus();
      loadBackendSources();
      invalidateAndReloadCloud();
      if (nextResult.ok) {
        setJustSynced(true);
        window.setTimeout(() => setJustSynced(false), 1200);
      }
    } catch (error) {
      setSyncResult({ ok: false, msg: String(error?.message || 'Sync failed') });
    } finally {
      setSyncing(false);
    }
  }, [loadBackendSources, invalidateAndReloadCloud, loadSyncStatus]);

  // Shared core for both single-file and multi-file selected sync. Handles
  // the 409 requiresConfirmation soft-block: paths flagged private/sensitive
  // get hoisted into pendingPrivateSync so the PrivateConfirmModal can show,
  // and the actual upload re-runs after the user confirms.
  const runSyncSelected = useCallback(async (paths, { confirmPrivate = false } = {}) => {
    if (!Array.isArray(paths) || paths.length === 0) return;
    if (syncing) return;
    setCloudMemoryOpen(false);
    setSyncing(true);
    setSyncResult(null);
    setSyncProgress(null);
    setStreamedMemories([]);
    setTotalStreamedCount(0);
    try {
      const result = await triggerSyncSelected(paths, { confirmPrivate });
      const nextResult = buildSyncResultState(result);
      setSyncResult(nextResult);
      setPendingPrivateSync(null);
      // Same encryption-lock guard as handleSync: pop the unlock modal
      // when the run bails out because the key isn't cached.
      if (nextResult.errorCode === 'ENCRYPTION_LOCKED') {
        setSyncProgress(null);
        setPassphraseModalMode('unlock');
      }
      loadSyncStatus();
      loadBackendSources();
      invalidateAndReloadCloud();
    } catch (error) {
      // Server says: these paths are private/sensitive, the user has to
      // confirm before we extract. Park them and pop the confirm modal.
      if (error?.status === 409 && error?.payload?.requiresConfirmation) {
        setPendingPrivateSync({
          paths,
          confirmablePaths: error.payload.confirmablePaths || [],
        });
        return;
      }
      setSyncResult({ ok: false, msg: String(error?.message || 'Sync failed') });
    } finally {
      setSyncing(false);
    }
  }, [loadBackendSources, invalidateAndReloadCloud, loadSyncStatus, syncing]);

  const handleSyncFile = useCallback((relativePath) => {
    if (!relativePath) return;
    return runSyncSelected([relativePath]);
  }, [runSyncSelected]);

  const handleSyncSelected = useCallback((relativePaths) => {
    const paths = Array.isArray(relativePaths) ? relativePaths.filter(Boolean) : [];
    return runSyncSelected(paths);
  }, [runSyncSelected]);

  const handleConfirmPrivateSync = useCallback(() => {
    const pending = pendingPrivateSync;
    if (!pending) return;
    return runSyncSelected(pending.paths, { confirmPrivate: true });
  }, [pendingPrivateSync, runSyncSelected]);

  const handleCancelPrivateSync = useCallback(() => {
    setPendingPrivateSync(null);
  }, []);

  const handleSetupEncryptionFromConfirm = useCallback(() => {
    setPendingPrivateSync(null);
    setPassphraseModalMode('setup');
  }, []);

  const handleSyncFromDiff = useCallback(async (relativePath) => {
    if (!relativePath) return;
    setDiffModalPath(null);
    await runSyncSelected([relativePath]);
  }, [runSyncSelected]);

  const handleCloseDiffModal = useCallback(() => {
    setDiffModalPath(null);
  }, []);

  const handleOpenUpdatesPanel = useCallback(() => {
    setUpdatesPanelOpen(true);
  }, []);

  const handleCloseUpdatesPanel = useCallback(() => {
    setUpdatesPanelOpen(false);
  }, []);

  const handlePickUpdateFile = useCallback((relativePath) => {
    if (!relativePath) return;
    setUpdatesPanelOpen(false);
    setDiffModalPath(relativePath);
  }, []);

  const handleSetupFieldChange = useCallback((key, value) => {
    setSetupDraft((prev) => ({ ...prev, [key]: value }));
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
      const result = await saveSetupConfig({ ...setupDraft, apiKey: '' });
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
    // Defensive guard: state-driven button disable only takes effect after
    // React commits the next render. Rapid double-clicks (or Enter then
    // click) can queue two handlers before that lands. Without this bail,
    // the cloud /api/openclaw/v1/auth/send-otp route accepts both within
    // its 3-req/min window and Supabase issues two OTPs — the second
    // invalidates the first.
    if (emailConnectState === 'sending' || emailConnectState === 'verifying') return;
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
      setResendCountdown(OTP_RESEND_SECONDS);
      setEmailConnectState('otp_sent');
      window.requestAnimationFrame(() => focusOtpInput(0));
    } catch (error) {
      setConnectError(String(error?.message ?? error));
      setEmailConnectState('idle');
    }
  }, [clearOtpDigits, connectEmail, emailConnectState, focusOtpInput]);

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
      refreshSetupSurfaces().catch(console.error);
      loadFiles().catch(console.error);
      // Honor the mode the user picked on the privacy step. E2EE → push them
      // into PIN setup right away; the connect surface is dismissed so the
      // PassphraseModal becomes the focused step. Regular → connect ends here
      // with no encryption config touched (server stays on Echo-managed
      // encryption; no user_encryption_config row gets created without a PIN).
      //
      // Returning users may already have encryption enabled on this account
      // (set up from another device or a prior session). Calling
      // /api/encryption-setup against an already-enabled account 409s and
      // strands the modal in setup state with no way out. Probe fresh
      // encryption state and route to 'unlock' instead — they get to decrypt
      // their existing memories with the passphrase they already have.
      if (encryptionMode === 'e2ee') {
        setSettingsOpen(false);
        const fresh = await fetchEncryptionState().catch(() => null);
        if (fresh) setEncryptionState(fresh);
        if (fresh?.enabled) {
          if (!fresh.unlocked) setPassphraseModalMode('unlock');
        } else {
          setPassphraseModalMode('setup');
        }
      }
    } catch (error) {
      setConnectError(String(error?.message ?? error));
      setEmailConnectState('otp_sent');
    }
  }, [clearOtpDigits, connectEmail, encryptionMode, loadFiles, otpDigits, refreshSetupSurfaces, setupState?.envFile?.targetPath]);

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
      chars.forEach((char, offset) => { next[index + offset] = char; });
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
    digits.slice(0, OTP_LENGTH).split('').forEach((char, index) => { nextDigits[index] = char; });
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

  const lastSyncLabel = timeAgo(syncStatus?.lastSyncAt);
  const canvasHeaderControls = useMemo(() => {
    if (!canvasControls) return null;
    return {
      ...canvasControls,
      actions: {
        ...canvasControls.actions,
        toggleSync: () => {
          setCloudMemoryOpen(false);
          canvasControls.actions?.toggleSync?.();
        },
        toggleSelect: () => {
          setCloudMemoryOpen(false);
          canvasControls.actions?.toggleSelect?.();
        },
      },
    };
  }, [canvasControls]);

  return (
    <div className={`app-shell${isConnected && cloudMemoryOpen ? ' is-cloud-open' : ''}`}>
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isConnected={isConnected}
        authLabel={authLabel}
        lastSyncLabel={lastSyncLabel}
        cloudMemoryOpen={cloudMemoryOpen}
        cloudMemoryCount={cloudMemoryStats.totalCount}
        newMemoryCount={totalStreamedCount}
        pendingUpdateCount={pendingUpdateCount}
        onPendingUpdatesClick={handleOpenUpdatesPanel}
        canvasControls={readingPath ? null : canvasHeaderControls}
        onCloudMemoryClick={() => {
          if (!isConnected) {
            setSettingsOpen(true);
            return;
          }
          setCloudMemoryOpen((open) => {
            // Opening the panel = user acknowledged the pending new-memory
            // badge; clear it. (Closing the panel leaves it at zero, same.)
            if (!open) setTotalStreamedCount(0);
            return !open;
          });
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenArchive={(filter) => {
          setArchiveInitialFilter(filter || 'all');
          setArchiveOpen(true);
        }}
      />

      <div className="app-body">
        {/* Desktop (canvas) stays mounted so selected folder, camera, and sidebars
            survive a reading-panel round-trip. */}
        <div
          className="app-desktop-host"
          aria-hidden={!!readingPath}
        >
          <Desktop
            files={files}
            syncMap={syncMap}
            contentMap={contentMap}
            cardSyncState={cardSyncState}
            syncing={syncing}
            canSync={canSync}
            isConnected={isConnected}
            lastSyncLabel={lastSyncLabel}
            searchQuery={searchQuery}
            onCanvasControlsChange={setCanvasControls}
            onSync={handleSync}
            onSyncSelected={handleSyncSelected}
            onOpenCard={openReadingFor}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>
        {isConnected && cloudMemoryOpen && (
          <aside className="app-memory-log" aria-label="Cloud memory log">
            <CloudMemoryLog
              isAuthenticated={isConnected}
              memories={cloudMemories}
              sources={cloudSources}
              loading={cloudMemoriesLoading}
              error={cloudMemoriesError}
              totalCount={cloudMemoryStats.totalCount}
              countWithSource={cloudMemoryStats.countWithSource}
              onClose={() => setCloudMemoryOpen(false)}
              userLabel={authStatus?.email || null}
              onOpenSettings={() => setSettingsOpen(true)}
              encryptionState={derivedEncryptionState}
              onRequestUnlock={handleRequestUnlock}
              onOpenEncryptionSetup={handleRequestEncryptionSetup}
            />
          </aside>
        )}
      </div>
      {readingPath && (
        <main
          className="app-main app-main--reading"
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            setReadingPath(null);
            setReadingContent(null);
            setReadingGroup(null);
          }}
        >
          <ReadingPanel
            path={readingPath}
            content={readingContent ?? contentMap?.get?.(readingPath) ?? null}
            file={readingFile}
            syncStatus={syncMap?.[readingPath]}
            galleryFiles={(readingGroup?.paths || [])
              .map((groupPath) => files.find((candidate) => candidate.relativePath === groupPath))
              .filter(Boolean)}
            galleryTitle={readingGroup?.name || ''}
            onGalleryTitleChange={readingGroup?.onRename ? handleReadingGroupRename : null}
            onNavigateFile={openReadingPathInGroup}
            isConnected={isConnected}
            syncing={syncing}
            onSyncFile={handleSyncFile}
            onSave={handleReadingSave}
            onClose={() => {
              setReadingPath(null);
              setReadingContent(null);
              setReadingGroup(null);
            }}
          />
        </main>
      )}

      <ArchiveView
        open={archiveOpen}
        files={files}
        syncMap={syncMap}
        contentMap={contentMap}
        initialFilter={archiveInitialFilter}
        onClose={() => setArchiveOpen(false)}
        onFileClick={(path) => {
          setArchiveOpen(false);
          if (path) openReadingFor(path);
        }}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        isConnected={isConnected}
        hasApiKey={hasApiKey}
        authLabel={authLabel}
        emailConnectState={emailConnectState}
        connectEmail={connectEmail}
        onConnectEmailChange={(value) => { setConnectEmail(value); setConnectError(null); }}
        onSendOtp={handleSendOtp}
        otpDigits={otpDigits}
        onOtpDigitChange={handleOtpDigitChange}
        onOtpKeyDown={handleOtpKeyDown}
        onOtpPaste={handleOtpPaste}
        onVerifyOtp={handleVerifyOtp}
        otpValue={otpValue}
        otpLength={OTP_LENGTH}
        otpInputRefs={otpInputRefs}
        resendCountdown={resendCountdown}
        onResetQuickConnect={resetQuickConnect}
        connectError={connectError}
        encryptionMode={encryptionMode}
        onEncryptionModeChange={setEncryptionMode}
        onDisconnect={handleDisconnect}
        disconnecting={disconnecting}
        setupState={setupState}
        setupDraft={setupDraft}
        autoSyncEnabled={autoSyncEnabled}
        echoOnlyMemoryModeEnabled={echoOnlyMemoryModeEnabled}
        onSetupFieldChange={handleSetupFieldChange}
        onSetupSave={handleSetupSave}
        setupSaving={setupSaving}
        setupMessage={setupMessage}
        formatSourceLabel={formatSourceLabel}
        pluginVersion={pluginVersion}
        pluginUpdateState={pluginUpdateState}
        pluginUpdateLoading={pluginUpdateLoading}
        pluginUpdateBusy={pluginUpdateBusy}
        gatewayRestartBusy={gatewayRestartBusy}
        canTriggerPluginUpdate={canTriggerPluginUpdate}
        onLoadPluginUpdateStatus={loadPluginUpdateStatus}
        onPluginUpdate={handlePluginUpdate}
        onGatewayRestart={handleGatewayRestart}
        pluginUpdateMessage={pluginUpdateMessage}
        pluginPackageName={pluginUpdateState?.packageName || pluginPkg?.name}
        timeAgo={timeAgo}
      />

      <ProcessingTheater
        syncProgress={syncProgress}
        streamedMemories={streamedMemories}
        totalStreamedCount={totalStreamedCount}
        onDismiss={() => {
          // Theater dismiss only tears down the theater itself — the
          // "+N new memories" badge on the header stays lit until the
          // user opens the cloud memory panel (see onCloudMemoryClick).
          setSyncProgress(null);
          setStreamedMemories([]);
        }}
        onStop={async () => {
          try { await cancelSync(); } catch { /* server already idle / restarted */ }
        }}
        onOpenTimeline={() => {
          window.open('https://iditor.com/memories/timeline?mode=photo-first', '_blank', 'noopener,noreferrer');
        }}
      />

      {syncResult && !syncResult.ok && (
        <div className="sync-toast sync-toast--error" role="alert">{syncResult.msg}</div>
      )}

      <PassphraseModal
        open={passphraseModalMode !== null}
        mode={passphraseModalMode}
        onSubmit={handlePassphraseSubmit}
        onCancel={() => setPassphraseModalMode(null)}
        onSkip={handleSkipEncryptionSetup}
        existingCloudCount={cloudMemoryStats.totalCount || 0}
      />

      <PrivateConfirmModal
        open={pendingPrivateSync !== null}
        encryptionState={derivedEncryptionState}
        confirmablePaths={pendingPrivateSync?.confirmablePaths || []}
        onConfirm={handleConfirmPrivateSync}
        onCancel={handleCancelPrivateSync}
        onSetupEncryption={derivedEncryptionState === 'off' ? handleSetupEncryptionFromConfirm : null}
        busy={syncing}
      />

      <FileDiffModal
        open={diffModalPath !== null}
        relativePath={diffModalPath}
        onClose={handleCloseDiffModal}
        onSync={handleSyncFromDiff}
        syncing={syncing}
      />

      <UpdatesPanel
        open={updatesPanelOpen}
        fileStatuses={syncStatus?.fileStatuses}
        onClose={handleCloseUpdatesPanel}
        onPickFile={handlePickUpdateFile}
      />
    </div>
  );
}
