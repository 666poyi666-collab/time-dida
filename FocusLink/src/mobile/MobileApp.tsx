import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { App as CapacitorApp, type URLOpenListenerEvent } from '@capacitor/app';

import { AppNavigation, type MobileView } from './AppNavigation';
import { DEVICE_SYNC_ENTITY, normalizeDeviceSyncEndpoint } from '@shared/sync/deviceProtocol';
import { parseDeviceSyncPairingUrl } from '@shared/sync/pairingProtocol';
import type { LiveFocusCommand, LiveFocusSnapshotResponse } from '@shared/sync/liveFocusProtocol';
import type { SyncedTask, TaskSnapshotResponse } from '@shared/sync/taskSnapshotProtocol';
import { APP_COMMIT, APP_VERSION } from '@shared/version';
import {
  applyDeviceSyncChanges,
  clearCachedLiveFocusSnapshot,
  clearMobileCache,
  completeOfflineFocusRuntime,
  readCachedLiveFocusSnapshot,
  readCachedTaskSnapshot,
  readMobileCache,
  readOfflineFocusRuntime,
  readPendingDeviceSyncBundles,
  removePendingDeviceSyncBundle,
  writeOfflineFocusRuntime,
  writeCachedLiveFocusSnapshot,
  writeCachedTaskSnapshot,
  type MobileCacheSnapshot,
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
  readNativeFocusStatus,
  setNativeImmersiveSystemBars,
  subscribeToNativeFocusCommands,
  updateNativeFocusSnapshot,
  type NativeFocusCommand,
} from './nativeFocusRuntime';
import {
  clearSavedToken,
  getOrCreateDeviceId,
  loadConnectionPreferences,
  saveConnectionPreferences,
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
  exchangeDeviceSyncPairingCode,
  fetchTaskSnapshot,
  isInvalidDeviceSyncCursorError,
  pullDeviceSyncPage,
  pushPendingDeviceSyncBundle,
  sendLiveFocusCommand,
  waitForLiveFocusSnapshot,
} from './syncClient';
import { TaskBrowser } from './TaskBrowser';
import { MobileConfirmDialog } from './MobileConfirmDialog';
import {
  commandAckNotice,
  nativeCommandAckNotice,
  restoreCachedLiveSnapshot,
  shouldApplyLiveSnapshot,
  type LiveSnapshotSource,
} from './liveSnapshotPolicy';

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
  const [draft, setDraft] = useState(initialPreferences);
  const [cache, setCache] = useState<MobileCacheSnapshot>(EMPTY_CACHE);
  const [cacheReady, setCacheReady] = useState(false);
  const [configOpen, setConfigOpen] = useState(() => !initialPreferences.endpoint);
  const [pendingPairingCode, setPendingPairingCode] = useState('');
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

  const deviceId = useRef(getOrCreateDeviceId()).current;
  const preferencesRef = useRef(preferences);
  const cacheRef = useRef(cache);
  const liveSnapshotRef = useRef(liveSnapshot);
  const offlineRuntimeRef = useRef<OfflineFocusRuntime | null>(null);
  const liveConnectionRef = useRef(liveConnection);
  const pendingCommandRef = useRef<MobileFocusCommand | null>(null);
  const ledgerRequest = useRef<AbortController | null>(null);
  const ledgerGeneration = useRef(0);
  const liveRequest = useRef<AbortController | null>(null);
  const liveGeneration = useRef(0);
  const taskRequest = useRef<AbortController | null>(null);
  const taskGeneration = useRef(0);
  const cacheMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const nativeQueueRunning = useRef(false);
  const lastResumeRefreshAt = useRef(0);
  const connectionKeyRef = useRef(connectionKey(initialPreferences));
  const consumedPairingNoncesRef = useRef(new Set<string>());

  useEffect(() => {
    applyMobileAppearance(appearance);
    saveMobileAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    let disposed = false;
    let removeListener: (() => Promise<void>) | undefined;
    const acceptPairingUrl = (rawUrl: string) => {
      const pairing = parseDeviceSyncPairingUrl(rawUrl);
      if (!pairing) {
        setCommandNotice('配对二维码无效或已过期，请在电脑端重新生成');
        return;
      }
      if (consumedPairingNoncesRef.current.has(pairing.nonce)) return;
      consumedPairingNoncesRef.current.add(pairing.nonce);
      setCommandNotice('已读取电脑配对信息，正在保存并连接');
      void exchangeDeviceSyncPairingCode({
        endpoint: pairing.endpoint,
        code: pairing.nonce,
        deviceId,
      })
        .then(async (token) => {
          const next: MobileConnectionPreferences = {
            endpoint: pairing.endpoint,
            token,
            rememberToken: true,
          };
          saveConnectionPreferences(next);
          await configureNativeFocusConnection(next.endpoint, next.token, deviceId);
          preferencesRef.current = next;
          connectionKeyRef.current = connectionKey(next);
          setPreferences(next);
          setDraft(next);
          setPendingPairingCode('');
          setConfigOpen(false);
          setConnectionEpoch((value) => value + 1);
          setCommandNotice('电脑配对已完成，正在确认多端实时状态');
        })
        .catch((error) => {
          consumedPairingNoncesRef.current.delete(pairing.nonce);
          setDraft((current) => ({ ...current, endpoint: pairing.endpoint }));
          setPendingPairingCode(pairing.nonce);
          setConfigOpen(true);
          setCommandNotice(errorMessage(error));
        });
    };
    void CapacitorApp.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      acceptPairingUrl(event.url);
    }).then((handle) => {
      if (disposed) void handle.remove();
      else removeListener = () => handle.remove();
    });
    void CapacitorApp.getLaunchUrl().then((result) => {
      if (!disposed && result?.url) acceptPairingUrl(result.url);
    });
    return () => {
      disposed = true;
      if (removeListener) void removeListener();
    };
  }, [deviceId]);

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
      if (offlineRuntimeRef.current) return liveSnapshotRef.current;
      const mapped = mapLiveSnapshot(response, Date.now());
      const current = liveSnapshotRef.current;
      if (!shouldApplyLiveSnapshot(current, mapped)) return current;
      liveSnapshotRef.current = mapped;
      setLiveSnapshot(mapped);
      setLiveSnapshotSource('server');
      try {
        await enqueueMutation(cacheMutationQueue, () => writeCachedLiveFocusSnapshot(mapped));
      } catch (error) {
        setCommandNotice(`实时状态已更新，但本机缓存失败：${errorMessage(error)}`);
      }
      return mapped;
    },
    [],
  );

  const refreshTasks = useCallback(async (connection: MobileConnectionPreferences) => {
    taskRequest.current?.abort();
    const controller = new AbortController();
    const generation = taskGeneration.current + 1;
    taskGeneration.current = generation;
    taskRequest.current = controller;
    const isCurrent = () =>
      taskGeneration.current === generation &&
      taskRequest.current === controller &&
      !controller.signal.aborted;
    try {
      const response = await fetchTaskSnapshot({
        endpoint: connection.endpoint,
        token: connection.token,
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      setTaskSnapshot(response);
      await enqueueMutation(cacheMutationQueue, async () => {
        if (isCurrent()) await writeCachedTaskSnapshot(response);
      });
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return;
      setCommandNotice(
        (current) => current ?? `任务清单刷新失败：${errorMessage(error)}；继续使用本机缓存`,
      );
    } finally {
      if (taskRequest.current === controller) taskRequest.current = null;
    }
  }, []);

  const flushPendingUploads = useCallback(
    async (connection: MobileConnectionPreferences, signal?: AbortSignal): Promise<number> => {
      const pending = await readPendingDeviceSyncBundles();
      setPendingUploadCount(pending.length);
      let uploaded = 0;
      for (const record of pending) {
        const response = await pushPendingDeviceSyncBundle({
          endpoint: connection.endpoint,
          token: connection.token,
          deviceId,
          signal,
          mutation: {
            opId: record.opId,
            entity: DEVICE_SYNC_ENTITY,
            entityId: record.entityId,
            kind: 'put',
            baseRevision: 0,
            payload: record.bundle,
          },
        });
        const ack = response.acks[0];
        if (ack.status !== 'applied' && ack.status !== 'duplicate') {
          throw new Error(`离线会话补传未确认：${ack.errorCode ?? ack.status}`);
        }
        await removePendingDeviceSyncBundle(record.opId);
        uploaded += 1;
        setPendingUploadCount(pending.length - uploaded);
      }
      return uploaded;
    },
    [deviceId],
  );

  const pullLedger = useCallback(
    async (connection: MobileConnectionPreferences, startCursor: string | null) => {
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
        !controller.signal.aborted;

      let cursor = startCursor;
      let pages = 0;
      let changeCount = 0;
      let fullyPulled = false;
      let cursorReset = false;

      try {
        const uploaded = await flushPendingUploads(connection, controller.signal);
        if (uploaded > 0 && isCurrent()) {
          setLedgerNotice(`已补传 ${uploaded} 场离线会话，正在拉取完整账本…`);
        }
        while (pages < 50) {
          let response;
          try {
            response = await pullDeviceSyncPage({
              endpoint: connection.endpoint,
              token: connection.token,
              deviceId,
              cursor,
              signal: controller.signal,
            });
          } catch (error) {
            if (
              !cursorReset &&
              pages === 0 &&
              cursor !== null &&
              isInvalidDeviceSyncCursorError(error)
            ) {
              await enqueueMutation(cacheMutationQueue, clearMobileCache);
              if (!isCurrent()) return;
              cursorReset = true;
              cursor = null;
              cacheRef.current = EMPTY_CACHE;
              setCache(EMPTY_CACHE);
              setLedgerNotice('检测到同步身份变化，正在重建本机账本…');
              continue;
            }
            throw error;
          }
          if (!isCurrent()) return;
          if (response.hasMore && response.nextCursor === cursor) {
            throw new Error('同步服务声明仍有数据，但游标没有前进');
          }
          await enqueueMutation(cacheMutationQueue, async () => {
            if (!isCurrent()) return;
            await applyDeviceSyncChanges(
              response.changes,
              response.nextCursor,
              response.serverTime,
            );
          });
          if (!isCurrent()) return;
          cursor = response.nextCursor;
          pages += 1;
          changeCount += response.changes.length;
          if (!response.hasMore) {
            fullyPulled = true;
            break;
          }
        }
        if (!fullyPulled) throw new Error('本次拉取页数达到安全上限，请再次拉取以继续');

        const snapshot = await readMobileCache();
        if (!isCurrent()) return;
        cacheRef.current = snapshot;
        setCache(snapshot);
        setPullState('confirmed');
        setLedgerNotice(
          changeCount > 0
            ? `账本拉取已确认：处理 ${changeCount} 条变更，现有 ${snapshot.bundles.length} 场会话`
            : `账本拉取已确认：没有新变更，保留 ${snapshot.bundles.length} 场会话`,
        );
      } catch (error) {
        if (!isCurrent() || isAbortError(error)) return;
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
    [deviceId, flushPendingUploads],
  );

  useEffect(() => {
    preferencesRef.current = preferences;
    connectionKeyRef.current = connectionKey(preferences);
    if (preferences.endpoint && preferences.token) {
      void configureNativeFocusConnection(preferences.endpoint, preferences.token, deviceId).catch(
        () => setCommandNotice('Android 后台连接配置失败；前台同步仍可继续'),
      );
    }
    // A non-remembered WebView token lives in sessionStorage and can disappear when
    // Android reclaims the renderer. That must not silently erase the encrypted native
    // connection which still powers an active notification. Explicit token removal and
    // cache reset paths clear the native connection themselves.
  }, [deviceId, preferences]);

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  useEffect(() => {
    let active = true;
    const generation = ledgerGeneration.current;
    void Promise.all([
      readMobileCache(),
      readCachedLiveFocusSnapshot(),
      readCachedTaskSnapshot(),
      readOfflineFocusRuntime(),
      readPendingDeviceSyncBundles(),
    ])
      .then(([ledger, cachedLive, cachedTasks, savedOfflineRuntime, pendingUploads]) => {
        if (!active || ledgerGeneration.current !== generation) return;
        cacheRef.current = ledger;
        setCache(ledger);
        const restoredLive = savedOfflineRuntime
          ? offlineRuntimeSnapshot(savedOfflineRuntime, deviceId)
          : restoreCachedLiveSnapshot(cachedLive, initialConnectionConfigured);
        if (savedOfflineRuntime) {
          offlineRuntimeRef.current = savedOfflineRuntime;
          setOfflineRuntime(savedOfflineRuntime);
          setLiveSnapshotSource('local');
        }
        if (restoredLive) {
          liveSnapshotRef.current = restoredLive;
          setLiveSnapshot(restoredLive);
          if (!savedOfflineRuntime) setLiveSnapshotSource('cache');
        }
        setPendingUploadCount(pendingUploads.length);
        if (cachedTasks) setTaskSnapshot(cachedTasks);
        setLedgerNotice(
          ledger.bundles.length > 0
            ? `已从本机缓存载入 ${ledger.bundles.length} 场会话`
            : '本机还没有已结束会话',
        );
      })
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
      taskGeneration.current += 1;
      ledgerRequest.current?.abort();
      liveRequest.current?.abort();
      taskRequest.current?.abort();
    };
  }, [deviceId, initialConnectionConfigured]);

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
    if (offlineRuntimeRef.current) {
      setConnectionState('offline');
      return;
    }
    if (!online) {
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
          const mapped = await commitLiveSnapshot(response, connectionKey(preferences));
          if (!isCurrent()) return;
          if (!mapped) return;
          lastRevision = mapped.revision;
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
    void updateNativeFocusSnapshot(snapshot, liveConnection === 'live').catch(() => {
      // Native controls are optional; Web/PWA live sync remains usable if the bridge is absent.
    });
  }, [liveConnection, liveSnapshot]);

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
    if (nativeQueueRunning.current || liveConnectionRef.current !== 'live') return;
    nativeQueueRunning.current = true;
    try {
      const commands = await drainNativeFocusCommands();
      for (const nativeCommand of commands) {
        const connection = preferencesRef.current;
        if (!connection.endpoint || !connection.token || liveConnectionRef.current !== 'live') {
          break;
        }
        try {
          const sourceConnectionKey = connectionKey(connection);
          const response = await sendNativeCommand(connection, deviceId, nativeCommand);
          const committed = await commitLiveSnapshot(response, sourceConnectionKey);
          if (!committed || connectionKeyRef.current !== sourceConnectionKey) break;
          if (
            response.ack.status === 'applied' ||
            response.ack.status === 'duplicate' ||
            response.ack.status === 'conflict' ||
            response.ack.status === 'rejected'
          ) {
            await completeNativeFocusCommands([nativeCommand.id]);
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
  }, [commitLiveSnapshot, deviceId, pullLedger]);

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
      const sourceConnectionKey = connectionKey(connection);
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
        action === 'start' &&
        !offlineRuntimeRef.current &&
        snapshot.state === 'idle' &&
        (liveSnapshotSource === 'cache' || liveSnapshotSource === 'server') &&
        liveConnectionRef.current !== 'live' &&
        Boolean(connection.endpoint && connection.token);
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
            await writeOfflineFocusRuntime(nextRuntime);
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
            await completeOfflineFocusRuntime(bundle);
            nextRuntime = null;
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
      pendingCommandRef.current = action;
      setPendingCommand(action);
      setCommandNotice(null);
      try {
        const response = await sendLiveFocusCommand({
          endpoint: connection.endpoint,
          token: connection.token,
          deviceId,
          command,
        });
        const committed = await commitLiveSnapshot(response, sourceConnectionKey);
        if (!committed || connectionKeyRef.current !== sourceConnectionKey) return;
        setCommandNotice(commandAckNotice(action, command.expectedRevision, response));
        if (response.ack.status === 'applied' || response.ack.status === 'duplicate') {
          if (action === 'start') setTitleDraft('');
          if (action === 'start') setSelectedTaskId('');
          if (action === 'finish') void pullLedger(connection, cacheRef.current.cursor);
        }
      } catch (error) {
        if (!isAbortError(error)) setCommandNotice(errorMessage(error));
      } finally {
        pendingCommandRef.current = null;
        setPendingCommand(null);
      }
    },
    [
      commitLiveSnapshot,
      deviceId,
      liveSnapshotSource,
      online,
      pullLedger,
      selectedTaskId,
      taskSnapshot,
      titleDraft,
    ],
  );

  const handleSaveAndConnect = async () => {
    try {
      const next = {
        ...draft,
        endpoint: normalizeDeviceSyncEndpoint(draft.endpoint),
        token: draft.token.trim(),
      };
      if (!next.token) throw new Error('请填写访问令牌');
      const connectionChanged =
        preferencesRef.current.endpoint !== next.endpoint ||
        preferencesRef.current.token !== next.token;
      if (connectionChanged && (offlineRuntimeRef.current || pendingUploadCount > 0)) {
        throw new Error('还有本机离线会话未补传，请先恢复原连接并完成同步后再更换账号或地址');
      }
      if (connectionChanged) {
        connectionKeyRef.current = `switching:${crypto.randomUUID()}`;
        ledgerGeneration.current += 1;
        liveGeneration.current += 1;
        taskGeneration.current += 1;
        ledgerRequest.current?.abort();
        liveRequest.current?.abort();
        taskRequest.current?.abort();
        await enqueueMutation(cacheMutationQueue, clearMobileCache);
        cacheRef.current = EMPTY_CACHE;
        liveSnapshotRef.current = null;
        setCache(EMPTY_CACHE);
        setLiveSnapshot(null);
        setLiveSnapshotSource('none');
        setTaskSnapshot(null);
        setSelectedTaskId('');
      }
      saveConnectionPreferences(next);
      preferencesRef.current = next;
      connectionKeyRef.current = connectionKey(next);
      setPreferences(next);
      setDraft(next);
      setPendingPairingCode('');
      setConfigOpen(false);
      setCommandNotice('连接参数已保存，正在确认实时状态');
      setConnectionEpoch((value) => value + 1);
    } catch (error) {
      connectionKeyRef.current = connectionKey(preferencesRef.current);
      setCommandNotice(errorMessage(error));
      setConnectionState('error');
    }
  };

  const handleRetry = () => {
    if (!preferences.endpoint || !preferences.token) {
      setConfigOpen(true);
      setCommandNotice('请先配置同步服务');
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

  const handleForgetToken = () => {
    if (offlineRuntimeRef.current || pendingUploadCount > 0) {
      setCommandNotice('还有本机离线会话未补传，暂不能移除访问令牌');
      return;
    }
    ledgerGeneration.current += 1;
    liveGeneration.current += 1;
    taskGeneration.current += 1;
    ledgerRequest.current?.abort();
    liveRequest.current?.abort();
    taskRequest.current?.abort();
    clearSavedToken();
    const next = { ...preferencesRef.current, token: '', rememberToken: false };
    preferencesRef.current = next;
    connectionKeyRef.current = connectionKey(next);
    setPreferences(next);
    setDraft(next);
    liveSnapshotRef.current = null;
    setLiveSnapshot(null);
    setLiveSnapshotSource('none');
    setConnectionState('unconfigured');
    setConfigOpen(true);
    setCommandNotice('访问令牌已移除；已结束账本缓存仍保留');
    void enqueueMutation(cacheMutationQueue, clearCachedLiveFocusSnapshot);
    void clearNativeFocusConnection();
  };

  const handleClearCache = async () => {
    if (offlineRuntimeRef.current) {
      setCommandNotice('本机离线专注仍在进行，结束本轮后才能清除缓存');
      return;
    }
    ledgerGeneration.current += 1;
    liveGeneration.current += 1;
    taskGeneration.current += 1;
    ledgerRequest.current?.abort();
    liveRequest.current?.abort();
    taskRequest.current?.abort();
    try {
      await enqueueMutation(cacheMutationQueue, clearMobileCache);
      cacheRef.current = EMPTY_CACHE;
      liveSnapshotRef.current = null;
      setCache(EMPTY_CACHE);
      setLiveSnapshot(null);
      setLiveSnapshotSource('none');
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
          <div>
            <p className="eyebrow">FOCUSLINK</p>
            <div className="brand-title-line">
              <h1>多端专注</h1>
              <span
                className="build-identity"
                aria-label={`应用版本 ${APP_VERSION}，构建 ${APP_COMMIT}`}
                title={`FocusLink ${APP_VERSION} · ${APP_COMMIT}`}
              >
                v{APP_VERSION} · {formatBuildIdentity(APP_COMMIT)}
              </span>
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
                  {pendingUploadCount > 0 ? ` · ${pendingUploadCount} 场待联网补传` : ''}
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
                allowOfflineStart={
                  offlineRuntime === null &&
                  (liveSnapshot?.state ?? 'idle') === 'idle' &&
                  (liveSnapshotSource === 'cache' || liveSnapshotSource === 'server') &&
                  liveConnection !== 'live' &&
                  configured
                }
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
                  (liveSnapshot?.state ?? 'idle') === 'idle' &&
                  pendingCommand === null &&
                  (liveConnection === 'live' ||
                    ((liveSnapshotSource === 'cache' || liveSnapshotSource === 'server') &&
                      configured))
                }
                onSelect={(task) => {
                  setSelectedTaskId(task.id);
                  setTitleDraft(task.title);
                  setActiveView('focus');
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
                endpoint={preferences.endpoint}
                hasToken={Boolean(preferences.token)}
                taskCount={taskSnapshot?.snapshot?.tasks.length ?? 0}
                taskRevision={taskSnapshot?.revision ?? 0}
                ledgerCount={cache.bundles.length}
                onOpenConnection={() => setConfigOpen(true)}
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
            value={draft}
            syncing={pullState === 'pulling' || liveConnection === 'connecting'}
            hasSavedToken={Boolean(preferences.token)}
            deviceId={deviceId}
            initialPairingCode={pendingPairingCode}
            onChange={setDraft}
            onClose={() => {
              setPendingPairingCode('');
              setConfigOpen(false);
            }}
            onSave={() => void handleSaveAndConnect()}
            onForgetToken={handleForgetToken}
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
  if (state === 'offline') return '当前离线 · 控制已锁定';
  if (state === 'error') return '实时连接中断 · 自动重试中';
  return '尚未配置多端连接';
}

function connectionKey(
  connection: Pick<MobileConnectionPreferences, 'endpoint' | 'token'>,
): string {
  return `${connection.endpoint}\u0000${connection.token}`;
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

function formatBuildIdentity(commit: string): string {
  const clean = commit.replace(/-dirty$/, '');
  return `${clean.slice(0, 8)}${commit.endsWith('-dirty') ? '*' : ''}`;
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
