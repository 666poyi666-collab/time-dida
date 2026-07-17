// 专注控制台：58/42 双区 —— 左侧「安静的桌面时间仪器」（任务意图、细刻度仪表、
// 84px 主计时数字、主操作、累计三行），右侧「本次专注账本」（SegmentTimeline）。
// 计时逻辑、任务关联逻辑、状态机全部保持原样，仅重排 JSX 结构与 className。
import { useEffect, useState, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '../../ui/Icon';
import { FlipDigits } from '../../ui/FlipDigits';
import { useStore } from '../../app/store';
import { formatDuration, formatDurationPadded } from '../../lib/time';
import {
  getMainDisplayMs,
  getCumulativeActiveMs,
  getCumulativePauseMs,
  getWallElapsedMs,
} from '@shared/focus/selectors';
import type { TimerSnapshot, Task } from '@shared/types';
import { TaskPicker } from '../tasks/TaskPicker';
import { TimerDial } from './TimerDial';
import { SegmentTimeline } from './SegmentTimeline';

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
      currentSegmentMs: getMainDisplayMs(snapshot, now),
      cumulativeActiveMs: getCumulativeActiveMs(snapshot, now),
      cumulativePauseMs: getCumulativePauseMs(snapshot, now),
      wallMs: getWallElapsedMs(snapshot, now),
    }),
    [snapshot, now],
  );
}

// ─── 状态字（减重后的状态区：小圆点 + 文字，无 chip）────────────

function StateBadge({ state }: { state: string }) {
  const config: Record<
    string,
    { label: string; dotCls: string; toneCls: string; pulse?: boolean }
  > = {
    idle: { label: '准备专注', dotCls: 'bg-fg-subtle', toneCls: '' },
    running: {
      label: '专注中',
      dotCls: 'bg-success',
      toneCls: 'tone-running',
      pulse: true,
    },
    paused: { label: '已暂停', dotCls: 'bg-pause', toneCls: 'tone-paused' },
    finished: { label: '已结束', dotCls: 'bg-success', toneCls: 'tone-finished' },
    stopping: { label: '结束中', dotCls: 'bg-fg-subtle', toneCls: 'tone-stopping' },
  };
  const c = config[state] ?? config.idle;

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.94, y: -2 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 2 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`status-chip ${c.toneCls}`}
      role="status"
      aria-live="polite"
    >
      <span
        className={`inline-flex h-1.5 w-1.5 rounded-full ${c.dotCls} ${c.pulse ? 'motion-dot-breathe' : ''}`}
      />
      {c.label}
    </motion.span>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────

export function TimerPanel() {
  const {
    snapshot,
    addToast,
    pendingTask,
    setPendingTask,
    taskPickerRequest,
    consumeTaskPickerRequest,
  } = useStore();
  const { currentSegmentMs, cumulativeActiveMs, cumulativePauseMs, wallMs } =
    useDisplayValues(snapshot);
  const [pickerMode, setPickerMode] = useState<'segment' | 'session' | 'preselect' | null>(null);

  const state = snapshot?.state ?? 'idle';
  const isRunning = state === 'running' || state === 'paused';
  const segmentOrdinal = Math.max(1, snapshot?.segments.length ?? 1);

  const currentSegmentTaskId = useMemo(() => {
    if (!snapshot?.currentSegmentId || !snapshot.segments) return null;
    const seg = snapshot.segments.find((s) => s.id === snapshot.currentSegmentId);
    return { taskId: seg?.taskId ?? null, title: seg?.taskTitle ?? seg?.title ?? null };
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
      ? '暂停专注'
      : state === 'paused'
        ? '继续专注'
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
    ? (currentSegmentTaskId?.title ?? sessionDefaultTitle)
    : (pendingTask?.title ?? null);
  const contextSourceLabel = isRunning
    ? currentSegmentTaskId?.title
      ? '当前片段任务'
      : sessionDefaultTitle
        ? '本次默认任务'
        : '当前任务'
    : '即将专注任务';
  const hasSegmentTask = !!currentSegmentTaskId?.title;
  const hasContextTask = !!contextTitle;
  const canClearContext = isRunning ? hasSegmentTask : !!pendingTask;
  const canSetSessionDefault = isRunning && hasSegmentTask && !sessionDefaultTitle;
  const canClearSessionDefault = isRunning && !hasSegmentTask && !!sessionDefaultTitle;
  const mainActionClass =
    state === 'running' ? 'timer-btn-main is-pause' : 'timer-btn-main is-start';
  const sessionStartedAt = snapshot?.segments[0]?.startedAt ?? null;
  const stateMoment =
    state === 'running'
      ? formatClockTime(sessionStartedAt)
      : state === 'paused'
        ? formatClockTime(snapshot?.currentPauseStartedAt)
        : null;
  const stateMomentLabel = state === 'paused' ? '暂停于' : '开始于';
  const showLedger = (snapshot?.segments.length ?? 0) > 0;

  return (
    <div className={`focus-console ${showLedger ? 'with-ledger' : 'solo'}`} data-state={state}>
      <section className="focus-instrument">
        {/* 当前任务意图区：安静小字标签 + 任务标题 + 幽灵操作 */}
        <motion.div
          layout
          className="timer-context-strip"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        >
          <div className="timer-context-label">{contextSourceLabel}</div>
          <div className={`timer-context-title ${hasContextTask ? '' : 'is-empty'}`}>
            {contextTitle ?? '未选择任务'}
          </div>
          <div className="timer-context-actions">
            <button
              className="timer-context-action motion-press"
              onClick={() => setPickerMode(isRunning ? 'segment' : 'preselect')}
              title={isRunning ? '关联或更换当前片段任务' : '选择即将专注的任务'}
            >
              <Icon.Search size="xs" />
              {isRunning ? (hasContextTask ? '更换' : '关联') : '选择'}
            </button>
            {canSetSessionDefault && (
              <button
                className="timer-icon-action motion-press"
                onClick={() => setPickerMode('session')}
                title="设为本次默认任务"
                aria-label="设为本次默认任务"
              >
                <Icon.Star size="xs" />
              </button>
            )}
            {canClearContext && (
              <button
                className="timer-icon-action danger motion-press"
                onClick={isRunning ? handleClearSegmentTask : handleClearPreselect}
                title={isRunning ? '清除当前片段任务' : '清除预选任务'}
                aria-label={isRunning ? '清除当前片段任务' : '清除预选任务'}
              >
                <Icon.X size="xs" />
              </button>
            )}
            {canClearSessionDefault && (
              <button
                className="timer-icon-action danger motion-press"
                onClick={handleClearSessionDefault}
                title="清除本次默认任务"
                aria-label="清除本次默认任务"
              >
                <Icon.Unlink size="xs" />
              </button>
            )}
          </div>
        </motion.div>

        {/* 计时仪表 + 主计时数字 + 当前片段行 */}
        <div className="timer-instrument">
          <TimerDial state={state} displayMs={currentSegmentMs} />
          <motion.div
            className="timer-digit timer-primary"
            animate={{ opacity: state === 'paused' ? 0.84 : 1, y: state === 'paused' ? 2 : 0 }}
            transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
          >
            <FlipDigits value={formatDurationPadded(currentSegmentMs)} />
          </motion.div>
          <div className="timer-readout-meta">
            <AnimatePresence mode="wait" initial={false}>
              <StateBadge key={state} state={state} />
            </AnimatePresence>
            <span className="timer-segment-index">
              片段 {String(segmentOrdinal).padStart(2, '0')}
            </span>
            {stateMoment && (
              <span className="timer-state-time">
                <Icon.Clock size="xs" />
                {stateMomentLabel} {stateMoment}
              </span>
            )}
          </div>
          <div className="timer-activity-rail" aria-hidden="true">
            <span />
            <i />
          </div>
        </div>

        {/* 主操作区：暂停/继续 与 结束 并排 */}
        <div className="timer-controls">
          <button
            className={mainActionClass}
            onClick={handleToggle}
            disabled={state === 'stopping'}
          >
            {state === 'running' ? <Icon.Pause size="sm" /> : <Icon.Play size="sm" />}
            {toggleLabel}
          </button>
          <button
            className="timer-btn-stop timer-stop-action"
            onClick={handleStop}
            disabled={isIdle || isFinished || state === 'stopping'}
          >
            <Icon.Square size="xs" />
            结束
          </button>
        </div>

        {/* 累计区：三行同一垂直线，发丝线分隔 */}
        <div className="timer-totals">
          <div className="timer-total-row tone-focus">
            <span className="timer-total-label">累计专注</span>
            <span className="timer-total-value timer-digit">
              {formatDuration(cumulativeActiveMs)}
            </span>
          </div>
          <div className="timer-total-row tone-pause">
            <span className="timer-total-label">累计暂停</span>
            <span className="timer-total-value timer-digit">
              {formatDuration(cumulativePauseMs)}
            </span>
          </div>
          <div className="timer-total-row tone-wall">
            <span className="timer-total-label">总历时</span>
            <span className="timer-total-value timer-digit">{formatDuration(wallMs)}</span>
          </div>
        </div>
      </section>

      <AnimatePresence initial={false}>
        {showLedger && (
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
    </div>
  );
}
