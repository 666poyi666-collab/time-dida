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

  // 任务抽屉：v0.3 核心变化——任务不再常驻右栏，改为召唤式滑出抽屉
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);

  // 初始化
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    (async () => {
      // 加载设置
      const s = (await window.focuslink.settings.get()) as AppSettings;
      setSettings(s);
      applyTheme(s);

      // 加载本地任务
      const tasks = await window.focuslink.tasks.listLocal();
      setLocalTasks(tasks);

      // TickTick 状态
      const st = await window.focuslink.ticktick.status();
      setTicktickStatus(st.connected, st.region);

      // 初始快照
      const snap = await window.focuslink.timer.getSnapshot();
      setSnapshot(snap);

      // 订阅 timer 事件
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

  // 主题随设置变化
  useEffect(() => {
    if (settings) applyTheme(settings);
  }, [settings]);

  const pageTransition = { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const };

  const timerState = snapshot?.state ?? 'idle';
  // 画布环境光：根据计时状态切换极光层
  const canvasCls =
    timerState === 'running'
      ? 'aurora-canvas aurora-canvas-focus'
      : timerState === 'paused'
        ? 'aurora-canvas aurora-canvas-pause'
        : 'aurora-canvas';

  return (
    <div className="app-shell theme-transition flex h-screen w-screen overflow-hidden text-fg antialiased">
      {/* ── 侧轨：v0.3 全新导航 ── */}
      <aside className="side-rail relative z-20 flex w-14 flex-col items-center gap-1.5 py-4">
        <BrandMark state={timerState} />

        <div className="mt-5 flex flex-col items-center gap-1.5">
          <RailBtn
            active={view === 'timer'}
            onClick={() => setView('timer')}
            icon={<Icon.Timer size="lg" />}
            label="计时"
          />
          <RailBtn
            active={view === 'history'}
            onClick={() => setView('history')}
            icon={<Icon.History size="lg" />}
            label="历史"
          />
          <RailBtn
            active={view === 'settings'}
            onClick={() => setView('settings')}
            icon={<Icon.Settings size="lg" />}
            label="设置"
          />
        </div>

        {/* 任务抽屉召唤按钮：仅在计时视图显示 */}
        <div className="mt-3 flex flex-col items-center gap-1.5">
          {view === 'timer' && (
            <RailBtn
              active={taskDrawerOpen}
              onClick={() => setTaskDrawerOpen((v) => !v)}
              icon={<Icon.ListTodo size="lg" />}
              label="任务"
              accent
            />
          )}
        </div>

        {/* 窗口控制：贴底 */}
        <div className="mt-auto flex flex-col items-center gap-1.5">
          <RailBtn
            onClick={() => window.focuslink.window.minimizeToTray()}
            icon={<Icon.Minus size="md" />}
            label="最小化"
            ghost
          />
          <RailBtn
            onClick={() => window.focuslink.window.minimizeToTray()}
            icon={<Icon.X size="md" />}
            label="关闭"
            ghost
            danger
          />
        </div>
      </aside>

      {/* ── 主舞台：极光画布 ── */}
      <main className={`perf-contain-content relative flex-1 overflow-hidden ${canvasCls}`}>
        <AnimatePresence mode="wait">
          {view === 'timer' && (
            <motion.div
              key="view-timer"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
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
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={pageTransition}
              className="absolute inset-0"
            >
              <HistoryPanel />
            </motion.div>
          )}
          {view === 'settings' && (
            <motion.div
              key="view-settings"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
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
  );
}

// ── 计时舞台：中央计时 + 底部时间线 + 任务抽屉 ──────────────

function TimerStage({
  taskDrawerOpen,
  onToggleDrawer,
}: {
  taskDrawerOpen: boolean;
  onToggleDrawer: () => void;
}) {
  return (
    <div className="flex h-full w-full">
      {/* 中央舞台区 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-center px-6 py-6">
          <TimerPanel />
        </div>
        {/* 底部片段时间线 */}
        <div className="shrink-0 px-6 pb-5">
          <SegmentTimeline />
        </div>
      </div>

      {/* 任务抽屉：从右侧滑入 */}
      <AnimatePresence>
        {taskDrawerOpen && (
          <>
            <motion.div
              key="drawer-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onToggleDrawer}
              className="absolute inset-0 z-30 bg-black/30 backdrop-blur-[2px]"
            />
            <motion.div
              key="drawer-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 40, mass: 0.9 }}
              className="absolute bottom-0 right-0 top-0 z-40 flex w-[380px] max-w-[88vw] flex-col border-l border-border/50 bg-bg-card/95 backdrop-blur-xl"
            >
              {/* 抽屉头 */}
              <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Icon.ListTodo size="sm" tone="accent" />
                  <span className="font-display text-sm font-semibold">任务</span>
                </div>
                <button
                  className="window-icon-button"
                  onClick={onToggleDrawer}
                  title="关闭任务面板"
                >
                  <Icon.PanelClose size="sm" />
                </button>
              </div>
              {/* 抽屉内容 */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <TaskPanel inDrawer />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── 侧轨按钮 ──────────────────────────────────────────────

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
      ? 'bg-accent/14 text-accent shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.22),0_4px_14px_-6px_rgb(var(--accent)/0.4)]'
      : 'nav-active'
    : ghost
      ? 'text-fg-subtle'
      : 'text-fg-muted';
  const dangerHover = danger ? 'hover:!bg-danger/10 hover:!text-danger' : '';
  return (
    <button
      onClick={onClick}
      className={`${base} ${stateCls} ${dangerHover}`}
      title={label}
      aria-label={label}
    >
      {icon}
      {/* 悬停标签 */}
      <span className="pointer-events-none absolute left-[52px] z-50 whitespace-nowrap rounded-lg border border-border/60 bg-bg-card/95 px-2 py-1 text-[11px] font-medium text-fg opacity-0 shadow-md backdrop-blur-md transition-all duration-150 group-hover:opacity-100 group-hover:left-[56px]">
        {label}
      </span>
      {/* 激活指示条 */}
      {active && (
        <span className="absolute -left-2 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent)/0.6)]" />
      )}
    </button>
  );
}

// ── 品牌标识 ──────────────────────────────────────────────

function BrandMark({ state }: { state: string }) {
  const running = state === 'running';
  return (
    <div
      className={`brand-mark relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl transition-all duration-[var(--motion-slow)] ease-[var(--ease-in-out)] ${
        running ? 'shadow-glow' : 'shadow-soft'
      }`}
      title="FocusLink"
    >
      <span className="brand-mark-ring" />
      <span className="brand-mark-progress" />
      <span className="brand-mark-core" />
      <span className="brand-mark-node" />
      <span
        className={`brand-mark-status absolute bottom-1.5 rounded-full transition-all duration-[var(--motion-slow)] ease-[var(--ease-in-out)] ${
          running ? 'w-4 opacity-95' : 'opacity-55'
        }`}
      />
    </div>
  );
}

function applyTheme(settings: AppSettings): void {
  const root = document.documentElement;
  root.classList.toggle('dark', settings.theme === 'dark');
  root.classList.toggle('light', settings.theme === 'light');
  // 主题色
  const accents = ['indigo', 'violet', 'emerald', 'rose', 'amber', 'sky'];
  accents.forEach((a) => root.classList.remove(`accent-${a}`));
  if (accents.includes(settings.accentColor)) {
    root.classList.add(`accent-${settings.accentColor}`);
  } else {
    root.classList.add('accent-indigo');
  }
}
