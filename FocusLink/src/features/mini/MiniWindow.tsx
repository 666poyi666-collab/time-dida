// Two-preset focus companion: a dense control panel and a dockable edge strip.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { FocusLinkAPI } from '@shared/ipc/api';
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
import { formatDuration, formatDurationPadded } from '../../lib/time';
import { FocusGlyph } from '../../ui/icons/FocusGlyph';
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
import { pauseDissolveParticles } from '@shared/focus/bandMath';

const STATE_META: Record<
  TimerSnapshot['state'],
  {
    label: string;
    stripLabel: string;
    textClass: string;
    dotClass: string;
  }
> = {
  idle: {
    label: '待开始',
    stripLabel: '专注',
    textClass: 'text-fg-muted',
    dotClass: 'bg-fg-subtle',
  },
  running: {
    label: '专注中',
    stripLabel: '专注',
    textClass: 'text-success',
    dotClass: 'state-dot-running',
  },
  paused: {
    label: '已暂停',
    stripLabel: '暂停',
    textClass: 'text-pause',
    dotClass: 'bg-pause',
  },
  finished: {
    label: '已结束',
    stripLabel: '完成',
    textClass: 'text-success',
    dotClass: 'bg-success',
  },
  stopping: {
    label: '结束中',
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

type MiniTimerControls = Pick<FocusLinkAPI['timer'], 'reset' | 'stop' | 'toggle'>;

export function resolveMiniPrimaryAction(state: TimerSnapshot['state']): {
  label: string;
  glyph: 'pause' | 'play' | 'stop';
  disabled: boolean;
} {
  switch (state) {
    case 'running':
      return { label: '暂停', glyph: 'pause', disabled: false };
    case 'paused':
      return { label: '继续', glyph: 'play', disabled: false };
    case 'stopping':
      return { label: '结束中', glyph: 'stop', disabled: true };
    case 'idle':
    case 'finished':
      return { label: '开始', glyph: 'play', disabled: false };
  }
}

export function isMiniStopDisabled(state: TimerSnapshot['state']): boolean {
  return state === 'idle' || state === 'finished' || state === 'stopping';
}

export async function triggerMiniToggle(
  state: TimerSnapshot['state'],
  timer: MiniTimerControls,
): Promise<TimerSnapshot | null> {
  if (state === 'stopping') return null;
  if (state === 'finished') await timer.reset();
  return timer.toggle();
}

export async function triggerMiniStop(
  state: TimerSnapshot['state'],
  timer: MiniTimerControls,
): Promise<TimerSnapshot | null> {
  if (state === 'stopping') return null;
  return timer.stop();
}

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
  [...FONT_PROFILES, 'misans', 'plex', 'geist', 'manrope', 'sora'].forEach((profile) =>
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
    if (snapshot.state === 'paused' && !reduceMotion) {
      let frame = 0;
      let lastFrame = 0;
      const draw = (timestamp: number) => {
        if (timestamp - lastFrame >= 32) {
          lastFrame = timestamp;
          setNow(Date.now());
        }
        frame = window.requestAnimationFrame(draw);
      };
      frame = window.requestAnimationFrame(draw);
      return () => window.cancelAnimationFrame(frame);
    }
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [reduceMotion, snapshot?.state, snapshot?.lastTick, snapshot?.currentPauseStartedAt]);

  const state = snapshot?.state ?? 'idle';
  const meta = STATE_META[state];
  const primaryAction = resolveMiniPrimaryAction(state);
  const nowMs = Date.now();
  const taskTitleRef = useRef<HTMLSpanElement>(null);
  // 任务名显示策略：装得下时单行完整；否则自动往返，reduced-motion 下改为可键盘滚动。
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
    const container = el.parentElement;
    if (!container) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      setTaskDisplay(
        resolveMiniTaskDisplayMode(el.scrollWidth, container.clientWidth, !!reduceMotion),
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    void document.fonts.ready.then(measure);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [currentTaskTitle, collapsed, reduceMotion, settings?.fontProfile]);
  const isRunning = state === 'running';
  const isPaused = state === 'paused';
  const primaryMs = isPaused ? currentPauseMs : currentFocusMs;
  const primaryButtonClass = isRunning
    ? 'mini-action-hold'
    : isPaused
      ? 'mini-action-resume'
      : 'mini-action-focus';
  const displayPrimaryMs =
    state === 'finished' || state === 'stopping'
      ? cumulativeActiveMs
      : state === 'idle'
        ? 0
        : primaryMs;
  const compactTime = useMemo(() => formatDurationPadded(displayPrimaryMs), [displayPrimaryMs]);
  // 进入小时档（"H:MM:SS"）后数字串变长，两态都换用紧凑字号防止 184px 溢出
  const isLongTime = compactTime.length > 5;
  // 消逝轨不是“专注率进度条”，只表达当前这一分钟已经流走了多少秒。
  const minuteProgress = Math.max(0, Math.min(100, ((displayPrimaryMs / 1000) % 60) * (100 / 60)));

  const handleToggle = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      if (state === 'stopping') return;
      const next = await triggerMiniToggle(state, window.focuslink.timer);
      if (next) setSnapshot(next);
    },
    [state],
  );

  const handleStop = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      if (state === 'stopping') return;
      const next = await triggerMiniStop(state, window.focuslink.timer);
      if (next) setSnapshot(next);
    },
    [state],
  );

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
      <span className="mini-dock-cue" aria-hidden="true" />

      <AnimatePresence mode="sync" initial={false}>
        {collapsed ? (
          <motion.section
            key="collapsed"
            className="mini-collapsed-content"
            data-testid="mini-collapsed-content"
            initial={reduceMotion ? false : { opacity: 0, y: 1 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : panelMotion}
          >
            <MiniSecondRail
              progress={minuteProgress}
              second={Math.floor((displayPrimaryMs / 1000) % 60)}
              paused={isPaused}
              elapsedMs={displayPrimaryMs}
              reducedMotion={Boolean(reduceMotion)}
              compact
            />
            <div className="mini-collapsed-current">
              <span className="mini-collapsed-state">
                <span className={`mini-state-dot ${meta.dotClass}`} aria-hidden="true" />
                <span className={`mini-collapsed-label ${meta.textClass}`}>{meta.stripLabel}</span>
              </span>
              <div
                className={`mini-display-time mini-collapsed-time ${isLongTime ? 'mini-time-long' : ''}`}
                data-testid="mini-current-time"
              >
                {compactTime}
              </div>
            </div>
            <MiniIconButton label="展开" testId="mini-expand" onClick={handleExpand}>
              <FocusGlyph glyph="expand" size={12} />
            </MiniIconButton>
          </motion.section>
        ) : (
          <motion.section
            key="expanded"
            className="mini-expanded-content"
            data-testid="mini-expanded-content"
            initial={reduceMotion ? false : { opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : 1 }}
            transition={reduceMotion ? { duration: 0 } : panelMotion}
          >
            <header className="mini-expanded-header">
              <MiniStateBadge state={state} />
              <div
                className={`mini-task-block ${
                  taskDisplay === 'single'
                    ? ''
                    : taskDisplay === 'scroll'
                      ? 'is-scroll'
                      : 'is-marquee'
                }`}
                tabIndex={taskDisplay === 'scroll' ? 0 : undefined}
                aria-label={`当前任务：${currentTaskTitle}`}
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
              <div className="mini-header-actions">
                <MiniIconButton label="打开主窗口" testId="mini-open-main" onClick={handleOpenMain}>
                  <FocusGlyph glyph="main-window" size={12} />
                </MiniIconButton>
                <MiniIconButton label="收起" testId="mini-collapse" onClick={handleCollapse}>
                  <FocusGlyph glyph="collapse" size={12} />
                </MiniIconButton>
              </div>
            </header>

            <div className="mini-expanded-body">
              <div className="mini-focus-core">
                <span className="mini-current-label">{isPaused ? '本段暂停' : '本段专注'}</span>
                <div
                  className={`mini-display-time mini-expanded-time ${isLongTime ? 'mini-time-long' : ''}`}
                  data-testid="mini-current-time"
                >
                  {compactTime}
                </div>
                <MiniSecondRail
                  progress={minuteProgress}
                  second={Math.floor((displayPrimaryMs / 1000) % 60)}
                  paused={isPaused}
                  elapsedMs={displayPrimaryMs}
                  reducedMotion={Boolean(reduceMotion)}
                />
              </div>

              <div className="mini-side-console">
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
                <footer className="mini-expanded-footer">
                  <div className="mini-action-dock">
                    <motion.button
                      className={`mini-primary-button ${primaryButtonClass} no-drag`}
                      data-testid="mini-primary-action"
                      onClick={handleToggle}
                      disabled={primaryAction.disabled}
                      aria-busy={state === 'stopping'}
                      whileTap={{ scale: 0.98 }}
                      transition={{ duration: 0.12 }}
                    >
                      <FocusGlyph glyph={primaryAction.glyph} size={12} />
                      {primaryAction.label}
                    </motion.button>
                    <motion.button
                      className="mini-secondary-button no-drag"
                      data-testid="mini-stop"
                      onClick={handleStop}
                      disabled={isMiniStopDisabled(state)}
                      whileTap={{ scale: 0.98 }}
                      transition={{ duration: 0.12 }}
                    >
                      <FocusGlyph glyph="stop" size={12} />
                      结束
                    </motion.button>
                  </div>
                </footer>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function MiniSecondRail({
  progress,
  second,
  paused,
  elapsedMs,
  reducedMotion,
  compact = false,
}: {
  progress: number;
  second: number;
  paused: boolean;
  elapsedMs: number;
  reducedMotion: boolean;
  compact?: boolean;
}) {
  return (
    <span
      className={`mini-second-rail ${compact ? 'mini-edge-progress' : 'mini-expanded-progress'} ${paused ? 'is-paused' : 'is-focus'} no-drag`}
      role="progressbar"
      aria-label="当前分钟时间消逝"
      aria-valuemin={0}
      aria-valuemax={60}
      aria-valuenow={second}
      aria-valuetext={`当前分钟已过去 ${second} 秒`}
      style={{ '--mini-progress': `${progress}%` } as CSSProperties}
    >
      <span className="mini-second-rail-fill mini-edge-progress-fill" />
      <span className="mini-second-front" aria-hidden="true" />
      {paused && (
        <MiniDecayParticles
          elapsedMs={elapsedMs}
          fromEdge={progress < 12}
          reducedMotion={reducedMotion}
        />
      )}
    </span>
  );
}

function MiniDecayParticles({
  elapsedMs,
  fromEdge,
  reducedMotion,
}: {
  elapsedMs: number;
  fromEdge: boolean;
  reducedMotion: boolean;
}) {
  const particles = pauseDissolveParticles(elapsedMs, 42, reducedMotion);
  const pulse = (elapsedMs % 1000) / 1000;
  const echoPulse = pulse < 0.46 ? 0 : (pulse - 0.46) / 0.54;
  return (
    <span
      className={`mini-decay-particles ${fromEdge ? 'from-edge' : ''}`}
      aria-hidden="true"
      data-dissolve-layers="shard dust spark"
      style={
        {
          '--dissolve-halo-alpha': 0.52 + (1 - pulse) * 0.34,
          '--dissolve-halo-scale': 0.86 + pulse * 0.28,
          '--dissolve-wave-alpha': (1 - pulse) * 0.5,
          '--dissolve-wave-scale': 0.75 + pulse * 1.65,
          '--dissolve-echo-alpha': echoPulse * (1 - echoPulse) * 1.15,
          '--dissolve-echo-scale': 0.72 + echoPulse * 1.2,
        } as CSSProperties
      }
    >
      <span className="mini-dissolve-halo" />
      <span className="mini-dissolve-wave wave-primary" />
      <span className="mini-dissolve-wave wave-echo" />
      {particles.map((particle, index) => (
        <i
          key={particle.id}
          className={`particle-${particle.kind}`}
          style={
            {
              '--particle-index': index,
              '--particle-size': `${particle.size}px`,
              '--particle-length': `${Math.max(2, particle.size * 4.4)}px`,
              '--particle-origin-x': `${fromEdge ? 0 : -particle.originOffsetX}px`,
              '--particle-origin-y': `${particle.originRatioY * 100}%`,
              '--particle-x': `${fromEdge ? Math.abs(particle.travelX) : particle.travelX}px`,
              '--particle-y': `${particle.travelY}px`,
              '--particle-rotation': `${particle.rotation}rad`,
              '--particle-alpha': particle.alpha,
            } as CSSProperties
          }
        />
      ))}
    </span>
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
