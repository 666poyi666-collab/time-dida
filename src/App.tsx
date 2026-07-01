import { useEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from './store/useStore';
import { TimerPanel } from './components/TimerPanel';
import { TaskPanel } from './components/TaskPanel';
import { SegmentTimeline } from './components/SegmentTimeline';
import { HistoryPanel } from './components/HistoryPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Toast } from './components/Toast';
import {
  Timer as TimerIcon,
  History as HistoryIcon,
  Settings as SettingsIcon,
  Minus,
  X,
  GripVertical,
  Activity,
} from 'lucide-react';
import type { AppSettings } from '@shared/types';
import {
  DEFAULT_LEFT_PANE_RATIO,
  LEFT_PANE_MAX,
  LEFT_PANE_MIN,
  PANE_DIVIDER_WIDTH,
  RIGHT_PANE_MIN,
  clampLeftPaneWidth,
  getDefaultLeftPaneWidth,
} from './lib/paneLayout';

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

  // 左右分栏宽度（px）
  const [leftWidth, setLeftWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const leftWidthRef = useRef<number | null>(null);
  const [isDividerDragging, setIsDividerDragging] = useState(false);

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
            setView(target as any);
          } else if (target === 'tasks') {
            setView('timer');
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

  // 从设置恢复分栏宽度
  useEffect(() => {
    if (settings?.layout?.leftPaneWidth && settings.layout.leftPaneWidth > 0) {
      setLeftWidth(settings.layout.leftPaneWidth);
      leftWidthRef.current = settings.layout.leftPaneWidth;
    }
  }, [settings?.layout?.leftPaneWidth]);

  useEffect(() => {
    leftWidthRef.current = leftWidth;
  }, [leftWidth]);

  // 旧设置里保存过大的左栏宽度时，保证右侧任务区仍留出最小可用空间。
  useEffect(() => {
    if (!containerRef.current || leftWidth == null || view !== 'timer') return;
    const rect = containerRef.current.getBoundingClientRect();
    const containerWidth = Math.min(rect.width, window.innerWidth);
    const clamped = clampLeftPaneWidth(containerWidth, leftWidth);
    if (clamped !== leftWidth) {
      leftWidthRef.current = clamped;
      setLeftWidth(clamped);
    }
  }, [leftWidth, view]);

  // 拖拽分割线
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setIsDividerDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const containerWidth = Math.min(rect.width, window.innerWidth);
      const clamped = clampLeftPaneWidth(containerWidth, x);
      leftWidthRef.current = clamped;
      setLeftWidth(clamped);
    };
    const onMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setIsDividerDragging(false);
        const widthToSave = leftWidthRef.current;
        // 持久化
        if (settings && widthToSave) {
          window.focuslink.settings.set({
            ...settings,
            layout: { leftPaneWidth: widthToSave },
          });
        }
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [settings]);

  // 双击恢复默认比例
  const onDoubleClick = useCallback(() => {
    if (!containerRef.current || !settings) return;
    const rect = containerRef.current.getBoundingClientRect();
    const containerWidth = Math.min(rect.width, window.innerWidth);
    const defaultLeft = getDefaultLeftPaneWidth(containerWidth);
    leftWidthRef.current = defaultLeft;
    setLeftWidth(defaultLeft);
    window.focuslink.settings.set({
      ...settings,
      layout: { leftPaneWidth: defaultLeft },
    });
  }, [settings]);

  // 计算实际使用的左栏宽度
  const effectiveLeft = leftWidth ?? null;

  return (
    <div className="flex h-screen w-screen flex-col bg-bg-base text-fg antialiased surface-grid">
      {/* 标题栏 — v0.27: 毛玻璃增强 */}
      <header
        className="motion-state-transition relative z-10 flex items-center justify-between border-b border-border/60 bg-bg-card/85 px-4 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.06),0_8px_24px_-16px_rgba(0,0,0,0.12)] backdrop-blur-2xl select-none"
        style={{ minHeight: 52 }}
      >
        <div className="flex min-w-[190px] items-center gap-2.5">
          <BrandMark state={snapshot?.state ?? 'idle'} />
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold tracking-normal">FocusLink</span>
              {snapshot && <StatePill state={snapshot.state} />}
            </div>
            <p className="text-[10px] font-medium text-fg-subtle">Session task ledger</p>
          </div>
        </div>

        {/* 导航 — v0.27: 精致分段容器 */}
        <nav className="flex items-center gap-0.5 rounded-xl border border-border/70 bg-bg-elevated/60 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-lg">
          <NavBtn
            active={view === 'timer'}
            onClick={() => setView('timer')}
            icon={<TimerIcon size={14} />}
            label="计时"
          />
          <NavBtn
            active={view === 'history'}
            onClick={() => setView('history')}
            icon={<HistoryIcon size={14} />}
            label="历史"
          />
          <NavBtn
            active={view === 'settings'}
            onClick={() => setView('settings')}
            icon={<SettingsIcon size={14} />}
            label="设置"
          />
        </nav>

        {/* 窗口控制按钮 */}
        <div className="flex min-w-[190px] items-center justify-end gap-1">
          <button
            className="motion-base flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-subtle hover:text-fg"
            onClick={() => window.focuslink.window.minimizeToTray()}
            title="最小化到托盘"
          >
            <Minus size={14} />
          </button>
          <button
            className="motion-base flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-danger/10 hover:text-danger"
            onClick={() => window.focuslink.window.minimizeToTray()}
            title="关闭（保留在托盘）"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {/* 主体 — 页面切换动画 */}
      <main className="relative flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {view === 'timer' && (
            <motion.div
              key="view-timer"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0"
            >
              <div
                ref={containerRef}
                className="flex h-full w-full min-w-0 overflow-hidden bg-bg-base/95"
              >
            {/* 左侧计时区 */}
            <div
              className="flex flex-col overflow-y-auto px-5 py-4"
              style={{
                width:
                  effectiveLeft ??
                  `min(${Math.round(DEFAULT_LEFT_PANE_RATIO * 100)}%, ${LEFT_PANE_MAX}px)`,
                maxWidth: `min(${LEFT_PANE_MAX}px, calc(100% - ${RIGHT_PANE_MIN + PANE_DIVIDER_WIDTH}px))`,
                minWidth: LEFT_PANE_MIN,
                flexShrink: 0,
                background:
                  'linear-gradient(180deg, rgb(var(--app-bg) / 0.98), rgb(var(--app-surface-2) / 0.46))',
              }}
            >
              <TimerPanel />
              <div className="mt-5">
                <SegmentTimeline />
              </div>
            </div>

            {/* 可拖拽分割线 — v0.27: 拖动时增强视觉反馈 */}
            <div
              onMouseDown={onMouseDown}
              onDoubleClick={onDoubleClick}
              className={`group motion-state-transition relative z-10 flex-shrink-0 cursor-col-resize ${isDividerDragging ? 'bg-accent/[0.08]' : 'hover:bg-bg-subtle/55'}`}
              style={{ width: PANE_DIVIDER_WIDTH }}
              title="拖动调整左右宽度，双击恢复默认"
            >
              {/* 中心指示线 */}
              <div
                className="motion-state-transition absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded-full"
                style={{
                  background: isDividerDragging
                    ? 'rgb(var(--app-accent))'
                    : 'rgb(var(--app-border))',
                  opacity: isDividerDragging ? 0.75 : 0.72,
                }}
              />
              {/* 悬停高亮层 — 拖动时扩散 */}
              <div
                className="motion-state-transition absolute inset-y-4 left-1/2 w-px -translate-x-1/2 rounded-full transition-all duration-200"
                style={{
                  background: 'rgb(var(--app-accent))',
                  boxShadow: isDividerDragging
                    ? '0 0 8px rgb(var(--app-accent) / 0.3)'
                    : '0 0 0 1px rgb(var(--app-accent) / 0.16)',
                  opacity: isDividerDragging ? 1 : 0,
                }}
              />
              {/* 拖拽手柄 */}
              <div
                className={`motion-state-transition motion-base absolute left-1/2 top-1/2 flex h-9 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-bg-card/95 shadow-soft group-hover:border-accent/40 group-hover:text-accent group-hover:opacity-100 ${isDividerDragging ? 'border-accent/55 text-accent opacity-100 shadow-glow scale-110' : 'border-border text-fg-subtle opacity-70'}`}
              >
                <GripVertical size={11} />
              </div>
            </div>

            {/* 右侧任务区 */}
            <div
              className="flex-1 overflow-y-auto border-l border-border/60 px-5 py-4"
              style={{
                minWidth: RIGHT_PANE_MIN,
                background:
                  'linear-gradient(180deg, rgb(var(--app-surface) / 0.72), rgb(var(--app-bg) / 1))',
              }}
            >
              <TaskPanel />
            </div>
          </div>
            </motion.div>
          )}
          {view === 'history' && (
            <motion.div
              key="view-history"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0"
            >
              <HistoryPanel />
            </motion.div>
          )}
          {view === 'settings' && (
            <motion.div
              key="view-settings"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
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

function BrandMark({ state }: { state: string }) {
  const running = state === 'running';
  return (
    <div
      className={`relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl border border-accent/20 bg-accent/10 text-accent transition-all duration-[var(--motion-slow)] ease-[var(--ease-in-out)] ${
        running
          ? 'shadow-glow scale-105'
          : 'shadow-soft'
      }`}
    >
      <div className="absolute inset-x-1.5 top-1.5 h-px bg-white/45" />
      <Activity size={16} className="relative z-10" />
      <span
        className={`absolute bottom-1.5 h-1 w-3 rounded-full bg-accent transition-all duration-[var(--motion-slow)] ease-[var(--ease-in-out)] ${
          running ? 'animate-pulse w-4' : 'opacity-60'
        }`}
      />
      {running && (
        <motion.div
          className="absolute inset-0 rounded-2xl bg-accent/[0.06]"
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </div>
  );
}

function StatePill({ state }: { state: string }) {
  const cls =
    state === 'running'
      ? 'border-accent/30 bg-accent/10 text-accent'
      : state === 'paused'
        ? 'border-warning/25 bg-warning/10 text-warning'
        : state === 'finished'
          ? 'border-success/25 bg-success/10 text-success'
          : 'border-border bg-bg-subtle text-fg-muted';
  return (
    <span
      key={`state-pill-${state}`}
      className={`motion-fade-up rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {stateLabel(state)}
    </span>
  );
}

function NavBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`motion-press motion-state-transition flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold ${
        active ? 'nav-active' : 'text-fg-muted hover:bg-bg-card/75 hover:text-fg'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function stateLabel(state: string): string {
  switch (state) {
    case 'idle':
      return '未开始';
    case 'running':
      return '专注中';
    case 'paused':
      return '已暂停';
    case 'finished':
      return '已结束';
    default:
      return '';
  }
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
