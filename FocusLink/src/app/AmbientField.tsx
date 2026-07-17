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
 */
export function AmbientField({ view, state }: { view: View; state: string }) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const field = fieldRef.current;
    const canvas = canvasRef.current;
    if (!field || !canvas) return;

    const context = canvas.getContext('2d', { alpha: true });
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

    const resize = () => {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      const dt = Math.min(2, Math.max(0.25, (time - lastTime) / 16.667));
      lastTime = time;

      if (!reducedMotion.matches) {
        const spring = 0.016 * dt;
        const damping = Math.pow(0.86, dt);
        velocityX = (velocityX + (targetX - currentX) * spring) * damping;
        velocityY = (velocityY + (targetY - currentY) * spring) * damping;
        currentX += velocityX * dt;
        currentY += velocityY * dt;
        pointerSpeed +=
          (Math.min(1, Math.hypot(velocityX, velocityY) / 34) - pointerSpeed) * 0.1 * dt;
      } else {
        currentX = width * 0.56;
        currentY = height * 0.42;
        velocityX = 0;
        velocityY = 0;
        pointerSpeed = 0;
      }

      const intensity = VIEW_INTENSITY[view];
      const phase = reducedMotion.matches ? 0 : time * 0.00012;
      const shortEdge = Math.min(width, height);
      const stateAccent = state === 'paused' ? palette.pause : palette.accent;
      const stateLift = state === 'running' ? 1.18 : state === 'paused' ? 1.06 : 0.88;
      const angle = Math.atan2(velocityY, velocityX || 0.001);
      const stretch = 1 + pointerSpeed * 0.3;

      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'source-over';

      drawOrb(
        context,
        width * (0.2 + Math.sin(phase * 0.7) * 0.035),
        height * (0.18 + Math.cos(phase * 0.8) * 0.045),
        shortEdge * 0.66,
        1.22,
        0.9,
        -0.28,
        palette.glowA,
        (palette.dark ? 0.1 : 0.44) * intensity,
      );
      drawOrb(
        context,
        width * (0.82 + Math.cos(phase * 0.55) * 0.04),
        height * (0.84 + Math.sin(phase * 0.62) * 0.045),
        shortEdge * 0.58,
        1.08,
        0.86,
        0.36,
        palette.glowB,
        (palette.dark ? 0.085 : 0.34) * intensity,
      );
      drawOrb(
        context,
        currentX,
        currentY,
        shortEdge * 0.44,
        stretch,
        Math.max(0.78, 1 / stretch),
        angle,
        stateAccent,
        (palette.dark ? 0.17 : 0.17) * intensity * stateLift,
      );
      drawOrb(
        context,
        width - currentX * 0.24,
        height - currentY * 0.18,
        shortEdge * 0.52,
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

      if (visible) rafId = window.requestAnimationFrame(draw);
    };

    const start = () => {
      if (!visible || rafId) return;
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
    };

    resize();
    const themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.addEventListener('change', syncTheme);
    start();

    return () => {
      stop();
      themeObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotion.removeEventListener('change', syncTheme);
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
