// 时间之带纯函数内核测试：缩放状态机、逐秒步进、变焦插值、刻度层透明度
import { describe, expect, it } from 'vitest';
import {
  BAND_PAUSE_MOTION_MS,
  BAND_SCALE_FAR,
  BAND_SCALE_NEAR,
  BAND_TICK_MS,
  bandDetailMix,
  bandDisplaySeconds,
  bandEventClockMs,
  bandEventPhaseMs,
  bandEventSecond,
  bandScaleForState,
  easeInOutQuart,
  easeOutStep,
  interpolateZoomScale,
  macroTickAlpha,
  pauseErosionHoleCount,
  pauseErosionParticles,
  secondTickAlpha,
  steppedDisplaySeconds,
} from '../shared/focus/bandMath';

describe('时间之带缩放状态机', () => {
  it('专注态进入秒级近景，其余状态使用远景', () => {
    expect(bandScaleForState('running')).toBe(BAND_SCALE_NEAR);
    expect(bandScaleForState('paused')).toBe(BAND_SCALE_FAR);
    expect(bandScaleForState('idle')).toBe(BAND_SCALE_FAR);
    expect(bandScaleForState('finished')).toBe(BAND_SCALE_FAR);
    expect(bandScaleForState('stopping')).toBe(BAND_SCALE_FAR);
  });

  it('近景一分钟大格远大于远景，远景 30 分钟占据合理宽度', () => {
    expect(BAND_SCALE_NEAR * 60).toBeGreaterThan(300);
    const farThirtyMin = BAND_SCALE_FAR * 1800;
    expect(farThirtyMin).toBeGreaterThan(300);
    expect(farThirtyMin).toBeLessThan(600);
  });
});

describe('逐秒擒纵步进', () => {
  it('暂停侵蚀从暂停起点开启独立秒周期，三个相位读数共用同一时钟', () => {
    const pauseStartedAt = 1_700_000_010_760;
    const now = pauseStartedAt + 2_345;

    expect(bandEventClockMs('paused', now, pauseStartedAt)).toBe(2_345);
    expect(bandEventSecond('paused', now, pauseStartedAt)).toBe(2);
    expect(bandEventPhaseMs('paused', now, pauseStartedAt)).toBe(345);
  });

  it('专注态仍锁定墙钟整秒，暂停起点缺失时也保持可预测退化', () => {
    const now = 1_700_000_010_345;

    expect(bandEventClockMs('running', now, null)).toBe(now);
    expect(bandEventSecond('running', now, null)).toBe(Math.floor(now / 1000));
    expect(bandEventPhaseMs('running', now, null)).toBe(345);
    expect(bandEventClockMs('paused', now, null)).toBe(now);
  });

  it('时钟输入异常时夹紧到零，不让粒子相位倒退', () => {
    expect(bandEventClockMs('paused', 900, 1_000)).toBe(0);
    expect(bandEventSecond('paused', 900, 1_000)).toBe(0);
    expect(bandEventPhaseMs('paused', 900, 1_000)).toBe(0);
  });

  it('秒边界瞬间仍停在上一秒，随后在 130ms 内步进到当前秒', () => {
    const whole = 1_700_000_010_000;
    // 边界瞬间：显示上一秒（擒纵尚未释放）
    expect(steppedDisplaySeconds(whole, false)).toBe(whole / 1000 - 1);
    // 步进中段：介于两秒之间
    const mid = steppedDisplaySeconds(whole + 60, false);
    expect(mid).toBeGreaterThan(whole / 1000 - 1);
    expect(mid).toBeLessThan(whole / 1000);
  });

  it('步进窗口内从上一秒向当前秒过渡，且不超过当前秒', () => {
    const whole = 1_700_000_010_000;
    const mid = whole + BAND_TICK_MS / 2;
    const v = steppedDisplaySeconds(mid, false);
    expect(v).toBeGreaterThan(whole / 1000 - 1);
    expect(v).toBeLessThanOrEqual(whole / 1000);
  });

  it('步进结束后稳定吸附到当前整秒', () => {
    const whole = 1_700_000_010_000;
    const after = whole + BAND_TICK_MS + 200;
    expect(steppedDisplaySeconds(after, false)).toBe(whole / 1000);
  });

  it('reduced-motion 直接吸附整秒，无中间过渡', () => {
    const whole = 1_700_000_010_000;
    expect(steppedDisplaySeconds(whole + 30, true)).toBe(whole / 1000);
  });

  it('easeOutStep 单调端点正确', () => {
    expect(easeOutStep(0)).toBeCloseTo(0, 5);
    expect(easeOutStep(1)).toBeCloseTo(1, 5);
  });
});

describe('非活动状态冻结', () => {
  it('idle 与 finished 固定在记录锚点，不随当前时间继续漂移', () => {
    const anchor = 1_700_000_010_750;
    const laterNow = anchor + 90_000;
    const muchLater = anchor + 3_600_000;

    expect(bandDisplaySeconds('idle', laterNow, anchor, false)).toBe(Math.floor(anchor / 1000));
    expect(bandDisplaySeconds('finished', muchLater, anchor, false)).toBe(
      Math.floor(anchor / 1000),
    );
  });

  it('running 与 paused 仍以真实当前时间逐秒推进', () => {
    const whole = 1_700_000_010_000;
    const afterStep = whole + BAND_TICK_MS + 200;

    expect(bandDisplaySeconds('running', afterStep, whole - 30_000, false)).toBe(whole / 1000);
    expect(bandDisplaySeconds('paused', afterStep, whole - 30_000, false)).toBe(whole / 1000);
  });
});

describe('变焦插值', () => {
  it('端点精确到达目标尺度', () => {
    expect(interpolateZoomScale(BAND_SCALE_NEAR, BAND_SCALE_FAR, 0)).toBeCloseTo(
      BAND_SCALE_NEAR,
      6,
    );
    expect(interpolateZoomScale(BAND_SCALE_NEAR, BAND_SCALE_FAR, 1)).toBeCloseTo(BAND_SCALE_FAR, 6);
  });

  it('对数空间插值：中点是几何均值而非算术均值', () => {
    const mid = interpolateZoomScale(8, 0.5, 0.5);
    expect(mid).toBeCloseTo(Math.sqrt(8 * 0.5), 6);
  });

  it('easeInOutQuart 端点与中点', () => {
    expect(easeInOutQuart(0)).toBe(0);
    expect(easeInOutQuart(1)).toBe(1);
    expect(easeInOutQuart(0.5)).toBe(0.5);
  });
});

describe('刻度层透明度随密度渐变', () => {
  it('近景秒刻度全显、远景刻度全隐', () => {
    expect(secondTickAlpha(BAND_SCALE_NEAR)).toBe(1);
    expect(macroTickAlpha(BAND_SCALE_NEAR)).toBe(0);
    expect(secondTickAlpha(BAND_SCALE_FAR)).toBe(0);
    expect(macroTickAlpha(BAND_SCALE_FAR)).toBe(1);
  });

  it('变焦中段两层交叉可见（收缩过程不是换图）', () => {
    // 对数空间下，秒刻度/远景刻度的交叉淡化发生在前段
    const mid = interpolateZoomScale(BAND_SCALE_NEAR, BAND_SCALE_FAR, 0.28);
    const nearA = secondTickAlpha(mid);
    const farA = macroTickAlpha(mid);
    expect(nearA).toBeGreaterThan(0);
    expect(nearA).toBeLessThan(1);
    expect(farA).toBeGreaterThan(0);
    expect(farA).toBeLessThan(1);
  });
});

describe('镜头细节与暂停侵蚀', () => {
  it('镜头细节在对数尺度上从远景连续过渡到近景', () => {
    expect(bandDetailMix(BAND_SCALE_FAR)).toBe(0);
    expect(bandDetailMix(BAND_SCALE_NEAR)).toBe(1);

    const oneThird = interpolateZoomScale(BAND_SCALE_FAR, BAND_SCALE_NEAR, 1 / 3);
    const twoThirds = interpolateZoomScale(BAND_SCALE_FAR, BAND_SCALE_NEAR, 2 / 3);
    expect(bandDetailMix(oneThird)).toBeGreaterThan(0);
    expect(bandDetailMix(oneThird)).toBeLessThan(bandDetailMix(twoThirds));
    expect(bandDetailMix(twoThirds)).toBeLessThan(1);
  });

  it('暂停碎片只从真实材料前沿内部出生，并在一秒内熄灭', () => {
    const materialWidth = 13.5;
    const particles = pauseErosionParticles(12_280, materialWidth, false);
    expect(particles).toHaveLength(9);
    expect(particles.filter((particle) => particle.kind === 'shard')).toHaveLength(3);
    expect(
      particles.every(
        (particle) =>
          particle.originOffsetX >= 0 &&
          particle.originOffsetX <= materialWidth &&
          particle.originRatioY >= 0 &&
          particle.originRatioY <= 1 &&
          particle.travelX >= 0 &&
          particle.size > 0 &&
          particle.alpha > 0,
      ),
    ).toBe(true);

    expect(pauseErosionParticles(12_000 + BAND_PAUSE_MOTION_MS, materialWidth, false)).toEqual([]);
    expect(pauseErosionParticles(12_280, materialWidth, true)).toEqual([]);
  });

  it('极窄远景材料的碎片仍紧贴前沿，不会凭空生成在左侧', () => {
    const materialWidth = 0.2;
    const particles = pauseErosionParticles(3_160, materialWidth, false);
    expect(particles.length).toBeGreaterThan(0);
    expect(
      particles.every(
        (particle) => particle.originOffsetX >= 0 && particle.originOffsetX <= materialWidth,
      ),
    ).toBe(true);
  });

  it('侵蚀孔洞随暂停成本增加但有上限，长暂停不会成为噪点墙', () => {
    expect(pauseErosionHoleCount(60_000)).toBeGreaterThan(pauseErosionHoleCount(1_000));
    expect(pauseErosionHoleCount(24 * 60 * 60 * 1000)).toBe(34);
  });
});
