// 专注工作台：任务、计时仪表、时间之带、账本属于同一连续平面。
// 计时逻辑、任务关联逻辑、状态机全部保持原样。
import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '../../ui/Icon';
import { useStore } from '../../app/store';
import { formatDuration } from '../../lib/time';
import {
  getMainDisplayMs,
  getCumulativeActiveMs,
  getCumulativePauseMs,
  getWallElapsedMs,
} from '@shared/focus/selectors';
import { resolveTimerStyle } from '@shared/theme';
import type { TimerSnapshot, Task } from '@shared/types';
import { TaskPicker } from '../tasks/TaskPicker';
import { SegmentTimeline } from './SegmentTimeline';
import { TemporalRibbon } from './TemporalRibbon';
import { TimerDial } from './TimerDial';

function formatClockTime(timestamp: number | null | undefined): string | null {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function useDisplayValues(snapshot: TimerSnapshot | null) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const state = snapshot?.state;
    if (state !== 'running' && state !== 'paused') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [snapshot?.state, snapshot?.lastTick, snapshot?.currentPauseStartedAt]);

  return useMemo(
    () => ({
      now,
      mainMs: getMainDisplayMs(snapshot, now),
      cumulativeActiveMs: getCumulativeActiveMs(snapshot, now),
      cumulativePauseMs: getCumulativePauseMs(snapshot, now),
      wallMs: getWallElapsedMs(snapshot, now),
    }),
    [snapshot, now],
  );
}

const STATE_WORD: Record<string, string> = {
  idle: '准备专注',
  running: '专注中',
  paused: '已暂停',
  stopping: '结束中',
  finished: '已结束',
};

/** 像素仪表的专注核心充能目标：45 分钟有效专注点亮一整颗核心 */
const CORE_GOAL_MS = 45 * 60_000;

export function TimerPanel() {
  const {
    snapshot,
    settings,
    addToast,
    pendingTask,
    setPendingTask,
    taskPickerRequest,
    consumeTaskPickerRequest,
  } = useStore();
  const { now, mainMs, cumulativeActiveMs, cumulativePauseMs, wallMs } = useDisplayValues(snapshot);
  const [pickerMode, setPickerMode] = useState<'segment' | 'session' | 'preselect' | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(true);

  const state = snapshot?.state ?? 'idle';
  const isRunning = state === 'running' || state === 'paused';
  const segmentOrdinal = Math.max(1, snapshot?.segments.length ?? 1);
  const timerStyle = resolveTimerStyle(settings?.timerStyle);

  const currentSegmentInfo = useMemo(() => {
    if (!snapshot?.currentSegmentId || !snapshot.segments) return null;
    const seg = snapshot.segments.find((s) => s.id === snapshot.currentSegmentId);
    return {
      taskId: seg?.taskId ?? null,
      title: seg?.taskTitle ?? seg?.title ?? null,
      startedAt: seg?.startedAt ?? null,
    };
  }, [snapshot?.currentSegmentId, snapshot?.segments]);

  const sessionDefaultTitle = snapshot?.sessionDefaultTaskTitle ?? null;

  useEffect(() => {
    if ((state === 'running' || state === 'paused' || state === 'stopping') && pendingTask) {
      setPendingTask(null);
    }
  }, [pendingTask, setPendingTask, state]);

  useEffect(() => {
    if (taskPickerRequest <= 0) return;
    setPickerMode(isRunning ? 'segment' : 'preselect');
    consumeTaskPickerRequest();
  }, [consumeTaskPickerRequest, isRunning, taskPickerRequest]);

  const handleToggle = async () => {
    try {
      if (state === 'finished') {
        await window.focuslink.timer.reset();
        if (pendingTask) {
          const snap = await window.focuslink.timer.startWithTask(
            pendingTask.id,
            pendingTask.source,
            pendingTask.title,
          );
          useStore.getState().setSnapshot(snap);
          setPendingTask(null);
          addToast(`已开始新一轮专注：${pendingTask.title}`, 'success');
          return;
        }
        const snap = await window.focuslink.timer.toggle();
        useStore.getState().setSnapshot(snap);
        addToast('已开始新一轮专注', 'success');
        return;
      }
      if (state === 'idle' && pendingTask) {
        const snap = await window.focuslink.timer.startWithTask(
          pendingTask.id,
          pendingTask.source,
          pendingTask.title,
        );
        useStore.getState().setSnapshot(snap);
        setPendingTask(null);
        addToast(`已开始专注：${pendingTask.title}`, 'success');
        return;
      }
      const snap = await window.focuslink.timer.toggle();
      useStore.getState().setSnapshot(snap);
      if (state === 'idle') {
        addToast('已开始专注 · 未关联任务', 'success');
      } else if (state === 'running') {
        useStore.setState((store) => ({
          toasts: store.toasts.filter((toast) => !/^已开始(?:新一轮)?专注/.test(toast.message)),
        }));
      } else if (state === 'paused') {
        addToast('已继续专注', 'success');
      }
    } catch (e) {
      addToast('操作失败：' + (e as Error).message, 'error');
    }
  };

  const handleStop = async () => {
    try {
      const snap = await window.focuslink.timer.stop();
      useStore.getState().setSnapshot(snap);
      addToast('专注已结束', 'success');
    } catch (e) {
      addToast('结束失败：' + (e as Error).message, 'error');
    }
  };

  const handlePickSegment = async (task: Task | null) => {
    setPickerMode(null);
    if (!task) return;
    if (!snapshot?.currentSegmentId) {
      addToast('当前没有进行中的片段', 'info');
      return;
    }
    try {
      await window.focuslink.timer.linkTask(
        snapshot.currentSegmentId,
        task.id,
        task.source,
        task.title,
      );
      addToast(`已关联到当前片段：${task.title}`, 'success');
    } catch (e) {
      addToast('关联失败：' + (e as Error).message, 'error');
    }
  };

  const handlePickSession = async (task: Task | null) => {
    setPickerMode(null);
    if (!task) return;
    if (!snapshot?.sessionId) {
      addToast('当前没有进行中的会话', 'info');
      return;
    }
    try {
      await window.focuslink.timer.linkSessionTask(
        snapshot.sessionId,
        task.id,
        task.source,
        task.title,
      );
      addToast(`已设为本次专注默认任务：${task.title}`, 'success');
    } catch (e) {
      addToast('关联失败：' + (e as Error).message, 'error');
    }
  };

  const handlePickPreselect = (task: Task | null) => {
    setPickerMode(null);
    if (!task) return;
    setPendingTask(task);
    addToast(`已选择即将专注的任务：${task.title}`, 'info');
  };

  const handleClearPreselect = () => setPendingTask(null);

  const handleClearSegmentTask = async () => {
    if (!snapshot?.currentSegmentId) return;
    try {
      await window.focuslink.timer.clearSegmentTask(snapshot.currentSegmentId);
      addToast('已清除当前片段任务关联', 'info');
    } catch (e) {
      addToast('清除失败：' + (e as Error).message, 'error');
    }
  };

  const handleClearSessionDefault = async () => {
    if (!snapshot?.sessionId) return;
    try {
      await window.focuslink.timer.clearSessionDefaultTask(snapshot.sessionId);
      addToast('已清除本次默认任务', 'info');
    } catch (e) {
      addToast('清除失败：' + (e as Error).message, 'error');
    }
  };

  const toggleLabel =
    state === 'running'
      ? '暂停'
      : state === 'paused'
        ? '继续'
        : state === 'finished'
          ? '开始新专注'
          : '开始专注';

  const isIdle = state === 'idle';
  const isFinished = state === 'finished';

  const pickerConfig =
    pickerMode === 'segment'
      ? { onPick: handlePickSegment, title: '关联到当前片段' }
      : pickerMode === 'session'
        ? { onPick: handlePickSession, title: '设为本次专注默认任务' }
        : pickerMode === 'preselect'
          ? { onPick: handlePickPreselect, title: '选择即将专注的任务' }
          : null;

  const contextTitle = isRunning
    ? (currentSegmentInfo?.title ?? sessionDefaultTitle)
    : (pendingTask?.title ?? null);
  const contextSourceLabel = isRunning
    ? currentSegmentInfo?.title
      ? '当前片段任务'
      : sessionDefaultTitle
        ? '本次默认任务'
        : '当前任务'
    : '即将专注任务';
  const hasSegmentTask = !!currentSegmentInfo?.title;
  const hasContextTask = !!contextTitle;
  const canClearContext = isRunning ? hasSegmentTask : !!pendingTask;
  const canSetSessionDefault = isRunning && hasSegmentTask && !sessionDefaultTitle;
  const canClearSessionDefault = isRunning && !hasSegmentTask && !!sessionDefaultTitle;

  const stateMoment =
    state === 'running'
      ? formatClockTime(currentSegmentInfo?.startedAt)
      : state === 'paused'
        ? formatClockTime(snapshot?.currentPauseStartedAt)
        : null;
  const showLedger = (snapshot?.segments.length ?? 0) > 0;

  useEffect(() => {
    if (!immersive) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setImmersive(false);
        void window.focuslink.window.setFullScreen(false);
      }
    };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, [immersive]);

  const enterImmersive = async () => {
    setImmersive(true);
    try {
      await window.focuslink.window.setFullScreen(true);
    } catch {
      // The body-level overlay remains a usable windowed fallback.
    }
  };

  const exitImmersive = async () => {
    setImmersive(false);
    try {
      await window.focuslink.window.setFullScreen(false);
    } catch {
      // The operating system may already have left fullscreen.
    }
  };

  const timerLabel = (
    <div className="timer-readout-meta">
      {state === 'paused' ? (
        <>
          <span className="meta-state paused">已暂停</span>
          {stateMoment && <span>暂停于 {stateMoment}</span>}
          <span>
            有效专注 <b className="timer-digit">{formatDuration(cumulativeActiveMs)}</b> 已冻结
          </span>
        </>
      ) : state === 'running' ? (
        <>
          <span className="meta-state running">有效专注</span>
          {stateMoment && <span>起于 {stateMoment}</span>}
          <span>本轮第 {String(segmentOrdinal).padStart(2, '0')} 段</span>
        </>
      ) : (
        <span className="meta-state">{isFinished ? '上一场已结束' : '准备就绪'}</span>
      )}
    </div>
  );

  const controls = (
    <div className="timer-controls">
      <button
        className={`btn-main-action ${state === 'running' ? 'btn-solid' : 'btn-accent'}`}
        onClick={handleToggle}
        disabled={state === 'stopping'}
      >
        {state === 'running' ? <Icon.Pause size="sm" /> : <Icon.Play size="sm" />}
        {toggleLabel}
      </button>
      <button
        className="btn-outline btn-stop-action"
        onClick={handleStop}
        disabled={isIdle || isFinished || state === 'stopping'}
      >
        <Icon.Square size="xs" />
        结束
      </button>
    </div>
  );

  const totals = (
    <div className="timer-totals">
      <div className="timer-total">
        <span className="timer-total-label">累计专注</span>
        <span className="timer-total-value timer-digit tone-focus">
          {formatDuration(cumulativeActiveMs)}
        </span>
      </div>
      <div className="timer-total">
        <span className="timer-total-label">累计暂停</span>
        <span className="timer-total-value timer-digit tone-pause">
          {formatDuration(cumulativePauseMs)}
        </span>
      </div>
      <div className="timer-total">
        <span className="timer-total-label">总历时</span>
        <span className="timer-total-value timer-digit">{formatDuration(wallMs)}</span>
      </div>
    </div>
  );

  return (
    <div
      className={`focus-console ${showLedger && ledgerOpen ? 'with-ledger' : 'solo ledger-collapsed'}`}
      data-state={state}
    >
      <section className="focus-instrument">
        <header className="focus-header">
          <span className={`focus-state-word state-${state}`}>
            <i className="focus-state-dot" />
            {STATE_WORD[state] ?? STATE_WORD.idle}
          </span>
          <span className="focus-seg-no timer-digit">
            {isRunning ? `片段 ${String(segmentOrdinal).padStart(2, '0')}` : ''}
          </span>
          <div className="focus-header-actions">
            {showLedger && (
              <button
                type="button"
                className="focus-immersive-toggle motion-press"
                onClick={() => setLedgerOpen((open) => !open)}
                aria-pressed={ledgerOpen}
              >
                {ledgerOpen ? '收起账本' : '展开账本'}
              </button>
            )}
            <button
              type="button"
              className="focus-immersive-toggle motion-press"
              onClick={() => void enterImmersive()}
              title="全屏进入沉浸模式"
            >
              <Icon.Maximize size="xs" />
              全屏沉浸
            </button>
          </div>
        </header>

        <div className="timer-context-strip">
          <div className="timer-context-copy">
            <div className="timer-context-label">
              {contextSourceLabel}
              {isRunning && hasContextTask ? ' · 已关联' : ''}
            </div>
            <div
              className={`timer-context-title ${hasContextTask ? '' : 'is-empty'}`}
              title={contextTitle ?? '未选择任务'}
            >
              {contextTitle ?? '给这一段时间一个名字'}
            </div>
          </div>
          <div className="timer-context-actions">
            <button
              className="btn-text"
              onClick={() => setPickerMode(isRunning ? 'segment' : 'preselect')}
            >
              {isRunning ? (hasContextTask ? '更换' : '关联任务') : '选择任务'}
            </button>
            {canSetSessionDefault && (
              <button
                className="btn-text"
                onClick={() => setPickerMode('session')}
                aria-label="设为本次默认任务"
              >
                设为默认
              </button>
            )}
            {canClearContext && (
              <button
                className="btn-text"
                onClick={isRunning ? handleClearSegmentTask : handleClearPreselect}
              >
                清除
              </button>
            )}
            {canClearSessionDefault && (
              <button className="btn-text" onClick={handleClearSessionDefault}>
                清除默认
              </button>
            )}
          </div>
        </div>

        <div className="timer-zone">
          <TimerDial
            ms={mainMs}
            state={state}
            style={timerStyle}
            coreRatio={Math.min(1, cumulativeActiveMs / CORE_GOAL_MS)}
          />
          {timerLabel}
        </div>

        <TemporalRibbon snapshot={snapshot} state={state} now={now} />

        <div className="focus-footer">
          {controls}
          {totals}
        </div>
      </section>

      <AnimatePresence initial={false}>
        {showLedger && ledgerOpen && (
          <motion.aside
            className="session-ledger-pane"
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <SegmentTimeline />
          </motion.aside>
        )}
      </AnimatePresence>

      {pickerMode && pickerConfig && (
        <TaskPicker onPick={pickerConfig.onPick} title={pickerConfig.title} />
      )}

      {immersive &&
        createPortal(
          <div
            className={`focus-immersive instrument-${timerStyle}`}
            data-state={state}
            data-testid="focus-immersive"
          >
            <button className="immersive-exit" onClick={() => void exitImmersive()}>
              Esc 退出 <Icon.X size="xs" />
            </button>
            <main className="immersive-stage">
              <div className="immersive-task" title={contextTitle ?? '未关联任务'}>
                <span>{state === 'paused' ? '暂停中' : '正在专注'}</span>
                <strong>{contextTitle ?? '未关联任务'}</strong>
              </div>
              <div className="immersive-readout">
                <TimerDial
                  ms={mainMs}
                  state={state}
                  style={timerStyle}
                  coreRatio={Math.min(1, cumulativeActiveMs / CORE_GOAL_MS)}
                />
              </div>
              <div className="immersive-meta">{timerLabel}</div>
              <div className="immersive-lower">
                {totals}
                {controls}
              </div>
            </main>
            <div className="immersive-band">
              <TemporalRibbon snapshot={snapshot} state={state} now={now} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
