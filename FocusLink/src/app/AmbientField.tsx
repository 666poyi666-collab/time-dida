import { useEffect, useRef } from 'react';
import type { View } from './store';

type Rgb = readonly [number, number, number];

type Palette = {
  canvas: Rgb;
  surface: Rgb;
  accent: Rgb;
  pause: Rgb;
  glowA: Rgb;
  glowB: Rgb;
  glowC: Rgb;
  dark: boolean;
};

const VIEW_INTENSITY: Record<View, number> = {
  timer: 1,
  history: 0.74,
  tasks: 0.5,
  settings: 0.4,
};

/** Ambient flow speed, rad per ms. Paused scales it down so "pause" reads as deceleration. */
const PHASE_SPEED = 0.00012;
const PAUSED_PHASE_FACTOR = 0.35;
/** Idle-only low-frequency breath: 24s period, ±6% amplitude, never stacked on running/paused. */
const IDLE_BREATH_PERIOD_MS = 24000;
const IDLE_BREATH_AMPLITUDE = 0.06;
/** One-shot converge envelope on entering finished (~1.2s), then treated exactly like idle. */
const CONVERGE_DURATION_MS = 1200;
const CONVERGE_PULL = 0.14;
const CONVERGE_SHRINK = 0.08;
/** One-shot warning pulse for a fresh error toast: 600ms up-and-down, never loops. */
const ALERT_PULSE_MS = 600;
const ALERT_INTENSITY_BOOST = 0.4;

const RUNNING_LIFT = 1.18;
const PAUSED_LIFT = 1.06;
const IDLE_LIFT = 0.88;

function stateLiftFor(state: string): number {
  return state === 'running' ? RUNNING_LIFT : state === 'paused' ? PAUSED_LIFT : IDLE_LIFT;
}

function readRgb(styles: CSSStyleDeclaration, token: string, fallback: Rgb): Rgb {
  const parts = styles.getPropertyValue(token).trim().split(/\s+/).map(Number);
  return parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)
    ? ([parts[0], parts[1], parts[2]] as const)
    : fallback;
}

function readPalette(): Palette {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  return {
    canvas: readRgb(styles, '--app-bg', [243, 241, 236]),
    surface: readRgb(styles, '--app-surface', [250, 249, 246]),
    accent: readRgb(styles, '--app-accent', [40, 108, 99]),
    pause: readRgb(styles, '--app-pause', [204, 81, 69]),
    glowA: readRgb(styles, '--app-glow-1', [252, 250, 245]),
    glowB: readRgb(styles, '--app-glow-2', [246, 244, 238]),
    glowC: readRgb(styles, '--app-glow-3', [209, 230, 224]),
    dark: root.classList.contains('dark'),
  };
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function drawOrb(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  stretchX: number,
  stretchY: number,
  rotation: number,
  color: Rgb,
  alpha: number,
): void {
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.scale(stretchX, stretchY);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
  gradient.addColorStop(0, rgba(color, alpha));
  gradient.addColorStop(0.38, rgba(color, alpha * 0.66));
  gradient.addColorStop(0.72, rgba(color, alpha * 0.18));
  gradient.addColorStop(1, rgba(color, 0));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/**
 * One canvas owns the whole app's ambient material and pointer inertia. The fallback DOM
 * glows remain in the tree so a lost/unsupported canvas never turns the workspace black.
 * The hot path only writes transforms/CSS variables and canvas pixels; it performs no layout reads.
 *
 * 动态策略（FRONTEND_SPEC 4.1 / 4.3）：
 * - 正常模式：单一 rAF 循环驱动指针惯性、速度拉伸、反向视差、相位流动与待机呼吸；
 * - prefers-reduced-motion：停止一切持续推进/呼吸/流动 —— 不排程 rAF，只在状态切换、
 *   主题变化、窗口尺寸变化、重新可见时绘制一帧静态材质；收束 envelope 不播放，直接落到终态；
 * - 页面隐藏（document.hidden）时停止绘制，重新可见后恢复；
 * - canvas context 获取失败或运行中丢失（contextlost）时降级为三个 CSS 光斑，绝不黑屏。
 */
export function AmbientField({
  view,
  state,
  alertTick = 0,
}: {
  view: View;
  state: string;
  alertTick?: number;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Time-based curves live in refs so the [state, view] effect restarts below never
  // reset them mid-flight: flow phase, idle-breath amplitude, converge and alert envelopes.
  const phaseRef = useRef(0);
  const breathAmpRef = useRef(0);
  const gatherRef = useRef(0);
  const convergeRef = useRef<{ start: number; fromLift: number } | null>(null);
  const alertStartRef = useRef<number | null>(null);
  const prevStateRef = useRef(state);

  // A new error toast only stamps a start time; the single RAF loop consumes it. This
  // deliberately does NOT restart the canvas effect (no listener churn, no second RAF).
  useEffect(() => {
    if (alertTick > 0) alertStartRef.current = performance.now();
  }, [alertTick]);

  useEffect(() => {
    const field = fieldRef.current;
    const canvas = canvasRef.current;
    if (!field || !canvas) return;

    // Canvas 获取失败（不支持或被拦截）：立即降级为 CSS 光斑。
    // const 绑定保证闭包内类型窄化不丢失。
    const context = (() => {
      try {
        return canvas.getContext('2d', { alpha: true });
      } catch {
        return null;
      }
    })();
    if (!context) {
      field.dataset.renderer = 'css';
      return;
    }

    field.dataset.renderer = 'canvas';
    const root = document.documentElement;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let palette = readPalette();
    let width = Math.max(1, window.innerWidth);
    let height = Math.max(1, window.innerHeight);
    let dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    let targetX = width * 0.56;
    let targetY = height * 0.42;
    let currentX = targetX;
    let currentY = targetY;
    let velocityX = 0;
    let velocityY = 0;
    let pointerSpeed = 0;
    let rafId = 0;
    let lastTime = performance.now();
    let visible = !document.hidden;

    // The converge envelope arms only on the transition INTO finished. A view switch also
    // re-runs this effect, so the previous state (not the effect run) decides re-arming.
    // reduced-motion 下不播放收束 envelope：finished 直接等同 idle 静态材质。
    if (state !== 'finished' || reducedMotion.matches) {
      convergeRef.current = null;
    } else if (prevStateRef.current !== 'finished' && !convergeRef.current) {
      convergeRef.current = {
        start: performance.now(),
        fromLift: stateLiftFor(prevStateRef.current),
      };
    }
    prevStateRef.current = state;

    const resize = () => {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      // resize 会清空画布位图；reduced-motion 没有循环重绘，需手工补一帧静态材质。
      if (reducedMotion.matches && visible) draw(performance.now());
    };

    const draw = (time: number) => {
      const dt = Math.min(2, Math.max(0.25, (time - lastTime) / 16.667));
      lastTime = time;
      const animated = !reducedMotion.matches;

      if (animated) {
        const spring = 0.016 * dt;
        const damping = Math.pow(0.86, dt);
        velocityX = (velocityX + (targetX - currentX) * spring) * damping;
        velocityY = (velocityY + (targetY - currentY) * spring) * damping;
        currentX += velocityX * dt;
        currentY += velocityY * dt;
        pointerSpeed +=
          (Math.min(1, Math.hypot(velocityX, velocityY) / 34) - pointerSpeed) * 0.1 * dt;
        // Paused means deceleration: the flow phase advances at 35% while the palette
        // turns to the pause red, reading as "slowed down and turned red". The phase is
        // accumulated (never derived from absolute time) so speed changes are seamless.
        phaseRef.current +=
          dt * 16.667 * PHASE_SPEED * (state === 'paused' ? PAUSED_PHASE_FACTOR : 1);
      } else {
        // reduced-motion：指针光场固定在静置锚点，不随光标推进。
        currentX = width * 0.56;
        currentY = height * 0.42;
        velocityX = 0;
        velocityY = 0;
        pointerSpeed = 0;
      }

      // Finished converge envelope, interpolated from timestamps: orbs gather slightly
      // toward the center and relax back (sin arc, zero at both ends) while the state
      // lift eases monotonically to the idle baseline. Afterwards it IS idle.
      let convergeProgress = 0;
      let convergeFromLift = IDLE_LIFT;
      let converging = false;
      if (animated && state === 'finished' && convergeRef.current) {
        const { start: convergeStart, fromLift } = convergeRef.current;
        convergeProgress = Math.min(1, (time - convergeStart) / CONVERGE_DURATION_MS);
        convergeFromLift = fromLift;
        converging = true;
        if (convergeProgress >= 1) {
          convergeRef.current = null;
          converging = false;
        }
      }
      const convergeEase = converging ? 1 - Math.pow(1 - convergeProgress, 3) : 0;
      // The gather displacement is smoothed so leaving finished mid-envelope (reset / new
      // focus) relaxes orbs back to their natural positions instead of snapping them.
      // reduced-motion 单帧绘制没有插值过程，直接落终态。
      const gatherTarget = converging ? Math.sin(convergeProgress * Math.PI) : 0;
      gatherRef.current = animated
        ? gatherRef.current + (gatherTarget - gatherRef.current) * Math.min(1, 0.08 * dt)
        : gatherTarget;
      const gather = gatherRef.current;

      // Idle breath: a very slow sine on global intensity. The amplitude eases in/out
      // through breathAmpRef, so entering/leaving idle and the converge hand-off never
      // produce an intensity step. Running/paused target zero amplitude — no breath.
      const idleLike = state === 'idle' || (state === 'finished' && !converging);
      const breathTarget = idleLike && animated ? IDLE_BREATH_AMPLITUDE : 0;
      breathAmpRef.current = animated
        ? breathAmpRef.current + (breathTarget - breathAmpRef.current) * Math.min(1, 0.03 * dt)
        : breathTarget;
      const breath =
        1 + breathAmpRef.current * Math.sin((time * 2 * Math.PI) / IDLE_BREATH_PERIOD_MS);

      // Error alert: one 600ms sine pulse (up then decay, no loop) toward the pause/warning
      // color. Under prefers-reduced-motion the stamp is consumed without playing anything.
      let alertPulse = 0;
      if (alertStartRef.current !== null) {
        const alertElapsed = time - alertStartRef.current;
        if (!animated || alertElapsed >= ALERT_PULSE_MS) {
          alertStartRef.current = null;
        } else {
          alertPulse = Math.sin((alertElapsed / ALERT_PULSE_MS) * Math.PI);
        }
      }

      const intensity = VIEW_INTENSITY[view] * breath * (1 + alertPulse * ALERT_INTENSITY_BOOST);
      const phase = phaseRef.current;
      const shortEdge = Math.min(width, height);
      const baseAccent = state === 'paused' ? palette.pause : palette.accent;
      const stateAccent =
        alertPulse > 0 ? mixRgb(baseAccent, palette.pause, alertPulse) : baseAccent;
      const stateLift = converging
        ? convergeFromLift + (IDLE_LIFT - convergeFromLift) * convergeEase
        : stateLiftFor(state);
      const angle = Math.atan2(velocityY, velocityX || 0.001);
      const stretch = 1 + pointerSpeed * 0.3;

      // Converge transform: pull every orb slightly toward the canvas center and shrink it.
      // gather rests at 0 outside the envelope, making both mappings identity transforms.
      const centerX = width * 0.5;
      const centerY = height * 0.5;
      const pull = 1 - gather * CONVERGE_PULL;
      const shrink = 1 - gather * CONVERGE_SHRINK;
      const orbX = (x: number) => centerX + (x - centerX) * pull;
      const orbY = (y: number) => centerY + (y - centerY) * pull;

      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'source-over';

      drawOrb(
        context,
        orbX(width * (0.2 + Math.sin(phase * 0.7) * 0.035)),
        orbY(height * (0.18 + Math.cos(phase * 0.8) * 0.045)),
        shortEdge * 0.66 * shrink,
        1.22,
        0.9,
        -0.28,
        palette.glowA,
        (palette.dark ? 0.1 : 0.44) * intensity,
      );
      drawOrb(
        context,
        orbX(width * (0.82 + Math.cos(phase * 0.55) * 0.04)),
        orbY(height * (0.84 + Math.sin(phase * 0.62) * 0.045)),
        shortEdge * 0.58 * shrink,
        1.08,
        0.86,
        0.36,
        palette.glowB,
        (palette.dark ? 0.085 : 0.34) * intensity,
      );
      drawOrb(
        context,
        orbX(currentX),
        orbY(currentY),
        shortEdge * 0.44 * shrink,
        stretch,
        Math.max(0.78, 1 / stretch),
        angle,
        stateAccent,
        // 亮色保持 0.17。暗色下其余 glow 已全面压低，这个指针 accent orb 是唯一的焦点
        // 锚点；参照 sheen 暗色反向加强（0.025 vs 0.018）的先例提到 0.22，避免焦点发闷。
        (palette.dark ? 0.22 : 0.17) * intensity * stateLift,
      );
      drawOrb(
        context,
        orbX(width - currentX * 0.24),
        orbY(height - currentY * 0.18),
        shortEdge * 0.52 * shrink,
        1.08,
        0.82,
        -angle * 0.3,
        palette.glowC,
        (palette.dark ? 0.11 : 0.18) * intensity,
      );

      const sheen = context.createLinearGradient(0, 0, width, height);
      sheen.addColorStop(0, rgba(palette.surface, palette.dark ? 0.015 : 0.1 * intensity));
      sheen.addColorStop(0.46, rgba(palette.canvas, 0));
      sheen.addColorStop(
        1,
        rgba(stateAccent, (palette.dark ? 0.025 : 0.018) * intensity * stateLift),
      );
      context.fillStyle = sheen;
      context.fillRect(0, 0, width, height);

      root.style.setProperty('--pointer-x', `${(currentX / width) * 100}%`);
      root.style.setProperty('--pointer-y', `${(currentY / height) * 100}%`);
      root.style.setProperty('--pointer-speed', pointerSpeed.toFixed(3));

      // 只在「可见 + 允许动画」时继续排程；reduced-motion 每帧都是终帧，不再预约下一帧。
      if (visible && !reducedMotion.matches) rafId = window.requestAnimationFrame(draw);
    };

    const start = () => {
      if (!visible) return;
      // reduced-motion：没有循环，只补一帧静态材质（状态/主题/尺寸变化时同样走这里）。
      if (reducedMotion.matches) {
        draw(performance.now());
        return;
      }
      if (rafId) return;
      lastTime = performance.now();
      rafId = window.requestAnimationFrame(draw);
    };
    const stop = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = 0;
    };
    const onPointerMove = (event: PointerEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
    };
    const onVisibilityChange = () => {
      visible = !document.hidden;
      if (visible) start();
      else stop();
    };
    const syncTheme = () => {
      palette = readPalette();
      // 主题切换后 reduced-motion 没有循环来拾取新色板，需补一帧静态材质。
      if (reducedMotion.matches && visible) draw(performance.now());
    };
    // 动态偏好实时切换：进入 reduce 停循环并落定静态帧；退出 reduce 恢复循环。
    const onMotionPreferenceChange = () => {
      palette = readPalette();
      if (reducedMotion.matches) {
        convergeRef.current = null;
        stop();
        if (visible) draw(performance.now());
      } else {
        start();
      }
    };
    // 运行中 context 丢失：停循环并降级为 CSS 光斑；恢复后重建尺寸/色板再启动。
    const onContextLost = (event: Event) => {
      event.preventDefault();
      stop();
      field.dataset.renderer = 'css';
    };
    const onContextRestored = () => {
      palette = readPalette();
      field.dataset.renderer = 'canvas';
      resize();
      start();
    };

    resize();
    const themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.addEventListener('change', onMotionPreferenceChange);
    canvas.addEventListener('contextlost', onContextLost);
    canvas.addEventListener('contextrestored', onContextRestored);
    start();

    return () => {
      stop();
      themeObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotion.removeEventListener('change', onMotionPreferenceChange);
      canvas.removeEventListener('contextlost', onContextLost);
      canvas.removeEventListener('contextrestored', onContextRestored);
      root.style.removeProperty('--pointer-x');
      root.style.removeProperty('--pointer-y');
      root.style.removeProperty('--pointer-speed');
    };
  }, [state, view]);

  return (
    <div ref={fieldRef} className="ambient-field" aria-hidden="true">
      <canvas ref={canvasRef} className="ambient-canvas" />
      <span className="ambient-glow ambient-glow-primary">
        <i />
      </span>
      <span className="ambient-glow ambient-glow-secondary">
        <i />
      </span>
      <span className="ambient-glow ambient-glow-accent">
        <i />
      </span>
      <span className="ambient-grain" />
    </div>
  );
}
