import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { App as CapacitorApp, type URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

import { AppNavigation, type MobileView } from './AppNavigation';
import { normalizeDeviceSyncEndpoint } from '@shared/sync/deviceProtocol';
import { parseDeviceToken } from '@shared/sync/v2Protocol';
import { classifySyncV2Error } from '@shared/sync/v2ClientError';
import type { LiveFocusCommand, LiveFocusSnapshotResponse } from '@shared/sync/liveFocusProtocol';
import {
  reconcileTaskSnapshot,
  type SyncedTask,
  type TaskSnapshotResponse,
} from '@shared/sync/taskSnapshotProtocol';
import {
  clearCachedLiveFocusSnapshot,
  clearCachedTaskSnapshot,
  clearMobileCache,
  createOfflineFocusRuntime,
  readCachedLiveFocusSnapshot,
  readCachedTaskSnapshot,
  readMobileCache,
  readOfflineFocusRuntime,
  readLocalSessionSyncMeta,
  readPendingDeviceSyncBundles,
  writeLocalSessionSyncMeta,
  writeOfflineFocusRuntime,
  writeCachedLiveFocusSnapshot,
  writeCachedTaskSnapshot,
  type MobileCacheSnapshot,
  type LocalSessionSyncMeta,
  type MobileAuthorityMode,
} from './cache';
import {
  finishOfflineFocus,
  offlineRuntimeSnapshot,
  pauseOfflineFocus,
  resumeOfflineFocus,
  startOfflineFocus,
  type OfflineFocusRuntime,
} from './offlineFocusRuntime';
import { ConnectionSheet } from './ConnectionSheet';
import { DashboardView } from './DashboardView';
import {
  FocusConsole,
  type MobileFocusCommand,
  type NativeFocusConsoleControls,
} from './FocusConsole';
import {
  completeNativeFocusCommands,
  configureNativeFocusConnection,
  clearNativeFocusConnection,
  drainNativeFocusCommands,
  enterNativePictureInPicture,
  isNativeFocusRuntimeAvailable,
  readNativeFocusConnectionState,
  readNativeFocusStatus,
  restoreNativeFocusConnectionState,
  restoreOrMigrateNativeFocusConnection,
  setNativeImmersiveSystemBars,
  subscribeToNativeFocusCommands,
  updateNativeAuthorityProjectionHistory,
  updateNativeFocusSnapshot,
  type NativeFocusConnectionState,
  type NativeFocusCommand,
} from './nativeFocusRuntime';
import {
  clearMobileAccountProfile,
  clearSavedToken,
  getOrCreateDeviceId,
  getOrCreateInstallationId,
  loadMobileAccountProfile,
  loadConnectionPreferences,
  persistMobileAccountSessionBestEffort,
  type MobileConnectionPreferences,
} from './preferences';
import {
  idleLiveFocusSnapshot as makeIdleSnapshot,
  type LiveConnectionState,
  type LiveFocusSnapshotLike,
} from './runtimeModel';
import { SettingsView } from './SettingsView';
import {
  applyMobileAppearance,
  loadMobileAppearance,
  saveMobileAppearance,
  type MobileAppearance,
} from './appearance';
import {
  fetchLiveFocusSnapshot,
  fetchTaskSnapshot,
  sendLiveFocusCommand,
  waitForLiveFocusSnapshot,
} from './syncClient';
import {
  isOwnerAccountCallback,
  invalidateOwnerAccountBootstrap,
  OFFICIAL_FOCUSLINK_ENDPOINT,
  openOwnerLogin,
  ownerAccountBootstrapApi,
  type OwnerAccountSession,
} from './accountBootstrap';
import {
  createMobileAccountLifecycle,
  createMobileAccountRequestLifecycle,
  mobileAccountConnectionKey,
  runMobileAccountCommit,
  runMobileAccountLogout,
} from './accountLifecycle';
import { TaskBrowser } from './TaskBrowser';
import { MobileConfirmDialog } from './MobileConfirmDialog';
import {
  commandAckNotice,
  nativeCommandAckNotice,
  restoreCachedLiveSnapshot,
  shouldApplyLiveSnapshot,
  type LiveSnapshotSource,
} from './liveSnapshotPolicy';
import { remoteForkEvidence } from './authorityPolicy';
import { runMobileSyncV2 } from './v2Sync';
import { readMobileV2Bootstrap } from './v2Cache';
import { persistCompletedOfflineFocus } from './offlineCompletion';
import {
  createTaskSnapshotRequestLifecycle,
  startVisibleTaskSnapshotRefresh,
} from './taskSnapshotRefresh';

type PullState = 'idle' | 'pulling' | 'confirmed' | 'error';

const EMPTY_CACHE: MobileCacheSnapshot = {
  bundles: [],
  cursor: null,
  lastSyncAt: null,
  serverTime: null,
};

export function MobileApp() {
  const initialPreferences = useRef(loadConnectionPreferences()).current;
  const initialConnectionConfigured = useRef(
    Boolean(initialPreferences.endpoint && initialPreferences.token),
  ).current;
  const [preferences, setPreferences] = useState(initialPreferences);
  const [accountProfile, setAccountProfile] = useState(() => loadMobileAccountProfile());
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountLoginPolling, setAccountLoginPolling] = useState(false);
  const [cache, setCache] = useState<MobileCacheSnapshot>(EMPTY_CACHE);
  const [cacheReady, setCacheReady] = useState(false);
  // Android ships with a loopback endpoint default, so endpoint presence alone
  // does not mean the device is paired. Keep the first-run pairing entry
  // reachable whenever either half of the credential is missing.
  const [configOpen, setConfigOpen] = useState(() => !initialConnectionConfigured);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pullState, setPullState] = useState<PullState>('idle');
  const [ledgerNotice, setLedgerNotice] = useState('正在读取本机会话账本…');
  const [liveSnapshot, setLiveSnapshot] = useState<LiveFocusSnapshotLike | null>(null);
  const [liveConnection, setLiveConnection] = useState<LiveConnectionState>(
    initialPreferences.endpoint && initialPreferences.token ? 'connecting' : 'unconfigured',
  );
  const [titleDraft, setTitleDraft] = useState('');
  const [taskSnapshot, setTaskSnapshot] = useState<TaskSnapshotResponse | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [pendingCommand, setPendingCommand] = useState<MobileFocusCommand | null>(null);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [activeView, setActiveView] = useState<MobileView>('focus');
  const [liveSnapshotSource, setLiveSnapshotSource] = useState<LiveSnapshotSource>('none');
  const [offlineRuntime, setOfflineRuntime] = useState<OfflineFocusRuntime | null>(null);
  const [authorityMode, setAuthorityMode] = useState<MobileAuthorityMode>('cloud-live');
  const [pendingUploadCount, setPendingUploadCount] = useState(0);
  const [appearance, setAppearance] = useState<MobileAppearance>(() => loadMobileAppearance());
  const [clearCacheDialogOpen, setClearCacheDialogOpen] = useState(false);
  const [nativeSystemControls, setNativeSystemControls] = useState<NativeFocusConsoleControls>(
    () => ({
      available: isNativeFocusRuntimeAvailable(),
      immersiveSystemBars: false,
      pictureInPictureSupported: false,
      pictureInPictureActive: false,
      busy: null,
    }),
  );

  const [deviceId, setDeviceId] = useState(() => getOrCreateDeviceId());
  const [nativeConnectionLease, setNativeConnectionLease] = useState<string | null>(null);
  const preferencesRef = useRef(preferences);
  const cacheRef = useRef(cache);
  const liveSnapshotRef = useRef(liveSnapshot);
  const taskSnapshotRef = useRef<TaskSnapshotResponse | null>(null);
  const offlineRuntimeRef = useRef<OfflineFocusRuntime | null>(null);
  const authorityModeRef = useRef<MobileAuthorityMode>('cloud-live');
  const liveConnectionRef = useRef(liveConnection);
  const pendingCommandRef = useRef<MobileFocusCommand | null>(null);
  const ledgerRequest = useRef<AbortController | null>(null);
  const ledgerGeneration = useRef(0);
  const liveRequest = useRef<AbortController | null>(null);
  const liveGeneration = useRef(0);
  const taskRequests = useRef(createTaskSnapshotRequestLifecycle()).current;
  const commandRequests = useRef(createMobileAccountRequestLifecycle()).current;
  const cacheMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const nativeQueueRunning = useRef(false);
  const nativeConnectionLeaseRef = useRef<string | null>(null);
  const lastResumeRefreshAt = useRef(0);
  const connectionKeyRef = useRef(mobileAccountConnectionKey(initialPreferences));
  const accountLifecycle = useRef(createMobileAccountLifecycle()).current;

  const commitNativeConnectionLease = useCallback((lease: string | null) => {
    nativeConnectionLeaseRef.current = lease;
    setNativeConnectionLease(lease);
  }, []);

  const resetTaskSnapshotForAccount = useCallback(async (): Promise<string[]> => {
    taskRequests.invalidate();
    taskSnapshotRef.current = null;
    setTaskSnapshot(null);
    setSelectedTaskId('');
    setTitleDraft('');
    try {
      await enqueueMutation(cacheMutationQueue, clearCachedTaskSnapshot);
      return [];
    } catch {
      return ['task-cache'];
    }
  }, [taskRequests]);

  const resetLiveSnapshotForAccount = useCallback(async (): Promise<string[]> => {
    commandRequests.invalidate();
    pendingCommandRef.current = null;
    setPendingCommand(null);
    liveGeneration.current += 1;
    liveRequest.current?.abort();
    liveRequest.current = null;
    liveSnapshotRef.current = null;
    setLiveSnapshot(null);
    setLiveSnapshotSource('none');
    try {
      await enqueueMutation(cacheMutationQueue, clearCachedLiveFocusSnapshot);
      return [];
    } catch {
      return ['live-cache'];
    }
  }, [commandRequests]);

  const resetAccountScopedState = useCallback(async (): Promise<string[]> => {
    ledgerGeneration.current += 1;
    ledgerRequest.current?.abort();
    ledgerRequest.current = null;
    cacheRef.current = EMPTY_CACHE;
    setCache(EMPTY_CACHE);
    setPendingUploadCount(0);
    setPullState('idle');
    setLedgerNotice('账号已切换，正在重新读取同步账本…');
    const [taskIssues, liveIssues] = await Promise.all([
      resetTaskSnapshotForAccount(),
      resetLiveSnapshotForAccount(),
    ]);
    return [...taskIssues, ...liveIssues];
  }, [resetLiveSnapshotForAccount, resetTaskSnapshotForAccount]);

  useEffect(
    () => () => {
      accountLifecycle.invalidate();
      invalidateOwnerAccountBootstrap();
      commandRequests.invalidate();
    },
    [accountLifecycle, commandRequests],
  );

  useEffect(() => {
    applyMobileAppearance(appearance);
    saveMobileAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    if (!isNativeFocusRuntimeAvailable()) return;
    const operation = accountLifecycle.issue();
    let disposed = false;
    const legacyPreferences = preferencesRef.current;
    void accountLifecycle
      .enqueueNative(() =>
        restoreOrMigrateNativeFocusConnection(
          legacyPreferences.endpoint && legacyPreferences.token
            ? {
                endpoint: normalizeDeviceSyncEndpoint(legacyPreferences.endpoint),
                accessToken: legacyPreferences.token,
                deviceId,
              }
            : null,
        ),
      )
      .then(async (connection) => {
        if (disposed || !accountLifecycle.isCurrent(operation) || !connection) return;
        const next: MobileConnectionPreferences = {
          endpoint: normalizeDeviceSyncEndpoint(connection.endpoint),
          token: connection.accessToken,
          rememberToken: true,
        };
        let accountStateIssues: string[] = [];
        if (mobileAccountConnectionKey(next) !== connectionKeyRef.current) {
          connectionKeyRef.current = mobileAccountConnectionKey(next);
          accountStateIssues = await resetAccountScopedState();
        }
        if (disposed || !accountLifecycle.isCurrent(operation)) return;
        // The helper has confirmed the Keystore copy. Keep the token only in
        // React memory and now remove any legacy browser remnants.
        const persistenceIssues = persistMobileAccountSessionBestEffort(next, connection.deviceId);
        commitNativeConnectionLease(connection.connectionLease);
        setDeviceId(connection.deviceId);
        preferencesRef.current = next;
        connectionKeyRef.current = mobileAccountConnectionKey(next);
        setPreferences(next);
        setConfigOpen(false);
        setConnectionEpoch((value) => value + 1);
        if (persistenceIssues.length > 0 || accountStateIssues.length > 0) {
          setCommandNotice('账号已从 Android 安全存储恢复，但本机资料持久化仍需下次重试');
        }
      })
      .catch((error) => {
        if (!disposed && accountLifecycle.isCurrent(operation)) {
          setCommandNotice(`Android 安全凭据恢复失败：${errorMessage(error)}`);
        }
      });
    return () => {
      disposed = true;
    };
  }, [accountLifecycle, commitNativeConnectionLease, deviceId, resetAccountScopedState]);

  const applyOwnerAccountSession = useCallback(
    async (session: OwnerAccountSession, operation: number): Promise<boolean> => {
      const endpoint = normalizeDeviceSyncEndpoint(session.endpoint);
      const routed = parseDeviceToken(session.accessToken.trim());
      if (
        endpoint !== OFFICIAL_FOCUSLINK_ENDPOINT ||
        !routed ||
        routed.accountPublicId !== session.accountId ||
        `device-${routed.devicePublicId}` !== session.deviceId
      ) {
        throw new Error('登录服务返回的设备身份无效');
      }
      const next: MobileConnectionPreferences = {
        endpoint,
        token: session.accessToken.trim(),
        rememberToken: true,
      };
      const transition = await runMobileAccountCommit(
        accountLifecycle,
        operation,
        {
          read: readNativeFocusConnectionState,
          async mutate(baseline): Promise<NativeFocusConnectionState> {
            const connection = await configureNativeFocusConnection(
              next.endpoint,
              next.token,
              session.deviceId,
              baseline.connectionLease,
            );
            return {
              connection,
              connectionLease: connection?.connectionLease ?? null,
            };
          },
          async restore(baseline, applied) {
            const restored = await restoreNativeFocusConnectionState(
              baseline,
              applied.connectionLease,
            );
            commitNativeConnectionLease(restored.connectionLease);
          },
        },
        resetAccountScopedState,
      );
      if (!transition.current) return false;
      commitNativeConnectionLease(transition.nativeState?.connectionLease ?? null);
      const profile = {
        accountId: session.accountId,
        accountLabel: session.accountLabel,
      };
      const persistenceIssues = [
        ...transition.issues,
        ...persistMobileAccountSessionBestEffort(next, session.deviceId, profile),
      ];
      setDeviceId(session.deviceId);
      preferencesRef.current = next;
      connectionKeyRef.current = mobileAccountConnectionKey(next);
      setPreferences(next);
      setAccountProfile(profile);
      setConfigOpen(false);
      setConnectionEpoch((value) => value + 1);
      setCommandNotice(
        persistenceIssues.length > 0
          ? '账号已登录，但本机资料持久化失败；当前会话继续同步并将在下次启动重试'
          : '账号已登录，正在同步这台设备',
      );
      return true;
    },
    [accountLifecycle, commitNativeConnectionLease, resetAccountScopedState],
  );

  const bootstrapOwnerAccount = useCallback(
    async (callbackUrl?: string, polling = false) => {
      const operation = accountLifecycle.issue();
      setAccountBusy(true);
      setCommandNotice(callbackUrl ? '正在完成登录…' : '正在登录 FocusLink 账号…');
      try {
        const result = await ownerAccountBootstrapApi().bootstrap({
          installationId: getOrCreateInstallationId(),
          deviceKind:
            window.innerWidth >= 600 ? 'tablet' : Capacitor.isNativePlatform() ? 'phone' : 'web',
          displayName: Capacitor.isNativePlatform() ? 'FocusLink Android' : 'FocusLink Web',
          callbackUrl,
        });
        if (!accountLifecycle.isCurrent(operation)) return;
        if (result.status === 'login-required') {
          if (!polling) await openOwnerLogin(result.loginUrl);
          if (!accountLifecycle.isCurrent(operation)) return;
          setAccountLoginPolling(true);
          setCommandNotice('已打开授权网页，请在网页中完成登录与批准，会自动继续');
          return;
        }
        if (result.status === 'waiting-for-phone') {
          setAccountLoginPolling(true);
          setCommandNotice('请在系统浏览器中完成授权确认，如未弹出请重新点击登录');
          return;
        }
        setAccountLoginPolling(false);
        await applyOwnerAccountSession(result.session, operation);
      } catch (error) {
        if (!accountLifecycle.isCurrent(operation) || isAbortError(error)) return;
        setAccountLoginPolling(false);
        setCommandNotice(errorMessage(error));
        liveConnectionRef.current = 'error';
        setLiveConnection('error');
      } finally {
        if (accountLifecycle.isCurrent(operation)) setAccountBusy(false);
      }
    },
    [accountLifecycle, applyOwnerAccountSession],
  );

  useEffect(() => {
    if (!accountLoginPolling || accountBusy || (preferences.endpoint && preferences.token)) return;
    const timer = window.setTimeout(() => void bootstrapOwnerAccount(undefined, true), 1_500);
    return () => window.clearTimeout(timer);
  }, [
    accountBusy,
    accountLoginPolling,
    bootstrapOwnerAccount,
    preferences.endpoint,
    preferences.token,
  ]);

  useEffect(() => {
    let disposed = false;
    let removeListener: (() => Promise<void>) | undefined;
    const acceptAccountCallback = (rawUrl: string) => {
      if (disposed || !isOwnerAccountCallback(rawUrl)) return;
      setConfigOpen(true);
      void bootstrapOwnerAccount(rawUrl);
    };
    void CapacitorApp.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      acceptAccountCallback(event.url);
    }).then((handle) => {
      if (disposed) void handle.remove();
      else removeListener = () => handle.remove();
    });
    void CapacitorApp.getLaunchUrl().then((result) => {
      if (!disposed && result?.url) acceptAccountCallback(result.url);
    });
    return () => {
      disposed = true;
      if (removeListener) void removeListener();
    };
  }, [bootstrapOwnerAccount]);

  const setConnectionState = useCallback((state: LiveConnectionState) => {
    liveConnectionRef.current = state;
    setLiveConnection(state);
  }, []);

  const commitLiveSnapshot = useCallback(
    async (
      response: LiveFocusSnapshotResponse,
      sourceConnectionKey: string,
    ): Promise<LiveFocusSnapshotLike | null> => {
      if (connectionKeyRef.current !== sourceConnectionKey) return null;
      const mapped = mapLiveSnapshot(response, Date.now());
      const localRuntime = offlineRuntimeRef.current;
      if (localRuntime) {
        const evidence = remoteForkEvidence(mapped, localRuntime.id);
        const mode: MobileAuthorityMode = evidence ? 'forked-local' : 'local-offline';
        authorityModeRef.current = mode;
        setAuthorityMode(mode);
        if (evidence) {
          const existing = await readLocalSessionSyncMeta(localRuntime.id);
          const meta: LocalSessionSyncMeta = {
            sessionId: localRuntime.id,
            authorityMode: 'forked-local',
            originDeviceId: existing?.originDeviceId ?? deviceId,
            baseCloudRevision: existing?.baseCloudRevision ?? null,
            suspectedRemoteSessionId: evidence.sessionId,
            detectedRemoteRevision: evidence.revision,
            detectedAt: evidence.detectedAt,
          };
          await writeLocalSessionSyncMeta(meta);
          setCommandNotice('本机离线会话正在运行；其他设备另有云端活动会话，两者将分别入账');
        }
        return liveSnapshotRef.current;
      }
      const current = liveSnapshotRef.current;
      if (!shouldApplyLiveSnapshot(current, mapped)) return current;
      liveSnapshotRef.current = mapped;
      setLiveSnapshot(mapped);
      setLiveSnapshotSource('server');
      try {
        const accountId = mobileAccountId(preferencesRef.current);
        if (accountId) {
          await enqueueMutation(cacheMutationQueue, () =>
            writeCachedLiveFocusSnapshot(mapped, accountId),
          );
        }
      } catch (error) {
        setCommandNotice(`实时状态已更新，但本机缓存失败：${errorMessage(error)}`);
      }
      return mapped;
    },
    [deviceId],
  );

  const refreshTasks = useCallback(
    async (connection: MobileConnectionPreferences) => {
      const request = taskRequests.issue(mobileAccountConnectionKey(connection));
      try {
        const response = await fetchTaskSnapshot({
          endpoint: connection.endpoint,
          token: connection.token,
          signal: request.signal,
        });
        if (!request.isCurrent()) return;
        const reconciliation = reconcileTaskSnapshot(taskSnapshotRef.current, response);
        if (reconciliation.freshness === 'stale') return;
        if (reconciliation.freshness === 'inconsistent') {
          setCommandNotice('任务清单 revision 内容不一致，已保留本机较可信快照并继续重试');
          return;
        }
        taskSnapshotRef.current = reconciliation.snapshot;
        setTaskSnapshot(reconciliation.snapshot);
        const accountId = mobileAccountId(connection);
        await enqueueMutation(cacheMutationQueue, async () => {
          if (request.isCurrent() && accountId) {
            await writeCachedTaskSnapshot(reconciliation.snapshot, accountId);
          }
        });
      } catch (error) {
        if (!request.isCurrent() || isAbortError(error)) return;
        setCommandNotice(
          (current) => current ?? `任务清单刷新失败：${errorMessage(error)}；继续使用本机缓存`,
        );
      } finally {
        request.finish();
      }
    },
    [taskRequests],
  );

  const pullLedger = useCallback(
    async (connection: MobileConnectionPreferences, _startCursor: string | null) => {
      const sourceConnectionKey = mobileAccountConnectionKey(connection);
      const sourceNativeLease = nativeConnectionLease;
      ledgerRequest.current?.abort();
      const controller = new AbortController();
      const generation = ledgerGeneration.current + 1;
      ledgerGeneration.current = generation;
      ledgerRequest.current = controller;
      setPullState('pulling');
      setLedgerNotice('正在拉取已结束会话账本…');

      const isCurrent = () =>
        ledgerGeneration.current === generation &&
        ledgerRequest.current === controller &&
        connectionKeyRef.current === sourceConnectionKey &&
        !controller.signal.aborted;

      try {
        const attemptedAt = Date.now();
        const synced = await runMobileSyncV2({
          endpoint: connection.endpoint,
          token: connection.token,
          deviceId,
          signal: controller.signal,
        });
        if (!isCurrent()) return;
        const snapshot = await readMobileCache();
        if (!isCurrent()) return;
        const pending = await readPendingDeviceSyncBundles();
        if (!isCurrent()) return;
        const confirmedAt = Date.now();
        await updateNativeAuthorityProjectionHistory({
          deviceId,
          connectionLease: sourceNativeLease,
          records: snapshot.bundles,
          lastVerifiedAt: confirmedAt,
          lastAttemptAt: attemptedAt,
          pendingCount: pending.length + synced.unresolvedConflicts,
          lastErrorCode: '',
        }).catch(() => false);
        if (!isCurrent()) return;
        setPendingUploadCount(pending.length + synced.unresolvedConflicts);
        cacheRef.current = snapshot;
        setCache(snapshot);
        setPullState('confirmed');
        setLedgerNotice(
          synced.downloaded > 0 || synced.uploaded > 0
            ? `账本同步已确认：补传 ${synced.uploaded}，处理 ${synced.downloaded} 条变更，现有 ${snapshot.bundles.length} 场会话`
            : `账本同步已确认：没有新变更，保留 ${snapshot.bundles.length} 场会话`,
        );
      } catch (error) {
        if (!isCurrent() || isAbortError(error)) return;
        const pending = await readPendingDeviceSyncBundles().catch(() => []);
        if (!isCurrent()) return;
        await updateNativeAuthorityProjectionHistory({
          deviceId,
          connectionLease: sourceNativeLease,
          records: cacheRef.current.bundles,
          lastVerifiedAt: cacheRef.current.lastSyncAt,
          lastAttemptAt: Date.now(),
          pendingCount: pending.length,
          lastErrorCode: classifySyncV2Error(error),
        }).catch(() => false);
        if (!isCurrent()) return;
        setPullState('error');
        setLedgerNotice(
          cacheRef.current.bundles.length > 0
            ? `${errorMessage(error)}；已结束账本继续显示本机缓存`
            : errorMessage(error),
        );
      } finally {
        if (ledgerRequest.current === controller) ledgerRequest.current = null;
      }
    },
    [deviceId, nativeConnectionLease],
  );

  useEffect(() => {
    preferencesRef.current = preferences;
    connectionKeyRef.current = mobileAccountConnectionKey(preferences);
    // A non-remembered WebView token lives in sessionStorage and can disappear when
    // Android reclaims the renderer. That must not silently erase the encrypted native
    // connection which still powers an active notification. Explicit token removal and
    // cache reset paths clear the native connection themselves.
  }, [preferences]);

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  useEffect(() => {
    let active = true;
    const generation = ledgerGeneration.current;
    const taskCacheGeneration = taskRequests.generation();
    const cachePreferences = preferencesRef.current;
    const cacheAccountId = mobileAccountId(cachePreferences);
    const cacheConnectionKey = mobileAccountConnectionKey(cachePreferences);
    const cacheConnectionConfigured = Boolean(
      cachePreferences.endpoint && cachePreferences.token && cacheAccountId,
    );
    void Promise.all([
      readMobileCache(),
      readCachedLiveFocusSnapshot(cacheAccountId),
      readCachedTaskSnapshot(cacheAccountId),
      readOfflineFocusRuntime(),
      readPendingDeviceSyncBundles(),
      readMobileV2Bootstrap(),
    ])
      .then(
        ([
          storedLedger,
          cachedLive,
          cachedTasks,
          savedOfflineRuntime,
          pendingUploads,
          checkpoint,
        ]) => {
          if (
            !active ||
            ledgerGeneration.current !== generation ||
            connectionKeyRef.current !== cacheConnectionKey
          ) {
            return;
          }
          const ledger =
            !cacheConnectionConfigured || checkpoint?.boundAccountId === cacheAccountId
              ? storedLedger
              : EMPTY_CACHE;
          void updateNativeAuthorityProjectionHistory({
            deviceId,
            connectionLease: nativeConnectionLease,
            records: ledger.bundles,
            lastVerifiedAt: ledger.lastSyncAt,
            lastAttemptAt: ledger.lastSyncAt ?? 0,
            pendingCount: pendingUploads.length,
            lastErrorCode: '',
          }).catch(() => false);
          cacheRef.current = ledger;
          setCache(ledger);
          const restoredLive = savedOfflineRuntime
            ? offlineRuntimeSnapshot(savedOfflineRuntime, deviceId)
            : restoreCachedLiveSnapshot(cachedLive, cacheConnectionConfigured);
          if (savedOfflineRuntime) {
            offlineRuntimeRef.current = savedOfflineRuntime;
            setOfflineRuntime(savedOfflineRuntime);
            void readLocalSessionSyncMeta(savedOfflineRuntime.id).then((meta) => {
              const mode = meta?.authorityMode ?? 'local-offline';
              authorityModeRef.current = mode;
              setAuthorityMode(mode);
            });
            setLiveSnapshotSource('local');
          }
          if (restoredLive) {
            liveSnapshotRef.current = restoredLive;
            setLiveSnapshot(restoredLive);
            if (!savedOfflineRuntime) setLiveSnapshotSource('cache');
          }
          setPendingUploadCount(pendingUploads.length);
          if (
            cachedTasks &&
            cacheConnectionConfigured &&
            taskRequests.generation() === taskCacheGeneration
          ) {
            taskSnapshotRef.current = cachedTasks;
            setTaskSnapshot(cachedTasks);
          }
          setLedgerNotice(
            ledger.bundles.length > 0
              ? `已从本机缓存载入 ${ledger.bundles.length} 场会话`
              : '本机还没有已结束会话',
          );
        },
      )
      .catch((error: unknown) => {
        if (!active) return;
        setPullState('error');
        setLedgerNotice(`无法读取本机缓存：${errorMessage(error)}`);
      })
      .finally(() => {
        if (active) setCacheReady(true);
      });
    return () => {
      active = false;
      ledgerGeneration.current += 1;
      liveGeneration.current += 1;
      taskRequests.invalidate();
      ledgerRequest.current?.abort();
      liveRequest.current?.abort();
    };
  }, [
    deviceId,
    initialConnectionConfigured,
    nativeConnectionLease,
    preferences.endpoint,
    preferences.token,
    taskRequests,
  ]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const reconnectAfterResume = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      if (!preferencesRef.current.endpoint || !preferencesRef.current.token) return;
      const now = Date.now();
      if (now - lastResumeRefreshAt.current < 1_000) return;
      lastResumeRefreshAt.current = now;
      setOnline(true);
      setConnectionEpoch((value) => value + 1);
    };
    document.addEventListener('visibilitychange', reconnectAfterResume);
    window.addEventListener('pageshow', reconnectAfterResume);
    return () => {
      document.removeEventListener('visibilitychange', reconnectAfterResume);
      window.removeEventListener('pageshow', reconnectAfterResume);
    };
  }, []);

  useEffect(() => {
    if (!cacheReady || !online || !preferences.endpoint || !preferences.token) return;
    void pullLedger(preferences, cacheRef.current.cursor);
    void refreshTasks(preferences);
  }, [cacheReady, connectionEpoch, online, preferences, pullLedger, refreshTasks]);

  useEffect(() => {
    if (!cacheReady || !online || !preferences.endpoint || !preferences.token) return;
    return startVisibleTaskSnapshotRefresh(
      () => void refreshTasks(preferencesRef.current),
      () => document.visibilityState === 'visible',
    );
  }, [cacheReady, online, preferences.endpoint, preferences.token, refreshTasks]);

  useEffect(() => {
    liveRequest.current?.abort();
    const configured = Boolean(preferences.endpoint && preferences.token);
    if (!configured) {
      liveSnapshotRef.current = null;
      setLiveSnapshot(null);
      setLiveSnapshotSource('none');
      setConnectionState('unconfigured');
      void enqueueMutation(cacheMutationQueue, clearCachedLiveFocusSnapshot);
      return;
    }
    if (!online) {
      if (offlineRuntimeRef.current) {
        const offlineMode =
          authorityModeRef.current === 'forked-local' ? 'forked-local' : 'local-offline';
        authorityModeRef.current = offlineMode;
        setAuthorityMode(offlineMode);
      }
      setConnectionState('offline');
      return;
    }

    const controller = new AbortController();
    const generation = liveGeneration.current + 1;
    liveGeneration.current = generation;
    liveRequest.current = controller;
    let lastRevision: number | null = null;
    let retryDelay = 750;

    const isCurrent = () =>
      liveGeneration.current === generation &&
      liveRequest.current === controller &&
      !controller.signal.aborted;

    const run = async () => {
      if (offlineRuntimeRef.current) {
        authorityModeRef.current = 'reconnecting';
        setAuthorityMode('reconnecting');
      }
      setConnectionState('connecting');
      while (isCurrent()) {
        try {
          const response =
            lastRevision === null
              ? await fetchLiveFocusSnapshot({
                  endpoint: preferences.endpoint,
                  token: preferences.token,
                  signal: controller.signal,
                })
              : await waitForLiveFocusSnapshot({
                  endpoint: preferences.endpoint,
                  token: preferences.token,
                  afterRevision: lastRevision,
                  signal: controller.signal,
                });
          if (!isCurrent()) return;
          const mapped = await commitLiveSnapshot(
            response,
            mobileAccountConnectionKey(preferences),
          );
          if (!isCurrent()) return;
          if (!mapped) return;
          lastRevision = response.snapshot.revision;
          setConnectionState('live');
          retryDelay = 750;
        } catch (error) {
          if (!isCurrent() || isAbortError(error)) return;
          setConnectionState(navigator.onLine ? 'error' : 'offline');
          setCommandNotice(`${errorMessage(error)}；正在自动重连`);
          try {
            await abortableDelay(retryDelay, controller.signal);
          } catch {
            return;
          }
          retryDelay = Math.min(retryDelay * 2, 15_000);
          lastRevision = null;
          if (isCurrent()) setConnectionState('connecting');
        }
      }
    };

    void run();
    return () => {
      controller.abort();
      if (liveRequest.current === controller) liveRequest.current = null;
    };
  }, [
    commitLiveSnapshot,
    connectionEpoch,
    offlineRuntime,
    online,
    preferences,
    setConnectionState,
  ]);

  useEffect(() => {
    const snapshot = liveSnapshot ?? makeIdleSnapshot();
    void updateNativeFocusSnapshot(
      snapshot,
      deviceId,
      nativeConnectionLease,
      liveConnection === 'live' && offlineRuntime === null,
      Date.now(),
      offlineRuntime !== null,
    ).catch(() => {
      // Native controls are optional; Web/PWA live sync remains usable if the bridge is absent.
    });
  }, [deviceId, liveConnection, liveSnapshot, nativeConnectionLease, offlineRuntime]);

  const refreshNativeDisplayStatus = useCallback(async () => {
    if (!nativeSystemControls.available) return;
    const status = await readNativeFocusStatus();
    if (!status) return;
    setNativeSystemControls((current) => ({
      ...current,
      immersiveSystemBars: status.immersiveSystemBars === true,
      pictureInPictureSupported: status.pictureInPictureSupported === true,
      pictureInPictureActive: status.pictureInPictureActive === true,
    }));
  }, [nativeSystemControls.available]);

  useEffect(() => {
    if (!nativeSystemControls.available) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshNativeDisplayStatus();
    };
    void refreshNativeDisplayStatus();
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [nativeSystemControls.available, refreshNativeDisplayStatus]);

  useEffect(() => {
    const active = liveSnapshot?.state === 'running' || liveSnapshot?.state === 'paused';
    if (active || !nativeSystemControls.immersiveSystemBars) return;
    void setNativeImmersiveSystemBars(false)
      .then(() => {
        setNativeSystemControls((current) => ({ ...current, immersiveSystemBars: false }));
      })
      .catch(() => {
        // The next foreground status refresh reconciles native display state.
      });
  }, [liveSnapshot?.state, nativeSystemControls.immersiveSystemBars]);

  const processNativeQueue = useCallback(async () => {
    if (
      nativeQueueRunning.current ||
      liveConnectionRef.current !== 'live' ||
      offlineRuntimeRef.current
    ) {
      return;
    }
    nativeQueueRunning.current = true;
    const sourceNativeLease = nativeConnectionLease;
    try {
      const commands = await drainNativeFocusCommands(deviceId, sourceNativeLease);
      for (const nativeCommand of commands) {
        const connection = preferencesRef.current;
        if (!connection.endpoint || !connection.token || liveConnectionRef.current !== 'live') {
          break;
        }
        try {
          const sourceConnectionKey = mobileAccountConnectionKey(connection);
          const response = await sendNativeCommand(connection, deviceId, nativeCommand);
          const committed = await commitLiveSnapshot(response, sourceConnectionKey);
          if (!committed || connectionKeyRef.current !== sourceConnectionKey) break;
          if (
            response.ack.status === 'applied' ||
            response.ack.status === 'duplicate' ||
            response.ack.status === 'conflict' ||
            response.ack.status === 'rejected'
          ) {
            if (nativeConnectionLeaseRef.current !== sourceNativeLease) break;
            await completeNativeFocusCommands([nativeCommand.id], deviceId, sourceNativeLease);
          }
          if (response.ack.status === 'applied' || response.ack.status === 'duplicate') {
            setCommandNotice(
              nativeCommandAckNotice(
                nativeCommand.source,
                nativeCommand.type,
                nativeCommand.stateRevision,
                response,
              ),
            );
            if (nativeCommand.type === 'finish') {
              void pullLedger(connection, cacheRef.current.cursor);
            }
          } else {
            setCommandNotice(
              nativeCommandAckNotice(
                nativeCommand.source,
                nativeCommand.type,
                nativeCommand.stateRevision,
                response,
              ),
            );
          }
        } catch (error) {
          if (!isAbortError(error)) {
            setCommandNotice(`${errorMessage(error)}；系统动作已保留，将自动重试`);
          }
          break;
        }
      }
    } catch (error) {
      if (!isAbortError(error)) {
        setCommandNotice(`无法读取系统快捷动作：${errorMessage(error)}；将自动重试`);
      }
    } finally {
      nativeQueueRunning.current = false;
    }
  }, [commitLiveSnapshot, deviceId, nativeConnectionLease, pullLedger]);

  useEffect(() => {
    if (liveConnection !== 'live') return;
    let disposed = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    void subscribeToNativeFocusCommands(() => {
      if (!disposed) void processNativeQueue();
    })
      .then((remove) => {
        if (disposed) void remove();
        else unsubscribe = remove;
      })
      .catch(() => {
        // The persisted queue and foreground/interval checks remain the delivery fallback.
      });
    const processWhenForegrounded = () => {
      if (!disposed && document.visibilityState === 'visible') void processNativeQueue();
    };
    void processNativeQueue();
    const interval = window.setInterval(() => void processNativeQueue(), 5_000);
    document.addEventListener('visibilitychange', processWhenForegrounded);
    window.addEventListener('focus', processWhenForegrounded);
    window.addEventListener('pageshow', processWhenForegrounded);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', processWhenForegrounded);
      window.removeEventListener('focus', processWhenForegrounded);
      window.removeEventListener('pageshow', processWhenForegrounded);
      if (unsubscribe) void unsubscribe();
    };
  }, [liveConnection, processNativeQueue]);

  const handleCommand = useCallback(
    async (action: MobileFocusCommand, taskOverride?: SyncedTask, titleOverride?: string) => {
      if (pendingCommandRef.current) return;
      const snapshot = liveSnapshotRef.current ?? makeIdleSnapshot();
      const connection = preferencesRef.current;
      const sourceConnectionKey = mobileAccountConnectionKey(connection);
      const sourceNativeLease = nativeConnectionLeaseRef.current;
      const title = (titleOverride ?? titleDraft).trim();
      if (action === 'start' && !title) {
        setCommandNotice('请先填写本次专注标题');
        return;
      }
      if (action !== 'start' && !snapshot.sessionId && !offlineRuntimeRef.current) {
        setCommandNotice('当前没有可控制的活动会话');
        return;
      }

      const selectedTask =
        taskOverride ?? taskSnapshot?.snapshot?.tasks.find((task) => task.id === selectedTaskId);
      const canStartOffline =
        action === 'start' && !offlineRuntimeRef.current && liveConnectionRef.current !== 'live';
      if (offlineRuntimeRef.current || canStartOffline) {
        pendingCommandRef.current = action;
        setPendingCommand(action);
        setCommandNotice(null);
        try {
          const now = Date.now();
          let nextRuntime: OfflineFocusRuntime | null = offlineRuntimeRef.current;
          if (action === 'start') {
            nextRuntime = startOfflineFocus({
              id: `mobile_${crypto.randomUUID()}`,
              segmentId: `segment_${crypto.randomUUID()}`,
              title,
              task: selectedTask ?? null,
              now,
            });
            const meta: LocalSessionSyncMeta = {
              sessionId: nextRuntime.id,
              authorityMode: 'local-offline',
              originDeviceId: deviceId,
              baseCloudRevision: snapshot.revision > 0 ? snapshot.revision : null,
              suspectedRemoteSessionId: snapshot.state === 'idle' ? null : snapshot.sessionId,
              detectedRemoteRevision: snapshot.state === 'idle' ? null : snapshot.revision,
              detectedAt: snapshot.state === 'idle' ? null : now,
            };
            await createOfflineFocusRuntime(nextRuntime, meta);
            authorityModeRef.current = 'local-offline';
            setAuthorityMode('local-offline');
            setTitleDraft('');
            setSelectedTaskId('');
            setCommandNotice('已开始本机离线专注；结束后联网将自动补传');
          } else if (action === 'pause' && nextRuntime) {
            nextRuntime = pauseOfflineFocus(nextRuntime, `pause_${crypto.randomUUID()}`, now);
            await writeOfflineFocusRuntime(nextRuntime);
            setCommandNotice('本机专注已暂停');
          } else if (action === 'resume' && nextRuntime) {
            nextRuntime = resumeOfflineFocus(nextRuntime, now);
            await writeOfflineFocusRuntime(nextRuntime);
            setCommandNotice('本机专注已继续');
          } else if (action === 'finish' && nextRuntime) {
            const bundle = finishOfflineFocus(nextRuntime, now);
            await persistCompletedOfflineFocus(bundle, deviceId, sourceNativeLease);
            nextRuntime = null;
            authorityModeRef.current = 'cloud-live';
            setAuthorityMode('cloud-live');
            setPendingUploadCount((count) => count + 1);
            setCommandNotice('离线会话已安全保存；联网后自动补传');
          } else {
            throw new Error('本机离线专注状态与操作不匹配');
          }
          offlineRuntimeRef.current = nextRuntime;
          setOfflineRuntime(nextRuntime);
          const nextSnapshot = nextRuntime
            ? offlineRuntimeSnapshot(nextRuntime, deviceId, now)
            : makeIdleSnapshot(snapshot.revision + 1, now, now);
          liveSnapshotRef.current = nextSnapshot;
          setLiveSnapshot(nextSnapshot);
          setLiveSnapshotSource('local');
          if (!nextRuntime && online && connection.endpoint && connection.token) {
            setConnectionEpoch((value) => value + 1);
          }
        } catch (error) {
          setCommandNotice(errorMessage(error));
        } finally {
          pendingCommandRef.current = null;
          setPendingCommand(null);
        }
        return;
      }

      if (liveConnectionRef.current !== 'live' || !connection.endpoint || !connection.token) {
        setCommandNotice(
          snapshot.state === 'idle'
            ? '尚未取得“云端空闲”的最后确认，暂不能安全开启离线计时'
            : '最后确认仍有活动会话，为避免双重计时已锁定控制',
        );
        return;
      }

      const command = makeUiCommand(action, snapshot, title, selectedTask);
      const request = commandRequests.issue(sourceConnectionKey);
      pendingCommandRef.current = action;
      setPendingCommand(action);
      setCommandNotice(null);
      try {
        const response = await sendLiveFocusCommand({
          endpoint: connection.endpoint,
          token: connection.token,
          deviceId,
          command,
          signal: request.signal,
        });
        if (!request.isCurrent() || connectionKeyRef.current !== sourceConnectionKey) return;
        const committed = await commitLiveSnapshot(response, sourceConnectionKey);
        if (
          !committed ||
          !request.isCurrent() ||
          connectionKeyRef.current !== sourceConnectionKey
        ) {
          return;
        }
        setCommandNotice(commandAckNotice(action, command.expectedRevision, response));
        if (response.ack.status === 'applied' || response.ack.status === 'duplicate') {
          if (action === 'start') setTitleDraft('');
          if (action === 'start') setSelectedTaskId('');
          if (action === 'finish') void pullLedger(connection, cacheRef.current.cursor);
        }
      } catch (error) {
        if (
          request.isCurrent() &&
          connectionKeyRef.current === sourceConnectionKey &&
          !isAbortError(error)
        ) {
          setCommandNotice(errorMessage(error));
        }
      } finally {
        const shouldClear = request.isCurrent() && connectionKeyRef.current === sourceConnectionKey;
        request.finish();
        if (shouldClear) {
          pendingCommandRef.current = null;
          setPendingCommand(null);
        }
      }
    },
    [
      commandRequests,
      commitLiveSnapshot,
      deviceId,
      online,
      pullLedger,
      selectedTaskId,
      taskSnapshot,
      titleDraft,
    ],
  );

  const handleRetry = () => {
    if (!preferences.endpoint || !preferences.token) {
      setConfigOpen(true);
      setCommandNotice('登录后即可自动同步');
      return;
    }
    setConnectionEpoch((value) => value + 1);
  };

  const handleToggleImmersiveSystemBars = async () => {
    if (nativeSystemControls.busy !== null) return;
    const enabled = !nativeSystemControls.immersiveSystemBars;
    setNativeSystemControls((current) => ({ ...current, busy: 'immersive' }));
    try {
      const result = await setNativeImmersiveSystemBars(enabled);
      setNativeSystemControls((current) => ({
        ...current,
        immersiveSystemBars: result.supported && result.enabled,
      }));
      if (!result.supported) setCommandNotice('当前系统不支持沉浸显示');
    } catch (error) {
      setCommandNotice(`无法切换沉浸显示：${errorMessage(error)}`);
    } finally {
      setNativeSystemControls((current) => ({ ...current, busy: null }));
    }
  };

  const handleEnterPictureInPicture = async () => {
    if (nativeSystemControls.busy !== null) return;
    setNativeSystemControls((current) => ({ ...current, busy: 'picture-in-picture' }));
    try {
      const result = await enterNativePictureInPicture();
      setNativeSystemControls((current) => ({
        ...current,
        pictureInPictureSupported: result.supported,
        pictureInPictureActive: result.active,
      }));
      if (!result.entered) {
        setCommandNotice(result.supported ? '系统未允许进入画中画' : '当前系统不支持画中画');
      }
    } catch (error) {
      setCommandNotice(`无法进入画中画：${errorMessage(error)}`);
    } finally {
      setNativeSystemControls((current) => ({ ...current, busy: null }));
    }
  };

  const handleForgetToken = async () => {
    if (offlineRuntimeRef.current || pendingUploadCount > 0) {
      setCommandNotice('还有本机离线会话未补传，暂不能退出登录');
      return;
    }
    const operation = accountLifecycle.invalidate();
    invalidateOwnerAccountBootstrap();
    setAccountLoginPolling(false);
    setAccountBusy(true);
    setCommandNotice('正在从 Android 安全存储退出登录…');
    ledgerGeneration.current += 1;
    liveGeneration.current += 1;
    taskRequests.invalidate();
    ledgerRequest.current?.abort();
    liveRequest.current?.abort();
    try {
      const transition = await runMobileAccountLogout(
        accountLifecycle,
        operation,
        {
          read: readNativeFocusConnectionState,
          mutate: (baseline) => clearNativeFocusConnection(baseline.connectionLease),
          async restore(baseline, applied) {
            const restored = await restoreNativeFocusConnectionState(
              baseline,
              applied.connectionLease,
            );
            commitNativeConnectionLease(restored.connectionLease);
          },
        },
        resetAccountScopedState,
      );
      if (!transition.current) return;
      commitNativeConnectionLease(null);
      const next = { ...preferencesRef.current, token: '', rememberToken: false };
      connectionKeyRef.current = mobileAccountConnectionKey(next);
      const accountStateIssues = transition.issues;
      let browserPersistenceFailed = false;
      try {
        clearSavedToken();
        clearMobileAccountProfile();
      } catch {
        browserPersistenceFailed = true;
      }
      preferencesRef.current = next;
      setPreferences(next);
      setAccountProfile(null);
      setConnectionState('unconfigured');
      setConfigOpen(true);
      setCommandNotice(
        browserPersistenceFailed || accountStateIssues.length > 0
          ? '已从 Android 安全存储退出；本机缓存清理未完全落盘，下次启动会继续隔离旧账号'
          : '已退出登录；这台设备的历史缓存仍保留',
      );
    } catch (error) {
      if (accountLifecycle.isCurrent(operation)) {
        setConnectionEpoch((value) => value + 1);
        setCommandNotice(`退出登录失败，账号仍保持登录：${errorMessage(error)}`);
      }
    } finally {
      if (accountLifecycle.isCurrent(operation)) setAccountBusy(false);
    }
  };

  const handleClearCache = async () => {
    if (offlineRuntimeRef.current) {
      setCommandNotice('本机离线专注仍在进行，结束本轮后才能清除缓存');
      return;
    }
    ledgerGeneration.current += 1;
    liveGeneration.current += 1;
    taskRequests.invalidate();
    ledgerRequest.current?.abort();
    liveRequest.current?.abort();
    try {
      await enqueueMutation(cacheMutationQueue, clearMobileCache);
      cacheRef.current = EMPTY_CACHE;
      liveSnapshotRef.current = null;
      setCache(EMPTY_CACHE);
      setLiveSnapshot(null);
      setLiveSnapshotSource('none');
      taskSnapshotRef.current = null;
      setTaskSnapshot(null);
      setSelectedTaskId('');
      setPullState('idle');
      setLedgerNotice('本机缓存已清除；云端与桌面端数据未受影响');
      setCommandNotice('本机缓存已清除，正在重新确认云端状态');
      setConnectionEpoch((value) => value + 1);
    } catch (error) {
      setCommandNotice(`清理失败：${errorMessage(error)}`);
    }
  };

  const configured = Boolean(preferences.endpoint && preferences.token);
  return (
    <div className="mobile-shell">
      <header className="mobile-topbar">
        <div className="brand-lockup">
          <BrandMark />
          {/* 版本号与 commit 是排查问题时才需要的信息，不该常驻在产品标题旁边。
              已移到设置页的「关于」里，那里才是找它的地方。 */}
          <div>
            <p className="eyebrow">FOCUSLINK · TIME INSTRUMENT</p>
            <div className="brand-title-line">
              <h1>专注控制台</h1>
            </div>
          </div>
        </div>
        <button className="icon-button" type="button" onClick={() => setActiveView('settings')}>
          <SettingsIcon />
          <span>设置</span>
        </button>
      </header>

      <div className="app-frame">
        <AppNavigation activeView={activeView} onChange={setActiveView} />
        <main className="mobile-main">
          <section className="sync-strip" aria-live="polite" aria-label="实时连接与账本同步状态">
            <div className={`sync-status sync-status-live state-${liveConnection}`}>
              <span className={`network-dot ${online ? 'online' : 'offline'}`} aria-hidden="true" />
              <div className="sync-copy">
                <strong>实时控制</strong>
                <span>{connectionTitle(liveConnection)}</span>
              </div>
            </div>
            <div className={`sync-status sync-status-ledger state-${pullState}`}>
              <span className="network-dot" aria-hidden="true" />
              <div className="sync-copy">
                <strong>已结束账本</strong>
                <span>
                  {ledgerNotice}
                  {pendingUploadCount > 0 ? ` · ${pendingUploadCount} 场待同步或处理` : ''}
                </span>
              </div>
            </div>
            <button
              className="sync-button"
              type="button"
              onClick={handleRetry}
              disabled={pullState === 'pulling' || liveConnection === 'connecting' || !online}
            >
              <RefreshIcon spinning={pullState === 'pulling' || liveConnection === 'connecting'} />
              {liveConnection === 'connecting' || pullState === 'pulling'
                ? '连接中'
                : '刷新状态与账本'}
            </button>
          </section>

          <div className="mobile-workspace" key={activeView}>
            {activeView === 'focus' && (
              <FocusConsole
                snapshot={liveSnapshot}
                connection={liveConnection}
                titleDraft={titleDraft}
                pendingCommand={pendingCommand}
                commandNotice={commandNotice}
                localDeviceId={deviceId}
                tasks={taskSnapshot?.snapshot?.tasks ?? []}
                selectedTaskId={selectedTaskId}
                onTaskChange={(taskId) => {
                  setSelectedTaskId(taskId);
                  const task = taskSnapshot?.snapshot?.tasks.find((item) => item.id === taskId);
                  if (task) setTitleDraft(task.title);
                }}
                onTitleChange={setTitleDraft}
                onCommand={(command) => void handleCommand(command)}
                onOpenConnection={() => setConfigOpen(true)}
                onOpenTasks={() => setActiveView('tasks')}
                snapshotSource={liveSnapshotSource}
                nativeSystemControls={nativeSystemControls}
                onToggleImmersiveSystemBars={() => void handleToggleImmersiveSystemBars()}
                onEnterPictureInPicture={() => void handleEnterPictureInPicture()}
                localOfflineMode={offlineRuntime !== null}
                authorityMode={authorityMode}
                allowOfflineStart={offlineRuntime === null && liveConnection !== 'live'}
              />
            )}
            {activeView === 'tasks' && (
              <TaskBrowser
                tasks={taskSnapshot?.snapshot?.tasks ?? []}
                projects={taskSnapshot?.snapshot?.projects ?? []}
                publishedAt={taskSnapshot?.snapshot?.publishedAt ?? null}
                revision={taskSnapshot?.revision ?? 0}
                selectedTaskId={selectedTaskId}
                canStart={
                  pendingCommand === null &&
                  offlineRuntime === null &&
                  (liveConnection !== 'live' || (liveSnapshot?.state ?? 'idle') === 'idle')
                }
                onSelect={(task) => {
                  setSelectedTaskId(task.id);
                  setTitleDraft(task.title);
                }}
                onStart={(task) => {
                  setSelectedTaskId(task.id);
                  setTitleDraft(task.title);
                  setActiveView('focus');
                  void handleCommand('start', task, task.title);
                }}
              />
            )}
            {activeView === 'history' && (
              <DashboardView
                records={cache.bundles}
                ready={cacheReady}
                configured={configured}
                lastSyncAt={cache.lastSyncAt}
                cursor={cache.cursor}
              />
            )}
            {activeView === 'settings' && (
              <SettingsView
                connection={liveConnection}
                accountLabel={accountProfile?.accountLabel ?? null}
                authenticated={configured}
                token={preferences.token}
                endpoint={preferences.endpoint}
                taskCount={taskSnapshot?.snapshot?.tasks.length ?? 0}
                taskRevision={taskSnapshot?.revision ?? 0}
                ledgerCount={cache.bundles.length}
                onOpenAccount={() => setConfigOpen(true)}
                appearance={appearance}
                onAppearanceChange={setAppearance}
              />
            )}
          </div>
        </main>
      </div>

      <AnimatePresence>
        {configOpen && (
          <ConnectionSheet
            authenticated={configured}
            accountLabel={accountProfile?.accountLabel ?? null}
            busy={accountBusy || pullState === 'pulling' || liveConnection === 'connecting'}
            notice={commandNotice}
            onClose={() => setConfigOpen(false)}
            onLogin={() => void bootstrapOwnerAccount()}
            onLogout={handleForgetToken}
            onClearCache={() => setClearCacheDialogOpen(true)}
          />
        )}
      </AnimatePresence>
      <MobileConfirmDialog
        open={clearCacheDialogOpen}
        title="清除本机缓存？"
        description="只删除这台设备缓存的已结束账本与实时快照；待补传的离线会话、云端和电脑端记录都不会删除。"
        confirmLabel="清除缓存"
        danger
        onCancel={() => setClearCacheDialogOpen(false)}
        onConfirm={() => {
          setClearCacheDialogOpen(false);
          void handleClearCache();
        }}
      />
    </div>
  );
}

function mapLiveSnapshot(
  response: LiveFocusSnapshotResponse,
  observedAt: number,
): LiveFocusSnapshotLike {
  const { snapshot, serverTime } = response;
  if (!snapshot.session) {
    return makeIdleSnapshot(snapshot.revision, serverTime, observedAt);
  }
  const session = snapshot.session;
  return {
    state: session.state,
    revision: snapshot.revision,
    sessionId: session.id,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    serverTime,
    observedAt,
    activeElapsedMs: session.activeElapsedMs,
    pauseElapsedMs: session.pauseElapsedMs,
    wallElapsedMs: session.wallElapsedMs,
    currentStateStartedAt:
      session.state === 'paused' ? session.currentPauseStartedAt : session.updatedAt,
    segments: session.segments.map((segment) => ({ ...segment })),
    pauses: session.pauses.map((pause) => ({ ...pause })),
    title: session.title,
    ownerDeviceId: session.lastCommandDeviceId,
    taskId: session.task?.taskId ?? null,
    taskSource: session.task?.taskSource ?? null,
    taskTitle: session.task?.taskTitle ?? null,
  };
}

function makeUiCommand(
  action: MobileFocusCommand,
  snapshot: LiveFocusSnapshotLike,
  title: string,
  task?: SyncedTask,
): LiveFocusCommand {
  const commandId = `command_${crypto.randomUUID()}`;
  if (action === 'start') {
    return {
      commandId,
      action,
      expectedRevision: snapshot.revision,
      sessionId: `live_${crypto.randomUUID()}`,
      title,
      task: task ? { taskId: task.id, taskSource: task.source, taskTitle: task.title } : null,
    };
  }
  return {
    commandId,
    action,
    expectedRevision: snapshot.revision,
    sessionId: snapshot.sessionId ?? '',
  };
}

async function sendNativeCommand(
  connection: MobileConnectionPreferences,
  deviceId: string,
  nativeCommand: NativeFocusCommand,
) {
  return sendLiveFocusCommand({
    endpoint: connection.endpoint,
    token: connection.token,
    deviceId,
    command: {
      commandId: nativeCommand.id,
      action: nativeCommand.type,
      expectedRevision: nativeCommand.stateRevision,
      sessionId: nativeCommand.sessionId,
    },
  });
}

function mobileAccountId(connection: MobileConnectionPreferences): string | null {
  return parseDeviceToken(connection.token.trim())?.accountPublicId ?? null;
}

function enqueueMutation(
  queue: { current: Promise<void> },
  operation: () => Promise<void>,
): Promise<void> {
  const queued = queue.current.then(operation);
  queue.current = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function connectionTitle(state: LiveConnectionState): string {
  if (state === 'live') return '实时状态已连接';
  if (state === 'connecting') return '正在连接多端状态';
  if (state === 'offline') return '当前离线 · 本机专注可用';
  if (state === 'error') return '实时连接中断 · 自动重试中';
  return '尚未登录 FocusLink';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function BrandMark() {
  return (
    <svg className="mobile-brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path className="brand-mark-f" d="M5 20V4h12M5 11h9" />
      <path className="brand-mark-l" d="M15 9v11h5" />
      <path className="brand-mark-cross" d="M12 11h3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19 13.5v-3l-2-.6a6 6 0 0 0-.7-1.7l1-1.9-2.1-2.1-1.9 1a6 6 0 0 0-1.7-.7L11 2H8l-.6 2.5a6 6 0 0 0-1.7.7l-1.9-1-2.1 2.1 1 1.9A6 6 0 0 0 2 9.9l-2 .6v3l2 .6a6 6 0 0 0 .7 1.7l-1 1.9 2.1 2.1 1.9-1a6 6 0 0 0 1.7.7L8 22h3l.6-2.5a6 6 0 0 0 1.7-.7l1.9 1 2.1-2.1-1-1.9a6 6 0 0 0 .7-1.7z" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg className={spinning ? 'spinning' : ''} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}
