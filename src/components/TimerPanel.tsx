// 计时舞台 - v0.3 极光剧场核心：巨型弧光环 + 中央时间 + 控制区
import { useEffect, useState, useMemo } from 'react';
import { Icon } from './Icon';
import { useStore } from '../store/useStore';
import { formatDuration, formatDurationPadded } from '../lib/time';
import {
  getMainDisplayMs,
  getCumulativeActiveMs,
  getCumulativePauseMs,
  getWallElapsedMs,
  getMinuteRhythmSec,
} from '../lib/timerSelectors';
import type { TimerSnapshot, Task } from '@shared/types';
import { TaskPicker } from './TaskPicker';

// ─── useDisplayValues hook ────────────────────────────────────

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
      wallMs: getWallElapsedMs(snapshot),
      minuteRhythmSec: getMinuteRhythmSec(snapshot, now),
    }),
    [snapshot, now],
  );
}

// ─── 弧光环：v0.3 核心视觉 ────────────────────────────────────

function ArcRing({
  progress,
  state,
  children,
}: {
  progress: number;
  state: string;
  children: React.ReactNode;
}) {
  const size = 280;
  const stroke = 8;
  const r = (size - stroke) / 2 - 14;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, progress)));

  const isRunning = state === 'running';
  const isPaused = state === 'paused';

  const arcColor = isPaused
    ? 'rgb(var(--app-warning))'
    : isRunning
      ? 'rgb(var(--app-success))'
      : 'rgb(var(--app-accent))';

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="absolute inset-0"
        style={{ transform: 'rotate(-90deg)' }}
      >
        <defs>
          <filter id="arc-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="arc-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={arcColor} stopOpacity="0.6" />
            <stop offset="100%" stopColor={arcColor} stopOpacity="1" />
          </linearGradient>
        </defs>
        {/* 背景轨道 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(var(--app-border) / 0.5)"
          strokeWidth={stroke}
        />
        {/* 进度弧 */}
        {(isRunning || isPaused) && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="url(#arc-grad)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            filter="url(#arc-glow)"
            style={{
              transition: 'stroke-dashoffset 1s linear',
            }}
          />
        )}
        {/* 装饰刻度环 - 极弱 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r - 14}
          fill="none"
          stroke="rgb(var(--app-border-subtle) / 0.4)"
          strokeWidth={1}
          strokeDasharray="2 6"
        />
      </svg>

      {/* 中央内容 */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center">
        {children}
      </div>

      {/* running 时的外圈呼吸辉光 */}
      {isRunning && (
        <div
          className="pointer-events-none absolute inset-0 rounded-full motion-glow-pulse"
          style={{
            background: `radial-gradient(circle, rgb(var(--app-success) / 0.06) 0%, transparent 70%)`,
          }}
        />
      )}
    </div>
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
      pillCls: 'border-border bg-bg-subtle/60 text-fg-muted',
    },
    running: {
      label: '专注中',
      dotCls: 'bg-success',
      pillCls: 'border-success/25 bg-success/10 text-success',
      pulse: true,
    },
    paused: {
      label: '已暂停',
      dotCls: 'bg-warning',
      pillCls: 'border-warning/25 bg-warning/10 text-warning',
    },
    finished: {
      label: '已结束',
      dotCls: 'bg-success',
      pillCls: 'border-success/25 bg-success/10 text-success',
    },
    stopping: {
      label: '结束中',
      dotCls: 'bg-fg-subtle',
      pillCls: 'border-accent/20 bg-accent/10 text-accent',
    },
  };
  const c = config[state] ?? config.idle;

  return (
    <span className={`status-chip ${c.pillCls}`}>
      <span className="relative flex h-1.5 w-1.5">
        {c.pulse && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${c.dotCls} ${c.pulse ? 'motion-dot-breathe' : ''}`} />
      </span>
      {c.label}
    </span>
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
  tone?: 'accent' | 'success' | 'warning' | 'info' | 'neutral' | 'danger';
}) {
  const toneCls = {
    accent: 'text-accent',
    success: 'text-success',
    warning: 'text-warning',
    info: 'text-info',
    neutral: 'text-fg-subtle',
    danger: 'text-danger',
  }[tone];
  return (
    <div className="card-hover-glow flex items-center gap-2 rounded-2xl border border-border/50 bg-bg-card/60 px-3.5 py-2 backdrop-blur-sm">
      <span className={`flex h-6 w-6 items-center justify-center rounded-lg bg-bg-subtle/60 ${toneCls}`}>
        {icon}
      </span>
      <div className="flex flex-col leading-tight">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-fg-subtle">
          {label}
        </span>
        <span className="timer-digit motion-digit text-[13px] font-bold text-fg">{value}</span>
      </div>
    </div>
  );
}

function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => (part === 'CommandOrControl' ? 'Ctrl' : part === 'Return' ? 'Enter' : part))
    .join(' + ');
}

// ─── 任务卡片 ─────────────────────────────────────────────────

function TaskCard({ label, title, onClear }: { label: string; title: string; onClear?: () => void }) {
  return (
    <div className="app-section flex items-start gap-2.5 px-3.5 py-3">
      <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Icon.Link size="xs" tone="accent" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-fg-subtle">{label}</span>
        <p className="mt-0.5 truncate text-sm font-medium text-fg">{title}</p>
      </div>
      {onClear && (
        <button
          className="motion-press rounded-lg p-1.5 text-fg-subtle hover:bg-danger/10 hover:text-danger"
          onClick={onClear}
          title="清除关联"
        >
          <Icon.X size="xs" />
        </button>
      )}
    </div>
  );
}

function UnlinkedTaskCard({
  label,
  emptyText = '未关联任务 · 点击选择',
  onPick,
}: {
  label: string;
  emptyText?: string;
  onPick: () => void;
}) {
  return (
    <button
      className="motion-base flex w-full items-center gap-2.5 rounded-xl border border-dashed border-border bg-bg-card/50 px-3.5 py-3 text-left hover:border-accent/45 hover:bg-accent/5"
      onClick={onPick}
    >
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-bg-subtle text-fg-subtle">
        <Icon.Link size="xs" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-fg-subtle">{label}</span>
        <p className="mt-0.5 text-sm text-fg-subtle">{emptyText}</p>
      </div>
      <Icon.Search size="xs" tone="subtle" />
    </button>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────

export function TimerPanel() {
  const { snapshot, addToast, settings } = useStore();
  const { currentSegmentMs, cumulativeActiveMs, cumulativePauseMs, wallMs, minuteRhythmSec } =
    useDisplayValues(snapshot);
  const [pickerMode, setPickerMode] = useState<'segment' | 'session' | 'preselect' | null>(null);
  const [preSelectedTask, setPreSelectedTask] = useState<Task | null>(null);

  const state = snapshot?.state ?? 'idle';
  const isRunning = state === 'running' || state === 'paused';

  const currentSegmentTaskId = useMemo(() => {
    if (!snapshot?.currentSegmentId || !snapshot.segments) return null;
    const seg = snapshot.segments.find((s) => s.id === snapshot.currentSegmentId);
    return { taskId: seg?.taskId ?? null, title: seg?.taskTitle ?? seg?.title ?? null };
  }, [snapshot?.currentSegmentId, snapshot?.segments]);

  const sessionDefaultTitle = snapshot?.sessionDefaultTaskTitle ?? null;

  useEffect(() => {
    if ((state === 'running' || state === 'paused' || state === 'stopping') && preSelectedTask) {
      setPreSelectedTask(null);
    }
  }, [state, preSelectedTask]);

  const handleToggle = async () => {
    try {
      if (state === 'finished') {
        await window.focuslink.timer.reset();
        if (preSelectedTask) {
          const snap = await window.focuslink.timer.startWithTask(
            preSelectedTask.id,
            preSelectedTask.source,
            preSelectedTask.title,
          );
          useStore.getState().setSnapshot(snap);
          setPreSelectedTask(null);
          addToast(`已开始新一轮专注：${preSelectedTask.title}`, 'success');
          return;
        }
        const snap = await window.focuslink.timer.toggle();
        useStore.getState().setSnapshot(snap);
        addToast('已开始新一轮专注', 'success');
        return;
      }
      if (state === 'idle' && preSelectedTask) {
        const snap = await window.focuslink.timer.startWithTask(
          preSelectedTask.id,
          preSelectedTask.source,
          preSelectedTask.title,
        );
        useStore.getState().setSnapshot(snap);
        setPreSelectedTask(null);
        addToast(`已开始专注：${preSelectedTask.title}`, 'success');
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
    setPreSelectedTask(task);
    addToast(`已选择即将专注的任务：${task.title}`, 'info');
  };

  const handleClearPreselect = () => setPreSelectedTask(null);

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
      ? { onPick: handlePickSegment, title: '关联到当前片段', confirmLabel: '关联到片段' }
      : pickerMode === 'session'
        ? { onPick: handlePickSession, title: '设为本次专注默认任务', confirmLabel: '设为默认' }
        : pickerMode === 'preselect'
          ? { onPick: handlePickPreselect, title: '选择即将专注的任务', confirmLabel: '选择任务' }
          : null;

  const hotkeyHint = settings
    ? `${formatAccelerator(settings.hotkeys.toggleTimer)} 开始 / 暂停 · ${formatAccelerator(settings.hotkeys.stopTimer)} 结束`
    : '快捷键加载中';

  // 弧光环进度：分钟节奏 (0-60s) 映射到 0-1
  const arcProgress = (state === 'running' || state === 'paused') ? minuteRhythmSec / 60 : 0;

  // 中央时间颜色
  const timeColorCls =
    state === 'paused' ? 'text-warning' : state === 'running' ? 'text-fg' : 'text-fg-muted';

  // 状态图标
  const stateIcon =
    state === 'paused' ? (
      <Icon.Coffee size="sm" tone="warning" />
    ) : state === 'running' ? (
      <Icon.Activity size="sm" tone="success" />
    ) : (
      <Icon.Clock size="sm" tone="subtle" />
    );
  const stateIconTone =
    state === 'paused'
      ? 'text-warning'
      : state === 'running'
        ? 'text-success'
        : 'text-fg-subtle';

  // 副标题
  const subtitle =
    state === 'running'
      ? '当前专注片段'
      : state === 'paused'
        ? '当前暂停片段'
        : state === 'finished'
          ? '本次专注已结束'
          : '尚未开始';

  // 任务上下文
  const contextTitle = isRunning
    ? (currentSegmentTaskId?.title ?? sessionDefaultTitle)
    : (preSelectedTask?.title ?? null);
  const contextSourceLabel = isRunning
    ? currentSegmentTaskId?.title
      ? '当前片段任务'
      : sessionDefaultTitle
        ? '本次默认任务'
        : '当前任务'
    : '即将专注任务';

  const mainActionClass =
    state === 'running'
      ? 'btn-pause-action'
      : state === 'paused' || state === 'idle' || state === 'finished'
        ? 'btn-focus-action'
        : 'btn-primary';

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col">
      {/* 顶部状态行 */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <StateBadge state={state} />
        <span key={`hint-${state}`} className="motion-fade-up text-xs font-medium text-fg-subtle">
          {state === 'idle'
            ? preSelectedTask
              ? '已选择即将专注任务'
              : '可先选任务，也可直接开始'
            : state === 'running'
              ? '正在记录每个专注片段'
              : state === 'paused'
                ? '恢复后进入新专注片段'
                : isFinished
                  ? preSelectedTask
                    ? '已选择即将专注任务'
                    : '可先选任务，也可直接开始'
                  : '已结束'}
        </span>
      </div>

      {/* ── 弧光环舞台 ── */}
      <div className="flex flex-col items-center">
        <ArcRing progress={arcProgress} state={state}>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-fg-subtle">
            当前片段
          </span>
          <div
            className={`timer-digit motion-digit mt-2 text-[60px] font-bold leading-none ${timeColorCls}`}
            style={{ textShadow: state === 'running' ? '0 0 32px rgb(var(--app-success) / 0.25)' : 'none' }}
          >
            {formatDurationPadded(currentSegmentMs)}
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            {stateIcon}
            <span
              key={`sub-${state}`}
              className="motion-fade-up text-xs font-medium text-fg-subtle"
            >
              {subtitle}
            </span>
          </div>
          {/* 分钟节奏数字 */}
          {(state === 'running' || state === 'paused') && (
            <div className="mt-1 timer-digit motion-digit text-[11px] font-semibold text-fg-subtle">
              {String(minuteRhythmSec).padStart(2, '0')}s / 60s
            </div>
          )}
        </ArcRing>
      </div>

      {/* 任务上下文条 */}
      <div className="timer-context-strip relative mt-6 flex items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
            contextTitle ? 'bg-accent/10 text-accent' : 'bg-bg-subtle text-fg-subtle'
          }`}
        >
          <Icon.Link size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold text-fg-subtle">{contextSourceLabel}</div>
          <div
            className={`truncate text-sm font-semibold ${
              state === 'paused'
                ? 'text-warning'
                : state === 'running'
                  ? 'text-success'
                  : contextTitle
                    ? 'text-accent'
                    : 'text-fg-subtle'
            }`}
          >
            {contextTitle ?? '未选择任务'}
          </div>
        </div>
        <button
          className="btn-ghost shrink-0 !px-2.5 !py-1.5 text-[11px]"
          onClick={() => setPickerMode(isRunning ? 'segment' : 'preselect')}
        >
          <Icon.Search size="xs" />
          {isRunning ? (contextTitle ? '更换' : '关联') : '选择'}
        </button>
      </div>

      {/* 累计统计胶囊行 */}
      <div className="mt-4 flex items-center justify-center gap-2">
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
          tone={state === 'paused' ? 'warning' : 'neutral'}
        />
        <StatPill
          label="总历时"
          value={formatDuration(wallMs)}
          icon={<Icon.Route size="xs" />}
          tone="info"
        />
      </div>

      {/* 任务关联区 - 仅在专注进行中显示 */}
      {isRunning && (
        <div className="mt-4 w-full space-y-2">
          {currentSegmentTaskId?.title ? (
            <TaskCard
              label="当前片段任务"
              title={currentSegmentTaskId.title}
              onClear={handleClearSegmentTask}
            />
          ) : (
            <UnlinkedTaskCard
              label="当前片段任务"
              emptyText="当前片段未关联任务 · 点击选择"
              onPick={() => setPickerMode('segment')}
            />
          )}

          {sessionDefaultTitle && sessionDefaultTitle !== currentSegmentTaskId?.title && (
            <TaskCard
              label="本次专注默认"
              title={sessionDefaultTitle}
              onClear={handleClearSessionDefault}
            />
          )}

          {currentSegmentTaskId?.title && !sessionDefaultTitle && (
            <button className="btn-ghost w-full text-xs" onClick={() => setPickerMode('session')}>
              <Icon.Star size="xs" />
              设为本次专注默认任务
            </button>
          )}
        </div>
      )}

      {/* idle/finished 预选任务区 */}
      {(isIdle || isFinished) && (
        <div className="mt-4 w-full space-y-2">
          {preSelectedTask ? (
            <div className="timer-plan-strip">
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost flex-1 text-xs"
                  onClick={() => setPickerMode('preselect')}
                  title="更换即将专注的任务"
                >
                  <Icon.Refresh size="xs" />
                  更换任务
                </button>
                <button
                  className="btn-ghost flex-1 text-xs"
                  onClick={handleClearPreselect}
                  title="清除预选任务"
                >
                  <Icon.X size="xs" />
                  清除
                </button>
              </div>
            </div>
          ) : (
            <UnlinkedTaskCard
              label="即将专注任务"
              emptyText="尚未选择任务 · 点击选择"
              onPick={() => setPickerMode('preselect')}
            />
          )}
        </div>
      )}

      {/* 控制按钮 */}
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          className={`${mainActionClass} btn-shine motion-magnetic flex min-w-[172px] items-center justify-center gap-2`}
          onClick={handleToggle}
        >
          {state === 'running' ? <Icon.Pause size="md" hover /> : <Icon.Play size="md" hover />}
          {toggleLabel}
        </button>
        <button
          className="btn-outline btn-shine motion-press flex items-center gap-2"
          onClick={handleStop}
          disabled={isIdle || isFinished}
        >
          <Icon.Square size="sm" hover />
          结束专注
        </button>
      </div>

      {/* 快捷键提示 */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-fg-subtle">
        <span className="font-medium text-fg-muted">快捷键</span>
        {hotkeyHint.split(' · ').map((part) => (
          <span key={part} className="kbd-chip">
            {part}
          </span>
        ))}
      </div>

      {/* TaskPicker 弹窗 */}
      {pickerMode && pickerConfig && (
        <TaskPicker
          onPick={pickerConfig.onPick}
          title={pickerConfig.title}
          confirmLabel={pickerConfig.confirmLabel}
        />
      )}
    </div>
  );
}
