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
export const BAND_ZOOM_MS = 720;

/** 时间之带的目标尺度：专注=秒级近景；暂停/空闲/结束=远景 */
export function bandScaleForState(state: TimerState | string): number {
  return state === 'running' ? BAND_SCALE_NEAR : BAND_SCALE_FAR;
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

/** 刻度层透明度：秒刻度在近景清晰、变焦中随密度淡出；远景层互补 */
export function secondTickAlpha(scalePxPerSec: number): number {
  return clamp01((scalePxPerSec - 2.2) / 1.8);
}
export function macroTickAlpha(scalePxPerSec: number): number {
  return 1 - secondTickAlpha(scalePxPerSec);
}

/** 变焦进度：返回当前尺度；完成时返回 null 表示动画结束 */
export function zoomProgress(animStartMs: number, nowMs: number, durationMs: number): number {
  return clamp01((nowMs - animStartMs) / durationMs);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
