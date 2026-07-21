import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion, useIsPresent } from 'framer-motion';
import '../styles/shell-motion.css';
import { useStore } from './store';
import { TimerPanel } from '../features/focus/TimerPanel';
import { HistoryPanel } from '../features/history/HistoryPanel';
import { SettingsPanel } from '../features/settings/SettingsPanel';
import { TaskWorkspace } from '../features/tasks/TaskWorkspace';
import { Toast } from '../ui/Toast';
import { Icon } from '../ui/Icon';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import type { AppSettings } from '@shared/types';
import {
  FOCUS_COLORS,
  FONT_PROFILES,
  LEGACY_TIMER_STYLES,
  TIMER_STYLES,
  resolveFocusColor,
  resolveFontProfile,
  resolveTimerStyle,
  resolveThemeAppearance,
} from '@shared/theme';

type View = 'timer' | 'tasks' | 'history' | 'settings';

const PAGE_ENTER = {
  duration: 0.36,
  ease: [0.16, 1, 0.3, 1] as const,
};
const PAGE_EXIT = {
  duration: 0.24,
  ease: [0.4, 0, 0.2, 1] as const,
};
const PAGE_VARIANTS = {
  initial: (direction: number) => ({ opacity: 0, x: direction * 14, scale: 0.996 }),
  animate: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: PAGE_ENTER,
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction * -8,
    scale: 0.998,
    transition: PAGE_EXIT,
  }),
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

  // 窗口失焦：类挂在根节点，仅用于必要的失焦表现，不触碰布局与内容可读性。
  useEffect(() => {
    const root = document.documentElement;
    const onBlur = () => root.classList.add('window-blurred');
    const onFocus = () => root.classList.remove('window-blurred');
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      root.classList.remove('window-blurred');
    };
  }, []);

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
    if (!settings) return;
    applyTheme(settings);
    if (settings.theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => applyTheme(settings);
    media.addEventListener('change', syncSystemTheme);
    return () => media.removeEventListener('change', syncSystemTheme);
  }, [settings]);

  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <div className={`app-shell view-${view} state-${timerState}`}>
          <a className="skip-link" href="#focuslink-main">
            跳到主要内容
          </a>
          <EdgeDock view={view} state={timerState} onSelect={setView} />
          <WindowControls />

          <main id="focuslink-main" className="app-stage">
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

function DockButton({
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
      className={`edge-dock-button motion-press ${active ? 'active' : ''}`}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      <span className="edge-dock-icon">{icon}</span>
      <span className="edge-dock-label">{label}</span>
    </button>
  );
}

function EdgeDock({
  view,
  state,
  onSelect,
}: {
  view: View;
  state: string;
  onSelect: (view: View) => void;
}) {
  return (
    <aside className="edge-dock">
      <button className="edge-dock-brand" onClick={() => onSelect('timer')} aria-label="FocusLink">
        <BrandMark state={state} />
        <span>
          Focus
          <b>Link</b>
        </span>
      </button>
      <nav aria-label="主导航">
        <DockButton
          active={view === 'timer'}
          onClick={() => onSelect('timer')}
          icon={<Icon.Target size="sm" />}
          label="专注"
        />
        <DockButton
          active={view === 'tasks'}
          onClick={() => onSelect('tasks')}
          icon={<Icon.ListChecks size="sm" />}
          label="任务"
        />
        <DockButton
          active={view === 'history'}
          onClick={() => onSelect('history')}
          icon={<Icon.BarChart size="sm" />}
          label="统计"
        />
        <DockButton
          active={view === 'settings'}
          onClick={() => onSelect('settings')}
          icon={<Icon.Settings size="sm" />}
          label="设置"
        />
      </nav>
      <span className={`edge-dock-state state-${state}`} aria-label={`计时状态：${state}`} />
    </aside>
  );
}

function WindowControls() {
  return (
    <div className="window-controls" aria-label="窗口控制">
      <span className="window-drag-region" />
      <button onClick={() => window.focuslink.window.minimize()} aria-label="最小化">
        <Icon.Minus size="xs" />
      </button>
      <button onClick={() => window.focuslink.window.toggleMaximize()} aria-label="最大化或还原">
        <Icon.Maximize size="xs" />
      </button>
      <button
        className="window-close"
        onClick={() => window.focuslink.window.close()}
        aria-label="关闭"
      >
        <Icon.X size="xs" />
      </button>
    </div>
  );
}

function BrandMark({ state }: { state: string }) {
  return (
    <div
      className={`brand-mark state-${state} relative flex shrink-0 items-center justify-center`}
      title="FocusLink"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path className="brand-mark-f" d="M5 20V4h12M5 11h9" />
        <path className="brand-mark-l" d="M15 9v11h5" />
        <path className="brand-mark-cross" d="M12 11h3" />
      </svg>
    </div>
  );
}

function applyTheme(settings: AppSettings): void {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effectiveTheme = resolveThemeAppearance(settings.theme, prefersDark);
  root.classList.toggle('dark', effectiveTheme === 'dark');
  root.classList.toggle('light', effectiveTheme === 'light');
  // 单一设计系统：旧的 theme-*/accent-*/font-profile-* 类全部清除，不再写入。
  ['quiet', 'dawn', 'bloom'].forEach((family) => root.classList.remove(`theme-${family}`));
  delete root.dataset.themeFamily;
  const accents = ['indigo', 'violet', 'emerald', 'rose', 'amber', 'sky'];
  accents.forEach((a) => root.classList.remove(`accent-${a}`));
  [...FONT_PROFILES, 'misans', 'plex', 'geist', 'manrope', 'sora'].forEach((profile) =>
    root.classList.remove(`font-profile-${profile}`),
  );
  root.classList.add(`font-profile-${resolveFontProfile(settings.fontProfile)}`);
  FOCUS_COLORS.forEach((color) => root.classList.remove(`focus-color-${color}`));
  root.classList.add(`focus-color-${resolveFocusColor(settings.focusColor)}`);
  [...TIMER_STYLES, ...LEGACY_TIMER_STYLES].forEach((style) =>
    root.classList.remove(`timer-style-${style}`),
  );
  root.classList.add(`timer-style-${resolveTimerStyle(settings.timerStyle)}`);
}

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
