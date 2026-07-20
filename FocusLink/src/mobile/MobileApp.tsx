import { useCallback, useEffect, useRef, useState } from 'react';

import { normalizeDeviceSyncEndpoint } from '@shared/sync/deviceProtocol';
import type { LiveFocusCommand, LiveFocusSnapshotResponse } from '@shared/sync/liveFocusProtocol';
import { APP_COMMIT, APP_VERSION } from '@shared/version';
import {
  applyDeviceSyncChanges,
  clearCachedLiveFocusSnapshot,
  clearMobileCache,
  readCachedLiveFocusSnapshot,
  readMobileCache,
  writeCachedLiveFocusSnapshot,
  type MobileCacheSnapshot,
} from './cache';
import { ConnectionSheet } from './ConnectionSheet';
import { FocusConsole, type MobileFocusCommand } from './FocusConsole';
import {
  completeNativeFocusCommands,
  drainNativeFocusCommands,
  nativeFocusCommandSuccessCopy,
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
import { SessionLedger } from './SessionLedger';
import {
  fetchLiveFocusSnapshot,
  pullDeviceSyncPage,
  sendLiveFocusCommand,
  waitForLiveFocusSnapshot,
} from './syncClient';

type PullState = 'idle' | 'pulling' | 'confirmed' | 'error';

const EMPTY_CACHE: MobileCacheSnapshot = {
  bundles: [],
  cursor: null,
  lastSyncAt: null,
  serverTime: null,
};

export function MobileApp() {
  const initialPreferences = useRef(loadConnectionPreferences()).current;
  const [preferences, setPreferences] = useState(initialPreferences);
  const [draft, setDraft] = useState(initialPreferences);
  const [cache, setCache] = useState<MobileCacheSnapshot>(EMPTY_CACHE);
  const [cacheReady, setCacheReady] = useState(false);
  const [configOpen, setConfigOpen] = useState(() => !initialPreferences.endpoint);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pullState, setPullState] = useState<PullState>('idle');
  const [ledgerNotice, setLedgerNotice] = useState('正在读取本机会话账本…');
  const [liveSnapshot, setLiveSnapshot] = useState<LiveFocusSnapshotLike | null>(null);
  const [liveConnection, setLiveConnection] = useState<LiveConnectionState>(
    initialPreferences.endpoint && initialPreferences.token ? 'connecting' : 'unconfigured',
  );
  const [titleDraft, setTitleDraft] = useState('');
  const [pendingCommand, setPendingCommand] = useState<MobileFocusCommand | null>(null);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [connectionEpoch, setConnectionEpoch] = useState(0);

  const deviceId = useRef(getOrCreateDeviceId()).current;
  const preferencesRef = useRef(preferences);
  const cacheRef = useRef(cache);
  const liveSnapshotRef = useRef(liveSnapshot);
  const liveConnectionRef = useRef(liveConnection);
  const pendingCommandRef = useRef<MobileFocusCommand | null>(null);
  const ledgerRequest = useRef<AbortController | null>(null);
  const ledgerGeneration = useRef(0);
  const liveRequest = useRef<AbortController | null>(null);
  const liveGeneration = useRef(0);
  const cacheMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const nativeQueueRunning = useRef(false);

  const setConnectionState = useCallback((state: LiveConnectionState) => {
    liveConnectionRef.current = state;
    setLiveConnection(state);
  }, []);

  const commitLiveSnapshot = useCallback(
    async (response: LiveFocusSnapshotResponse): Promise<LiveFocusSnapshotLike> => {
      const mapped = mapLiveSnapshot(response, Date.now());
      liveSnapshotRef.current = mapped;
      setLiveSnapshot(mapped);
      try {
        await enqueueMutation(cacheMutationQueue, () => writeCachedLiveFocusSnapshot(mapped));
      } catch (error) {
        setCommandNotice(`实时状态已更新，但本机缓存失败：${errorMessage(error)}`);
      }
      return mapped;
    },
    [],
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

      try {
        while (pages < 50) {
          const response = await pullDeviceSyncPage({
            endpoint: connection.endpoint,
            token: connection.token,
            deviceId,
            cursor,
            signal: controller.signal,
          });
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
    [deviceId],
  );

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  useEffect(() => {
    let active = true;
    const generation = ledgerGeneration.current;
    void Promise.all([readMobileCache(), readCachedLiveFocusSnapshot()])
      .then(([ledger, cachedLive]) => {
        if (!active || ledgerGeneration.current !== generation) return;
        cacheRef.current = ledger;
        setCache(ledger);
        if (cachedLive) {
          liveSnapshotRef.current = cachedLive;
          setLiveSnapshot(cachedLive);
        }
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
      ledgerRequest.current?.abort();
      liveRequest.current?.abort();
    };
  }, []);

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
    if (!cacheReady || !online || !preferences.endpoint || !preferences.token) return;
    void pullLedger(preferences, cacheRef.current.cursor);
  }, [cacheReady, connectionEpoch, online, preferences, pullLedger]);

  useEffect(() => {
    liveRequest.current?.abort();
    const configured = Boolean(preferences.endpoint && preferences.token);
    if (!configured) {
      setConnectionState('unconfigured');
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
          const mapped = await commitLiveSnapshot(response);
          if (!isCurrent()) return;
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
  }, [commitLiveSnapshot, connectionEpoch, online, preferences, setConnectionState]);

  useEffect(() => {
    const snapshot = liveSnapshot ?? makeIdleSnapshot();
    void updateNativeFocusSnapshot(snapshot, liveConnection === 'live').catch(() => {
      // Native controls are optional; Web/PWA live sync remains usable if the bridge is absent.
    });
  }, [liveConnection, liveSnapshot]);

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
          const response = await sendNativeCommand(connection, deviceId, nativeCommand);
          await commitLiveSnapshot(response);
          if (
            response.ack.status === 'applied' ||
            response.ack.status === 'duplicate' ||
            response.ack.status === 'conflict' ||
            response.ack.status === 'rejected'
          ) {
            await completeNativeFocusCommands([nativeCommand.id]);
          }
          if (response.ack.status === 'applied' || response.ack.status === 'duplicate') {
            setCommandNotice(nativeFocusCommandSuccessCopy(nativeCommand));
            if (nativeCommand.type === 'finish') {
              void pullLedger(connection, cacheRef.current.cursor);
            }
          } else {
            setCommandNotice('系统动作已过期，已刷新另一设备确认的最新状态');
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
    async (action: MobileFocusCommand) => {
      if (pendingCommandRef.current) return;
      const snapshot = liveSnapshotRef.current ?? makeIdleSnapshot();
      const connection = preferencesRef.current;
      if (liveConnectionRef.current !== 'live' || !connection.endpoint || !connection.token) {
        setCommandNotice('实时连接尚未确认，当前不会提交控制');
        return;
      }

      const title = titleDraft.trim();
      if (action === 'start' && !title) {
        setCommandNotice('请先填写本次专注标题');
        return;
      }
      if (action !== 'start' && !snapshot.sessionId) {
        setCommandNotice('当前没有可控制的活动会话');
        return;
      }

      const command = makeUiCommand(action, snapshot, title);
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
        await commitLiveSnapshot(response);
        if (response.ack.status === 'applied' || response.ack.status === 'duplicate') {
          setCommandNotice(commandSuccessCopy(action));
          if (action === 'start') setTitleDraft('');
          if (action === 'finish') void pullLedger(connection, cacheRef.current.cursor);
        } else if (response.ack.status === 'conflict') {
          setCommandNotice('状态已由另一设备更新，本机已刷新到最新版本');
        } else {
          setCommandNotice(commandRejectionCopy(response.ack.errorCode));
        }
      } catch (error) {
        if (!isAbortError(error)) setCommandNotice(errorMessage(error));
      } finally {
        pendingCommandRef.current = null;
        setPendingCommand(null);
      }
    },
    [commitLiveSnapshot, deviceId, pullLedger, titleDraft],
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

      if (connectionChanged) {
        ledgerGeneration.current += 1;
        liveGeneration.current += 1;
        ledgerRequest.current?.abort();
        liveRequest.current?.abort();
        await enqueueMutation(cacheMutationQueue, clearMobileCache);
        cacheRef.current = EMPTY_CACHE;
        liveSnapshotRef.current = null;
        setCache(EMPTY_CACHE);
        setLiveSnapshot(null);
      }
      saveConnectionPreferences(next);
      preferencesRef.current = next;
      setPreferences(next);
      setDraft(next);
      setConfigOpen(false);
      setCommandNotice('连接参数已保存，正在确认实时状态');
      setConnectionEpoch((value) => value + 1);
    } catch (error) {
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

  const handleForgetToken = () => {
    ledgerGeneration.current += 1;
    liveGeneration.current += 1;
    ledgerRequest.current?.abort();
    liveRequest.current?.abort();
    clearSavedToken();
    const next = { ...preferencesRef.current, token: '', rememberToken: false };
    preferencesRef.current = next;
    setPreferences(next);
    setDraft(next);
    liveSnapshotRef.current = null;
    setLiveSnapshot(null);
    setConnectionState('unconfigured');
    setConfigOpen(true);
    setCommandNotice('访问令牌已移除；已结束账本缓存仍保留');
    void enqueueMutation(cacheMutationQueue, clearCachedLiveFocusSnapshot);
    void updateNativeFocusSnapshot(makeIdleSnapshot(), false);
  };

  const handleClearCache = async () => {
    if (!window.confirm('清除此设备中的会话账本、实时快照和同步游标？云端数据不会被删除。')) {
      return;
    }
    ledgerGeneration.current += 1;
    liveGeneration.current += 1;
    ledgerRequest.current?.abort();
    liveRequest.current?.abort();
    try {
      await enqueueMutation(cacheMutationQueue, clearMobileCache);
      cacheRef.current = EMPTY_CACHE;
      liveSnapshotRef.current = null;
      setCache(EMPTY_CACHE);
      setLiveSnapshot(null);
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
        <button className="icon-button" type="button" onClick={() => setConfigOpen(true)}>
          <SettingsIcon />
          <span>连接</span>
        </button>
      </header>

      <main>
        <section
          className={`sync-strip state-${syncTone(liveConnection, pullState)}`}
          aria-live="polite"
        >
          <span className={`network-dot ${online ? 'online' : 'offline'}`} aria-hidden="true" />
          <div className="sync-copy">
            <strong>{connectionTitle(liveConnection)}</strong>
            <span>{ledgerNotice}</span>
          </div>
          <button
            className="sync-button"
            type="button"
            onClick={handleRetry}
            disabled={pullState === 'pulling' || liveConnection === 'connecting' || !online}
          >
            <RefreshIcon spinning={pullState === 'pulling' || liveConnection === 'connecting'} />
            {liveConnection === 'connecting' ? '连接中' : '刷新'}
          </button>
        </section>

        <div className="mobile-workspace">
          <FocusConsole
            snapshot={liveSnapshot}
            connection={liveConnection}
            titleDraft={titleDraft}
            pendingCommand={pendingCommand}
            commandNotice={commandNotice}
            localDeviceId={deviceId}
            onTitleChange={setTitleDraft}
            onCommand={(command) => void handleCommand(command)}
            onOpenConnection={() => setConfigOpen(true)}
          />
          <SessionLedger
            records={cache.bundles}
            ready={cacheReady}
            configured={configured}
            lastSyncAt={cache.lastSyncAt}
            cursor={cache.cursor}
          />
        </div>
      </main>

      {configOpen && (
        <ConnectionSheet
          value={draft}
          syncing={pullState === 'pulling' || liveConnection === 'connecting'}
          hasSavedToken={Boolean(preferences.token)}
          onChange={setDraft}
          onClose={() => setConfigOpen(false)}
          onSave={() => void handleSaveAndConnect()}
          onForgetToken={handleForgetToken}
          onClearCache={() => void handleClearCache()}
        />
      )}
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
    updatedAt: session.updatedAt,
    serverTime,
    observedAt,
    activeElapsedMs: session.activeElapsedMs,
    pauseElapsedMs: session.pauseElapsedMs,
    wallElapsedMs: session.wallElapsedMs,
    currentStateStartedAt:
      session.state === 'paused' ? session.currentPauseStartedAt : session.updatedAt,
    title: session.title,
    ownerDeviceId: session.lastCommandDeviceId,
  };
}

function makeUiCommand(
  action: MobileFocusCommand,
  snapshot: LiveFocusSnapshotLike,
  title: string,
): LiveFocusCommand {
  const commandId = `command_${crypto.randomUUID()}`;
  if (action === 'start') {
    return {
      commandId,
      action,
      expectedRevision: snapshot.revision,
      sessionId: `live_${crypto.randomUUID()}`,
      title,
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

function syncTone(connection: LiveConnectionState, pull: PullState): PullState {
  if (connection === 'error' || connection === 'offline' || pull === 'error') return 'error';
  if (connection === 'connecting' || pull === 'pulling') return 'pulling';
  if (connection === 'live') return 'confirmed';
  return 'idle';
}

function commandSuccessCopy(action: MobileFocusCommand): string {
  if (action === 'start') return '云端已确认开始，本轮已同步到所有在线设备';
  if (action === 'pause') return '云端已确认暂停';
  if (action === 'resume') return '云端已确认继续';
  return '云端已确认结束，正在收敛已结束账本';
}

function commandRejectionCopy(errorCode: string | null): string {
  if (errorCode === 'active_session_exists') return '另一设备已有活动会话，本机已刷新状态';
  if (errorCode === 'session_mismatch' || errorCode === 'no_active_session') {
    return '这条操作已过期，本机已刷新最新状态';
  }
  if (errorCode === 'not_running' || errorCode === 'not_paused') {
    return '当前状态不接受这条操作，本机已刷新最新状态';
  }
  return errorCode ? `云端拒绝操作：${errorCode}` : '云端拒绝了这条操作';
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
