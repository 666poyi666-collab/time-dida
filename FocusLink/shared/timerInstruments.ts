// 像素点阵仪表的 5×7 字库与「专注核心」几何。
// 纯数据 + 纯函数，供渲染组件与 vitest 共用。

/** 5 列 × 7 行点阵；每行是一个 5 位二进制掩码（bit4 = 左列） */
export const PIXEL_FONT: Record<string, number[]> = {
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  ':': [0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000],
  '-': [0b00000, 0b00000, 0b00000, 0b01110, 0b00000, 0b00000, 0b00000],
};

export const PIXEL_FONT_COLS = 5;
export const PIXEL_FONT_ROWS = 7;

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
