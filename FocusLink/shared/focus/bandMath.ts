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

export type PauseDissolveParticle = {
  id: string;
  kind: 'shard' | 'dust' | 'spark';
  originOffsetX: number;
  originRatioY: number;
  travelX: number;
  travelY: number;
  size: number;
  rotation: number;
  alpha: number;
  progress: number;
};

/**
 * 暂停消散的确定性粒子。每秒先用规则采样点组成一片完整的时间切片，再由右向左
 * 逐层剥离；相邻批次交叠，形成「实体 → 碎裂 → 漂移 → 熄灭」的连续循环。
 */
export function pauseDissolveParticles(
  elapsedMs: number,
  sourceWidth: number,
  reducedMotion: boolean,
): PauseDissolveParticle[] {
  if (reducedMotion || sourceWidth <= 0) return [];
  const elapsedSeconds = Math.max(0, elapsedMs / 1000);
  const currentSecond = Math.floor(elapsedSeconds);
  const particles: PauseDissolveParticle[] = [];
  const columns = 8;
  const rows = 18;
  const sampleCount = columns * rows;

  for (
    let cohortSecond = Math.max(0, currentSecond - 2);
    cohortSecond <= currentSecond;
    cohortSecond += 1
  ) {
    for (let index = 0; index < sampleCount; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const seed = cohortSecond * 61.73 + index * 29.17;
      const kind: PauseDissolveParticle['kind'] =
        index % 13 === 0 ? 'spark' : index % 7 === 0 ? 'shard' : 'dust';
      const coarse = kind === 'shard';
      const spark = kind === 'spark';
      const columnFromFront = (columns - 1 - column) / (columns - 1);
      const releaseDelay = columnFromFront * 0.34 + hash01(seed + 1.1) * 0.1 + (row % 3) * 0.012;
      const ageSeconds = elapsedSeconds - (cohortSecond + releaseDelay);
      const lifespan = spark
        ? 0.72 + hash01(seed + 4.3) * 0.3
        : coarse
          ? 1.28 + hash01(seed + 4.3) * 0.45
          : 1.42 + hash01(seed + 4.3) * 0.5;
      if (ageSeconds >= lifespan) continue;

      const life = clamp01(Math.max(0, ageSeconds) / lifespan);
      const easedLife = 1 - Math.pow(1 - life, 2.25);
      const turbulenceX = Math.sin(life * 9 + seed) * 8 * life;
      const turbulenceY = Math.cos(life * 7 + seed * 0.7) * 6 * life;
      const lift = hash01(seed + 9.5) - 0.58;
      const drift = coarse
        ? 28 + hash01(seed + 11.9) * 38
        : spark
          ? 42 + hash01(seed + 11.9) * 44
          : 20 + hash01(seed + 11.9) * 38;
      const gravity = easedLife * easedLife * (coarse ? 19 : spark ? 5 : 11);
      const baseSize = 2.65 + hash01(seed + 23.7) * 1.25;

      particles.push({
        id: `${cohortSecond}-${index}`,
        kind,
        originOffsetX: sourceWidth * columnFromFront,
        originRatioY: clamp01((row + 0.5 + (hash01(seed + 7.3) - 0.5) * 0.22) / rows),
        travelX: easedLife * drift + turbulenceX,
        travelY: lift * easedLife * (spark ? 32 : coarse ? 27 : 22) + gravity + turbulenceY,
        size: baseSize * Math.max(0.16, 1 - life * (coarse ? 0.66 : 0.78)),
        rotation: (hash01(seed + 31.3) - 0.5) * 0.12 + easedLife * (coarse ? 3 : 1.4),
        alpha: (0.88 + hash01(seed + 37.1) * 0.12) * Math.pow(1 - life, spark ? 0.92 : 1.18),
        progress: life,
      });
    }
  }

  return particles;
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
