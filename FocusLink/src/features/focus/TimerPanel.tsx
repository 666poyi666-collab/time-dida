// 专注控制台：58/42 双区 —— 左侧用主读数与线性时间地平线表达正在发生的时间，
// 右侧保留本次专注账本。计时与任务语义不因视觉结构改变。
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
import { SegmentTimeline } from './SegmentTimeline';
import { TemporalRibbon } from './TemporalRibbon';

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
  const { now, currentSegmentMs, cumulativeActiveMs, cumulativePauseMs, wallMs } =
    useDisplayValues(snapshot);
  const [pickerMode, setPickerMode] = useState<'segment' | 'session' | 'preselect' | null>(null);
  const [immersive, setImmersive] = useState(false);

  const state = snapshot?.state ?? 'idle';
  const isRunning = state === 'running' || state === 'paused';
  const segmentOrdinal = Math.max(1, snapshot?.segments.length ?? 1);

  // 当前片段信息：任务关联 + 片段起点（元信息行的「起于」锚点用）
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
  const mainActionClass =
    state === 'running' ? 'timer-btn-main btn-pause' : 'timer-btn-main btn-accent';
  // 时间锚点：running 显示当前片段起点（区别于整场开始），paused 显示本次暂停起点
  const stateMoment =
    state === 'running'
      ? formatClockTime(currentSegmentInfo?.startedAt)
      : state === 'paused'
        ? formatClockTime(snapshot?.currentPauseStartedAt)
        : null;
  const stateMomentLabel = state === 'paused' ? '暂停于' : '起于';
  const showLedger = (snapshot?.segments.length ?? 0) > 0;

  useEffect(() => {
    if (!immersive) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImmersive(false);
    };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, [immersive]);

  return (
    <div
      className={`focus-console ${showLedger ? 'with-ledger' : 'solo'} ${immersive ? 'is-immersive' : ''}`}
      data-state={state}
    >
      <section className="focus-instrument">
        <header className="focus-editorial-header">
          <span className="focus-edition">FOCUS / {String(segmentOrdinal).padStart(2, '0')}</span>
          <div className="focus-header-tools">
            <AnimatePresence mode="wait" initial={false}>
              <StateBadge key={state} state={state} />
            </AnimatePresence>
            <button
              type="button"
              className="focus-immersive-toggle motion-press"
              onClick={() => setImmersive((value) => !value)}
              aria-pressed={immersive}
              title={immersive ? '退出沉浸模式（Esc）' : '进入沉浸模式'}
            >
              <Icon.Maximize size="xs" />
              {immersive ? '退出沉浸' : '沉浸'}
            </button>
          </div>
        </header>

        <motion.div
          layout
          className="timer-context-strip"
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
          <div className="timer-context-copy">
            <div className="timer-context-label">{contextSourceLabel}</div>
            <div
              className={`timer-context-title ${hasContextTask ? '' : 'is-empty'}`}
              title={contextTitle ?? '未选择任务'}
            >
              {contextTitle ?? '给这一段时间一个名字'}
            </div>
          </div>
          <div className="timer-context-actions">
            <button
              className="timer-context-action motion-press"
              onClick={() => setPickerMode(isRunning ? 'segment' : 'preselect')}
            >
              <Icon.Search size="xs" />
              {isRunning ? (hasContextTask ? '更换任务' : '关联任务') : '选择任务'}
            </button>
            {canSetSessionDefault && (
              <button
                className="timer-icon-action motion-press"
                onClick={() => setPickerMode('session')}
                aria-label="设为本次默认任务"
              >
                <Icon.Star size="xs" />
              </button>
            )}
            {canClearContext && (
              <button
                className="timer-icon-action danger motion-press"
                onClick={isRunning ? handleClearSegmentTask : handleClearPreselect}
                aria-label="清除任务"
              >
                <Icon.X size="xs" />
              </button>
            )}
            {canClearSessionDefault && (
              <button
                className="timer-icon-action danger motion-press"
                onClick={handleClearSessionDefault}
                aria-label="清除本次默认任务"
              >
                <Icon.Unlink size="xs" />
              </button>
            )}
          </div>
        </motion.div>

        <div className="timer-instrument">
          <motion.div
            className="clock-readout"
            animate={{ opacity: state === 'paused' ? 0.76 : 1 }}
            transition={{ duration: 0.26 }}
          >
            <div className="timer-digit timer-primary">
              <FlipDigits value={formatDurationPadded(currentSegmentMs)} />
            </div>
            <div className="timer-readout-meta">
              <span>
                {state === 'idle' ? '等待开始' : `片段 ${String(segmentOrdinal).padStart(2, '0')}`}
              </span>
              {stateMoment && (
                <span>
                  {stateMomentLabel} {stateMoment}
                </span>
              )}
            </div>
          </motion.div>
          <TemporalRibbon
            snapshot={snapshot}
            state={state}
            now={now}
            wallMs={wallMs}
            activeMs={cumulativeActiveMs}
            pauseMs={cumulativePauseMs}
          />
        </div>

        <div className="focus-footer-grid">
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
              className="timer-btn-stop btn-primary"
              onClick={handleStop}
              disabled={isIdle || isFinished || state === 'stopping'}
            >
              <Icon.Square size="xs" />
              结束
            </button>
          </div>
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
