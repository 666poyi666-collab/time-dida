// 专注小窗 - FocusLink 核心交互入口
// 两种模式：EXPANDED（420×184 详情卡）、COLLAPSED（260×88 缩小卡）
// 透明无边框窗口，始终置顶，支持拖拽和主题同步
// 暂停态统一使用橙色（warning），专注态使用绿色（accent）
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

// ─── 常量 ───────────────────────────────────────────────────────

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

// 暂停态统一橙色（warning），专注态绿色（accent）
const STATE_DOT: Record<string, string> = {
  idle: 'bg-fg-subtle',
  running: 'state-dot-running',
  paused: 'bg-warning',
  finished: 'bg-success',
  stopping: 'bg-fg-subtle',
};

const STATE_TEXT: Record<string, string> = {
  idle: 'text-fg-muted',
  running: 'text-accent',
  paused: 'text-warning',
  finished: 'text-success',
  stopping: 'text-fg-muted',
};

// ─── 主题应用 ───────────────────────────────────────────────────

/** 根据 settings 应用主题 class 到 document.documentElement */
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

  // 主题色
  Object.values(ACCENT_CLASS).forEach((cls) => root.classList.remove(cls));
  const accentClass = ACCENT_CLASS[s.accentColor];
  if (accentClass) {
    root.classList.add(accentClass);
  }
}

// ─── 状态点组件 ──────────────────────────────────────────────────

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

// ─── MiniWindow 主组件 ──────────────────────────────────────────

export function MiniWindow() {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null);
  const [, setNow] = useState(Date.now());
  const [collapsed, setCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ─── 初始化设置 ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const s = await window.focuslink.settings.get();
        setCollapsed(s.miniWindow.collapsed);
        applyThemeClass(s);
      } catch {
        // 静默失败，用默认深色
      }
    })();
  }, []);

  // ─── 订阅 tick 事件 ───────────────────────────────────────────
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

  // ─── 监听设置变更（同步主题 + 收起状态） ───────────────────
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

  // ─── running / paused 时本地每秒刷新显示 ─────────────────────
  // 小窗大时间统一显示"当前片段时间"（专注片段或暂停片段），不再显示累计 activeElapsedMs
  useEffect(() => {
    if (snapshot?.state !== 'running' && snapshot?.state !== 'paused') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [snapshot?.state, snapshot?.lastTick, snapshot?.currentPauseStartedAt]);

  // ─── 派生状态 ────────────────────────────────────────────────
  const state = snapshot?.state ?? 'idle';
  const nowMs = Date.now();
  // 6 项核心信息，全部走统一 selector
  const displayActive = getMainDisplayMs(snapshot, nowMs); // 大时间（当前片段）
  const currentFocusMs = getCurrentSegmentDisplayMs(snapshot, nowMs); // 当前专注片段
  const currentPauseMs = getCurrentPauseDisplayMs(snapshot, nowMs); // 当前暂停片段
  const cumulativeActiveMs = getCumulativeActiveMs(snapshot, nowMs); // 累计专注
  const cumulativePauseMs = getCumulativePauseMs(snapshot, nowMs); // 累计暂停
  const wallElapsedMs = getWallElapsedMs(snapshot); // 总历时
  const currentTaskTitle = getCurrentTaskTitle(snapshot);
  const isRunning = state === 'running';
  const isPaused = state === 'paused';
  const primaryMs = isPaused ? currentPauseMs : currentFocusMs;
  const cumulativeMs = isPaused ? cumulativePauseMs : cumulativeActiveMs;
  const primaryLabel = isPaused ? '当前暂停' : '当前专注';
  const cumulativeLabel = isPaused ? '累计暂停' : '累计专注';
  const activeTone = isPaused ? 'text-warning' : isRunning ? 'text-accent' : 'text-fg';

  // ─── 事件处理 ────────────────────────────────────────────────
  const handleToggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const snap = await window.focuslink.timer.toggle();
    setSnapshot(snap);
  }, []);

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

  // ─── COLLAPSED 模式（260×88 缩小卡） ───────────────────────
  // 缩小态只展示当前 + 累计，避免信息挤在一起。
  if (collapsed) {
    return (
      <div
        ref={containerRef}
        className="mini-window-shell motion-base flex h-full w-full flex-col rounded-[24px] px-3.5 py-2.5 text-fg"
        onDoubleClick={handleExpand}
        title="双击展开"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <StateDot state={state} size="xs" />
            <span className={`truncate text-[10px] font-semibold ${STATE_TEXT[state]}`}>
              {STATE_LABEL[state]}
            </span>
          </div>
          <button
            className="no-drag motion-press rounded-full p-1 text-fg-subtle hover:bg-bg-subtle hover:text-fg"
            onClick={handleExpand}
            title="展开"
          >
            <ChevronUp size={13} />
          </button>
        </div>

        <div className="mt-2 grid min-h-0 flex-1 grid-cols-2 gap-2">
          <div className="min-w-0 rounded-2xl border border-border/70 bg-bg-subtle/55 px-2.5 py-1.5">
            <div className="truncate text-[9px] font-semibold text-fg-subtle">{primaryLabel}</div>
            <div
              className={`timer-digit motion-digit mt-0.5 text-[17px] font-bold leading-none ${activeTone}`}
            >
              {formatDuration(primaryMs)}
            </div>
          </div>
          <div className="min-w-0 rounded-2xl border border-border/70 bg-bg-subtle/35 px-2.5 py-1.5">
            <div className="truncate text-[9px] font-semibold text-fg-subtle">
              {cumulativeLabel}
            </div>
            <div className="timer-digit motion-digit mt-0.5 text-[17px] font-bold leading-none text-fg">
              {formatDuration(cumulativeMs)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── EXPANDED 模式（420×184 详情卡） ───────
  return (
    <div
      ref={containerRef}
      className="mini-window-shell motion-base flex h-full w-full flex-col rounded-[28px] px-4 py-3 text-fg"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <StateDot state={state} size="xs" />
          <span className={`shrink-0 text-[10px] font-semibold ${STATE_TEXT[state]}`}>
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
            className="no-drag motion-press rounded-full p-1.5 text-fg-subtle hover:bg-bg-subtle hover:text-fg"
            onClick={handleOpenMain}
            title="打开主窗口"
          >
            <Maximize2 size={12} />
          </button>
          <button
            className="no-drag motion-press rounded-full p-1.5 text-fg-subtle hover:bg-bg-subtle hover:text-fg"
            onClick={handleCollapse}
            title="缩小"
          >
            <ChevronDown size={13} />
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9px] font-semibold text-fg-subtle">
            {isPaused ? '当前暂停片段' : isRunning ? '当前专注片段' : '当前片段'}
          </div>
          <div
            className={`timer-digit motion-digit mt-0.5 text-[34px] font-bold leading-none ${activeTone}`}
          >
            {formatDuration(displayActive)}
          </div>
        </div>
        <div className="grid w-[148px] grid-cols-2 gap-1.5">
          <MiniStat label="累计专注" value={formatDuration(cumulativeActiveMs)} tone="focus" />
          <MiniStat label="累计暂停" value={formatDuration(cumulativePauseMs)} tone="pause" />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-1.5">
        <MiniStat
          label="当前专注"
          value={formatDuration(isRunning ? currentFocusMs : 0)}
          tone="focus"
          className="col-span-2"
        />
        <MiniStat
          label="当前暂停"
          value={formatDuration(isPaused ? currentPauseMs : 0)}
          tone="pause"
          className="col-span-2"
        />
        <MiniStat label="总历时" value={formatDuration(wallElapsedMs)} className="col-span-1" />
      </div>

      <div className="mt-auto flex items-center justify-center gap-2 pt-2">
        <button
          className="no-drag motion-press inline-flex h-7 items-center gap-1.5 rounded-full bg-accent/95 px-4 text-[11px] font-semibold text-accent-fg hover:brightness-110"
          onClick={handleToggle}
        >
          {state === 'running' ? <Pause size={12} /> : <Play size={12} />}
          {state === 'running' ? '暂停' : state === 'paused' ? '继续' : '开始'}
        </button>
        <button
          className="no-drag motion-press inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-bg-subtle/55 px-3.5 text-[11px] font-medium text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:pointer-events-none disabled:opacity-30"
          onClick={handleStop}
          disabled={state === 'idle' || state === 'finished'}
        >
          <Square size={11} />
          结束
        </button>
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
    tone === 'focus' ? 'text-accent' : tone === 'pause' ? 'text-warning' : 'text-fg-muted';
  return (
    <div
      className={`motion-state-transition min-w-0 rounded-2xl border border-border/70 bg-bg-subtle/45 px-2 py-1.5 ${className}`}
    >
      <div className={`truncate text-[9px] font-semibold ${toneClass}`}>{label}</div>
      <div className="timer-digit motion-digit mt-0.5 truncate text-[12px] font-bold leading-none text-fg">
        {value}
      </div>
    </div>
  );
}
