// 手表端（OPPO OWW221，189×248 dp）：只做三件事——选任务、开始专注、结束专注。
//
// 不复用 MobileApp：那是为 393dp+ 屏幕设计的完整控制台（账本、统计、设置、
// 连接面板），在 189dp 上压缩它只会得到一屏折行。手表要的是一块「远程表盘」：
// 大读数 + 一两个按钮，其余全部不进屏幕。
//
// 登录方式：由配对手机确认，云端为手表签发独立设备凭据。手表不显示地址、令牌
// 或配对码，只显示“从手机登录”和等待确认状态。
import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeDeviceSyncEndpoint } from '@shared/sync/deviceProtocol';
import type { LiveFocusCommand } from '@shared/sync/liveFocusProtocol';
import type { SyncedTask } from '@shared/sync/taskSnapshotProtocol';
import {
  fetchLiveFocusSnapshot,
  fetchTaskSnapshot,
  sendLiveFocusCommand,
  waitForLiveFocusSnapshot,
} from './syncClient';
import { ownerAccountBootstrapApi, type OwnerAccountSession } from './accountBootstrap';
import {
  configureNativeFocusConnection,
  isNativeFocusRuntimeAvailable,
  restoreOrMigrateNativeFocusConnection,
} from './nativeFocusRuntime';
import {
  getOrCreateDeviceId,
  getOrCreateInstallationId,
  loadConnectionPreferences,
  rememberAssignedDeviceId,
  saveConnectionPreferences,
  type MobileConnectionPreferences,
} from './preferences';
import {
  formatClockDuration,
  idleLiveFocusSnapshot,
  liveStateLabel,
  projectLiveFocusDurations,
  type LiveFocusSnapshotLike,
} from './runtimeModel';
import { flattenSyncedTaskTree } from './taskBrowserModel';
import './watch.css';

type WatchView = 'main' | 'tasks';
type WatchConnection = 'unconfigured' | 'connecting' | 'live' | 'error';

function mapSnapshot(
  response: Awaited<ReturnType<typeof fetchLiveFocusSnapshot>>,
  observedAt: number,
): LiveFocusSnapshotLike {
  const { snapshot, serverTime } = response;
  if (!snapshot.session) return idleLiveFocusSnapshot(snapshot.revision, serverTime, observedAt);
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

export function WatchApp() {
  const [deviceId, setDeviceId] = useState(() => getOrCreateDeviceId());
  const [preferences, setPreferences] = useState<MobileConnectionPreferences>(() =>
    loadConnectionPreferences(),
  );
  const configured = Boolean(preferences.endpoint && preferences.token);
  const [connection, setConnection] = useState<WatchConnection>(
    configured ? 'connecting' : 'unconfigured',
  );
  const [snapshot, setSnapshot] = useState<LiveFocusSnapshotLike | null>(null);
  const [tasks, setTasks] = useState<SyncedTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<SyncedTask | null>(null);
  const [view, setView] = useState<WatchView>('main');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [waitingForPhone, setWaitingForPhone] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Restore the Keystore credential on every native launch. For an upgrade
  // from an older build, migrate the legacy WebView copy first and purge it
  // only after the native store confirms the write.
  useEffect(() => {
    if (!isNativeFocusRuntimeAvailable()) return;
    let disposed = false;
    const legacyPreferences = preferencesRef.current;
    void restoreOrMigrateNativeFocusConnection(
      legacyPreferences.endpoint && legacyPreferences.token
        ? {
            endpoint: normalizeDeviceSyncEndpoint(legacyPreferences.endpoint),
            accessToken: legacyPreferences.token,
            deviceId,
          }
        : null,
    )
      .then((nativeConnection) => {
        if (disposed || !nativeConnection) return;
        const next: MobileConnectionPreferences = {
          endpoint: normalizeDeviceSyncEndpoint(nativeConnection.endpoint),
          token: nativeConnection.accessToken,
          rememberToken: true,
        };
        saveConnectionPreferences(next);
        if (nativeConnection.deviceId.startsWith('device-')) {
          rememberAssignedDeviceId(nativeConnection.deviceId);
        }
        setDeviceId(nativeConnection.deviceId);
        preferencesRef.current = next;
        setPreferences(next);
        setConnection('connecting');
      })
      .catch(() => {
        if (!disposed) setNotice('账号恢复失败，请重新从手机登录');
      });
    return () => {
      disposed = true;
    };
  }, [deviceId]);

  // 秒针：活跃且停留在主视图时才逐秒外推读数；idle 或任务选择页停表省电，
  // 也避免整份任务列表跟着秒针每秒重渲染。回到主视图先立即校准一次。
  useEffect(() => {
    if (!snapshot || snapshot.state === 'idle' || view !== 'main') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [snapshot, view]);

  // 长轮询实时状态：断线退避重试，不弹任何全屏面板。
  useEffect(() => {
    if (!configured) return;
    let disposed = false;
    const controller = new AbortController();
    const run = async () => {
      let revision = -1;
      while (!disposed) {
        try {
          const input = {
            endpoint: preferencesRef.current.endpoint,
            token: preferencesRef.current.token,
            signal: controller.signal,
          };
          if (revision < 0) {
            const first = await fetchLiveFocusSnapshot(input);
            if (disposed) return;
            revision = first.snapshot.revision;
            setSnapshot(mapSnapshot(first, Date.now()));
            setConnection('live');
            continue;
          }
          const next = await waitForLiveFocusSnapshot({ ...input, afterRevision: revision });
          if (disposed) return;
          revision = next.snapshot.revision;
          if (next.changed) setSnapshot(mapSnapshot(next, Date.now()));
          setConnection('live');
        } catch {
          if (disposed) return;
          setConnection('error');
          revision = -1;
          await new Promise((resolve) => setTimeout(resolve, 5_000));
        }
      }
    };
    void run();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [configured, preferences.endpoint, preferences.token]);

  // 任务快照：连接建立后拉一次，进入选择页时刷新。
  const refreshTasks = useCallback(() => {
    const current = preferencesRef.current;
    if (!current.endpoint || !current.token) return;
    void fetchTaskSnapshot({ endpoint: current.endpoint, token: current.token })
      .then((response) => setTasks(response.snapshot?.tasks ?? []))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (connection === 'live') refreshTasks();
  }, [connection, refreshTasks]);

  const applyOwnerSession = useCallback(async (session: OwnerAccountSession) => {
    const next = {
      endpoint: normalizeDeviceSyncEndpoint(session.endpoint),
      token: session.accessToken,
      rememberToken: true,
    };
    await configureNativeFocusConnection(next.endpoint, next.token, session.deviceId);
    saveConnectionPreferences(next);
    rememberAssignedDeviceId(session.deviceId);
    setDeviceId(session.deviceId);
    preferencesRef.current = next;
    setPreferences(next);
    setConnection('connecting');
    setWaitingForPhone(false);
    setNotice(null);
  }, []);

  const requestPhoneLogin = useCallback(async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    try {
      const result = await ownerAccountBootstrapApi().bootstrap({
        installationId: getOrCreateInstallationId(),
        deviceKind: 'watch',
        displayName: 'FocusLink OPPO Watch',
      });
      if (result.status === 'authenticated') {
        await applyOwnerSession(result.session);
        return;
      }
      setWaitingForPhone(true);
      setNotice(
        result.status === 'waiting-for-phone'
          ? '等待手机确认…'
          : '请在手机上打开 FocusLink 并确认登录',
      );
    } catch {
      setWaitingForPhone(false);
      setNotice('暂时无法申请登录，请重试');
    } finally {
      setAccountBusy(false);
    }
  }, [accountBusy, applyOwnerSession]);

  useEffect(() => {
    if (!waitingForPhone || configured || accountBusy) return;
    const timer = window.setTimeout(() => void requestPhoneLogin(), 3_000);
    return () => window.clearTimeout(timer);
  }, [accountBusy, configured, requestPhoneLogin, waitingForPhone]);

  const sendCommand = useCallback(
    async (action: 'start' | 'pause' | 'resume' | 'finish') => {
      const current = snapshotRef.current;
      const prefs = preferencesRef.current;
      if (!current || !prefs.endpoint || !prefs.token || busy) return;
      const commandId = `command_${crypto.randomUUID()}`;
      const command: LiveFocusCommand =
        action === 'start'
          ? {
              commandId,
              action,
              expectedRevision: current.revision,
              sessionId: `live_${crypto.randomUUID()}`,
              title: selectedTask ? selectedTask.title : null,
              task: selectedTask
                ? {
                    taskId: selectedTask.id,
                    taskSource: selectedTask.source,
                    taskTitle: selectedTask.title,
                  }
                : null,
            }
          : {
              commandId,
              action,
              expectedRevision: current.revision,
              sessionId: current.sessionId ?? '',
            };
      setBusy(true);
      setNotice(null);
      try {
        const response = await sendLiveFocusCommand({
          endpoint: prefs.endpoint,
          token: prefs.token,
          deviceId,
          command,
        });
        setSnapshot(mapSnapshot(response, Date.now()));
      } catch {
        setNotice('指令未送达，请重试');
      } finally {
        setBusy(false);
      }
    },
    [busy, deviceId, selectedTask],
  );

  const state = snapshot?.state ?? 'idle';
  const durations = snapshot
    ? projectLiveFocusDurations(snapshot, now)
    : { activeElapsedMs: 0, pauseElapsedMs: 0, wallElapsedMs: 0 };
  const readoutMs = state === 'paused' ? durations.pauseElapsedMs : durations.activeElapsedMs;
  const activeTitle =
    state === 'idle'
      ? (selectedTask?.title ?? '自由专注')
      : (snapshot?.taskTitle ?? snapshot?.title ?? '专注中');

  if (view === 'tasks') {
    const entries = flattenSyncedTaskTree(tasks);
    return (
      <div className="watch-shell watch-tasks">
        <header className="watch-tasks-header">
          <button type="button" onClick={() => setView('main')}>
            返回
          </button>
          <span>选择任务</span>
        </header>
        <div className="watch-task-list">
          <button
            type="button"
            className={selectedTask === null ? 'is-selected' : ''}
            onClick={() => {
              setSelectedTask(null);
              setView('main');
            }}
          >
            自由专注
          </button>
          {entries.map(({ task, depth }) => (
            <button
              key={`${task.source}:${task.id}`}
              type="button"
              className={selectedTask?.id === task.id ? 'is-selected' : ''}
              style={{ paddingLeft: `${10 + depth * 12}px` }}
              onClick={() => {
                setSelectedTask(task);
                setView('main');
              }}
            >
              {task.title}
            </button>
          ))}
          {entries.length === 0 && <p className="watch-task-empty">电脑端刷新任务后同步到这里</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={`watch-shell watch-main watch-state-${state}`}>
      <p className="watch-state-line">
        <i className={`watch-dot conn-${connection}`} aria-hidden="true" />
        {connection === 'unconfigured'
          ? '未登录'
          : connection === 'error'
            ? '连接中断'
            : liveStateLabel(state)}
      </p>

      <div className="watch-clock-cell">
        <strong className="watch-clock">{formatClockDuration(readoutMs)}</strong>
        {state !== 'idle' && (
          <p className="watch-subline">
            专注 <b>{formatClockDuration(durations.activeElapsedMs)}</b> · 暂停{' '}
            <em>{formatClockDuration(durations.pauseElapsedMs)}</em>
          </p>
        )}
      </div>

      {notice && connection !== 'unconfigured' ? (
        <p className="watch-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : connection === 'unconfigured' ? (
        <div className="watch-login">
          <p className="watch-hint" role="status" aria-live="polite">
            {notice ?? '用已登录的手机确认一次即可'}
          </p>
          <button type="button" disabled={accountBusy} onClick={() => void requestPhoneLogin()}>
            {accountBusy ? '正在申请…' : waitingForPhone ? '重新申请' : '从手机登录'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="watch-task-line"
          onClick={() => {
            if (state === 'idle') {
              refreshTasks();
              setView('tasks');
            }
          }}
          disabled={state !== 'idle'}
        >
          {activeTitle}
        </button>
      )}

      {configured && (
        <div className="watch-actions">
          {state === 'idle' && (
            <button
              type="button"
              className="watch-primary"
              disabled={busy || connection !== 'live'}
              onClick={() => void sendCommand('start')}
            >
              开始专注
            </button>
          )}
          {state === 'running' && (
            <>
              <button type="button" disabled={busy} onClick={() => void sendCommand('pause')}>
                暂停
              </button>
              <button
                type="button"
                className="watch-finish"
                disabled={busy}
                onClick={() => void sendCommand('finish')}
              >
                结束
              </button>
            </>
          )}
          {state === 'paused' && (
            <>
              <button
                type="button"
                className="watch-primary"
                disabled={busy}
                onClick={() => void sendCommand('resume')}
              >
                继续
              </button>
              <button
                type="button"
                className="watch-finish"
                disabled={busy}
                onClick={() => void sendCommand('finish')}
              >
                结束
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
