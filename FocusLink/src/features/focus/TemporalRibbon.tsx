// 时间之带：一条真实墙钟刻度轨道，用「材料」表达时间的去向。
//
//  · 专注 = 强调色的连续实体。它平稳生长、完整覆盖整个时段，没有颗粒噪点，
//    也没有逐秒跳格——镜头随墙钟连续滑动，所以线是连续的、稳的。
//  · 暂停 = 红色粒子从前沿持续剥离、上浮、缩小、熄灭。粒子最终会全部消散，
//    只在轨道底部留下一道疤痕：那段时间确实发生过，但什么都没留下。
//
// 渲染成本与时长无关：专注段是常数次渐变填充，暂停粒子由固定寿命封顶。
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BAND_POINTER_RATIO,
  BAND_SCALE_FAR,
  BAND_SCALE_NEAR,
  BAND_ZOOM_MS,
  PAUSE_LOSS_MAX_LIFE_MS,
  POINTER_GLOW_MAX_ALPHA,
  bandScaleForState,
  easeInOutQuart,
  focusMaterialPose,
  frontierGlowAlpha,
  interpolateZoomScale,
  macroTickAlpha,
  mixRgb,
  overviewMajorStepSec,
  overviewScaleForSpan,
  overviewTickStepSec,
  particleAshColor,
  particleCellHash,
  pauseFrontierDissolveParticles,
  pointerBreathPulse,
  secondTickAlpha,
  steppedDisplaySeconds,
  traceResidueDot,
} from '@shared/focus/bandMath';
import type { RgbTuple } from '@shared/focus/bandMath';
import { getCumulativeActiveMs, getCurrentPauseDisplayMs } from '@shared/focus/selectors';
import { buildMixedTimelineItems } from '@shared/focus/timeline';
import type { TimelineItem } from '@shared/focus/timeline';
import type { TimerSnapshot, TimerState } from '@shared/types';

/**
 * 唯一的跨帧可变状态就是镜头尺度与进行中的变焦动画。
 * 材料形态全部由「时段 + 墙钟」纯函数推导，因此画面可以随时冻结、随时恢复。
 */
type BandEngine = {
  scale: number;
  zoom: { from: number; to: number; start: number; duration: number } | null;
};

type BandColors = {
  ink: RgbTuple;
  text: RgbTuple;
  muted: RgbTuple;
  subtle: RgbTuple;
  accent: RgbTuple;
  accentDeep: RgbTuple;
  pause: RgbTuple;
  surface: RgbTuple;
  surface2: RgbTuple;
  border: RgbTuple;
  borderStrong: RgbTuple;
  /** 亮色主题为白、暗色主题为浅墨；高光与蚀刻线共用。 */
  light: RgbTuple;
  isDark: boolean;
};

type BandPaintStyle = {
  colors: BandColors;
  fontNumber: string;
  fontSmallNumber: string;
  fontUi: string;
};

type BandGeometry = {
  width: number;
  height: number;
  channelTop: number;
  channelBottom: number;
  /** 材料相对轨道的内缩，使实体不贴死轨道边框。 */
  materialTop: number;
  materialBottom: number;
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
  const [viewportWidth, setViewportWidth] = useState(0);

  // 暂停保持近景：损耗最需要被看清的时刻不应该被拉远。
  const effectiveViewMode = state === 'paused' ? 'near' : viewMode;
  const live = state === 'running' || state === 'paused';
  const resolvedMode: 'near' | 'far' =
    effectiveViewMode === 'auto'
      ? bandScaleForState(state) === BAND_SCALE_NEAR
        ? 'near'
        : 'far'
      : effectiveViewMode;

  // 总览铺满指针左侧的“过去”区域；留 12% 余量，让会话起点不贴死画布左缘。
  const sessionSpanSec = useMemo(() => {
    let earliest = Number.POSITIVE_INFINITY;
    let latest = 0;
    for (const item of timelineItems) {
      earliest = Math.min(earliest, item.startedAt);
      latest = Math.max(latest, item.endedAt ?? (item.isOngoing ? now : item.startedAt));
    }
    if (!Number.isFinite(earliest) || latest <= earliest) return 0;
    return (latest - earliest) / 1000;
  }, [timelineItems, now]);
  const overviewScale = overviewScaleForSpan(
    sessionSpanSec,
    viewportWidth * BAND_POINTER_RATIO * 0.88,
  );

  const targetScale = resolvedMode === 'near' ? BAND_SCALE_NEAR : overviewScale;
  const isNear = resolvedMode === 'near';
  const activeElapsedMs = getCumulativeActiveMs(snapshot, now);
  const pauseElapsedMs = getCurrentPauseDisplayMs(snapshot, now);
  const hasRecordedTime =
    activeElapsedMs > 0 ||
    pauseElapsedMs > 0 ||
    (snapshot?.segments.length ?? 0) > 0 ||
    (snapshot?.pauseEvents.length ?? 0) > 0;

  // 只用真正影响场景投影的业务字段唤醒 Canvas；活动态的连续推进由 rAF 完成。
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
      // 2x 已足够保持文字锐利；3x 会把每帧填充像素放大到 2.25 倍。
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      viewport.width = width;
      viewport.height = height;
      // 总览尺度依赖可视宽度，宽度必须回到 React 才能重算 targetScale。
      setViewportWidth((previous) => (Math.abs(previous - width) < 0.5 ? previous : width));
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
      const needsNextFrame = renderBand(context, engineRef.current, {
        snapshot: snapshotRef.current,
        state: currentState,
        nowMs: wallNowMs,
        reducedMotion,
        moments: timelineItemsRef.current,
        paintStyle,
        viewport,
      });

      if (!reducedMotion && (currentState === 'running' || currentState === 'paused')) {
        schedule();
      } else if (!reducedMotion && needsNextFrame) {
        // 变焦动画与暂停尾灰在恢复/结束后仍需自然演完。
        schedule();
      } else if (currentState === 'running' || currentState === 'paused') {
        // reduced-motion 关闭的是连续动画，不是墙钟投影。
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
        ? '秒级近景 · 暂停损耗静态呈现'
        : '秒级近景 · 时间正在消散'
      : '秒级近景 · 每格 1 秒 · 分钟主刻'
    : sessionSpanSec > 0
      ? `整段总览 · 本次 ${formatSpanLabel(sessionSpanSec)} 铺满全带`
      : '整段总览 · 专注与暂停时间轨迹';
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
      data-dissolve={state === 'paused' ? 'frontier-ash' : 'none'}
    >
      <figcaption className="ribbon-caption">
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
        <span className="ribbon-scale-tag">
          {isNear
            ? '1 格 = 1 秒'
            : `1 大格 = ${formatSpanLabel(overviewMajorStepSec(overviewTickStepSec(overviewScale)))}`}
        </span>
      </figcaption>
      <canvas
        ref={canvasRef}
        className="ribbon-canvas"
        role="img"
        aria-label={`本次累计有效专注 ${formatElapsedSeconds(activeElapsedMs)}，当前${
          state === 'paused'
            ? `暂停损耗 ${formatElapsedSeconds(pauseElapsedMs)}，红色粒子正从当前时刻剥离消散`
            : state === 'running'
              ? '专注进行中，强调色实体连续生长'
              : '画面已冻结'
        }，${viewDescription}`}
      />
    </figure>
  );
}

/* ─── Canvas 渲染内核 ─────────────────────────────────────── */

function readBandPaintStyle(): BandPaintStyle {
  const css = getComputedStyle(document.documentElement);
  const raw = (name: string) => css.getPropertyValue(name).trim();
  const rgb = (name: string, fallback: RgbTuple): RgbTuple => {
    const parts = raw(name)
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(Number);
    return parts.length === 3 && parts.every((value) => Number.isFinite(value))
      ? ([parts[0], parts[1], parts[2]] as RgbTuple)
      : fallback;
  };
  const isDark = document.documentElement.classList.contains('dark');
  return {
    colors: {
      ink: rgb('--app-ink', isDark ? [239, 239, 235] : [24, 26, 29]),
      text: rgb('--app-text', isDark ? [239, 239, 235] : [24, 26, 29]),
      muted: rgb('--app-muted', [95, 99, 104]),
      subtle: rgb('--app-subtle', [154, 157, 162]),
      accent: rgb('--app-accent', [14, 159, 110]),
      accentDeep: rgb('--app-accent-active', [11, 122, 85]),
      pause: rgb('--app-pause', [210, 67, 57]),
      surface: rgb('--app-surface', [252, 252, 250]),
      surface2: rgb('--app-surface-2', [240, 240, 236]),
      border: rgb('--app-border', [221, 220, 214]),
      borderStrong: rgb('--app-border-strong', [198, 197, 190]),
      light: isDark ? [226, 232, 236] : [255, 255, 255],
      isDark,
    },
    fontNumber: `10px ${raw('--font-number') || 'monospace'}`,
    fontSmallNumber: `9px ${raw('--font-number') || 'monospace'}`,
    fontUi: `600 10px ${raw('--font-ui') || 'sans-serif'}`,
  };
}

/** @returns 是否还需要下一帧（变焦未完成或暂停尾灰未散尽）。 */
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
): boolean {
  const { width, height } = input.viewport;
  if (width <= 0 || height <= 0) return false;

  const { colors, fontNumber, fontSmallNumber, fontUi } = input.paintStyle;

  let zooming = false;
  if (engine.zoom) {
    const progress = Math.min(1, (performance.now() - engine.zoom.start) / engine.zoom.duration);
    engine.scale = interpolateZoomScale(engine.zoom.from, engine.zoom.to, easeInOutQuart(progress));
    zooming = progress < 1;
    if (!zooming) {
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

  const scale = engine.scale;
  const pointerX = Math.round(width * BAND_POINTER_RATIO);

  // 镜头随墙钟连续滑动——这正是「连续平稳」的来源；逐秒吸附只留给 reduced-motion。
  const cameraSeconds =
    live && !input.reducedMotion ? cameraMs / 1000 : steppedDisplaySeconds(cameraMs, true);
  const toX = (ms: number) => (ms / 1000 - cameraSeconds) * scale + pointerX;
  const visibleStartSec = cameraSeconds - pointerX / scale;
  const visibleEndSec = cameraSeconds + (width - pointerX) / scale;
  const motionSeconds = live && !input.reducedMotion ? input.nowMs / 1000 : cameraMs / 1000;
  const pulseAgeMs =
    input.state === 'paused' && input.snapshot?.currentPauseStartedAt
      ? Math.max(0, input.nowMs - input.snapshot.currentPauseStartedAt) % 1000
      : input.nowMs % 1000;

  const channelTop = Math.round(Math.max(20, height * 0.2));
  const channelBottom = Math.round(height - Math.max(24, height * 0.22));
  const inset = clamp((channelBottom - channelTop) * 0.1, 3, 8);
  const geometry: BandGeometry = {
    width,
    height,
    channelTop,
    channelBottom,
    materialTop: channelTop + inset,
    materialBottom: channelBottom - inset,
  };

  ctx.clearRect(0, 0, width, height);

  // 1. 轨道：一条内凹的中性槽，是时间尚未被使用的样子。
  drawChannel(ctx, geometry, colors);

  // 2. 已发生的时间段。暂停先画（它是底下的疤），专注实体压在其上。
  const focusMoments: TimelineItem[] = [];
  const pauseMoments: TimelineItem[] = [];
  for (const moment of moments) {
    const endMs = moment.endedAt ?? (moment.isOngoing ? input.nowMs : null);
    if (endMs === null) continue;
    const startSec = moment.startedAt / 1000;
    const endSec = endMs / 1000;
    if (endSec <= startSec || endSec < visibleStartSec || startSec > visibleEndSec) continue;
    (moment.type === 'focus' ? focusMoments : pauseMoments).push(moment);
  }

  for (const moment of pauseMoments) {
    const endMs = moment.endedAt ?? input.nowMs;
    drawPauseScar(ctx, geometry, colors, {
      x0: toX(moment.startedAt),
      x1: toX(endMs),
    });
  }

  const toWorldSec = (x: number) => (x - pointerX) / scale + cameraSeconds;
  for (const moment of focusMoments) {
    const endMs = moment.endedAt ?? input.nowMs;
    drawFocusMaterial(ctx, geometry, colors, {
      x0: toX(moment.startedAt),
      x1: toX(endMs),
      ageSec: (endMs - moment.startedAt) / 1000,
      motionSeconds,
      isOngoing: moment.endedAt === null,
      reducedMotion: input.reducedMotion,
      toWorldSec,
    });
  }

  // 3. 指针右侧是尚未发生的墙钟时间。
  const futureShade = ctx.createLinearGradient(pointerX, 0, width, 0);
  futureShade.addColorStop(0, rgba(colors.ink, 0.03));
  futureShade.addColorStop(1, rgba(colors.ink, 0.075));
  ctx.fillStyle = futureShade;
  ctx.fillRect(pointerX, channelTop, width - pointerX, channelBottom - channelTop);

  // 4. 绝对墙钟刻度；边界与账本 HH:mm 完全一致。
  drawRulerTicks(ctx, geometry, colors, {
    cameraSeconds,
    nowSeconds: cameraMs / 1000,
    visibleStartSec,
    visibleEndSec,
    toX,
    scale,
    nearAlpha: secondTickAlpha(scale),
    farAlpha: macroTickAlpha(scale),
    fontNumber,
    fontSmallNumber,
  });

  // 5. 暂停消散：粒子从当前前沿剥离，飞出轨道后熄灭。数量由固定寿命封顶。
  let ashAlive = false;
  if (!input.reducedMotion || input.state === 'paused') {
    for (const moment of pauseMoments) {
      const endedAt = moment.endedAt;
      if (endedAt !== null && input.nowMs - endedAt > PAUSE_LOSS_MAX_LIFE_MS) continue;
      const frontierX = toX(endedAt ?? input.nowMs);
      if (frontierX < -80 || frontierX > width + 80) continue;
      // 发射窗口不得越过暂停段起点，否则暂停刚开始的那两秒会把红色粒子
      // 直接撒在左边已经挣到的绿色实体上，看起来像弄脏了专注，而不是时间在流失。
      const emitted = drawPauseDissipation(ctx, geometry, colors, {
        nowMs: input.nowMs,
        startedAtMs: moment.startedAt,
        endedAtMs: endedAt,
        frontierX,
        sourceWidth: clamp(frontierX - toX(moment.startedAt), 1.5, 11),
        reducedMotion: input.reducedMotion,
      });
      ashAlive = ashAlive || (emitted && endedAt !== null);
    }
  }

  // 6. 状态指针：只标记「现在」在墙钟上的位置。
  drawNowPointer(ctx, geometry, colors, {
    pointerX,
    state: input.state,
    pulseAgeMs,
    reducedMotion: input.reducedMotion,
    fontUi,
    label:
      input.state === 'running' || input.state === 'paused'
        ? '现在'
        : moments.length > 0
          ? '最后记录'
          : '待机',
  });

  return zooming || ashAlive;
}

/* ─── 轨道 ─────────────────────────────────────────────────── */

function drawChannel(ctx: CanvasRenderingContext2D, geo: BandGeometry, colors: BandColors): void {
  const { channelTop, channelBottom, width } = geo;
  const bed = ctx.createLinearGradient(0, channelTop, 0, channelBottom);
  bed.addColorStop(0, rgba(colors.ink, colors.isDark ? 0.3 : 0.055));
  bed.addColorStop(0.14, rgba(colors.surface2, 1));
  bed.addColorStop(0.88, rgba(colors.surface, 1));
  bed.addColorStop(1, rgba(colors.ink, colors.isDark ? 0.16 : 0.05));
  ctx.fillStyle = bed;
  ctx.fillRect(0, channelTop, width, channelBottom - channelTop);

  ctx.fillStyle = rgba(colors.borderStrong, 0.92);
  ctx.fillRect(0, channelTop, width, 1);
  ctx.fillStyle = rgba(colors.border, 0.8);
  ctx.fillRect(0, channelBottom - 1, width, 1);
}

/* ─── 专注：连续实体 ───────────────────────────────────────── */

function drawFocusMaterial(
  ctx: CanvasRenderingContext2D,
  geo: BandGeometry,
  colors: BandColors,
  input: {
    x0: number;
    x1: number;
    ageSec: number;
    motionSeconds: number;
    isOngoing: boolean;
    reducedMotion: boolean;
    /** 屏幕 x → 世界墙钟秒：羽化与颗粒以世界时间为键，历史材料像素稳定。 */
    toWorldSec: (x: number) => number;
  },
): void {
  const left = Math.max(-4, input.x0);
  const right = Math.min(geo.width + 4, input.x1);
  if (right - left < 0.4) return;

  const pose = focusMaterialPose(input.ageSec, 0.5, input.motionSeconds, input.reducedMotion);
  const fullHeight = geo.materialBottom - geo.materialTop;
  // 新材料在 0.68s 内从 74% 厚度稳定到满厚度：能看见它在「凝结」，但没有抖动。
  const bodyHeight = fullHeight * pose.thicknessScale;
  // 羽化预留：核心实体从轮廓内收，破碎边缘在预留带里生长，总高度不变。
  const feather = clamp(bodyHeight * 0.16, 2.5, 6);
  const top = geo.materialTop + (fullHeight - bodyHeight) / 2;
  const bottom = top + bodyHeight;
  const coreTop = top + feather;
  const coreBottom = bottom - feather;

  const highlight = mixRgb(colors.accent, colors.light, colors.isDark ? 0.3 : 0.24);
  const deep = mixRgb(colors.accentDeep, colors.ink, colors.isDark ? 0.12 : 0.2);

  const body = ctx.createLinearGradient(0, coreTop, 0, coreBottom);
  body.addColorStop(0, rgba(highlight, 0.97));
  body.addColorStop(0.3, rgba(colors.accent, 1));
  body.addColorStop(0.82, rgba(colors.accent, 0.97));
  body.addColorStop(1, rgba(deep, 0.98));
  ctx.fillStyle = body;
  ctx.fillRect(left, coreTop, right - left, coreBottom - coreTop);

  // 破碎轮廓与内部颗粒：以 0.5s 世界格为键的确定性采样。列在屏幕上每 3px 取一次，
  // 上下轮廓各自伸出高低不一的齿，齿端再溢散 1px 亚像素浮尘；材料内部按同一
  // hash 布置亮斑与暗粒。相机静止时逐帧像素不变（idle/finished 可冻结），
  // 运行态相机连续滑动使齿列缓慢换代——正是「内部与边缘保持低幅共同流动」。
  const COLUMN_PX = 3;
  const startColumn = Math.ceil(left / COLUMN_PX);
  const endColumn = Math.floor(right / COLUMN_PX);
  for (let column = startColumn; column <= endColumn; column += 1) {
    const x = column * COLUMN_PX;
    const key = Math.floor(input.toWorldSec(x) * 2);
    const topReach = particleCellHash(key, 3) * feather;
    const bottomReach = particleCellHash(key, 9) * feather;
    const columnWidth = Math.min(COLUMN_PX, right - x);
    if (columnWidth <= 0) continue;

    // 齿身：接近实体的不透明度，读作材料本体的破碎轮廓而不是辉光。
    ctx.fillStyle = rgba(colors.accent, 0.82);
    if (topReach > 0.4) ctx.fillRect(x, coreTop - topReach, columnWidth, topReach + 0.5);
    ctx.fillStyle = rgba(deep, 0.8);
    if (bottomReach > 0.4) ctx.fillRect(x, coreBottom - 0.5, columnWidth, bottomReach + 0.5);

    // 齿端浮尘：更小、更淡，向外多溢出 1~2px。
    const dustSeed = particleCellHash(key, 17);
    if (dustSeed > 0.42) {
      ctx.fillStyle = rgba(colors.accent, 0.3 + dustSeed * 0.2);
      ctx.fillRect(x + dustSeed * 2, coreTop - topReach - 1.6, 1.1, 1.1);
    }
    const dustSeedBottom = particleCellHash(key, 23);
    if (dustSeedBottom > 0.48) {
      ctx.fillStyle = rgba(deep, 0.26 + dustSeedBottom * 0.18);
      ctx.fillRect(x + dustSeedBottom * 2, coreBottom + bottomReach + 0.6, 1.1, 1.1);
    }

    // 内部颗粒：稀疏的亮斑/暗粒让实体有「压实的时间材料」质感。
    const grainSeed = particleCellHash(key, 31);
    if (grainSeed > 0.72 && coreBottom - coreTop > 8) {
      const grainY = coreTop + 2 + particleCellHash(key, 41) * (coreBottom - coreTop - 5);
      ctx.fillStyle =
        grainSeed > 0.87 ? rgba(colors.light, 0.24) : rgba(colors.ink, colors.isDark ? 0.2 : 0.12);
      ctx.fillRect(x + 0.6, grainY, 1.3, 1.3);
    }
  }

  // 顶沿高光：极低幅度的 sheen 呼吸让实体保持「活着」，但不产生可察觉的位移。
  ctx.fillStyle = rgba(colors.light, 0.34 + pose.sheen * 0.08);
  ctx.fillRect(left, coreTop, right - left, 1);
  ctx.fillStyle = rgba(colors.ink, 0.14);
  ctx.fillRect(left, coreBottom - 1, right - left, 1);

  // 生长端：一个明亮的切面，指出材料正在从这里长出来。
  if (input.isOngoing && right > left + 1) {
    const cap = ctx.createLinearGradient(right - 14, 0, right, 0);
    cap.addColorStop(0, rgba(highlight, 0));
    cap.addColorStop(1, rgba(highlight, 0.6));
    ctx.fillStyle = cap;
    ctx.fillRect(
      Math.max(left, right - 14),
      coreTop,
      Math.min(14, right - left),
      coreBottom - coreTop,
    );
    ctx.fillStyle = rgba(colors.light, 0.82);
    ctx.fillRect(right - 1.2, coreTop, 1.2, coreBottom - coreTop);
  }
}

/* ─── 暂停：疤痕 + 前沿消散 ────────────────────────────────── */

function drawPauseScar(
  ctx: CanvasRenderingContext2D,
  geo: BandGeometry,
  colors: BandColors,
  input: { x0: number; x1: number },
): void {
  const left = Math.max(-4, input.x0);
  const right = Math.min(geo.width + 4, input.x1);
  if (right - left < 0.4) return;

  // 槽被掏空：这段时间没有留下任何实体。这道缺口必须读得出来——粒子终会散尽，
  // 留在带子上的空槽才是「这段时间什么都没挣到」的证据。
  const hollow = ctx.createLinearGradient(0, geo.channelTop, 0, geo.channelBottom);
  hollow.addColorStop(0, rgba(colors.ink, colors.isDark ? 0.42 : 0.15));
  hollow.addColorStop(0.34, rgba(colors.pause, colors.isDark ? 0.15 : 0.09));
  hollow.addColorStop(1, rgba(colors.pause, colors.isDark ? 0.26 : 0.19));
  ctx.fillStyle = hollow;
  ctx.fillRect(left, geo.channelTop + 1, right - left, geo.channelBottom - geo.channelTop - 2);

  // 两端的竖直断面让缺口有明确边界，而不是一片模糊的浅色。
  ctx.fillStyle = rgba(colors.pause, 0.34);
  if (input.x0 >= 0)
    ctx.fillRect(left, geo.channelTop + 1, 1, geo.channelBottom - geo.channelTop - 2);
  if (input.x1 <= geo.width) {
    ctx.fillRect(right - 1, geo.channelTop + 1, 1, geo.channelBottom - geo.channelTop - 2);
  }

  const scarY = geo.materialBottom - 0.5;
  ctx.fillStyle = rgba(colors.pause, 0.62);
  ctx.fillRect(left, scarY, right - left, 1.4);

  // 确定性残点：疤痕上方一层极淡的灰烬痕迹，永远不随帧变化。
  const ash = particleAshColor(colors.pause, colors.muted);
  const stripTop = Math.max(geo.materialTop, scarY - 26);
  for (let cellX = Math.floor(left / 9); cellX * 9 <= right; cellX += 1) {
    for (let cellY = Math.floor(stripTop / 9); cellY * 9 <= scarY; cellY += 1) {
      const dot = traceResidueDot(cellX, cellY);
      if (!dot.present) continue;
      const x = cellX * 9 + dot.offsetX;
      const y = cellY * 9 + dot.offsetY;
      if (x < left || x > right || y < stripTop || y > scarY) continue;
      ctx.fillStyle = rgba(ash, dot.alpha * 2.4);
      ctx.fillRect(x, y, 1.3, 1.3);
    }
  }
}

/** @returns 本帧是否真的画出了粒子。 */
function drawPauseDissipation(
  ctx: CanvasRenderingContext2D,
  geo: BandGeometry,
  colors: BandColors,
  input: {
    nowMs: number;
    startedAtMs: number;
    endedAtMs: number | null;
    frontierX: number;
    sourceWidth: number;
    reducedMotion: boolean;
  },
): boolean {
  const sourceWidth = input.sourceWidth;
  const particles = pauseFrontierDissolveParticles(
    input.nowMs,
    input.startedAtMs,
    input.endedAtMs,
    sourceWidth,
    input.reducedMotion,
    1,
  );
  if (particles.length === 0) return false;

  const fieldHeight = geo.materialBottom - geo.materialTop;
  const ash = particleAshColor(colors.pause, colors.muted);
  const hot = mixRgb(colors.pause, colors.light, 0.45);

  ctx.save();
  for (const particle of particles) {
    const originX = input.frontierX - sourceWidth + particle.originOffsetX;
    const x = originX + particle.travelX;
    const y = geo.materialTop + particle.originRatioY * fieldHeight + particle.travelY;
    if (x < -12 || x > geo.width + 12 || y < -18 || y > geo.height + 12) continue;

    const color =
      particle.kind === 'spark'
        ? mixRgb(hot, ash, particle.progress)
        : mixRgb(colors.pause, ash, particle.progress * 0.92);
    ctx.fillStyle = rgba(color, particle.alpha);

    if (particle.kind === 'grain') {
      ctx.fillRect(x - particle.size / 2, y - particle.size / 2, particle.size, particle.size);
    } else if (particle.kind === 'flake') {
      // 薄片保留朝向：翻滚的碎屑比等距圆点更像「剥落」。
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(particle.rotation);
      ctx.fillRect(
        -particle.size * 0.62,
        -particle.size * 0.3,
        particle.size * 1.24,
        Math.max(0.6, particle.size * 0.6),
      );
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.35, particle.size * 0.42), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  return true;
}

/* ─── 刻度 ─────────────────────────────────────────────────── */

function drawRulerTicks(
  ctx: CanvasRenderingContext2D,
  geo: BandGeometry,
  colors: BandColors,
  input: {
    cameraSeconds: number;
    nowSeconds: number;
    visibleStartSec: number;
    visibleEndSec: number;
    toX: (ms: number) => number;
    scale: number;
    nearAlpha: number;
    farAlpha: number;
    fontNumber: string;
    fontSmallNumber: string;
  },
): void {
  const { channelTop, channelBottom, width } = geo;
  ctx.textAlign = 'center';

  const majorTick = (x: number, alpha: number) => {
    ctx.fillStyle = rgba(colors.light, alpha * 0.5);
    ctx.fillRect(x + 0.7, channelTop, 1, channelBottom - channelTop);
    ctx.fillStyle = rgba(colors.ink, alpha);
    ctx.fillRect(x, channelTop, 1, channelBottom - channelTop);
  };
  const edgeTick = (x: number, length: number, alpha: number) => {
    ctx.fillStyle = rgba(colors.ink, alpha);
    ctx.fillRect(x, channelTop + 1, 1, length);
    ctx.fillRect(x, channelBottom - 1 - length, 1, length);
  };

  if (input.nearAlpha > 0.02) {
    for (
      let second = Math.max(0, Math.floor(input.visibleStartSec) - 1);
      second <= input.visibleEndSec + 1;
      second += 1
    ) {
      const x = Math.round(input.toX(second * 1000));
      if (x < -1 || x > width + 1) continue;
      const future = second > input.nowSeconds;
      const minute = positiveMod(second, 60) === 0;
      const fiveSecond = positiveMod(second, 5) === 0;

      if (minute) {
        majorTick(x, (future ? 0.1 : 0.2) * input.nearAlpha);
        ctx.fillStyle = rgba(colors.text, (future ? 0.45 : 0.86) * input.nearAlpha);
        ctx.font = input.fontNumber;
        ctx.fillText(wallClockTickLabel(second), x, channelTop - 8);
      } else {
        const length = fiveSecond ? 9 : 4.5;
        edgeTick(x, length, (future ? 0.16 : fiveSecond ? 0.4 : 0.24) * input.nearAlpha);
        if (fiveSecond && input.nearAlpha > 0.55) {
          ctx.fillStyle = rgba(colors.subtle, 0.78 * input.nearAlpha);
          ctx.font = input.fontSmallNumber;
          ctx.fillText(
            `:${String(positiveMod(second, 60)).padStart(2, '0')}`,
            x,
            channelBottom + 13,
          );
        }
      }
    }
  }

  if (input.farAlpha > 0.02) {
    // 总览尺度随会话长度变化，刻度步长必须跟着走，否则标签不是挤成一团就是一根不剩。
    const step = overviewTickStepSec(input.scale);
    const majorStep = overviewMajorStepSec(step);
    const firstTick = Math.max(0, Math.floor(input.visibleStartSec / step) * step);
    for (let second = firstTick; second <= input.visibleEndSec + step; second += step) {
      const x = Math.round(input.toX(second * 1000));
      if (x < -1 || x > width + 1) continue;
      const future = second > input.nowSeconds;
      const major = positiveMod(second, majorStep) === 0;
      const tenMinute = positiveMod(second, step * 2) === 0;

      if (major) {
        majorTick(x, (future ? 0.1 : 0.2) * input.farAlpha);
        ctx.fillStyle = rgba(colors.text, (future ? 0.45 : 0.86) * input.farAlpha);
        ctx.font = input.fontNumber;
        ctx.fillText(wallClockTickLabel(second), x, channelTop - 8);
      } else {
        edgeTick(
          x,
          tenMinute ? 10 : 5.5,
          (future ? 0.16 : tenMinute ? 0.4 : 0.24) * input.farAlpha,
        );
        if (tenMinute && input.farAlpha > 0.62) {
          ctx.fillStyle = rgba(colors.subtle, 0.74 * input.farAlpha);
          ctx.font = input.fontSmallNumber;
          ctx.fillText(wallClockTickLabel(second), x, channelBottom + 13);
        }
      }
    }
  }
}

/* ─── 指针 ─────────────────────────────────────────────────── */

function drawNowPointer(
  ctx: CanvasRenderingContext2D,
  geo: BandGeometry,
  colors: BandColors,
  input: {
    pointerX: number;
    state: TimerState;
    pulseAgeMs: number;
    reducedMotion: boolean;
    fontUi: string;
    label: '现在' | '最后记录' | '待机';
  },
): void {
  const { channelTop, channelBottom, height } = geo;
  const active = input.state === 'running' || input.state === 'paused';
  const stateColor = input.state === 'paused' ? colors.pause : colors.accent;

  if (active) {
    const breath = pointerBreathPulse(input.pulseAgeMs, input.reducedMotion);
    const centerY = (channelTop + channelBottom) / 2;
    const radius = 22 + breath * 9;
    const glow = ctx.createRadialGradient(
      input.pointerX,
      centerY,
      0,
      input.pointerX,
      centerY,
      radius,
    );
    const glowAlpha = POINTER_GLOW_MAX_ALPHA * (0.35 + 0.65 * breath);
    glow.addColorStop(0, rgba(stateColor, glowAlpha));
    glow.addColorStop(0.55, rgba(stateColor, glowAlpha * 0.38));
    glow.addColorStop(1, rgba(stateColor, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(
      input.pointerX - radius,
      channelTop - 14,
      radius * 2,
      channelBottom - channelTop + 28,
    );

    // 前沿窄条：运行时是强调色刀口，暂停时是正在被烧掉的红色断面。
    ctx.fillStyle = rgba(
      stateColor,
      frontierGlowAlpha(input.pulseAgeMs, input.reducedMotion) * 2.6,
    );
    ctx.fillRect(input.pointerX - 3, channelTop + 1, 3, channelBottom - channelTop - 2);
  }

  ctx.fillStyle = active ? rgba(stateColor, 0.95) : rgba(colors.ink, 0.6);
  ctx.fillRect(
    input.pointerX - 0.5,
    Math.max(2, channelTop - 16),
    1,
    channelBottom - channelTop + 20,
  );

  ctx.beginPath();
  ctx.moveTo(input.pointerX - 5, channelBottom + 2.5);
  ctx.lineTo(input.pointerX + 5, channelBottom + 2.5);
  ctx.lineTo(input.pointerX, channelBottom + 8);
  ctx.closePath();
  ctx.fill();

  ctx.font = input.fontUi;
  ctx.textAlign = 'center';
  ctx.fillStyle = rgba(colors.text, 0.82);
  ctx.fillText(input.label, input.pointerX, Math.min(height - 5, channelBottom + 21));
}

/* ─── 工具 ─────────────────────────────────────────────────── */

function rgba(color: RgbTuple, alpha: number): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${Math.max(0, Math.min(1, alpha))})`;
}

function positiveMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 时长的口语化短标签：总览尺度是动态的，刻度说明必须跟着变。 */
function formatSpanLabel(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} 秒`;
  if (seconds < 3600) {
    const minutes = seconds / 60;
    return `${minutes < 10 ? Math.round(minutes * 10) / 10 : Math.round(minutes)} 分钟`;
  }
  const hours = seconds / 3600;
  return `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)} 小时`;
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
