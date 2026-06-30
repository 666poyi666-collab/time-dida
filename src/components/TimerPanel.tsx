// 左侧计时区 - 大看板：当前片段时间 + 分钟节奏条 + 三项累计统计
import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  Square,
  Link2,
  X,
  Star,
  Search,
  RefreshCw,
  Activity,
  Clock3,
  Coffee,
  Route,
} from 'lucide-react';
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

/** 基于主进程推送的 snapshot，在渲染层本地动态计算实时显示值。
 *  所有口径统一走 src/lib/timerSelectors.ts，避免各组件各写一套。 */
function useDisplayValues(snapshot: TimerSnapshot | null) {
  const [now, setNow] = useState(Date.now());

  // running / paused 时本地每秒 tick
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

// ─── Helper Components ─────────────────────────────────────────

/** 状态徽章 - 带彩色圆点的 pill */
function StateBadge({ state }: { state: string }) {
  const config: Record<
    string,
    { label: string; dotCls: string; pillCls: string; pulse?: boolean }
  > = {
    idle: {
      label: '未开始',
      dotCls: 'bg-fg-subtle',
      pillCls: 'border-border bg-bg-subtle text-fg-muted',
    },
    running: {
      label: '专注中',
      dotCls: 'bg-accent',
      pillCls: 'border-accent/20 bg-accent/10 text-accent',
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
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${c.dotCls}`} />
      </span>
      {c.label}
    </span>
  );
}

/** 分钟节奏条 - 60 秒循环，表达"当前这分钟走到哪里"，不是总进度 */
function MinuteRhythmBar({ state, minuteRhythmSec }: { state: string; minuteRhythmSec: number }) {
  const isPaused = state === 'paused';
  const isRunning = state === 'running';
  const pct = (minuteRhythmSec / 60) * 100;
  const barCls = isPaused ? 'bg-warning' : 'bg-accent';

  return (
    <div className="w-full">
      <div className="h-2 w-full overflow-hidden rounded-full bg-bg-subtle">
        <div
          className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${barCls} ${
            isRunning ? 'shadow-[0_0_8px_rgb(var(--app-accent)/0.35)]' : ''
          }`}
          style={{ width: `${isRunning || isPaused ? pct : 0}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-fg-subtle">分钟节奏（60 秒循环）</span>
        <span className="timer-digit text-[11px] font-semibold text-fg-muted tabular-nums">
          {String(minuteRhythmSec).padStart(2, '0')}s / 60s
        </span>
      </div>
    </div>
  );
}

/** 累计统计项 - 紧凑内联样式（无卡片边框，避免拆碎感） */
function CumStat({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: 'accent' | 'warning' | 'info' | 'neutral';
}) {
  const toneCls = {
    accent: 'text-accent',
    warning: 'text-warning',
    info: 'text-info',
    neutral: 'text-fg-subtle',
  }[tone];
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <div className={`flex items-center gap-1 ${toneCls}`}>
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="timer-digit text-base font-bold text-fg tabular-nums">{value}</div>
    </div>
  );
}

function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => (part === 'CommandOrControl' ? 'Ctrl' : part === 'Return' ? 'Enter' : part))
    .join(' + ');
}

// ─── TaskCard ─────────────────────────────────────────────────

/** 当前关联任务卡片 */
function TaskCard({
  label,
  title,
  onClear,
}: {
  label: string;
  title: string;
  onClear?: () => void;
}) {
  return (
    <div className="app-section flex items-start gap-2.5 px-3.5 py-3">
      <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Link2 size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-fg-subtle">
          {label}
        </span>
        <p className="mt-0.5 truncate text-sm font-medium text-fg">{title}</p>
      </div>
      {onClear && (
        <button
          className="rounded-lg p-1.5 text-fg-subtle transition-colors hover:bg-danger/10 hover:text-danger"
          onClick={onClear}
          title="清除关联"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/** 未关联任务占位卡片 - 提供选择入口 */
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
      className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-border bg-bg-card/70 px-3.5 py-3 text-left transition-colors hover:border-accent/45 hover:bg-accent/5"
      onClick={onPick}
    >
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-bg-subtle text-fg-subtle">
        <Link2 size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-fg-subtle">
          {label}
        </span>
        <p className="mt-0.5 text-sm text-fg-subtle">{emptyText}</p>
      </div>
      <Search size={12} className="flex-shrink-0 text-fg-subtle" />
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────

export function TimerPanel() {
  const { snapshot, addToast, settings } = useStore();
  const { currentSegmentMs, cumulativeActiveMs, cumulativePauseMs, wallMs, minuteRhythmSec } =
    useDisplayValues(snapshot);
  const [pickerMode, setPickerMode] = useState<'segment' | 'session' | 'preselect' | null>(null);
  /** idle 状态预选任务：用于"先选任务再开始专注"流程。
   *  开始专注后自动清空（已写入 Session.defaultTask + Segment.task）。 */
  const [preSelectedTask, setPreSelectedTask] = useState<Task | null>(null);

  const state = snapshot?.state ?? 'idle';
  const isRunning = state === 'running' || state === 'paused';

  // 当前 segment 的 task 信息（区别于 session 默认）
  const currentSegmentTaskId = useMemo(() => {
    if (!snapshot?.currentSegmentId || !snapshot.segments) return null;
    const seg = snapshot.segments.find((s) => s.id === snapshot.currentSegmentId);
    return { taskId: seg?.taskId ?? null, title: seg?.taskTitle ?? seg?.title ?? null };
  }, [snapshot?.currentSegmentId, snapshot?.segments]);

  const sessionDefaultTitle = snapshot?.sessionDefaultTaskTitle ?? null;

  // 离开 idle 状态时清空预选任务（避免下次进入 idle 仍显示旧选择）
  useEffect(() => {
    if (state !== 'idle' && preSelectedTask) {
      setPreSelectedTask(null);
    }
  }, [state, preSelectedTask]);

  const handleToggle = async () => {
    try {
      // idle 状态：若有预选任务则用 startWithTask 原子启动，否则普通 toggle
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

  /** idle 状态预选任务：仅在前端保存，点击"开始专注"时通过 startWithTask 原子写入 */
  const handlePickPreselect = (task: Task | null) => {
    setPickerMode(null);
    if (!task) return;
    setPreSelectedTask(task);
    addToast(`已选择即将专注的任务：${task.title}`, 'info');
  };

  const handleClearPreselect = () => {
    setPreSelectedTask(null);
  };

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

  const toggleLabel = state === 'running' ? '暂停' : state === 'paused' ? '继续' : '开始专注';

  const isIdle = state === 'idle';
  const isFinished = state === 'finished';

  // TaskPicker 回调与标题：根据 pickerMode 分流
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

  // 大看板副标题：当前片段语义
  const segmentSubtitle =
    state === 'running'
      ? '当前专注片段'
      : state === 'paused'
        ? '当前暂停片段'
        : state === 'finished'
          ? '本次专注已结束'
          : '尚未开始';

  // 看板右上辅助提示
  const headerHint = isIdle
    ? preSelectedTask
      ? '已选择即将专注任务'
      : '可先选任务，也可直接开始'
    : state === 'running'
      ? '正在记录每个专注片段'
      : state === 'paused'
        ? '恢复后进入新专注片段'
        : '已结束';

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col">
      {/* 顶部状态行 */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <StateBadge state={state} />
        <span className="text-xs font-medium text-fg-subtle">{headerHint}</span>
      </div>

      {/* 大看板：当前片段时间 + 分钟节奏条 + 三项累计统计 */}
      <div
        className={`card relative overflow-hidden p-5 transition-all duration-500 ${
          state === 'running' ? 'focus-glow' : state === 'paused' ? 'pause-glow' : ''
        }`}
      >
        <div className="surface-grid pointer-events-none absolute inset-0 opacity-45" />
        <AnimatePresence>
          {state === 'running' && (
            <motion.div
              key="pulse-running"
              className="pointer-events-none absolute inset-0 bg-accent/[0.035]"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.18, 0.36, 0.18] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          {state === 'paused' && (
            <motion.div
              key="pulse-paused"
              className="pointer-events-none absolute inset-0 bg-warning/[0.04]"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.14, 0.26, 0.14] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </AnimatePresence>

        {/* 大时间 + 副标题 */}
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-fg-subtle">
              Focus Segment
            </span>
            <div
              className={`mt-2 timer-digit text-[68px] font-bold leading-none tabular-nums ${
                state === 'paused' ? 'text-warning' : 'text-fg'
              }`}
            >
              {formatDurationPadded(currentSegmentMs)}
            </div>
            <span className="mt-2 block text-xs font-medium leading-relaxed text-fg-subtle">
              {segmentSubtitle}
            </span>
          </div>
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-soft ${
              state === 'paused'
                ? 'border-warning/20 bg-warning/10 text-warning'
                : 'border-accent/20 bg-accent/10 text-accent'
            }`}
          >
            {state === 'paused' ? (
              <Coffee size={22} />
            ) : state === 'running' ? (
              <Activity size={22} />
            ) : (
              <Clock3 size={22} />
            )}
          </div>
        </div>

        {/* 分钟节奏条（仅运行 / 暂停时显示） */}
        {(state === 'running' || state === 'paused') && (
          <div className="relative mt-5 w-full">
            <MinuteRhythmBar state={state} minuteRhythmSec={minuteRhythmSec} />
          </div>
        )}

        {/* 底部三项累计统计 */}
        <div className="relative mt-5 grid w-full grid-cols-3 gap-2 border-t border-border/60 pt-4">
          <CumStat
            label="累计专注"
            value={formatDuration(cumulativeActiveMs)}
            icon={<Activity size={11} />}
            tone="accent"
          />
          <CumStat
            label="累计暂停"
            value={formatDuration(cumulativePauseMs)}
            icon={<Coffee size={11} />}
            tone={state === 'paused' ? 'warning' : 'neutral'}
          />
          <CumStat
            label="总历时"
            value={formatDuration(wallMs)}
            icon={<Route size={11} />}
            tone="info"
          />
        </div>
      </div>

      {/* 任务关联区 - 仅在专注进行中显示 */}
      {isRunning && (
        <div className="mt-5 w-full space-y-2">
          {/* 当前片段任务 */}
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

          {/* Session 默认任务（仅在设置了默认任务时显示，且与当前片段任务不同时） */}
          {sessionDefaultTitle && sessionDefaultTitle !== currentSegmentTaskId?.title && (
            <TaskCard
              label="本次专注默认"
              title={sessionDefaultTitle}
              onClear={handleClearSessionDefault}
            />
          )}

          {/* 如果当前片段已关联但未设默认任务，提供"设为默认"快捷入口 */}
          {currentSegmentTaskId?.title && !sessionDefaultTitle && (
            <button className="btn-ghost w-full text-xs" onClick={() => setPickerMode('session')}>
              <Star size={11} />
              设为本次专注默认任务
            </button>
          )}
        </div>
      )}

      {/* idle 状态预选任务区 - "先选任务再开始专注"流程 */}
      {isIdle && (
        <div className="mt-5 w-full space-y-2">
          {preSelectedTask ? (
            <div className="space-y-2 rounded-xl border border-accent/30 bg-accent/5 p-3.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Link2 size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-fg-subtle">
                    即将专注任务
                  </span>
                  <p className="mt-0.5 truncate text-sm font-medium text-fg">
                    {preSelectedTask.title}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost flex-1 text-xs"
                  onClick={() => setPickerMode('preselect')}
                  title="更换即将专注的任务"
                >
                  <RefreshCw size={11} />
                  更换任务
                </button>
                <button
                  className="btn-ghost flex-1 text-xs"
                  onClick={handleClearPreselect}
                  title="清除预选任务"
                >
                  <X size={11} />
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
      <div className="mt-6 flex items-center gap-3">
        <button
          className="btn-primary flex min-w-[172px] items-center justify-center gap-2"
          onClick={handleToggle}
        >
          {state === 'running' ? <Pause size={16} /> : <Play size={16} />}
          {toggleLabel}
        </button>
        <button
          className="btn-outline flex items-center gap-2"
          onClick={handleStop}
          disabled={isIdle || isFinished}
        >
          <Square size={15} />
          结束专注
        </button>
      </div>

      {/* 快捷键提示 */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
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
