// 专注小窗 - FocusLink 核心交互入口
// 三种模式：EXPANDED（默认）、COMPACT（宽 < 260px）、COLLAPSED（40px 高度横条）
// 透明无边框窗口，始终置顶，支持拖拽和主题同步
// 暂停态统一使用红色（danger），专注态使用绿色（accent）
import { useCallback, useEffect, useRef, useState } from 'react';
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

// 暂停态统一红色（danger），专注态绿色（accent）
const STATE_DOT: Record<string, string> = {
  idle: 'bg-fg-subtle',
  running: 'state-dot-running',
  paused: 'bg-danger',
  finished: 'bg-success',
  stopping: 'bg-fg-subtle',
};

const STATE_TEXT: Record<string, string> = {
  idle: 'text-fg-muted',
  running: 'text-accent',
  paused: 'text-danger',
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
  return (
    <span
      className={`inline-block flex-shrink-0 rounded-full ${sizeClass} ${STATE_DOT[state] ?? STATE_DOT.idle}`}
    />
  );
}

// ─── 状态线组件 ────────────────────────────────────────────────

function ProgressBar({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="h-1 w-14 overflow-hidden rounded-full bg-bg-subtle">
        <div className="h-full w-2/3 rounded-full bg-accent transition-all duration-500" />
      </div>
    );
  }
  return (
    <div className="flex w-full items-center gap-2">
      <div className="progress-bar h-1 flex-1 overflow-hidden rounded-full">
        <div className="progress-bar-fill h-full w-full rounded-full transition-all duration-500" />
      </div>
      <span className="text-[9px] text-fg-subtle">正计时</span>
    </div>
  );
}
// ─── MiniWindow 主组件 ──────────────────────────────────────────

export function MiniWindow() {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null);
  const [, setNow] = useState(Date.now());
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [containerWidth, setContainerWidth] = useState(300);
  const containerRef = useRef<HTMLDivElement>(null);

  // ─── 初始化设置 ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const s = await window.focuslink.settings.get();
        setSettings(s);
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
        setSettings(s);
        setCollapsed(s.miniWindow.collapsed);
        applyThemeClass(s);
      }
    });
    return () => unsub();
  }, []);

  // ─── 容器宽度检测（EXPANDED vs COMPACT） ─────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setContainerWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
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

  const isCompact = !collapsed && containerWidth < 260;
  const isExpanded = !collapsed && containerWidth >= 260;

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

  // ─── COLLAPSED 模式（40px 高度横条） ───────────────────────
  // 收起态：状态点（专注绿/暂停红）+ 当前片段时间
  if (collapsed) {
    return (
      <div
        ref={containerRef}
        className="glass flex h-full w-full items-center overflow-hidden rounded-lg border border-border/80 px-3 text-fg"
        onDoubleClick={handleExpand}
        title="双击展开"
      >
        {/* 左侧：状态点 + 时间 + 状态文字 */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <StateDot state={state} size="xs" />
          <span
            className={`timer-digit text-sm font-bold tracking-tight ${
              isPaused ? 'text-danger' : isRunning ? 'text-accent' : ''
            }`}
          >
            {formatDuration(displayActive)}
          </span>
          <span className={`text-[10px] font-semibold ${STATE_TEXT[state]}`}>
            {STATE_LABEL[state]}
          </span>
        </div>

        {/* 右侧：进度条 + 展开按钮 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <ProgressBar compact />
          <button
            className="no-drag rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg-subtle hover:text-fg"
            onClick={handleExpand}
            title="展开"
          >
            <ChevronUp size={13} />
          </button>
        </div>
      </div>
    );
  }

  // ─── COMPACT 模式（宽 < 260px，单行） ──────────────────────
  // 紧凑态：状态 + 当前专注/当前暂停 + 任务短标题
  if (isCompact) {
    return (
      <div
        ref={containerRef}
        className="glass flex h-full w-full items-center gap-2 overflow-hidden rounded-lg border border-border/80 px-3 text-fg"
      >
        <div className="flex min-w-0 flex-none items-center gap-1.5">
          <StateDot state={state} />
          <div className="min-w-0">
            <span
              className={`timer-digit block text-base font-bold leading-none ${
                isPaused ? 'text-danger' : isRunning ? 'text-accent' : ''
              }`}
            >
              {formatDuration(displayActive)}
            </span>
            <span className="block max-w-[54px] truncate text-[10px] leading-tight text-fg-subtle">
              {currentTaskTitle ?? (state === 'idle' ? '准备开始' : '未关联任务')}
            </span>
          </div>
        </div>

        <div className="flex flex-none items-center gap-0.5">
          <button
            className="no-drag rounded-md bg-bg-subtle/70 p-1 text-fg-muted transition-colors hover:bg-accent/10 hover:text-accent"
            onClick={handleToggle}
            title={state === 'running' ? '暂停' : state === 'paused' ? '继续' : '开始'}
          >
            {state === 'running' ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button
            className="no-drag rounded-md bg-bg-subtle/70 p-1 text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg disabled:opacity-30"
            onClick={handleStop}
            disabled={state === 'idle' || state === 'finished'}
            title="结束"
          >
            <Square size={12} />
          </button>
        </div>
      </div>
    );
  }

  // ─── EXPANDED 模式（默认，完整 UI，含 6 项核心信息） ───────
  // 显示：当前任务 / 当前专注 / 累计专注 / 当前暂停 / 累计暂停 / 总历时
  return (
    <div
      ref={containerRef}
      className="glass relative h-full w-full overflow-hidden rounded-lg border border-border/80 p-3 text-fg"
    >
      {/* 顶部状态行：状态点 + 状态标签 + 操作按钮 */}
      <div className="flex items-center gap-1.5">
        <StateDot state={state} size="xs" />
        <span className={`text-[10px] font-semibold ${STATE_TEXT[state]}`}>
          {STATE_LABEL[state]}
        </span>
      </div>
      <div className="absolute right-3 top-3 flex items-center gap-0.5">
        <button
          className="no-drag rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg-subtle hover:text-fg"
          onClick={handleOpenMain}
          title="打开主窗口"
        >
          <Maximize2 size={11} />
        </button>
        <button
          className="no-drag rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg-subtle hover:text-fg"
          onClick={handleCollapse}
          title="收起"
        >
          <ChevronDown size={12} />
        </button>
      </div>

      {/* 当前任务 */}
      <div className="mt-1.5 flex items-center gap-1.5 px-0.5">
        <Link2 size={10} className="flex-shrink-0 text-accent" />
        <span className="max-w-[230px] truncate text-[11px] font-medium text-fg-muted">
          {currentTaskTitle ?? (state === 'idle' ? '点击开始专注' : '未关联任务')}
        </span>
      </div>

      {/* 大号计时数字（当前片段时间） */}
      <div className="mt-2 flex flex-col items-center gap-0.5">
        <span
          className={`timer-digit text-[26px] font-bold leading-none tabular-nums ${
            isPaused ? 'text-danger' : isRunning ? 'text-accent' : ''
          }`}
        >
          {formatDuration(displayActive)}
        </span>
        <span className="text-[9px] font-medium text-fg-subtle">
          {isPaused ? '当前暂停片段' : isRunning ? '当前专注片段' : '尚未开始'}
        </span>
      </div>

      {/* 6 项统计：当前专注 / 累计专注 / 当前暂停 / 累计暂停 / 总历时（合并为 2×3 网格） */}
      <div className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1.5 px-0.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold text-accent">当前专注</span>
          <span className="timer-digit text-[11px] font-bold tabular-nums text-fg">
            {formatDuration(isRunning ? currentFocusMs : 0)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold text-accent/80">累计专注</span>
          <span className="timer-digit text-[11px] font-bold tabular-nums text-fg-muted">
            {formatDuration(cumulativeActiveMs)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold text-danger">当前暂停</span>
          <span
            className={`timer-digit text-[11px] font-bold tabular-nums ${
              isPaused ? 'text-danger' : 'text-fg-subtle'
            }`}
          >
            {formatDuration(isPaused ? currentPauseMs : 0)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold text-danger/80">累计暂停</span>
          <span className="timer-digit text-[11px] font-bold tabular-nums text-fg-muted">
            {formatDuration(cumulativePauseMs)}
          </span>
        </div>
        <div className="col-span-2 flex items-center justify-between border-t border-border/50 pt-1.5">
          <span className="text-[9px] font-semibold text-fg-subtle">总历时</span>
          <span className="timer-digit text-[11px] font-bold tabular-nums text-fg">
            {formatDuration(wallElapsedMs)}
          </span>
        </div>
      </div>

      {/* 进度条（25 分钟目标） */}
      <div className="absolute bottom-10 left-3 right-3">
        <ProgressBar />
      </div>

      {/* 底部控制按钮 */}
      <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center gap-2">
        <button
          className="no-drag inline-flex items-center gap-1.5 rounded-lg bg-accent/95 px-3.5 py-1.5 text-[11px] font-semibold text-accent-fg transition-all hover:brightness-110 active:scale-[0.97]"
          onClick={handleToggle}
        >
          {state === 'running' ? <Pause size={11} /> : <Play size={11} />}
          {state === 'running' ? '暂停' : state === 'paused' ? '继续' : '开始'}
        </button>
        <button
          className="no-drag inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-subtle/50 px-3 py-1.5 text-[11px] font-medium text-fg-muted transition-all hover:bg-bg-elevated hover:text-fg disabled:pointer-events-none disabled:opacity-30"
          onClick={handleStop}
          disabled={state === 'idle' || state === 'finished'}
        >
          <Square size={10} />
          结束
        </button>
      </div>
    </div>
  );
}
