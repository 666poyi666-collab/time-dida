// 统计 Dashboard：一句话结论 → 主视觉（单日 24h 时间织带 / 多日 日期×时刻矩阵）
// → 会话珠链（单次质量）→ 时间去向马赛克。数据全部来自 sessions.analytics 契约，
// 空数据渲染明确空态；进行中的会话计入并以「进行中」标记。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FocusSession } from '@shared/types';
import type { SessionAnalyticsResult, SessionAnalyticsTimelineItem } from '@shared/ipc/api';
import { Icon } from '../../ui/Icon';
import { formatClock, formatMinutes } from '../../lib/time';
import {
  isSameLocalDay,
  type RangePreset,
  type SessionSummary,
  type TimeRange,
} from './historyStats';
import {
  beadLaneAssignments,
  beadRadiusPx,
  buildRhythmMatrix,
  matrixRowHeight,
  summarizeBeadSession,
} from './insightsMath';

interface HistoryInsightsProps {
  sessions: FocusSession[];
  summary: SessionSummary;
  range: TimeRange;
  analytics: SessionAnalyticsResult | null;
  slideDirection: -1 | 0 | 1;
  onSelectRange: (preset: RangePreset) => void;
  /** 点击织带/珠链中的会话：在下方会话列表中展开详情 */
  onOpenSession?: (sessionId: string) => void;
}

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const DAY_PARTS: Array<[number, number, string]> = [
  [0, 6, '凌晨'],
  [6, 12, '上午'],
  [12, 14, '中午'],
  [14, 18, '下午'],
  [18, 24, '晚上'],
];

function palette() {
  const css = getComputedStyle(document.documentElement);
  // token 是 "R G B" 三元组，canvas 需要逗号分隔
  return (name: string) => css.getPropertyValue(name).trim().split(/\s+/).slice(0, 3).join(',');
}
function fontFamily(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'sans-serif';
}

function useCanvas(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  deps: unknown[],
) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const render = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, w, h);
    };
    const ro = new ResizeObserver(render);
    ro.observe(cv);
    render();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function cn(ms: number): string {
  return formatMinutes(ms);
}

export function HistoryInsights({
  sessions,
  summary,
  range,
  analytics,
  onSelectRange,
  onOpenSession,
}: HistoryInsightsProps) {
  const [analysisView, setAnalysisView] = useState<'overview' | 'sessions' | 'tasks'>('overview');
  const isEmpty = summary.count === 0;
  const tracked = Math.max(0, summary.active + summary.pause);
  const focusRatio = tracked > 0 ? (summary.active / tracked) * 100 : 0;
  const stability = analytics?.stability ?? null;
  const stabilityReady = !isEmpty && (stability?.calendarDays ?? 0) >= 2;
  const singleDay = isSameLocalDay(range.start, range.end - 1);
  const liveSession = sessions.find((s) => s.status === 'active') ?? null;

  return (
    <section className="history-insights" aria-label="专注数据图表">
      {isEmpty ? (
        <div className="history-insights-empty state-block" role="status">
          <div className="state-block-icon">
            <Icon.Calendar size="lg" />
          </div>
          <p className="state-block-title">当前时间范围没有专注记录</p>
          <p className="state-block-desc">
            换一个时间范围，或回到专注页开始一次新的专注。产生记录后，节律、质量与时间去向会在这里展开。
          </p>
          <div className="state-block-actions">
            <button
              type="button"
              className="btn-outline motion-press"
              onClick={() => onSelectRange('7d')}
            >
              近 7 天
            </button>
            <button
              type="button"
              className="btn-outline motion-press"
              onClick={() => onSelectRange('15d')}
            >
              半个月
            </button>
            <button
              type="button"
              className="btn-outline motion-press"
              onClick={() => onSelectRange('30d')}
            >
              1 个月
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="insight-conclusion">
            <p className="conclusion-sentence">
              {singleDay ? (
                <>
                  有效专注 <b>{cn(summary.active)}</b>
                  {liveSession && (
                    <span className="ongoing">（含进行中 {cn(liveSession.activeElapsedMs)}）</span>
                  )}
                  ，共 <b>{summary.count}</b> 次，专注率 <b>{Math.round(focusRatio)}%</b>
                  {summary.pause > 0 && <>，暂停 {cn(summary.pause)}</>}。
                </>
              ) : (
                <>
                  有效专注 <b>{cn(summary.active)}</b>
                  {liveSession && <span className="ongoing">（含进行中）</span>}，共{' '}
                  <b>{summary.count}</b> 次，专注率 <b>{Math.round(focusRatio)}%</b>
                  {stabilityReady && stability && (
                    <>
                      ；日均 {cn(stability.averageDailyActiveMs)}，活跃 {stability.activeDays}/
                      {stability.calendarDays} 天，稳定度 {stability.score}
                    </>
                  )}
                  。
                </>
              )}
            </p>
            <div className="conclusion-figures">
              <div className="conclusion-fig">
                <div className="l">有效专注</div>
                <div className="v green">{cn(summary.active)}</div>
              </div>
              <div className="conclusion-fig">
                <div className="l">暂停</div>
                <div className="v red">{cn(summary.pause)}</div>
              </div>
              <div className="conclusion-fig">
                <div className="l">专注率</div>
                <div className="v">{Math.round(focusRatio)}%</div>
              </div>
            </div>
          </div>

          <nav className="insight-view-switch" aria-label="统计分析视图">
            <button
              type="button"
              className={analysisView === 'overview' ? 'active' : ''}
              onClick={() => setAnalysisView('overview')}
            >
              {singleDay ? '今日轨迹' : '专注节律'}
              <span>{singleDay ? '时间发生在哪里' : '什么时候最容易专注'}</span>
            </button>
            <button
              type="button"
              className={analysisView === 'sessions' ? 'active' : ''}
              onClick={() => setAnalysisView('sessions')}
            >
              单次质量
              <span>每一轮是否稳定</span>
            </button>
            <button
              type="button"
              className={analysisView === 'tasks' ? 'active' : ''}
              onClick={() => setAnalysisView('tasks')}
            >
              时间去向
              <span>专注投入了什么</span>
            </button>
          </nav>

          <div className="insight-stage" key={analysisView}>
            {analysisView === 'overview' &&
              (singleDay ? (
                <WeaveBlock
                  range={range}
                  timeline={analytics?.timeline ?? []}
                  onOpenSession={onOpenSession}
                />
              ) : (
                <MatrixBlock sessions={sessions} range={range} />
              ))}

            {analysisView === 'sessions' && (
              <BeadsBlock
                sessions={sessions}
                range={range}
                singleDay={singleDay}
                onOpenSession={onOpenSession}
              />
            )}

            {analysisView === 'tasks' && (
              <TaskMosaicBlock analytics={analytics} totalActive={summary.active} />
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* ── ② 主视觉 A：单日 24 小时时间织带 ─────────────────────── */

function WeaveBlock({
  range,
  timeline,
  onOpenSession,
}: {
  range: TimeRange;
  timeline: SessionAnalyticsTimelineItem[];
  onOpenSession?: (id: string) => void;
}) {
  const [readout, setReadout] = useState('');
  const dayStart = useMemo(() => {
    const d = new Date(range.start);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [range.start]);
  const isToday = isSameLocalDay(dayStart, Date.now());

  const draw = (ctx: CanvasRenderingContext2D, W: number, H: number) => {
    const C = palette();
    ctx.clearRect(0, 0, W, H);
    // 时段底纹 + 标签
    DAY_PARTS.forEach(([a, b, name], i) => {
      if (i % 2 === 0) {
        ctx.fillStyle = `rgba(${C('--app-grid')},0.05)`;
        ctx.fillRect((a / 24) * W, 0, ((b - a) / 24) * W, H);
      }
      ctx.fillStyle = `rgba(${C('--app-subtle')},1)`;
      ctx.font = `10px ${fontFamily('--font-ui')}`;
      ctx.textAlign = 'center';
      ctx.fillText(name, ((a + b) / 2 / 24) * W, 12);
    });
    for (let h = 0; h <= 24; h += 3) {
      ctx.strokeStyle = `rgba(${C('--app-grid')},0.12)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo((h / 24) * W, 16);
      ctx.lineTo((h / 24) * W, H);
      ctx.stroke();
    }
    const now = Date.now();
    for (const item of timeline) {
      const a = Math.max(item.startedAt, dayStart);
      const b = Math.min(item.endedAt ?? item.startedAt + item.durationMs, dayStart + DAY_MS);
      if (b <= a) continue;
      const x0 = ((a - dayStart) / DAY_MS) * W;
      const x1 = ((b - dayStart) / DAY_MS) * W;
      if (item.kind === 'focus') {
        ctx.fillStyle = `rgba(${C('--app-success')},0.85)`;
        ctx.fillRect(x0, H * 0.24, Math.max(x1 - x0, 0.6), H * 0.52);
      } else {
        ctx.fillStyle = `rgba(${C('--app-pause')},0.75)`;
        ctx.fillRect(x0, H * 0.42, Math.max(x1 - x0, 0.6), H * 0.16);
      }
    }
    if (isToday) {
      const x = ((now - dayStart) / DAY_MS) * W;
      ctx.strokeStyle = `rgba(${C('--app-ink')},0.85)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, 16);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
  };
  const ref = useCanvas(draw, [dayStart, timeline, isToday]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = dayStart + ((e.clientX - rect.left) / rect.width) * DAY_MS;
    let hit: SessionAnalyticsTimelineItem | null = null;
    for (const item of timeline) {
      const end = item.endedAt ?? item.startedAt + item.durationMs;
      if (t >= item.startedAt && t < end) hit = item;
    }
    setReadout(
      hit
        ? `${hit.kind === 'focus' ? '专注' : '暂停'} ${formatClock(hit.startedAt)}–${formatClock(hit.endedAt ?? hit.startedAt + hit.durationMs)} · ${cn(hit.durationMs)}${hit.title ? ` · ${hit.title}` : ''}`
        : `${formatClock(t)} · 无记录`,
    );
  };
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onOpenSession) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = dayStart + ((e.clientX - rect.left) / rect.width) * DAY_MS;
    for (const item of timeline) {
      const end = item.endedAt ?? item.startedAt + item.durationMs;
      if (t >= item.startedAt && t < end) {
        onOpenSession(item.sessionId);
        return;
      }
    }
  };

  return (
    <div className="insight-block">
      <div className="insight-block-head">
        <h2>今天的时间</h2>
        <span className="sub">24 小时织带 · 悬停读数 · 点击片段展开会话</span>
        <div className="right" />
      </div>
      <canvas
        ref={ref}
        className="weave-canvas"
        style={{ height: 132 }}
        onMouseMove={onMove}
        onMouseLeave={() => setReadout('')}
        onClick={onClick}
      />
      <AxisLabels />
      <div className="chart-readout">{readout}</div>
      <div className="insight-footnote">
        绿 = 专注段（全高）；红 = 暂停段（半高）；空白 = 无记录。口径：真实片段边界，不做平滑。
      </div>
    </div>
  );
}

function AxisLabels() {
  return (
    <div className="axis-labels">
      {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
        <span
          key={h}
          className={h === 0 ? 'first' : h === 24 ? 'last' : ''}
          style={{ left: `${(h / 24) * 100}%` }}
        >
          {h}
        </span>
      ))}
    </div>
  );
}

/* ── ② 主视觉 B：多日 日期×时刻节律矩阵 ───────────────────── */

function MatrixBlock({ sessions, range }: { sessions: FocusSession[]; range: TimeRange }) {
  const [readout, setReadout] = useState('');
  const days = useMemo(
    () => buildRhythmMatrix(sessions, range.start, range.end),
    [sessions, range.start, range.end],
  );

  const labelW = 44;
  const totalW = 24;
  const rowH = matrixRowHeight(days.length);
  const height = days.length * rowH + 26;

  const draw = (ctx: CanvasRenderingContext2D, W: number) => {
    const C = palette();
    const gridW = W - labelW - 70;
    const cellW = gridW / totalW;
    ctx.clearRect(0, 0, W, height);
    ctx.font = `10px ${fontFamily('--font-number')}`;
    days.forEach((day, r) => {
      const y = r * rowH;
      ctx.fillStyle = `rgba(${C('--app-subtle')},1)`;
      ctx.textAlign = 'right';
      ctx.fillText(day.label, labelW - 8, y + rowH / 2 + 3);
      for (let h = 0; h < 24; h += 1) {
        const v = day.cells[h];
        const x = labelW + h * cellW;
        if (v <= 0) {
          ctx.fillStyle = `rgba(${C('--app-grid')},0.06)`;
        } else {
          const level = v >= 45 ? 0.9 : v >= 25 ? 0.66 : v >= 10 ? 0.42 : 0.22;
          ctx.fillStyle = `rgba(${C('--app-success')},${level})`;
        }
        ctx.fillRect(x + 0.5, y + 1, cellW - 1, rowH - 2);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = `rgba(${C('--app-success-deep')},1)`;
      ctx.fillText(day.active > 0 ? cn(day.active) : '—', labelW + gridW + 8, y + rowH / 2 + 3);
      if (day.pause > 0) {
        ctx.fillStyle = `rgba(${C('--app-pause')},1)`;
        ctx.fillText(
          `+${cn(day.pause)}`,
          labelW + gridW + 8 + ctx.measureText(day.active > 0 ? cn(day.active) : '—').width + 10,
          y + rowH / 2 + 3,
        );
      }
    });
    // 底部小时轴
    ctx.fillStyle = `rgba(${C('--app-subtle')},1)`;
    ctx.textAlign = 'center';
    for (let h = 0; h <= 24; h += 3) {
      ctx.fillText(String(h), labelW + h * cellW, height - 8);
    }
  };
  const ref = useCanvas(draw, [days, height]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const gridW = rect.width - labelW - 70;
    const h = Math.floor(((e.clientX - rect.left - labelW) / gridW) * 24);
    const r = Math.floor((e.clientY - rect.top) / rowH);
    const day = days[r];
    if (!day || h < 0 || h > 23) {
      setReadout('');
      return;
    }
    const v = Math.round(day.cells[h]);
    setReadout(
      `${day.label} ${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00 · ${v > 0 ? `会话覆盖 ${v} 分钟` : '无记录'} · 当日有效 ${cn(day.active)}${day.pause > 0 ? ` 暂停 ${cn(day.pause)}` : ''}`,
    );
  };

  return (
    <div className="insight-block">
      <div className="insight-block-head">
        <h2>专注节律</h2>
        <span className="sub">日期 × 时刻矩阵 · 颜色深度 = 会话覆盖分钟</span>
      </div>
      <canvas
        ref={ref}
        className="matrix-canvas"
        style={{ height }}
        onMouseMove={onMove}
        onMouseLeave={() => setReadout('')}
      />
      <div className="chart-readout">{readout}</div>
      <div className="insight-footnote">
        口径：会话起止覆盖到每小时的分钟数（墙钟）；行尾绿字 = 当日有效专注，红字 = 当日暂停。
      </div>
    </div>
  );
}

/* ── ③ 会话珠链：单次专注质量 ─────────────────────────────── */

interface Bead {
  session: FocusSession;
  x: number; // 0..24 小时
  lane: number;
  r: number;
  rate: number;
  pauseShare: number;
  live: boolean;
  dayRow?: number;
}

function BeadsBlock({
  sessions,
  range,
  singleDay,
  onOpenSession,
}: {
  sessions: FocusSession[];
  range: TimeRange;
  singleDay: boolean;
  onOpenSession?: (id: string) => void;
}) {
  const [readout, setReadout] = useState('');
  const beadLayout = useMemo(() => {
    const dayStart = new Date(range.start);
    dayStart.setHours(0, 0, 0, 0);
    const d0 = dayStart.getTime();
    const beads: Bead[] = [];
    const sorted = sessions.slice().sort((a, b) => a.startedAt - b.startedAt);
    if (singleDay) {
      const xs = sorted.map((s) => (s.startedAt - d0) / HOUR_MS);
      const radii = sorted.map((s) => beadRadiusPx(s.activeElapsedMs, true));
      const lanes = beadLaneAssignments(xs, radii);
      sorted.forEach((s, i) => {
        const { rate, pauseShare, live } = summarizeBeadSession(s);
        beads.push({ session: s, x: xs[i], lane: lanes[i], r: radii[i], rate, pauseShare, live });
      });
    } else {
      const first = new Date(range.start);
      first.setHours(0, 0, 0, 0);
      for (const s of sorted) {
        const { rate, pauseShare, live } = summarizeBeadSession(s);
        const dayRow = Math.floor((s.startedAt - first.getTime()) / DAY_MS);
        const hours = (s.startedAt - first.getTime() - dayRow * DAY_MS) / HOUR_MS;
        beads.push({
          session: s,
          x: hours,
          lane: 0,
          dayRow,
          r: beadRadiusPx(s.activeElapsedMs, false),
          rate,
          pauseShare,
          live,
        });
      }
    }
    return beads;
  }, [sessions, range.start, singleDay]);

  const daysCount = singleDay ? 1 : Math.max(1, Math.ceil((range.end - range.start) / DAY_MS));
  const laneH = singleDay ? 34 : 0;
  const multiRowH = 15;
  const height = singleDay ? laneH * 4 + 34 : daysCount * multiRowH + 24;
  const labelW = singleDay ? 0 : 44;

  const toXY = (b: Bead, W: number): [number, number] => {
    if (singleDay) {
      return [(b.x / 24) * W, 10 + b.lane * laneH + laneH / 2];
    }
    const gridW = W - labelW - 8;
    return [labelW + (b.x / 24) * gridW, (b.dayRow ?? 0) * multiRowH + multiRowH / 2 + 2];
  };

  const draw = (ctx: CanvasRenderingContext2D, W: number) => {
    const C = palette();
    ctx.clearRect(0, 0, W, height);
    // 轴
    if (singleDay) {
      for (let h = 0; h <= 24; h += 3) {
        ctx.strokeStyle = `rgba(${C('--app-grid')},0.12)`;
        ctx.beginPath();
        ctx.moveTo((h / 24) * W, 0);
        ctx.lineTo((h / 24) * W, height - 14);
        ctx.stroke();
        ctx.fillStyle = `rgba(${C('--app-subtle')},1)`;
        ctx.font = `10px ${fontFamily('--font-number')}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(h), (h / 24) * W, height - 3);
      }
    } else {
      const first = new Date(range.start);
      first.setHours(0, 0, 0, 0);
      ctx.font = `10px ${fontFamily('--font-number')}`;
      for (let r = 0; r < daysCount; r += 1) {
        const d = new Date(first.getTime() + r * DAY_MS);
        ctx.fillStyle = `rgba(${C('--app-subtle')},1)`;
        ctx.textAlign = 'right';
        ctx.fillText(
          `${d.getMonth() + 1}/${d.getDate()}`,
          labelW - 8,
          r * multiRowH + multiRowH / 2 + 5,
        );
      }
    }
    for (const b of beadLayout) {
      const [x, y] = toXY(b, W);
      // 主珠：深度 = 专注率
      ctx.beginPath();
      ctx.arc(x, y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${C('--app-success')},${0.25 + b.rate * 0.65})`;
      ctx.fill();
      // 暂停比例环：>4% 时按占比画红弧
      if (b.pauseShare > 0.04) {
        ctx.beginPath();
        ctx.arc(
          x,
          y,
          b.r + 2.4,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * Math.min(1, b.pauseShare),
        );
        ctx.strokeStyle = `rgba(${C('--app-pause')},0.85)`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      if (b.live) {
        ctx.beginPath();
        ctx.arc(x, y, b.r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${C('--app-success')},0.7)`;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  };
  const ref = useCanvas(draw, [beadLayout, height, range.start, daysCount, singleDay]);

  const hitBead = (e: React.MouseEvent<HTMLCanvasElement>): Bead | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best: Bead | null = null;
    let bestD = 1e9;
    for (const b of beadLayout) {
      const [x, y] = toXY(b, rect.width);
      const d = Math.hypot(mx - x, my - y);
      if (d < b.r + 5 && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const b = hitBead(e);
    if (!b) {
      setReadout('');
      return;
    }
    const s = b.session;
    const tracked = s.activeElapsedMs + s.pauseElapsedMs;
    const start = formatClock(s.startedAt);
    const end = s.endedAt ? formatClock(s.endedAt) : '进行中';
    setReadout(
      `${start}–${end} · 有效 ${cn(s.activeElapsedMs)} · 暂停 ${cn(s.pauseElapsedMs)} · 专注率 ${tracked > 0 ? Math.round((s.activeElapsedMs / tracked) * 100) : 0}%${s.defaultTaskTitle ? ` · ${s.defaultTaskTitle}` : ' · 未关联'}${b.live ? ' · 进行中' : ''}`,
    );
  };

  return (
    <div className="insight-block">
      <div className="insight-block-head">
        <h2>单次专注质量</h2>
        <span className="sub">珠大小 = 有效时长 · 深度 = 专注率 · 红弧 = 暂停占比 · 点击展开</span>
      </div>
      <canvas
        ref={ref}
        className="beads-canvas"
        style={{ height }}
        onMouseMove={onMove}
        onMouseLeave={() => setReadout('')}
        onClick={(e) => {
          const b = hitBead(e);
          if (b && onOpenSession) onOpenSession(b.session.id);
        }}
      />
      <div className="chart-readout">{readout}</div>
      <div className="insight-footnote">
        口径：专注率 = 有效专注 ÷（有效专注 + 暂停），不含会话间空白；虚线圈 = 进行中。
      </div>
    </div>
  );
}

/* ── ④ 时间去向：马赛克 + 精确行 ──────────────────────────── */

const MOSAIC_COLORS = [
  '--app-success',
  '--app-accent',
  '--app-warning',
  '--app-success-deep',
  '--app-subtle',
];

function TaskMosaicBlock({
  analytics,
  totalActive,
}: {
  analytics: SessionAnalyticsResult | null;
  totalActive: number;
}) {
  const tasks = useMemo(
    () => (analytics?.tasks ?? []).slice().sort((a, b) => b.activeMs - a.activeMs),
    [analytics],
  );
  const total = Math.max(1, totalActive);
  const shown = tasks.slice(0, 8);
  const rest = tasks.slice(8);
  const restMs = rest.reduce((a, t) => a + t.activeMs, 0);

  return (
    <div className="insight-block">
      <div className="insight-block-head">
        <h2>时间去向</h2>
        <span className="sub">按任务 · 含未关联</span>
      </div>
      <div className="mosaic" role="img" aria-label="任务时间占比马赛克">
        {shown.map((t, i) => (
          <div
            key={t.key}
            className="mosaic-seg"
            title={`${t.title} ${Math.round((t.activeMs / total) * 100)}%`}
            style={{
              width: `${(t.activeMs / total) * 100}%`,
              background: t.taskId
                ? `rgb(var(${MOSAIC_COLORS[i % MOSAIC_COLORS.length]}))`
                : 'rgb(var(--app-border-strong))',
              opacity: t.taskId ? 0.55 + 0.45 * (1 - i / Math.max(1, shown.length)) : 0.75,
            }}
          />
        ))}
        {restMs > 0 && (
          <div
            className="mosaic-seg"
            style={{ width: `${(restMs / total) * 100}%`, background: 'rgb(var(--app-border))' }}
          />
        )}
      </div>
      <div style={{ height: 14 }} />
      <div className="alloc-head">
        <span>#</span>
        <span>任务</span>
        <span>比例</span>
        <span style={{ textAlign: 'right' }}>时长</span>
        <span style={{ textAlign: 'right' }}>占比</span>
        <span style={{ textAlign: 'right' }}>次数</span>
      </div>
      {shown.map((t, i) => (
        <div className={`alloc-row${t.taskId ? '' : ' unlinked'}`} key={t.key}>
          <span className="idx">{String(i + 1).padStart(2, '0')}</span>
          <span className="nm">{t.title}</span>
          <span>
            <span
              className={`bar${t.taskId ? '' : ' gray'}`}
              style={{ width: `${Math.max(1, (t.activeMs / total) * 100)}%` }}
            />
          </span>
          <span className="tr">{cn(t.activeMs)}</span>
          <span className="tr">{Math.round((t.activeMs / total) * 100)}%</span>
          <span className="tr">{t.segmentCount}</span>
        </div>
      ))}
      {rest.length > 0 && (
        <div className="alloc-row">
          <span className="idx">…</span>
          <span className="nm" style={{ color: 'rgb(var(--app-subtle))' }}>
            另有 {rest.length} 个任务
          </span>
          <span />
          <span className="tr" style={{ color: 'rgb(var(--app-subtle))' }}>
            {cn(restMs)}
          </span>
          <span className="tr" style={{ color: 'rgb(var(--app-subtle))' }}>
            {Math.round((restMs / total) * 100)}%
          </span>
          <span />
        </div>
      )}
      <div className="insight-footnote">
        口径：有效专注时长（不含暂停）；未关联时间作为明确类别列出，不隐藏。
      </div>
    </div>
  );
}
