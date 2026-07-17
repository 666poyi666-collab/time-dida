import { TOMATODO_SUBJECT_OPTIONS } from '@shared/tomatodoPolicy';
import type { TomatodoSubject } from '@shared/types';

interface TomatodoSubjectChipsProps {
  value: TomatodoSubject | null;
  onChange: (subject: TomatodoSubject) => void;
  disabled?: boolean;
  compact?: boolean;
  includeFallback?: boolean;
  className?: string;
}

export function TomatodoSubjectChips({
  value,
  onChange,
  disabled = false,
  compact = false,
  includeFallback = false,
  className = '',
}: TomatodoSubjectChipsProps) {
  const options = includeFallback
    ? TOMATODO_SUBJECT_OPTIONS
    : TOMATODO_SUBJECT_OPTIONS.filter((option) => option.value !== '学习');

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`.trim()}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            title={option.value === '学习' ? '学习（未识别时的默认板块）' : option.value}
            onClick={() => onChange(option.value)}
            className={`motion-press rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              compact ? 'min-w-[24px] px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]'
            } ${
              active
                ? 'border-accent/35 bg-accent/10 text-accent'
                : 'border-border/50 bg-bg-card/50 text-fg-muted hover:bg-bg-subtle hover:text-fg'
            }`}
          >
            {compact ? option.shortLabel : option.value}
          </button>
        );
      })}
    </div>
  );
}
