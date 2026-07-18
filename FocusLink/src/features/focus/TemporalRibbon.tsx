import { useMemo, type CSSProperties } from 'react';
import { buildMixedTimelineItems } from '@shared/focus/timeline';
import type { TimerSnapshot, TimerState } from '@shared/types';

const WINDOW_MIN = 8 * 60_000;
const WINDOW_MAX = 3 * 60 * 60_000;
const NOW_POSITION = 76;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clock(value: number): string {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function tickStep(span: number): number {
  if (span <= 12 * 60_000) return 60_000;
  if (span <= 60 * 60_000) return 5 * 60_000;
  return 15 * 60_000;
}

export function TemporalRibbon({
  snapshot,
  state,
  now,
  wallMs,
  activeMs,
  pauseMs,
}: {
  snapshot: TimerSnapshot | null;
  state: TimerState;
  now: number;
  wallMs: number;
  activeMs: number;
  pauseMs: number;
}) {
  const moments = useMemo(
    () =>
      buildMixedTimelineItems({
        segments: snapshot?.segments ?? [],
        pauseEvents: snapshot?.pauseEvents ?? [],
        currentSegmentId: snapshot?.currentSegmentId ?? null,
        state,
        now,
      }),
    [now, snapshot?.currentSegmentId, snapshot?.pauseEvents, snapshot?.segments, state],
  );

  const span = clamp(wallMs * 1.25 || WINDOW_MIN, WINDOW_MIN, WINDOW_MAX);
  // NOW stays fixed while the world clock advances beneath it. A pause is time too:
  // the completed focus strip freezes at the pause boundary and the pause strip grows
  // toward NOW until focus resumes.
  const start = now - span * (NOW_POSITION / 100);
  const position = (time: number) => ((time - start) / span) * 100;
  const step = tickStep(span);

  const ticks = useMemo(() => {
    const first = Math.ceil(start / step) * step;
    const result: number[] = [];
    for (let value = first; value <= start + span; value += step) result.push(value);
    return result;
  }, [start, span, step]);

  const strips = moments
    .map((moment) => {
      const end =
        moment.endedAt ??
        (moment.type === 'focus' && state === 'paused' && snapshot?.currentPauseStartedAt
          ? snapshot.currentPauseStartedAt
          : now);
      const left = position(moment.startedAt);
      const width = Math.max(0.8, position(end) - left);
      return { ...moment, left, width };
    })
    .filter((moment) => moment.left < 102 && moment.left + moment.width > -2);
  const measuredMs = Math.max(1, wallMs, activeMs + pauseMs);
  const focusShare = Math.min(100, (activeMs / measuredMs) * 100);
  const pauseShare = Math.min(100 - focusShare, (pauseMs / measuredMs) * 100);
  const focusCount = moments.filter((moment) => moment.type === 'focus').length;
  const pauseCount = moments.filter((moment) => moment.type === 'pause').length;

  return (
    <figure className="temporal-ribbon" data-state={state}>
      <div className="ribbon-caption">
        <span className="ribbon-title">时间织带</span>
        <span className="ribbon-legend">
          {moments.length === 0 ? '尚未记录' : `${focusCount} 段专注 · ${pauseCount} 次暂停`}
        </span>
      </div>
      <div
        className="ribbon-viewport"
        role="img"
        aria-label={`本次专注的时间织带，当前${state === 'paused' ? '暂停' : state === 'running' ? '专注' : '待机'}`}
      >
        <div className="ribbon-paper-grid" aria-hidden="true" />
        {ticks.map((value, index) => {
          const left = position(value);
          return (
            <span
              key={value}
              className={`ribbon-tick ${index % 2 === 0 ? 'major' : ''}`}
              style={{ '--ribbon-x': `${left}%` } as CSSProperties}
              aria-hidden="true"
            >
              <i />
              {index % 2 === 0 && Math.abs(left - NOW_POSITION) > 6 && (
                <small>{clock(value)}</small>
              )}
            </span>
          );
        })}
        <div className="ribbon-lane">
          {strips.map((moment, index) => (
            <span
              key={`${moment.type}-${moment.id}`}
              className={`ribbon-event event-${moment.type} ${moment.isActive ? 'active' : ''}`}
              style={
                {
                  '--ribbon-x': `${moment.left}%`,
                  '--ribbon-w': `${moment.width}%`,
                  '--ribbon-order': index,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <span className="ribbon-now" aria-hidden="true">
          <i />
          <small>此刻</small>
        </span>
        {moments.length === 0 && (
          <div className="ribbon-empty">
            <span />
            <p>开始后，专注与暂停会在这里留下真实时间纹理</p>
          </div>
        )}
        {moments.length > 0 && (
          <div className="ribbon-composition-block">
            <span className="ribbon-composition-label">时间构成</span>
            <div
              className="ribbon-composition"
              aria-label={`专注占比 ${Math.round(focusShare)}%，暂停占比 ${Math.round(pauseShare)}%`}
            >
              <span className="focus" style={{ width: `${focusShare}%` }} />
              <span className="pause" style={{ width: `${pauseShare}%` }} />
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}
