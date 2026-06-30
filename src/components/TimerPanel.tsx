// 左侧计时区 - Linear/Raycast 风格，大号计时器 + 进度条 + 状态 + 统计 + 控制按钮
import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Square, Link2, X, Star, Search, RefreshCw, Activity, Clock3, Coffee, Route } from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatDuration } from '../lib/time';
import type { TimerSnapshot, Task } from '@shared/types';
import { TaskPicker } from './TaskPicker';

// ─── 常量 ─────────────────────────────────────────────────────

// 默认专注是无限正计时；倒计时目标以后由用户手动设置时再显示。

// ─── useDisplayValues hook（保持原有逻辑不变）────────────────

/** 基于主进程推送的 snapshot，在渲染层本地动态计算实时显示值。
 *  这样即使主进程推送延迟，running 状态下计时数字也能每秒自动刷新。 */
function useDisplayValues(snapshot: TimerSnapshot | null) {
  const [now, setNow] = useState(Date.now());

  // running / paused 时本地每秒 tick
  useEffect(() => {
    const state = snapshot?.state;
    if (state !== 'running' && state !== 'paused') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [snapshot?.state, snapshot?.lastTick, snapshot?.currentPauseStartedAt]);

  return useMemo(() => {
    if (!snapshot) {
      return { activeMs: 0, pauseMs: 0, wallMs: 0 };
    }
    const baseActive = snapshot.activeElapsedMs;
    const basePause = snapshot.pauseElapsedMs;
    const baseWall = snapshot.wallElapsedMs;

    // running：active 增量 = now - lastTick（上次活跃结算时间）
    const activeMs =
      snapshot.state === 'running' && snapshot.lastTick > 0
        ? baseActive + Math.max(0, now - snapshot.lastTick)
        : baseActive;

    // paused：pause 增量 = now - currentPauseStartedAt
    const pauseMs =
      snapshot.state === 'paused' && snapshot.currentPauseStartedAt
        ? basePause + Math.max(0, now - snapshot.currentPauseStartedAt)
        : basePause;

    // wall：直接用主进程每秒推送的实时值（now - session.startedAt）
    // 主进程 tick 间隔 1s，wall 每秒更新一次，足够准确，避免本地重复增量计算
    const wallMs = baseWall;

    return { activeMs, pauseMs, wallMs };
  }, [snapshot, now]);
}

// ─── Helper Components ─────────────────────────────────────────

/** 状态徽章 - 带彩色圆点的 pill */
function StateBadge({ state }: { state: string }) {
  const config: Record<string, { label: string; dotCls: string; pillCls: string; pulse?: boolean }> = {
    idle: {
      label: '未开始',
      dotCls: 'bg-fg-subtle',
      pillCls: 'bg-bg-subtle text-fg-muted',
    },
    running: {
      label: '专注中',
      dotCls: 'bg-accent',
      pillCls: 'bg-accent/15 text-accent',
      pulse: true,
    },
    paused: {
      label: '已暂停',
      dotCls: 'bg-amber-400',
      pillCls: 'bg-amber-500/15 text-amber-400',
    },
    finished: {
      label: '已结束',
      dotCls: 'bg-emerald-400',
      pillCls: 'bg-emerald-500/15 text-emerald-400',
    },
    stopping: {
      label: '结束中',
      dotCls: 'bg-fg-subtle',
      pillCls: 'bg-accent/15 text-accent',
    },
  };
  const c = config[state] ?? config.idle;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${c.pillCls}`}>
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

/** 小统计卡片 - 标签 + 数值 */
function TimeStat({
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
    accent: 'border-accent/35 bg-accent/10 text-accent',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    info: 'border-info/30 bg-info/10 text-info',
    neutral: 'border-border bg-bg-subtle/45 text-fg-subtle',
  }[tone];
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${toneCls}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-bg-card/60">{icon}</span>
        <span className="text-[10px] font-medium text-fg-subtle">{label}</span>
      </div>
      <div className="timer-digit text-lg font-semibold text-fg">{value}</div>
    </div>
  );
}

// ─── FocusFlowLine ───────────────────────────────────────────

/** 无限正计时状态线：不展示默认倒计时目标，避免误导成番茄钟。 */
function FocusFlowLine({ state }: { state: string }) {
  const isRunning = state === 'running';
  const isPaused = state === 'paused';

  return (
    <div className="w-full">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
        <motion.div
          className={`h-full rounded-full ${isPaused ? 'bg-warning' : 'bg-accent'}`}
          initial={false}
          animate={{ width: isRunning ? ['18%', '68%', '92%'] : isPaused ? '48%' : '100%' }}
          transition={isRunning ? { duration: 5, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[11px] text-fg-subtle">无限正计时</span>
        <span className="text-[11px] font-medium text-fg-muted">手动结束后保存</span>
      </div>
    </div>
  );
}

function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) =>
      part === 'CommandOrControl'
        ? 'Ctrl'
        : part === 'Return'
          ? 'Enter'
          : part
    )
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
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-bg-base/55 px-3.5 py-2.5">
      <Link2 size={14} className="mt-0.5 flex-shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <span className="text-[10px] font-semibold text-fg-subtle">{label}</span>
        <p className="mt-0.5 truncate text-sm font-medium text-fg">{title}</p>
      </div>
      {onClear && (
        <button
          className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg-subtle hover:text-danger"
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
      className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-border bg-bg-base/40 px-3.5 py-2.5 text-left transition-colors hover:border-accent/50 hover:bg-accent/5"
      onClick={onPick}
    >
      <Link2 size={14} className="flex-shrink-0 text-fg-subtle" />
      <div className="min-w-0 flex-1">
        <span className="text-[10px] font-semibold text-fg-subtle">{label}</span>
        <p className="mt-0.5 text-sm text-fg-subtle">{emptyText}</p>
      </div>
      <Search size={12} className="flex-shrink-0 text-fg-subtle" />
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────

export function TimerPanel() {
  const { snapshot, addToast, settings } = useStore();
  const { activeMs, pauseMs, wallMs } = useDisplayValues(snapshot);
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
          preSelectedTask.title
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
        task.title
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
        task.title
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

  const toggleLabel =
    state === 'running' ? '暂停' : state === 'paused' ? '继续' : '开始专注';

  const isIdle = state === 'idle';
  const isFinished = state === 'finished';

  // TaskPicker 回调与标题：根据 pickerMode 分流
  const pickerConfig = pickerMode === 'segment'
    ? { onPick: handlePickSegment, title: '关联到当前片段', confirmLabel: '关联到片段' }
    : pickerMode === 'session'
    ? { onPick: handlePickSession, title: '设为本次专注默认任务', confirmLabel: '设为默认' }
    : pickerMode === 'preselect'
    ? { onPick: handlePickPreselect, title: '选择即将专注的任务', confirmLabel: '选择任务' }
    : null;

  const hotkeyHint = settings
    ? `${formatAccelerator(settings.hotkeys.toggleTimer)} 开始 / 暂停 · ${formatAccelerator(settings.hotkeys.stopTimer)} 结束`
    : '快捷键加载中';

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col">
      {/* 状态与当前模式 */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <StateBadge state={state} />
        <span className="text-xs text-fg-subtle">
          {isIdle
            ? preSelectedTask
              ? '已选择即将专注任务'
              : '可先选任务，也可直接开始'
            : '正在记录每个专注片段'}
        </span>
      </div>

      {/* 大号计时器 */}
      <div
        className={`relative overflow-hidden rounded-xl border border-border bg-bg-card/70 p-4 transition-all duration-500 ${
          state === 'running' ? 'focus-glow' : ''
        }`}
      >
        <div className="surface-grid pointer-events-none absolute inset-0 opacity-70" />
        <AnimatePresence>
          {state === 'running' && (
            <motion.div
              key="pulse"
              className="pointer-events-none absolute inset-0 bg-accent/5"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.18, 0.36, 0.18] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </AnimatePresence>
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-subtle">Focus Ledger</span>
            <div className="mt-2 flex items-end gap-2">
              <span className="timer-digit text-[66px] font-bold leading-none text-fg tabular-nums">
                {formatDuration(activeMs)}
              </span>
            </div>
            <span className="mt-2 block text-xs font-medium text-fg-subtle">
              {isIdle ? '无限正计时，开始后手动结束保存' : state === 'paused' ? '专注已暂停，恢复后继续记录' : '当前有效专注时间'}
            </span>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent shadow-soft">
            {state === 'paused' ? <Coffee size={22} /> : state === 'running' ? <Activity size={22} /> : <Clock3 size={22} />}
          </div>
        </div>

        {!isIdle && (
          <div className="relative mt-5 w-full">
            <FocusFlowLine state={state} />
          </div>
        )}
      </div>

      {/* 三时间统计 */}
      <div className="mt-4 grid w-full grid-cols-3 gap-2">
        <TimeStat label="专注" value={formatDuration(activeMs)} icon={<Activity size={13} />} tone="accent" />
        <TimeStat label="暂停" value={formatDuration(pauseMs)} icon={<Coffee size={13} />} tone={state === 'paused' ? 'warning' : 'neutral'} />
        <TimeStat label="跨度" value={formatDuration(wallMs)} icon={<Route size={13} />} tone="info" />
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
          {sessionDefaultTitle &&
            sessionDefaultTitle !== currentSegmentTaskId?.title && (
              <TaskCard
                label="本次专注默认"
                title={sessionDefaultTitle}
                onClear={handleClearSessionDefault}
              />
            )}

          {/* 如果当前片段已关联但未设默认任务，提供"设为默认"快捷入口 */}
          {currentSegmentTaskId?.title && !sessionDefaultTitle && (
            <button
              className="btn-ghost w-full text-xs"
              onClick={() => setPickerMode('session')}
            >
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
            <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
              <div className="flex items-start gap-2.5">
                <Link2 size={14} className="mt-0.5 flex-shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-semibold text-fg-subtle">即将专注任务</span>
                  <p className="mt-0.5 truncate text-sm font-medium text-fg">{preSelectedTask.title}</p>
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
        <button className="btn-primary flex min-w-[164px] items-center justify-center gap-2" onClick={handleToggle}>
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
      <p className="mt-4 text-[11px] text-fg-subtle">
        {hotkeyHint}
      </p>

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
