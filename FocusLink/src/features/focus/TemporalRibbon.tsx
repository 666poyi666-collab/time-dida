// 时间之带：时间材料、刻度与进度是同一个物体。
// 运行时世界只在秒边界做一次擒纵步进；暂停时红色材料在真实前沿打孔、断裂、剥落。
// 近景是秒级精密尺，远景是 30 分钟总览；暂停远景保留一枚贴着前沿的秒级侵蚀观察窗。
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildMixedTimelineItems } from '@shared/focus/timeline';
import {
  BAND_PAUSE_MOTION_MS,
  BAND_POINTER_RATIO,
  BAND_RUNNING_MOTION_MS,
  BAND_SCALE_FAR,
  BAND_SCALE_NEAR,
  BAND_ZOOM_MS,
  bandDetailMix,
  bandDisplaySeconds,
  bandEventPhaseMs,
  bandEventSecond,
  bandScaleForState,
  easeInOutQuart,
  interpolateZoomScale,
  macroTickAlpha,
  pauseErosionHoleCount,
  pauseErosionParticles,
  secondTickAlpha,
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
};

type BandColors = {
  ink: string;
  text: string;
  focus: string;
  focusDeep: string;
  focusSoft: string;
  pause: string;
  pauseSoft: string;
  muted: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  borderStrong: string;
};

type ActivePause = {
  materialStart: number;
  end: number;
  elapsedMs: number;
};

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
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
      }).map((moment) => ({
        id: moment.id,
        type: moment.type,
        startedAt: moment.startedAt,
        endedAt: moment.endedAt,
      })),
    [now, snapshot?.currentSegmentId, snapshot?.pauseEvents, snapshot?.segments, state],
  );
  const dataRef = useRef(moments);
  dataRef.current = moments;
  const renderRevision = moments
    .map((moment) => `${moment.id}:${moment.type}:${moment.startedAt}:${moment.endedAt ?? 'open'}`)
    .join('|');
  const lastRecordedAt = moments.reduce(
    (latest, moment) => Math.max(latest, moment.endedAt ?? moment.startedAt),
    0,
  );
  const live = state === 'running' || state === 'paused';

  const stateRef = useRef(state);
  stateRef.current = state;
  const pauseStartedRef = useRef(snapshot?.currentPauseStartedAt ?? null);
  pauseStartedRef.current = snapshot?.currentPauseStartedAt ?? null;
  const anchorRef = useRef(now);
  useEffect(() => {
    if (live) {
      anchorRef.current = now;
      return;
    }
    if (lastRecordedAt > 0) anchorRef.current = lastRecordedAt;
  }, [lastRecordedAt, live, now]);

  const targetScale =
    viewMode === 'near'
      ? BAND_SCALE_NEAR
      : viewMode === 'far'
        ? BAND_SCALE_FAR
        : bandScaleForState(state);
  const isNear = targetScale === BAND_SCALE_NEAR;
  const pauseElapsedMs =
    state === 'paused' && snapshot?.currentPauseStartedAt
      ? Math.max(0, now - snapshot.currentPauseStartedAt)
      : 0;

  useEffect(() => {
    const engine = engineRef.current;
    if (Math.abs(targetScale - engine.scale) < 1e-6 && !engine.zoom) return;
    if (reducedMotion) {
      engine.scale = targetScale;
      engine.zoom = null;
      return;
    }
    engine.zoom = {
      from: engine.scale,
      to: targetScale,
      start: performance.now(),
      duration: BAND_ZOOM_MS,
    };
  }, [reducedMotion, targetScale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let wakeTimer: number | null = null;
    let disposed = false;

    const resize = () => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (
        width > 0 &&
        height > 0 &&
        (canvas.width !== pixelWidth || canvas.height !== pixelHeight)
      ) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      canvas.dataset.pixelRatio = String(dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const schedule = () => {
      if (disposed || raf !== 0) return;
      if (wakeTimer !== null) {
        window.clearTimeout(wakeTimer);
        wakeTimer = null;
      }
      raf = requestAnimationFrame(draw);
    };

    const wakeAtNextSecond = () => {
      if (disposed || wakeTimer !== null) return;
      const phase = bandEventPhaseMs(stateRef.current, Date.now(), pauseStartedRef.current);
      const delay = Math.max(12, 1002 - phase);
      wakeTimer = window.setTimeout(() => {
        wakeTimer = null;
        schedule();
      }, delay);
    };

    const draw = () => {
      raf = 0;
      if (disposed) return;
      resize();
      renderBand(ctx, canvas, engineRef.current, {
        moments: dataRef.current,
        state: stateRef.current,
        pauseStartedAt: pauseStartedRef.current,
        nowMs:
          stateRef.current === 'running' || stateRef.current === 'paused'
            ? Date.now()
            : anchorRef.current,
        anchorMs: anchorRef.current,
        reducedMotion,
      });

      const currentState = stateRef.current;
      const live = currentState === 'running' || currentState === 'paused';
      const motionWindow =
        currentState === 'paused' ? BAND_PAUSE_MOTION_MS : BAND_RUNNING_MOTION_MS;
      const pulseAge = bandEventPhaseMs(currentState, Date.now(), pauseStartedRef.current);
      if (
        engineRef.current.zoom ||
        (live && !reducedMotion && pulseAge >= 0 && pulseAge < motionWindow)
      ) {
        schedule();
      } else if (live) {
        wakeAtNextSecond();
      }
    };

    const observer = new ResizeObserver(() => {
      resize();
      schedule();
    });
    const themeObserver = new MutationObserver(schedule);
    observer.observe(canvas);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    resize();
    schedule();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (wakeTimer !== null) window.clearTimeout(wakeTimer);
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, [reducedMotion, renderRevision, state, targetScale]);

  const viewDescription = isNear
    ? '秒级近景 · 每格 1 秒 · 分钟主刻'
    : state === 'paused'
      ? '30 分钟总览 · 前沿保留秒级侵蚀窗'
      : '30 分钟总览 · 每格 5 分钟';
  const clockAt = live ? now : lastRecordedAt || now;
  const clockLabel = live ? '当前精确时间' : lastRecordedAt > 0 ? '最后记录时间' : '待机时间锚点';

  return (
    <figure
      className="temporal-ribbon"
      data-state={state}
      data-scale={isNear ? 'seconds' : 'minutes'}
      data-view-mode={viewMode}
      data-motion={state === 'running' || state === 'paused' ? 'second-locked' : 'frozen'}
      data-erosion={state === 'paused' ? 'front-bound' : 'none'}
    >
      <div className="ribbon-caption">
        <span className="ribbon-title">时间之带</span>
        <span className="ribbon-legend">{viewDescription}</span>
        <span className="ribbon-live-clock" aria-label={clockLabel}>
          {state === 'paused' ? `损耗 ${formatElapsedSeconds(pauseElapsedMs)}` : null}
          {state === 'paused' ? ' · ' : null}
          {!live ? (lastRecordedAt > 0 ? '最后记录 · ' : '待机 · ') : null}
          {new Date(clockAt).toLocaleTimeString('zh-CN', { hour12: false })}
        </span>
        <span className="ribbon-view-switch" aria-label="时间之带视野">
          <button
            type="button"
            className={isNear ? 'active' : ''}
            onClick={() => setViewMode('near')}
            aria-pressed={isNear}
            title="放大到秒级精密刻度"
          >
            近景
          </button>
          <button
            type="button"
            className={!isNear ? 'active' : ''}
            onClick={() => setViewMode('far')}
            aria-pressed={!isNear}
            title="拉远查看 30 分钟节律"
          >
            远景
          </button>
          {viewMode !== 'auto' && (
            <button type="button" className="ribbon-auto" onClick={() => setViewMode('auto')}>
              跟随状态
            </button>
          )}
        </span>
        <span className="ribbon-scale-tag">
          {isNear ? '1 格 = 1 秒' : state === 'paused' ? '总览 + 秒级细看' : '1 大格 = 30 分钟'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="ribbon-canvas"
        role="img"
        aria-label={`本次专注的时间之带，当前${state === 'paused' ? `暂停损耗 ${formatElapsedSeconds(pauseElapsedMs)}` : state === 'running' ? '专注进行中' : '静止待机'}，${viewDescription}`}
      />
    </figure>
  );
}

/* ─── Canvas 渲染内核：每一层都有状态语义，不做无意义常驻漂移 ─── */

function renderBand(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  engine: BandEngine,
  input: {
    moments: Moment[];
    state: TimerState;
    pauseStartedAt: number | null;
    nowMs: number;
    anchorMs: number;
    reducedMotion: boolean;
  },
): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return;

  const css = getComputedStyle(document.documentElement);
  const raw = (name: string) => css.getPropertyValue(name).trim();
  const rgb = (name: string) => raw(name).split(/\s+/).slice(0, 3).join(',');
  const colors: BandColors = {
    ink: rgb('--app-ink'),
    text: rgb('--app-text'),
    focus: rgb('--app-success'),
    focusDeep: rgb('--app-success-deep'),
    focusSoft: rgb('--app-success-soft'),
    pause: rgb('--app-pause'),
    pauseSoft: rgb('--app-pause-soft'),
    muted: rgb('--app-subtle'),
    surface: rgb('--app-surface'),
    surface2: rgb('--app-surface-2'),
    surface3: rgb('--app-surface-3'),
    border: rgb('--app-border'),
    borderStrong: rgb('--app-border-strong'),
  };
  const fontNumber = `10px ${raw('--font-number') || 'monospace'}`;
  const fontSmallNumber = `9px ${raw('--font-number') || 'monospace'}`;
  const fontUi = `600 10px ${raw('--font-ui') || 'sans-serif'}`;

  let zoomEnergy = 0;
  if (engine.zoom) {
    const progress = Math.min(1, (performance.now() - engine.zoom.start) / engine.zoom.duration);
    const eased = easeInOutQuart(progress);
    engine.scale = interpolateZoomScale(engine.zoom.from, engine.zoom.to, eased);
    zoomEnergy = Math.sin(progress * Math.PI);
    if (progress >= 1) {
      engine.scale = engine.zoom.to;
      engine.zoom = null;
    }
  }

  const scale = engine.scale;
  const detail = bandDetailMix(scale);
  const pointerX = width * BAND_POINTER_RATIO;
  const live = input.state === 'running' || input.state === 'paused';
  const wholeSecond = bandEventSecond(input.state, input.nowMs, input.pauseStartedAt);
  if (live && wholeSecond !== engine.lastSecond) {
    engine.lastSecond = wholeSecond;
  }
  const pulseAge = bandEventPhaseMs(input.state, input.nowMs, input.pauseStartedAt);
  const displaySeconds = bandDisplaySeconds(
    input.state,
    input.nowMs,
    input.anchorMs,
    input.reducedMotion,
  );
  const toX = (ms: number) => (ms / 1000 - displaySeconds) * scale + pointerX;

  ctx.clearRect(0, 0, width, height);
  const nearAlpha = secondTickAlpha(scale);
  const farAlpha = macroTickAlpha(scale);
  const farFieldHeight = clamp(height * 0.54, 62, 160);
  const nearFieldHeight = clamp(height * 0.72, 82, 224);
  const fieldHeight = lerp(farFieldHeight, nearFieldHeight, detail);
  const fieldTop = Math.max(24, (height - fieldHeight) / 2 - 1);
  const fieldBottom = Math.min(height - 25, fieldTop + fieldHeight);
  const actualFieldHeight = fieldBottom - fieldTop;
  const visibleStart = displaySeconds - pointerX / scale;
  const visibleEnd = displaySeconds + (width - pointerX) / scale;

  drawLocalIllumination(ctx, {
    pointerX,
    fieldTop,
    fieldBottom,
    state: input.state,
    pulseAge,
    zoomEnergy,
    colors,
  });
  drawMaterialBed(ctx, {
    width,
    fieldTop,
    fieldBottom,
    detail,
    zoomEnergy,
    colors,
  });

  let activePause: ActivePause | null = null;
  for (const moment of input.moments) {
    let endMs = moment.endedAt;
    if (!endMs) {
      endMs =
        moment.type === 'focus' && input.state === 'paused' && input.pauseStartedAt
          ? input.pauseStartedAt
          : input.nowMs;
    }
    const startX = toX(moment.startedAt);
    const endX = Math.min(toX(endMs), pointerX);
    const currentPause = moment.type === 'pause' && !moment.endedAt && input.state === 'paused';
    if (endX < -2 || startX > width + 2 || (endX - startX < 0.25 && !currentPause)) {
      continue;
    }

    if (moment.type === 'focus') {
      drawFocusMaterial(ctx, {
        startX,
        endX,
        fieldTop,
        fieldBottom,
        scale,
        visibleStart,
        visibleEnd,
        toX,
        colors,
      });
    } else {
      const elapsedMs = currentPause
        ? Math.max(0, input.nowMs - (input.pauseStartedAt ?? moment.startedAt))
        : 0;
      drawPauseMaterial(ctx, {
        startX,
        endX,
        fieldTop,
        fieldBottom,
        current: currentPause,
        colors,
      });
      if (currentPause) {
        activePause = {
          materialStart: Math.max(0, startX),
          end: endX,
          elapsedMs,
        };
      }
    }
  }

  // “未来”压暗但不盖掉刻度床；指针右侧因此与已经发生的材料清晰分离。
  const futureShade = ctx.createLinearGradient(pointerX, 0, width, 0);
  futureShade.addColorStop(0, `rgba(${colors.ink},0.045)`);
  futureShade.addColorStop(1, `rgba(${colors.ink},0.085)`);
  ctx.fillStyle = futureShade;
  ctx.fillRect(pointerX, fieldTop, width - pointerX, actualFieldHeight);

  if (activePause) {
    drawPausePerforation(ctx, {
      ...activePause,
      fieldTop,
      fieldBottom,
      colors,
    });
  }

  drawIntegratedTicks(ctx, {
    width,
    fieldTop,
    fieldBottom,
    displaySeconds,
    visibleStart,
    visibleEnd,
    toX,
    nearAlpha,
    farAlpha,
    colors,
    fontNumber,
    fontSmallNumber,
  });

  if (farAlpha > 0.45) {
    drawMomentAnchors(ctx, {
      moments: input.moments,
      toX,
      pointerX,
      width,
      fieldBottom,
      alpha: farAlpha,
      colors,
      fontNumber,
    });
  }

  if (input.state === 'running') {
    drawRunningFrontier(ctx, {
      pointerX,
      scale,
      fieldTop,
      fieldBottom,
      eventSecond: wholeSecond,
      pulseAge,
      reducedMotion: input.reducedMotion,
      colors,
    });
  } else if (input.state === 'paused' && activePause) {
    drawPauseErosion(ctx, {
      ...activePause,
      pointerX,
      width,
      fieldTop,
      fieldBottom,
      farAlpha,
      pulseAge,
      reducedMotion: input.reducedMotion,
      colors,
      fontNumber,
      fontUi,
    });
  }

  drawNowPointer(ctx, {
    pointerX,
    height,
    fieldTop,
    fieldBottom,
    state: input.state,
    pulseAge,
    reducedMotion: input.reducedMotion,
    colors,
    fontUi,
    label: live ? '现在' : input.moments.length > 0 ? '最后记录' : '待机',
  });
}

function drawLocalIllumination(
  ctx: CanvasRenderingContext2D,
  input: {
    pointerX: number;
    fieldTop: number;
    fieldBottom: number;
    state: TimerState;
    pulseAge: number;
    zoomEnergy: number;
    colors: BandColors;
  },
): void {
  if (input.state !== 'running' && input.state !== 'paused' && input.zoomEnergy <= 0) return;
  const color = input.state === 'paused' ? input.colors.pause : input.colors.focus;
  const tickWindow = input.state === 'paused' ? BAND_PAUSE_MOTION_MS : BAND_RUNNING_MOTION_MS;
  const tick = Math.max(0, 1 - input.pulseAge / tickWindow);
  const radius = 66 + tick * 24 + input.zoomEnergy * 34;
  const centerY = (input.fieldTop + input.fieldBottom) / 2;
  const glow = ctx.createRadialGradient(
    input.pointerX,
    centerY,
    0,
    input.pointerX,
    centerY,
    radius,
  );
  glow.addColorStop(0, `rgba(${color},${0.055 + tick * 0.055})`);
  glow.addColorStop(0.45, `rgba(${color},${0.025 + input.zoomEnergy * 0.025})`);
  glow.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(
    input.pointerX - radius,
    input.fieldTop - 18,
    radius * 2,
    input.fieldBottom - input.fieldTop + 36,
  );
}

function drawMaterialBed(
  ctx: CanvasRenderingContext2D,
  input: {
    width: number;
    fieldTop: number;
    fieldBottom: number;
    detail: number;
    zoomEnergy: number;
    colors: BandColors;
  },
): void {
  const fieldHeight = input.fieldBottom - input.fieldTop;
  ctx.save();
  ctx.shadowColor = `rgba(${input.colors.ink},${0.08 + input.zoomEnergy * 0.035})`;
  ctx.shadowBlur = 13 + input.zoomEnergy * 8;
  ctx.shadowOffsetY = 5;
  const bed = ctx.createLinearGradient(0, input.fieldTop, 0, input.fieldBottom);
  bed.addColorStop(0, `rgba(${input.colors.surface3},0.88)`);
  bed.addColorStop(0.045, `rgba(${input.colors.surface2},1)`);
  bed.addColorStop(0.52, `rgba(${input.colors.surface},0.96)`);
  bed.addColorStop(0.955, `rgba(${input.colors.surface2},0.98)`);
  bed.addColorStop(1, `rgba(${input.colors.ink},0.14)`);
  ctx.fillStyle = bed;
  ctx.fillRect(0, input.fieldTop, input.width, fieldHeight);
  ctx.restore();

  // 实体边缘与三条导轨让所有状态共享同一块材料，不再像叠在背景上的独立进度条。
  ctx.fillStyle = `rgba(${input.colors.borderStrong},0.9)`;
  ctx.fillRect(0, input.fieldTop, input.width, 1);
  ctx.fillRect(0, input.fieldBottom - 1, input.width, 1);
  ctx.fillStyle = `rgba(${input.colors.ink},${0.045 + input.detail * 0.025})`;
  for (const ratio of [0.25, 0.5, 0.75]) {
    ctx.fillRect(0, input.fieldTop + fieldHeight * ratio, input.width, 0.6);
  }

  // 静态微纹理：种子不依赖时间，所以 idle / finished 的位图可以严格冻结。
  ctx.fillStyle = `rgba(${input.colors.ink},0.026)`;
  for (let index = 0; index < 26; index += 1) {
    const x = hash01(index * 17.37) * input.width;
    const y = input.fieldTop + 3 + hash01(index * 31.91) * Math.max(1, fieldHeight - 6);
    const length = 4 + hash01(index * 47.13) * 18;
    ctx.fillRect(x, y, length, 0.5);
  }
}

function drawFocusMaterial(
  ctx: CanvasRenderingContext2D,
  input: {
    startX: number;
    endX: number;
    fieldTop: number;
    fieldBottom: number;
    scale: number;
    visibleStart: number;
    visibleEnd: number;
    toX: (ms: number) => number;
    colors: BandColors;
  },
): void {
  const width = input.endX - input.startX;
  if (width <= 0) return;
  const fieldHeight = input.fieldBottom - input.fieldTop;
  const material = ctx.createLinearGradient(0, input.fieldTop, 0, input.fieldBottom);
  material.addColorStop(0, `rgba(${input.colors.focusDeep},0.98)`);
  material.addColorStop(0.055, `rgba(${input.colors.focus},0.96)`);
  material.addColorStop(0.54, `rgba(${input.colors.focus},0.83)`);
  material.addColorStop(0.94, `rgba(${input.colors.focusDeep},0.9)`);
  material.addColorStop(1, `rgba(${input.colors.ink},0.18)`);
  ctx.fillStyle = material;
  ctx.fillRect(input.startX, input.fieldTop, width, fieldHeight);

  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(input.startX, input.fieldTop + 1.5, width, 1);
  ctx.fillStyle = `rgba(${input.colors.focusDeep},0.54)`;
  ctx.fillRect(input.startX, input.fieldBottom - 2, width, 1);

  // 近景每一秒都是时间材料上的真实切槽，而不是材料下方另一条进度。
  if (input.scale >= 3.2) {
    const first = Math.max(Math.floor(input.visibleStart), Math.floor(input.visibleStart));
    const last = Math.ceil(input.visibleEnd);
    ctx.fillStyle = `rgba(${input.colors.ink},0.11)`;
    for (let second = first; second <= last; second += 1) {
      const x = input.toX(second * 1000);
      if (x >= input.startX && x <= input.endX) {
        ctx.fillRect(x, input.fieldTop + 1, 0.7, fieldHeight - 2);
      }
    }
  }
}

function drawPauseMaterial(
  ctx: CanvasRenderingContext2D,
  input: {
    startX: number;
    endX: number;
    fieldTop: number;
    fieldBottom: number;
    current: boolean;
    colors: BandColors;
  },
): void {
  const width = Math.max(input.current ? 1.25 : 0, input.endX - input.startX);
  if (width <= 0) return;
  const startX = input.current ? Math.min(input.startX, input.endX - 1.25) : input.startX;
  const material = ctx.createLinearGradient(startX, 0, input.endX, 0);
  material.addColorStop(0, `rgba(${input.colors.pause},${input.current ? 0.27 : 0.18})`);
  material.addColorStop(0.72, `rgba(${input.colors.pause},${input.current ? 0.5 : 0.28})`);
  material.addColorStop(1, `rgba(${input.colors.pause},${input.current ? 0.82 : 0.42})`);
  ctx.fillStyle = material;
  ctx.fillRect(startX, input.fieldTop, input.endX - startX, input.fieldBottom - input.fieldTop);

  ctx.save();
  ctx.beginPath();
  ctx.rect(startX, input.fieldTop, input.endX - startX, input.fieldBottom - input.fieldTop);
  ctx.clip();
  ctx.strokeStyle = `rgba(${input.colors.pause},${input.current ? 0.82 : 0.56})`;
  ctx.lineWidth = 1;
  const fieldHeight = input.fieldBottom - input.fieldTop;
  for (let diagonal = startX - fieldHeight; diagonal < input.endX + fieldHeight; diagonal += 9) {
    ctx.beginPath();
    ctx.moveTo(diagonal, input.fieldBottom);
    ctx.lineTo(diagonal + fieldHeight, input.fieldTop);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPausePerforation(
  ctx: CanvasRenderingContext2D,
  input: ActivePause & {
    fieldTop: number;
    fieldBottom: number;
    colors: BandColors;
  },
): void {
  const materialWidth = Math.max(0, input.end - input.materialStart);
  if (materialWidth < 0.75) return;
  const fieldHeight = input.fieldBottom - input.fieldTop;
  const holeCount = pauseErosionHoleCount(input.elapsedMs);
  const erosionWidth = Math.min(materialWidth, 58);
  ctx.save();
  ctx.beginPath();
  ctx.rect(input.end - erosionWidth, input.fieldTop, erosionWidth, fieldHeight);
  ctx.clip();
  for (let index = 0; index < holeCount; index += 1) {
    const xSeed = hash01(index * 7.13 + 1.9);
    const ySeed = hash01(index * 17.9 + 4.7);
    const radius = 0.65 + hash01(index * 23.1 + 8.3) * (index % 5 === 0 ? 2.2 : 1.15);
    const x = input.end - 0.7 - xSeed * Math.max(0.5, erosionWidth - 1.4);
    const y = input.fieldTop + 3 + ySeed * Math.max(1, fieldHeight - 6);
    ctx.fillStyle = `rgba(${input.colors.surface2},${0.68 + ySeed * 0.22})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawIntegratedTicks(
  ctx: CanvasRenderingContext2D,
  input: {
    width: number;
    fieldTop: number;
    fieldBottom: number;
    displaySeconds: number;
    visibleStart: number;
    visibleEnd: number;
    toX: (ms: number) => number;
    nearAlpha: number;
    farAlpha: number;
    colors: BandColors;
    fontNumber: string;
    fontSmallNumber: string;
  },
): void {
  const fieldHeight = input.fieldBottom - input.fieldTop;
  ctx.textAlign = 'center';

  if (input.nearAlpha > 0.02) {
    for (
      let second = Math.floor(input.visibleStart) - 1;
      second <= input.visibleEnd + 1;
      second += 1
    ) {
      const x = input.toX(second * 1000);
      if (x < -1 || x > input.width + 1) continue;
      const future = second > input.displaySeconds;
      const minute = positiveMod(second, 60) === 0;
      const fiveSecond = positiveMod(second, 5) === 0;
      const topLength = minute
        ? fieldHeight
        : fiveSecond
          ? Math.min(27, fieldHeight * 0.36)
          : Math.min(14, fieldHeight * 0.18);
      const alpha = (future ? 0.3 : minute ? 0.86 : fiveSecond ? 0.62 : 0.42) * input.nearAlpha;
      drawEtchedTick(ctx, x, input.fieldTop, topLength, alpha, minute ? 1.35 : 0.85, input.colors);

      if (fiveSecond && !minute && input.nearAlpha > 0.55) {
        ctx.fillStyle = `rgba(${input.colors.muted},${0.72 * input.nearAlpha})`;
        ctx.font = input.fontSmallNumber;
        ctx.fillText(
          `:${String(positiveMod(second, 60)).padStart(2, '0')}`,
          x,
          input.fieldBottom + 13,
        );
      }
      if (minute) {
        ctx.fillStyle = `rgba(${input.colors.text},${(future ? 0.52 : 0.9) * input.nearAlpha})`;
        ctx.font = input.fontNumber;
        ctx.fillText(clockLabel(second * 1000), x, input.fieldTop - 10);
      }
    }
  }

  if (input.farAlpha > 0.02) {
    const firstTick = Math.floor(input.visibleStart / 300) * 300;
    for (let second = firstTick; second <= input.visibleEnd + 300; second += 300) {
      const x = input.toX(second * 1000);
      if (x < -1 || x > input.width + 1) continue;
      const future = second > input.displaySeconds;
      const major = positiveMod(second, 1800) === 0;
      const tenMinute = positiveMod(second, 600) === 0;
      const length = major
        ? fieldHeight
        : tenMinute
          ? Math.min(31, fieldHeight * 0.34)
          : Math.min(19, fieldHeight * 0.22);
      const alpha = (future ? 0.3 : major ? 0.86 : tenMinute ? 0.6 : 0.48) * input.farAlpha;
      drawEtchedTick(ctx, x, input.fieldTop, length, alpha, major ? 1.35 : 0.9, input.colors);

      if (major) {
        ctx.fillStyle = `rgba(${input.colors.text},${(future ? 0.5 : 0.9) * input.farAlpha})`;
        ctx.font = input.fontNumber;
        ctx.fillText(clockLabel(second * 1000), x, input.fieldTop - 10);
      } else if (tenMinute && input.farAlpha > 0.62) {
        ctx.fillStyle = `rgba(${input.colors.muted},${0.7 * input.farAlpha})`;
        ctx.font = input.fontSmallNumber;
        ctx.fillText(clockLabel(second * 1000), x, input.fieldBottom + 13);
      }
    }
  }
}

function drawEtchedTick(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  length: number,
  alpha: number,
  width: number,
  colors: BandColors,
): void {
  ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.24, alpha * 0.26)})`;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x + 0.7, top + 1);
  ctx.lineTo(x + 0.7, top + length + 1);
  ctx.stroke();
  ctx.strokeStyle = `rgba(${colors.ink},${alpha})`;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, top + length);
  ctx.stroke();
}

function drawMomentAnchors(
  ctx: CanvasRenderingContext2D,
  input: {
    moments: Moment[];
    toX: (ms: number) => number;
    pointerX: number;
    width: number;
    fieldBottom: number;
    alpha: number;
    colors: BandColors;
    fontNumber: string;
  },
): void {
  let lastLabelX = -1e9;
  for (const moment of input.moments) {
    const x = input.toX(moment.startedAt);
    if (
      x < 24 ||
      x > input.width - 36 ||
      x - lastLabelX < 62 ||
      Math.abs(x - input.pointerX) < 48
    ) {
      continue;
    }
    ctx.fillStyle = `rgba(${input.colors.muted},${0.78 * input.alpha})`;
    ctx.font = input.fontNumber;
    ctx.textAlign = 'left';
    ctx.fillText(clockLabel(moment.startedAt), x + 5, input.fieldBottom + 15);
    ctx.textAlign = 'center';
    lastLabelX = x;
  }
}

function drawRunningFrontier(
  ctx: CanvasRenderingContext2D,
  input: {
    pointerX: number;
    scale: number;
    fieldTop: number;
    fieldBottom: number;
    eventSecond: number;
    pulseAge: number;
    reducedMotion: boolean;
    colors: BandColors;
  },
): void {
  const fieldHeight = input.fieldBottom - input.fieldTop;
  const cellWidth = Math.max(2, Math.min(18, input.scale));

  // 静态前沿是实体边缘；每秒只在 420ms 窗口内释放一次扫掠，此后完全静止。
  const edge = ctx.createLinearGradient(input.pointerX - 13, 0, input.pointerX + 2, 0);
  edge.addColorStop(0, `rgba(${input.colors.focus},0)`);
  edge.addColorStop(0.7, `rgba(${input.colors.focus},0.12)`);
  edge.addColorStop(1, `rgba(${input.colors.focusDeep},0.82)`);
  ctx.fillStyle = edge;
  ctx.fillRect(input.pointerX - 13, input.fieldTop, 15, fieldHeight);

  if (input.reducedMotion || input.pulseAge >= BAND_RUNNING_MOTION_MS) return;
  const phase = clamp(input.pulseAge / BAND_RUNNING_MOTION_MS, 0, 1);
  const sweep = easeInOutQuart(Math.min(1, phase * 1.22));
  const sweepX = input.pointerX - cellWidth + cellWidth * sweep;
  const beam = ctx.createLinearGradient(sweepX - 8, 0, sweepX + 5, 0);
  beam.addColorStop(0, `rgba(${input.colors.focus},0)`);
  beam.addColorStop(0.62, `rgba(255,255,255,${0.2 * (1 - phase)})`);
  beam.addColorStop(1, `rgba(${input.colors.focus},0)`);
  ctx.fillStyle = beam;
  ctx.fillRect(sweepX - 8, input.fieldTop + 1, 13, fieldHeight - 2);

  ctx.fillStyle = `rgba(${input.colors.focus},${0.46 * (1 - phase)})`;
  for (let index = 0; index < 5; index += 1) {
    const seed = input.eventSecond * 0.713 + index * 19.71 + 7.3;
    const x = input.pointerX - cellWidth * (0.15 + hash01(seed) * 0.8) - phase * (2 + index * 0.5);
    const y = input.fieldTop + 5 + hash01(seed + 9.7) * Math.max(1, fieldHeight - 10);
    const size = Math.max(0.35, (1 - phase) * (0.7 + hash01(seed + 15.1) * 0.8));
    ctx.fillRect(x, y, size, size);
  }
}

function drawPauseErosion(
  ctx: CanvasRenderingContext2D,
  input: ActivePause & {
    pointerX: number;
    width: number;
    fieldTop: number;
    fieldBottom: number;
    farAlpha: number;
    pulseAge: number;
    reducedMotion: boolean;
    colors: BandColors;
    fontNumber: string;
    fontUi: string;
  },
): void {
  const fieldHeight = input.fieldBottom - input.fieldTop;
  const materialWidth = Math.max(0.75, input.end - input.materialStart);

  // 远景中主时间轴保持真实比例；这枚明确标注的观察窗只放大最后 12 秒的材料细节。
  if (input.farAlpha > 0.04) {
    const alpha = Math.min(1, input.farAlpha * 1.12);
    const lensWidth = clamp(input.width * 0.11, 92, 144);
    const lensHeight = clamp(fieldHeight * 0.46, 32, 66);
    const lensX = input.pointerX - lensWidth;
    const lensY = input.fieldTop + fieldHeight - lensHeight - 8;
    const lensHeaderHeight = clamp(lensHeight * 0.3, 15, 19);
    const materialTop = lensY + lensHeaderHeight;
    const materialHeight = lensHeight - lensHeaderHeight;
    const cellWidth = lensWidth / 12;
    const pausedSeconds = Math.min(12, Math.max(0, input.elapsedMs / 1000));
    const pausedWidth = pausedSeconds * cellWidth;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgba(${input.colors.surface2},0.94)`;
    ctx.fillRect(lensX, lensY, lensWidth, lensHeight);
    const lensMaterial = ctx.createLinearGradient(lensX, 0, input.pointerX, 0);
    lensMaterial.addColorStop(0, `rgba(${input.colors.pause},0.25)`);
    lensMaterial.addColorStop(1, `rgba(${input.colors.pause},0.78)`);
    ctx.fillStyle = lensMaterial;
    ctx.fillRect(input.pointerX - pausedWidth, materialTop, pausedWidth, materialHeight);

    // 铭牌与材料舱分层：读数永远稳定，红色侵蚀不会盖住标签。
    ctx.fillStyle = `rgba(${input.colors.surface2},0.98)`;
    ctx.fillRect(lensX, lensY, lensWidth, lensHeaderHeight);
    ctx.strokeStyle = `rgba(${input.colors.borderStrong},0.72)`;
    ctx.beginPath();
    ctx.moveTo(lensX, materialTop + 0.5);
    ctx.lineTo(input.pointerX, materialTop + 0.5);
    ctx.stroke();

    ctx.strokeStyle = `rgba(${input.colors.borderStrong},0.86)`;
    ctx.lineWidth = 1;
    ctx.strokeRect(lensX + 0.5, lensY + 0.5, lensWidth - 1, lensHeight - 1);
    ctx.strokeStyle = `rgba(${input.colors.pause},0.68)`;
    ctx.beginPath();
    ctx.moveTo(lensX, lensY);
    ctx.lineTo(input.pointerX, lensY);
    ctx.stroke();

    for (let second = 0; second <= 12; second += 1) {
      const x = lensX + second * cellWidth;
      ctx.strokeStyle = `rgba(${input.colors.ink},${second % 5 === 0 ? 0.48 : 0.24})`;
      ctx.beginPath();
      ctx.moveTo(x, materialTop + 1);
      ctx.lineTo(x, materialTop + (second % 5 === 0 ? materialHeight - 1 : materialHeight * 0.42));
      ctx.stroke();
    }

    const holeCount = pauseErosionHoleCount(input.elapsedMs);
    ctx.save();
    ctx.beginPath();
    ctx.rect(input.pointerX - pausedWidth, materialTop, pausedWidth, materialHeight);
    ctx.clip();
    for (let index = 0; index < holeCount; index += 1) {
      const x = input.pointerX - 1 - hash01(index * 7.13 + 1.9) * Math.max(1, pausedWidth - 2);
      const y = materialTop + 3 + hash01(index * 17.9 + 4.7) * Math.max(1, materialHeight - 6);
      const radius = 0.75 + hash01(index * 23.1 + 8.3) * (index % 5 === 0 ? 2.35 : 1.2);
      ctx.fillStyle = `rgba(${input.colors.surface2},0.88)`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = `rgba(${input.colors.pause},0.94)`;
    ctx.font = input.fontUi;
    ctx.textAlign = 'left';
    ctx.fillText(`侵蚀 ${formatElapsedSeconds(input.elapsedMs)}`, lensX + 7, lensY + 12);
    ctx.fillStyle = `rgba(${input.colors.muted},0.82)`;
    ctx.font = input.fontNumber;
    ctx.textAlign = 'right';
    ctx.fillText('12s', input.pointerX - 6, lensY + 12);
    ctx.restore();
  }

  const particles = pauseErosionParticles(input.elapsedMs, materialWidth, input.reducedMotion);
  for (const particle of particles) {
    const originX = input.end - particle.originOffsetX;
    const originY = input.fieldTop + particle.originRatioY * fieldHeight;
    ctx.save();
    ctx.translate(originX - particle.travelX, originY + particle.travelY);
    ctx.rotate(particle.rotation);
    ctx.fillStyle = `rgba(${input.colors.pause},${particle.alpha})`;
    if (particle.kind === 'shard') {
      const size = particle.size;
      ctx.beginPath();
      ctx.moveTo(-size * 0.72, -size * 0.32);
      ctx.lineTo(size * 0.66, -size * 0.58);
      ctx.lineTo(size * 0.48, size * 0.72);
      ctx.lineTo(-size * 0.42, size * 0.48);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
    }
    ctx.restore();
  }

  // 红色前沿不是呼吸灯；每秒侵蚀窗口内增强一次，随后固定在警戒亮度。
  const phase = input.reducedMotion ? 1 : Math.min(1, input.pulseAge / BAND_PAUSE_MOTION_MS);
  const edgeAlpha = 0.68 + (1 - phase) * 0.28;
  ctx.fillStyle = `rgba(${input.colors.pause},${edgeAlpha})`;
  ctx.fillRect(input.end - 2.4, input.fieldTop, 2.4, fieldHeight);
}

function drawNowPointer(
  ctx: CanvasRenderingContext2D,
  input: {
    pointerX: number;
    height: number;
    fieldTop: number;
    fieldBottom: number;
    state: TimerState;
    pulseAge: number;
    reducedMotion: boolean;
    colors: BandColors;
    fontUi: string;
    label: '现在' | '最后记录' | '待机';
  },
): void {
  const stateColor = input.state === 'paused' ? input.colors.pause : input.colors.focus;
  const active = input.state === 'running' || input.state === 'paused';
  const motionWindow = input.state === 'paused' ? BAND_PAUSE_MOTION_MS : BAND_RUNNING_MOTION_MS;
  const phase = active ? Math.min(1, input.pulseAge / motionWindow) : 1;

  ctx.fillStyle = `rgba(${input.colors.ink},0.14)`;
  ctx.fillRect(input.pointerX - 3.5, input.fieldTop, 7, input.fieldBottom - input.fieldTop);
  ctx.fillStyle = `rgba(${input.colors.ink},0.94)`;
  ctx.fillRect(input.pointerX - 0.7, 6, 1.4, input.fieldBottom - 5);

  if (active) {
    ctx.fillStyle = `rgba(${stateColor},${0.74 + (1 - phase) * 0.22})`;
    ctx.fillRect(input.pointerX - 1.4, input.fieldTop, 2.8, input.fieldBottom - input.fieldTop);
    ctx.beginPath();
    ctx.arc(input.pointerX, input.fieldTop - 9, 3.1, 0, Math.PI * 2);
    ctx.fill();

    if (!input.reducedMotion && phase < 1) {
      ctx.strokeStyle = `rgba(${stateColor},${(1 - phase) * 0.46})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(input.pointerX, input.fieldTop - 9, 5 + phase * 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.fillStyle = active ? `rgba(${stateColor},0.96)` : `rgba(${input.colors.ink},0.82)`;
  ctx.beginPath();
  ctx.moveTo(input.pointerX - 5.5, input.fieldBottom + 2);
  ctx.lineTo(input.pointerX + 5.5, input.fieldBottom + 2);
  ctx.lineTo(input.pointerX, input.fieldBottom + 8);
  ctx.closePath();
  ctx.fill();
  ctx.font = input.fontUi;
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(${input.colors.text},0.86)`;
  ctx.fillText(input.label, input.pointerX, Math.min(input.height - 7, input.fieldBottom + 22));
}

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function positiveMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function formatElapsedSeconds(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function clockLabel(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export { BAND_SCALE_FAR, BAND_SCALE_NEAR };
