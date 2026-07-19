// Two-preset focus companion: a dense control panel and a dockable edge strip.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { AppSettings, TimerSnapshot } from '@shared/types';
import {
  FOCUS_COLORS,
  FONT_PROFILES,
  LEGACY_TIMER_STYLES,
  TIMER_STYLES,
  resolveFocusColor,
  resolveFontProfile,
  resolveThemeAppearance,
  resolveTimerStyle,
} from '@shared/theme';
import { FlipDigits } from '../../ui/FlipDigits';
import { Icon } from '../../ui/Icon';
import { formatDuration, formatDurationPadded } from '../../lib/time';
import { resolveMiniTaskDisplayMode, type MiniTaskDisplayMode } from './miniDisplayPolicy';
import {
  getCumulativeActiveMs,
  getCumulativePauseMs,
  getCurrentPauseDisplayMs,
  getCurrentSegmentDisplayMs,
  getCurrentTaskTitle,
  getWallElapsedMs,
} from '@shared/focus/selectors';
import { MINI_WINDOW_DOCK_TRANSITION_MS } from '@shared/miniWindowLayout';

const STATE_META: Record<
  TimerSnapshot['state'],
  {
    label: string;
    currentLabel: string;
    stripLabel: string;
    textClass: string;
    dotClass: string;
  }
> = {
  idle: {
    label: '待开始',
    currentLabel: '当前专注',
    stripLabel: '专注',
    textClass: 'text-fg-muted',
    dotClass: 'bg-fg-subtle',
  },
  running: {
    label: '专注中',
    currentLabel: '本段专注',
    stripLabel: '专注',
    textClass: 'text-success',
    dotClass: 'state-dot-running',
  },
  paused: {
    label: '已暂停',
    currentLabel: '本段暂停',
    stripLabel: '暂停',
    textClass: 'text-pause',
    dotClass: 'bg-pause',
  },
  finished: {
    label: '已结束',
    currentLabel: '本轮专注',
    stripLabel: '完成',
    textClass: 'text-success',
    dotClass: 'bg-success',
  },
  stopping: {
    label: '结束中',
    currentLabel: '本轮专注',
    stripLabel: '结束',
    textClass: 'text-fg-muted',
    dotClass: 'bg-fg-subtle',
  },
};

const panelMotion = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1] as const,
};

const MINI_SHELL_STYLE = {
  '--mini-dock-transition-duration': `${MINI_WINDOW_DOCK_TRANSITION_MS}ms`,
} as CSSProperties;

function applyThemeClass(settings: AppSettings): void {
  const root = document.documentElement;
  let effectiveTheme: 'dark' | 'light' = 'dark';
  if (settings.miniWindow.followMainTheme) {
    effectiveTheme = resolveThemeAppearance(
      settings.theme,
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    );
  } else if (settings.miniWindow.themeMode === 'dark') {
    effectiveTheme = 'dark';
  } else if (settings.miniWindow.themeMode === 'light') {
    effectiveTheme = 'light';
  } else {
    effectiveTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  root.classList.toggle('light', effectiveTheme === 'light');
  root.classList.toggle('dark', effectiveTheme === 'dark');
  ['quiet', 'dawn', 'bloom'].forEach((family) => root.classList.remove(`theme-${family}`));
  delete root.dataset.themeFamily;
  [...FONT_PROFILES, 'plex', 'geist', 'manrope', 'sora'].forEach((profile) =>
    root.classList.remove(`font-profile-${profile}`),
  );
  root.classList.add(`font-profile-${resolveFontProfile(settings.fontProfile)}`);
  ['indigo', 'violet', 'emerald', 'rose', 'amber', 'sky'].forEach((accent) =>
    root.classList.remove(`accent-${accent}`),
  );
  FOCUS_COLORS.forEach((color) => root.classList.remove(`focus-color-${color}`));
  root.classList.add(`focus-color-${resolveFocusColor(settings.focusColor)}`);
  [...TIMER_STYLES, ...LEGACY_TIMER_STYLES].forEach((style) =>
    root.classList.remove(`timer-style-${style}`),
  );
  root.classList.add(`timer-style-${resolveTimerStyle(settings.timerStyle)}`);
}

function MiniStateBadge({ state }: { state: TimerSnapshot['state'] }) {
  const meta = STATE_META[state];
  return (
    <motion.div
      key={state}
      className={`mini-state-badge ${meta.textClass}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={panelMotion}
      data-testid="mini-state-badge"
    >
      <span className={`mini-state-dot ${meta.dotClass}`} aria-hidden="true" />
      <span>{meta.label}</span>
    </motion.div>
  );
}

function MiniIconButton({
  label,
  testId,
  onClick,
  children,
}: {
  label: string;
  testId: string;
  onClick: (event: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      className="mini-icon-button no-drag"
      data-testid={testId}
      onClick={onClick}
      title={label}
      aria-label={label}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.12 }}
    >
      {children}
    </motion.button>
  );
}

export function MiniWindow() {
  const reduceMotion = useReducedMotion();
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null);
  const [, setNow] = useState(Date.now());
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const [dockingEdge, setDockingEdge] = useState<'left' | 'right' | 'top' | 'bottom' | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.focuslink.settings
      .get()
      .then((next) => {
        if (!mounted) return;
        setSettings(next);
        setCollapsed(next.miniWindow.collapsed);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void window.focuslink.timer.getSnapshot().then((next) => {
      if (mounted) setSnapshot(next);
    });
    const unsubscribe = window.focuslink.on('tick', (next) => {
      if (mounted) setSnapshot(next as TimerSnapshot);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.focuslink.on('settings:changed', (value) => {
      const next = value as AppSettings;
      if (!next) return;
      setSettings(next);
      setCollapsed(next.miniWindow.collapsed);
      if (next.miniWindow.collapsed) setDockingEdge(null);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = window.focuslink.on('mini:dock-transition', (transition) => {
      setDockingEdge(transition.phase === 'prepare' ? transition.edge : null);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!settings) return;
    applyThemeClass(settings);
    const followsSystem =
      (settings.miniWindow.followMainTheme && settings.theme === 'system') ||
      (!settings.miniWindow.followMainTheme && settings.miniWindow.themeMode === 'system');
    if (!followsSystem) return;

    const media = window.matchMedia('(prefers-color-scheme: light)');
    const handleSystemTheme = () => applyThemeClass(settings);
    media.addEventListener('change', handleSystemTheme);
    return () => media.removeEventListener('change', handleSystemTheme);
  }, [settings]);

  useEffect(() => {
    if (snapshot?.state !== 'running' && snapshot?.state !== 'paused') return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [snapshot?.state, snapshot?.lastTick, snapshot?.currentPauseStartedAt]);

  const state = snapshot?.state ?? 'idle';
  const meta = STATE_META[state];
  const nowMs = Date.now();
  const taskTitleRef = useRef<HTMLSpanElement>(null);
  // 任务名显示策略：1=单行完整；2=两行完整；3=极长，单行克制滚动
  const [taskDisplay, setTaskDisplay] = useState<MiniTaskDisplayMode>('single');
  const currentFocusMs = getCurrentSegmentDisplayMs(snapshot, nowMs);
  const currentPauseMs = getCurrentPauseDisplayMs(snapshot, nowMs);
  const cumulativeActiveMs = getCumulativeActiveMs(snapshot, nowMs);
  const cumulativePauseMs = getCumulativePauseMs(snapshot, nowMs);
  const wallElapsedMs = getWallElapsedMs(snapshot, nowMs);
  const currentTaskTitle = getCurrentTaskTitle(snapshot) ?? '未关联任务';
  useEffect(() => {
    const el = taskTitleRef.current;
    if (!el || collapsed) return;
    // 21px 任务行只放单行：装得下就完整显示，装不下走克制滚动（不用省略号/渐隐）
    setTaskDisplay(resolveMiniTaskDisplayMode(el.scrollWidth, el.clientWidth, !!reduceMotion));
  }, [currentTaskTitle, collapsed, reduceMotion]);
  const isRunning = state === 'running';
  const isPaused = state === 'paused';
  const isIdle = state === 'idle' || state === 'finished';
  const primaryMs = isPaused ? currentPauseMs : currentFocusMs;
  const primaryButtonClass = isRunning
    ? 'mini-action-hold'
    : isPaused
      ? 'mini-action-resume'
      : 'mini-action-focus';
  const displayPrimaryMs = isIdle ? (state === 'finished' ? currentFocusMs : 0) : primaryMs;
  const compactTime = useMemo(() => formatDurationPadded(displayPrimaryMs), [displayPrimaryMs]);
  // 进入小时档（"H:MM:SS"）后数字串变长，两态都换用紧凑字号防止 184px 溢出
  const isLongTime = compactTime.length > 5;
  const focusShare = useMemo(() => {
    if (wallElapsedMs <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((cumulativeActiveMs / wallElapsedMs) * 100)));
  }, [cumulativeActiveMs, wallElapsedMs]);
  // 进度轨上的红色暂停段：紧随 accent 专注段之后，合计不超过 100%
  const pauseShare = useMemo(() => {
    if (wallElapsedMs <= 0) return 0;
    const share = Math.round((cumulativePauseMs / wallElapsedMs) * 100);
    return Math.max(0, Math.min(100 - focusShare, share));
  }, [cumulativePauseMs, wallElapsedMs, focusShare]);

  const handleToggle = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      if (state === 'finished') await window.focuslink.timer.reset();
      setSnapshot(await window.focuslink.timer.toggle());
    },
    [state],
  );

  const handleStop = useCallback(async (event: React.MouseEvent) => {
    event.stopPropagation();
    setSnapshot(await window.focuslink.timer.stop());
  }, []);

  const handleCollapse = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    window.focuslink.mini.collapse();
  }, []);

  const handleExpand = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    window.focuslink.mini.expand();
  }, []);

  const handleOpenMain = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    window.focuslink.window.show();
  }, []);

  if (collapsed === null) {
    return (
      <div
        className="mini-window-shell h-full w-full opacity-0"
        data-testid="mini-shell"
        data-mode="loading"
        aria-busy="true"
        style={MINI_SHELL_STYLE}
      />
    );
  }

  return (
    <div
      data-testid="mini-shell"
      data-state={state}
      data-mode={collapsed ? 'collapsed' : 'expanded'}
      data-docking-edge={dockingEdge ?? undefined}
      className={`mini-window-shell mini-window-${state} ${collapsed ? 'mini-window-collapsed' : 'mini-window-expanded'} ${dockingEdge ? `mini-window-docking mini-dock-edge-${dockingEdge}` : ''} h-full w-full text-fg`}
      style={MINI_SHELL_STYLE}
      onDoubleClick={collapsed ? handleExpand : undefined}
      title={collapsed ? '点击箭头展开；拖离屏幕边缘也会自动展开' : undefined}
    >
      <span className="mini-state-rail" aria-hidden="true" />
      <span className="mini-dock-cue" aria-hidden="true" />

      <AnimatePresence mode="sync" initial={false}>
        {collapsed ? (
          <motion.section
            key="collapsed"
            className="mini-collapsed-content"
            data-testid="mini-collapsed-content"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : panelMotion}
          >
            <span
              className="mini-edge-progress no-drag"
              role="progressbar"
              aria-label="本轮专注占比"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={focusShare}
              aria-valuetext={`有效专注占总历时 ${focusShare}%`}
              style={{ '--mini-progress': `${focusShare}%` } as CSSProperties}
            >
              <span className="mini-edge-progress-fill" />
              <span
                className="mini-edge-progress-pause"
                aria-hidden="true"
                style={
                  {
                    '--mini-pause-start': `${focusShare}%`,
                    '--mini-pause-width': `${pauseShare}%`,
                  } as CSSProperties
                }
              />
              <span className="mini-edge-progress-glint" aria-hidden="true" />
            </span>
            <div className="mini-collapsed-current">
              <span className="mini-collapsed-state">
                <span className={`mini-state-dot ${meta.dotClass}`} aria-hidden="true" />
                <span className={`mini-collapsed-label ${meta.textClass}`}>{meta.stripLabel}</span>
              </span>
              <div
                className={`mini-display-time mini-collapsed-time ${isLongTime ? 'mini-time-long' : ''}`}
                data-testid="mini-current-time"
              >
                <FlipDigits value={compactTime} />
              </div>
            </div>
            <MiniIconButton label="展开" testId="mini-expand" onClick={handleExpand}>
              <Icon.ChevronRight size="xs" />
            </MiniIconButton>
          </motion.section>
        ) : (
          <motion.section
            key="expanded"
            className="mini-expanded-content"
            data-testid="mini-expanded-content"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.985, y: 2 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.985 }}
            transition={reduceMotion ? { duration: 0 } : panelMotion}
          >
            <header className="mini-expanded-header">
              <MiniStateBadge state={state} />
              <div className="mini-header-actions">
                <MiniIconButton label="打开主窗口" testId="mini-open-main" onClick={handleOpenMain}>
                  <Icon.Maximize size="xs" />
                </MiniIconButton>
                <MiniIconButton label="收起" testId="mini-collapse" onClick={handleCollapse}>
                  <Icon.ChevronDown size="xs" />
                </MiniIconButton>
              </div>
            </header>

            <div
              className={`mini-task-block ${
                taskDisplay === 'single'
                  ? ''
                  : taskDisplay === 'scroll'
                    ? 'is-scroll'
                    : 'is-marquee'
              }`}
            >
              <span
                ref={taskTitleRef}
                className="mini-task-title"
                data-testid="mini-task-title"
                title={currentTaskTitle}
              >
                {currentTaskTitle}
              </span>
            </div>

            <div className="mini-expanded-body">
              <div className="mini-focus-core">
                <span className={`mini-current-label ${meta.textClass}`}>{meta.currentLabel}</span>
                <div
                  className={`mini-display-time mini-expanded-time ${isLongTime ? 'mini-time-long' : ''}`}
                  data-testid="mini-current-time"
                >
                  <FlipDigits value={compactTime} />
                </div>
              </div>

              <div className="mini-metric-rail" data-testid="mini-metric-rail">
                <MiniMetric
                  label="累计专注"
                  value={formatDuration(cumulativeActiveMs)}
                  tone="focus"
                  testId="mini-focus-total"
                />
                <MiniMetric
                  label="累计暂停"
                  value={formatDuration(cumulativePauseMs)}
                  tone="pause"
                  testId="mini-pause-total"
                />
                <MiniMetric
                  label="总历时"
                  value={formatDuration(wallElapsedMs)}
                  tone="neutral"
                  testId="mini-wall-total"
                />
              </div>
            </div>

            <footer className="mini-expanded-footer">
              <div className="mini-action-dock">
                <motion.button
                  className={`mini-primary-button ${primaryButtonClass} no-drag`}
                  data-testid="mini-primary-action"
                  onClick={handleToggle}
                  whileHover={{ y: -1 }}
                  whileTap={{ y: 0, scale: 0.98 }}
                  transition={{ duration: 0.12 }}
                >
                  {state === 'running' ? <Icon.Pause size="xs" /> : <Icon.Play size="xs" />}
                  {state === 'running' ? '暂停' : state === 'paused' ? '继续' : '开始'}
                </motion.button>
                <motion.button
                  className="mini-secondary-button no-drag"
                  data-testid="mini-stop"
                  onClick={handleStop}
                  disabled={state === 'idle' || state === 'finished'}
                  whileHover={{ y: -1 }}
                  whileTap={{ y: 0, scale: 0.98 }}
                  transition={{ duration: 0.12 }}
                >
                  <Icon.Square size="xs" />
                  结束
                </motion.button>
              </div>
            </footer>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone: 'focus' | 'pause' | 'neutral';
  testId: string;
}) {
  return (
    <div className={`mini-metric mini-metric-${tone}`} data-testid={testId}>
      <span>{label}</span>
      <strong className="mini-data-time">{value}</strong>
    </div>
  );
}
