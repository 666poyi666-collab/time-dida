import { forwardRef, type ReactNode, type SVGProps } from 'react';

export const FOCUS_CORE_GLYPHS = [
  'focus',
  'tasks',
  'stats',
  'settings',
  'play',
  'pause',
  'stop',
  'expand',
  'collapse',
  'main-window',
  'check',
  'check-circle',
  'check-circle-filled',
  'circle',
  'search',
  'refresh',
  'close',
  'minus',
  'chevron-up',
  'chevron-down',
  'chevron-left',
  'chevron-right',
] as const;

export type FocusGlyphName = (typeof FOCUS_CORE_GLYPHS)[number];
export type FocusOpticalSize = 12 | 16 | 20;

export function resolveFocusOpticalSize(size: number): FocusOpticalSize {
  if (size <= 13) return 12;
  if (size <= 18) return 16;
  return 20;
}

export function resolveFocusStroke(size: number): number {
  switch (resolveFocusOpticalSize(size)) {
    case 12:
      return 2.1;
    case 16:
      return 1.85;
    case 20:
      return 1.7;
  }
}

interface FocusGlyphProps extends Omit<SVGProps<SVGSVGElement>, 'height' | 'width'> {
  glyph: FocusGlyphName;
  size?: number;
  strokeWidth?: number;
}

export const FocusGlyph = forwardRef<SVGSVGElement, FocusGlyphProps>(
  ({ glyph, size = 20, strokeWidth, className = '', ...rest }, ref) => {
    const opticalSize = resolveFocusOpticalSize(size);
    const resolvedStroke = strokeWidth ?? resolveFocusStroke(size);

    return (
      <svg
        ref={ref}
        className={['focus-icon', className].filter(Boolean).join(' ')}
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={resolvedStroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        data-focus-glyph={glyph}
        data-optical-size={opticalSize}
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        <GlyphArtwork glyph={glyph} opticalSize={opticalSize} />
      </svg>
    );
  },
);
FocusGlyph.displayName = 'FocusGlyph';

function GlyphArtwork({
  glyph,
  opticalSize,
}: {
  glyph: FocusGlyphName;
  opticalSize: FocusOpticalSize;
}): ReactNode {
  const compact = opticalSize === 12;

  switch (glyph) {
    case 'focus':
      return (
        <>
          <path d="M10 3.1a6.9 6.9 0 1 0 6.38 4.28" />
          <path d="M13.7 3.92a6.9 6.9 0 0 1 2.18 1.94" />
          <path d="M10 6.3V10l2.72 1.72" />
          <circle className="focus-icon__node" cx="10" cy="10" r={compact ? 1.05 : 0.9} />
        </>
      );
    case 'tasks':
      return (
        <>
          <path d="m3.7 5.15 1.18 1.2 2.16-2.4" />
          <path d="M9 5.2h7" />
          <path d="m3.7 10 1.18 1.2L7.04 8.8" />
          <path d="M9 10.05h7" />
          <circle cx="5.15" cy="14.85" r={compact ? 1.1 : 1.25} />
          <path d="M9 14.85h7" />
        </>
      );
    case 'stats':
      return (
        <>
          <path d="M3.6 16.15h12.8" />
          <path d="M5.15 14.1V10.7" />
          <path d="M10 14.1V7.45" />
          <path d="M14.85 14.1V4.55" />
          <path className="focus-icon__secondary" d="m4.95 8.05 4.9-2.4 4.85-2.35" />
        </>
      );
    case 'settings':
      return (
        <>
          <path d="M3.65 5.15h12.7" />
          <path d="M3.65 10h12.7" />
          <path d="M3.65 14.85h12.7" />
          <circle className="focus-icon__node" cx="7" cy="5.15" r={compact ? 1.2 : 1.35} />
          <circle className="focus-icon__node" cx="13.1" cy="10" r={compact ? 1.2 : 1.35} />
          <circle className="focus-icon__node" cx="8.9" cy="14.85" r={compact ? 1.2 : 1.35} />
        </>
      );
    case 'play':
      return (
        <path
          d={compact ? 'M7.1 5.45 14.75 10 7.1 14.55Z' : 'M6.45 4.65 15.45 10l-9 5.35Z'}
          fill="currentColor"
          stroke="none"
        />
      );
    case 'pause':
      return (
        <>
          <rect
            x={compact ? 6.2 : 5.8}
            y={compact ? 5.1 : 4.55}
            width={compact ? 2.35 : 2.7}
            height={compact ? 9.8 : 10.9}
            rx="0.8"
            fill="currentColor"
            stroke="none"
          />
          <rect
            x={compact ? 11.45 : 11.5}
            y={compact ? 5.1 : 4.55}
            width={compact ? 2.35 : 2.7}
            height={compact ? 9.8 : 10.9}
            rx="0.8"
            fill="currentColor"
            stroke="none"
          />
        </>
      );
    case 'stop':
      return (
        <rect
          x={compact ? 5.4 : 4.9}
          y={compact ? 5.4 : 4.9}
          width={compact ? 9.2 : 10.2}
          height={compact ? 9.2 : 10.2}
          rx={compact ? 1.5 : 1.9}
          fill="currentColor"
          stroke="none"
        />
      );
    case 'expand':
      return (
        <>
          <path d="m9 11-4.5 4.5M4.5 12v3.5H8" />
          <path d="m11 9 4.5-4.5M12 4.5h3.5V8" />
        </>
      );
    case 'collapse':
      return (
        <>
          <path d="M4 6.5h12" />
          <path d="m6.5 10 3.5 3.5 3.5-3.5" />
        </>
      );
    case 'main-window':
      return (
        <>
          <rect x="3.2" y="4" width="13.6" height="12" rx="1.2" />
          <path d="M3.8 7h12.4" />
          <path d="m9.5 12.5 4.5-4.5M11 8h3v3" />
        </>
      );
    case 'check':
      return <path d={compact ? 'm4.9 10.1 3.15 3.1 7.1-7.05' : 'm4.2 10.15 3.55 3.55 8.05-8'} />;
    case 'check-circle':
      return (
        <>
          <circle cx="10" cy="10" r="6.65" />
          <path d="m6.7 10.15 2.15 2.2 4.55-4.8" />
        </>
      );
    case 'check-circle-filled':
      return (
        <>
          <circle cx="10" cy="10" r="7" fill="currentColor" stroke="none" />
          <path className="focus-icon__cutout" d="m6.7 10.15 2.15 2.2 4.55-4.8" />
        </>
      );
    case 'circle':
      return <circle cx="10" cy="10" r={compact ? 6.25 : 6.7} />;
    case 'search':
      return (
        <>
          <circle cx="8.75" cy="8.75" r={compact ? 4.25 : 4.75} />
          <path d={compact ? 'm12 12 3.7 3.7' : 'm12.25 12.25 3.8 3.8'} />
        </>
      );
    case 'refresh':
      return (
        <>
          <path d="M15.8 7.25A6.2 6.2 0 0 0 5.2 5.5L3.8 7.15" />
          <path d="M3.8 3.85v3.3h3.3" />
          <path d="M4.2 12.75A6.2 6.2 0 0 0 14.8 14.5l1.4-1.65" />
          <path d="M16.2 16.15v-3.3h-3.3" />
        </>
      );
    case 'close':
      return (
        <>
          <path d="m5.35 5.35 9.3 9.3" />
          <path d="m14.65 5.35-9.3 9.3" />
        </>
      );
    case 'minus':
      return <path d="M4.5 10h11" />;
    case 'chevron-up':
      return <path d={compact ? 'm5.45 12.2 4.55-4.4 4.55 4.4' : 'm4.8 12.75 5.2-5.1 5.2 5.1'} />;
    case 'chevron-down':
      return <path d={compact ? 'm5.45 7.8 4.55 4.4 4.55-4.4' : 'm4.8 7.25 5.2 5.1 5.2-5.1'} />;
    case 'chevron-left':
      return <path d={compact ? 'm12.2 5.45-4.4 4.55 4.4 4.55' : 'm12.75 4.8-5.1 5.2 5.1 5.2'} />;
    case 'chevron-right':
      return <path d={compact ? 'm7.8 5.45 4.4 4.55-4.4 4.55' : 'm7.25 4.8 5.1 5.2-5.1 5.2'} />;
  }
}

export const FocusBrandGlyph = forwardRef<
  SVGSVGElement,
  Omit<SVGProps<SVGSVGElement>, 'height' | 'width'>
>(({ className = '', ...rest }, ref) => (
  <svg
    ref={ref}
    className={['focus-brand-glyph', className].filter(Boolean).join(' ')}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path className="brand-mark-f" d="M5 20V4h12M5 11h9" />
    <path className="brand-mark-l" d="M15 9v11h5" />
    <path className="brand-mark-cross" d="M12 11h3" />
  </svg>
));
FocusBrandGlyph.displayName = 'FocusBrandGlyph';

export const TaskCompletionGlyph = forwardRef<
  SVGSVGElement,
  Omit<SVGProps<SVGSVGElement>, 'height' | 'width'>
>(({ className = '', ...rest }, ref) => (
  <svg
    ref={ref}
    className={['focus-icon', 'task-complete-glyph', className].filter(Boolean).join(' ')}
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    data-focus-glyph="check-circle"
    data-optical-size="20"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <circle className="task-complete-ring" cx="10" cy="10" r="7.55" />
    <path className="task-complete-check" d="m6.2 10.15 2.6 2.65 5.15-5.45" />
  </svg>
));
TaskCompletionGlyph.displayName = 'TaskCompletionGlyph';
