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

// 统一动效语言：入场/显现 cubic-bezier(.16,1,.3,1)，常规 240ms。
const panelMotion = {
  duration: 0.24,
  ease: [0.16, 1, 0.3, 1] as const,
};

// reduced-motion 降级：仅透明度过渡，无位移。
const reducedFadeMotion = { duration: 0.16 };

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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? reducedFadeMotion : panelMotion}
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? reducedFadeMotion : panelMotion}
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
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.14 }}
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
        <MiniFuseCanvas elapsedMs={elapsedMs} reducedMotion={reducedMotion} compact={compact} />
      )}
    </span>
  );
}

function MiniFuseCanvas({
  elapsedMs,
  reducedMotion,
  compact,
}: {
  elapsedMs: number;
  reducedMotion: boolean;
  compact: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const lastDrawRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const css = getComputedStyle(document.documentElement);
      const raw = (name: string) => css.getPropertyValue(name).trim();
      const rgb = (name: string) => raw(name).split(/\s+/).slice(0, 3).join(',');
      const pauseColor = rgb('--app-pause');
      const inkColor = rgb('--app-ink');
      const fuseY = height * 0.68;
      const sourceWidth = Math.min(width * 0.55, Math.max(18, height * 3));
      const headX = (width * (elapsedMs % 60000)) / 60000;
      const densityScale = compact ? 0.35 : 0.5;

      // 暗芯引线。
      ctx.strokeStyle = `rgba(${inkColor},0.28)`;
      ctx.lineWidth = compact ? 1.6 : 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(Math.max(0, headX - sourceWidth), fuseY);
      ctx.lineTo(headX, fuseY);
      ctx.stroke();

      const char = ctx.createLinearGradient(Math.max(0, headX - sourceWidth), 0, headX, 0);
      char.addColorStop(0, `rgba(${pauseColor},0.18)`);
      char.addColorStop(0.6, `rgba(${pauseColor},0.42)`);
      char.addColorStop(1, `rgba(${pauseColor},0.95)`);
      ctx.strokeStyle = char;
      ctx.lineWidth = compact ? 0.9 : 1.2;
      ctx.beginPath();
      ctx.moveTo(Math.max(0, headX - sourceWidth), fuseY);
      ctx.lineTo(headX, fuseY);
      ctx.stroke();

      // 燃烧头。
      const glowRadius = compact ? 5 : 7;
      const headGlow = ctx.createRadialGradient(headX, fuseY, 0, headX, fuseY, glowRadius);
      headGlow.addColorStop(0, 'rgba(255,255,255,0.9)');
      headGlow.addColorStop(0.25, `rgba(${pauseColor},0.55)`);
      headGlow.addColorStop(1, `rgba(${pauseColor},0)`);
      ctx.fillStyle = headGlow;
      ctx.fillRect(headX - glowRadius, fuseY - glowRadius, glowRadius * 2, glowRadius * 2);

      ctx.fillStyle = `rgba(255,255,255,0.96)`;
      ctx.beginPath();
      ctx.arc(headX, fuseY, compact ? 1 : 1.4, 0, Math.PI * 2);
      ctx.fill();

      if (reducedMotion) return;

      const particles = pauseDissolveParticles(elapsedMs, sourceWidth, false, densityScale);
      for (const particle of particles) {
        if (particle.alpha <= 0.01) continue;
        const originX = headX - particle.originOffsetX;
        const originY = fuseY + (particle.originRatioY - 0.68) * height;
        const x = originX + particle.travelX * 0.55;
        const y = originY + particle.travelY * 0.55;
        const size = particle.size * (compact ? 0.55 : 0.75);
        const hot = particle.temperature;
        const alpha = particle.alpha;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(particle.rotation);
        ctx.globalCompositeOperation = particle.kind === 'spark' ? 'lighter' : 'source-over';

        const r = Math.min(255, 210 + hot * 45);
        const g = Math.min(255, 60 + hot * 120);
        const b = Math.min(255, 40 + hot * 60);
        const fill = `rgba(${r},${g},${b},${alpha})`;
        ctx.fillStyle = fill;
        ctx.shadowColor = fill;
        ctx.shadowBlur = particle.kind === 'spark' ? 4 : particle.kind === 'dust' ? 1.2 : 0.6;

        if (particle.kind === 'shard') {
          ctx.beginPath();
          ctx.moveTo(-size * 0.65, -size * 0.3);
          ctx.lineTo(size * 0.55, -size * 0.5);
          ctx.lineTo(size * 0.4, size * 0.6);
          ctx.lineTo(-size * 0.35, size * 0.4);
          ctx.closePath();
          ctx.fill();
        } else if (particle.kind === 'spark') {
          const sparkLen = size * (1.1 + hot * 0.7);
          ctx.lineWidth = Math.max(0.5, size * 0.4);
          ctx.strokeStyle = `rgba(255,${180 + hot * 55},${120 + hot * 80},${alpha})`;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-sparkLen * 0.5, 0);
          ctx.lineTo(sparkLen * 0.5, 0);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    };

    const schedule = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame((timestamp) => {
        rafRef.current = 0;
        if (timestamp - lastDrawRef.current < 32) {
          schedule();
          return;
        }
        lastDrawRef.current = timestamp;
        draw();
      });
    };

    draw();
    if (!reducedMotion) schedule();

    const resizeObserver = new ResizeObserver(() => {
      draw();
      if (!reducedMotion) schedule();
    });
    resizeObserver.observe(canvas);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      resizeObserver.disconnect();
    };
  }, [elapsedMs, reducedMotion, compact]);

  return <canvas ref={canvasRef} className="mini-fuse-canvas" aria-hidden="true" />;
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
