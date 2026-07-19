// 计时仪表：同一主时间的五种真实不同的机械/排版表现。
// - standard 标准等宽：JetBrains Mono，沉稳的仪器读数
// - flip     翻页机械：Oswald + 上下分片翻牌，中央转轴
// - pixel    像素点阵：5×7 点阵数字 + 随累计专注点亮的专注核心
// - thin     极细编辑：Inter Tight 极细字重，排版感
// 状态色语义统一：running=专注强调色，paused=暂停红，其余=墨色。
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlipDigits } from '../../ui/FlipDigits';
import { formatDurationPadded } from '../../lib/time';
import {
  PIXEL_FONT,
  PIXEL_FONT_COLS,
  PIXEL_FONT_ROWS,
  FOCUS_CORE_GRID,
  FOCUS_CORE_SIZE,
  focusCoreOrder,
  focusCoreLitCount,
} from '@shared/timerInstruments';

export type TimerStyleName = 'standard' | 'flip' | 'pixel' | 'thin' | 'segment';

export function TimerDial({
  ms,
  state,
  style,
  coreRatio,
}: {
  ms: number;
  state: string;
  style: TimerStyleName;
  /** 像素仪表「专注核心」充能比例 0..1（累计专注 ÷ 目标） */
  coreRatio?: number;
}) {
  const text = formatDurationPadded(ms);
  if (style === 'flip') return <FlipDial text={text} state={state} />;
  if (style === 'pixel') return <PixelDial text={text} state={state} coreRatio={coreRatio ?? 0} />;
  if (style === 'segment') return <SegmentDial text={text} state={state} />;
  if (style === 'thin') {
    return (
      <div className={`timer-dial dial-thin state-${state}`} aria-label={text}>
        <FlipDigits value={text} />
      </div>
    );
  }
  return (
    <div className={`timer-dial dial-standard state-${state}`} aria-label={text}>
      <FlipDigits value={text} />
    </div>
  );
}

/* ─── 七段数码 ─────────────────────────────────────────────── */

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
};

const SEGMENT_PATHS: Record<string, string> = {
  a: 'M12 5 L48 5 L53 10 L47 15 L13 15 L7 10 Z',
  b: 'M50 13 L55 18 L55 43 L50 48 L45 43 L45 20 Z',
  c: 'M50 52 L55 57 L55 82 L50 87 L45 80 L45 57 Z',
  d: 'M12 85 L48 85 L53 90 L47 95 L13 95 L7 90 Z',
  e: 'M10 52 L15 57 L15 80 L10 87 L5 82 L5 57 Z',
  f: 'M10 13 L15 20 L15 43 L10 48 L5 43 L5 18 Z',
  g: 'M12 45 L48 45 L53 50 L48 55 L12 55 L7 50 Z',
};

function SegmentDial({ text, state }: { text: string; state: string }) {
  return (
    <div className={`timer-dial dial-segment state-${state}`} aria-label={text}>
      {Array.from(text).map((char, index) =>
        char === ':' ? (
          <svg className="segment-colon" viewBox="0 0 20 100" aria-hidden="true" key={index}>
            <circle cx="10" cy="34" r="4" />
            <circle cx="10" cy="68" r="4" />
          </svg>
        ) : (
          <svg className="segment-digit" viewBox="0 0 60 100" aria-hidden="true" key={index}>
            {Object.entries(SEGMENT_PATHS).map(([name, d]) => (
              <path
                key={name}
                d={d}
                className={(SEGMENTS[char] ?? '').includes(name) ? 'segment-on' : 'segment-off'}
              />
            ))}
          </svg>
        ),
      )}
    </div>
  );
}

/* ─── 翻页机械 ─────────────────────────────────────────────── */

const FLIP_MS = 260;

function FlipChar({ char }: { char: string }) {
  const committedRef = useRef(char);
  const [transition, setTransition] = useState({
    from: char,
    to: char,
    active: false,
    sequence: 0,
  });
  useEffect(() => {
    const from = committedRef.current;
    if (char === from) return undefined;
    committedRef.current = char;
    setTransition((previous) => ({
      from,
      to: char,
      active: true,
      sequence: previous.sequence + 1,
    }));
    const id = window.setTimeout(() => {
      setTransition((current) =>
        current.to === char ? { ...current, active: false, from: char } : current,
      );
    }, FLIP_MS + 24);
    return () => window.clearTimeout(id);
  }, [char]);

  const flipping = transition.active;
  const current = transition.to;
  const previous = transition.from;
  return (
    <span className={`flip-card ${flipping ? 'is-flipping' : ''}`}>
      {/* 静态上半：立即显示新值，被翻下的上瓣暂时遮住 */}
      <span className="flip-half flip-top">
        <span className="flip-glyph">{current}</span>
      </span>
      {/* 静态下半：动画期间显示旧值，上瓣翻过后被新下瓣覆盖 */}
      <span className="flip-half flip-bottom">
        <span className="flip-glyph">{flipping ? previous : current}</span>
      </span>
      {flipping && (
        <span className="flip-animation" key={transition.sequence} aria-hidden="true">
          <span className="flip-half flip-top flip-flap-top">
            <span className="flip-glyph">{previous}</span>
          </span>
          <span className="flip-half flip-bottom flip-flap-bottom">
            <span className="flip-glyph">{current}</span>
          </span>
        </span>
      )}
      <span className="flip-hinge" aria-hidden="true" />
    </span>
  );
}

function FlipDial({ text, state }: { text: string; state: string }) {
  return (
    <div className={`timer-dial dial-flip state-${state}`} aria-label={text}>
      {Array.from(text).map((ch, i) =>
        ch === ':' ? (
          <span className="flip-colon" key={`c-${i}`}>
            :
          </span>
        ) : (
          <FlipChar char={ch} key={`d-${i}`} />
        ),
      )}
    </div>
  );
}

/* ─── 像素点阵 ─────────────────────────────────────────────── */

const CELL = 1;
const GAP = 0.16;
const CHAR_W = PIXEL_FONT_COLS * (CELL + GAP);
const COLON_W = 2 * (CELL + GAP);

function PixelChar({ ch, offsetX, prevCh }: { ch: string; offsetX: number; prevCh: string }) {
  const rows = PIXEL_FONT[ch] ?? PIXEL_FONT['-'];
  const prevRows = PIXEL_FONT[prevCh] ?? PIXEL_FONT['-'];
  const rects = [];
  for (let y = 0; y < PIXEL_FONT_ROWS; y += 1) {
    for (let x = 0; x < PIXEL_FONT_COLS; x += 1) {
      const bit = 1 << (PIXEL_FONT_COLS - 1 - x);
      const on = (rows[y] & bit) !== 0;
      const was = (prevRows[y] & bit) !== 0;
      rects.push(
        <rect
          key={`${x}-${y}`}
          x={offsetX + x * (CELL + GAP)}
          y={y * (CELL + GAP)}
          width={CELL}
          height={CELL}
          className={on ? (was ? 'pix-on' : 'pix-on pix-pop') : 'pix-off'}
        />,
      );
    }
  }
  return <>{rects}</>;
}

function PixelDial({ text, state, coreRatio }: { text: string; state: string; coreRatio: number }) {
  const chars = useMemo(() => Array.from(text), [text]);
  // ref 保存上一帧文本：渲染期读取不产生二次渲染，仅秒变的那几位播放点亮过渡
  const prevRef = useRef(text);
  const prevText = prevRef.current;
  useEffect(() => {
    prevRef.current = text;
  }, [text]);
  const prevChars = Array.from(prevText.padEnd(text.length, ' '));

  const width = chars.reduce((acc, ch) => acc + (ch === ':' ? COLON_W : CHAR_W), -GAP) + GAP;
  const height = PIXEL_FONT_ROWS * (CELL + GAP);
  let x = 0;

  const order = useMemo(() => focusCoreOrder(), []);
  const lit = focusCoreLitCount(coreRatio);
  const litSet = useMemo(
    () => new Set(order.slice(0, lit).map(([cx, cy]) => `${cx},${cy}`)),
    [order, lit],
  );

  return (
    <div className={`timer-dial dial-pixel state-${state}`} aria-label={text}>
      <svg
        className="pixel-digits"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-hidden="true"
      >
        {chars.map((ch, i) => {
          const w = ch === ':' ? COLON_W : CHAR_W;
          const node = <PixelChar key={i} ch={ch} prevCh={prevChars[i] ?? ch} offsetX={x} />;
          x += w;
          return node;
        })}
      </svg>
      <div className="pixel-core" title={`本轮充能 ${Math.round(coreRatio * 100)}%`}>
        <svg viewBox={`0 0 ${FOCUS_CORE_SIZE} ${FOCUS_CORE_SIZE}`} aria-hidden="true">
          {FOCUS_CORE_GRID.flatMap((row, cy) =>
            Array.from(row).map((cell, cx) =>
              cell === '#' ? (
                <rect
                  key={`${cx}-${cy}`}
                  x={cx + 0.08}
                  y={cy + 0.08}
                  width={0.84}
                  height={0.84}
                  className={litSet.has(`${cx},${cy}`) ? 'core-lit' : 'core-off'}
                />
              ) : null,
            ),
          )}
        </svg>
        <span className="pixel-core-caption">充能 {Math.round(coreRatio * 100)}%</span>
      </div>
    </div>
  );
}
