// 像素点阵仪表的 7×9 字库、翻页机械状态机与「专注核心」几何。
// 纯数据 + 纯函数，供渲染组件与 vitest 共用。

/** 7 列 × 9 行点阵；每行是一个 7 位二进制掩码（bit6 = 左列）。 */
export const PIXEL_FONT: Record<string, number[]> = {
  '0': [
    0b0111110, 0b1100011, 0b1100111, 0b1101011, 0b1110011, 0b1100011, 0b1100011, 0b1100011,
    0b0111110,
  ],
  '1': [
    0b0011000, 0b0111000, 0b1111000, 0b0011000, 0b0011000, 0b0011000, 0b0011000, 0b0011000,
    0b1111110,
  ],
  '2': [
    0b0111110, 0b1100011, 0b0000011, 0b0000110, 0b0001100, 0b0011000, 0b0110000, 0b1100000,
    0b1111111,
  ],
  '3': [
    0b1111110, 0b0000011, 0b0000011, 0b0011110, 0b0000011, 0b0000011, 0b0000011, 0b1100011,
    0b0111110,
  ],
  '4': [
    0b0000110, 0b0001110, 0b0011110, 0b0110110, 0b1100110, 0b1111111, 0b0000110, 0b0000110,
    0b0000110,
  ],
  '5': [
    0b1111111, 0b1100000, 0b1100000, 0b1111110, 0b0000011, 0b0000011, 0b0000011, 0b1100011,
    0b0111110,
  ],
  '6': [
    0b0011110, 0b0110000, 0b1100000, 0b1111110, 0b1100011, 0b1100011, 0b1100011, 0b1100011,
    0b0111110,
  ],
  '7': [
    0b1111111, 0b0000011, 0b0000110, 0b0001100, 0b0011000, 0b0110000, 0b0110000, 0b0110000,
    0b0110000,
  ],
  '8': [
    0b0111110, 0b1100011, 0b1100011, 0b0111110, 0b1100011, 0b1100011, 0b1100011, 0b1100011,
    0b0111110,
  ],
  '9': [
    0b0111110, 0b1100011, 0b1100011, 0b1100011, 0b0111111, 0b0000011, 0b0000110, 0b0001100,
    0b1110000,
  ],
  ':': [
    0b0000000, 0b0011000, 0b0011000, 0b0000000, 0b0000000, 0b0011000, 0b0011000, 0b0000000,
    0b0000000,
  ],
  '-': [
    0b0000000, 0b0000000, 0b0000000, 0b0000000, 0b1111110, 0b0000000, 0b0000000, 0b0000000,
    0b0000000,
  ],
};

export const PIXEL_FONT_COLS = 7;
export const PIXEL_FONT_ROWS = 9;

/** 一个字符的点阵坐标列表（用于 SVG/网格渲染） */
export function pixelCells(ch: string): Array<[number, number]> {
  const rows = PIXEL_FONT[ch] ?? PIXEL_FONT['-'];
  const cells: Array<[number, number]> = [];
  rows.forEach((mask, y) => {
    for (let x = 0; x < PIXEL_FONT_COLS; x += 1) {
      if (mask & (1 << (PIXEL_FONT_COLS - 1 - x))) cells.push([x, y]);
    }
  });
  return cells;
}

export type FlipPhase = 'steady' | 'fold' | 'unfold';

export type FlipMachine = {
  shown: string;
  from: string;
  to: string;
  queued: string | null;
  phase: FlipPhase;
  sequence: number;
};

export function createFlipMachine(char: string): FlipMachine {
  return { shown: char, from: char, to: char, queued: null, phase: 'steady', sequence: 0 };
}

/**
 * 翻页输入状态机。非活动态直接静态提交；活动态永远完整结束当前翻页，
 * 中途只保留最新目标，避免旧 timeout、半片数字和补播过期动画。
 */
export function updateFlipMachine(
  machine: FlipMachine,
  next: string,
  animate: boolean,
): FlipMachine {
  if (!animate) {
    return next === machine.shown && machine.phase === 'steady'
      ? machine
      : { ...createFlipMachine(next), sequence: machine.sequence + 1 };
  }
  if (machine.phase === 'steady') {
    if (next === machine.shown) return machine;
    return {
      shown: machine.shown,
      from: machine.shown,
      to: next,
      queued: null,
      phase: 'fold',
      sequence: machine.sequence + 1,
    };
  }
  return { ...machine, queued: next === machine.to ? null : next };
}

export function advanceFlipMachine(machine: FlipMachine): FlipMachine {
  if (machine.phase === 'fold') return { ...machine, phase: 'unfold' };
  if (machine.phase !== 'unfold') return machine;
  if (machine.queued && machine.queued !== machine.to) {
    return {
      shown: machine.to,
      from: machine.to,
      to: machine.queued,
      queued: null,
      phase: 'fold',
      sequence: machine.sequence + 1,
    };
  }
  return {
    shown: machine.to,
    from: machine.to,
    to: machine.to,
    queued: null,
    phase: 'steady',
    sequence: machine.sequence,
  };
}

/** 专注核心：11×11 圆盘掩码（逐行字符串，#=实体） */
export const FOCUS_CORE_GRID: string[] = [
  '....###....',
  '..#######..',
  '.#########.',
  '.#########.',
  '###########',
  '###########',
  '###########',
  '.#########.',
  '.#########.',
  '..#######..',
  '....###....',
];
export const FOCUS_CORE_SIZE = 11;

/** 核心点亮顺序：自底向上、自中心向两侧，返回 [x,y] 列表 */
export function focusCoreOrder(): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let y = FOCUS_CORE_GRID.length - 1; y >= 0; y -= 1) {
    const row = FOCUS_CORE_GRID[y];
    const xs: number[] = [];
    for (let x = 0; x < row.length; x += 1) if (row[x] === '#') xs.push(x);
    const mid = (row.length - 1) / 2;
    xs.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    xs.forEach((x) => cells.push([x, y]));
  }
  return cells;
}

/** 按累计专注比例应点亮的核心格数（0..total） */
export function focusCoreLitCount(ratio: number): number {
  const total = focusCoreOrder().length;
  const r = Math.min(1, Math.max(0, ratio));
  return Math.round(r * total);
}
