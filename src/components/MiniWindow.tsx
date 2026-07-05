// 专注小窗 v0.3 - 极光剧场浮窗
// 两种模式：EXPANDED（420×184 详情卡）、COLLAPSED（260×88 缩小卡）
// 时间即主角：巨型数字 + 状态辉光边框，独立于主窗的浮窗语言
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { TimerSnapshot, AppSettings } from '@shared/types';
import { formatDuration } from '../lib/time';
import {
  getMainDisplayMs,
  getCurrentSegmentDisplayMs,
  getCurrentPauseDisplayMs,
  getCumulativeActiveMs,
  getCumulativePauseMs,
  getWallElapsedMs,
  getCurrentTaskTitle,
} from '../lib/timerSelectors';
import { Play, Pause, Square, ChevronDown, ChevronUp, Maximize2, Link2 } from 'lucide-react';

const ACCENT_CLASS: Record<string, string> = {
  indigo: 'accent-indigo',
  violet: 'accent-violet',
  emerald: 'accent-emerald',
  rose: 'accent-rose',
  amber: 'accent-amber',
  sky: 'accent-sky',
};

const STATE_LABEL: Record<string, string> = {
  idle: '未开始',
  running: '专注中',
  paused: '已暂停',
  finished: '已结束',
  stopping: '结束中',
};

const STATE_DOT: Record<string, string> = {
  idle: 'bg-fg-subtle',
  running: 'state-dot-running',
  paused: 'bg-warning',
  finished: 'bg-success',
  stopping: 'bg-fg-subtle',
};

const STATE_TEXT: Record<string, string> = {
  idle: 'text-fg-muted',
  running: 'text-success',
  paused: 'text-warning',
  finished: 'text-success',
  stopping: 'text-fg-muted',
};

function applyThemeClass(s: AppSettings): void {
  const root = document.documentElement;
  let effectiveTheme: 'dark' | 'light' = 'dark';
  if (s.miniWindow.followMainTheme) {
    effectiveTheme = s.theme;
  } else if (s.miniWindow.themeMode === 'dark') {
    effectiveTheme = 'dark';
  } else if (s.miniWindow.themeMode === 'light') {
    effectiveTheme = 'light';
  }
  if (!s.miniWindow.followMainTheme && s.miniWindow.themeMode === 'system') {
    effectiveTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  if (effectiveTheme === 'light') {
    root.classList.add('light');
    root.classList.remove('dark');
  } else {
    root.classList.add('dark');
    root.classList.remove('light');
  }
  Object.values(ACCENT_CLASS).forEach((cls) => root.classList.remove(cls));
  const accentClass = ACCENT_CLASS[s.accentColor];
  if (accentClass) root.classList.add(accentClass);
}

function StateDot({ state, size = 'sm' }: { state: string; size?: 'sm' | 'xs' }) {
  const sizeClass = size === 'xs' ? 'h-1.5 w-1.5' : 'h-2 w-2';
  const dotCls = STATE_DOT[state] ?? STATE_DOT.idle;
  return (
    <motion.span
      key={`dot-${state}`}
      className={`inline-block flex-shrink-0 rounded-full ${sizeClass} ${dotCls}`}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    />
  );
}

export function MiniWindow() {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null);
  const [, setNow] = useState(Date.now());
  const [collapsed, setCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await window.focuslink.settings.get();
        setCollapsed(s.miniWindow.collapsed);
        applyThemeClass(s);
      } catch {
        // 静默失败
      }
    })();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const snap = await window.focuslink.timer.getSnapshot();
      if (mounted) setSnapshot(snap);
    })();
    const unsub = window.focuslink.on('tick', (snap) => {
      if (mounted) setSnapshot(snap as TimerSnapshot);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    const unsub = window.focuslink.on('settings:changed', (...args: unknown[]) => {
      const s = args[0] as AppSettings;
      if (s) {
        setCollapsed(s.miniWindow.collapsed);
        applyThemeClass(s);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (snapshot?.state !== 'running' && snapshot?.state !== 'paused') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [snapshot?.state, snapshot?.lastTick, snapshot?.currentPauseStartedAt]);

  const state = snapshot?.state ?? 'idle';
  const nowMs = Date.now();
  const displayActive = getMainDisplayMs(snapshot, nowMs);
  const currentFocusMs = getCurrentSegmentDisplayMs(snapshot, nowMs);
  const currentPauseMs = getCurrentPauseDisplayMs(snapshot, nowMs);
  const cumulativeActiveMs = getCumulativeActiveMs(snapshot, nowMs);
  const cumulativePauseMs = getCumulativePauseMs(snapshot, nowMs);
  const wallElapsedMs = getWallElapsedMs(snapshot);
  const currentTaskTitle = getCurrentTaskTitle(snapshot);
  const isRunning = state === 'running';
  const isPaused = state === 'paused';
  const isIdle = state === 'idle' || state === 'finished';
  const primaryMs = isPaused ? currentPauseMs : currentFocusMs;
  const cumulativeMs = isPaused ? cumulativePauseMs : cumulativeActiveMs;
  const primaryLabel = isPaused ? '当前暂停' : isIdle ? '待开始' : '当前专注';
  const cumulativeLabel = isPaused ? '累计暂停' : '累计专注';
  const activeTone = isPaused ? 'text-warning' : isRunning ? 'text-success' : 'text-fg';
  const primaryButtonClass = isRunning ? 'mini-action-pause' : 'mini-action-focus';

  const handleToggle = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (state === 'finished') await window.focuslink.timer.reset();
      const snap = await window.focuslink.timer.toggle();
      setSnapshot(snap);
    },
    [state],
  );

  const handleStop = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const snap = await window.focuslink.timer.stop();
    setSnapshot(snap);
  }, []);

  const handleCollapse = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed(true);
    window.focuslink.mini.collapse();
  }, []);

  const handleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed(false);
    window.focuslink.mini.expand();
  }, []);

  const handleOpenMain = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    window.focuslink.window.show();
  }, []);

  // ─── COLLAPSED 模式（260×88）- 时间胶囊 ───
  if (collapsed) {
    return (
      <div
        ref={containerRef}
        className={`mini-window-shell mini-window-${state} mini-window-collapsed motion-base flex h-full w-full flex-col justify-between px-4 py-2.5 text-fg`}
        onDoubleClick={handleExpand}
        title="双击展开"
      >
        {/* 顶部：状态 + 展开 */}
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1.5">
            <StateDot state={state} size="xs" />
            <span className={`truncate text-[10px] font-bold ${STATE_TEXT[state]}`}>
              {STATE_LABEL[state]}
            </span>
          </div>
          <button
            className="mini-icon-button no-drag motion-press"
            onClick={handleExpand}
            title="展开"
          >
            <ChevronUp size={13} />
          </button>
        </div>

        {/* 中央：巨型时间 - 主角 */}
        <div className="flex items-baseline justify-center gap-2">
          <span
            className={`timer-digit motion-digit text-[26px] font-bold leading-none ${activeTone}`}
            style={{
              textShadow: isRunning
                ? '0 0 18px rgb(var(--app-success) / 0.45)'
                : isPaused
                  ? '0 0 18px rgb(var(--app-warning) / 0.4)'
                  : 'none',
            }}
          >
            {formatDuration(isIdle ? 0 : primaryMs)}
          </span>
        </div>

        {/* 底部：累计 */}
        <div className="flex items-center justify-center gap-1.5">
          <span className="text-[9px] font-medium text-fg-subtle">{cumulativeLabel}</span>
          <span className="timer-digit motion-digit text-[11px] font-bold text-fg-muted">
            {formatDuration(cumulativeMs)}
          </span>
        </div>
      </div>
    );
  }

  // ─── EXPANDED 模式（420×184）- 专注甲板 ───
  return (
    <div
      ref={containerRef}
      className={`mini-window-shell mini-window-${state} motion-base flex h-full w-full flex-col px-4 py-3 text-fg`}
    >
      {/* 顶部：状态 + 任务 + 窗口控制 */}
      <div className="mini-top-row flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <StateDot state={state} size="xs" />
          <span className={`shrink-0 text-[10px] font-bold ${STATE_TEXT[state]}`}>
            {STATE_LABEL[state]}
          </span>
          <span className="h-3 w-px bg-border/80" />
          <Link2 size={10} className="shrink-0 text-accent" />
          <span className="truncate text-[11px] font-medium text-fg-muted">
            {currentTaskTitle ?? (state === 'idle' ? '点击开始专注' : '未关联任务')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="mini-icon-button no-drag motion-press"
            onClick={handleOpenMain}
            title="打开主窗口"
          >
            <Maximize2 size={12} />
          </button>
          <button
            className="mini-icon-button no-drag motion-press"
            onClick={handleCollapse}
            title="缩小"
          >
            <ChevronDown size={13} />
          </button>
        </div>
      </div>

      {/* 中部：巨型时间 + 累计统计 */}
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-bold uppercase tracking-wide text-fg-subtle">
            {isPaused ? '当前暂停片段' : isRunning ? '当前专注片段' : '准备开始'}
          </div>
          <div
            className={`timer-digit motion-digit mt-0.5 text-[38px] font-bold leading-none ${activeTone}`}
            style={{
              textShadow: isRunning
                ? '0 0 28px rgb(var(--app-success) / 0.35)'
                : isPaused
                  ? '0 0 28px rgb(var(--app-warning) / 0.3)'
                  : 'none',
            }}
          >
            {formatDuration(isIdle ? 0 : displayActive)}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <MiniStat label="累计专注" value={formatDuration(cumulativeActiveMs)} tone="focus" />
          <MiniStat label="累计暂停" value={formatDuration(cumulativePauseMs)} tone="pause" />
        </div>
      </div>

      {/* 底部：控制 + 总历时 */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-medium text-fg-subtle">总历时</span>
          <span className="timer-digit motion-digit text-[11px] font-bold text-fg-muted">
            {formatDuration(wallElapsedMs)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`mini-primary-button ${primaryButtonClass} no-drag motion-press inline-flex h-7 items-center gap-1.5 px-4 text-[11px] font-semibold`}
            onClick={handleToggle}
          >
            {state === 'running' ? <Pause size={12} /> : <Play size={12} />}
            {state === 'running' ? '暂停' : state === 'paused' ? '继续' : '开始'}
          </button>
          <button
            className="mini-secondary-button no-drag motion-press inline-flex h-7 items-center gap-1.5 px-3.5 text-[11px] font-medium disabled:pointer-events-none disabled:opacity-30"
            onClick={handleStop}
            disabled={state === 'idle' || state === 'finished'}
          >
            <Square size={11} />
            结束
          </button>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone = 'default',
  className = '',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'focus' | 'pause';
  className?: string;
}) {
  const toneClass =
    tone === 'focus' ? 'text-success' : tone === 'pause' ? 'text-warning' : 'text-fg-muted';
  return (
    <div className={`mini-stat-card motion-state-transition min-w-0 px-2.5 py-1 ${className}`}>
      <div className={`truncate text-[9px] font-bold ${toneClass}`}>{label}</div>
      <div className="timer-digit motion-digit mt-0.5 truncate text-[12px] font-bold leading-none text-fg">
        {value}
      </div>
    </div>
  );
}
