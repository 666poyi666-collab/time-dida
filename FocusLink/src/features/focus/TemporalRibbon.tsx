import { useMemo, type CSSProperties } from 'react';
import { buildMixedTimelineItems } from '@shared/focus/timeline';
import type { TimerSnapshot, TimerState } from '@shared/types';

const NOW_POSITION = 76;

function clock(value: number): string {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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

  const isMicro = state === 'running';
  // 专注是 75 秒近景：每秒都能看见指针滴答推进；暂停切换为 90 分钟远景，
  // 30 分钟为大格。跨度变化由 CSS 做收缩/拉远过渡，而不是瞬间换图。
  const span = isMicro ? 75_000 : 90 * 60_000;
  // NOW stays fixed while the world clock advances beneath it. A pause is time too:
  // the completed focus strip freezes at the pause boundary and the pause strip grows
  // toward NOW until focus resumes.
  const start = now - span * (NOW_POSITION / 100);
  const position = (time: number) => ((time - start) / span) * 100;
  const step = isMicro ? 1_000 : 5 * 60_000;

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
  return (
    <figure className="temporal-ribbon" data-state={state}>
      <div className="ribbon-caption">
        <span className="ribbon-title">时间之带</span>
        <span className="ribbon-legend">
          {isMicro
            ? '秒级近景 · 每小格 1 秒 · 每大格 1 分钟'
            : '分钟远景 · 每小格 5 分钟 · 每大格 30 分钟'}
        </span>
      </div>
      <div
        className="ribbon-viewport"
        data-scale={isMicro ? 'seconds' : 'minutes'}
        role="img"
        aria-label={`本次专注的时间织带，当前${state === 'paused' ? '暂停' : state === 'running' ? '专注' : '待机'}`}
      >
        <div className="ribbon-paper-grid" aria-hidden="true" />
        {ticks.map((value) => {
          const left = position(value);
          const date = new Date(value);
          const major = isMicro ? date.getSeconds() === 0 : date.getMinutes() % 30 === 0;
          return (
            <span
              key={value}
              className={`ribbon-tick ${major ? 'major' : 'minor'}`}
              style={{ '--ribbon-x': `${left}%` } as CSSProperties}
              aria-hidden="true"
            >
              <i />
              {major && Math.abs(left - NOW_POSITION) > 7 && (
                <small>{isMicro ? `${date.getMinutes()}'00"` : clock(value)}</small>
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
            <span className="ribbon-composition-label">本轮专注率</span>
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
