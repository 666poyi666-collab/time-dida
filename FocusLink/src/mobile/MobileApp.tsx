import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { App as CapacitorApp, type URLOpenListenerEvent } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { APP_VERSION } from '@shared/version';

import { AppNavigation, type MobileView } from './AppNavigation';
import { normalizeDeviceSyncEndpoint } from '@shared/sync/deviceProtocol';
import { parseDeviceToken } from '@shared/sync/v2Protocol';
import {
  SyncV2ClientError,
  classifySyncV2Error,
  type SyncV2ClientErrorCode,
} from '@shared/sync/v2ClientError';
import type { LiveFocusCommand, LiveFocusSnapshotResponse } from '@shared/sync/liveFocusProtocol';
import {
  reconcileTaskSnapshot,
  type SyncedTask,
  type SyncedTaskProject,
  type TaskSnapshotResponse,
} from '@shared/sync/taskSnapshotProtocol';
import {
  defaultTaskProjectColor,
  FOCUSLINK_INBOX_PROJECT_ID,
  isFocusLinkInboxProject,
} from '@shared/taskProjectPolicy';
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
  watchMobileSystemTheme,
  type MobileAppearance,
} from './appearance';
import {
  claimDeviceSyncPairingRequest,
  classifyMobileLiveRequestError,
  createDeviceSyncPairingRequest,
  exchangeDeviceSyncPairingCode,
  listDeviceSyncDevices,
  mutateTaskSnapshot,
  revokeDeviceSyncDevice,
  fetchLiveFocusSnapshot,
  fetchTaskSnapshot,
  publishTaskSnapshot,
  sendLiveFocusCommand,
  waitForLiveFocusSnapshot,
} from './syncClient';
import { normalizePairingCodeInput } from './pairingInput';
import { resolveMobileLiveLifecycleAction } from './liveConnectionLifecycle';
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
  createMobileAccountRequestCoalescer,
  createMobileAccountRequestLifecycle,
  isMobileAccountRequestCommitCurrent,
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
import {
  countOutstandingLedgerEntities,
  mobileLedgerProjectionVerifiedAt,
  presentMobileLedgerSync,
} from './ledgerSyncPresentation';
import { runMobileSyncV2 } from './v2Sync';
import { readMobileV2Bootstrap, readMobileV2Status } from './v2Cache';
import { persistCompletedOfflineFocus } from './offlineCompletion';
import type { DeviceSyncManagedDevice } from '@shared/ipc/api';
import {
  createTaskSnapshotRequestLifecycle,
  startVisibleTaskSnapshotRefresh,
} from './taskSnapshotRefresh';
import { isTabletFocusViewport } from './viewportPolicy';
import {
  createEmptyTaskSnapshot,
  deleteTaskSnapshotProject,
  mobileTaskCompletionOperationId,
  moveTaskSnapshotSubtree,
  updateTaskSnapshotProject,
} from './taskSnapshotMutations';

type PullState = 'idle' | 'pulling' | 'confirmed' | 'partial' | 'error';

const EMPTY_CACHE: MobileCacheSnapshot = {
  bundles: [],
  cursor: null,
  lastSyncAt: null,
  serverTime: null,
};

function currentMobilePairingDevice() {
  const native = Capacitor.isNativePlatform();
  const tablet = isTabletFocusViewport(window.innerWidth, window.innerHeight);
  return {
    installationId: getOrCreateInstallationId(),
    displayName: native
      ? tablet
        ? 'FocusLink Android 平板'
        : 'FocusLink Android 手机'
      : 'FocusLink Web',
    platform: native ? ('android' as const) : ('web' as const),
    deviceKind: tablet ? ('tablet' as const) : ('phone' as const),
    appVersion: APP_VERSION,
  };
}

export function MobileApp() {
  const initialPreferences = useRef(loadConnectionPreferences()).current;
  const [preferences, setPreferences] = useState(initialPreferences);
  const [accountProfile, setAccountProfile] = useState(() => loadMobileAccountProfile());
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountLoginPolling, setAccountLoginPolling] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingOffer, setPairingOffer] = useState<{
    code: string;
    expiresAt: number;
    requestToken?: string;
  } | null>(null);
  const [managedDevices, setManagedDevices] = useState<DeviceSyncManagedDevice[]>([]);
  const pairingAutoGeneratedRef = useRef(false);
  const [cache, setCache] = useState<MobileCacheSnapshot>(EMPTY_CACHE);
  const [cacheReady, setCacheReady] = useState(false);
  // Account sync is optional. A new installation starts in the local focus
  // console and keeps login available as an explicit action.
  const [configOpen, setConfigOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pullState, setPullState] = useState<PullState>('idle');
  const [, setLedgerNotice] = useState('正在读取本机会话账本…');
  const [liveSnapshot, setLiveSnapshot] = useState<LiveFocusSnapshotLike | null>(null);
  const [liveConnection, setLiveConnection] = useState<LiveConnectionState>(
    initialPreferences.endpoint && initialPreferences.token ? 'connecting' : 'unconfigured',
  );
  const [titleDraft, setTitleDraft] = useState('');
  const [taskSnapshot, setTaskSnapshot] = useState<TaskSnapshotResponse | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [pendingCommand, setPendingCommand] = useState<MobileFocusCommand | null>(null);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [liveConnectionNotice, setLiveConnectionNotice] = useState<string | null>(null);
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
  const taskRefreshes = useRef(
    createMobileAccountRequestCoalescer<TaskSnapshotResponse | null>(),
  ).current;
  const ledgerPulls = useRef(createMobileAccountRequestCoalescer<void>()).current;
  const commandRequests = useRef(createMobileAccountRequestLifecycle()).current;
  const cacheMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const nativeQueueRunning = useRef(false);
  const nativeConnectionLeaseRef = useRef<string | null>(null);
  const lastResumeRefreshAt = useRef(0);
  const mobileAppActive = useRef(true);
  const connectionKeyRef = useRef(mobileAccountConnectionKey(initialPreferences));
  const accountLifecycle = useRef(createMobileAccountLifecycle()).current;
  const accountTransitionOperation = useRef<number | null>(null);

  const beginAccountTransition = useCallback(
    (operation: number) => {
      accountTransitionOperation.current = operation;
      taskRefreshes.invalidate();
      taskRequests.invalidate();
      ledgerPulls.invalidate();
      ledgerGeneration.current += 1;
      ledgerRequest.current?.abort();
      ledgerRequest.current = null;
      liveGeneration.current += 1;
      liveRequest.current?.abort();
      liveRequest.current = null;
      commandRequests.invalidate();
    },
    [commandRequests, ledgerPulls, taskRefreshes, taskRequests],
  );

  const finishAccountTransition = useCallback((operation: number) => {
    if (accountTransitionOperation.current === operation) {
      accountTransitionOperation.current = null;
    }
  }, []);

  const refreshManagedDevices = useCallback(async (connection = preferencesRef.current) => {
    if (!connection.endpoint || !connection.token) {
      setManagedDevices([]);
      return;
    }
    try {
      setManagedDevices(await listDeviceSyncDevices(connection));
    } catch {
      setManagedDevices([]);
    }
  }, []);

  const commitNativeConnectionLease = useCallback((lease: string | null) => {
    nativeConnectionLeaseRef.current = lease;
    setNativeConnectionLease(lease);
  }, []);

  const resetTaskSnapshotForAccount = useCallback(async (): Promise<string[]> => {
    taskRefreshes.invalidate();
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
  }, [taskRefreshes, taskRequests]);

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
    ledgerPulls.invalidate();
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
  }, [ledgerPulls, resetLiveSnapshotForAccount, resetTaskSnapshotForAccount]);

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
    return watchMobileSystemTheme(applyMobileAppearance, appearance);
  }, [appearance]);

  useEffect(() => {
    if (!pairingOffer) return;
    const delay = Math.max(0, pairingOffer.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      setPairingOffer(null);
      pairingAutoGeneratedRef.current = false;
      setCommandNotice('配对码已过期，请重新生成');
    }, delay);
    return () => window.clearTimeout(timer);
  }, [pairingOffer]);

  useEffect(() => {
    void refreshManagedDevices(preferences);
  }, [preferences, refreshManagedDevices]);

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
      beginAccountTransition(operation);
      let committed = false;
      try {
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
        setPairingOffer(null);
        setPairingCode('');
        setConfigOpen(false);
        setConnectionEpoch((value) => value + 1);
        setCommandNotice(
          persistenceIssues.length > 0
            ? '设备已配对，但本机凭据持久化失败；当前会话继续同步并将在下次启动重试'
            : '设备已配对，正在开始同步',
        );
        void refreshManagedDevices(next);
        committed = true;
        return true;
      } finally {
        finishAccountTransition(operation);
        if (!committed && accountLifecycle.isCurrent(operation)) {
          setConnectionEpoch((value) => value + 1);
        }
      }
    },
    [
      accountLifecycle,
      beginAccountTransition,
      commitNativeConnectionLease,
      finishAccountTransition,
      refreshManagedDevices,
      resetAccountScopedState,
    ],
  );

  const bootstrapOwnerAccount = useCallback(
    async (callbackUrl?: string, polling = false) => {
      const operation = accountLifecycle.issue();
      setAccountBusy(true);
      setCommandNotice(callbackUrl ? '正在完成登录…' : '正在登录 FocusLink 账号…');
      try {
        const result = await ownerAccountBootstrapApi().bootstrap({
          installationId: getOrCreateInstallationId(),
          deviceKind: Capacitor.isNativePlatform()
            ? isTabletFocusViewport(window.innerWidth, window.innerHeight)
              ? 'tablet'
              : 'phone'
            : 'web',
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

  const redeemPairingCode = useCallback(
    async (inputValue = pairingCode) => {
      const code = normalizePairingCodeInput(inputValue);
      if (!/^\d{8}$/.test(code)) {
        setCommandNotice('请输入 8 位数字配对码');
        return;
      }
      const operation = accountLifecycle.issue();
      setAccountLoginPolling(false);
      setAccountBusy(true);
      setCommandNotice('正在加入多端同步…');
      try {
        const native = Capacitor.isNativePlatform();
        const tablet = isTabletFocusViewport(window.innerWidth, window.innerHeight);
        const result = await exchangeDeviceSyncPairingCode({
          endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
          code,
          device: {
            installationId: getOrCreateInstallationId(),
            displayName: native
              ? tablet
                ? 'FocusLink Android 平板'
                : 'FocusLink Android 手机'
              : 'FocusLink Web',
            platform: native ? 'android' : 'web',
            deviceKind: tablet ? 'tablet' : 'phone',
            appVersion: APP_VERSION,
          },
        });
        if (!accountLifecycle.isCurrent(operation)) return;
        const accountId = /^fl2_([A-Za-z0-9-]{6,80})_/.exec(result.accessToken)?.[1];
        if (!accountId) throw new Error('配对响应无效');
        const applied = await applyOwnerAccountSession(
          {
            accountId,
            accountLabel: 'Poyi',
            endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
            accessToken: result.accessToken,
            deviceId: result.deviceId,
          },
          operation,
        );
        if (applied) {
          setPairingCode('');
          setPairingOffer(null);
          setCommandNotice('设备已加入同步，正在读取任务、实时状态和账本');
        }
      } catch (error) {
        if (!accountLifecycle.isCurrent(operation) || isAbortError(error)) return;
        setCommandNotice(errorMessage(error));
      } finally {
        if (accountLifecycle.isCurrent(operation)) setAccountBusy(false);
      }
    },
    [accountLifecycle, applyOwnerAccountSession, pairingCode],
  );

  const revokeManagedDevice = useCallback(async (deviceIdToRevoke: string) => {
    const connection = preferencesRef.current;
    if (!connection.endpoint || !connection.token) return;
    setAccountBusy(true);
    try {
      await revokeDeviceSyncDevice({
        endpoint: connection.endpoint,
        token: connection.token,
        deviceId: deviceIdToRevoke,
      });
      setManagedDevices((current) =>
        current.filter((device) => device.deviceId !== deviceIdToRevoke),
      );
      setCommandNotice('设备已删除，后续同步已停止');
    } catch (error) {
      setCommandNotice(errorMessage(error));
    } finally {
      setAccountBusy(false);
    }
  }, []);

  const createPairingCode = useCallback(async () => {
    const endpoint = preferencesRef.current.endpoint;
    setAccountBusy(true);
    setCommandNotice('正在生成本机配对码…');
    try {
      const offer = await createDeviceSyncPairingRequest({
        endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
        device: currentMobilePairingDevice(),
      });
      if (preferencesRef.current.endpoint !== endpoint) {
        return;
      }
      setPairingOffer(offer);
      setCommandNotice('本机配对码已生成，请在另一台设备输入；两台会自动加入同步');
    } catch (error) {
      setCommandNotice(errorMessage(error));
    } finally {
      setAccountBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!configOpen) {
      pairingAutoGeneratedRef.current = false;
      return;
    }
    if (pairingOffer || accountBusy || pairingAutoGeneratedRef.current) return;
    pairingAutoGeneratedRef.current = true;
    void createPairingCode();
  }, [accountBusy, configOpen, createPairingCode, pairingOffer, preferences.token]);

  useEffect(() => {
    const requestToken = pairingOffer?.requestToken;
    if (!requestToken || pairingOffer.expiresAt <= Date.now()) return;
    const operation = accountLifecycle.issue();
    const controller = new AbortController();
    let disposed = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const result = await claimDeviceSyncPairingRequest({
          endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
          requestToken,
          device: currentMobilePairingDevice(),
          signal: controller.signal,
        });
        if (disposed || !accountLifecycle.isCurrent(operation)) return;
        if (result.status === 'pending') {
          timer = window.setTimeout(() => void poll(), result.retryAfterMs);
          return;
        }
        const accountId = /^fl2_([A-Za-z0-9-]{6,80})_/.exec(result.accessToken)?.[1];
        if (!accountId) throw new Error('配对领取响应无效');
        const applied = await applyOwnerAccountSession(
          {
            accountId,
            accountLabel: 'Poyi',
            endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
            accessToken: result.accessToken,
            deviceId: result.deviceId,
          },
          operation,
        );
        if (applied) {
          setPairingOffer(null);
          setPairingCode('');
          setCommandNotice('两台设备已配对，正在同步任务、实时状态和账本');
        }
      } catch (error) {
        if (disposed || !accountLifecycle.isCurrent(operation) || isAbortError(error)) return;
        setPairingOffer(null);
        pairingAutoGeneratedRef.current = false;
        setCommandNotice(errorMessage(error));
      }
    };
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [accountLifecycle, applyOwnerAccountSession, pairingOffer, preferences.token]);

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
      const canCommit = () =>
        isMobileAccountRequestCommitCurrent({
          requestCurrent: true,
          requestConnectionKey: sourceConnectionKey,
          currentConnectionKey: connectionKeyRef.current,
          transitionOperation: accountTransitionOperation.current,
        });
      if (!canCommit()) return null;
      const mapped = mapLiveSnapshot(response, Date.now());
      const localRuntime = offlineRuntimeRef.current;
      if (localRuntime) {
        const evidence = remoteForkEvidence(mapped, localRuntime.id);
        const mode: MobileAuthorityMode = evidence ? 'forked-local' : 'local-offline';
        authorityModeRef.current = mode;
        setAuthorityMode(mode);
        if (evidence) {
          const existing = await readLocalSessionSyncMeta(localRuntime.id);
          if (!canCommit()) return null;
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
      if (!canCommit()) return null;
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
        if (canCommit()) {
          setCommandNotice(`实时状态已更新，但本机缓存失败：${errorMessage(error)}`);
        }
      }
      return mapped;
    },
    [deviceId],
  );

  const refreshTasks = useCallback(
    (connection: MobileConnectionPreferences): Promise<TaskSnapshotResponse | null> => {
      const connectionKey = mobileAccountConnectionKey(connection);
      if (accountTransitionOperation.current !== null) return Promise.resolve(null);
      return taskRefreshes.run(connectionKey, async () => {
        const request = taskRequests.issue(connectionKey);
        const canCommit = () =>
          isMobileAccountRequestCommitCurrent({
            requestCurrent: request.isCurrent(),
            requestConnectionKey: connectionKey,
            currentConnectionKey: connectionKeyRef.current,
            transitionOperation: accountTransitionOperation.current,
          });
        try {
          const response = await fetchTaskSnapshot({
            endpoint: connection.endpoint,
            token: connection.token,
            signal: request.signal,
          });
          if (!canCommit()) return null;
          const reconciliation = reconcileTaskSnapshot(taskSnapshotRef.current, response);
          if (reconciliation.freshness === 'stale') return taskSnapshotRef.current;
          if (reconciliation.freshness === 'inconsistent') {
            setCommandNotice('任务清单 revision 内容不一致，已保留本机较可信快照并继续重试');
            return null;
          }
          taskSnapshotRef.current = reconciliation.snapshot;
          setTaskSnapshot(reconciliation.snapshot);
          const accountId = mobileAccountId(connection);
          await enqueueMutation(cacheMutationQueue, async () => {
            if (canCommit() && accountId) {
              await writeCachedTaskSnapshot(reconciliation.snapshot, accountId);
            }
          });
          return reconciliation.snapshot;
        } catch (error) {
          if (!canCommit() || isAbortError(error)) return null;
          setCommandNotice(
            (current) => current ?? `任务清单刷新失败：${errorMessage(error)}；继续使用本机缓存`,
          );
          return null;
        } finally {
          request.finish();
        }
      });
    },
    [taskRefreshes, taskRequests],
  );

  const requireLatestEditableTaskSnapshot = useCallback(async () => {
    if (!preferences.endpoint || !preferences.token) {
      throw new Error('请先完成设备配对');
    }
    const confirmed = await refreshTasks(preferences);
    if (!confirmed) throw new Error('未能确认最新任务清单，请检查网络后重试');
    if (confirmed.snapshot) return confirmed.snapshot;
    if (confirmed.revision === 0) return createEmptyTaskSnapshot(Date.now());
    throw new Error('任务清单状态异常，请刷新后重试');
  }, [preferences, refreshTasks]);

  const createCloudTask = useCallback(
    async (title: string, projectId: string | null) => {
      const now = Date.now();
      const snapshot = await requireLatestEditableTaskSnapshot();
      const response = await publishTaskSnapshot({
        endpoint: preferences.endpoint,
        token: preferences.token,
        deviceId,
        snapshot: {
          publishedAt: now,
          projects: snapshot.projects,
          tasks: [
            ...snapshot.tasks,
            {
              id: crypto.randomUUID(),
              source: 'local',
              projectId: projectId || FOCUSLINK_INBOX_PROJECT_ID,
              title,
              status: 'incomplete',
              priority: null,
              dueDate: null,
              tags: [],
              parentId: null,
              isCompleted: false,
              updatedAt: now,
            },
          ],
        },
      });
      taskSnapshotRef.current = response;
      setTaskSnapshot(response);
      const accountId = mobileAccountId(preferences);
      if (accountId) {
        await enqueueMutation(cacheMutationQueue, () =>
          writeCachedTaskSnapshot(response, accountId),
        );
      }
      setCommandNotice('任务已保存到 FocusLink 云端');
    },
    [deviceId, preferences, requireLatestEditableTaskSnapshot],
  );

  const createCloudProject = useCallback(
    async (name: string) => {
      const now = Date.now();
      const snapshot = await requireLatestEditableTaskSnapshot();
      const projectCount = snapshot.projects.filter(
        (project) => !isFocusLinkInboxProject(project.id),
      ).length;
      const response = await publishTaskSnapshot({
        endpoint: preferences.endpoint,
        token: preferences.token,
        deviceId,
        snapshot: {
          ...snapshot,
          publishedAt: now,
          projects: [
            ...snapshot.projects,
            {
              id: crypto.randomUUID(),
              source: 'local',
              name,
              color: defaultTaskProjectColor(projectCount + 1),
            },
          ],
        },
      });
      taskSnapshotRef.current = response;
      setTaskSnapshot(response);
      const accountId = mobileAccountId(preferences);
      if (accountId) {
        await enqueueMutation(cacheMutationQueue, () =>
          writeCachedTaskSnapshot(response, accountId),
        );
      }
      setCommandNotice('清单已保存到 FocusLink 云端');
    },
    [deviceId, preferences, requireLatestEditableTaskSnapshot],
  );

  const updateCloudProject = useCallback(
    async (project: SyncedTaskProject, input: { name?: string; color?: string | null }) => {
      const snapshot = await requireLatestEditableTaskSnapshot();
      const freshProject = snapshot.projects.find((candidate) => candidate.id === project.id);
      if (!freshProject) throw new Error('FocusLink 清单不存在，请刷新后重试');
      const now = Date.now();
      const response = await publishTaskSnapshot({
        endpoint: preferences.endpoint,
        token: preferences.token,
        deviceId,
        snapshot: updateTaskSnapshotProject(snapshot, freshProject, input, now),
      });
      taskSnapshotRef.current = response;
      setTaskSnapshot(response);
      const accountId = mobileAccountId(preferences);
      if (accountId) {
        await enqueueMutation(cacheMutationQueue, () =>
          writeCachedTaskSnapshot(response, accountId),
        );
      }
      setCommandNotice('清单名称与颜色已同步');
    },
    [deviceId, preferences, requireLatestEditableTaskSnapshot],
  );

  const deleteCloudProject = useCallback(
    async (project: SyncedTaskProject) => {
      const snapshot = await requireLatestEditableTaskSnapshot();
      const freshProject = snapshot.projects.find((candidate) => candidate.id === project.id);
      if (!freshProject) throw new Error('FocusLink 清单不存在，请刷新后重试');
      const now = Date.now();
      const next = deleteTaskSnapshotProject(snapshot, freshProject, now);
      const response = await publishTaskSnapshot({
        endpoint: preferences.endpoint,
        token: preferences.token,
        deviceId,
        snapshot: next.snapshot,
      });
      taskSnapshotRef.current = response;
      setTaskSnapshot(response);
      const accountId = mobileAccountId(preferences);
      if (accountId) {
        await enqueueMutation(cacheMutationQueue, () =>
          writeCachedTaskSnapshot(response, accountId),
        );
      }
      setCommandNotice(`清单已删除，${next.movedTaskCount} 项任务已移到收件箱`);
    },
    [deviceId, preferences, requireLatestEditableTaskSnapshot],
  );

  const moveCloudTask = useCallback(
    async (task: SyncedTask, targetProjectId: string) => {
      const snapshot = await requireLatestEditableTaskSnapshot();
      const freshTask = snapshot.tasks.find((candidate) => candidate.id === task.id);
      if (!freshTask) throw new Error('FocusLink 任务不存在，请刷新后重试');
      const projectId = targetProjectId || FOCUSLINK_INBOX_PROJECT_ID;
      const now = Date.now();
      const response = await publishTaskSnapshot({
        endpoint: preferences.endpoint,
        token: preferences.token,
        deviceId,
        snapshot: moveTaskSnapshotSubtree(snapshot, freshTask.id, projectId, now),
      });
      taskSnapshotRef.current = response;
      setTaskSnapshot(response);
      const accountId = mobileAccountId(preferences);
      if (accountId) {
        await enqueueMutation(cacheMutationQueue, () =>
          writeCachedTaskSnapshot(response, accountId),
        );
      }
      const destination = response.snapshot?.projects.find(
        (project) => project.id === projectId,
      )?.name;
      setCommandNotice(`任务已移到「${destination ?? '收件箱'}」`);
    },
    [deviceId, preferences, requireLatestEditableTaskSnapshot],
  );

  const toggleCloudTaskComplete = useCallback(
    async (task: SyncedTask) => {
      if (!preferences.endpoint || !preferences.token) {
        throw new Error('请先完成设备配对');
      }
      const confirmed = await refreshTasks(preferences);
      if (!confirmed) throw new Error('未能确认最新任务清单，请检查网络后重试');
      const freshTask = confirmed.snapshot?.tasks.find((candidate) => candidate.id === task.id);
      if (!freshTask) throw new Error('FocusLink 任务不存在，请刷新后重试');
      const completing = !freshTask.isCompleted;
      const response = await mutateTaskSnapshot({
        endpoint: preferences.endpoint,
        token: preferences.token,
        deviceId,
        operationId: mobileTaskCompletionOperationId({
          deviceId,
          taskId: freshTask.id,
          completed: completing,
          expectedRevision: confirmed.revision,
        }),
        expectedRevision: confirmed.revision,
        mutation: {
          kind: 'set_task_completed',
          taskId: freshTask.id,
          completed: completing,
        },
      });
      taskSnapshotRef.current = response;
      setTaskSnapshot(response);
      const accountId = mobileAccountId(preferences);
      if (accountId) {
        await enqueueMutation(cacheMutationQueue, () =>
          writeCachedTaskSnapshot(response, accountId),
        );
      }
      setCommandNotice(
        completing && response.result.recurrenceRolled
          ? '本次已完成，下次循环已推进'
          : completing
            ? '任务已完成'
            : '任务已恢复',
      );
    },
    [deviceId, preferences, refreshTasks],
  );

  const pullLedger = useCallback(
    (connection: MobileConnectionPreferences, _startCursor: string | null): Promise<void> => {
      const sourceConnectionKey = mobileAccountConnectionKey(connection);
      if (accountTransitionOperation.current !== null) return Promise.resolve();
      return ledgerPulls.run(sourceConnectionKey, async () => {
        const sourceNativeLease = nativeConnectionLease;
        ledgerRequest.current?.abort();
        const controller = new AbortController();
        const generation = ledgerGeneration.current + 1;
        ledgerGeneration.current = generation;
        ledgerRequest.current = controller;
        setPullState('pulling');
        setLedgerNotice('正在拉取已结束会话账本…');

        const isCurrent = () =>
          isMobileAccountRequestCommitCurrent({
            requestCurrent:
              ledgerGeneration.current === generation &&
              ledgerRequest.current === controller &&
              !controller.signal.aborted,
            requestConnectionKey: sourceConnectionKey,
            currentConnectionKey: connectionKeyRef.current,
            transitionOperation: accountTransitionOperation.current,
          });

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
          const presentation = presentMobileLedgerSync({
            uploaded: synced.uploaded,
            downloaded: synced.downloaded,
            bundleCount: snapshot.bundles.length,
            outstandingCount: countOutstandingLedgerEntities(
              pending,
              synced.outstandingEntityIds,
              deviceId,
            ),
            conflicts: synced.conflicts,
            unresolvedConflicts: synced.unresolvedConflicts,
            rejected: synced.rejected,
          });
          await updateNativeAuthorityProjectionHistory({
            deviceId,
            connectionLease: sourceNativeLease,
            records: snapshot.bundles,
            lastVerifiedAt: mobileLedgerProjectionVerifiedAt(
              presentation.pullState,
              synced.lastVerifiedAt,
              synced.lastVerifiedAt ?? confirmedAt,
            ),
            lastAttemptAt: attemptedAt,
            pendingCount: presentation.pendingCount,
            lastErrorCode: presentation.lastErrorCode,
          }).catch(() => false);
          if (!isCurrent()) return;
          setPendingUploadCount(presentation.pendingCount);
          cacheRef.current = snapshot;
          setCache(snapshot);
          setPullState(presentation.pullState);
          setLedgerNotice(presentation.notice);
        } catch (error) {
          if (!isCurrent() || isAbortError(error)) return;
          const [pending, v2Status] = await Promise.all([
            readPendingDeviceSyncBundles().catch(() => []),
            readMobileV2Status(deviceId).catch(() => null),
          ]);
          if (!isCurrent()) return;
          const presentation = presentMobileLedgerSync({
            uploaded: 0,
            downloaded: 0,
            bundleCount: cacheRef.current.bundles.length,
            outstandingCount: countOutstandingLedgerEntities(
              pending,
              v2Status?.outstandingEntityIds ?? [],
              deviceId,
            ),
            conflicts: v2Status?.conflicts ?? 0,
            unresolvedConflicts: v2Status?.conflicts ?? 0,
            rejected: v2Status?.rejected ?? 0,
          });
          await updateNativeAuthorityProjectionHistory({
            deviceId,
            connectionLease: sourceNativeLease,
            records: cacheRef.current.bundles,
            lastVerifiedAt: v2Status?.lastVerifiedAt ?? null,
            lastAttemptAt: Date.now(),
            pendingCount: presentation.pendingCount,
            lastErrorCode: classifySyncV2Error(error),
          }).catch(() => false);
          if (!isCurrent()) return;
          setPendingUploadCount(presentation.pendingCount);
          setPullState('error');
          setLedgerNotice(
            [
              errorMessage(error),
              presentation.pullState === 'partial' ? presentation.notice : null,
              cacheRef.current.bundles.length > 0 ? '已结束账本继续显示本机缓存' : null,
            ]
              .filter(Boolean)
              .join('；'),
          );
        } finally {
          if (ledgerRequest.current === controller) ledgerRequest.current = null;
        }
      });
    },
    [deviceId, ledgerPulls, nativeConnectionLease],
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
      readMobileV2Status(deviceId),
    ])
      .then(
        ([
          storedLedger,
          cachedLive,
          cachedTasks,
          savedOfflineRuntime,
          pendingUploads,
          checkpoint,
          v2Status,
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
          const currentV2Status =
            cacheConnectionConfigured &&
            checkpoint?.boundAccountId === cacheAccountId &&
            checkpoint.boundDeviceId === deviceId
              ? v2Status
              : null;
          const cachedPresentation = presentMobileLedgerSync({
            uploaded: 0,
            downloaded: 0,
            bundleCount: ledger.bundles.length,
            outstandingCount: countOutstandingLedgerEntities(
              pendingUploads,
              currentV2Status?.outstandingEntityIds ?? [],
              deviceId,
            ),
            conflicts: currentV2Status?.conflicts ?? 0,
            unresolvedConflicts: currentV2Status?.conflicts ?? 0,
            rejected: currentV2Status?.rejected ?? 0,
          });
          void updateNativeAuthorityProjectionHistory({
            deviceId,
            connectionLease: nativeConnectionLease,
            records: ledger.bundles,
            lastVerifiedAt: currentV2Status?.lastVerifiedAt ?? null,
            lastAttemptAt: ledger.lastSyncAt ?? 0,
            pendingCount: cachedPresentation.pendingCount,
            lastErrorCode: currentV2Status?.lastErrorCode ?? cachedPresentation.lastErrorCode,
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
          setPendingUploadCount(cachedPresentation.pendingCount);
          if (
            cachedTasks &&
            cacheConnectionConfigured &&
            taskRequests.generation() === taskCacheGeneration
          ) {
            taskSnapshotRef.current = cachedTasks;
            setTaskSnapshot(cachedTasks);
          }
          if (cachedPresentation.pullState === 'partial') {
            setPullState('partial');
            setLedgerNotice(cachedPresentation.notice);
          } else {
            setLedgerNotice(
              ledger.bundles.length > 0
                ? `已从本机缓存载入 ${ledger.bundles.length} 场会话`
                : '本机还没有已结束会话',
            );
          }
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
  }, [deviceId, nativeConnectionLease, preferences.endpoint, preferences.token, taskRequests]);

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
    let disposed = false;
    let removeAppStateListener: (() => Promise<void>) | null = null;
    const applyLifecycle = () => {
      if (disposed) return;
      const action = resolveMobileLiveLifecycleAction({
        appActive: mobileAppActive.current,
        documentVisible: document.visibilityState === 'visible',
        online: navigator.onLine,
        configured: Boolean(preferencesRef.current.endpoint && preferencesRef.current.token),
      });
      if (action === 'suspend') {
        // The next visible event must replace this aborted loop even when OEM lifecycle events
        // arrive less than a second apart; the timestamp only deduplicates active-side events.
        lastResumeRefreshAt.current = 0;
        liveRequest.current?.abort();
        return;
      }
      if (action === 'wait') {
        if (!navigator.onLine) setOnline(false);
        return;
      }
      const now = Date.now();
      if (now - lastResumeRefreshAt.current < 1_000) return;
      lastResumeRefreshAt.current = now;
      setOnline(true);
      setConnectionEpoch((value) => value + 1);
    };
    const handleVisibilityChange = () => applyLifecycle();
    const reconnectAfterPageShow = () => applyLifecycle();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', reconnectAfterPageShow);
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      mobileAppActive.current = isActive;
      applyLifecycle();
    }).then((handle) => {
      if (disposed) void handle.remove();
      else removeAppStateListener = () => handle.remove();
    });
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', reconnectAfterPageShow);
      if (removeAppStateListener) void removeAppStateListener();
    };
  }, []);

  useEffect(() => {
    if (!cacheReady || !online || !preferences.endpoint || !preferences.token) return;
    void pullLedger(preferences, cacheRef.current.cursor);
    void refreshTasks(preferences);
  }, [cacheReady, connectionEpoch, online, preferences, pullLedger, refreshTasks]);

  useEffect(() => {
    if (!cacheReady || !online || !preferences.endpoint || !preferences.token) return;
    const refreshVisibleTasks = () => {
      if (document.visibilityState === 'visible') void refreshTasks(preferencesRef.current);
    };
    const stopInterval = startVisibleTaskSnapshotRefresh(
      () => void refreshTasks(preferencesRef.current),
      () => document.visibilityState === 'visible',
    );
    document.addEventListener('visibilitychange', refreshVisibleTasks);
    window.addEventListener('focus', refreshVisibleTasks);
    window.addEventListener('pageshow', refreshVisibleTasks);
    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', refreshVisibleTasks);
      window.removeEventListener('focus', refreshVisibleTasks);
      window.removeEventListener('pageshow', refreshVisibleTasks);
    };
  }, [cacheReady, online, preferences.endpoint, preferences.token, refreshTasks]);

  useEffect(() => {
    liveRequest.current?.abort();
    const configured = Boolean(preferences.endpoint && preferences.token);
    if (!configured) {
      setConnectionState('unconfigured');
      setLiveConnectionNotice(null);
      const localRuntime = offlineRuntimeRef.current;
      if (localRuntime) {
        const localSnapshot = offlineRuntimeSnapshot(localRuntime, deviceId);
        liveSnapshotRef.current = localSnapshot;
        setLiveSnapshot(localSnapshot);
        setLiveSnapshotSource('local');
        const localMode =
          authorityModeRef.current === 'forked-local' ? 'forked-local' : 'local-offline';
        authorityModeRef.current = localMode;
        setAuthorityMode(localMode);
      } else {
        liveSnapshotRef.current = null;
        setLiveSnapshot(null);
        setLiveSnapshotSource('none');
        void enqueueMutation(cacheMutationQueue, clearCachedLiveFocusSnapshot);
      }
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
      setLiveConnectionNotice(null);
      return;
    }
    if (
      resolveMobileLiveLifecycleAction({
        appActive: mobileAppActive.current,
        documentVisible: document.visibilityState === 'visible',
        online,
        configured,
      }) !== 'reconnect'
    ) {
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
      setLiveConnectionNotice(null);
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
          setLiveConnectionNotice(null);
          retryDelay = 750;
        } catch (error) {
          if (!isCurrent() || isAbortError(error)) return;
          const failure = classifyMobileLiveRequestError(error);
          setConnectionState(navigator.onLine ? 'error' : 'offline');
          setLiveConnectionNotice(
            failure.retryable ? `${failure.message}；正在自动重连` : failure.message,
          );
          if (!failure.retryable) return;
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
    deviceId,
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
      if (action !== 'start' && !snapshot.sessionId && !offlineRuntimeRef.current) {
        setCommandNotice('当前没有可控制的活动会话');
        return;
      }

      const selectedTask =
        taskOverride ?? taskSnapshot?.snapshot?.tasks.find((task) => task.id === selectedTaskId);
      const title =
        (titleOverride ?? titleDraft).trim() || selectedTask?.title.trim() || '自由专注';
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
      setCommandNotice('完成设备配对后即可自动同步');
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
      setCommandNotice('还有本机离线会话未补传，暂不能退出此设备同步');
      return;
    }
    const operation = accountLifecycle.invalidate();
    invalidateOwnerAccountBootstrap();
    setAccountLoginPolling(false);
    setAccountBusy(true);
    setCommandNotice('正在从 Android 安全存储移除设备同步凭据…');
    beginAccountTransition(operation);
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
      setPairingOffer(null);
      setPairingCode('');
      pairingAutoGeneratedRef.current = false;
      setConnectionState('unconfigured');
      setConfigOpen(true);
      setCommandNotice(
        browserPersistenceFailed || accountStateIssues.length > 0
          ? '设备同步凭据已移除；本机缓存清理未完全落盘，下次启动会继续隔离旧同步空间'
          : '这台设备已退出同步；本机历史缓存仍保留',
      );
    } catch (error) {
      if (accountLifecycle.isCurrent(operation)) {
        setConnectionEpoch((value) => value + 1);
        setCommandNotice(`退出设备同步失败，原同步连接仍保留：${errorMessage(error)}`);
      }
    } finally {
      finishAccountTransition(operation);
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
  const activeViewTitle =
    activeView === 'focus'
      ? '专注'
      : activeView === 'tasks'
        ? '任务'
        : activeView === 'history'
          ? '统计'
          : '设置';
  return (
    <div className={`mobile-shell view-${activeView}`}>
      <header className="mobile-topbar">
        <div className="brand-lockup">
          <BrandMark />
          {/* 版本号与 commit 是排查问题时才需要的信息，不该常驻在产品标题旁边。
              已移到设置页的「关于」里，那里才是找它的地方。 */}
          <div className="mobile-title-copy">
            <p className="eyebrow">FOCUSLINK</p>
            <div className="brand-title-line">
              <h1>{activeViewTitle}</h1>
            </div>
          </div>
        </div>
        <div className="mobile-topbar-actions">
          <button
            className={`mobile-sync-pill state-${configured ? liveConnection : 'local'}`}
            type="button"
            onClick={configured ? handleRetry : () => setConfigOpen(true)}
            disabled={configured && (pullState === 'pulling' || liveConnection === 'connecting')}
            title={
              configured
                ? (liveConnectionNotice ?? connectionTitle(liveConnection))
                : '本机模式；点击打开多端同步'
            }
            aria-label={
              configured
                ? `多端同步：${connectionTitle(liveConnection)}，点击刷新`
                : '当前为本机模式，点击打开多端同步'
            }
          >
            <span className={`network-dot ${online ? 'online' : 'offline'}`} aria-hidden="true" />
            <span>{configured ? connectionTitle(liveConnection) : '本机'}</span>
          </button>
          {activeView !== 'settings' && (
            <button
              className="icon-button"
              type="button"
              onClick={() => setActiveView('settings')}
              aria-label="打开设置"
            >
              <SettingsIcon />
            </button>
          )}
        </div>
      </header>

      <div className="app-frame">
        <AppNavigation activeView={activeView} onChange={setActiveView} />
        <main className="mobile-main">
          <div className="mobile-workspace" key={activeView}>
            {activeView === 'focus' && (
              <FocusConsole
                snapshot={liveSnapshot}
                connection={liveConnection}
                connectionNotice={liveConnectionNotice}
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
                timerStyle={appearance.timerStyle}
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
                onCreate={createCloudTask}
                onCreateProject={createCloudProject}
                onUpdateProject={updateCloudProject}
                onDeleteProject={deleteCloudProject}
                onMoveTask={moveCloudTask}
                onToggleComplete={toggleCloudTaskComplete}
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
                online={online}
                accountLabel={accountProfile?.accountLabel ?? null}
                authenticated={configured}
                lastSyncAt={cache.lastSyncAt}
                pullState={pullState}
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
            connection={liveConnection}
            online={online}
            lastSyncAt={cache.lastSyncAt}
            accountLabel={accountProfile?.accountLabel ?? null}
            busy={accountBusy || pullState === 'pulling' || liveConnection === 'connecting'}
            notice={commandNotice}
            pairingCode={pairingCode}
            pairingOffer={pairingOffer}
            devices={managedDevices}
            currentDeviceId={deviceId}
            onClose={() => setConfigOpen(false)}
            onPairingCodeChange={(value) => setPairingCode(normalizePairingCodeInput(value))}
            onPair={(value) => void redeemPairingCode(value)}
            onCreatePairingCode={() => void createPairingCode()}
            onRevokeDevice={(deviceIdToRevoke) => void revokeManagedDevice(deviceIdToRevoke)}
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
  if (state === 'error') return '实时连接中断';
  return '尚未配对设备';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  if (error instanceof SyncV2ClientError) return syncV2ErrorMessage(error.code);
  return error instanceof Error ? error.message : String(error);
}

function syncV2ErrorMessage(code: SyncV2ClientErrorCode): string {
  if (code === 'authentication_failed') return '设备凭据已失效，请重新配对';
  if (code === 'authorization_failed') return '当前设备没有账本同步权限';
  if (code === 'network_error') return '暂时无法连接云端';
  if (code === 'timeout') return '云端连接超时';
  if (code === 'response_too_large') return '云端账本超过单次同步上限';
  if (code === 'cursor_ahead' || code === 'contract_error') return '云端账本响应异常';
  if (code === 'aborted') return '本次同步已取消';
  return '账本同步暂时失败';
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
