import { describe, expect, it } from 'vitest';
import {
  BAND_SCALE_FAR,
  BAND_SCALE_NEAR,
  PARTICLE_FIELD_FADE_IN_MS,
  PARTICLE_FIELD_PAUSE_DENSITY,
  PARTICLE_GRID_CROSSFADE_MS,
  POINTER_GLOW_MAX_ALPHA,
  bandDetailMix,
  bandDisplaySeconds,
  bandScaleForState,
  burnHeadHalo,
  fieldParticleSpec,
  frontierGlowAlpha,
  interpolateZoomScale,
  macroTickAlpha,
  mixRgb,
  particleAgedColor,
  particleAshColor,
  particleCellHash,
  particleDepthProfile,
  particleFieldFadeIn,
  particleFieldParams,
  particleFieldStepSec,
  particleGridCrossfade,
  particleToneColor,
  particleTraceFade,
  pauseDissolveParticles,
  pointerBreathPulse,
  secondTickAlpha,
  steppedDisplaySeconds,
  traceResidueDot,
} from '../shared/focus/bandMath';

describe('bandMath', () => {
  describe('scale & zoom', () => {
    it('uses near scale for running and far scale otherwise', () => {
      expect(bandScaleForState('running')).toBe(BAND_SCALE_NEAR);
      expect(bandScaleForState('paused')).toBe(BAND_SCALE_FAR);
      expect(bandScaleForState('idle')).toBe(BAND_SCALE_FAR);
      expect(bandScaleForState('finished')).toBe(BAND_SCALE_FAR);
    });

    it('interpolates zoom in log space', () => {
      const from = BAND_SCALE_FAR;
      const to = BAND_SCALE_NEAR;
      const half = interpolateZoomScale(from, to, 0.5);
      expect(half).toBeGreaterThan(from);
      expect(half).toBeLessThan(to);
      // log-midpoint: ratio to from should equal to / half
      expect(half / from).toBeCloseTo(to / half, 1);
    });

    it('detail mix reaches 1 at near scale and 0 at far scale', () => {
      expect(bandDetailMix(BAND_SCALE_NEAR)).toBeCloseTo(1, 3);
      expect(bandDetailMix(BAND_SCALE_FAR)).toBeCloseTo(0, 3);
    });
  });

  describe('seconds display', () => {
    it('steppedDisplaySeconds ticks at boundary and freezes between', () => {
      const atBoundary = steppedDisplaySeconds(0, false);
      expect(atBoundary).toBe(0);

      const justAfter = steppedDisplaySeconds(80, false);
      // 第一秒没有前一整秒可“从后面步进”，直接吸附到 0。
      expect(justAfter).toBe(0);

      const settled = steppedDisplaySeconds(500, false);
      expect(settled).toBe(0);

      // 从第 2 秒开始可以看到从前一秒机械擒纵到当前秒的步进。
      const step = steppedDisplaySeconds(1080, false);
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(1);
      const frozen = steppedDisplaySeconds(1500, false);
      expect(frozen).toBe(1);
    });

    it('displaySeconds freezes when not live', () => {
      expect(bandDisplaySeconds('finished', 12_000, 10_500, false)).toBe(10);
      expect(bandDisplaySeconds('idle', 12_000, 0, false)).toBe(0);
    });
  });

  describe('tick alpha', () => {
    it('crossfades between second and macro ticks', () => {
      expect(secondTickAlpha(BAND_SCALE_NEAR)).toBeGreaterThan(0.95);
      expect(secondTickAlpha(BAND_SCALE_FAR)).toBeLessThan(0.05);
      expect(macroTickAlpha(BAND_SCALE_NEAR)).toBeLessThan(0.05);
      expect(macroTickAlpha(BAND_SCALE_FAR)).toBeGreaterThan(0.95);
    });
  });

  describe('pauseDissolveParticles', () => {
    it('returns empty array under reduced motion', () => {
      expect(pauseDissolveParticles(3_500, 100, true)).toEqual([]);
    });

    it('returns empty array for non-positive source width', () => {
      expect(pauseDissolveParticles(3_500, 0, false)).toEqual([]);
      expect(pauseDissolveParticles(3_500, -10, false)).toEqual([]);
    });

    it('produces a particle field with all required fields', () => {
      const particles = pauseDissolveParticles(3_500, 200, false);
      expect(particles.length).toBeGreaterThan(20);
      for (const particle of particles) {
        expect(particle).toHaveProperty('id');
        expect(particle).toHaveProperty('kind');
        expect(['dust', 'shard', 'spark']).toContain(particle.kind);
        expect(typeof particle.originOffsetX).toBe('number');
        expect(typeof particle.originRatioY).toBe('number');
        expect(typeof particle.travelX).toBe('number');
        expect(typeof particle.travelY).toBe('number');
        expect(typeof particle.size).toBe('number');
        expect(typeof particle.rotation).toBe('number');
        expect(typeof particle.alpha).toBe('number');
        expect(typeof particle.progress).toBe('number');
        expect(typeof particle.temperature).toBe('number');
        expect(particle.alpha).toBeGreaterThan(0);
        expect(particle.alpha).toBeLessThanOrEqual(1);
        expect(particle.progress).toBeGreaterThanOrEqual(0);
        expect(particle.progress).toBeLessThan(1);
      }
    });

    it('has mostly dust, some shards and a few sparks', () => {
      const particles = pauseDissolveParticles(5_000, 200, false);
      const kinds = new Map<string, number>();
      for (const particle of particles) {
        kinds.set(particle.kind, (kinds.get(particle.kind) ?? 0) + 1);
      }
      expect((kinds.get('dust') ?? 0) / particles.length).toBeGreaterThan(0.65);
      expect(kinds.get('shard') ?? 0).toBeGreaterThan(0);
      expect(kinds.get('spark') ?? 0).toBeGreaterThan(0);
    });

    it('origin is concentrated along the fuse path, not spread over the whole band', () => {
      const particles = pauseDissolveParticles(4_000, 200, false);
      const ratios = particles.map((p) => p.originRatioY);
      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      const variance = ratios.reduce((sum, r) => sum + (r - mean) ** 2, 0) / ratios.length;
      // originRatioY centers near 0.68 with small scatter.
      expect(mean).toBeGreaterThan(0.62);
      expect(mean).toBeLessThan(0.76);
      expect(variance).toBeLessThan(0.001);
    });

    it('particles drift mostly upward', () => {
      const particles = pauseDissolveParticles(2_500, 200, false);
      const upward = particles.filter((p) => p.travelY < 0).length;
      expect(upward / particles.length).toBeGreaterThan(0.85);
    });

    it('particles shrink and fade over life', () => {
      const particles = pauseDissolveParticles(2_500, 200, false);
      const progressed = particles.filter((p) => p.progress > 0.3);
      expect(progressed.length).toBeGreaterThan(0);
      for (const particle of progressed) {
        expect(particle.alpha).toBeLessThan(0.9);
        expect(particle.size).toBeLessThan(
          particle.kind === 'shard' ? 3.6 : particle.kind === 'spark' ? 1.4 : 2.2,
        );
      }
    });

    it('keeps a large fraction of identical ids across a small time jump', () => {
      const before = pauseDissolveParticles(2_400, 200, false);
      const after = pauseDissolveParticles(2_410, 200, false);
      const beforeIds = new Set(before.map((p) => p.id));
      const afterIds = new Set(after.map((p) => p.id));
      const common = [...beforeIds].filter((id) => afterIds.has(id)).length;
      const union = new Set([...beforeIds, ...afterIds]).size;
      expect(common / union).toBeGreaterThan(0.55);
    });

    it('keeps particles alive across a second boundary', () => {
      const before = pauseDissolveParticles(999, 200, false);
      const after = pauseDissolveParticles(1001, 200, false);
      expect(after.length).toBeGreaterThan(before.length * 0.55);
      const beforeIds = new Set(before.map((p) => p.id));
      const common = after.filter((p) => beforeIds.has(p.id)).length;
      expect(common).toBeGreaterThan(before.length * 0.4);
    });

    it('reduces density for smaller densityScale', () => {
      const main = pauseDissolveParticles(3_000, 200, false, 1);
      const mini = pauseDissolveParticles(3_000, 200, false, 0.35);
      expect(mini.length).toBeGreaterThan(5);
      expect(mini.length).toBeLessThan(main.length * 0.6);
    });

    it('emission is continuous within a second', () => {
      const samples = [100, 300, 600, 900].map(
        (ms) => pauseDissolveParticles(ms, 200, false, 1).length,
      );
      // None of the intermediate samples should drop to zero.
      for (const count of samples) {
        expect(count).toBeGreaterThan(20);
      }
    });
  });

  describe('particle field kernel', () => {
    it('particleCellHash is deterministic and stays within [0, 1)', () => {
      for (const [ix, iy] of [
        [0, 0],
        [3, 17],
        [-41, 9],
        [123456, 7],
        [3_456_789_012, 33],
      ]) {
        const a = particleCellHash(ix, iy);
        const b = particleCellHash(ix, iy);
        expect(a).toBe(b);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(1);
      }
    });

    it('fieldParticleSpec is deterministic and within documented ranges', () => {
      for (let ix = 0; ix < 40; ix += 1) {
        for (let iy = 0; iy < 6; iy += 1) {
          const spec = fieldParticleSpec(ix * 977 + 13, iy);
          expect(spec).toEqual(fieldParticleSpec(ix * 977 + 13, iy));
          expect(spec.offsetX).toBeGreaterThanOrEqual(0);
          expect(spec.offsetX).toBeLessThan(1);
          expect(spec.offsetY).toBeGreaterThanOrEqual(0);
          expect(spec.offsetY).toBeLessThan(1);
          expect(spec.sizeK).toBeGreaterThanOrEqual(0.5);
          expect(spec.sizeK).toBeLessThanOrEqual(1.4);
          expect(spec.phase).toBeGreaterThanOrEqual(0);
          expect(spec.phase).toBeLessThanOrEqual(Math.PI * 2);
          expect(spec.dir).toBeGreaterThanOrEqual(-1);
          expect(spec.dir).toBeLessThanOrEqual(1);
          // 逐粒子稀疏死亡阈值：0.3 ~ 1.0
          expect(spec.deathK).toBeGreaterThanOrEqual(0.3);
          expect(spec.deathK).toBeLessThanOrEqual(1);
        }
      }
    });

    it('projects particle rows into a readable back-to-front depth profile', () => {
      const back = particleDepthProfile(0.15, 1);
      const middle = particleDepthProfile(0.5, 1);
      const front = particleDepthProfile(0.9, 1);

      expect(back.projectedRatio).toBeLessThan(middle.projectedRatio);
      expect(middle.projectedRatio).toBeLessThan(front.projectedRatio);
      expect(back.sizeScale).toBeLessThan(front.sizeScale);
      expect(back.alphaScale).toBeLessThan(front.alphaScale);
      expect(particleDepthProfile(-1, 0).projectedRatio).toBe(0);
      expect(particleDepthProfile(2, 0).projectedRatio).toBe(1);
    });

    it('field params: dense and solid near the pointer, sparse and scattered far away', () => {
      const near = particleFieldParams(0, 1000, BAND_SCALE_NEAR);
      expect(near.s).toBe(0);
      expect(near.spawnProb).toBeCloseTo(0.95, 5);
      expect(near.alpha).toBeCloseTo(0.96, 5);
      expect(near.scatter).toBeCloseTo(1.5, 5);
      expect(near.rise).toBeCloseTo(0, 5);

      const far = particleFieldParams(10_000, 1000, BAND_SCALE_NEAR);
      expect(far.s).toBe(1);
      expect(far.spawnProb).toBeCloseTo(0.2, 5);
      expect(far.alpha).toBeCloseTo(0.28, 5);
      expect(far.scatter).toBeCloseTo(35.5, 5);
      expect(far.rise).toBeCloseTo(16, 5);
    });

    it('field params disperse monotonically over roughly half the viewport', () => {
      const width = 1000;
      let previous = -1;
      for (const behind of [0, 100, 200, 300, 400, 500, 600, 900]) {
        const { s } = particleFieldParams(behind, width, BAND_SCALE_NEAR);
        expect(s).toBeGreaterThanOrEqual(previous);
        previous = s;
      }
      // 半视宽附近应已明显散开。
      expect(particleFieldParams(width * 0.5, width, BAND_SCALE_NEAR).s).toBeGreaterThan(0.5);
    });

    it('pause density scale lowers effective spawn probability', () => {
      expect(PARTICLE_FIELD_PAUSE_DENSITY).toBeGreaterThan(0);
      expect(PARTICLE_FIELD_PAUSE_DENSITY).toBeLessThan(1);
      const { spawnProb } = particleFieldParams(0, 1000, BAND_SCALE_NEAR);
      expect(spawnProb * PARTICLE_FIELD_PAUSE_DENSITY).toBeLessThan(0.5);
    });

    it('step ladder keeps the on-screen cell close to the target size', () => {
      for (const scale of [BAND_SCALE_FAR, 0.5, 1, 2, 4, BAND_SCALE_NEAR]) {
        const cellPx = particleFieldStepSec(scale) * scale;
        expect(cellPx).toBeGreaterThanOrEqual(2.4 - 1e-9);
        expect(cellPx).toBeLessThanOrEqual(6.1);
      }
    });

    it('aged color mixes toward ash with k = s * 0.88', () => {
      const base: [number, number, number] = [212, 58, 58];
      const ash: [number, number, number] = [170, 134, 130];
      expect(particleAgedColor(base, ash, 0)).toEqual(base);
      const aged = particleAgedColor(base, ash, 1);
      expect(aged[0]).toBe(Math.round(212 + (170 - 212) * 0.88));
      expect(aged[1]).toBe(Math.round(58 + (134 - 58) * 0.88));
      expect(aged[2]).toBe(Math.round(58 + (130 - 58) * 0.88));
      const half = particleAgedColor(base, ash, 0.5);
      expect(half[0]).toBeGreaterThan(aged[0]);
      expect(half[0]).toBeLessThan(base[0]);
    });

    it('ash color desaturates the segment color toward the theme muted gray', () => {
      const emerald: [number, number, number] = [14, 159, 110];
      const muted: [number, number, number] = [122, 118, 108];
      const ash = particleAshColor(emerald, muted);
      const spread = (c: readonly number[]) => Math.max(...c) - Math.min(...c);
      expect(spread(ash)).toBeLessThan(spread(emerald));
      expect(ash[1]).toBeLessThan(emerald[1]);
    });

    it('tone color picks base / deep / soft-highlight bands', () => {
      const base: [number, number, number] = [10, 20, 30];
      const deep: [number, number, number] = [5, 10, 15];
      const soft: [number, number, number] = [200, 210, 220];
      expect(particleToneColor(0.2, base, deep, soft)).toEqual(base);
      expect(particleToneColor(0.6, base, deep, soft)).toEqual(deep);
      expect(particleToneColor(0.9, base, deep, soft)).toEqual(mixRgb(base, soft, 0.55));
    });

    it('trace fade is full near the pointer and fades with distance', () => {
      const width = 1000;
      expect(particleTraceFade(0, width, BAND_SCALE_NEAR)).toBeCloseTo(1, 5);
      expect(particleTraceFade(10_000, width, BAND_SCALE_NEAR)).toBeCloseTo(0.28, 5);
      const mid = particleTraceFade(width * 0.3, width, BAND_SCALE_NEAR);
      expect(mid).toBeGreaterThan(0.28);
      expect(mid).toBeLessThan(1);
    });

    it('trace residue dots are deterministic and appear on ~14% of cells', () => {
      let present = 0;
      const total = 40 * 40;
      for (let x = 0; x < 40; x += 1) {
        for (let y = 0; y < 40; y += 1) {
          const dot = traceResidueDot(x, y);
          expect(dot).toEqual(traceResidueDot(x, y));
          expect(dot.alpha).toBeGreaterThanOrEqual(0.04);
          expect(dot.alpha).toBeLessThanOrEqual(0.11);
          if (dot.present) present += 1;
        }
      }
      const ratio = present / total;
      expect(ratio).toBeGreaterThan(0.08);
      expect(ratio).toBeLessThan(0.22);
    });
  });

  describe('glow & fade curves', () => {
    it('pointerBreathPulse decays within each second and is static under reduced motion', () => {
      expect(pointerBreathPulse(0, false)).toBeCloseTo(1, 5);
      expect(pointerBreathPulse(1000, false)).toBeCloseTo(0, 5);
      const mid = pointerBreathPulse(500, false);
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(1);
      // 随秒内相位单调回落：每秒擒纵步进后点亮一次。
      expect(pointerBreathPulse(200, false)).toBeGreaterThan(pointerBreathPulse(800, false));
      // reduced-motion：固定中值，不随相位变化。
      expect(pointerBreathPulse(123, true)).toBe(pointerBreathPulse(987, true));
      expect(pointerBreathPulse(123, true)).toBeGreaterThan(0);
    });

    it('pointer glow alpha budget stays within the 0.18 ceiling', () => {
      expect(POINTER_GLOW_MAX_ALPHA).toBeLessThanOrEqual(0.18);
      expect(POINTER_GLOW_MAX_ALPHA).toBeGreaterThan(0);
    });

    it('frontierGlowAlpha stays within the low-alpha budget', () => {
      expect(frontierGlowAlpha(0, true)).toBeCloseTo(0.08, 5);
      for (const age of [0, 120, 420, 700, 999]) {
        const alpha = frontierGlowAlpha(age, false);
        expect(alpha).toBeGreaterThanOrEqual(0.08);
        expect(alpha).toBeLessThanOrEqual(0.18);
      }
    });

    it('burnHeadHalo breathes within budget and freezes under reduced motion', () => {
      const still = burnHeadHalo(250, true);
      expect(still).toEqual(burnHeadHalo(900, true));
      for (const age of [0, 200, 500, 800, 999]) {
        const halo = burnHeadHalo(age, false);
        expect(halo.alpha).toBeGreaterThan(0);
        expect(halo.alpha).toBeLessThanOrEqual(0.18);
        expect(halo.radius).toBeGreaterThanOrEqual(11);
        expect(halo.radius).toBeLessThanOrEqual(14.5 + 1e-9);
      }
      // 秒初比秒末更亮、更大：随每次秒步进轻微 pulse。
      const early = burnHeadHalo(0, false);
      const late = burnHeadHalo(999, false);
      expect(early.alpha).toBeGreaterThan(late.alpha);
      expect(early.radius).toBeGreaterThan(late.radius);
    });

    it('particleGridCrossfade completes within 400ms', () => {
      expect(PARTICLE_GRID_CROSSFADE_MS).toBeLessThanOrEqual(400);
      expect(particleGridCrossfade(null, 5000)).toBe(1);
      expect(particleGridCrossfade(1000, 1000)).toBe(0);
      expect(particleGridCrossfade(1000, 1200)).toBeCloseTo(0.5, 5);
      expect(particleGridCrossfade(1000, 1400)).toBe(1);
      expect(particleGridCrossfade(1000, 2000)).toBe(1);
    });

    it('particleFieldFadeIn eases in with a tail and snaps under reduced motion', () => {
      expect(PARTICLE_FIELD_FADE_IN_MS).toBe(300);
      expect(particleFieldFadeIn(null, 5000, false)).toBe(1);
      expect(particleFieldFadeIn(1000, 1000, false)).toBe(0);
      expect(particleFieldFadeIn(1000, 1300, false)).toBe(1);
      const half = particleFieldFadeIn(1000, 1150, false);
      // ease-out 带尾：前半程上升更快。
      expect(half).toBeGreaterThan(0.5);
      expect(half).toBeLessThan(1);
      // reduced-motion：立即完整显示。
      expect(particleFieldFadeIn(1000, 1000, true)).toBe(1);
      expect(particleFieldFadeIn(1000, 1050, true)).toBe(1);
    });
  });
});
