// 专注控制台：hero 式计时排版 —— 状态字幕、超大数字、克制的控制组与三格统计。
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

// ─── 状态徽章 ─────────────────────────────────────────────────

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

// ─── 累计统计格 ───────────────────────────────────────────────

function StatPill({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: 'accent' | 'success' | 'pause' | 'warning' | 'info' | 'neutral' | 'danger';
}) {
  const toneCls = {
    accent: 'text-accent',
    success: 'text-success',
    pause: 'text-pause',
    warning: 'text-warning',
    info: 'text-info',
    neutral: 'text-fg-subtle',
    danger: 'text-danger',
  }[tone];
  return (
    <div className="stat-pill min-w-0">
      <div className={`flex items-center gap-1.5 ${toneCls}`}>
        {icon}
        <span className="text-[11px] font-medium tracking-[0.02em] text-fg-subtle">{label}</span>
      </div>
      <span className="stat-pill-value timer-digit mt-1.5 block text-[17px] font-semibold text-fg">
        {value}
      </span>
    </div>
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
    state === 'running'
      ? 'btn-pause-action'
      : state === 'paused' || state === 'idle' || state === 'finished'
        ? 'btn-focus-action'
        : 'btn-primary';
  const sessionStartedAt = snapshot?.segments[0]?.startedAt ?? null;
  const stateMoment =
    state === 'running'
      ? formatClockTime(sessionStartedAt)
      : state === 'paused'
        ? formatClockTime(snapshot?.currentPauseStartedAt)
        : null;
  const stateMomentLabel = state === 'paused' ? '暂停于' : '开始于';

  return (
    <div
      className="focus-console mx-auto flex h-full w-full max-w-[680px] flex-col"
      data-state={state}
    >
      <div className="focus-console-header flex items-center justify-between gap-3">
        <AnimatePresence mode="wait" initial={false}>
          <StateBadge key={state} state={state} />
        </AnimatePresence>
        <motion.div
          layout
          className="timer-context-strip relative flex min-w-0 flex-1 items-center gap-2.5 rounded-[12px] px-2.5 py-1.5"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        >
          <span
            className={`timer-context-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] ${
              hasContextTask ? 'text-fg-muted' : 'text-fg-subtle'
            }`}
          >
            {hasContextTask ? <Icon.Target size="sm" /> : <Icon.Inbox size="sm" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-medium tracking-[0.02em] text-fg-subtle">
              {contextSourceLabel}
            </div>
            <div
              className={`truncate text-[12.5px] font-medium ${hasContextTask ? 'text-fg' : 'text-fg-subtle'}`}
            >
              {contextTitle ?? '未选择任务'}
            </div>
          </div>
          <button
            className="timer-context-action motion-press shrink-0"
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
        </motion.div>
      </div>

      <div className="timer-face relative flex flex-1 flex-col justify-center">
        <span className="timer-hero-glow" aria-hidden="true" />
        <div className="timer-readout">
          <div className="timer-readout-kicker">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={state}
                className="timer-mode-caption"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                {state === 'running'
                  ? '正在记录专注'
                  : state === 'paused'
                    ? '本次暂停已持续'
                    : state === 'finished'
                      ? '本轮专注完成'
                      : '准备开始记录'}
              </motion.span>
            </AnimatePresence>
            <span className="timer-readout-meta">
              {stateMoment && (
                <span className="timer-state-time">
                  <Icon.Clock size="xs" />
                  {stateMomentLabel} {stateMoment}
                </span>
              )}
              <span className="timer-segment-index">
                片段 {String(segmentOrdinal).padStart(2, '0')}
              </span>
            </span>
          </div>
          <motion.div
            className="timer-digit timer-primary relative z-10"
            animate={{ opacity: state === 'paused' ? 0.84 : 1, y: state === 'paused' ? 2 : 0 }}
            transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
          >
            <FlipDigits value={formatDurationPadded(currentSegmentMs)} />
          </motion.div>
          <div className="timer-activity-rail" aria-hidden="true">
            <span />
            <i />
          </div>
        </div>
      </div>

      <div className="timer-controls mx-auto flex w-full max-w-[520px] items-center gap-2.5">
        <button
          className={`${mainActionClass} motion-press flex flex-1 items-center justify-center gap-2`}
          onClick={handleToggle}
          disabled={state === 'stopping'}
        >
          {state === 'running' ? <Icon.Pause size="sm" /> : <Icon.Play size="sm" />}
          {toggleLabel}
        </button>
        <button
          className="btn-outline timer-stop-action motion-press flex min-h-[50px] items-center gap-2 px-5 text-[12px]"
          onClick={handleStop}
          disabled={isIdle || isFinished || state === 'stopping'}
        >
          <Icon.Square size="xs" />
          结束
        </button>
      </div>

      <div className="timer-stats mx-auto mt-7 grid w-full max-w-[560px] grid-cols-3">
        <StatPill
          label="累计专注"
          value={formatDuration(cumulativeActiveMs)}
          icon={<Icon.Activity size="xs" />}
          tone="success"
        />
        <StatPill
          label="累计暂停"
          value={formatDuration(cumulativePauseMs)}
          icon={<Icon.Coffee size="xs" />}
          tone={state === 'paused' ? 'pause' : 'neutral'}
        />
        <StatPill
          label="总历时"
          value={formatDuration(wallMs)}
          icon={<Icon.Route size="xs" />}
          tone="neutral"
        />
      </div>

      {pickerMode && pickerConfig && (
        <TaskPicker onPick={pickerConfig.onPick} title={pickerConfig.title} />
      )}
    </div>
  );
}
