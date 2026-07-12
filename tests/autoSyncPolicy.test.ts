import { describe, expect, it } from 'vitest';
import {
  hasTicktickLinkedSegments,
  shouldAutoSyncFinishedSession,
  shouldDeleteDidaFocusRecord,
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

describe('dida deletion policy', () => {
  it('uses dida for a persisted cloud id even after the active provider changes', () => {
    expect(
      shouldDeleteDidaFocusRecord(
        { taskSource: 'ticktick', cloudFocusId: 'cloud-focus-1' },
        'ticktick-oauth',
      ),
    ).toBe(true);
  });

  it('uses marker lookup for dida associations when dida is active', () => {
    expect(
      shouldDeleteDidaFocusRecord({ taskSource: 'ticktick', cloudFocusId: null }, 'ticktick-cli'),
    ).toBe(true);
    expect(
      shouldDeleteDidaFocusRecord({ taskSource: 'ticktick', cloudFocusId: null }, 'local'),
    ).toBe(true);
  });

  it('does not call dida for an OAuth-only association with no dida cloud id', () => {
    expect(
      shouldDeleteDidaFocusRecord({ taskSource: 'ticktick', cloudFocusId: null }, 'ticktick-oauth'),
    ).toBe(false);
  });
});
