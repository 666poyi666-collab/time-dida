// 时间之带：刻度本身就是进度。
// 颜色进度充满整个刻度区域（专注=强调色实体、暂停=红色斜纹、未发生=中性灰、未来=暗灰），
// 秒/分钟刻度绘制在颜色区域之上；指针固定，世界逐秒擒纵步进；
// 专注=秒级近景，暂停/空闲=30 分钟远景，切换是 720ms 对数变焦而非换图。
import { useEffect, useMemo, useRef } from 'react';
import { buildMixedTimelineItems } from '@shared/focus/timeline';
import {
  BAND_POINTER_RATIO,
  BAND_SCALE_FAR,
  BAND_SCALE_NEAR,
  BAND_ZOOM_MS,
  bandScaleForState,
  easeInOutQuart,
  interpolateZoomScale,
  macroTickAlpha,
  secondTickAlpha,
  steppedDisplaySeconds,
} from '@shared/focus/bandMath';
import type { TimerSnapshot, TimerState } from '@shared/types';

type Moment = {
  id: string;
  type: 'focus' | 'pause';
  startedAt: number;
  endedAt: number | null;
};

type BandEngine = {
  scale: number;
  zoom: { from: number; to: number; start: number; duration: number } | null;
  lastSecond: number;
  pulseAt: number;
};

function useReducedMotion(): boolean {
  const ref = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => {
      ref.current = media.matches;
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return ref.current;
}

export function TemporalRibbon({
  snapshot,
  state,
  now,
}: {
  snapshot: TimerSnapshot | null;
  state: TimerState;
  now: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BandEngine>({
    scale: bandScaleForState(state),
    zoom: null,
    lastSecond: -1,
    pulseAt: 0,
  });
  const reducedMotion = useReducedMotion();

  const moments: Moment[] = useMemo(
    () =>
      buildMixedTimelineItems({
        segments: snapshot?.segments ?? [],
        pauseEvents: snapshot?.pauseEvents ?? [],
        currentSegmentId: snapshot?.currentSegmentId ?? null,
        state,
        now,
      }).map((m) => ({
        id: m.id,
        type: m.type,
        startedAt: m.startedAt,
        endedAt: m.endedAt,
      })),
    [now, snapshot?.currentSegmentId, snapshot?.pauseEvents, snapshot?.segments, state],
  );
  const dataRef = useRef(moments);
  dataRef.current = moments;
  const stateRef = useRef(state);
  stateRef.current = state;
  const pauseStartedRef = useRef(snapshot?.currentPauseStartedAt ?? null);
  pauseStartedRef.current = snapshot?.currentPauseStartedAt ?? null;
  const nowRef = useRef(now);
  nowRef.current = now;

  const isMicro = state === 'running';

  useEffect(() => {
    const engine = engineRef.current;
    const target = bandScaleForState(state);
    const current = engine.scale;
    if (Math.abs(target - current) < 1e-6 && !engine.zoom) return;
    if (reducedMotion) {
      engine.scale = target;
      engine.zoom = null;
      return;
    }
    engine.zoom = {
      from: current,
      to: target,
      start: performance.now(),
      duration: BAND_ZOOM_MS,
    };
  }, [state, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let disposed = false;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w > 0 && h > 0 && (canvas.width !== w * dpr || canvas.height !== h * dpr)) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = () => {
      if (disposed) return;
      resize();
      renderBand(ctx, canvas, engineRef.current, {
        moments: dataRef.current,
        state: stateRef.current,
        pauseStartedAt: pauseStartedRef.current,
        nowMs: Date.now(),
        reducedMotion,
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [reducedMotion]);

  return (
    <figure
      className="temporal-ribbon"
      data-state={state}
      data-scale={isMicro ? 'seconds' : 'minutes'}
    >
      <div className="ribbon-caption">
        <span className="ribbon-title">时间之带</span>
        <span className="ribbon-legend">
          {isMicro
            ? '秒级近景 · 每小格 1 秒 · 每大格 1 分钟'
            : '远景 · 每小格 5 分钟 · 每大格 30 分钟'}
        </span>
        <span className="ribbon-scale-tag">{isMicro ? '1 小格 = 1 秒' : '1 大格 = 30 分钟'}</span>
      </div>
      <canvas
        ref={canvasRef}
        className="ribbon-canvas"
        role="img"
        aria-label={`本次专注的时间之带，当前${state === 'paused' ? '暂停' : state === 'running' ? '专注' : '待机'}`}
      />
    </figure>
  );
}

/* ─── 渲染内核（每帧全量重绘，元素数量恒定） ─── */

function renderBand(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  engine: BandEngine,
  input: {
    moments: Moment[];
    state: TimerState;
    pauseStartedAt: number | null;
    nowMs: number;
    reducedMotion: boolean;
  },
): void {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (W <= 0 || H <= 0) return;
  const css = getComputedStyle(document.documentElement);
  const raw = (name: string) => css.getPropertyValue(name).trim();
  // token 是 "R G B" 三元组，canvas 需要逗号分隔
  const rgb = (name: string) => raw(name).split(/\s+/).slice(0, 3).join(',');
  const ink = rgb('--app-ink');
  const focusC = rgb('--app-success');
  const focusDeep = rgb('--app-success-deep');
  const pauseC = rgb('--app-pause');
  const muted = rgb('--app-subtle');
  const surface2 = rgb('--app-surface-2');
  const fontNumber = `10px ${raw('--font-number') || 'monospace'}`;
  const fontUi = `600 10px ${raw('--font-ui') || 'sans-serif'}`;

  // 变焦推进
  if (engine.zoom) {
    const p = Math.min(1, (performance.now() - engine.zoom.start) / engine.zoom.duration);
    engine.scale = interpolateZoomScale(engine.zoom.from, engine.zoom.to, easeInOutQuart(p));
    if (p >= 1) {
      engine.scale = engine.zoom.to;
      engine.zoom = null;
    }
  }
  const scale = engine.scale;
  const px = W * BAND_POINTER_RATIO;
  const live = input.state === 'running' || input.state === 'paused';

  // 逐秒擒纵显示时间
  let tDisp: number;
  if (live) {
    tDisp = steppedDisplaySeconds(input.nowMs, input.reducedMotion);
  } else {
    tDisp = Math.floor(input.nowMs);
  }
  const wholeSecond = Math.floor(input.nowMs / 1000);
  if (live && wholeSecond !== engine.lastSecond) {
    engine.lastSecond = wholeSecond;
    engine.pulseAt = performance.now();
  }
  const X = (ms: number) => (ms / 1000 - tDisp) * scale + px;

  ctx.clearRect(0, 0, W, H);
  const nearA = secondTickAlpha(scale);
  const farA = macroTickAlpha(scale);

  // —— 刻度场即进度场 ——
  const fieldTop = 24;
  const fieldBottom = H - 26;
  const fieldH = fieldBottom - fieldTop;
  // 未发生时间：中性灰底
  ctx.fillStyle = `rgba(${surface2},1)`;
  ctx.fillRect(0, fieldTop, W, fieldH);
  ctx.fillStyle = `rgba(${ink},0.08)`;
  ctx.fillRect(0, fieldTop, W, 1);
  ctx.fillRect(0, fieldBottom - 1, W, 1);

  // 已发生片段：专注实体填充 + 暂停斜纹
  for (const m of input.moments) {
    let endMs = m.endedAt;
    if (!endMs) {
      endMs =
        m.type === 'focus' && input.state === 'paused' && input.pauseStartedAt
          ? input.pauseStartedAt
          : input.nowMs;
    }
    const x0 = X(m.startedAt);
    const x1 = Math.min(X(endMs), px);
    if (x1 < -2 || x0 > W + 2 || x1 - x0 < 0.3) continue;
    if (m.type === 'focus') {
      ctx.fillStyle = `rgba(${focusC},0.88)`;
      ctx.fillRect(x0, fieldTop, x1 - x0, fieldH);
      ctx.fillStyle = `rgba(${focusDeep},1)`;
      ctx.fillRect(x0, fieldTop, x1 - x0, 2);
      if (!m.endedAt) ctx.fillRect(x1 - 2, fieldTop, 2, fieldH);
    } else {
      ctx.fillStyle = `rgba(${pauseC},0.16)`;
      ctx.fillRect(x0, fieldTop, x1 - x0, fieldH);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, fieldTop, x1 - x0, fieldH);
      ctx.clip();
      ctx.strokeStyle = `rgba(${pauseC},0.55)`;
      ctx.lineWidth = 1.3;
      for (let d = x0 - fieldH; d < x1 + fieldH; d += 7) {
        ctx.beginPath();
        ctx.moveTo(d, fieldBottom);
        ctx.lineTo(d + fieldH, fieldTop);
        ctx.stroke();
      }
      ctx.restore();
      if (!m.endedAt) {
        ctx.fillStyle = `rgba(${pauseC},1)`;
        ctx.fillRect(x1 - 2, fieldTop, 2, fieldH);
      }
    }
  }

  // 未来时间：压暗灰（让“还没发生”一眼可辨）
  ctx.fillStyle = `rgba(${ink},0.05)`;
  ctx.fillRect(px, fieldTop, W - px, fieldH);

  // —— 刻度绘制在颜色区域之上 ——
  const t0 = tDisp - px / scale;
  const t1 = tDisp + (W - px) / scale;
  ctx.textAlign = 'center';
  if (nearA > 0.02) {
    for (let t = Math.floor(t0) - 1; t <= t1 + 1; t += 1) {
      const x = X(t * 1000);
      if (x < -1 || x > W + 1) continue;
      const fut = t > tDisp;
      const major = t % 60 === 0;
      const mid = t % 5 === 0;
      const h = major ? 26 : mid ? 16 : 9;
      ctx.strokeStyle = `rgba(${ink},${(fut ? 0.28 : major ? 0.8 : mid ? 0.6 : 0.42) * nearA})`;
      ctx.lineWidth = major ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(x, fieldTop);
      ctx.lineTo(x, fieldTop + h);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = `rgba(${muted},${(fut ? 0.5 : 0.95) * nearA})`;
        ctx.font = fontNumber;
        ctx.fillText(clockLabel(t * 1000), x, 16);
      }
    }
  }
  if (farA > 0.02) {
    for (let t = Math.floor(t0 / 300) * 300; t <= t1 + 300; t += 300) {
      const x = X(t * 1000);
      if (x < -1 || x > W + 1) continue;
      const fut = t > tDisp;
      const major = t % 1800 === 0;
      ctx.strokeStyle = `rgba(${ink},${(fut ? 0.28 : major ? 0.8 : 0.5) * farA})`;
      ctx.lineWidth = major ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(x, fieldTop);
      ctx.lineTo(x, fieldTop + (major ? 26 : 15));
      ctx.stroke();
      if (major) {
        ctx.fillStyle = `rgba(${muted},${(fut ? 0.5 : 0.95) * farA})`;
        ctx.font = fontNumber;
        ctx.fillText(clockLabel(t * 1000), x, 16);
      }
    }
  }

  // 片段起点锚点标签（远景、无碰撞）
  if (farA > 0.5) {
    let lastLabelX = -1e9;
    for (const m of input.moments) {
      const x = X(m.startedAt);
      if (x < 24 || x > W - 34 || x - lastLabelX < 52 || Math.abs(x - px) < 40) continue;
      ctx.fillStyle = `rgba(${muted},${0.9 * farA})`;
      ctx.font = fontNumber;
      ctx.textAlign = 'left';
      ctx.fillText(clockLabel(m.startedAt), x + 4, fieldBottom + 14);
      ctx.textAlign = 'center';
      lastLabelX = x;
    }
  }

  // —— 指针 + 秒脉冲 ——
  ctx.fillStyle = `rgba(${ink},1)`;
  ctx.fillRect(px - 1, 6, 2, H - 44);
  ctx.font = fontUi;
  ctx.textAlign = 'center';
  ctx.fillText('现在', px, H - 8);
  ctx.beginPath();
  ctx.moveTo(px - 5, H - 32);
  ctx.lineTo(px + 5, H - 32);
  ctx.lineTo(px, H - 26);
  ctx.fill();
  if (live) {
    const age = (performance.now() - engine.pulseAt) / 600;
    if (age < 1 && !input.reducedMotion) {
      ctx.globalAlpha = (1 - age) * 0.5;
      ctx.strokeStyle = `rgba(${input.state === 'running' ? focusC : pauseC},1)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, fieldTop - 10, 4 + age * 13, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = `rgba(${input.state === 'running' ? focusC : pauseC},1)`;
    ctx.beginPath();
    ctx.arc(px, fieldTop - 10, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function clockLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export { BAND_SCALE_FAR, BAND_SCALE_NEAR };
