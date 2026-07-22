// 时间之带：专注与暂停都按真实墙钟留下完整时段；材质本身由粒子构成。
// 绿色表达已经凝结的专注，红色以“残留底 + 短寿命活动层”持续表现时间消逝。
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BAND_PAUSE_MOTION_MS,
  BAND_POINTER_RATIO,
  BAND_RUNNING_MOTION_MS,
  BAND_SCALE_FAR,
  BAND_SCALE_NEAR,
  BAND_ZOOM_MS,
  POINTER_GLOW_MAX_ALPHA,
  bandDetailMix,
  bandScaleForState,
  easeInOutQuart,
  interpolateZoomScale,
  macroTickAlpha,
  mixRgb,
  particleAgedColor,
  particleAshColor,
  particleCellHash,
  particleDepthProfile,
  particleFieldFadeIn,
  particleToneColor,
  pointerBreathPulse,
  secondTickAlpha,
  steppedDisplaySeconds,
} from '@shared/focus/bandMath';
import type { RgbTuple } from '@shared/focus/bandMath';
import { getCumulativeActiveMs, getCurrentPauseDisplayMs } from '@shared/focus/selectors';
import { buildMixedTimelineItems } from '@shared/focus/timeline';
import type { TimelineItem } from '@shared/focus/timeline';
import type { TimerSnapshot, TimerState } from '@shared/types';

type BandEngine = {
  /** 当前业务会话；跨 session 时必须清空上一轮的暂停尾粒子。 */
  sessionId: string | null;
  scale: number;
  zoom: { from: number; to: number; start: number; duration: number } | null;
  lastSecond: number;
  /** 上一帧状态：用于识别材料淡入与暂停发射器的启停。 */
  prevState: TimerState | null;
  /** 专注实体淡入起始时间（performance.now 时间轴）。 */
  materialFadeStart: number | null;
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

type BandPaintStyle = {
  colors: BandColors;
  fontNumber: string;
  fontSmallNumber: string;
  fontUi: string;
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
    sessionId: snapshot?.sessionId ?? null,
    scale: bandScaleForState(state),
    zoom: null,
    lastSecond: -1,
    prevState: null,
    materialFadeStart: null,
  });
  const scheduleDrawRef = useRef<() => void>(() => undefined);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const stateRef = useRef(state);
  stateRef.current = state;
  const timelineItems = useMemo(
    () =>
      buildMixedTimelineItems({
        segments: snapshot?.segments ?? [],
        pauseEvents: snapshot?.pauseEvents ?? [],
        currentSegmentId: snapshot?.currentSegmentId ?? null,
        state,
        // 进行中区间的绘制终点始终使用当前帧墙钟；duration 不参与 Canvas 投影。
        now: 0,
      }),
    [snapshot?.segments, snapshot?.pauseEvents, snapshot?.currentSegmentId, state],
  );
  const timelineItemsRef = useRef(timelineItems);
  timelineItemsRef.current = timelineItems;

  const reducedMotion = useReducedMotion();
  const [viewMode, setViewMode] = useState<'auto' | 'near' | 'far'>('auto');

  // 暂停保持近景，确保完整粒子时段与正在消逝的活动层都清晰可读。
  const effectiveViewMode = state === 'paused' ? 'near' : viewMode;
  const targetScale =
    effectiveViewMode === 'near'
      ? BAND_SCALE_NEAR
      : effectiveViewMode === 'far'
        ? BAND_SCALE_FAR
        : bandScaleForState(state);
  const isNear = targetScale === BAND_SCALE_NEAR;
  const activeElapsedMs = getCumulativeActiveMs(snapshot, now);
  const pauseElapsedMs = getCurrentPauseDisplayMs(snapshot, now);
  const live = state === 'running' || state === 'paused';
  const hasRecordedTime =
    activeElapsedMs > 0 ||
    pauseElapsedMs > 0 ||
    (snapshot?.segments.length ?? 0) > 0 ||
    (snapshot?.pauseEvents.length ?? 0) > 0;

  // 只用真正影响场景投影的业务字段唤醒 Canvas。活动态的连续推进由 rAF 完成。
  const renderRevision = [
    snapshot?.sessionId ?? 'none',
    state,
    snapshot?.activeElapsedMs ?? 0,
    snapshot?.pauseElapsedMs ?? 0,
    snapshot?.currentPauseStartedAt ?? 'none',
    snapshot?.lastTick ?? 0,
    ...(snapshot?.segments.map(
      (segment) =>
        `${segment.id}:${segment.startedAt}:${segment.endedAt ?? 'open'}:${segment.activeElapsedMs}`,
    ) ?? []),
    ...(snapshot?.pauseEvents.map(
      (pause) => `${pause.id}:${pause.pauseStartedAt}:${pause.pauseEndedAt ?? 'open'}`,
    ) ?? []),
  ].join(':');

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
    const context = ctx;

    let raf = 0;
    let wakeTimer: number | null = null;
    let disposed = false;
    let paintStyle = readBandPaintStyle();
    const viewport = { width: 0, height: 0 };

    const resize = () => {
      // 2x 已足够保持文字和粒子锐利；3x 会把每帧填充像素放大到 2.25 倍。
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      viewport.width = width;
      viewport.height = height;
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
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const schedule = () => {
      if (disposed || raf !== 0) return;
      if (wakeTimer !== null) {
        window.clearTimeout(wakeTimer);
        wakeTimer = null;
      }
      raf = requestAnimationFrame(draw);
    };

    const wakeAtNextLiveSecond = () => {
      const currentState = stateRef.current;
      if (
        disposed ||
        wakeTimer !== null ||
        (currentState !== 'running' && currentState !== 'paused')
      )
        return;
      const delay = Math.max(16, 1002 - (Date.now() % 1000));
      wakeTimer = window.setTimeout(() => {
        wakeTimer = null;
        schedule();
      }, delay);
    };

    function draw() {
      raf = 0;
      if (disposed) return;

      const currentState = stateRef.current;
      const wallNowMs = Date.now();
      renderBand(context, engineRef.current, {
        snapshot: snapshotRef.current,
        state: currentState,
        nowMs: wallNowMs,
        reducedMotion,
        moments: timelineItemsRef.current,
        paintStyle,
        viewport,
      });

      if (
        !reducedMotion &&
        (currentState === 'running' ||
          currentState === 'paused' ||
          engineRef.current.zoom !== null ||
          engineRef.current.materialFadeStart !== null)
      ) {
        schedule();
      } else if (currentState === 'running' || currentState === 'paused') {
        // reduced-motion disables continuous material animation, not the live clock projection.
        wakeAtNextLiveSecond();
      }
    }

    const observer = new ResizeObserver(() => {
      resize();
      schedule();
    });
    const handleWindowResize = () => {
      resize();
      schedule();
    };
    const themeObserver = new MutationObserver(() => {
      paintStyle = readBandPaintStyle();
      schedule();
    });
    observer.observe(canvas);
    window.addEventListener('resize', handleWindowResize);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    resize();
    scheduleDrawRef.current = schedule;
    schedule();

    return () => {
      disposed = true;
      scheduleDrawRef.current = () => undefined;
      cancelAnimationFrame(raf);
      if (wakeTimer !== null) window.clearTimeout(wakeTimer);
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      themeObserver.disconnect();
    };
  }, [reducedMotion]);

  // 数据、状态或缩放目标变化只请求一帧，不销毁 rAF、ResizeObserver 和主题观察器。
  useEffect(() => {
    scheduleDrawRef.current();
  }, [renderRevision, targetScale, timelineItems]);

  const viewDescription = isNear
    ? state === 'paused'
      ? reducedMotion
        ? '秒级近景 · 暂停粒子痕迹静态呈现'
        : '秒级近景 · 暂停粒子持续留痕'
      : '秒级近景 · 每格 1 秒 · 分钟主刻'
    : '30 分钟总览 · 专注与暂停时间轨迹';
  const lastRecordedAt = Math.max(
    0,
    ...(snapshot?.segments.map((segment) => segment.endedAt ?? segment.startedAt) ?? []),
    ...(snapshot?.pauseEvents.map((pause) => pause.pauseEndedAt ?? pause.pauseStartedAt) ?? []),
  );
  const clockAt = live ? now : lastRecordedAt || now;
  const clockLabel = live ? '当前精确时间' : hasRecordedTime ? '最后记录时间' : '待机时间锚点';
  const clockValue = new Date(clockAt).toLocaleTimeString('zh-CN', { hour12: false });
  const clockAccessibleLabel =
    state === 'paused'
      ? `暂停损耗 ${formatElapsedSeconds(pauseElapsedMs)}，${clockLabel} ${clockValue}`
      : `${clockLabel} ${clockValue}`;

  return (
    <figure
      className="temporal-ribbon"
      data-state={state}
      data-scale={isNear ? 'seconds' : 'minutes'}
      data-view-mode={effectiveViewMode}
      data-motion={
        state === 'running'
          ? 'continuous-material'
          : state === 'paused'
            ? 'pause-dissolve'
            : 'frozen'
      }
      data-dissolve={state === 'paused' ? 'interval-trace' : 'none'}
    >
      <div className="ribbon-caption">
        <span className="ribbon-title">时间之带</span>
        <span className="ribbon-legend">{viewDescription}</span>
        <span className="ribbon-live-clock" aria-label={clockAccessibleLabel}>
          {state === 'paused' ? `损耗 ${formatElapsedSeconds(pauseElapsedMs)}` : null}
          {state === 'paused' ? ' · ' : null}
          {!live ? (hasRecordedTime ? '最后记录 · ' : '待机 · ') : null}
          {clockValue}
        </span>
        <span className="ribbon-view-switch" role="group" aria-label="时间之带视野">
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
            disabled={state === 'paused'}
            aria-label={
              state === 'paused' ? '远景暂不可用：暂停时保持近景以看清时间损耗' : '切换到远景'
            }
            title={state === 'paused' ? '暂停时保持近景以看清时间损耗' : '拉远查看累计专注'}
          >
            远景
          </button>
          {viewMode !== 'auto' && state !== 'paused' && (
            <button type="button" className="ribbon-auto" onClick={() => setViewMode('auto')}>
              跟随状态
            </button>
          )}
        </span>
        <span className="ribbon-scale-tag">{isNear ? '1 格 = 1 秒' : '1 大格 = 30 分钟'}</span>
      </div>
      <canvas
        ref={canvasRef}
        className="ribbon-canvas"
        role="img"
        aria-label={`本次累计有效专注 ${formatElapsedSeconds(activeElapsedMs)}，当前${state === 'paused' ? `暂停损耗 ${formatElapsedSeconds(pauseElapsedMs)}，红色粒子持续记录完整暂停时段` : state === 'running' ? '专注进行中' : '画面已冻结'}，${viewDescription}`}
      />
    </figure>
  );
}

/* ─── Canvas 渲染内核：真实墙钟轴上的绿色专注体与红色消逝体 ─── */

function readBandPaintStyle(): BandPaintStyle {
  const css = getComputedStyle(document.documentElement);
  const raw = (name: string) => css.getPropertyValue(name).trim();
  const rgb = (name: string) => raw(name).split(/\s+/).slice(0, 3).join(',');
  return {
    colors: {
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
    },
    fontNumber: `10px ${raw('--font-number') || 'monospace'}`,
    fontSmallNumber: `9px ${raw('--font-number') || 'monospace'}`,
    fontUi: `600 10px ${raw('--font-ui') || 'sans-serif'}`,
  };
}

function renderBand(
  ctx: CanvasRenderingContext2D,
  engine: BandEngine,
  input: {
    snapshot: TimerSnapshot | null;
    state: TimerState;
    nowMs: number;
    reducedMotion: boolean;
    moments: TimelineItem[];
    paintStyle: BandPaintStyle;
    viewport: { width: number; height: number };
  },
): void {
  const { width, height } = input.viewport;
  if (width <= 0 || height <= 0) return;

  const { colors, fontNumber, fontSmallNumber, fontUi } = input.paintStyle;

  let zoomEnergy = 0;
  if (engine.zoom) {
    const progress = Math.min(1, (performance.now() - engine.zoom.start) / engine.zoom.duration);
    engine.scale = interpolateZoomScale(engine.zoom.from, engine.zoom.to, easeInOutQuart(progress));
    zoomEnergy = Math.sin(progress * Math.PI);
    if (progress >= 1) {
      engine.scale = engine.zoom.to;
      engine.zoom = null;
    }
  }

  const moments = input.moments;
  const lastRecordedAt = moments.reduce(
    (latest, moment) => Math.max(latest, moment.endedAt ?? moment.startedAt),
    0,
  );
  const live = input.state === 'running' || input.state === 'paused';
  const cameraMs = live ? input.nowMs : lastRecordedAt || input.nowMs;
  updateEngineState(
    engine,
    input.state,
    input.snapshot?.sessionId ?? null,
    performance.now(),
    input.reducedMotion,
  );

  const scale = engine.scale;
  const detail = bandDetailMix(scale);
  const pointerX = width * BAND_POINTER_RATIO;
  const pulseClockMs =
    input.state === 'paused' && input.snapshot?.currentPauseStartedAt
      ? Math.max(0, input.nowMs - input.snapshot.currentPauseStartedAt)
      : input.state === 'running'
        ? input.nowMs
        : 1000;
  const pulseAge = pulseClockMs % 1000;
  const wholeSecond = Math.floor(pulseClockMs / 1000);
  engine.lastSecond = wholeSecond;

  // 主带使用绝对墙钟坐标：专注和暂停都是持续发生的时间段。
  const displaySeconds = steppedDisplaySeconds(cameraMs, input.reducedMotion);
  const toTickX = (ms: number) => (ms / 1000 - displaySeconds) * scale + pointerX;
  const visibleStart = displaySeconds - pointerX / scale;
  const visibleEnd = displaySeconds + (width - pointerX) / scale;
  const motionSeconds = live && !input.reducedMotion ? input.nowMs / 1000 : cameraMs / 1000;

  const frameNowMs = performance.now();
  const materialFade = particleFieldFadeIn(
    engine.materialFadeStart,
    frameNowMs,
    input.reducedMotion,
  );
  if (materialFade >= 1) engine.materialFadeStart = null;

  ctx.clearRect(0, 0, width, height);
  const farFieldHeight = clamp(height * 0.54, 62, 160);
  const nearFieldHeight = clamp(height * 0.72, 82, 224);
  const fieldHeight = lerp(farFieldHeight, nearFieldHeight, detail);
  const fieldTop = Math.max(24, (height - fieldHeight) / 2 - 1);
  const fieldBottom = Math.min(height - 25, fieldTop + fieldHeight);

  // 1. 中性材料床。
  drawMaterialBed(ctx, { width, fieldTop, fieldBottom, detail, zoomEnergy, colors });
  drawLocalIllumination(ctx, {
    pointerX,
    fieldTop,
    fieldBottom,
    state: input.state,
    pulseAge,
    zoomEnergy,
    colors,
  });

  // 2–3. 每个真实时间段都在墙钟轴上留下自己的材料；暂停粒子本身就是痕迹。
  for (const moment of moments) {
    let endMs = moment.endedAt;
    if (endMs === null) {
      if (!moment.isOngoing) continue;
      endMs = input.nowMs;
    }
    const startSec = moment.startedAt / 1000;
    const endSec = endMs / 1000;
    if (endSec <= startSec || endSec < visibleStart || startSec > visibleEnd) continue;

    if (moment.type === 'focus') {
      drawFocusMaterial(ctx, {
        startSec,
        endSec,
        cameraSeconds: displaySeconds,
        motionSeconds: moment.isOngoing ? motionSeconds : endSec,
        pointerX,
        viewportWidth: width,
        scale,
        fieldTop,
        fieldBottom,
        colors,
        reducedMotion: input.reducedMotion || !moment.isOngoing,
        alphaScale: moment.isOngoing ? materialFade : 1,
      });
    } else {
      drawPauseIntervalTrace(ctx, {
        startSec,
        endSec,
        cameraSeconds: displaySeconds,
        motionSeconds: moment.isOngoing ? motionSeconds : endSec,
        pointerX,
        viewportWidth: width,
        scale,
        fieldTop,
        fieldBottom,
        colors,
        reducedMotion: input.reducedMotion || !moment.isOngoing,
        isOngoing: moment.isOngoing,
      });
    }
  }

  // 指针右侧是尚未发生的墙钟时间。
  const futureShade = ctx.createLinearGradient(pointerX, 0, width, 0);
  futureShade.addColorStop(0, `rgba(${colors.ink},0.035)`);
  futureShade.addColorStop(1, `rgba(${colors.ink},0.082)`);
  ctx.fillStyle = futureShade;
  ctx.fillRect(pointerX, fieldTop, width - pointerX, fieldBottom - fieldTop);

  // 4. 绝对墙钟刻度；时间段边界与账本 HH:mm 完全一致。
  drawIntegratedTicks(ctx, {
    width,
    fieldTop,
    fieldBottom,
    displaySeconds,
    activeSeconds: cameraMs / 1000,
    visibleStart,
    visibleEnd,
    toX: toTickX,
    nearAlpha: secondTickAlpha(scale),
    farAlpha: macroTickAlpha(scale),
    colors,
    fontNumber,
    fontSmallNumber,
  });

  if (input.state === 'running') {
    drawRunningFrontier(ctx, {
      pointerX,
      fieldTop,
      fieldBottom,
      eventSecond: wholeSecond,
      pulseAge,
      reducedMotion: input.reducedMotion,
      colors,
    });
  }

  // 5. 状态指针只标记当前墙钟位置；历史由绿色材料和红色粒子时间体表达。
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
    label:
      input.state === 'running' || input.state === 'paused'
        ? '现在'
        : moments.length > 0
          ? '最后记录'
          : '待机',
  });
}

function updateEngineState(
  engine: BandEngine,
  state: TimerState,
  sessionId: string | null,
  frameNowMs: number,
  reducedMotion: boolean,
): void {
  // sessionId 是材料淡入和绘制状态的业务边界。
  if (engine.sessionId !== sessionId) {
    engine.sessionId = sessionId;
    engine.materialFadeStart = state === 'running' && !reducedMotion ? frameNowMs : null;
    engine.prevState = state;
    engine.lastSecond = -1;
  }

  if (engine.prevState !== state) {
    if (engine.prevState === 'idle' && state === 'running' && !reducedMotion) {
      engine.materialFadeStart = frameNowMs;
    }
    if (state === 'idle') engine.materialFadeStart = null;
    engine.prevState = state;
  }
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
  const color = input.state === 'paused' ? input.colors.pauseSoft : input.colors.focusSoft;
  const tickWindow = input.state === 'paused' ? BAND_PAUSE_MOTION_MS : BAND_RUNNING_MOTION_MS;
  const tick = Math.max(0, 1 - input.pulseAge / tickWindow);
  const radius = 52 + tick * 14 + input.zoomEnergy * 28;
  const centerY = (input.fieldTop + input.fieldBottom) / 2;
  const glow = ctx.createRadialGradient(
    input.pointerX,
    centerY,
    0,
    input.pointerX,
    centerY,
    radius,
  );
  glow.addColorStop(0, `rgba(${color},${0.042 + tick * 0.035})`);
  glow.addColorStop(0.48, `rgba(${color},${0.018 + input.zoomEnergy * 0.02})`);
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

  ctx.fillStyle = `rgba(${input.colors.borderStrong},0.9)`;
  ctx.fillRect(0, input.fieldTop, input.width, 1);
  ctx.fillRect(0, input.fieldBottom - 1, input.width, 1);
  for (const ratio of [0.16, 0.38, 0.64, 0.86]) {
    const depth = particleDepthProfile(ratio, input.detail);
    ctx.fillStyle = `rgba(${input.colors.ink},${0.026 + depth.projectedRatio * 0.052})`;
    ctx.fillRect(0, input.fieldTop + fieldHeight * depth.projectedRatio, input.width, 0.7);
  }

  const lipHeight = clamp(fieldHeight * 0.075, 5, 10);
  const lip = ctx.createLinearGradient(0, input.fieldBottom - lipHeight, 0, input.fieldBottom);
  lip.addColorStop(0, `rgba(${input.colors.surface2},0.24)`);
  lip.addColorStop(0.2, `rgba(${input.colors.ink},0.035)`);
  lip.addColorStop(1, `rgba(${input.colors.ink},0.16)`);
  ctx.fillStyle = lip;
  ctx.fillRect(0, input.fieldBottom - lipHeight, input.width, lipHeight);
  ctx.fillStyle = `rgba(255,255,255,${0.08 + input.detail * 0.04})`;
  ctx.fillRect(0, input.fieldBottom - lipHeight, input.width, 0.7);

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
    startSec: number;
    endSec: number;
    cameraSeconds: number;
    motionSeconds: number;
    pointerX: number;
    viewportWidth: number;
    scale: number;
    fieldTop: number;
    fieldBottom: number;
    colors: BandColors;
    reducedMotion: boolean;
    alphaScale: number;
  },
): void {
  if (input.endSec <= input.startSec || input.alphaScale <= 0.01) return;
  const worldMin = Math.max(
    input.startSec,
    input.cameraSeconds - (input.pointerX + 40) / input.scale,
  );
  const worldMax = Math.min(
    input.endSec,
    input.cameraSeconds + (input.viewportWidth - input.pointerX + 40) / input.scale,
  );
  if (worldMax <= worldMin) return;

  const focus = toTuple(input.colors.focus);
  const focusDeep = toTuple(input.colors.focusDeep);
  const focusSoft = toTuple(input.colors.focusSoft);
  const muted = toTuple(input.colors.muted);
  const fieldHeight = input.fieldBottom - input.fieldTop;
  const cellPx = 2.7;
  const stepSec = cellPx / Math.max(0.001, input.scale);
  const rowStep = 3.15;
  const rows = Math.max(18, Math.ceil(fieldHeight / rowStep));
  const overspillRows = 5;
  const endX = (input.endSec - input.cameraSeconds) * input.scale + input.pointerX;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, input.fieldTop - 12, input.viewportWidth, fieldHeight + 24);
  ctx.clip();

  for (
    let column = Math.floor(worldMin / stepSec) - 1;
    column * stepSec <= worldMax + stepSec;
    column += 1
  ) {
    const columnOffset = particleCellHash(column, 311);
    const worldSec = (column + columnOffset) * stepSec;
    if (worldSec < worldMin || worldSec > worldMax) continue;
    const edgeDistancePx = Math.min(
      (worldSec - input.startSec) * input.scale,
      (input.endSec - worldSec) * input.scale,
    );
    const edgeSettle = smoothstep01(edgeDistancePx / 14);
    const columnNoise = Math.sin(column * 0.31 + particleCellHash(column, 1709) * 2.4) * 0.5 + 0.5;
    const densityPulse = 0.79 + columnNoise * 0.12;
    const baseX = (worldSec - input.cameraSeconds) * input.scale + input.pointerX;

    for (let row = -overspillRows; row < rows + overspillRows; row += 1) {
      const presence = particleCellHash(column, row);
      const offsetY = particleCellHash(row + 137, column - 617);
      const direction = particleCellHash(column + 239, row + 73) * 2 - 1;
      const tone = particleCellHash(column - 83, row + 887);
      const shape = particleCellHash(column + 1297, row - 41);
      const phase = particleCellHash(column - 419, row + 773) * Math.PI * 2;
      const rawRatio = (row + offsetY) / rows;
      const rowRatio = clamp(rawRatio, 0, 1);
      const edgeDistance = Math.min(rawRatio, 1 - rawRatio) * fieldHeight;
      const feather = smoothstep01((edgeDistance + 10 + columnNoise * 5) / 18);
      const outside = rawRatio < 0 || rawRatio > 1;
      const envelope = outside ? feather * 0.42 : 0.56 + feather * 0.44;
      if (presence > densityPulse * envelope * (0.64 + edgeSettle * 0.36)) continue;
      const depth = particleDepthProfile(rowRatio, bandDetailMix(input.scale));
      const motion = input.reducedMotion
        ? Math.sin(phase) * 0.28
        : Math.sin(input.motionSeconds * 0.82 + phase) * 0.62;
      const horizontalJitter = (particleCellHash(column + 211, row - 353) - 0.5) * cellPx;
      const x = Math.min(
        endX - 0.35,
        baseX +
          horizontalJitter +
          (input.reducedMotion ? 0 : Math.sin(input.motionSeconds * 0.46 + phase) * 1.15),
      );
      const y =
        input.fieldTop +
        depth.projectedRatio * fieldHeight +
        (rawRatio < 0 ? rawRatio * 7 : rawRatio > 1 ? (rawRatio - 1) * 7 : 0) +
        direction * (2.2 + (1 - edgeSettle) * 5.5) * (0.7 + motion * 0.3);
      const size =
        (1.05 + particleCellHash(column + 59, row + 271) * 1.75) *
        (0.86 + edgeSettle * 0.16) *
        depth.sizeScale;
      const alpha =
        (0.3 + feather * 0.58) * (0.78 + presence * 0.22) * depth.alphaScale * input.alphaScale;
      const baseColor = particleToneColor(tone, focus, focusDeep, focusSoft);
      const color = mixRgb(baseColor, muted, (1 - edgeSettle) * 0.18);

      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
      if (shape < 0.82) {
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      } else if (shape < 0.95) {
        const length = Math.min(4.4, size * 1.75);
        ctx.fillRect(x - length / 2, y - size * 0.24, length, size * 0.48);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, size * 0.44, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawPauseIntervalTrace(
  ctx: CanvasRenderingContext2D,
  input: {
    startSec: number;
    endSec: number;
    cameraSeconds: number;
    motionSeconds: number;
    pointerX: number;
    scale: number;
    fieldTop: number;
    fieldBottom: number;
    viewportWidth: number;
    colors: BandColors;
    reducedMotion: boolean;
    isOngoing: boolean;
  },
): void {
  if (input.endSec <= input.startSec) return;
  const worldMin = Math.max(
    input.startSec,
    input.cameraSeconds - (input.pointerX + 40) / input.scale,
  );
  const worldMax = Math.min(
    input.endSec,
    input.cameraSeconds + (input.viewportWidth - input.pointerX + 40) / input.scale,
  );
  if (worldMax <= worldMin) return;

  const pause = toTuple(input.colors.pause);
  const pauseDeep = mixRgb(pause, toTuple(input.colors.ink), 0.26);
  const pauseSoft = toTuple(input.colors.pauseSoft);
  const ash = particleAshColor(pause, toTuple(input.colors.muted));
  const fieldHeight = input.fieldBottom - input.fieldTop;
  const cellPx = 2.65;
  const stepSec = cellPx / Math.max(0.001, input.scale);
  const rows = Math.max(18, Math.ceil(fieldHeight / 3.2));
  const overspillRows = 7;
  const endX = (input.endSec - input.cameraSeconds) * input.scale + input.pointerX;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, input.fieldTop - 34, input.viewportWidth, fieldHeight + 68);
  ctx.clip();

  for (
    let column = Math.floor(worldMin / stepSec) - 1;
    column * stepSec <= worldMax + stepSec;
    column += 1
  ) {
    const columnOffset = particleCellHash(column, 701);
    const worldSec = (column + columnOffset) * stepSec;
    if (worldSec < worldMin || worldSec > worldMax) continue;
    const behindEndPx = Math.max(0, (input.endSec - worldSec) * input.scale);
    const recentEnergy = Math.exp(-behindEndPx / 118);
    const startFeather = smoothstep01(((worldSec - input.startSec) * input.scale) / 16);
    const residueDensity = (0.46 + recentEnergy * 0.28) * (0.48 + startFeather * 0.52);
    const baseX = (worldSec - input.cameraSeconds) * input.scale + input.pointerX;

    for (let row = -overspillRows; row < rows + overspillRows; row += 1) {
      const presence = particleCellHash(column, row);
      const offsetY = particleCellHash(row + 193, column - 811);
      const direction = particleCellHash(column + 409, row + 37) * 2 - 1;
      const tone = particleCellHash(column - 97, row + 1201);
      const shape = particleCellHash(column + 1877, row - 53);
      const phase = particleCellHash(column - 503, row + 991) * Math.PI * 2;
      const rawRatio = (row + offsetY) / rows;
      const rowRatio = clamp(rawRatio, 0, 1);
      const edgeDistance = Math.min(rawRatio, 1 - rawRatio) * fieldHeight;
      const feather = smoothstep01((edgeDistance + 14) / 24);
      const outside = rawRatio < 0 || rawRatio > 1;
      const residueEnvelope = outside ? feather * 0.5 : 0.54 + feather * 0.46;
      if (presence > residueDensity * residueEnvelope) continue;
      const depth = particleDepthProfile(rowRatio, bandDetailMix(input.scale));
      const residueJitterX = (particleCellHash(column + 257, row - 421) - 0.5) * cellPx;
      const residueX = Math.min(endX - 0.35, baseX + residueJitterX);
      const residueY =
        input.fieldTop +
        depth.projectedRatio * fieldHeight +
        direction * (5 + (1 - recentEnergy) * 8) +
        (rawRatio < 0 ? rawRatio * 8 : rawRatio > 1 ? (rawRatio - 1) * 8 : 0);
      const baseSize = (1 + particleCellHash(column + 67, row + 313) * 1.75) * depth.sizeScale;
      const residueAlpha =
        (0.14 + recentEnergy * 0.2) * feather * (0.76 + presence * 0.24) * depth.alphaScale;
      const baseColor = particleToneColor(tone, pause, pauseDeep, pauseSoft);
      const residueColor = particleAgedColor(baseColor, ash, 0.48 + (1 - recentEnergy) * 0.34);

      // 低透明度残留层保存暂停的完整横向长度，但自身不形成实线或色块。
      ctx.fillStyle = `rgba(${residueColor[0]},${residueColor[1]},${residueColor[2]},${residueAlpha})`;
      if (shape < 0.76) {
        ctx.fillRect(residueX - baseSize / 2, residueY - baseSize / 2, baseSize, baseSize);
      } else if (shape < 0.93) {
        const length = Math.min(4.6, baseSize * 1.8);
        const thickness = Math.max(0.6, baseSize * 0.44);
        ctx.fillRect(residueX - length / 2, residueY - thickness / 2, length, thickness);
      } else {
        ctx.beginPath();
        ctx.arc(residueX, residueY, baseSize * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }

      // 活动层才负责“消逝”：每个 cohort 依次剥离、漂移、缩小、熄灭。
      if (!input.isOngoing || input.reducedMotion) continue;
      const lifespan = 0.72 + particleCellHash(column - 809, row + 619) * 1.18;
      const cycleOffset = particleCellHash(column + 1291, row - 977) * lifespan;
      const life = ((input.motionSeconds + cycleOffset) % lifespan) / lifespan;
      const activeGate = particleCellHash(
        column - 337,
        row + Math.floor(input.motionSeconds / lifespan),
      );
      if (activeGate > 0.54 + recentEnergy * 0.28) continue;
      const remaining = 1 - life;
      const eased = 1 - remaining * remaining;
      const driftX = -(3 + tone * 10) * eased + Math.sin(phase + life * 8) * life * 3.5;
      const lift = direction * (9 + tone * 24) * eased - (3 + tone * 8) * eased;
      const activeX = Math.min(endX - 0.35, residueX + driftX);
      const activeY = residueY + lift;
      const activeSize = baseSize * (0.98 - life * 0.78);
      const activeAlpha =
        (0.84 * remaining * remaining + 0.06 * remaining) *
        (0.72 + recentEnergy * 0.28) *
        depth.alphaScale;
      const activeColor = particleAgedColor(baseColor, ash, life * 0.86);
      ctx.fillStyle = `rgba(${activeColor[0]},${activeColor[1]},${activeColor[2]},${activeAlpha})`;
      if (shape < 0.58) {
        ctx.fillRect(activeX - activeSize / 2, activeY - activeSize / 2, activeSize, activeSize);
      } else if (shape < 0.9) {
        ctx.save();
        ctx.translate(activeX, activeY);
        ctx.rotate(phase + life * direction * 0.9);
        ctx.fillRect(-activeSize, -activeSize * 0.24, activeSize * 2, activeSize * 0.48);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(activeX, activeY, activeSize * 0.48, 0, Math.PI * 2);
        ctx.fill();
      }
    }
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
    activeSeconds: number;
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
      let second = Math.max(0, Math.floor(input.visibleStart) - 1);
      second <= input.visibleEnd + 1;
      second += 1
    ) {
      const x = input.toX(second * 1000);
      if (x < -1 || x > input.width + 1) continue;
      const future = second > input.activeSeconds;
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
        ctx.fillText(wallClockTickLabel(second), x, input.fieldTop - 10);
      }
    }
  }

  if (input.farAlpha > 0.02) {
    const firstTick = Math.max(0, Math.floor(input.visibleStart / 300) * 300);
    for (let second = firstTick; second <= input.visibleEnd + 300; second += 300) {
      const x = input.toX(second * 1000);
      if (x < -1 || x > input.width + 1) continue;
      const future = second > input.activeSeconds;
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
        ctx.fillText(wallClockTickLabel(second), x, input.fieldTop - 10);
      } else if (tenMinute && input.farAlpha > 0.62) {
        ctx.fillStyle = `rgba(${input.colors.muted},${0.7 * input.farAlpha})`;
        ctx.font = input.fontSmallNumber;
        ctx.fillText(wallClockTickLabel(second), x, input.fieldBottom + 13);
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

function drawRunningFrontier(
  ctx: CanvasRenderingContext2D,
  input: {
    pointerX: number;
    fieldTop: number;
    fieldBottom: number;
    eventSecond: number;
    pulseAge: number;
    reducedMotion: boolean;
    colors: BandColors;
  },
): void {
  const rawPhase = input.reducedMotion ? 0.5 : clamp(input.pulseAge / BAND_RUNNING_MOTION_MS, 0, 1);
  const travel = easeInOutQuart(rawPhase);
  const direction = input.eventSecond % 2 === 0 ? travel : 1 - travel;
  const shuttleY = lerp(input.fieldTop + 7, input.fieldBottom - 7, direction);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = `rgba(${input.colors.focus},0.28)`;
  ctx.shadowBlur = 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(input.pointerX - 5.5, shuttleY);
  ctx.lineTo(input.pointerX + 1.5, shuttleY);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(${input.colors.focusDeep},0.86)`;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(input.pointerX - 6.5, shuttleY + 1.5);
  ctx.lineTo(input.pointerX + 0.5, shuttleY + 1.5);
  ctx.stroke();
  ctx.restore();
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

  if (active) {
    const breathPulse = pointerBreathPulse(input.pulseAge, input.reducedMotion);
    const glowAlpha = POINTER_GLOW_MAX_ALPHA * (0.35 + 0.65 * breathPulse);
    const centerY = (input.fieldTop + input.fieldBottom) / 2;
    const radius = 20 + breathPulse * 8;
    const breath = ctx.createRadialGradient(
      input.pointerX,
      centerY,
      0,
      input.pointerX,
      centerY,
      radius,
    );
    breath.addColorStop(0, `rgba(${stateColor},${glowAlpha})`);
    breath.addColorStop(0.55, `rgba(${stateColor},${glowAlpha * 0.4})`);
    breath.addColorStop(1, `rgba(${stateColor},0)`);
    ctx.fillStyle = breath;
    ctx.fillRect(
      input.pointerX - radius,
      input.fieldTop - 16,
      radius * 2,
      input.fieldBottom - input.fieldTop + 32,
    );
  }

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

  ctx.fillStyle = `rgba(${input.colors.border},0.44)`;
  ctx.fillRect(input.pointerX - 0.5, input.fieldTop, 1, input.fieldBottom - input.fieldTop);
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

function toTuple(value: string): RgbTuple {
  const [r = 0, g = 0, b = 0] = value.split(',').map((part) => Number(part.trim()));
  return [r, g, b];
}

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function smoothstep01(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
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

function wallClockTickLabel(totalSeconds: number): string {
  const date = new Date(totalSeconds * 1000);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export { BAND_SCALE_FAR, BAND_SCALE_NEAR };
