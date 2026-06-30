import { useEffect, useRef, useState, useCallback } from 'react';
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
    <div className="flex h-screen w-screen flex-col bg-bg-base text-fg antialiased">
      {/* 标题栏 */}
      <header
        className="relative flex items-center justify-between border-b border-border/80 bg-bg-card/95 px-4 py-2.5 shadow-soft backdrop-blur-xl select-none"
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

        {/* 导航 */}
        <nav className="flex items-center gap-1 rounded-xl border border-border bg-bg-subtle/70 p-1">
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

      {/* 主体 */}
      <main className="relative flex-1 overflow-hidden">
        {view === 'timer' && (
          <div ref={containerRef} className="flex h-full w-full min-w-0 overflow-hidden bg-bg-base">
            {/* 左侧计时区 */}
            <div
              className="flex flex-col overflow-y-auto p-5"
              style={{
                width:
                  effectiveLeft ??
                  `min(${Math.round(DEFAULT_LEFT_PANE_RATIO * 100)}%, ${LEFT_PANE_MAX}px)`,
                maxWidth: `min(${LEFT_PANE_MAX}px, calc(100% - ${RIGHT_PANE_MIN + PANE_DIVIDER_WIDTH}px))`,
                minWidth: LEFT_PANE_MIN,
                flexShrink: 0,
                background:
                  'linear-gradient(180deg, rgb(var(--app-bg) / 1), rgb(var(--app-surface-2) / 0.54))',
              }}
            >
              <TimerPanel />
              <div className="mt-5">
                <SegmentTimeline />
              </div>
            </div>

            {/* 可拖拽分割线 — 悬停时更醒目 */}
            <div
              onMouseDown={onMouseDown}
              onDoubleClick={onDoubleClick}
              className={`group motion-base relative z-10 flex-shrink-0 cursor-col-resize ${isDividerDragging ? 'bg-accent/[0.08]' : 'hover:bg-bg-subtle/70'}`}
              style={{ width: PANE_DIVIDER_WIDTH }}
              title="拖动调整左右宽度，双击恢复默认"
            >
              {/* 中心指示线 */}
              <div
                className="motion-base absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded-full"
                style={{
                  background: isDividerDragging
                    ? 'rgb(var(--app-accent))'
                    : 'rgb(var(--app-border))',
                  opacity: isDividerDragging ? 0.75 : 0.72,
                }}
              />
              {/* 悬停高亮层 */}
              <div
                className="motion-base absolute inset-y-4 left-1/2 w-px -translate-x-1/2 rounded-full opacity-0 group-hover:opacity-100"
                style={{
                  background: 'rgb(var(--app-accent))',
                  boxShadow: '0 0 0 1px rgb(var(--app-accent) / 0.16)',
                }}
              />
              <div
                className={`motion-base absolute left-1/2 top-1/2 flex h-8 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-bg-card shadow-soft group-hover:border-accent/40 group-hover:text-accent group-hover:opacity-100 ${isDividerDragging ? 'border-accent/55 text-accent opacity-100' : 'border-border text-fg-subtle opacity-70'}`}
              >
                <GripVertical size={13} />
              </div>
            </div>

            {/* 右侧任务区 */}
            <div
              className="flex-1 overflow-y-auto border-l border-border/70 p-5"
              style={{
                minWidth: RIGHT_PANE_MIN,
                background:
                  'linear-gradient(180deg, rgb(var(--app-surface) / 0.72), rgb(var(--app-bg) / 1))',
              }}
            >
              <TaskPanel />
            </div>
          </div>
        )}
        {view === 'history' && <HistoryPanel />}
        {view === 'settings' && <SettingsPanel />}
      </main>

      <Toast />
    </div>
  );
}

function BrandMark({ state }: { state: string }) {
  const running = state === 'running';
  return (
    <div
      className={`relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl border border-accent/20 bg-accent/10 text-accent shadow-soft ${
        running ? 'shadow-glow' : ''
      }`}
    >
      <div className="absolute inset-x-1.5 top-1.5 h-px bg-white/45" />
      <Activity size={16} className="relative z-10" />
      <span
        className={`absolute bottom-1.5 h-1 w-3 rounded-full bg-accent ${running ? 'animate-pulse' : 'opacity-60'}`}
      />
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
    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>
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
      className={`motion-press flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold ${
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
