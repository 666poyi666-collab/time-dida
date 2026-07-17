import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion, useIsPresent } from 'framer-motion';
import { useStore } from './store';
import { TimerPanel } from '../features/focus/TimerPanel';
import { HistoryPanel } from '../features/history/HistoryPanel';
import { SettingsPanel } from '../features/settings/SettingsPanel';
import { TaskWorkspace } from '../features/tasks/TaskWorkspace';
import { Toast } from '../ui/Toast';
import { Icon } from '../ui/Icon';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { FlipDigits } from '../ui/FlipDigits';
import { formatDurationPadded } from '../lib/time';
import { getMainDisplayMs } from '@shared/focus/selectors';
import type { AppSettings } from '@shared/types';

type View = 'timer' | 'tasks' | 'history' | 'settings';

const PAGE_TRANSITION = {
  duration: 0.34,
  ease: [0.16, 1, 0.3, 1] as const,
};
const PAGE_VARIANTS = {
  initial: (direction: number) => ({ opacity: 0, x: direction * 14, scale: 0.996 }),
  animate: {
    opacity: 1,
    x: 0,
    scale: 1,
  },
  exit: (direction: number) => ({ opacity: 0, x: direction * -8, scale: 0.998 }),
};

const VIEW_ORDER: Record<View, number> = {
  timer: 0,
  tasks: 1,
  history: 2,
  settings: 3,
};

export default function App() {
  // Subscribe to stable slices instead of the entire store. A running timer publishes a fresh
  // snapshot every second; selecting the whole store made every route (including history) rebuild
  // even when only elapsed milliseconds changed.
  const settings = useStore((state) => state.settings);
  const view = useStore((state) => state.view);
  const timerState = useStore((state) => state.snapshot?.state ?? 'idle');
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

  // Electron hands initial DOM focus to the first focusable element when the window is
  // shown; only reveal focus rings after the user actually navigates by keyboard.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        document.documentElement.classList.add('kb-nav');
        window.removeEventListener('keydown', onKeyDown, true);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  useEffect(() => {
    if (settings) applyTheme(settings);
  }, [settings]);

  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <div
          className={`app-shell view-${view} state-${timerState} flex h-screen w-screen flex-row overflow-hidden text-fg antialiased`}
        >
          <AmbientField />
          <aside className="global-rail relative z-40 flex h-full shrink-0 flex-col items-center">
            <button
              type="button"
              className="global-brand flex flex-col items-center gap-1.5"
              onClick={() => setView('timer')}
              aria-label="返回专注"
            >
              <BrandMark state={timerState} />
              <span className="brand-wordmark font-display font-semibold text-fg">
                <span>Focus</span>
                <span>Link</span>
              </span>
            </button>

            <nav className="global-nav" aria-label="主导航">
              <TopNavBtn
                active={view === 'timer'}
                onClick={() => setView('timer')}
                icon={<Icon.Target size="xl" />}
                label="专注"
              />
              <TopNavBtn
                active={view === 'tasks'}
                onClick={() => setView('tasks')}
                icon={<Icon.ListChecks size="xl" />}
                label="任务"
              />
              <TopNavBtn
                active={view === 'history'}
                onClick={() => setView('history')}
                icon={<Icon.BarChart size="xl" />}
                label="统计"
              />
              <TopNavBtn
                active={view === 'settings'}
                onClick={() => setView('settings')}
                icon={<Icon.Settings size="xl" />}
                label="设置"
              />
            </nav>

            <div className="mt-auto flex flex-col items-center">
              <HeaderTimerChip onOpenTimer={() => setView('timer')} />
            </div>
          </aside>

          <main className="relative z-10 min-h-0 min-w-0 flex-1 overflow-hidden">
            <AnimatePresence mode="sync" initial={false} custom={navigationDirection}>
              {view === 'timer' && (
                <ViewPage key="view-timer" direction={navigationDirection}>
                  <TimerStage state={timerState} />
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
      className="absolute inset-0 will-change-transform"
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
    <div className="absolute bottom-4 left-[88px] z-50 max-w-[420px] rounded-lg border border-danger/25 bg-bg-card/95 p-3 text-fg shadow-lg">
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
function TimerStage({ state }: { state: string }) {
  return (
    <div className="relative flex h-full w-full">
      <div className="min-w-0 flex-1 overflow-hidden max-[900px]:overflow-y-auto">
        <div
          className={`session-workspace state-${state} mx-auto h-full max-w-[1360px] max-[900px]:h-auto`}
        >
          <TimerPanel />
        </div>
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
      className={`global-nav-button motion-press relative flex flex-col items-center justify-center gap-1 ${active ? 'active' : ''}`}
      title={label}
      aria-label={label}
    >
      {active && <span className="global-nav-active-indicator" />}
      <span className="relative z-10 inline-flex items-center">{icon}</span>
      <span className="global-nav-label relative z-10">{label}</span>
    </button>
  );
}

/** 头部右侧计时状态芯片：任何页面都能看到计时状态，点击回到专注页。 */
function HeaderTimerChip({ onOpenTimer }: { onOpenTimer: () => void }) {
  const snapshot = useStore((state) => state.snapshot);
  const state = snapshot?.state ?? 'idle';
  const isActive = state === 'running' || state === 'paused';
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive, snapshot?.lastTick, snapshot?.currentPauseStartedAt]);

  const label =
    state === 'running'
      ? '专注中'
      : state === 'paused'
        ? '已暂停'
        : state === 'finished'
          ? '已结束'
          : '就绪';

  return (
    <button
      type="button"
      className={`header-state state-${state} motion-press`}
      onClick={onOpenTimer}
      title="回到专注"
      aria-label={`计时状态：${label}，点击回到专注`}
    >
      <i />
      <span>{label}</span>
      {isActive && (
        <span className="header-state-time">
          <FlipDigits value={formatDurationPadded(getMainDisplayMs(snapshot, now))} />
        </span>
      )}
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

/** 克制的环境层：两片超大柔和光斑慢速漂移 + 极淡网格；运行中才出现状态呼吸光。 */
function AmbientField() {
  return (
    <div className="ambient-field" aria-hidden="true">
      <span className="ambient-glow ambient-glow-primary" />
      <span className="ambient-glow ambient-glow-secondary" />
      <span className="ambient-glow ambient-glow-peach" />
      <span className="ambient-glow ambient-glow-state" />
      <span className="ambient-grid" />
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
