// 滴答任务选择器 —— v0.12 弹层系统统一实现。
// 契约（见 frontend-design/FRONTEND_SPEC.md 4/9 节与 styles/features/overlays.css 头部）：
// - 材质：.overlay-surface（不透明 elevated + shadow-modal + 边缘高光），遮罩 .overlay-backdrop；
// - 动画：framer-motion spring（stiffness 380 / damping 30）从 --popover-origin 触发位置附近
//   生长展开，退出 140ms 下沉收束（closing 态驱动 exit 变体，EXIT_MS 后回调父级），
//   reduced-motion 静态呈现（initial={false}），JS 侧同步跳过退出延时；
// - 焦点：打开时搜索框首焦，Tab 在弹层内循环，关闭后焦点返回触发元素；
// - 键盘：↑↓ 导航（combobox + listbox，aria-activedescendant）、Enter 选择、Esc 关闭、
//   ←/→ 折叠/展开有子任务的行、Home/End 跳转首尾。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { Icon } from '../../ui/Icon';
import { useStore } from '../../app/store';
import type { Task } from '@shared/types';
import { TaskTree, type TaskTreeRowContext } from './TaskTree';
import { countTaskTree, filterTaskTree } from './taskTreeModel';
import { useTaskTreeCollapse } from './useTaskTreeCollapse';

interface TaskPickerProps {
  onPick: (task: Task | null) => void;
  title?: string;
  selectedTaskId?: string | null;
  allowCompleted?: boolean;
}

/** 弹层定位结果：从触发元素附近展开，四边留出视口安全边距 */
interface PickerAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
  /** --popover-origin：触发点相对于弹层的位置（百分比），动画由此生长 */
  origin: string;
  /** --popover-lift：入场微位移方向（向下展开从上方来，向上展开从下方来） */
  lift: string;
}

const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 8;
/** 与弹层退出变体（140ms）匹配的退出等待时长，留 10ms 余量 */
const EXIT_MS = 150;

/**
 * 弹层显隐变体（全组统一弹层语言）：
 * 入场 spring（stiffness 380 / damping 30），缩放从 --popover-origin 生长，透明度 160ms 淡入；
 * 退出 140ms standard 缓动下沉收束。reduced-motion 时由 initial={false} 静态呈现。
 */
const PICKER_SHELL_VARIANTS: Variants = {
  enter: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      scale: { type: 'spring', stiffness: 380, damping: 30 },
      y: { type: 'spring', stiffness: 380, damping: 30 },
      opacity: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
    },
  },
  exit: {
    opacity: 0,
    scale: 0.99,
    y: 4,
    transition: { duration: 0.14, ease: [0.4, 0, 0.2, 1] },
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** 依据触发元素位置计算弹层坐标；无有效触发元素（如小窗唤起）时返回 null，回退为居中弹窗 */
function computeAnchor(trigger: HTMLElement | null): PickerAnchor | null {
  if (!trigger || !trigger.isConnected || trigger === document.body) return null;
  const rect = trigger.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(560, vw * 0.92);
  const height = Math.min(540, vh * 0.76);
  const left = clamp(rect.left, VIEWPORT_MARGIN, vw - width - VIEWPORT_MARGIN);
  let top = rect.bottom + ANCHOR_GAP;
  let below = true;
  if (top + height > vh - VIEWPORT_MARGIN) {
    const aboveTop = rect.top - ANCHOR_GAP - height;
    if (aboveTop >= VIEWPORT_MARGIN) {
      // 下方放不下时翻到触发元素上方
      top = aboveTop;
      below = false;
    } else {
      top = clamp(top, VIEWPORT_MARGIN, vh - height - VIEWPORT_MARGIN);
    }
  }
  const originX = clamp(((rect.left + rect.width / 2 - left) / width) * 100, 0, 100);
  return {
    left,
    top,
    width,
    height,
    origin: `${originX.toFixed(1)}% ${below ? '0%' : '100%'}`,
    lift: below ? '-2px' : '2px',
  };
}

/** 键盘导航用的可见行扁平化：与 TaskTree 的渲染顺序一致（跳过已折叠子树） */
interface PickerFlatRow {
  task: Task;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  childCount: number;
}

function flattenVisibleRows(tasks: Task[], collapsed: Record<string, boolean>): PickerFlatRow[] {
  const out: PickerFlatRow[] = [];
  const walk = (list: Task[], depth: number) => {
    for (const task of list) {
      const hasChildren = Boolean(task.children?.length);
      const isCollapsed = collapsed[task.id] === true;
      out.push({
        task,
        depth,
        hasChildren,
        isCollapsed,
        childCount: task.children?.length ?? 0,
      });
      if (hasChildren && !isCollapsed) walk(task.children!, depth + 1);
    }
  };
  walk(tasks, 0);
  return out;
}

/** 加载骨架的行形（缩进, 标题宽度）：与真实任务行等高，覆盖父子两级形态 */
const SKELETON_ROWS: Array<[number, string]> = [
  [0, '58%'],
  [17, '44%'],
  [17, '66%'],
  [0, '50%'],
  [17, '38%'],
  [0, '70%'],
  [17, '52%'],
];

export function TaskPicker({
  onPick,
  title = '选择任务',
  selectedTaskId,
  allowCompleted = false,
}: TaskPickerProps) {
  const { ticktickTasks, ticktickProjects, setTicktickTasks, setTicktickProjects, addToast } =
    useStore();
  const [query, setQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [loading, setLoading] = useState(ticktickTasks.length === 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [providerLabel, setProviderLabel] = useState('滴答清单');
  const [closing, setClosing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const { collapsed, toggleCollapse } = useTaskTreeCollapse(ticktickTasks, query);
  // reduced-motion：弹层静态呈现（initial={false}），关闭仍走 requestClose 的即时落定分支。
  const reduceMotion = useReducedMotion();

  // 打开瞬间捕获触发元素：定位锚点与关闭后的焦点返回都依赖它。
  // useState 惰性初始化保证读到的是「打开弹层那一次点击」落焦的按钮。
  const [anchor] = useState<PickerAnchor | null>(() =>
    computeAnchor(document.activeElement as HTMLElement | null),
  );
  const triggerRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const closingRef = useRef(false);
  const exitTimerRef = useRef<number | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const hasTasksRef = useRef(ticktickTasks.length > 0);

  useEffect(() => {
    hasTasksRef.current = ticktickTasks.length > 0;
  }, [ticktickTasks.length]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await window.focuslink.tasks.refresh({ includeCompleted: allowCompleted });
      if (!result.ok) throw new Error(result.error);
      setTicktickProjects(result.data.projects);
      setTicktickTasks(result.data.tasks);
      setProviderLabel(result.data.provider === 'dida-cli' ? '滴答清单 · CLI' : '滴答清单');
    } catch (error) {
      const message = toErrorMessage(error);
      if (hasTasksRef.current) {
        // 已有缓存列表时刷新失败不打断浏览，走 transient 提示
        addToast(`加载滴答任务失败：${message}`, 'error');
      } else {
        setLoadError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [addToast, allowCompleted, setTicktickProjects, setTicktickTasks]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  // 搜索框首焦
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  /** 真正关闭：焦点还给触发元素后再通知父级（父级通常会卸载本弹层） */
  const finishClose = useCallback((result: Task | null) => {
    const trigger = triggerRef.current;
    if (trigger && trigger.isConnected) {
      trigger.focus({ preventScroll: true });
    }
    onPickRef.current(result);
  }, []);

  /** 统一关闭入口：播放反向收束动画后再回调；reduced-motion 与重复调用都直接落定 */
  const requestClose = useCallback(
    (result: Task | null) => {
      if (closingRef.current) return;
      closingRef.current = true;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        finishClose(result);
        return;
      }
      setClosing(true);
      exitTimerRef.current = window.setTimeout(() => finishClose(result), EXIT_MS);
    },
    [finishClose],
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [requestClose]);

  // 卸载兜底：父级直接移除弹层（未走 requestClose）时，仍把焦点还给触发元素
  useEffect(
    () => () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
      const trigger = triggerRef.current;
      if (trigger && trigger.isConnected && document.activeElement === document.body) {
        trigger.focus({ preventScroll: true });
      }
    },
    [],
  );

  const filteredTree = useMemo(
    () =>
      filterTaskTree(ticktickTasks, {
        query,
        projectId: selectedProject,
        showCompleted: allowCompleted,
        ignoreProjectWhenSearching: true,
        sort: 'smart',
      }).tasks,
    [allowCompleted, query, selectedProject, ticktickTasks],
  );

  const visibleRows = useMemo(
    () => flattenVisibleRows(filteredTree, collapsed),
    [filteredTree, collapsed],
  );

  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    visibleRows.forEach((row, index) => map.set(row.task.id, index));
    return map;
  }, [visibleRows]);

  // 初始高亮落在当前已关联任务上（只执行一次，之后完全由用户导航接管）
  const didInitActiveRef = useRef(false);
  useEffect(() => {
    if (didInitActiveRef.current || visibleRows.length === 0) return;
    didInitActiveRef.current = true;
    const initial = selectedTaskId
      ? visibleRows.findIndex(
          (row) => row.task.id === selectedTaskId || row.task.externalId === selectedTaskId,
        )
      : -1;
    setActiveIndex(initial >= 0 ? initial : 0);
  }, [visibleRows, selectedTaskId]);

  // 搜索词变化后高亮回到第一条（跳过挂载当次，避免覆盖 selected 初始化）
  const didMountQueryRef = useRef(false);
  useEffect(() => {
    if (!didMountQueryRef.current) {
      didMountQueryRef.current = true;
      return;
    }
    didInitActiveRef.current = true;
    setActiveIndex(0);
  }, [query]);

  // 树变化（折叠/筛选）后收敛高亮下标
  useEffect(() => {
    if (activeIndex >= visibleRows.length) {
      setActiveIndex(Math.max(0, visibleRows.length - 1));
    }
  }, [activeIndex, visibleRows.length]);

  // 高亮行滚动到可视区域
  useEffect(() => {
    const row = activeIndex >= 0 ? visibleRows[activeIndex] : undefined;
    if (!row) return;
    listRef.current
      ?.querySelector(`[data-picker-option="${CSS.escape(row.task.id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, visibleRows]);

  const activeRow =
    activeIndex >= 0 && activeIndex < visibleRows.length ? visibleRows[activeIndex] : undefined;
  const activeOptionId = activeRow ? `task-picker-option-${activeRow.task.id}` : undefined;

  const moveActive = (delta: number) => {
    if (visibleRows.length === 0) return;
    setActiveIndex((prev) => (prev + delta + visibleRows.length) % visibleRows.length);
  };

  /** 搜索框承载全部列表键盘操作（combobox 模式，焦点不离开输入框） */
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        event.preventDefault();
        if (visibleRows.length > 0) setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        if (visibleRows.length > 0) setActiveIndex(visibleRows.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        if (activeRow) requestClose(activeRow.task);
        break;
      case 'ArrowRight':
        // 有子任务且已折叠时才拦截（否则保留输入框光标移动）
        if (activeRow?.hasChildren && activeRow.isCollapsed) {
          event.preventDefault();
          toggleCollapse(activeRow.task.id);
        }
        break;
      case 'ArrowLeft':
        if (activeRow?.hasChildren && !activeRow.isCollapsed) {
          event.preventDefault();
          toggleCollapse(activeRow.task.id);
        }
        break;
      case 'Escape':
        event.preventDefault();
        requestClose(null);
        break;
    }
  };

  /** Tab 焦点圈：焦点只在弹层内的控件间循环，不泄露出弹层 */
  const handleShellKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const shell = shellRef.current;
    if (!shell) return;
    const focusables = Array.from(
      shell.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled])',
      ),
    ).filter((el) => el.getClientRects().length > 0);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const focusOutside = !active || !shell.contains(active);
    if (event.shiftKey && (focusOutside || active === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (focusOutside || active === last)) {
      event.preventDefault();
      first.focus();
    }
  };

  const transformOrigin = anchor?.origin ?? '50% 42%';
  const shellStyle = {
    ...(anchor
      ? {
          position: 'absolute',
          left: anchor.left,
          top: anchor.top,
          width: anchor.width,
          height: anchor.height,
          '--popover-origin': anchor.origin,
          '--popover-lift': anchor.lift,
        }
      : {
          // 无触发元素时居中，动画从几何中心偏上生长
          '--popover-origin': '50% 42%',
        }),
    // spring 缩放围绕触发点生长（与 --popover-origin 同源）
    transformOrigin,
  } as React.CSSProperties;

  // 入场微位移方向与锚点上下方位一致：向下展开从上方来，向上展开从下方来
  const initialLift = anchor ? (anchor.lift === '-2px' ? -4 : 4) : 6;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={() => requestClose(null)}
    >
      <div
        className={`overlay-backdrop absolute inset-0 ${closing ? 'overlay-backdrop-exit' : 'motion-fade-in'}`}
        aria-hidden="true"
      />
      <motion.div
        ref={shellRef}
        className={`picker-shell overlay-surface z-10 flex flex-col${
          closing ? ' is-closing' : ''
        }${anchor ? '' : ' relative h-[min(540px,76vh)] w-[min(560px,92vw)]'}`}
        style={shellStyle}
        variants={PICKER_SHELL_VARIANTS}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: initialLift }}
        animate={closing ? 'exit' : 'enter'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-picker-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleShellKeyDown}
      >
        <div className="flex min-h-[58px] items-center justify-between border-b border-border/70 px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span id="task-picker-title" className="text-[14px] font-semibold text-fg">
                {title}
              </span>
              <span className="text-[11px] text-fg-muted">{countTaskTree(filteredTree)} 项</span>
            </div>
            <p className="mt-0.5 text-[11.5px] text-fg-muted">{providerLabel}</p>
          </div>
          <button
            className="motion-press rounded-md p-1.5 text-fg-subtle hover:bg-bg-subtle/60 hover:text-fg"
            onClick={() => requestClose(null)}
            aria-label="关闭任务选择器"
          >
            <Icon.X size="sm" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
          <label className="task-search-row flex-1">
            <Icon.Search
              size="sm"
              tone="subtle"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
            />
            <input
              ref={searchRef}
              className="task-search-input !text-[13px]"
              placeholder="搜索滴答任务"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              role="combobox"
              aria-expanded="true"
              aria-controls="task-picker-listbox"
              aria-activedescendant={activeOptionId}
              aria-autocomplete="list"
            />
            {query && (
              <button
                className="task-search-clear motion-press"
                onClick={() => setQuery('')}
                aria-label="清空搜索"
              >
                <Icon.X size="xs" />
              </button>
            )}
          </label>
          {ticktickProjects.length > 0 && !query && (
            <select
              className="overlay-select task-picker-project"
              value={selectedProject}
              onChange={(event) => setSelectedProject(event.target.value)}
              aria-label="选择清单"
            >
              <option value="">全部清单</option>
              {ticktickProjects.map((project) => (
                <option key={project.id} value={project.externalId} title={project.name}>
                  {project.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="task-refresh-btn"
            onClick={loadTasks}
            disabled={loading}
            aria-label="刷新任务"
          >
            <Icon.Refresh size="sm" spin={loading} />
          </button>
        </div>

        <div
          ref={listRef}
          id="task-picker-listbox"
          className="overlay-scroll flex-1 overflow-y-auto p-2.5"
          role="listbox"
          aria-label="滴答任务列表"
        >
          {loading && filteredTree.length === 0 ? (
            <div aria-hidden="true">
              {SKELETON_ROWS.map(([indent, width], index) => (
                <div
                  className="picker-skeleton-row"
                  key={index}
                  style={{ paddingLeft: indent + 8 }}
                >
                  <span className="skeleton picker-skeleton-dot" />
                  <span className="skeleton picker-skeleton-bar" style={{ width }} />
                </div>
              ))}
            </div>
          ) : loadError && filteredTree.length === 0 ? (
            <div className="flex h-full items-center">
              <div className="state-block tone-error w-full" role="alert">
                <div className="state-block-icon">
                  <Icon.AlertCircle size="md" />
                </div>
                <p className="state-block-title">加载滴答任务失败</p>
                <p className="state-block-desc">{loadError}</p>
                <div className="state-block-actions">
                  <button type="button" className="btn-outline" onClick={loadTasks}>
                    <Icon.Refresh size="xs" />
                    重试
                  </button>
                </div>
              </div>
            </div>
          ) : filteredTree.length === 0 ? (
            <div className="flex h-full items-center">
              {ticktickTasks.length === 0 ? (
                <div className="state-block w-full">
                  <div className="state-block-icon">
                    <Icon.Inbox size="md" />
                  </div>
                  <p className="state-block-title">暂无可用任务</p>
                  <p className="state-block-desc">在滴答清单中创建任务后，点击右上角刷新。</p>
                  <div className="state-block-actions">
                    <button type="button" className="btn-outline" onClick={loadTasks}>
                      <Icon.Refresh size="xs" />
                      刷新
                    </button>
                  </div>
                </div>
              ) : (
                <div className="state-block w-full">
                  <div className="state-block-icon">
                    <Icon.Search size="md" />
                  </div>
                  <p className="state-block-title">没有匹配的任务</p>
                  <p className="state-block-desc">没有匹配「{query}」的任务。</p>
                  <div className="state-block-actions">
                    <button type="button" className="btn-outline" onClick={() => setQuery('')}>
                      清空搜索
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <TaskTree
              tasks={filteredTree}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
              renderRow={(context) => {
                const flatIndex = indexById.get(context.task.id) ?? -1;
                return (
                  <PickerRow
                    context={context}
                    flatIndex={flatIndex}
                    optionId={`task-picker-option-${context.task.id}`}
                    active={flatIndex === activeIndex}
                    selectedTaskId={selectedTaskId}
                    onPick={(task) => requestClose(task)}
                    onActivate={setActiveIndex}
                  />
                );
              }}
            />
          )}
        </div>

        <div className="flex min-h-[40px] items-center justify-between border-t border-border/60 px-4 text-[11px] text-fg-muted">
          <span>↑↓ 选择 · Enter 关联 · Esc 关闭</span>
          <span>点击任务即可关联</span>
        </div>
      </motion.div>
    </div>
  );
}

function PickerRow({
  context,
  flatIndex,
  optionId,
  active,
  selectedTaskId,
  onPick,
  onActivate,
}: {
  context: TaskTreeRowContext;
  flatIndex: number;
  optionId: string;
  active: boolean;
  selectedTaskId?: string | null;
  onPick: (task: Task) => void;
  onActivate: (index: number) => void;
}) {
  const { task, depth, hasChildren, isCollapsed, childCount, toggleCollapse } = context;
  const isCompleted = task.isCompleted === true;
  const isSelected = selectedTaskId === task.id || selectedTaskId === task.externalId;

  return (
    <div
      id={optionId}
      className={`task-row-linear group ${isSelected ? 'task-row-highlighted' : ''} ${
        isCompleted ? 'task-row-done' : ''
      } ${active ? 'is-active' : ''}`}
      style={{ paddingLeft: Math.min(depth, 2) * 17 + 8 }}
      data-depth={depth}
      data-picker-option={task.id}
      onClick={() => onPick(task)}
      onMouseEnter={() => {
        if (flatIndex >= 0) onActivate(flatIndex);
      }}
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
    >
      {hasChildren ? (
        <button
          className="task-chevron motion-press"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            toggleCollapse();
          }}
          title={isCollapsed ? '展开' : '收起'}
          aria-label={isCollapsed ? `展开 ${task.title}` : `收起 ${task.title}`}
        >
          <motion.span
            animate={{ rotate: isCollapsed ? 0 : 90 }}
            transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Icon.ChevronRight size="xs" />
          </motion.span>
        </button>
      ) : (
        <span className="task-chevron-spacer" aria-hidden="true" />
      )}
      <span
        className={`task-completion-status ${isCompleted ? 'completed' : ''}`}
        title={isCompleted ? '已完成' : '未完成'}
        aria-label={isCompleted ? '已完成' : '未完成'}
      >
        {isCompleted && <Icon.Check size="xs" />}
      </span>
      <span
        className={`task-title ${isCompleted ? 'done' : ''} ${depth === 0 ? 'parent' : ''}`}
        title={task.title}
      >
        {task.title}
      </span>
      <div className="task-meta-inline">
        {hasChildren && <span className="task-child-count">{childCount}</span>}
      </div>
      {isSelected ? (
        <span className="task-current-label">当前</span>
      ) : (
        <span className="task-select-arrow" aria-hidden="true">
          <Icon.ChevronRight size="xs" />
        </span>
      )}
    </div>
  );
}

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
