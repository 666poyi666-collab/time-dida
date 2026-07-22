// 计时仪表：同一主时间的五种真实不同的机械/排版表现。
// - standard 标准等宽：JetBrains Mono，沉稳的仪器读数
// - flip     翻页机械：Oswald + 上下分片翻牌，中央转轴
// - pixel    像素点阵：7×9 整数网格数字 + 随累计专注点亮的专注核心
// - thin     高反差编辑：Bodoni Moda 衬线字，排版感
// 状态色语义统一：running=专注强调色，paused=暂停红，其余=墨色。
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { FlipDigits } from '../../ui/FlipDigits';
import { formatDurationPadded } from '../../lib/time';
import '../../styles/dial-motion.css';
import {
  PIXEL_FONT,
  PIXEL_FONT_COLS,
  PIXEL_FONT_ROWS,
  FOCUS_CORE_GRID,
  FOCUS_CORE_SIZE,
  focusCoreOrder,
  focusCoreLitCount,
  advanceFlipMachine,
  createFlipMachine,
  updateFlipMachine,
} from '@shared/timerInstruments';

export type TimerStyleName = 'standard' | 'flip' | 'pixel' | 'thin' | 'segment';

function useReducedMotionPreference(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/* ─── 进位脉冲与一次性扫光 ────────────────────────────────── */

/**
 * 数字进位检测：最右位（秒个位）每秒都变，不算进位；
 * 其余任意位变化（如 09→10、59→00）才视为进位，脉冲计数 +1。
 * active=false（暂停/待机/reduced-motion）时不产生脉冲。
 */
function useCarryPulse(text: string, active: boolean): number {
  const [pulse, setPulse] = useState(0);
  const prevRef = useRef(text);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = text;
    if (!active || prev === text) return;
    if (prev.slice(0, -1) !== text.slice(0, -1)) setPulse((n) => n + 1);
  }, [text, active]);
  return pulse;
}

/** 一次性扫光条：key 随脉冲递进，重挂载即重播；pulse=0（初始）不渲染 */
function DialSweep({ pulse }: { pulse: number }) {
  if (pulse === 0) return null;
  return <span className="dial-sweep" key={pulse} aria-hidden="true" />;
}

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
  if (style === 'thin') return <ThinDial text={text} state={state} />;
  return (
    <div className={`timer-dial dial-standard state-${state}`} aria-label={text}>
      <span className="instrument-chrome-label" key={`label-${state}`}>
        ELAPSED
      </span>
      <span className="instrument-chrome-digits">
        <FlipDigits value={text} />
      </span>
      <span className="instrument-chrome-state" key={`marker-${state}`}>
        {state === 'running' ? 'LIVE / SEC' : state === 'paused' ? 'HOLD / SEC' : 'READY'}
      </span>
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

const SEGMENT_PATH_ENTRIES = Object.entries(SEGMENT_PATHS);

const SevenSegmentDigit = memo(function SevenSegmentDigit({ char }: { char: string }) {
  const litSegments = SEGMENTS[char] ?? '';
  return (
    <svg className="segment-digit" viewBox="0 0 60 100" aria-hidden="true">
      {SEGMENT_PATH_ENTRIES.map(([name, d]) => (
        <path
          key={name}
          d={d}
          className={litSegments.includes(name) ? 'segment-on' : 'segment-off'}
        />
      ))}
    </svg>
  );
});

function SegmentDial({ text, state }: { text: string; state: string }) {
  const reducedMotion = useReducedMotionPreference();
  const carry = useCarryPulse(text, !reducedMotion && state === 'running');
  return (
    <div className={`timer-dial dial-segment state-${state}`} aria-label={text}>
      {Array.from(text).map((char, index) =>
        char === ':' ? (
          <svg className="segment-colon" viewBox="0 0 20 100" aria-hidden="true" key={index}>
            <circle cx="10" cy="34" r="4" />
            <circle cx="10" cy="68" r="4" />
          </svg>
        ) : (
          <SevenSegmentDigit char={char} key={index} />
        ),
      )}
      <DialSweep pulse={carry} />
    </div>
  );
}

/* ─── 高反差编辑 ─────────────────────────────────────────────── */

function ThinDial({ text, state }: { text: string; state: string }) {
  const reducedMotion = useReducedMotionPreference();
  const carry = useCarryPulse(text, !reducedMotion && state === 'running');
  return (
    <div className={`timer-dial dial-thin state-${state}`} aria-label={text}>
      <FlipDigits value={text} />
      <DialSweep pulse={carry} />
    </div>
  );
}

/* ─── 翻页机械 ─────────────────────────────────────────────── */

function FlipChar({ char, animate }: { char: string; animate: boolean }) {
  const [machine, setMachine] = useState(() => createFlipMachine(char));
  useEffect(() => {
    setMachine((current) => updateFlipMachine(current, char, animate));
  }, [animate, char]);

  const active = machine.phase !== 'steady';
  const top = active ? machine.to : machine.shown;
  const bottom = active ? machine.from : machine.shown;
  return (
    <span className={`flip-card phase-${machine.phase}`} data-sequence={machine.sequence}>
      <span className="flip-half flip-top">
        <span className="flip-glyph">{top}</span>
      </span>
      <span className="flip-half flip-bottom">
        <span className="flip-glyph">{bottom}</span>
      </span>
      {machine.phase === 'fold' && (
        <span className="flip-animation" key={`fold-${machine.sequence}`} aria-hidden="true">
          <span
            className="flip-half flip-top flip-flap-top"
            onAnimationEnd={() =>
              setMachine((current) =>
                current.phase === 'fold' ? advanceFlipMachine(current) : current,
              )
            }
          >
            <span className="flip-glyph">{machine.from}</span>
          </span>
        </span>
      )}
      {machine.phase === 'unfold' && (
        <span className="flip-animation" key={`unfold-${machine.sequence}`} aria-hidden="true">
          <span
            className="flip-half flip-bottom flip-flap-bottom"
            onAnimationEnd={() =>
              setMachine((current) =>
                current.phase === 'unfold' ? advanceFlipMachine(current) : current,
              )
            }
          >
            <span className="flip-glyph">{machine.to}</span>
          </span>
        </span>
      )}
      <span className="flip-hinge" aria-hidden="true" />
    </span>
  );
}

function FlipDial({ text, state }: { text: string; state: string }) {
  const reducedMotion = useReducedMotionPreference();
  const animate = !reducedMotion && (state === 'running' || state === 'paused');
  return (
    <div className={`timer-dial dial-flip state-${state}`} aria-label={text}>
      {Array.from(text).map((ch, i) =>
        ch === ':' ? (
          <span className="flip-colon" key={`c-${i}`}>
            :
          </span>
        ) : (
          <FlipChar char={ch} animate={animate} key={`d-${i}`} />
        ),
      )}
    </div>
  );
}

/* ─── 像素点阵 ─────────────────────────────────────────────── */

const CELL = 10;
const GAP = 2;
const CHAR_W = PIXEL_FONT_COLS * (CELL + GAP);
const COLON_W = 2 * (CELL + GAP);

const PixelChar = memo(function PixelChar({
  ch,
  offsetX,
  prevCh,
}: {
  ch: string;
  offsetX: number;
  prevCh: string;
}) {
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
});

const PixelCore = memo(function PixelCore({ lit, percent }: { lit: number; percent: number }) {
  const order = useMemo(() => focusCoreOrder(), []);
  const litSet = useMemo(
    () => new Set(order.slice(0, lit).map(([cx, cy]) => `${cx},${cy}`)),
    [order, lit],
  );

  return (
    <div className="pixel-core" title={`本轮充能 ${percent}%`}>
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
      <span className="pixel-core-caption">充能 {percent}%</span>
    </div>
  );
});

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

  const lit = focusCoreLitCount(coreRatio);
  const percent = Math.round(coreRatio * 100);

  return (
    <div className={`timer-dial dial-pixel state-${state}`} aria-label={text}>
      <svg
        className="pixel-digits"
        viewBox={`0 0 ${width} ${height}`}
        shapeRendering="crispEdges"
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
      <span className="pixel-spec" aria-hidden="true">
        DOT MATRIX · 7×9
      </span>
      <PixelCore lit={lit} percent={percent} />
    </div>
  );
}
