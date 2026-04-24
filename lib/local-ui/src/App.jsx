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
  return { ok: failed.length === 0, msg, failed };
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [contentMap, setContentMap] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [authStatus, setAuthStatus] = useState(null);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveInitialFilter, setArchiveInitialFilter] = useState('all');
  const [justSynced, setJustSynced] = useState(false);

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

  // Derived state
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

  const pluginVersion = pluginPkg?.version || '';
  const canTriggerPluginUpdate = Boolean(
    pluginUpdateState
    && pluginUpdateState.canUpdate !== false
    && (pluginUpdateState.updateAvailable || !pluginUpdateState.latestVersion),
  );

  // Handlers
  const openReadingFor = useCallback((path) => {
    if (!path) return;
    setReadingPath(path);
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
  }, [contentMap]);

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

  const handleSync = useCallback(async () => {
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
      loadSyncStatus();
      loadBackendSources();
      if (nextResult.ok) {
        setJustSynced(true);
        window.setTimeout(() => setJustSynced(false), 1200);
      }
    } catch (error) {
      setSyncResult({ ok: false, msg: String(error?.message || 'Sync failed') });
    } finally {
      setSyncing(false);
    }
  }, [loadBackendSources, loadSyncStatus]);

  const handleSyncFile = useCallback(async (relativePath) => {
    if (!relativePath || syncing) return;
    setSyncing(true);
    setSyncResult(null);
    setSyncProgress(null);
    setStreamedMemories([]);
    setTotalStreamedCount(0);
    try {
      const result = await triggerSyncSelected([relativePath]);
      const nextResult = buildSyncResultState(result);
      setSyncResult(nextResult);
      loadSyncStatus();
      loadBackendSources();
    } catch (error) {
      setSyncResult({ ok: false, msg: String(error?.message || 'Sync failed') });
    } finally {
      setSyncing(false);
    }
  }, [loadBackendSources, loadSyncStatus, syncing]);

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
      refreshSetupSurfaces().catch(console.error);
      loadFiles().catch(console.error);
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

  return (
    <div className="app-shell">
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isConnected={isConnected}
        authLabel={authLabel}
        lastSyncLabel={lastSyncLabel}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenArchive={(filter) => {
          setArchiveInitialFilter(filter || 'all');
          setArchiveOpen(true);
        }}
      />

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
          onSync={handleSync}
          onOpenCard={openReadingFor}
        />
      </div>
      {readingPath && (
        <main className="app-main app-main--reading">
          <ReadingPanel
            path={readingPath}
            content={readingContent ?? contentMap?.get?.(readingPath) ?? null}
            file={readingFile}
            syncStatus={syncMap?.[readingPath]}
            isConnected={isConnected}
            syncing={syncing}
            onSyncFile={handleSyncFile}
            onSave={handleReadingSave}
            onClose={() => {
              setReadingPath(null);
              setReadingContent(null);
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
          setSyncProgress(null);
          setStreamedMemories([]);
          setTotalStreamedCount(0);
        }}
        onOpenTimeline={() => {
          window.open('https://iditor.com/memories/timeline?mode=photo-first', '_blank', 'noopener,noreferrer');
        }}
      />

      {syncResult && !syncResult.ok && (
        <div className="sync-toast sync-toast--error" role="alert">{syncResult.msg}</div>
      )}
    </div>
  );
}
