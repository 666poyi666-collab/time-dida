// 专注控制台：任务上下文、计时与账本数据保持在同一视觉层级。
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
    { label: string; dotCls: string; pillCls: string; pulse?: boolean }
  > = {
    idle: {
      label: '未开始',
      dotCls: 'bg-fg-subtle',
      pillCls: 'border-border/50 bg-bg-subtle/40 text-fg-muted',
    },
    running: {
      label: '专注中',
      dotCls: 'bg-success',
      pillCls: 'border-success/18 bg-success/7 text-success',
      pulse: true,
    },
    paused: {
      label: '已暂停',
      dotCls: 'bg-pause',
      pillCls: 'border-pause/20 bg-pause/8 text-pause',
    },
    finished: {
      label: '已结束',
      dotCls: 'bg-success',
      pillCls: 'border-success/18 bg-success/7 text-success',
    },
    stopping: {
      label: '结束中',
      dotCls: 'bg-fg-subtle',
      pillCls: 'border-accent/12 bg-accent/7 text-accent',
    },
  };
  const c = config[state] ?? config.idle;

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.92, y: -3 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: 2 }}
      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      className={`status-chip px-2.5 py-1 text-[11.5px] ${c.pillCls}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${c.dotCls} ${c.pulse ? 'motion-dot-breathe' : ''}`}
        />
      </span>
      {c.label}
    </motion.span>
  );
}

// ─── 累计统计胶囊 ─────────────────────────────────────────────

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
    <div className="stat-pill min-w-0 border-l border-border/60 px-4 first:border-l-0 first:pl-0 last:pr-0">
      <div className={`flex items-center gap-1.5 ${toneCls}`}>
        {icon}
        <span className="text-[11.5px] font-medium text-fg-subtle">{label}</span>
      </div>
      <span className="timer-digit motion-digit mt-1 block text-[16px] font-semibold text-fg">
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

  const timeColorCls =
    state === 'paused' ? 'text-pause' : state === 'running' ? 'text-fg' : 'text-fg-muted';

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

  return (
    <div
      className="focus-console mx-auto flex h-full w-full max-w-[720px] flex-col"
      data-state={state}
    >
      <div className="focus-console-header flex items-center justify-between gap-4">
        <AnimatePresence mode="wait" initial={false}>
          <StateBadge key={state} state={state} />
        </AnimatePresence>
        <motion.div
          layout
          className="timer-context-strip relative flex min-w-0 flex-1 items-center gap-2.5 rounded-[14px] px-2.5 py-2"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        >
          <span
            className={`timer-context-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${
              hasContextTask ? 'text-fg-muted' : 'text-fg-subtle'
            }`}
          >
            {hasContextTask ? <Icon.Target size="sm" /> : <Icon.Inbox size="sm" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] font-medium text-fg-subtle">{contextSourceLabel}</div>
            <div
              className={`mt-0.5 truncate text-[13.5px] font-medium ${hasContextTask ? 'text-fg' : 'text-fg-subtle'}`}
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

      <div className="timer-face relative flex flex-1 flex-col items-center justify-center py-3 text-center">
        <div className="timer-orbit-system" aria-hidden="true">
          <span className="timer-orbit timer-orbit-outer" />
          <span className="timer-orbit timer-orbit-middle" />
          <span className="timer-orbit timer-orbit-inner" />
          <span className="timer-orbit-axis timer-orbit-axis-a" />
          <span className="timer-orbit-axis timer-orbit-axis-b" />
          <span className="timer-orbit-node timer-orbit-node-a" />
          <span className="timer-orbit-node timer-orbit-node-b" />
          <span className="timer-orbit-node timer-orbit-node-c" />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={state}
            className="timer-mode-caption relative z-10"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {state === 'running'
              ? '保持专注'
              : state === 'paused'
                ? '暂停计时'
                : state === 'finished'
                  ? '本轮完成'
                  : '准备进入专注'}
          </motion.span>
        </AnimatePresence>
        <motion.div
          className={`timer-digit timer-primary relative z-10 text-[clamp(72px,7.6vw,108px)] font-medium leading-none tracking-[-0.065em] ${timeColorCls}`}
          animate={{ scale: state === 'paused' ? 0.985 : 1, y: state === 'paused' ? 1 : 0 }}
          transition={{ type: 'spring', stiffness: 360, damping: 30 }}
        >
          <FlipDigits value={formatDurationPadded(currentSegmentMs)} />
        </motion.div>
        <div className="timer-state-signal" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>

      <div className="timer-controls mx-auto flex w-full max-w-[500px] items-center gap-2">
        <button
          className={`${mainActionClass} motion-press flex min-h-[46px] flex-1 items-center justify-center gap-2 text-[12.5px]`}
          onClick={handleToggle}
          disabled={state === 'stopping'}
        >
          {state === 'running' ? <Icon.Pause size="sm" /> : <Icon.Play size="sm" />}
          {toggleLabel}
        </button>
        <button
          className="btn-outline timer-stop-action motion-press flex min-h-[46px] items-center gap-2 px-4 text-[11.5px]"
          onClick={handleStop}
          disabled={isIdle || isFinished || state === 'stopping'}
        >
          <Icon.Square size="xs" />
          结束
        </button>
      </div>

      <div className="timer-stats mx-auto mt-6 grid w-full max-w-[560px] grid-cols-3">
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
