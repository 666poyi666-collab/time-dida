import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from './store/useStore';
import { TimerPanel } from './components/TimerPanel';
import { TaskPanel } from './components/TaskPanel';
import { SegmentTimeline } from './components/SegmentTimeline';
import { HistoryPanel } from './components/HistoryPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Toast } from './components/Toast';
import { Icon } from './components/Icon';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { AppSettings } from '@shared/types';

type View = 'timer' | 'history' | 'settings';

export default function App() {
  const {
    snapshot,
    settings,
    view,
    setView,
    setSnapshot,
    setSettings,
    setLocalTasks,
    setTicktickStatus,
    addToast,
  } = useStore();

  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    (async () => {
      const s = (await window.focuslink.settings.get()) as AppSettings;
      setSettings(s);
      applyTheme(s);

      const tasks = await window.focuslink.tasks.listLocal();
      setLocalTasks(tasks);

      const st = await window.focuslink.ticktick.status();
      setTicktickStatus(st.connected, st.region);

      const snap = await window.focuslink.timer.getSnapshot();
      setSnapshot(snap);

      unsubs.push(window.focuslink.on('tick', (snap) => setSnapshot(snap as any)));
      unsubs.push(window.focuslink.on('timer:state-changed', (snap) => setSnapshot(snap as any)));
      unsubs.push(
        window.focuslink.on('navigate', (target) => {
          if (target === 'settings' || target === 'history' || target === 'timer') {
            setView(target as View);
          } else if (target === 'tasks') {
            setView('timer');
            setTaskDrawerOpen(true);
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
        window.focuslink.on('hotkey:registered', (info) => {
          const i = info as { key: string; success: boolean; error?: string };
          if (!i.success) {
            addToast(`快捷键 ${i.key} 注册失败：${i.error ?? '可能冲突'}`, 'error');
          }
        }),
      );
    })();

    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (settings) applyTheme(settings);
  }, [settings]);

  const pageTransition = {
    type: 'spring' as const,
    stiffness: 380,
    damping: 32,
    mass: 0.8,
  };
  const pageVariants = {
    initial: { opacity: 0, x: 6, scale: 0.997 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: { opacity: 0, x: -3, scale: 0.997 },
  };

  const timerState = snapshot?.state ?? 'idle';
  const canvasCls =
    timerState === 'running'
      ? 'aurora-canvas aurora-canvas-focus'
      : timerState === 'paused'
        ? 'aurora-canvas aurora-canvas-pause'
        : 'aurora-canvas';

  return (
    <ErrorBoundary>
      <div className="app-shell theme-transition flex h-screen w-screen overflow-hidden text-fg antialiased">
        {/* ── 侧轨：Apex 紧凑导航 ── */}
        <aside className="side-rail relative z-20 flex w-[52px] flex-col items-center gap-0.5 py-2.5">
          <BrandMark state={timerState} />

          <div className="mt-3 flex flex-col items-center gap-0.5">
            <RailBtn
              active={view === 'timer'}
              onClick={() => setView('timer')}
              icon={<Icon.Timer size="md" />}
              label="计时"
            />
            <RailBtn
              active={view === 'history'}
              onClick={() => setView('history')}
              icon={<Icon.History size="md" />}
              label="历史"
            />
            <RailBtn
              active={view === 'settings'}
              onClick={() => setView('settings')}
              icon={<Icon.Settings size="md" />}
              label="设置"
            />
          </div>

          <div className="mt-1.5 flex flex-col items-center gap-0.5">
            {view === 'timer' && (
              <RailBtn
                active={taskDrawerOpen}
                onClick={() => setTaskDrawerOpen((v) => !v)}
                icon={<Icon.ListTodo size="md" />}
                label="任务"
                accent
              />
            )}
          </div>

          <div className="mt-auto flex flex-col items-center gap-0.5">
            <RailBtn
              onClick={() => window.focuslink.window.minimizeToTray()}
              icon={<Icon.Minus size="sm" />}
              label="最小化"
              ghost
            />
            <RailBtn
              onClick={() => window.focuslink.window.minimizeToTray()}
              icon={<Icon.X size="sm" />}
              label="关闭"
              ghost
              danger
            />
          </div>
        </aside>

        {/* ── 主舞台 ── */}
        <main className={`perf-contain-content relative flex-1 overflow-hidden ${canvasCls}`}>
          <AnimatePresence mode="wait">
            {view === 'timer' && (
              <motion.div
                key="view-timer"
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={pageTransition}
                className="absolute inset-0"
              >
                <TimerStage
                  taskDrawerOpen={taskDrawerOpen}
                  onToggleDrawer={() => setTaskDrawerOpen((v) => !v)}
                />
              </motion.div>
            )}
            {view === 'history' && (
              <motion.div
                key="view-history"
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={pageTransition}
                className="absolute inset-0"
              >
                <HistoryPanel />
              </motion.div>
            )}
            {view === 'settings' && (
              <motion.div
                key="view-settings"
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={pageTransition}
                className="absolute inset-0"
              >
                <SettingsPanel />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <Toast />
      </div>
    </ErrorBoundary>
  );
}

function TimerStage({
  taskDrawerOpen,
  onToggleDrawer,
}: {
  taskDrawerOpen: boolean;
  onToggleDrawer: () => void;
}) {
  return (
    <div className="flex h-full w-full">
      {/* 左侧：计时器舞台 */}
      <div className={`flex min-w-0 flex-col overflow-y-auto transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-silk)] ${taskDrawerOpen ? 'flex-1' : 'flex-1'}`}>
        <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-6 py-5">
          <TimerPanel />
        </div>
        <div className="shrink-0 px-6 pb-4">
          <SegmentTimeline />
        </div>
      </div>

      {/* 右侧：任务面板 — 宽屏 split view */}
      <AnimatePresence>
        {taskDrawerOpen && (
          <motion.div
            key="task-split-panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'min(400px, 38vw)', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36, mass: 0.8 }}
            className="motion-gpu relative z-30 flex h-full flex-col overflow-hidden border-l border-border/40"
            style={{
              background: 'rgb(var(--app-surface) / 0.6)',
              backdropFilter: 'blur(24px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
            }}
          >
            {/* 面板头部 */}
            <div className="flex items-center justify-between border-b border-border/30 px-4 py-2.5" style={{ boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.04)' }}>
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10 text-accent">
                  <Icon.ListTodo size="xs" />
                </span>
                <span className="font-display text-[13px] font-semibold tracking-tight">任务</span>
              </div>
              <button
                className="window-icon-button !h-7 !w-7 motion-press"
                onClick={onToggleDrawer}
                title="关闭任务面板"
              >
                <Icon.PanelClose size="sm" />
              </button>
            </div>
            {/* 任务内容区 */}
            <div className="min-h-0 flex-1 overflow-hidden p-2.5">
              <TaskPanel inDrawer />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RailBtn({
  active,
  onClick,
  icon,
  label,
  accent,
  ghost,
  danger,
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  accent?: boolean;
  ghost?: boolean;
  danger?: boolean;
}) {
  const base = 'rail-btn motion-focus-ring relative group';
  const stateCls = active
    ? accent
      ? 'bg-accent/12 text-accent'
      : 'nav-active'
    : ghost
      ? 'text-fg-subtle'
      : 'text-fg-muted';
  const dangerHover = danger ? 'hover:!bg-danger/10 hover:!text-danger' : '';
  const activeStyle = active && !accent && !ghost
    ? { boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.06), 0 1px 2px rgb(0 0 0 / 0.06)' }
    : active && accent
      ? { boxShadow: 'inset 0 0 0 1px rgb(var(--accent) / 0.2), inset 0 1px 0 rgb(255 255 255 / 0.07)' }
      : undefined;
  return (
    <button
      onClick={onClick}
      className={`${base} ${stateCls} ${dangerHover}`}
      style={activeStyle}
      title={label}
      aria-label={label}
    >
      {icon}
      {/* Apex Tooltip: 6px圆角 + backdrop-blur */}
      <span className="pointer-events-none absolute left-[44px] z-50 whitespace-nowrap tooltip-box opacity-0 transition-[opacity,transform] duration-[var(--motion-fast)] ease-[var(--ease-spring)] translate-x-[-3px] group-hover:opacity-100 group-hover:translate-x-0">
        {label}
      </span>
      {/* Linear风格激活指示条 */}
      {active && (
        <motion.span
          layoutId="rail-active-indicator"
          className="absolute -left-[3px] top-1/2 h-[18px] w-[2.5px] -translate-y-1/2 rounded-full bg-accent"
          style={{ boxShadow: '0 0 6px rgb(var(--accent) / 0.45)' }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        />
      )}
    </button>
  );
}

function BrandMark({ state }: { state: string }) {
  const running = state === 'running';
  const paused = state === 'paused';
  const statusColor = running ? 'var(--app-success)' : paused ? 'var(--app-warning)' : 'var(--app-accent)';
  return (
    <div
      className={`brand-mark relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl transition-all duration-[var(--motion-normal)] ease-[var(--ease-in-out)] ${
        running ? 'border-success/20' : paused ? 'border-warning/20' : ''
      }`}
      style={
        running
          ? { boxShadow: '0 0 0 1px rgb(var(--success) / 0.06), inset 0 1px 0 rgb(255 255 255 / 0.07)' }
          : paused
            ? { boxShadow: '0 0 0 1px rgb(var(--warning) / 0.06), inset 0 1px 0 rgb(255 255 255 / 0.07)' }
            : undefined
      }
      title="FocusLink"
    >
      <span
        className="brand-mark-ring"
        style={{
          borderColor: running
            ? 'rgb(var(--success) / 0.45)'
            : paused
              ? 'rgb(var(--warning) / 0.4)'
              : 'rgb(var(--accent) / 0.5)',
        }}
      />
      {running && <span className="brand-mark-progress" />}
      <span className="brand-mark-core" />
      <span className="brand-mark-node" />
      <span
        className={`brand-mark-status absolute bottom-[5px] rounded-full transition-all duration-[var(--motion-normal)] ease-[var(--ease-in-out)] ${
          running || paused ? 'w-[12px] opacity-100' : 'opacity-40'
        }`}
        style={{ background: statusColor }}
      />
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
}
