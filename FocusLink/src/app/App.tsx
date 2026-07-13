import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, MotionConfig, motion, useIsPresent } from 'framer-motion';
import { useStore } from './store';
import { TimerPanel } from '../features/focus/TimerPanel';
import { SegmentTimeline } from '../features/focus/SegmentTimeline';
import { HistoryPanel } from '../features/history/HistoryPanel';
import { SettingsPanel } from '../features/settings/SettingsPanel';
import { TaskWorkspace } from '../features/tasks/TaskWorkspace';
import { Toast } from '../ui/Toast';
import { Icon } from '../ui/Icon';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import type { AppSettings } from '@shared/types';

type View = 'timer' | 'tasks' | 'history' | 'settings';

const PAGE_TRANSITION = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1] as const,
};
const PAGE_VARIANTS = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
  },
  exit: { opacity: 0 },
};

const VIEW_ORDER: Record<View, number> = {
  timer: 0,
  tasks: 1,
  history: 2,
  settings: 3,
};

const AMBIENT_PARTICLES = [
  { x: '7%', y: '18%', size: 3, delay: -1.2, duration: 13, drift: 18 },
  { x: '14%', y: '72%', size: 2, delay: -7.8, duration: 16, drift: 12 },
  { x: '23%', y: '38%', size: 4, delay: -3.4, duration: 18, drift: 20 },
  { x: '31%', y: '84%', size: 2, delay: -10.2, duration: 14, drift: 14 },
  { x: '39%', y: '12%', size: 2, delay: -5.1, duration: 17, drift: 16 },
  { x: '48%', y: '64%', size: 3, delay: -12.4, duration: 19, drift: 21 },
  { x: '57%', y: '28%', size: 2, delay: -4.6, duration: 15, drift: 13 },
  { x: '66%', y: '78%', size: 4, delay: -9.5, duration: 20, drift: 22 },
  { x: '74%', y: '17%', size: 2, delay: -2.7, duration: 16, drift: 15 },
  { x: '82%', y: '54%', size: 3, delay: -11.6, duration: 18, drift: 19 },
  { x: '91%', y: '31%', size: 2, delay: -6.3, duration: 14, drift: 12 },
  { x: '95%', y: '82%', size: 3, delay: -14.1, duration: 21, drift: 18 },
] as const;

export default function App() {
  // Subscribe to stable slices instead of the entire store. A running timer publishes a fresh
  // snapshot every second; selecting the whole store made every route (including history) rebuild
  // even when only elapsed milliseconds changed.
  const settings = useStore((state) => state.settings);
  const view = useStore((state) => state.view);
  const timerState = useStore((state) => state.snapshot?.state ?? 'idle');
  const segmentCount = useStore((state) => state.snapshot?.segments.length ?? 0);
  const pauseEventCount = useStore((state) => state.snapshot?.pauseEvents.length ?? 0);
  const setView = useStore((state) => state.setView);
  const setSnapshot = useStore((state) => state.setSnapshot);
  const setSettings = useStore((state) => state.setSettings);
  const setSyncQueue = useStore((state) => state.setSyncQueue);
  const addToast = useStore((state) => state.addToast);

  const [bootError, setBootError] = useState<string | null>(null);
  const previousViewRef = useRef<View>(view);
  const navigationDirection =
    Math.sign(VIEW_ORDER[view] - VIEW_ORDER[previousViewRef.current]) || 1;

  useEffect(() => {
    previousViewRef.current = view;
  }, [view]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    (async () => {
      try {
        if (!window.focuslink) {
          throw new Error('FocusLink 桌面接口未就绪');
        }
        // 先注册事件。任务来源或账号状态读取失败时，核心计时仍必须继续更新。
        unsubs.push(window.focuslink.on('tick', (snap) => setSnapshot(snap as any)));
        unsubs.push(window.focuslink.on('timer:state-changed', (snap) => setSnapshot(snap as any)));
        unsubs.push(
          window.focuslink.on('navigate', (target) => {
            if (
              target === 'settings' ||
              target === 'history' ||
              target === 'timer' ||
              target === 'tasks'
            ) {
              setView(target as View);
            }
          }),
        );
        unsubs.push(
          window.focuslink.on('toast:show', (t) => {
            const toast = t as { message: string; type: 'success' | 'error' | 'info'; id: string };
            addToast(toast.message, toast.type);
          }),
        );
        unsubs.push(
          window.focuslink.on('settings:changed', (value) => {
            const nextSettings = value as AppSettings;
            setSettings(nextSettings);
            applyTheme(nextSettings);
          }),
        );
        unsubs.push(
          window.focuslink.on('hotkey:registered', (info) => {
            const i = info as { key: string; success: boolean; error?: string };
            if (!i.success) {
              addToast(`快捷键 ${i.key} 注册失败：${i.error ?? '可能冲突'}`, 'error');
            }
          }),
        );

        const [settingsResult, snapshotResult, queueResult] = await Promise.allSettled([
          window.focuslink.settings.get(),
          window.focuslink.timer.getSnapshot(),
          window.focuslink.sync.list(),
        ]);

        const coreErrors: string[] = [];
        if (settingsResult.status === 'fulfilled') {
          const nextSettings = settingsResult.value as AppSettings;
          setSettings(nextSettings);
          applyTheme(nextSettings);
        } else {
          coreErrors.push(`设置：${toErrorMessage(settingsResult.reason)}`);
        }
        if (snapshotResult.status === 'fulfilled') {
          setSnapshot(snapshotResult.value);
        } else {
          coreErrors.push(`计时器：${toErrorMessage(snapshotResult.reason)}`);
        }

        if (queueResult.status === 'fulfilled') {
          setSyncQueue(queueResult.value);
        }

        setBootError(coreErrors.length > 0 ? coreErrors.join('；') : null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setBootError(message);
        addToast(`启动加载失败：${message}`, 'error');
      }
    })();

    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (settings) applyTheme(settings);
  }, [settings]);

  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <div
          className={`app-shell view-${view} state-${timerState} flex h-screen w-screen flex-col overflow-hidden text-fg antialiased`}
        >
          <AmbientField />
          <header className="global-header relative z-40 shrink-0">
            <div className="global-header-inner mx-auto flex h-full w-full max-w-[1440px] items-center">
              <button
                type="button"
                className="global-brand flex items-center gap-2"
                onClick={() => setView('timer')}
                aria-label="返回专注"
              >
                <BrandMark state={timerState} />
                <span className="brand-wordmark font-display text-[15px] font-semibold tracking-[-0.035em] text-fg">
                  <span>Focus</span>
                  <span>Link</span>
                </span>
              </button>

              <nav className="global-nav" aria-label="主导航">
                <TopNavBtn
                  active={view === 'timer'}
                  onClick={() => setView('timer')}
                  icon={<Icon.Target size="xs" />}
                  label="专注"
                />
                <TopNavBtn
                  active={view === 'tasks'}
                  onClick={() => setView('tasks')}
                  icon={<Icon.ListChecks size="xs" />}
                  label="任务"
                />
                <TopNavBtn
                  active={view === 'history'}
                  onClick={() => setView('history')}
                  icon={<Icon.BarChart size="xs" />}
                  label="统计"
                />
                <TopNavBtn
                  active={view === 'settings'}
                  onClick={() => setView('settings')}
                  icon={<Icon.Settings size="xs" />}
                  label="设置"
                />
              </nav>

              <div className="ml-auto flex items-center gap-2">
                {view !== 'timer' && (
                  <span className={`header-state state-${timerState}`}>
                    <i />
                    {timerState === 'running'
                      ? '专注中'
                      : timerState === 'paused'
                        ? '已暂停'
                        : '就绪'}
                  </span>
                )}
              </div>
            </div>
          </header>

          <main className="relative z-10 min-h-0 flex-1 overflow-hidden">
            <AnimatePresence mode="sync" initial={false} custom={navigationDirection}>
              {view === 'timer' && (
                <ViewPage key="view-timer" direction={navigationDirection}>
                  <TimerStage
                    state={timerState}
                    showLedger={segmentCount > 0}
                    ledgerItemCount={segmentCount + pauseEventCount}
                  />
                </ViewPage>
              )}
              {view === 'history' && (
                <ViewPage key="view-history" direction={navigationDirection}>
                  <HistoryPanel />
                </ViewPage>
              )}
              {view === 'tasks' && (
                <ViewPage key="view-tasks" direction={navigationDirection}>
                  <TaskWorkspace />
                </ViewPage>
              )}
              {view === 'settings' && (
                <ViewPage key="view-settings" direction={navigationDirection}>
                  <SettingsPanel />
                </ViewPage>
              )}
            </AnimatePresence>
          </main>

          {bootError && (
            <BootErrorNotice message={bootError} onRetry={() => window.location.reload()} />
          )}
          <Toast />
        </div>
      </MotionConfig>
    </ErrorBoundary>
  );
}

function ViewPage({ children, direction }: { children: React.ReactNode; direction: number }) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      variants={PAGE_VARIANTS}
      custom={direction}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={PAGE_TRANSITION}
      className="absolute inset-0"
      // AnimatePresence(mode="sync") retains the previous route during its fade. useIsPresent flips
      // immediately, so an exiting full-screen layer can never intercept the next route's clicks.
      style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
      aria-hidden={!isPresent}
    >
      {children}
    </motion.div>
  );
}

function BootErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="absolute bottom-4 left-[68px] z-50 max-w-[420px] rounded-lg border border-danger/25 bg-bg-card/95 p-3 text-fg shadow-lg">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-danger/10 text-danger">
          <Icon.AlertCircle size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-fg">启动数据加载失败</p>
          <p className="mt-0.5 break-words text-[11px] leading-relaxed text-fg-subtle">{message}</p>
        </div>
        <button
          className="btn-outline motion-press !min-h-[28px] !px-2 !py-1 text-[11px]"
          onClick={onRetry}
        >
          <Icon.Refresh size="xs" />
          重载
        </button>
      </div>
    </div>
  );
}
function TimerStage({
  state,
  showLedger,
  ledgerItemCount,
}: {
  state: string;
  showLedger: boolean;
  ledgerItemCount: number;
}) {
  const compactLedger = showLedger && ledgerItemCount <= 3;
  return (
    <div className="relative flex h-full w-full">
      <div className="min-w-0 flex-1 overflow-hidden px-5 py-4 max-[900px]:overflow-y-auto">
        <motion.div
          layout
          className={`session-workspace state-${state} ${showLedger ? 'with-ledger' : 'solo'} ${compactLedger ? 'compact-ledger' : ''} ledger-items-${Math.min(ledgerItemCount, 4)} mx-auto grid h-full max-w-[1260px] gap-4 max-[900px]:h-auto max-[900px]:grid-cols-1`}
          transition={{ layout: { type: 'spring', stiffness: 310, damping: 34, mass: 0.82 } }}
        >
          <motion.section
            layout
            className="focus-workspace-panel flex min-h-0 items-stretch justify-center overflow-hidden px-10 py-8 max-[1100px]:px-7 max-[900px]:min-h-[560px]"
            transition={{ layout: { type: 'spring', stiffness: 310, damping: 34, mass: 0.82 } }}
          >
            <TimerPanel />
          </motion.section>
          <AnimatePresence initial={false} mode="popLayout">
            {showLedger && (
              <motion.section
                layout
                className="session-ledger-pane min-h-0 overflow-hidden max-[900px]:min-h-[360px]"
                initial={{ opacity: 0, x: 14, scale: 0.985 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 10, scale: 0.99 }}
                transition={{
                  layout: { type: 'spring', stiffness: 310, damping: 34, mass: 0.82 },
                  opacity: { duration: 0.2 },
                  x: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
                }}
              >
                <SegmentTimeline />
              </motion.section>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

function TopNavBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`global-nav-button motion-press relative flex items-center gap-2 px-3 ${active ? 'active' : ''}`}
      title={label}
      aria-label={label}
    >
      {active && <span className="global-nav-active-indicator" />}
      <span className="relative z-10 inline-flex items-center">{icon}</span>
      <span className="relative z-10 text-[13.5px] font-semibold">{label}</span>
    </button>
  );
}

function BrandMark({ state }: { state: string }) {
  return (
    <div
      className={`brand-mark state-${state} relative flex shrink-0 items-center justify-center`}
      title="FocusLink"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path className="brand-mark-track" d="M6.6 12a5.4 5.4 0 0 1 9.62-3.36" />
        <path className="brand-mark-progress" d="M17.4 12a5.4 5.4 0 0 1-9.62 3.36" />
        <path className="brand-mark-link" d="M9.3 12h5.4" />
        <circle className="brand-mark-node" cx="17.65" cy="6.35" r="1.35" />
      </svg>
    </div>
  );
}

function AmbientField() {
  return (
    <div className="ambient-field" aria-hidden="true">
      <span className="ambient-glow ambient-glow-primary" />
      <span className="ambient-glow ambient-glow-secondary" />
      <span className="ambient-glow ambient-glow-state" />
      <span className="ambient-contour ambient-contour-a" />
      <span className="ambient-contour ambient-contour-b" />
      <span className="ambient-light-sweep" />
      <div className="ambient-particles">
        {AMBIENT_PARTICLES.map((particle, index) => (
          <i
            key={index}
            style={
              {
                '--particle-x': particle.x,
                '--particle-y': particle.y,
                '--particle-size': `${particle.size}px`,
                '--particle-delay': `${particle.delay}s`,
                '--particle-duration': `${particle.duration}s`,
                '--particle-drift': `${particle.drift}px`,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}

function applyTheme(settings: AppSettings): void {
  const root = document.documentElement;
  root.classList.toggle('dark', settings.theme === 'dark');
  root.classList.toggle('light', settings.theme === 'light');
  const accents = ['indigo', 'violet', 'emerald', 'rose', 'amber', 'sky'];
  accents.forEach((a) => root.classList.remove(`accent-${a}`));
  if (accents.includes(settings.accentColor)) {
    root.classList.add(`accent-${settings.accentColor}`);
  } else {
    root.classList.add('accent-indigo');
  }
  root.classList.toggle('font-profile-geist', settings.fontProfile !== 'manrope');
  root.classList.toggle('font-profile-manrope', settings.fontProfile === 'manrope');
}

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
