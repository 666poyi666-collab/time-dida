// 环境光场（全 app 共享背景层）：三个哑光柔光斑 —— 两个比画布略亮的中性斑 +
// 一个极淡 accent 色温斑。鼠标流动感：主光斑以 lerp 惯性追赶指针归一化位移，
// 次光斑反向微漂移形成视差；accent 斑纯 CSS 慢漂移，不监听指针。
// 性能：全部只写 transform；热路径无 layout 读取（viewport 尺寸缓存、resize 更新）；
// 追赶到位即停 rAF；页面隐藏 / 窗口失焦立即停帧；prefers-reduced-motion 完全关闭跟随。
import { useEffect, useRef } from 'react';

const LERP = 0.08; // 惯性追赶系数（0.06–0.1 区间，越大越跟手）
const FOLLOW_X = 140; // 主光斑最大横向位移 px —— 幅度大而柔和
const FOLLOW_Y = 96; // 主光斑最大纵向位移 px
const COUNTER = -0.5; // 次光斑反向系数（视差）
const EPSILON = 0.0004; // 追赶收敛阈值，到位即停 rAF

export function AmbientField() {
  const primaryRef = useRef<HTMLSpanElement>(null);
  const secondaryRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const primary = primaryRef.current;
    const secondary = secondaryRef.current;
    if (!primary || !secondary) return;

    let viewportW = window.innerWidth;
    let viewportH = window.innerHeight;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let rafId = 0;

    const step = () => {
      currentX += (targetX - currentX) * LERP;
      currentY += (targetY - currentY) * LERP;
      const px = (currentX * FOLLOW_X).toFixed(2);
      const py = (currentY * FOLLOW_Y).toFixed(2);
      const sx = (currentX * FOLLOW_X * COUNTER).toFixed(2);
      const sy = (currentY * FOLLOW_Y * COUNTER).toFixed(2);
      primary.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      secondary.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
      if (Math.abs(targetX - currentX) > EPSILON || Math.abs(targetY - currentY) > EPSILON) {
        rafId = window.requestAnimationFrame(step);
      } else {
        rafId = 0;
      }
    };

    const wake = () => {
      if (!rafId && !document.hidden) rafId = window.requestAnimationFrame(step);
    };

    const sleep = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      targetX = (event.clientX / viewportW) * 2 - 1;
      targetY = (event.clientY / viewportH) * 2 - 1;
      wake();
    };
    const onResize = () => {
      viewportW = window.innerWidth;
      viewportH = window.innerHeight;
    };
    const onVisibilityChange = () => {
      if (document.hidden) sleep();
      else wake();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', sleep);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      sleep();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', sleep);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return (
    <div className="ambient-field" aria-hidden="true">
      <span ref={primaryRef} className="ambient-glow ambient-glow-primary">
        <i />
      </span>
      <span ref={secondaryRef} className="ambient-glow ambient-glow-secondary">
        <i />
      </span>
      <span className="ambient-glow ambient-glow-accent">
        <i />
      </span>
    </div>
  );
}
