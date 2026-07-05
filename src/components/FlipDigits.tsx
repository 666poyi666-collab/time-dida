// FlipDigits - 丝滑数字翻转组件
// v0.3.11: 每位数字独立追踪变化，仅变化的位触发微翻转动画
// 设计原则：极克制——不是 3D 翻转，而是 scale + opacity + blur 的物理过渡
// 帧率优先：只用 transform/opacity/filter（合成器属性），不触发 layout

import { useEffect, useRef, useState, memo } from 'react';

// 单个数字位：值变化时触发 digit-flip 动画
const FlipDigit = memo(function FlipDigit({ char }: { char: string }) {
  const [changed, setChanged] = useState(false);
  const prevRef = useRef(char);

  useEffect(() => {
    if (prevRef.current !== char) {
      setChanged(true);
      prevRef.current = char;
      // 动画时长 180ms（--motion-normal），180ms 后清除
      const timer = setTimeout(() => setChanged(false), 180);
      return () => clearTimeout(timer);
    }
  }, [char]);

  return (
    <span className="motion-digit-flip" data-changed={changed}>
      {char}
    </span>
  );
});

// 完整数字串：拆分为单字符，数字位用 FlipDigit，分隔符直接渲染
export const FlipDigits = memo(function FlipDigits({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const chars = value.split('');
  return (
    <span className={className} style={{ display: 'inline-flex' }}>
      {chars.map((char, i) => {
        // 数字才翻转，冒号/空格等保持静态
        if (/[0-9]/.test(char)) {
          return <FlipDigit key={i} char={char} />;
        }
        return <span key={i}>{char}</span>;
      })}
    </span>
  );
});
