// 时间之带：时间材料、刻度与进度是同一个物体。
// 运行时世界只在秒边界做一次擒纵步进；暂停时间不形成实体色块，只在真实前沿碎裂并消散。
// 近景是秒级精密尺，远景是 30 分钟总览；两种镜头共用同一条刻度与同一片粒子场。
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildMixedTimelineItems } from '@shared/focus/timeline';
import {
  BAND_PAUSE_MOTION_MS,
  BAND_POINTER_RATIO,
  BAND_RUNNING_MOTION_MS,
  BAND_SCALE_FAR,
  BAND_SCALE_NEAR,
  BAND_ZOOM_MS,
  PARTICLE_FIELD_PAUSE_DENSITY,
  bandDetailMix,
  bandDisplaySeconds,
  bandEventPhaseMs,
  bandEventSecond,
  bandScaleForState,
  easeInOutQuart,
  fieldParticleSpec,
  interpolateZoomScale,
  macroTickAlpha,
  mixRgb,
  particleAgedColor,
  particleAshColor,
  particleCellHash,
  particleFieldParams,
  particleFieldStepSec,
  particleToneColor,
  particleTraceFade,
  pauseDissolveParticles,
  secondTickAlpha,
  traceResidueDot,
} from '@shared/focus/bandMath';
import type { RgbTuple } from '@shared/focus/bandMath';
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

type MomentKind = 'focus' | 'pause';

type ParticlePalette = {
  base: RgbTuple;
  deep: RgbTuple;
  soft: RgbTuple;
  ash: RgbTuple;
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
      ? '30 分钟总览 · 前沿按秒粒子消散'
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
      data-dissolve={state === 'paused' ? 'particle-field' : 'none'}
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
          {isNear ? '1 格 = 1 秒' : state === 'paused' ? '粒子随秒消散' : '1 大格 = 30 分钟'}
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

  // 粒子场调色板：专注/暂停各三档色 + 褪向主题灰的灰烬色，全部从 CSS 变量派生。
  const tuple = (value: string): RgbTuple => {
    const [r = 0, g = 0, b = 0] = value.split(',').map((part) => Number(part.trim()));
    return [r, g, b];
  };
  const mutedTuple = tuple(colors.muted);
  const focusBase = tuple(colors.focus);
  const pauseBase = tuple(colors.pause);
  const particlePalettes: Record<MomentKind, ParticlePalette> = {
    focus: {
      base: focusBase,
      deep: tuple(colors.focusDeep),
      soft: tuple(colors.focusSoft),
      ash: particleAshColor(focusBase, mutedTuple),
    },
    pause: {
      base: pauseBase,
      deep: mixRgb(pauseBase, tuple(colors.ink), 0.3),
      soft: tuple(colors.pauseSoft),
      ash: particleAshColor(pauseBase, mutedTuple),
    },
  };

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

    const kind: MomentKind = moment.type;
    const tint = kind === 'pause' ? colors.pause : colors.focus;
    drawMomentTrace(ctx, {
      startX,
      endX,
      fieldTop,
      fieldBottom,
      pointerX,
      scrollPx: displaySeconds * scale,
      viewportWidth: width,
      scale,
      tint,
    });
    drawMomentParticleField(ctx, {
      startSec: moment.startedAt / 1000,
      endSec: endMs / 1000,
      displaySeconds,
      visibleStart,
      visibleEnd,
      pointerX,
      viewportWidth: width,
      scale,
      fieldTop,
      fieldBottom,
      palette: particlePalettes[kind],
      densityScale: kind === 'pause' ? PARTICLE_FIELD_PAUSE_DENSITY : 1,
      timeSec: displaySeconds,
      reducedMotion: input.reducedMotion,
    });
    if (kind === 'pause') {
      const elapsedMs = currentPause
        ? Math.max(0, input.nowMs - (input.pauseStartedAt ?? moment.startedAt))
        : 0;
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

  // 暂停粒子绘制在材料层之上、刻度层之下，避免遮挡可读的时间数字。
  if (input.state === 'paused' && activePause) {
    drawPauseDissolve(ctx, {
      ...activePause,
      fieldTop,
      fieldBottom,
      pulseAge,
      reducedMotion: input.reducedMotion,
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

/**
 * 痕迹层：粒子消散后留下的渍痕。画在材料床之上、粒子场之下，
 * 全部锚定世界坐标并随时间轴平移/缩放，强度随距“现在”渐淡。
 */
function drawMomentTrace(
  ctx: CanvasRenderingContext2D,
  input: {
    startX: number;
    endX: number;
    fieldTop: number;
    fieldBottom: number;
    pointerX: number;
    scrollPx: number;
    viewportWidth: number;
    scale: number;
    tint: string;
  },
): void {
  const width = input.endX - input.startX;
  if (width <= 0) return;
  const fieldHeight = input.fieldBottom - input.fieldTop;
  const fadeAt = (x: number) =>
    particleTraceFade(input.pointerX - x, input.viewportWidth, input.scale);

  // 渐变底色：旧端（左）最淡，越接近“现在”越明显。
  const wash = ctx.createLinearGradient(input.startX, 0, input.endX, 0);
  wash.addColorStop(0, `rgba(${input.tint},${0.035 * fadeAt(input.startX)})`);
  wash.addColorStop(0.7, `rgba(${input.tint},${0.06 * fadeAt(input.startX + width * 0.7)})`);
  wash.addColorStop(1, `rgba(${input.tint},${0.1 * fadeAt(input.endX)})`);
  ctx.fillStyle = wash;
  ctx.fillRect(input.startX, input.fieldTop, width, fieldHeight);

  ctx.save();
  ctx.beginPath();
  ctx.rect(input.startX, input.fieldTop, width, fieldHeight);
  ctx.clip();

  // 幽灵斜纹：45°，锚定世界坐标（scrollPx 变化时斜纹随时间轴平移）。
  const hatchPhase = positiveMod(input.pointerX - input.scrollPx, 14);
  ctx.lineWidth = 2;
  const hatchStart =
    Math.floor((input.startX - input.fieldBottom - hatchPhase) / 14) * 14 + hatchPhase;
  for (let k = hatchStart; k < input.endX + input.fieldBottom; k += 14) {
    const midX = k - (input.fieldTop + input.fieldBottom) / 2;
    const alpha = 0.05 * fadeAt(midX);
    if (alpha <= 0.004) continue;
    ctx.strokeStyle = `rgba(${input.tint},${alpha})`;
    ctx.beginPath();
    ctx.moveTo(k - input.fieldBottom, input.fieldBottom);
    ctx.lineTo(k - input.fieldTop, input.fieldTop);
    ctx.stroke();
  }

  // 确定性残点：7px 世界网格，hash 决定 14% 出现率与透明度。
  const dotPhase = positiveMod(input.pointerX - input.scrollPx, 7);
  const dotStart = input.startX - positiveMod(input.startX - dotPhase, 7);
  for (let x = dotStart; x < input.endX; x += 7) {
    const cellX = Math.round((x - dotPhase) / 7);
    const fade = fadeAt(x);
    if (fade <= 0.05) continue;
    for (let y = input.fieldTop; y < input.fieldBottom; y += 7) {
      const cellY = Math.round((y - input.fieldTop) / 7);
      const dot = traceResidueDot(cellX, cellY);
      if (!dot.present) continue;
      ctx.fillStyle = `rgba(${input.tint},${dot.alpha * fade})`;
      ctx.fillRect(x + dot.offsetX, y + dot.offsetY, 1.3, 1.3);
    }
  }

  // 幽灵轮廓线：时间带上下边留下的印，透明度沿世界方向渐淡。
  const outline = ctx.createLinearGradient(input.startX, 0, input.endX, 0);
  outline.addColorStop(0, `rgba(${input.tint},${0.09 * fadeAt(input.startX)})`);
  outline.addColorStop(1, `rgba(${input.tint},${0.09 * fadeAt(input.endX)})`);
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(input.startX, input.fieldTop + 0.5);
  ctx.lineTo(input.endX, input.fieldTop + 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(input.startX, input.fieldBottom - 0.5);
  ctx.lineTo(input.endX, input.fieldBottom - 0.5);
  ctx.stroke();
  ctx.restore();
}

/**
 * 粒子场：整条过去的时间带都是锚定世界坐标的确定性粒子。
 * 紧贴“现在”几乎实心，随距离拉远密度/透明度衰减、垂直散开并轻微上浮，
 * 逐粒子按 deathK 稀疏死亡，颜色随年龄褪向灰烬色。
 * 运动相位来自 displaySeconds（与时间带相同的冻结时钟），非活动态像素级静止。
 */
function drawMomentParticleField(
  ctx: CanvasRenderingContext2D,
  input: {
    startSec: number;
    endSec: number;
    displaySeconds: number;
    visibleStart: number;
    visibleEnd: number;
    pointerX: number;
    viewportWidth: number;
    scale: number;
    fieldTop: number;
    fieldBottom: number;
    palette: ParticlePalette;
    densityScale: number;
    timeSec: number;
    reducedMotion: boolean;
  },
): void {
  const stepSec = particleFieldStepSec(input.scale);
  const cellPx = stepSec * input.scale;
  if (cellPx <= 0.5) return;
  // 粒子在指针前约 1 格停住，保持“现在”标线 crisp。
  const worldMin = Math.max(input.startSec, input.visibleStart);
  const worldMax = Math.min(input.endSec, input.visibleEnd, input.displaySeconds - stepSec);
  if (worldMax <= worldMin) return;

  const fieldHeight = input.fieldBottom - input.fieldTop;
  const rows = Math.max(1, Math.floor(fieldHeight / cellPx));
  const t = input.timeSec;
  const still = input.reducedMotion;

  for (let ix = Math.floor(worldMin / stepSec); ix * stepSec < worldMax; ix += 1) {
    const columnX = (ix * stepSec - input.displaySeconds) * input.scale + input.pointerX;
    if (columnX < -40 || columnX > input.viewportWidth + 40) continue;
    const params = particleFieldParams(
      input.pointerX - columnX,
      input.viewportWidth,
      input.scale,
    );
    const spawnProb = params.spawnProb * input.densityScale;

    for (let iy = 0; iy < rows; iy += 1) {
      if (particleCellHash(ix, iy) > spawnProb) continue;
      const spec = fieldParticleSpec(ix, iy);
      if (params.s > spec.deathK) continue;

      const worldSec = (ix + spec.offsetX) * stepSec;
      if (worldSec < worldMin || worldSec >= worldMax) continue;
      const screenX = (worldSec - input.displaySeconds) * input.scale + input.pointerX;
      if (screenX < -40 || screenX > input.viewportWidth + 40) continue;

      const baseY = input.fieldTop + (iy + spec.offsetY) * cellPx;
      const spread =
        spec.dir * params.scatter * (still ? 0.55 : 0.55 + 0.45 * Math.sin(t * 0.35 + spec.phase));
      const wobble = still ? 0 : Math.sin(t * 0.9 + spec.phase * 1.7) * 1.4;
      const y = baseY + spread + wobble - params.rise * spec.riseK;
      const flicker = still ? 1 : 0.78 + 0.22 * Math.sin(t * 2 + spec.phase * 3);
      const alpha = params.alpha * flicker;
      if (alpha <= 0.02) continue;

      const size = Math.max(1.2, cellPx * spec.sizeK) * (1 - params.s * 0.35);
      const rotation = spec.phase + (still ? 0 : Math.sin(t * 0.5 + spec.phase) * 0.3);
      const color = particleAgedColor(
        particleToneColor(spec.tone, input.palette.base, input.palette.deep, input.palette.soft),
        input.palette.ash,
        params.s,
      );

      ctx.save();
      ctx.translate(screenX, y);
      ctx.rotate(rotation);
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }
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

function drawDissolveParticleField(
  ctx: CanvasRenderingContext2D,
  input: {
    particles: ReturnType<typeof pauseDissolveParticles>;
    edgeX: number;
    fieldTop: number;
    fieldBottom: number;
    colors: BandColors;
    motionScale?: number;
    sizeScale?: number;
  },
): void {
  const fieldHeight = input.fieldBottom - input.fieldTop;
  const motionScale = input.motionScale ?? 1;
  const sizeScale = input.sizeScale ?? 1;

  for (const particle of input.particles) {
    if (particle.alpha <= 0.01) continue;
    const originX = input.edgeX - particle.originOffsetX;
    const originY = input.fieldTop + particle.originRatioY * fieldHeight;
    const x = originX + particle.travelX * motionScale;
    const y = originY + particle.travelY * motionScale;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(particle.rotation);

    const alpha = particle.alpha;
    const size = particle.size * sizeScale;
    const hot = particle.temperature;

    // 颜色随温度从白热余烬过渡到暗红灰烬。
    const r = Math.min(255, 210 + hot * 45);
    const g = Math.min(255, 60 + hot * 120);
    const b = Math.min(255, 40 + hot * 60);
    const fill = `rgba(${r},${g},${b},${alpha})`;
    const glow = `rgba(${r},${g},${b},${Math.min(0.85, alpha * 0.8)})`;

    ctx.shadowColor = glow;
    ctx.shadowBlur = particle.kind === 'spark' ? 6 : particle.kind === 'dust' ? 2 : 0.8;

    if (particle.kind === 'shard') {
      ctx.fillStyle = fill;
      ctx.strokeStyle = `rgba(${input.colors.ink},${alpha * 0.35})`;
      ctx.lineWidth = Math.max(0.5, size * 0.16);
      ctx.beginPath();
      ctx.moveTo(-size * 0.7, -size * 0.28);
      ctx.lineTo(size * 0.6, -size * 0.55);
      ctx.lineTo(size * 0.45, size * 0.7);
      ctx.lineTo(-size * 0.4, size * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (particle.kind === 'spark') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,${180 + hot * 55},${120 + hot * 80},${alpha})`;
      ctx.lineWidth = Math.max(0.5, size * 0.42);
      ctx.lineCap = 'round';
      // 火花短促，不拉成长线。
      const sparkLen = size * (1.2 + hot * 0.8);
      ctx.beginPath();
      ctx.moveTo(-sparkLen * 0.5, 0);
      ctx.lineTo(sparkLen * 0.5, 0);
      ctx.stroke();
    } else {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.55, 0, Math.PI * 2);
      ctx.fill();
      if (size > 1.1 && hot > 0.35) {
        ctx.fillStyle = `rgba(255,255,255,${alpha * hot * 0.4})`;
        ctx.beginPath();
        ctx.arc(-size * 0.1, -size * 0.1, size * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

function drawPauseDissolve(
  ctx: CanvasRenderingContext2D,
  input: ActivePause & {
    fieldTop: number;
    fieldBottom: number;
    pulseAge: number;
    reducedMotion: boolean;
    colors: BandColors;
  },
): void {
  const fieldHeight = input.fieldBottom - input.fieldTop;
  const sourceWidth = Math.min(42, Math.max(24, fieldHeight * 0.42));
  const fuseY = input.fieldTop + fieldHeight * 0.68;
  const visibleTrailStart = Math.min(input.materialStart, input.end - sourceWidth * 2.4);

  // 暗芯引线：已经过的路径是暗红灰烬，越接近“现在”越热。
  ctx.strokeStyle = `rgba(${input.colors.ink},0.22)`;
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(visibleTrailStart, fuseY);
  ctx.lineTo(input.end, fuseY);
  ctx.stroke();

  const char = ctx.createLinearGradient(visibleTrailStart, 0, input.end, 0);
  char.addColorStop(0, `rgba(${input.colors.pause},0.12)`);
  char.addColorStop(0.55, `rgba(${input.colors.pause},0.28)`);
  char.addColorStop(0.85, `rgba(${input.colors.pause},0.58)`);
  char.addColorStop(1, `rgba(${input.colors.pause},0.98)`);
  ctx.strokeStyle = char;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(visibleTrailStart, fuseY);
  ctx.lineTo(input.end, fuseY);
  ctx.stroke();

  // 固定燃烧头：紧贴引线的小核心 + 集中热边，不形成扩散圆环或竖直色墙。
  const headGlow = ctx.createRadialGradient(input.end, fuseY, 0, input.end, fuseY, 7);
  headGlow.addColorStop(0, 'rgba(255,255,255,0.9)');
  headGlow.addColorStop(0.22, `rgba(${input.colors.pause},0.52)`);
  headGlow.addColorStop(0.55, `rgba(${input.colors.pause},0.14)`);
  headGlow.addColorStop(1, `rgba(${input.colors.pause},0)`);
  ctx.fillStyle = headGlow;
  ctx.fillRect(input.end - 7, fuseY - 7, 14, 14);

  ctx.fillStyle = `rgba(255,255,255,0.95)`;
  ctx.beginPath();
  ctx.arc(input.end, fuseY, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(${input.colors.pause},0.98)`;
  ctx.beginPath();
  ctx.arc(input.end, fuseY, 2.6, 0, Math.PI * 2);
  ctx.fill();

  if (input.reducedMotion) {
    // reduced-motion：保留静态灰烬语义，不播放持续粒子。
    ctx.fillStyle = `rgba(${input.colors.pause},0.18)`;
    for (let index = 0; index < 12; index += 1) {
      const seed = input.elapsedMs * 0.001 + index * 17.7;
      const x = input.end - hash01(seed) * sourceWidth;
      const y = fuseY - 4 + hash01(seed + 8.4) * 8;
      ctx.fillRect(x, y, 1 + hash01(seed + 3.1), 1 + hash01(seed + 12.5));
    }
    return;
  }

  const particles = pauseDissolveParticles(input.elapsedMs, sourceWidth, false, 1);
  drawDissolveParticleField(ctx, {
    particles,
    edgeX: input.end,
    fieldTop: input.fieldTop,
    fieldBottom: input.fieldBottom,
    colors: input.colors,
  });
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
