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
/** 暂停态每秒侵蚀动作窗口；碎片必须在下一秒前熄灭。 */
export const BAND_PAUSE_MOTION_MS = 860;

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
  kind: 'shard' | 'dust';
  originOffsetX: number;
  originRatioY: number;
  travelX: number;
  travelY: number;
  size: number;
  rotation: number;
  alpha: number;
};

/** 暂停侵蚀的确定性粒子；出生点始终绑定真实红色材料前沿。 */
export function pauseErosionParticles(
  elapsedMs: number,
  materialWidth: number,
  reducedMotion: boolean,
): PauseErosionParticle[] {
  if (reducedMotion || materialWidth <= 0) return [];
  const phaseMs = Math.max(0, elapsedMs % 1000);
  if (phaseMs >= BAND_PAUSE_MOTION_MS) return [];

  const eventSecond = Math.max(0, Math.floor(elapsedMs / 1000));
  const life = phaseMs / BAND_PAUSE_MOTION_MS;
  const easedLife = 1 - Math.pow(1 - life, 2.2);
  const birthWidth = Math.min(materialWidth, 24);

  return Array.from({ length: 9 }, (_, index) => {
    const seed = eventSecond * 61.73 + index * 29.17;
    const kind = index < 3 ? 'shard' : 'dust';
    const coarse = kind === 'shard';
    const upwardDust = !coarse && index % 3 === 0;
    const gravity = easedLife * easedLife * (coarse ? 12 : 7);
    return {
      kind,
      originOffsetX: birthWidth * (0.08 + hash01(seed + 2.7) * 0.84),
      originRatioY: 0.08 + hash01(seed + 7.3) * 0.78,
      travelX: easedLife * (coarse ? 7 + hash01(seed + 11.9) * 12 : 3 + hash01(seed + 11.9) * 8),
      travelY:
        easedLife * (upwardDust ? -(2 + hash01(seed + 17.1) * 4) : 2 + hash01(seed + 17.1) * 7) +
        gravity,
      size:
        (coarse ? 2 + hash01(seed + 23.7) * 2.4 : 0.65 + hash01(seed + 23.7) * 1.05) *
        (1 - life * 0.72),
      rotation: (hash01(seed + 31.3) - 0.5) * 1.5 + easedLife * (coarse ? 1.45 : 0.55),
      alpha: (coarse ? 0.92 : 0.68) * (1 - life) ** 1.35,
    };
  });
}

/** 打孔数量随暂停成本增长，但以平方根减速。 */
export function pauseErosionHoleCount(elapsedMs: number): number {
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return Math.min(34, 7 + Math.floor(Math.sqrt(elapsedSeconds + 1) * 3.2));
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
