import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HistoryTimelineList } from '../src/features/history/HistoryTimeline';
import type { FocusSegment, PauseEvent } from '../shared/types';

const segment: FocusSegment = {
  id: 'segment-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  taskSource: 'ticktick',
  title: '数学函数练习',
  startedAt: new Date(2026, 6, 22, 20, 0).getTime(),
  endedAt: new Date(2026, 6, 22, 20, 25).getTime(),
  activeElapsedMs: 25 * 60_000,
  note: null,
  cloudFocusId: null,
  tomatodoSubject: null,
  createdAt: 1,
  updatedAt: 1,
};

const pause: PauseEvent = {
  id: 'pause-1',
  sessionId: 'session-1',
  segmentId: 'segment-1',
  pauseStartedAt: new Date(2026, 6, 22, 20, 25).getTime(),
  pauseEndedAt: new Date(2026, 6, 22, 20, 30).getTime(),
  durationMs: 5 * 60_000,
  reason: null,
  createdAt: 1,
  updatedAt: 1,
};

describe('PC history segment ledger', () => {
  it('renders focus and pause as distinct ledger rows with six explicit subject choices', () => {
    const markup = renderToStaticMarkup(
      createElement(HistoryTimelineList, {
        sessionId: 'session-1',
        segments: [segment],
        pauses: [pause],
        filter: 'all',
        linking: false,
        defaultSubject: '学习',
        onLink: vi.fn(),
        onClear: vi.fn(),
        onComplete: vi.fn(),
        onResync: vi.fn(),
        onSetSubject: vi.fn(),
        tomatodoStatus: {},
        syncStates: {},
        syncMode: 'local-only',
        tomatodoEnabled: true,
        completedTaskIds: new Set<string>(),
      }),
    );

    expect(markup).toContain('history-segment-ledger');
    expect(markup).toContain('history-segment-row hm-stagger-in tone-focus is-linked');
    expect(markup).toContain('history-segment-row hm-stagger-in tone-pause');
    expect(markup).toContain('自动匹配 · 数学');
    expect(markup).toContain('aria-label="手动选择番茄 Todo 学科"');
    for (const subject of ['语文', '数学', '英语', '物理', '化学', '生物']) {
      expect(markup).toContain(`title="${subject}"`);
    }
    expect(markup).not.toContain('rounded-lg border border-border/60 bg-bg-card/50');
  });
});
