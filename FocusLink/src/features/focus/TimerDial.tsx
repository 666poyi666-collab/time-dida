// 细刻度计时仪表：一圈 60 根哑光发丝刻度（每 5 格一根稍长刻度），
// 运行中 accent 沿刻度环填充推进，暂停态填充转 pause 红，当前位置细针标记。
// 语义：当前片段的秒针盘 —— 每分钟一圈 60 秒，细针持续顺时针推进。
// 纯 SVG + token 描边，无发光、无渐变、无滤镜。

const SIZE = 300;
const CENTER = SIZE / 2;
const R_BASE = 140; // 刻度根部发丝基线圆
const R_TICK_MAJOR = 131; // 长刻度起点（每 5 格）
const R_OUTER = 146; // 所有刻度终点
const R_NEEDLE = 122; // 细针长度
const NEEDLE_TAIL = 12; // 细针过中心的短尾

function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

// 刻度几何与状态无关，模块级常量只算一次。
const TICKS = Array.from({ length: 60 }, (_, i) => {
  const major = i % 5 === 0;
  const from = polar(i * 6, major ? R_TICK_MAJOR : R_BASE);
  const to = polar(i * 6, R_OUTER);
  return { major, x1: from.x, y1: from.y, x2: to.x, y2: to.y };
});

export function TimerDial({ state, displayMs }: { state: string; displayMs: number }) {
  const totalSeconds = Math.max(0, Math.floor(displayMs / 1000));
  const secondInMinute = totalSeconds % 60;
  // 细针用累计秒数驱动，越过分钟边界不回扫，保持仪器的连续推进感。
  const needleAngle = totalSeconds * 6;
  const settled = state === 'finished' || state === 'stopping';
  const instrumentActive = state === 'running' || state === 'paused' || settled;

  return (
    <svg
      className="timer-dial"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label="专注计时仪表"
    >
      <circle className="timer-dial-base" cx={CENTER} cy={CENTER} r={R_BASE} />
      {TICKS.map((tick, i) => (
        <line
          key={i}
          className={`timer-dial-tick ${tick.major ? 'major' : ''} ${
            instrumentActive && i < secondInMinute ? 'elapsed' : ''
          }`}
          x1={tick.x1}
          y1={tick.y1}
          x2={tick.x2}
          y2={tick.y2}
        />
      ))}
      {instrumentActive && (
        <g
          className="timer-dial-needle"
          style={{
            transform: `rotate(${needleAngle}deg)`,
            transformOrigin: `${CENTER}px ${CENTER}px`,
          }}
        >
          <line x1={CENTER} y1={CENTER + NEEDLE_TAIL} x2={CENTER} y2={CENTER - R_NEEDLE} />
          <circle cx={CENTER} cy={CENTER} r={3} />
        </g>
      )}
    </svg>
  );
}
