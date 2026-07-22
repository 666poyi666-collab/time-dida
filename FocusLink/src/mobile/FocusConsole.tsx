import { useEffect, useMemo, useState } from 'react';
import {
  compactDeviceId,
  formatClockDuration,
  idleLiveFocusSnapshot,
  liveConnectionCopy,
  liveStateLabel,
  projectLiveFocusDurations,
  runtimeControlAvailability,
  type LiveConnectionState,
  type LiveFocusSnapshotLike,
} from './runtimeModel';
import type { SyncedTask } from '@shared/sync/taskSnapshotProtocol';
import type { LiveSnapshotSource } from './liveSnapshotPolicy';
import { MobileConfirmDialog } from './MobileConfirmDialog';

export type MobileFocusCommand = 'start' | 'pause' | 'resume' | 'finish';

export interface FocusConsoleProps {
  snapshot: LiveFocusSnapshotLike | null;
  connection: LiveConnectionState;
  titleDraft: string;
  pendingCommand: MobileFocusCommand | null;
  commandNotice: string | null;
  localDeviceId: string;
  tasks: readonly SyncedTask[];
  selectedTaskId: string;
  onTaskChange: (taskId: string) => void;
  onTitleChange: (value: string) => void;
  onCommand: (command: MobileFocusCommand) => void;
  onOpenConnection: () => void;
  onOpenTasks: () => void;
  snapshotSource: LiveSnapshotSource;
}

export function FocusConsole({
  snapshot,
  connection,
  titleDraft,
  pendingCommand,
  commandNotice,
  localDeviceId,
  tasks,
  selectedTaskId,
  onTaskChange,
  onTitleChange,
  onCommand,
  onOpenConnection,
  onOpenTasks,
  snapshotSource,
}: FocusConsoleProps) {
  const [now, setNow] = useState(() => Date.now());
  const [finishDialogOpen, setFinishDialogOpen] = useState(false);
  const current = snapshot ?? idleLiveFocusSnapshot(0, now);
  const active = current.state !== 'idle';

  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    let timer = 0;
    const schedule = () => {
      const delay = 1_000 - (Date.now() % 1_000) + 12;
      timer = window.setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [active, current.revision, current.serverTime, current.state]);

  const durations = useMemo(() => projectLiveFocusDurations(current, now), [current, now]);
  const controls = runtimeControlAvailability({
    snapshot: current,
    connection,
    pending: pendingCommand !== null,
    title: titleDraft,
  });
  const connectionCopy = liveConnectionCopy(connection, snapshot !== null);
  const recentDevice =
    current.ownerDeviceId === localDeviceId ? '此设备' : compactDeviceId(current.ownerDeviceId);
  const showingCachedSnapshot = snapshotSource === 'cache' && connection !== 'live';

  const requestFinish = () => {
    if (!controls.finish) return;
    setFinishDialogOpen(true);
  };

  return (
    <section
      className={`focus-console phase-${current.state}`}
      aria-labelledby="focus-console-title"
    >
      <header className="focus-console-header">
        <div>
          <p className="eyebrow">LIVE FOCUS</p>
          <h2 id="focus-console-title">当前专注</h2>
        </div>
        <span className="focus-state-chip" key={current.state}>
          <i aria-hidden="true" />
          {showingCachedSnapshot
            ? `缓存 · ${liveStateLabel(current.state)}`
            : liveStateLabel(current.state)}
        </span>
      </header>

      <div className="focus-console-body">
        <div className="focus-instrument">
          {active ? (
            <div className="active-title-block">
              <span>专注标题</span>
              <strong>{current.title?.trim() || '未命名专注'}</strong>
            </div>
          ) : (
            <div className="focus-start-fields">
              <div className="focus-title-field">
                <span>从电脑任务清单选择</span>
                <div className="focus-task-picker">
                  <button type="button" onClick={onOpenTasks} disabled={pendingCommand !== null}>
                    <span>
                      {tasks.find((task) => task.id === selectedTaskId)?.title || '浏览电脑任务'}
                    </span>
                    <small>
                      {selectedTaskId
                        ? '已关联'
                        : `${tasks.filter((task) => !task.isCompleted).length} 项待办`}
                    </small>
                  </button>
                  {selectedTaskId && (
                    <button
                      type="button"
                      onClick={() => onTaskChange('')}
                      disabled={pendingCommand !== null}
                    >
                      自由专注
                    </button>
                  )}
                </div>
                <small>
                  {tasks.length > 0
                    ? `已缓存电脑端 ${tasks.length} 个任务`
                    : '电脑刷新任务后会自动同步到这里'}
                </small>
              </div>
              <label className="focus-title-field" htmlFor="focus-title">
                <span>这次要专注什么？</span>
                <input
                  id="focus-title"
                  value={titleDraft}
                  onChange={(event) => onTitleChange(event.target.value)}
                  maxLength={1_000}
                  placeholder="例如：整理化学错题"
                  autoComplete="off"
                  enterKeyHint="done"
                  disabled={pendingCommand !== null}
                  aria-describedby="focus-title-help"
                />
                <small id="focus-title-help">可选任务，也可直接填写标题自由开始。</small>
              </label>
            </div>
          )}

          <div
            className="primary-readout"
            key={current.state}
            aria-label={`${liveStateLabel(current.state)}计时`}
          >
            <span>
              {current.state === 'paused'
                ? '本次暂停'
                : current.state === 'running'
                  ? '有效专注'
                  : '准备开始'}
            </span>
            <strong>{formatClockDuration(durations.primaryElapsedMs)}</strong>
            <small>
              {showingCachedSnapshot
                ? 'LAST CONFIRMED · 等待云端确认，控制已锁定'
                : current.state === 'paused'
                  ? `有效专注 ${formatClockDuration(durations.activeElapsedMs)} 已冻结`
                  : current.state === 'running'
                    ? 'LIVE · 状态按服务端确认时刻逐秒外推'
                    : 'IDLE · 连接云端后由任一设备控制'}
            </small>
          </div>

          <div className="runtime-metrics" aria-label="本轮三时间">
            <RuntimeMetric
              label="有效专注"
              value={formatClockDuration(durations.activeElapsedMs)}
              tone="focus"
            />
            <RuntimeMetric
              label="累计暂停"
              value={formatClockDuration(durations.pauseElapsedMs)}
              tone="pause"
            />
            <RuntimeMetric label="总历时" value={formatClockDuration(durations.wallElapsedMs)} />
          </div>

          <div className="focus-actions">
            {current.state === 'idle' && (
              <button
                className="focus-action primary"
                type="button"
                disabled={!controls.start}
                onClick={() => onCommand('start')}
              >
                {pendingCommand === 'start' ? '正在开始…' : '开始专注'}
              </button>
            )}
            {current.state === 'running' && (
              <button
                className="focus-action pause-action"
                type="button"
                disabled={!controls.pause}
                onClick={() => onCommand('pause')}
              >
                {pendingCommand === 'pause' ? '正在暂停…' : '暂停'}
              </button>
            )}
            {current.state === 'paused' && (
              <button
                className="focus-action primary"
                type="button"
                disabled={!controls.resume}
                onClick={() => onCommand('resume')}
              >
                {pendingCommand === 'resume' ? '正在继续…' : '继续专注'}
              </button>
            )}
            {active && (
              <button
                className="focus-action finish-action"
                type="button"
                disabled={!controls.finish}
                onClick={requestFinish}
              >
                {pendingCommand === 'finish' ? '正在结束…' : '结束本轮'}
              </button>
            )}
          </div>

          {connection !== 'live' && current.state === 'idle' && (
            <button className="inline-connection-action" type="button" onClick={onOpenConnection}>
              配置多端连接
            </button>
          )}
        </div>

        <aside className="live-context" aria-label="多端状态">
          <div className={`connection-callout connection-${connection}`}>
            <span className="network-dot" aria-hidden="true" />
            <div>
              <strong>{connectionCopy.title}</strong>
              <small>{connectionCopy.detail}</small>
            </div>
          </div>

          <dl className="runtime-facts">
            <div>
              <dt>关联任务</dt>
              <dd>{current.taskTitle || '未关联'}</dd>
            </div>
            <div>
              <dt>状态版本</dt>
              <dd>rev {current.revision}</dd>
            </div>
            <div>
              <dt>最近操作设备</dt>
              <dd>{recentDevice}</dd>
            </div>
            <div>
              <dt>状态开始</dt>
              <dd>
                {current.currentStateStartedAt
                  ? formatMoment(current.currentStateStartedAt)
                  : '尚未开始'}
              </dd>
            </div>
          </dl>

          <div className="desktop-delivery-note">
            <strong>第三方投递仅在桌面端操作</strong>
            <p>结束记录会同步回桌面账本；滴答清单与番茄 To-do 需在桌面端操作并确认。</p>
          </div>

          {commandNotice && (
            <p className="command-notice" role="status" aria-live="polite">
              {commandNotice}
            </p>
          )}
        </aside>
      </div>
      <MobileConfirmDialog
        open={finishDialogOpen}
        title="结束本轮专注？"
        description="结束后会生成会话账本，此操作不能继续本轮计时。"
        confirmLabel={pendingCommand === 'finish' ? '正在结束…' : '结束本轮'}
        danger
        onCancel={() => setFinishDialogOpen(false)}
        onConfirm={() => {
          setFinishDialogOpen(false);
          onCommand('finish');
        }}
      />
    </section>
  );
}

function RuntimeMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'focus' | 'pause';
}) {
  return (
    <div className={tone ? `tone-${tone}` : ''}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatMoment(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}
