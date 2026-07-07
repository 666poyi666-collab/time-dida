// 番茄 Todo 同步策略 - 纯函数，无 IO 副作用
// 学科分类、去重判定、PCRecord 构造（不含 id，由 adapter 填充）
// 移植自 fanqie/supervision/supervision_config.py + tomatodo_writer.py 的验证逻辑

import type { FocusSegment } from './types';

/** 番茄 Todo 支持的学科大类 + 兜底「杂」 */
export type TomatodoSubject = '语文' | '数学' | '英语' | '物理' | '化学' | '生物' | '杂';

/** 六大学科（不含兜底） */
export const TOMATODO_SUBJECTS: readonly TomatodoSubject[] = [
  '语文',
  '数学',
  '英语',
  '物理',
  '化学',
  '生物',
];

/** 无法识别时的兜底学科 */
export const TOMATODO_FALLBACK_SUBJECT: TomatodoSubject = '杂';

/** 默认学科关键词映射（标题推断用），与 fanqie 初步测试对齐 */
export const DEFAULT_SUBJECT_KEYWORDS: Record<Exclude<TomatodoSubject, '杂'>, string[]> = {
  语文: ['语文', '文言文', '古诗', '阅读理解', '作文', '默写'],
  数学: [
    '数学', 'math', 'Math',
    '函数', '几何', '代数', '三角', '向量', '数列', '导数', '复数', '不等式', '概率', '统计',
  ],
  英语: ['英语', 'english', 'English', '单词', '语法', '完形', '听力'],
  物理: [
    '物理', 'physics', 'Physics',
    '力学', '电学', '电磁', '运动', '牛顿', '能量', '动量', '光学', '热学',
  ],
  化学: [
    '化学', 'chemistry', 'Chemistry',
    '离子', '氧化还原', '元素', '有机', '无机', '反应', '物质的量', '胶体',
  ],
  生物: [
    '生物', 'biology', 'Biology',
    '细胞', '遗传', '基因', '生态', '光合', '呼吸', 'DNA', 'RNA',
  ],
};

/** 默认滴答项目 ID → 学科映射（来自 fanqie/supervision/supervision_config.py） */
export const DEFAULT_PROJECT_SUBJECT_MAP: Record<string, Exclude<TomatodoSubject, '杂'>> = {
  '69ddb78ce4b07562692283fc': '数学',
  '69ddb78ce4b07562692283fd': '物理',
  '69ddb78ce4b09c51886b696e': '化学',
  '6a08dc86e4b0ad7acab7d3d7': '生物',
  '69ddb78ce4b07562692283fe': '生物', // 旧生物项目
  '69cf7a05e4b06b7542450499': '数学', // 方案A-数学三天主线
};

/** 番茄 Todo 稳定去重 marker，存入 PCRecord.s1 字段 */
export function getTomatodoMarker(segmentId: string): string {
  return `[FocusLink:tomatodo:segment:${segmentId}]`;
}

/** 从 PCRecord.s1 反查 segmentId（用于删除联动） */
export function parseSegmentIdFromMarker(s1: string | null | undefined): string | null {
  if (!s1) return null;
  const match = /\[FocusLink:tomatodo:segment:([^\]]+)\]/.exec(s1);
  return match ? match[1] : null;
}

/**
 * 标题关键词推断学科。无法判断返回 null。
 * 纯函数，可单测。
 */
export function classifySubjectByTitle(
  title: string | null | undefined,
  keywords: Record<string, string[]> = DEFAULT_SUBJECT_KEYWORDS,
): Exclude<TomatodoSubject, '杂'> | null {
  if (!title) return null;
  for (const subject of TOMATODO_SUBJECTS) {
    const list = keywords[subject];
    if (!list) continue;
    for (const kw of list) {
      if (kw && title.includes(kw)) {
        return subject as Exclude<TomatodoSubject, '杂'>;
      }
    }
  }
  return null;
}

/**
 * 滴答项目 ID 推断学科。未知返回 null。
 * 纯函数，可单测。
 */
export function classifySubjectByProject(
  projectId: string | null | undefined,
  projectMap: Record<string, string> = DEFAULT_PROJECT_SUBJECT_MAP,
): Exclude<TomatodoSubject, '杂'> | null {
  if (!projectId) return null;
  const subject = projectMap[projectId];
  if (!subject) return null;
  return TOMATODO_SUBJECTS.includes(subject as TomatodoSubject)
    ? (subject as Exclude<TomatodoSubject, '杂'>)
    : null;
}

/** 归一到番茄 Todo 支持的大类，不在列表里则归「杂」 */
export function normalizeSubject(subject: string | null | undefined): TomatodoSubject {
  if (subject && (TOMATODO_SUBJECTS as readonly string[]).includes(subject)) {
    return subject as TomatodoSubject;
  }
  return TOMATODO_FALLBACK_SUBJECT;
}

export interface ResolveSubjectInput {
  /** 任务标题（segment.title 或任务缓存标题） */
  title?: string | null;
  /** 滴答项目 ID（可选，从任务缓存查得） */
  projectId?: string | null;
  /** 自定义关键词映射（覆盖默认） */
  subjectKeywords?: Record<string, string[]>;
  /** 自定义项目→学科映射（覆盖默认） */
  projectSubjectMap?: Record<string, string>;
  /** 兜底学科 */
  fallbackSubject?: TomatodoSubject;
}

/**
 * 综合项目 + 标题推断学科；都失败则返回兜底「杂」。
 * 项目优先级高于标题（与 fanqie 初步测试一致）。
 */
export function resolveSubject(input: ResolveSubjectInput): TomatodoSubject {
  const fallback = input.fallbackSubject ?? TOMATODO_FALLBACK_SUBJECT;
  const byProject = classifySubjectByProject(
    input.projectId,
    input.projectSubjectMap ?? DEFAULT_PROJECT_SUBJECT_MAP,
  );
  if (byProject) return byProject;
  const byTitle = classifySubjectByTitle(
    input.title,
    input.subjectKeywords ?? DEFAULT_SUBJECT_KEYWORDS,
  );
  if (byTitle) return byTitle;
  return normalizeSubject(fallback);
}

/** 同步判定所需的 segment 字段 */
export interface TomatodoSegmentLike {
  id: string;
  endedAt: number | null;
  activeElapsedMs: number;
}

/** 一条 segment 是否值得同步到番茄 Todo：必须已结束且有专注时长 */
export function shouldSyncSegmentToTomatodo(segment: TomatodoSegmentLike): boolean {
  return segment.endedAt !== null && segment.activeElapsedMs > 0;
}

/** PCRecord 字段（不含 id，id 由 adapter 从 recordIdCounter 分配） */
export interface TomatodoPCRecord {
  id: number;
  name: string;
  time: number; // 分钟，支持小数
  startDate: number; // epoch ms
  createDate: number; // epoch ms
  i1: number;
  i2: number;
  i3: number;
  i4: number;
  i5: number;
  i6: number;
  i7: number;
  i8: number;
  i9: number;
  s1: string;
  s2: string;
  s3: string;
  s4: string;
  s5: string;
  s6: string;
  s7: string;
  s8: string;
  s9: string;
  isComplete: number;
  isSynced: number;
  isTransfer: number;
  boundDeviceId: null;
}

export interface BuildTomatodoRecordInput {
  segmentId: string;
  subject: TomatodoSubject;
  startedAt: number;
  endedAt: number;
  activeElapsedMs: number;
}

/**
 * 构造一条 PCRecord（不写盘，不含 id）。
 * schema 严格对齐真实 tomatodo_db.json：
 *   - time 单位为分钟（activeElapsedMs / 60000），保留 6 位小数
 *   - startDate = segment.startedAt，createDate = segment.endedAt
 *   - i2 = 1（真实库 PCRecord 恒为 1），其余 i 字段 = 0
 *   - s1 = FocusLink marker（去重用），其余 s 字段空
 *   - isComplete = 1，isSynced = 1，isTransfer = 0，boundDeviceId = null
 */
export function buildTomatodoRecord(
  input: BuildTomatodoRecordInput,
): Omit<TomatodoPCRecord, 'id'> {
  const minutes = Math.max(0.1, round(Number(input.activeElapsedMs) / 60000, 6));
  return {
    name: input.subject,
    time: minutes,
    startDate: input.startedAt,
    createDate: input.endedAt,
    i1: 0,
    i2: 1,
    i3: 0,
    i4: 0,
    i5: 0,
    i6: 0,
    i7: 0,
    i8: 0,
    i9: 0,
    s1: getTomatodoMarker(input.segmentId),
    s2: '',
    s3: '',
    s4: '',
    s5: '',
    s6: '',
    s7: '',
    s8: '',
    s9: '',
    isComplete: 1,
    isSynced: 1,
    isTransfer: 0,
    boundDeviceId: null,
  };
}

/** 从 FocusSegment + 推断结果构造 PCRecord（便捷重载） */
export function buildTomatodoRecordFromSegment(
  segment: FocusSegment,
  subject: TomatodoSubject,
): Omit<TomatodoPCRecord, 'id'> | null {
  if (!shouldSyncSegmentToTomatodo(segment)) return null;
  return buildTomatodoRecord({
    segmentId: segment.id,
    subject,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt as number,
    activeElapsedMs: segment.activeElapsedMs,
  });
}

/** 保留 n 位小数（避免浮点误差） */
function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 检测一条已有 PCRecord 是否携带指定 segment 的 marker（去重判定） */
export function hasTomatodoMarker(
  record: { s1?: string | null },
  segmentId: string,
): boolean {
  const marker = getTomatodoMarker(segmentId);
  return (record.s1 ?? '').includes(marker);
}

/** 计算 PCRecord 数组中已存在的 marker 对应 segmentId 集合 */
export function collectSyncedSegmentIds(
  records: ReadonlyArray<{ s1?: string | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const r of records) {
    const sid = parseSegmentIdFromMarker(r.s1);
    if (sid) ids.add(sid);
  }
  return ids;
}
