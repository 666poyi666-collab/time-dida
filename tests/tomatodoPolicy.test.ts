import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_SUBJECT_MAP,
  DEFAULT_SUBJECT_KEYWORDS,
  TOMATODO_FALLBACK_SUBJECT,
  TOMATODO_SUBJECTS,
  buildTomatodoRecord,
  buildTomatodoRecordFromSegment,
  classifySubjectByProject,
  classifySubjectByTitle,
  collectSyncedSegmentIds,
  getTomatodoMarker,
  hasTomatodoMarker,
  normalizeSubject,
  parseSegmentIdFromMarker,
  resolveSubject,
  shouldSyncSegmentToTomatodo,
  type TomatodoSegmentLike,
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
  createdAt: 1782000000000,
  updatedAt: 1782010800000,
  ...overrides,
});

describe('tomatodo subject classification', () => {
  it('exposes the six major subjects plus fallback', () => {
    expect(TOMATODO_SUBJECTS).toEqual(['语文', '数学', '英语', '物理', '化学', '生物']);
    expect(TOMATODO_FALLBACK_SUBJECT).toBe('杂');
  });

  it('classifies by title keywords for all six subjects', () => {
    const cases: Array<[string, string]> = [
      ['数学函数练习', '数学'],
      ['英语单词背诵', '英语'],
      ['语文古诗鉴赏', '语文'],
      ['物理力学分析', '物理'],
      ['化学离子反应', '化学'],
      ['生物细胞结构', '生物'],
    ];
    for (const [title, expected] of cases) {
      expect(classifySubjectByTitle(title)).toBe(expected);
    }
  });

  it('returns null when title cannot be classified', () => {
    expect(classifySubjectByTitle('整理书桌')).toBeNull();
    expect(classifySubjectByTitle('')).toBeNull();
    expect(classifySubjectByTitle(null)).toBeNull();
  });

  it('classifies by dida project id', () => {
    expect(classifySubjectByProject('69ddb78ce4b07562692283fc')).toBe('数学');
    expect(classifySubjectByProject('69ddb78ce4b07562692283fd')).toBe('物理');
    expect(classifySubjectByProject('unknown')).toBeNull();
    expect(classifySubjectByProject(null)).toBeNull();
  });

  it('project overrides title in resolveSubject', () => {
    // 标题像语文，但项目是数学 → 应判数学（与 Python test_subject_resolution_by_project_overrides_title 一致）
    const got = resolveSubject({
      title: '古诗背诵',
      projectId: '69ddb78ce4b07562692283fc',
    });
    expect(got).toBe('数学');
  });

  it('falls back to title when project unknown', () => {
    expect(resolveSubject({ title: '英语听力', projectId: 'unknown' })).toBe('英语');
  });

  it('falls back to 杂 when neither project nor title matches', () => {
    expect(resolveSubject({ title: '整理书桌' })).toBe('杂');
    expect(resolveSubject({ title: '' })).toBe('杂');
  });

  it('normalizes unknown subjects to fallback', () => {
    expect(normalizeSubject('体育')).toBe('杂');
    expect(normalizeSubject('数学')).toBe('数学');
    expect(normalizeSubject(null)).toBe('杂');
  });

  it('respects custom keyword and project maps', () => {
    expect(
      resolveSubject({
        title: '自定义关键词',
        subjectKeywords: { 语文: ['自定义'] },
        projectSubjectMap: {},
      }),
    ).toBe('语文');
  });
});

describe('tomatodo sync gating', () => {
  it('syncs only ended segments with positive elapsed', () => {
    expect(shouldSyncSegmentToTomatodo(endedSegment())).toBe(true);
    expect(
      shouldSyncSegmentToTomatodo({ id: 'x', endedAt: null, activeElapsedMs: 1000 }),
    ).toBe(false);
    expect(
      shouldSyncSegmentToTomatodo({ id: 'x', endedAt: 123, activeElapsedMs: 0 }),
    ).toBe(false);
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
      'name', 'time', 'startDate', 'createDate',
      'i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9',
      's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9',
      'isComplete', 'isSynced', 'isTransfer', 'boundDeviceId',
    ] as const;
    for (const key of required) {
      expect(rec).toHaveProperty(key);
    }
    expect(rec.name).toBe('数学');
    expect(rec.time).toBe(45);
    expect(rec.startDate).toBe(1782000000000);
    expect(rec.createDate).toBe(1782010800000);
    expect(rec.i2).toBe(1); // 真实库 PCRecord 的 i2 恒为 1
    expect(rec.isComplete).toBe(1);
    expect(rec.isSynced).toBe(1);
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
      activeElapsedMs: 63.216667 * 60 * 1000, // 对齐真实库 id=176 记录
    });
    expect(rec.time).toBeCloseTo(63.216667, 4);
  });

  it('enforces a 0.1 minute floor', () => {
    const rec = buildTomatodoRecord({
      segmentId: 'seg-3',
      subject: '英语',
      startedAt: 1000,
      endedAt: 2000,
      activeElapsedMs: 100, // 0.1 秒
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
    expect(
      buildTomatodoRecordFromSegment(endedSegment({ endedAt: null }), '数学'),
    ).toBeNull();
    expect(
      buildTomatodoRecordFromSegment(endedSegment({ activeElapsedMs: 0 }), '数学'),
    ).toBeNull();
  });
});

describe('default config tables are non-empty', () => {
  it('has keywords for all six subjects', () => {
    for (const subject of TOMATODO_SUBJECTS) {
      expect(DEFAULT_SUBJECT_KEYWORDS[subject as Exclude<typeof subject, '杂'>]?.length).toBeGreaterThan(0);
    }
  });

  it('has at least one project mapping', () => {
    expect(Object.keys(DEFAULT_PROJECT_SUBJECT_MAP).length).toBeGreaterThan(0);
  });
});
