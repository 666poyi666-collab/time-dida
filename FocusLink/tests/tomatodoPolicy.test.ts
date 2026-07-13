import { describe, expect, it } from 'vitest';
import {
  ALL_SUBJECTS,
  TOMATODO_FALLBACK_SUBJECT,
  TOMATODO_SUBJECTS,
  buildTomatodoRecord,
  buildTomatodoRecordFromSegment,
  collectSyncedSegmentIds,
  getTomatodoMarker,
  hasTomatodoMarker,
  inferTomatodoSubject,
  normalizeSubject,
  parseSegmentIdFromMarker,
  resolveSegmentSubject,
  shouldSyncSegmentToTomatodo,
} from '../shared/tomatodoPolicy';
import type { FocusSegment } from '../shared/types';

const endedSegment = (overrides: Partial<FocusSegment> = {}): FocusSegment => ({
  id: 'seg-1',
  sessionId: 'sess-1',
  taskId: 'task-1',
  taskSource: 'ticktick',
  title: '数学函数',
  startedAt: 1782000000000,
  endedAt: 1782010800000,
  activeElapsedMs: 45 * 60 * 1000,
  note: null,
  cloudFocusId: null,
  tomatodoSubject: null,
  createdAt: 1782000000000,
  updatedAt: 1782010800000,
  ...overrides,
});

describe('tomatodo subjects', () => {
  it('exposes the six major subjects plus fallback', () => {
    expect(TOMATODO_SUBJECTS).toEqual(['语文', '数学', '英语', '物理', '化学', '生物']);
    expect(TOMATODO_FALLBACK_SUBJECT).toBe('学习');
    expect(ALL_SUBJECTS).toEqual(['语文', '数学', '英语', '物理', '化学', '生物', '学习']);
  });

  it('normalizes unknown subjects to fallback', () => {
    expect(normalizeSubject('体育')).toBe('学习');
    expect(normalizeSubject('数学')).toBe('数学');
    expect(normalizeSubject(null)).toBe('学习');
    expect(normalizeSubject('')).toBe('学习');
    expect(normalizeSubject('杂')).toBe('学习');
  });
});

describe('tomatodo resolveSegmentSubject (manual selection)', () => {
  it('uses segment.tomatodoSubject when set', () => {
    expect(resolveSegmentSubject({ tomatodoSubject: '物理' }, '学习')).toBe('物理');
    expect(resolveSegmentSubject({ tomatodoSubject: '语文' }, '数学')).toBe('语文');
  });

  it('falls back to defaultSubject when tomatodoSubject is null', () => {
    expect(resolveSegmentSubject({ tomatodoSubject: null }, '化学')).toBe('化学');
    expect(resolveSegmentSubject({ tomatodoSubject: null }, '学习')).toBe('学习');
  });

  it('uses automatic subject matching before falling back to the configured default', () => {
    expect(resolveSegmentSubject({ tomatodoSubject: null, title: '函数与数列复习' }, '学习')).toBe(
      '数学',
    );
    expect(
      resolveSegmentSubject({ tomatodoSubject: null, title: '没有学科词的任务' }, '化学'),
    ).toBe('化学');
  });

  it('keeps a manual subject above automatic keywords', () => {
    expect(resolveSegmentSubject({ tomatodoSubject: '物理', title: '数学函数练习' }, '学习')).toBe(
      '物理',
    );
  });

  it('accepts task title and content as later automatic-match candidates', () => {
    expect(
      resolveSegmentSubject(
        { tomatodoSubject: null, title: null },
        '学习',
        '任务标题',
        '氧化还原笔记',
      ),
    ).toBe('化学');
  });

  it('normalizes invalid tomatodoSubject to fallback', () => {
    expect(
      resolveSegmentSubject(
        { tomatodoSubject: '体育' as unknown as FocusSegment['tomatodoSubject'] },
        '学习',
      ),
    ).toBe('学习');
    expect(
      resolveSegmentSubject(
        { tomatodoSubject: 'invalid' as unknown as FocusSegment['tomatodoSubject'] },
        '数学',
      ),
    ).toBe('数学');
  });
});

describe('tomatodo automatic subject matching', () => {
  it.each([
    ['语文', '文言文与古诗词鉴赏'],
    ['数学', '数学函数与方程'],
    ['英语', '英语完形填空和单词'],
    ['物理', '物理电路与浮力'],
    ['化学', '化学氧化还原与离子'],
    ['生物', '生物细胞遗传 DNA'],
  ] as const)('matches common middle-school %s keywords', (subject, title) => {
    expect(inferTomatodoSubject(title)).toBe(subject);
  });

  it('does not confuse the core math, physics, chemistry, and biology terms', () => {
    expect(inferTomatodoSubject('函数和不等式训练')).toBe('数学');
    expect(inferTomatodoSubject('电路、压强和透镜')).toBe('物理');
    expect(inferTomatodoSubject('摩尔、溶液与化合价')).toBe('化学');
    expect(inferTomatodoSubject('细胞、基因与生态系统')).toBe('生物');
  });

  it('returns null for ambiguous text so the caller can use its fallback', () => {
    expect(inferTomatodoSubject('整理今天的课堂资料')).toBeNull();
  });
});

describe('tomatodo sync gating', () => {
  it('syncs only ended segments with positive elapsed', () => {
    expect(shouldSyncSegmentToTomatodo(endedSegment())).toBe(true);
    expect(shouldSyncSegmentToTomatodo({ id: 'x', endedAt: null, activeElapsedMs: 1000 })).toBe(
      false,
    );
    expect(shouldSyncSegmentToTomatodo({ id: 'x', endedAt: 123, activeElapsedMs: 0 })).toBe(false);
  });
});

describe('tomatodo marker', () => {
  it('builds a stable marker per segment', () => {
    expect(getTomatodoMarker('seg-1')).toBe('[FocusLink:tomatodo:segment:seg-1]');
  });

  it('parses segment id back from marker', () => {
    expect(parseSegmentIdFromMarker('[FocusLink:tomatodo:segment:seg-1]')).toBe('seg-1');
    expect(parseSegmentIdFromMarker('')).toBeNull();
    expect(parseSegmentIdFromMarker(null)).toBeNull();
  });

  it('detects existing marker for dedup', () => {
    const record = { s1: '[FocusLink:tomatodo:segment:seg-1]' };
    expect(hasTomatodoMarker(record, 'seg-1')).toBe(true);
    expect(hasTomatodoMarker(record, 'seg-2')).toBe(false);
    expect(hasTomatodoMarker({ s1: '' }, 'seg-1')).toBe(false);
  });

  it('collects all synced segment ids', () => {
    const records = [
      { s1: '[FocusLink:tomatodo:segment:a]' },
      { s1: '[FocusLink:tomatodo:segment:b]' },
      { s1: '' },
    ];
    expect(collectSyncedSegmentIds(records)).toEqual(new Set(['a', 'b']));
  });
});

describe('tomatodo record builder', () => {
  it('builds a PCRecord matching the real tomatodo_db.json schema', () => {
    const rec = buildTomatodoRecord({
      segmentId: 'seg-1',
      subject: '数学',
      startedAt: 1782000000000,
      endedAt: 1782010800000,
      activeElapsedMs: 45 * 60 * 1000,
    });
    const required = [
      'name',
      'time',
      'startDate',
      'createDate',
      'i1',
      'i2',
      'i3',
      'i4',
      'i5',
      'i6',
      'i7',
      'i8',
      'i9',
      's1',
      's2',
      's3',
      's4',
      's5',
      's6',
      's7',
      's8',
      's9',
      'isComplete',
      'isSynced',
      'isTransfer',
      'boundDeviceId',
    ] as const;
    for (const key of required) {
      expect(rec).toHaveProperty(key);
    }
    expect(rec.name).toBe('数学');
    expect(rec.time).toBe(45);
    expect(rec.startDate).toBe(1782000000000);
    expect(rec.createDate).toBe(1782010800000);
    expect(rec.i2).toBe(1);
    expect(rec.isComplete).toBe(1);
    expect(rec.isSynced).toBe(0);
    expect(rec.isTransfer).toBe(0);
    expect(rec.boundDeviceId).toBeNull();
    expect(rec.s1).toBe('[FocusLink:tomatodo:segment:seg-1]');
  });

  it('converts elapsed ms to minutes with decimals', () => {
    const rec = buildTomatodoRecord({
      segmentId: 'seg-2',
      subject: '数学',
      startedAt: 1782091545000,
      endedAt: 1782095338000,
      activeElapsedMs: 63.216667 * 60 * 1000,
    });
    expect(rec.time).toBeCloseTo(63.216667, 4);
  });

  it('enforces a 0.1 minute floor', () => {
    const rec = buildTomatodoRecord({
      segmentId: 'seg-3',
      subject: '英语',
      startedAt: 1000,
      endedAt: 2000,
      activeElapsedMs: 100,
    });
    expect(rec.time).toBeGreaterThanOrEqual(0.1);
  });

  it('builds from a FocusSegment', () => {
    const rec = buildTomatodoRecordFromSegment(endedSegment(), '数学');
    expect(rec).not.toBeNull();
    expect(rec?.name).toBe('数学');
    expect(rec?.s1).toBe('[FocusLink:tomatodo:segment:seg-1]');
  });

  it('refuses to build from an unfinished segment', () => {
    expect(buildTomatodoRecordFromSegment(endedSegment({ endedAt: null }), '数学')).toBeNull();
    expect(buildTomatodoRecordFromSegment(endedSegment({ activeElapsedMs: 0 }), '数学')).toBeNull();
  });
});
