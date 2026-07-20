// 时间之带（TemporalRibbon）的纯函数内核：缩放状态机、逐秒步进、变焦插值。
// 与渲染解耦，供 canvas 组件与 vitest 共用。
import type { TimerState } from '../types';

/** 秒级近景：px/秒（1 分钟大格 = 480px） */
export const BAND_SCALE_NEAR = 8;
/** 远景：px/秒（30 分钟大格 ≈ 420px） */
export const BAND_SCALE_FAR = 0.2333;
/** 指针固定在带宽的比例位置（左侧为已过去的时间） */
export const BAND_POINTER_RATIO = 0.62;
/** 每秒擒纵步进时长（ms） */
export const BAND_TICK_MS = 130;
/** 近景/远景变焦时长（ms） */
export const BAND_ZOOM_MS = 820;

/** 运行态每秒释放后的可见机械动作窗口；其余时间画面保持稳定。 */
export const BAND_RUNNING_MOTION_MS = 420;
/** 暂停态粒子持续流动；相邻秒的发射批次会重叠，避免整秒边界跳变。 */
export const BAND_PAUSE_MOTION_MS = 1000;

/**
 * 结束后保留结算画面的时间。必须长于拉远动画与完成提示的组合时长，
 * 避免刚冻结的时间之带被自动归零打断。
 */
export const FINISHED_PRESENTATION_HOLD_MS = 3_000;

/** 时间之带的目标尺度：专注=秒级近景；暂停/空闲/结束=远景 */
export function bandScaleForState(state: TimerState | string): number {
  return state === 'running' ? BAND_SCALE_NEAR : BAND_SCALE_FAR;
}

/** 专注使用墙钟秒；暂停从暂停起点重新对齐秒循环。 */
export function bandEventClockMs(
  state: TimerState | string,
  nowMs: number,
  pauseStartedAt: number | null,
): number {
  return state === 'paused' && pauseStartedAt !== null
    ? Math.max(0, nowMs - pauseStartedAt)
    : Math.max(0, nowMs);
}

export function bandEventPhaseMs(
  state: TimerState | string,
  nowMs: number,
  pauseStartedAt: number | null,
): number {
  return bandEventClockMs(state, nowMs, pauseStartedAt) % 1000;
}

export function bandEventSecond(
  state: TimerState | string,
  nowMs: number,
  pauseStartedAt: number | null,
): number {
  return Math.floor(bandEventClockMs(state, nowMs, pauseStartedAt) / 1000);
}

export function easeInOutQuart(t: number): number {
  return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

/** 擒纵式步进：快速弹出后 40ms 内轻微回稳 */
export function easeOutStep(t: number): number {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3) * (1 + 2 * c * 0.4);
}

/**
 * 变焦尺度插值：对数空间插值，等比缩放在视觉上才是匀速拉远/推近。
 * progress ∈ [0,1]（调用方已应用 easing）。
 */
export function interpolateZoomScale(from: number, to: number, progress: number): number {
  const p = clamp01(progress);
  return Math.exp((1 - p) * Math.log(from) + p * Math.log(to));
}

/**
 * 逐秒显示时间（秒）：秒边界后 BAND_TICK_MS 内从上一秒步进到当前秒，
 * 其余时间停在整秒——机械擒纵感，而非连续漂移。
 * reducedMotion 时直接吸附到整秒。
 */
export function steppedDisplaySeconds(nowMs: number, reducedMotion: boolean): number {
  const nowSec = nowMs / 1000;
  const whole = Math.floor(nowSec);
  if (reducedMotion) return whole;
  const frac = nowSec - whole;
  const p = clamp01(frac / (BAND_TICK_MS / 1000));
  return whole - 1 + easeOutStep(p);
}

/** 活动态按秒推进；空闲/结束永远冻结在记录锚点，不能跟随系统时钟漂移。 */
export function bandDisplaySeconds(
  state: TimerState | string,
  nowMs: number,
  anchorMs: number,
  reducedMotion: boolean,
): number {
  return state === 'running' || state === 'paused'
    ? steppedDisplaySeconds(nowMs, reducedMotion)
    : Math.floor(anchorMs / 1000);
}

/** 刻度层透明度：秒刻度在近景清晰、变焦中随密度淡出；远景层互补 */
export function secondTickAlpha(scalePxPerSec: number): number {
  return clamp01((scalePxPerSec - 2.2) / 1.8);
}
export function macroTickAlpha(scalePxPerSec: number): number {
  return 1 - secondTickAlpha(scalePxPerSec);
}

/** 对数尺度下的镜头细节混合量：0 为远景，1 为秒级近景。 */
export function bandDetailMix(scalePxPerSec: number): number {
  const span = Math.log(BAND_SCALE_NEAR) - Math.log(BAND_SCALE_FAR);
  const raw = (Math.log(Math.max(BAND_SCALE_FAR, scalePxPerSec)) - Math.log(BAND_SCALE_FAR)) / span;
  const clamped = clamp01(raw);
  return clamped * clamped * (3 - 2 * clamped);
}

export type PauseErosionParticle = {
  id: string;
  kind: 'shard' | 'dust' | 'spark';
  originOffsetX: number;
  originRatioY: number;
  travelX: number;
  travelY: number;
  size: number;
  rotation: number;
  alpha: number;
};

/**
 * 暂停消散的确定性粒子。相邻两秒的发射批次会重叠：碎片先剥离，尘点拖出尾迹，
 * 火花更快熄灭。函数只返回当前仍存活的粒子，因此不会在整秒边界整批换帧。
 */
export function pauseErosionParticles(
  elapsedMs: number,
  materialWidth: number,
  reducedMotion: boolean,
): PauseErosionParticle[] {
  if (reducedMotion || materialWidth <= 0) return [];
  const elapsedSeconds = Math.max(0, elapsedMs / 1000);
  const currentSecond = Math.floor(elapsedSeconds);
  const birthWidth = Math.min(materialWidth, 16);
  const particles: PauseErosionParticle[] = [];

  for (
    let cohortSecond = Math.max(0, currentSecond - 1);
    cohortSecond <= currentSecond;
    cohortSecond += 1
  ) {
    for (let index = 0; index < 32; index += 1) {
      const seed = cohortSecond * 61.73 + index * 29.17;
      const kind: PauseErosionParticle['kind'] =
        index % 7 === 0 ? 'shard' : index % 5 === 0 ? 'spark' : 'dust';
      const coarse = kind === 'shard';
      const spark = kind === 'spark';
      const birthOffset = (index / 32) * 0.76 + hash01(seed + 1.1) * 0.035;
      const ageSeconds = elapsedSeconds - (cohortSecond + birthOffset);
      const lifespan = spark
        ? 0.3 + hash01(seed + 4.3) * 0.2
        : coarse
          ? 0.82 + hash01(seed + 4.3) * 0.28
          : 0.92 + hash01(seed + 4.3) * 0.42;
      if (ageSeconds < 0 || ageSeconds >= lifespan) continue;

      const life = clamp01(ageSeconds / lifespan);
      const easedLife = 1 - Math.pow(1 - life, 2.25);
      const direction = index % 9 === 0 ? -0.32 : 1;
      const lift = index % 3 === 0 ? -1 : 1;
      const drift = coarse
        ? 11 + hash01(seed + 11.9) * 17
        : spark
          ? 19 + hash01(seed + 11.9) * 24
          : 7 + hash01(seed + 11.9) * 16;
      const gravity = easedLife * easedLife * (coarse ? 14 : spark ? 2 : 7);
      const fadeIn = clamp01(ageSeconds / (spark ? 0.025 : 0.055));

      particles.push({
        id: `${cohortSecond}-${index}`,
        kind,
        originOffsetX: birthWidth * (0.04 + hash01(seed + 2.7) * 0.92),
        originRatioY: 0.06 + hash01(seed + 7.3) * 0.86,
        travelX: direction * easedLife * drift,
        travelY: lift * easedLife * (2 + hash01(seed + 17.1) * (spark ? 10 : 7)) + gravity,
        size:
          (coarse
            ? 2.4 + hash01(seed + 23.7) * 3.5
            : spark
              ? 0.9 + hash01(seed + 23.7) * 1.3
              : 0.9 + hash01(seed + 23.7) * 1.7) * Math.max(0.12, 1 - life * (coarse ? 0.78 : 0.9)),
        rotation:
          (hash01(seed + 31.3) - 0.5) * 1.9 + easedLife * (coarse ? 2.4 : spark ? 0.24 : 0.9),
        alpha:
          fadeIn * (coarse ? 0.98 : spark ? 0.96 : 0.82) * Math.pow(1 - life, spark ? 1.05 : 1.38),
      });
    }
  }

  return particles;
}

/** 材料残痕只作粒子消散的次级底纹，随暂停增长但保持低密度。 */
export function pauseErosionHoleCount(elapsedMs: number): number {
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return Math.min(16, 3 + Math.floor(Math.sqrt(elapsedSeconds + 1) * 1.35));
}

/** 变焦进度：返回当前尺度；完成时返回 null 表示动画结束 */
export function zoomProgress(animStartMs: number, nowMs: number, durationMs: number): number {
  return clamp01((nowMs - animStartMs) / durationMs);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
