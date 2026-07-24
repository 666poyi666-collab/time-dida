import { useEffect, useRef } from 'react';
import type {
  LiveFocusTimelinePause,
  LiveFocusTimelineSegment,
} from '@shared/sync/liveFocusProtocol';
import { particleCellHash } from '@shared/focus/bandMath';
import type { LiveFocusPhase } from './runtimeModel';

export interface MobileTemporalRibbonProps {
  state: LiveFocusPhase;
  startedAt: number | null;
  segments: readonly LiveFocusTimelineSegment[];
  pauses: readonly LiveFocusTimelinePause[];
  now: number;
  activeElapsedMs: number;
  wallElapsedMs: number;
}

/** A compact, responsive rendering of the same wall-clock material used on desktop. */
export function MobileTemporalRibbon({
  state,
  startedAt,
  segments,
  pauses,
  now,
  activeElapsedMs,
  wallElapsedMs,
}: MobileTemporalRibbonProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wakeRef = useRef<() => void>(() => undefined);
  const dataRef = useRef({
    state,
    startedAt,
    segments,
    pauses,
    now,
    activeElapsedMs,
    wallElapsedMs,
  });
  dataRef.current = {
    state,
    startedAt,
    segments,
    pauses,
    now,
    activeElapsedMs,
    wallElapsedMs,
  };

  useEffect(() => {
    wakeRef.current();
  }, [state, startedAt, segments, pauses, now, activeElapsedMs, wallElapsedMs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let disposed = false;
    let lastFrameAt = 0;

    const draw = (frameAt = 0) => {
      raf = 0;
      if (disposed) return;
      const animated =
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
        dataRef.current.state !== 'idle';
      if (animated && frameAt - lastFrameAt < 1000 / 30) {
        raf = requestAnimationFrame(draw);
        return;
      }
      lastFrameAt = frameAt;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRibbon(ctx, width, height, dataRef.current);
      if (animated) {
        raf = requestAnimationFrame(draw);
      }
    };
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(draw);
    };
    wakeRef.current = schedule;
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    media.addEventListener('change', schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      media.removeEventListener('change', schedule);
      wakeRef.current = () => undefined;
    };
  }, []);

  const stateLabel = state === 'paused' ? '暂停' : state === 'running' ? '专注' : '待开始';
  return (
    <div className={`mobile-temporal-ribbon state-${state}`}>
      <div className="mobile-ribbon-heading">
        <span>时间之带</span>
        <small>{state === 'paused' ? '红色残迹正在消散' : '完整时间段留痕'}</small>
      </div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${stateLabel}时间带：累计专注 ${formatDuration(activeElapsedMs)}，总历时 ${formatDuration(wallElapsedMs)}，保留 ${segments.length} 段专注与 ${pauses.length} 段暂停`}
      />
    </div>
  );
}

function drawRibbon(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: MobileTemporalRibbonProps,
): void {
  const root = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
  const focus = color('--focus', '#0b9f78');
  const pause = color('--pause', '#d94b43');
  const muted = color('--muted', '#7e8790');
  const border = color('--border', '#d8dbd7');
  const surface = color('--canvas', '#f3f4f1');
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = surface;
  ctx.fillRect(0, 0, width, height);
  const top = 12;
  const bottom = height - 16;
  const fieldHeight = Math.max(20, bottom - top);
  ctx.fillStyle = border;
  ctx.globalAlpha = 0.8;
  ctx.fillRect(0, bottom - 1, width, 1);
  ctx.globalAlpha = 1;

  const sessionOrigin = input.startedAt ?? input.now - input.wallElapsedMs;
  const wallNow = input.state === 'idle' ? sessionOrigin + input.wallElapsedMs : input.now;
  const elapsedSpanMs = Math.max(0, wallNow - sessionOrigin);
  const spanMs = clamp(elapsedSpanMs * 1.12, 60_000, 30 * 60_000);
  const origin = elapsedSpanMs > spanMs ? wallNow - spanMs : sessionOrigin;
  const left = 8;
  const right = width - 8;
  const toX = (time: number) => left + clamp((time - origin) / spanMs, 0, 1) * (right - left);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionSeconds = reduced ? 0 : input.now / 1_000;

  drawTimeGrid(ctx, left, right, top, bottom, origin, spanMs, muted, wallNow);

  for (const segment of input.segments) {
    const end = segment.endedAt ?? wallNow;
    drawInterval(
      ctx,
      toX(segment.startedAt),
      toX(end),
      top,
      fieldHeight,
      focus,
      motionSeconds,
      reduced,
      1,
    );
  }
  for (const pauseItem of input.pauses) {
    const end = pauseItem.endedAt ?? wallNow;
    drawInterval(
      ctx,
      toX(pauseItem.startedAt),
      toX(end),
      top,
      fieldHeight,
      pause,
      motionSeconds,
      reduced,
      0.82,
    );
  }
  if (input.state !== 'idle') {
    const x = toX(wallNow);
    ctx.strokeStyle = input.state === 'paused' ? pause : focus;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(x, top - 3);
    ctx.lineTo(x, bottom + 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawTimeGrid(
  ctx: CanvasRenderingContext2D,
  left: number,
  right: number,
  top: number,
  bottom: number,
  origin: number,
  spanMs: number,
  muted: string,
  wallNow: number,
): void {
  const tickMs = spanMs <= 2 * 60_000 ? 10_000 : spanMs <= 10 * 60_000 ? 60_000 : 5 * 60_000;
  ctx.strokeStyle = muted;
  ctx.fillStyle = muted;
  ctx.font = '9px sans-serif';
  ctx.globalAlpha = 0.24;
  for (let tick = 0; tick <= spanMs; tick += tickMs) {
    const x = left + (tick / spanMs) * (right - left);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, top);
    ctx.lineTo(Math.round(x) + 0.5, bottom);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.76;
  ctx.textAlign = 'left';
  ctx.fillText(formatClock(origin), left, bottom + 12);
  ctx.textAlign = 'right';
  ctx.fillText(formatClock(Math.min(origin + spanMs, wallNow)), right, bottom + 12);
  ctx.globalAlpha = 1;
}

function drawInterval(
  ctx: CanvasRenderingContext2D,
  startX: number,
  endX: number,
  top: number,
  height: number,
  baseColor: string,
  motionSeconds: number,
  reduced: boolean,
  density: number,
): void {
  if (endX <= startX) return;
  const width = endX - startX;
  const columns = Math.max(8, Math.ceil(width / 3.2));
  const rows = Math.max(8, Math.ceil(height / 4));
  for (let column = 0; column <= columns; column += 1) {
    const progress = column / columns;
    const edge = Math.min(progress, 1 - progress);
    const edgeMix = smoothstep(edge * 10);
    const pulse = 0.72 + particleCellHash(column + 81, Math.round(startX)) * 0.28;
    for (let row = -2; row <= rows + 2; row += 1) {
      const presence = particleCellHash(column + Math.round(startX), row + Math.round(endX));
      const outside = row < 0 || row > rows;
      const envelope = outside ? edgeMix * 0.28 : 0.56 + edgeMix * 0.44;
      if (presence > density * pulse * envelope) continue;
      const phase = particleCellHash(column + 17, row + 331) * Math.PI * 2;
      const life = reduced ? 0 : (motionSeconds * 0.8 + phase) % 1;
      const drift = reduced ? 0 : Math.sin(motionSeconds * 0.9 + phase) * 1.4;
      const x = startX + progress * width + drift;
      const y = top + ((row + 0.5) / rows) * height + (outside ? (row < 0 ? -5 : 5) : 0);
      const fade = 0.24 + edgeMix * 0.66;
      const alpha = baseColor.includes('rgb') ? fade : fade;
      ctx.fillStyle = baseColor;
      ctx.globalAlpha =
        alpha * (0.82 + presence * 0.18) * (baseColor === 'var(--pause)' ? 0.86 : 1);
      const size = Math.max(1, 1.2 + particleCellHash(column + 701, row + 19) * 1.45 - life * 0.35);
      if (presence > 0.86) {
        ctx.beginPath();
        ctx.arc(x, y, size * 0.52, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
