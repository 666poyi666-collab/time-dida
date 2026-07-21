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
  if (whole === 0) return 0;
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

/* ─── 粒子场内核：整条过去的时间带是同一片确定性粒子场 ───
 * 粒子锚定在世界坐标（秒），只随时间轴平移/缩放；所有空间与颜色决策都是
 * 网格坐标的纯函数，因此 idle/finished 画面可以像素级冻结。
 */

export type RgbTuple = readonly [number, number, number];

/** 粒子单元格在屏幕上的目标边长（px）；缩放时按时长梯子重新取样。 */
export const PARTICLE_FIELD_CELL_PX = 3;
/** 暂停段与专注段共用粒子场引擎，但基础密度更低。 */
export const PARTICLE_FIELD_PAUSE_DENSITY = 0.45;

const PARTICLE_STEP_LADDER_SEC = [
  0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800,
];

/**
 * 粒子网格的单元时长（秒）：选择梯子上第一个让屏幕单元边长
 * ≥ 2.4px 的时长，使近景/远景/变焦途中都保持可读的颗粒度。
 */
export function particleFieldStepSec(scalePxPerSec: number): number {
  const scale = Math.max(1e-6, scalePxPerSec);
  for (const step of PARTICLE_STEP_LADDER_SEC) {
    if (step * scale >= PARTICLE_FIELD_CELL_PX * 0.8) return step;
  }
  return PARTICLE_STEP_LADDER_SEC[PARTICLE_STEP_LADDER_SEC.length - 1];
}

/**
 * 整数网格坐标的确定性 hash，返回值 ∈ [0,1)。
 * 坐标先折叠到 16bit，保证超大世界坐标（秒级时间戳/单元时长）下仍然精确。
 */
export function particleCellHash(ix: number, iy: number): number {
  const x = positiveModulo(Math.round(ix), 65536);
  const y = positiveModulo(Math.round(iy), 65536);
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export type FieldParticleSpec = {
  /** 单元内的确定性偏移比例（0..1，乘以单元边长） */
  offsetX: number;
  offsetY: number;
  /** 尺寸系数（0.5..1.4，乘以单元边长，最小 1.2px 由调用方保证） */
  sizeK: number;
  /** 基础旋转角（0..2π），也用作摆动相位 */
  phase: number;
  /** 颜色档位（0..1，三档：主体/深色/浅色） */
  tone: number;
  /** 垂直散开方向（-1..1） */
  dir: number;
  /** 上浮系数（0..1） */
  riseK: number;
  /** 死亡阈值（0.3..1）：距离系数 s 超过它时粒子永久消失 */
  deathK: number;
};

/** 单个网格单元的确定性粒子参数；同一 (ix, iy) 永远得到同一份规格。 */
export function fieldParticleSpec(ix: number, iy: number): FieldParticleSpec {
  const r1 = particleCellHash(ix, iy);
  const r2 = particleCellHash(iy, ix ^ 0x9e37);
  const r3 = particleCellHash(ix ^ 0x51ed, iy * 7 + 1);
  return {
    offsetX: r1,
    offsetY: r2,
    sizeK: 0.5 + r3 * 0.9,
    phase: r1 * Math.PI * 2,
    tone: r2,
    dir: r2 * 2 - 1,
    riseK: r3,
    deathK: 0.3 + r1 * 0.7,
  };
}

export type ParticleFieldParams = {
  /** 距离系数（smoothstep，0 = 紧贴“现在”，1 = 远端） */
  s: number;
  /** 生成概率：0.95（几乎实心）→ 0.20（远端稀薄） */
  spawnProb: number;
  /** 基础透明度：0.96 → 0.28 */
  alpha: number;
  /** 垂直散开幅度（px）：1.5 → 35.5，远端超出时间带上下沿 */
  scatter: number;
  /** 上浮幅度（px）：0 → 16 */
  rise: number;
};

/**
 * 按距“现在”指针的屏幕距离给出粒子场参数。
 * 紧贴指针的 compact 区几乎实心；随后在半视宽内 smoothstep 过渡到稀疏。
 */
export function particleFieldParams(
  behindPx: number,
  viewportWidthPx: number,
  scalePxPerSec: number,
): ParticleFieldParams {
  const width = Math.max(120, viewportWidthPx);
  const compact = clampRange(6 * scalePxPerSec, 12, Math.max(24, width * 0.08));
  const range = Math.max(240, width * 0.5);
  const k = clamp01((Math.max(0, behindPx) - compact) / range);
  const s = k * k * (3 - 2 * k);
  return {
    s,
    spawnProb: 0.95 - s * 0.75,
    alpha: 0.96 - s * 0.68,
    scatter: 1.5 + s * 34,
    rise: s * 16,
  };
}

/** 痕迹层（渍痕/斜纹/轮廓/残点）强度随距“现在”渐淡。 */
export function particleTraceFade(
  behindPx: number,
  viewportWidthPx: number,
  scalePxPerSec: number,
): number {
  return 1 - particleFieldParams(behindPx, viewportWidthPx, scalePxPerSec).s * 0.72;
}

/** 三档粒子色：tone < .5 主体色，< .8 深色，其余为偏向浅色的高光。 */
export function particleToneColor(
  tone: number,
  base: RgbTuple,
  deep: RgbTuple,
  soft: RgbTuple,
): RgbTuple {
  if (tone < 0.5) return base;
  if (tone < 0.8) return deep;
  return mixRgb(base, soft, 0.55);
}

/** 灰烬色：段落色大幅褪向主题灰，亮色/暗色与五套强调色都成立。 */
export function particleAshColor(base: RgbTuple, muted: RgbTuple): RgbTuple {
  return mixRgb(base, muted, 0.72);
}

/** 年龄混色：随距离系数 s 以 k = s*0.88 褪向灰烬色。 */
export function particleAgedColor(color: RgbTuple, ash: RgbTuple, s: number): RgbTuple {
  return mixRgb(color, ash, clamp01(s) * 0.88);
}

export type TraceResidueDot = {
  present: boolean;
  /** 单元内偏移（px，0..7） */
  offsetX: number;
  offsetY: number;
  /** 基础透明度（0.04..0.11），调用方再乘以距离渐淡 */
  alpha: number;
};

/** 痕迹残点：7px 网格上 14% 出现率的确定性 1.3px 残点。 */
export function traceResidueDot(cellX: number, cellY: number): TraceResidueDot {
  const presence = particleCellHash(cellX, cellY);
  const scatter = particleCellHash(cellY, cellX ^ 0x9e37);
  return {
    present: presence <= 0.14,
    offsetX: presence * 7,
    offsetY: scatter * 7,
    alpha: 0.04 + scatter * 0.07,
  };
}

/* ─── 质感层：呼吸辉光 / 燃烧头光晕 / 网格交叉淡化 / 粒子场淡入 ───
 * 全部为纯函数：只依赖秒相位与时间戳，不引入新状态，不改变粒子场
 * 锚定 displaySeconds 的确定性冻结语义（idle/finished  settle 后像素不变）。
 */

/** “现在”指针呼吸辉光的最大不透明度（低透明度光效约束 ≤0.18） */
export const POINTER_GLOW_MAX_ALPHA = 0.18;
/** 变焦跨越粒子取样梯子阈值时，旧/新网格交叉淡化时长（ms） */
export const PARTICLE_GRID_CROSSFADE_MS = 400;
/** 从 idle 开始专注时粒子场的带尾淡入时长（ms） */
export const PARTICLE_FIELD_FADE_IN_MS = 300;

/**
 * 每秒一次的呼吸脉冲：擒纵步进后点亮，随秒内相位指数回落。
 * reduced-motion 返回固定中值（静态辉光，不随时间变化）。
 */
export function pointerBreathPulse(pulseAgeMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0.4;
  const p = clamp01(Math.max(0, pulseAgeMs) / 1000);
  return Math.pow(1 - p, 1.6);
}

/**
 * 运行前沿窄条辉光的不透明度：静态基底 + 随呼吸脉冲轻微增强，峰值 ≤0.18。
 * reduced-motion 返回固定基底（静态）。
 */
export function frontierGlowAlpha(pulseAgeMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0.08;
  return 0.08 + 0.08 * pointerBreathPulse(pulseAgeMs, false);
}

export type BurnHeadHalo = {
  /** 光晕半径（px） */
  radius: number;
  /** 光晕峰值不透明度（≤0.18） */
  alpha: number;
};

/**
 * 暂停引线燃烧头的外层红晕参数：白芯之外的柔和光晕随秒相位轻微呼吸。
 * reduced-motion 返回固定参数，画面静态。
 */
export function burnHeadHalo(pulseAgeMs: number, reducedMotion: boolean): BurnHeadHalo {
  if (reducedMotion) return { radius: 12, alpha: 0.12 };
  const p = clamp01(Math.max(0, pulseAgeMs) / 1000);
  const breath = Math.pow(1 - p, 1.4);
  return { radius: 11 + breath * 3.5, alpha: 0.1 + breath * 0.08 };
}

/**
 * 粒子网格交叉淡化进度：fadeStartMs 为 null（无重排）或淡化已结束时返回 1，
 * 否则在 PARTICLE_GRID_CROSSFADE_MS 内从 0 线性推进到 1。
 * 返回值是新网格权重；旧网格权重为 1 - 返回值。
 */
export function particleGridCrossfade(fadeStartMs: number | null, nowMs: number): number {
  if (fadeStartMs === null) return 1;
  return clamp01((nowMs - fadeStartMs) / PARTICLE_GRID_CROSSFADE_MS);
}

/**
 * 粒子场淡入系数（idle → 专注）：300ms 内以 ease-out 带尾曲线升到 1。
 * reduced-motion 直接返回 1（立即完整显示，无动画）。
 */
export function particleFieldFadeIn(
  fadeStartMs: number | null,
  nowMs: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion || fadeStartMs === null) return 1;
  const t = clamp01((nowMs - fadeStartMs) / PARTICLE_FIELD_FADE_IN_MS);
  return 1 - Math.pow(1 - t, 3);
}

export function mixRgb(a: RgbTuple, b: RgbTuple, k: number): RgbTuple {
  const t = clamp01(k);
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
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
  temperature: number;
};

/**
 * 暂停引线的确定性余烬。粒子像从燃烧头后方的短路径中剥离：
 * - 粉尘与碎屑主要向上、略向左飘散；
 * - 火花短促、寿命短、亮度高；
 * -  origin 集中在引线路径附近，不铺满整段区域；
 * - 相邻秒批次在时间与空间上连续交叠，秒边界只提供稳定种子，不重置画面。
 *
 * @param densityScale 渲染尺度倍率；小窗用 0.4~0.5 降低密度，主界面默认 1。
 */
export function pauseDissolveParticles(
  elapsedMs: number,
  sourceWidth: number,
  reducedMotion: boolean,
  densityScale = 1,
): PauseDissolveParticle[] {
  if (reducedMotion || sourceWidth <= 0 || densityScale <= 0) return [];
  const elapsedSeconds = Math.max(0, elapsedMs / 1000);
  const currentSecond = Math.floor(elapsedSeconds);
  const particles: PauseDissolveParticle[] = [];
  const baseSamples = 72;
  const sampleCount = Math.max(18, Math.floor(baseSamples * densityScale));

  // 保留 4 个完整秒批次 + 当前秒，允许负 cohort 以维持暂停初期的连续粒子场。
  // 秒边界只提供稳定种子，不重置画面。
  for (let cohortSecond = currentSecond - 4; cohortSecond <= currentSecond; cohortSecond += 1) {
    for (let index = 0; index < sampleCount; index += 1) {
      const seed = cohortSecond * 61.73 + index * 29.17;
      const kind: PauseDissolveParticle['kind'] =
        index % 13 === 0 ? 'spark' : index % 9 === 0 ? 'shard' : 'dust';
      const coarse = kind === 'shard';
      const spark = kind === 'spark';

      // 将样本均匀分布在 cohort 秒区间内，并加入微小抖动避免网格感。
      const releaseDelay = (index / sampleCount) * 0.98 + hash01(seed + 1.1) * 0.02;
      const ageSeconds = elapsedSeconds - (cohortSecond + releaseDelay);

      const lifespan = spark
        ? 0.42 + hash01(seed + 4.3) * 0.22
        : coarse
          ? 0.78 + hash01(seed + 4.3) * 0.34
          : 0.66 + hash01(seed + 4.3) * 0.42;
      if (ageSeconds < 0 || ageSeconds >= lifespan) continue;

      const life = clamp01(ageSeconds / lifespan);
      const easedLife = 1 - Math.pow(1 - life, 2.4);
      const remaining = 1 - life;

      // 湍流：随 life 增强，最后阶段略平静。
      const turbulenceX = Math.sin(life * 13 + seed) * 4.5 * life;
      const turbulenceY = Math.cos(life * 9 + seed * 0.7) * 3 * life;

      // origin 偏向燃烧头（0），老粒子略微向后分布，形成“从头部持续剥离”感。
      const originBias = Math.pow(hash01(seed + 2.7), 1.35);
      const ageBack = Math.min(1, ageSeconds / 0.9) * 0.25;
      const originOffsetX = sourceWidth * Math.min(1, originBias * 0.9 + ageBack);

      // 垂直方向紧紧贴在引线附近（ratio ≈ 0.68），只有少量逸散。
      const originRatioY = 0.68 + (hash01(seed + 7.3) - 0.5) * 0.09;

      // 运动：以上升为主，x 方向略向左（负）并带少量侧摆。
      const sideSign = hash01(seed + 11.9) - 0.52;
      const sideDrift = sideSign * (spark ? 14 : coarse ? 10 : 8);
      const lift = 14 + hash01(seed + 17.1) * (spark ? 28 : coarse ? 20 : 16);
      const gravity = easedLife * easedLife * (spark ? 3 : 6);
      const travelX = -easedLife * (3 + life * 6) + sideDrift * easedLife + turbulenceX;
      const travelY = -easedLife * lift + gravity + turbulenceY;

      const baseSize =
        (spark ? 0.8 : coarse ? 1.6 : 1.0) + hash01(seed + 23.7) * (coarse ? 1.6 : 1.0);
      const size = baseSize * Math.max(0.12, 1 - life * (coarse ? 0.72 : 0.86));

      const rotation = spark
        ? -Math.PI / 2 + sideSign * 0.35
        : (hash01(seed + 31.3) - 0.5) * 0.6 + easedLife * (coarse ? 2.6 : 1.0);

      const alpha = (0.84 + hash01(seed + 37.1) * 0.16) * Math.pow(remaining, spark ? 1.0 : 1.35);
      const temperature = 1 - Math.pow(life, 0.75);

      particles.push({
        id: `${cohortSecond}-${index}`,
        kind,
        originOffsetX,
        originRatioY,
        travelX,
        travelY,
        size,
        rotation,
        alpha,
        progress: life,
        temperature,
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

function clampRange(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
