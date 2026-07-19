// 小窗任务名显示策略（纯函数）：装得下完整单行显示；装不下走克制滚动。
// reduced-motion 用户不做往返 marquee，只给静态可滚动容器。

export type MiniTaskDisplayMode = 'single' | 'marquee' | 'scroll';

/**
 * @param scrollWidth 任务名内容实际宽度（px）
 * @param clientWidth 任务行可视宽度（px）
 * @param reduceMotion 系统减弱动态效果开关
 */
export function resolveMiniTaskDisplayMode(
  scrollWidth: number,
  clientWidth: number,
  reduceMotion: boolean,
): MiniTaskDisplayMode {
  // +2px 容忍：亚像素取整不把恰好装得下的名字误判为长名
  if (scrollWidth <= clientWidth + 2) return 'single';
  return reduceMotion ? 'scroll' : 'marquee';
}
