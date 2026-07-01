import { describe, expect, it } from 'vitest';
import {
  hasTicktickLinkedSegments,
  shouldAutoSyncFinishedSession,
  type AutoSyncSegmentLike,
} from '../shared/autoSyncPolicy';

const localSegment: AutoSyncSegmentLike = {
  taskId: 'local-task',
  taskSource: 'local',
};

const ticktickSegment: AutoSyncSegmentLike = {
  taskId: 'ticktick-task',
  taskSource: 'ticktick',
};

describe('auto sync policy', () => {
  it('requires at least one ticktick-linked segment', () => {
    expect(hasTicktickLinkedSegments([])).toBe(false);
    expect(hasTicktickLinkedSegments([localSegment])).toBe(false);
    expect(hasTicktickLinkedSegments([{ taskId: null, taskSource: 'ticktick' }])).toBe(false);
    expect(hasTicktickLinkedSegments([localSegment, ticktickSegment])).toBe(true);
  });

  it('does not auto-sync in local-only mode', () => {
    expect(shouldAutoSyncFinishedSession('local-only', [ticktickSegment])).toBe(false);
  });

  it('auto-syncs finished sessions in focus-record and comment modes when linked to ticktick', () => {
    expect(shouldAutoSyncFinishedSession('focus-record', [ticktickSegment])).toBe(true);
    expect(shouldAutoSyncFinishedSession('comment', [ticktickSegment])).toBe(true);
  });
});
