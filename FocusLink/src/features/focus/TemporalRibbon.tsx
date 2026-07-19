// 时间之带：刻度本身就是进度。
// 颜色进度充满整个刻度区域（专注=强调色实体、暂停=红色斜纹、未发生=中性灰、未来=暗灰），
// 秒/分钟刻度绘制在颜色区域之上；指针固定，世界逐秒擒纵步进；
// 专注=秒级近景，暂停/空闲=30 分钟远景，切换是 720ms 对数变焦而非换图。
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [viewMode, setViewMode] = useState<'auto' | 'near' | 'far'>('auto');

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

  const targetScale =
    viewMode === 'near'
      ? BAND_SCALE_NEAR
      : viewMode === 'far'
        ? BAND_SCALE_FAR
        : bandScaleForState(state);
  const isMicro = targetScale === BAND_SCALE_NEAR;

  useEffect(() => {
    const engine = engineRef.current;
    const target = targetScale;
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
  }, [targetScale, reducedMotion]);

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
        <span className="ribbon-live-clock" aria-label="当前精确时间">
          {new Date(now).toLocaleTimeString('zh-CN', { hour12: false })}
        </span>
        <span className="ribbon-view-switch" aria-label="时间之带视野">
          <button
            type="button"
            className={isMicro ? 'active' : ''}
            onClick={() => setViewMode('near')}
            aria-pressed={isMicro}
          >
            近景
          </button>
          <button
            type="button"
            className={!isMicro ? 'active' : ''}
            onClick={() => setViewMode('far')}
            aria-pressed={!isMicro}
          >
            远景
          </button>
          {viewMode !== 'auto' && (
            <button type="button" className="ribbon-auto" onClick={() => setViewMode('auto')}>
              跟随状态
            </button>
          )}
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
  const fieldTop = 28;
  const fieldBottom = H - 30;
  const fieldH = fieldBottom - fieldTop;
  // 未发生时间：中性灰仪表槽，纵向明暗让它像一块刻蚀材料而不是空白矩形。
  const baseGradient = ctx.createLinearGradient(0, fieldTop, 0, fieldBottom);
  baseGradient.addColorStop(0, `rgba(${surface2},0.72)`);
  baseGradient.addColorStop(0.12, `rgba(${surface2},1)`);
  baseGradient.addColorStop(0.88, `rgba(${surface2},0.9)`);
  baseGradient.addColorStop(1, `rgba(${ink},0.075)`);
  ctx.fillStyle = baseGradient;
  ctx.fillRect(0, fieldTop, W, fieldH);
  ctx.fillStyle = `rgba(${ink},0.12)`;
  ctx.fillRect(0, fieldTop, W, 1);
  ctx.fillRect(0, fieldBottom - 1, W, 1);
  const t0 = tDisp - px / scale;
  const t1 = tDisp + (W - px) / scale;

  // 已发生片段：专注使用有纵深的实色材料，暂停使用双向刻纹。
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
      const focusGradient = ctx.createLinearGradient(0, fieldTop, 0, fieldBottom);
      focusGradient.addColorStop(0, `rgba(${focusC},0.96)`);
      focusGradient.addColorStop(0.48, `rgba(${focusC},0.82)`);
      focusGradient.addColorStop(1, `rgba(${focusDeep},0.88)`);
      ctx.fillStyle = focusGradient;
      ctx.fillRect(x0, fieldTop, x1 - x0, fieldH);
      ctx.fillStyle = `rgba(${focusDeep},1)`;
      ctx.fillRect(x0, fieldTop, x1 - x0, 1.5);
      ctx.fillStyle = `rgba(255,255,255,0.16)`;
      ctx.fillRect(x0, fieldTop + 2, x1 - x0, 1);
      // 秒级近景中，每一秒既是刻度也是一个可触摸的进度单元。
      if (scale >= 3.2) {
        const firstSecond = Math.max(Math.floor(t0), Math.floor(m.startedAt / 1000));
        const lastSecond = Math.min(Math.ceil(t1), Math.ceil(endMs / 1000));
        ctx.fillStyle = `rgba(${ink},0.105)`;
        for (let second = firstSecond; second <= lastSecond; second += 1) {
          const cellX = X(second * 1000);
          if (cellX >= x0 && cellX <= x1) ctx.fillRect(cellX, fieldTop, 0.65, fieldH);
        }
      }
      if (!m.endedAt) ctx.fillRect(x1 - 2, fieldTop, 2, fieldH);
    } else {
      ctx.fillStyle = `rgba(${pauseC},0.19)`;
      ctx.fillRect(x0, fieldTop, x1 - x0, fieldH);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, fieldTop, x1 - x0, fieldH);
      ctx.clip();
      ctx.strokeStyle = `rgba(${pauseC},0.58)`;
      ctx.lineWidth = 1.15;
      for (let d = x0 - fieldH; d < x1 + fieldH; d += 8) {
        ctx.beginPath();
        ctx.moveTo(d, fieldBottom);
        ctx.lineTo(d + fieldH, fieldTop);
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(${pauseC},0.16)`;
      for (let d = x0; d < x1 + fieldH; d += 16) {
        ctx.beginPath();
        ctx.moveTo(d, fieldTop);
        ctx.lineTo(d + fieldH, fieldBottom);
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

  // 仪表槽内部的两条发丝基准线统一专注、暂停和未来区域的材质。
  ctx.fillStyle = `rgba(${ink},0.075)`;
  ctx.fillRect(0, fieldTop + fieldH / 3, W, 0.6);
  ctx.fillRect(0, fieldTop + (fieldH * 2) / 3, W, 0.6);

  // —— 刻度绘制在颜色区域之上 ——
  ctx.textAlign = 'center';
  if (nearA > 0.02) {
    for (let t = Math.floor(t0) - 1; t <= t1 + 1; t += 1) {
      const x = X(t * 1000);
      if (x < -1 || x > W + 1) continue;
      const fut = t > tDisp;
      const major = t % 60 === 0;
      const mid = t % 5 === 0;
      const h = major ? fieldH : mid ? Math.min(24, fieldH * 0.42) : Math.min(13, fieldH * 0.24);
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
      ctx.lineTo(x, fieldTop + (major ? fieldH : Math.min(22, fieldH * 0.38)));
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
  ctx.fillStyle = `rgba(${ink},0.16)`;
  ctx.fillRect(px - 3, fieldTop, 6, fieldH);
  ctx.fillStyle = `rgba(${ink},1)`;
  ctx.fillRect(px - 0.75, 6, 1.5, H - 44);
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

    // 时间消逝粒子：从“现在”向已经发生的方向散落并逐步消失。
    // 暂停时固定为红色，专注时跟随全局强调色；位置由时间决定，不创建对象。
    if (!input.reducedMotion) {
      const particleColor = input.state === 'paused' ? pauseC : focusC;
      const phase = performance.now() / 1000;
      for (let index = 0; index < 22; index += 1) {
        const life = (((phase * 0.72 + index * 0.137) % 1) + 1) % 1;
        const seed = Math.sin(index * 91.73) * 43758.5453;
        const random = seed - Math.floor(seed);
        const driftX = 5 + life * (18 + random * 34);
        const driftY = Math.sin(index * 2.13 + phase * 2.1) * (3 + life * 11);
        const radius = Math.max(0.35, (1 - life) * (1.7 + random));
        ctx.fillStyle = `rgba(${particleColor},${(1 - life) * 0.72})`;
        ctx.beginPath();
        ctx.arc(px - driftX, fieldTop + fieldH / 2 + driftY, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function clockLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export { BAND_SCALE_FAR, BAND_SCALE_NEAR };
