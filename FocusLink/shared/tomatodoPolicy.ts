// Tomatodo sync policy helpers (pure functions, no IO side effects)

import type { FocusSegment, TomatodoSubject } from './types';

export const TOMATODO_SUBJECTS: readonly TomatodoSubject[] = [
  '语文',
  '数学',
  '英语',
  '物理',
  '化学',
  '生物',
];

export const TOMATODO_FALLBACK_SUBJECT: TomatodoSubject = '学习';
/** 标记由 v0.5.3+ 云同步链路管理的记录，避免新配置重复执行旧数据修复。 */
export const TOMATODO_CLOUD_V053_MARKER = '[FocusLink:tomatodo:cloud-v053]';
export const ALL_SUBJECTS: readonly TomatodoSubject[] = [...TOMATODO_SUBJECTS, '学习'];
export const TOMATODO_SUBJECT_OPTIONS = [
  { value: '语文', shortLabel: '语' },
  { value: '数学', shortLabel: '数' },
  { value: '英语', shortLabel: '英' },
  { value: '物理', shortLabel: '物' },
  { value: '化学', shortLabel: '化' },
  { value: '生物', shortLabel: '生' },
  { value: '学习', shortLabel: '学' },
] as const satisfies ReadonlyArray<{ value: TomatodoSubject; shortLabel: string }>;

/**
 * 可用于首次自动归类的文本。调用方通常按「片段标题、任务标题、任务正文、标签」的
 * 顺序传入；第一个命中学科的文本优先，避免正文中的偶发词覆盖任务标题。
 */
export type TomatodoSubjectCandidateText = string | null | undefined;

interface SubjectKeywordRule {
  subject: Exclude<TomatodoSubject, '学习'>;
  /** 明确的学科名或英文别名，优先于同一文本中的一般关键词。 */
  aliases: readonly string[];
  /** 尽量使用学科特有词，避免「阅读」「实验」等跨学科泛词误判。 */
  keywords: readonly string[];
}

/**
 * 中学常见学科词。这里刻意不把「阅读」「实验」「题目」等泛词作为触发条件：
 * 自动结果只在有足够把握时给出，其他情况交给兜底「学习」和手动修正。
 */
const SUBJECT_KEYWORD_RULES: readonly SubjectKeywordRule[] = [
  {
    subject: '语文',
    aliases: ['语文', '国文', '汉语', '汉语言', 'chinese'],
    keywords: [
      '文言文',
      '古诗文',
      '古诗词',
      '现代文',
      '名著阅读',
      '诗歌鉴赏',
      '作文',
      '写作',
      '病句',
      '修辞',
      '字音',
      '字形',
      '成语',
    ],
  },
  {
    subject: '数学',
    aliases: ['数学', 'maths', 'math'],
    keywords: [
      '三角函数',
      '圆锥曲线',
      '立体几何',
      '解析几何',
      '排列组合',
      '因式分解',
      '不等式',
      '函数',
      '方程',
      '数列',
      '集合',
      '几何',
      '代数',
      '概率',
      '统计',
      '三角',
      '向量',
      '导数',
      '分式',
    ],
  },
  {
    subject: '英语',
    aliases: ['英语', '英文', 'english'],
    keywords: [
      '完形填空',
      '语法填空',
      '英语语法',
      '英文语法',
      '英语阅读',
      '英文阅读',
      '听力',
      '口语',
      '单词',
      '词汇',
      '短语',
      '音标',
      '翻译',
    ],
  },
  {
    subject: '物理',
    aliases: ['物理', 'physics'],
    keywords: [
      '力学',
      '电学',
      '光学',
      '声学',
      '热学',
      '电路',
      '电磁',
      '浮力',
      '压强',
      '功率',
      '加速度',
      '牛顿',
      '动量',
      '机械能',
      '电势',
      '电阻',
      '欧姆',
      '透镜',
      '波动',
    ],
  },
  {
    subject: '化学',
    aliases: ['化学', '化學', 'chemistry'],
    keywords: [
      '化学方程式',
      '化学式',
      '氧化还原',
      '化合价',
      '电解质',
      '金属活动性',
      '元素',
      '原子',
      '分子',
      '离子',
      '酸碱',
      '有机',
      '无机',
      '摩尔',
      '溶液',
      '配平',
      '沉淀',
      '滴定',
    ],
  },
  {
    subject: '生物',
    aliases: ['生物', 'biology'],
    keywords: [
      '光合作用',
      '呼吸作用',
      '生态系统',
      '染色体',
      '微生物',
      '细胞',
      '遗传',
      '基因',
      'dna',
      'rna',
      '生态',
      '种群',
      '群落',
      '植物',
      '动物',
      '人体',
      '免疫',
      '进化',
      '生殖',
      '神经',
      '蛋白质',
      '酶',
    ],
  },
];

export function isTomatodoSubject(subject: string | null | undefined): subject is TomatodoSubject {
  return !!subject && (ALL_SUBJECTS as readonly string[]).includes(subject);
}

export function normalizeSubject(subject: string | null | undefined): TomatodoSubject {
  // 本次迁移前的持久化值使用“杂”；读取时无损迁移到新的默认“学习”。
  if (subject === '杂') return TOMATODO_FALLBACK_SUBJECT;
  return isTomatodoSubject(subject) ? subject : TOMATODO_FALLBACK_SUBJECT;
}

/**
 * 从标题、任务正文或标签等候选文本中推断六大学科。没有足够明确的词时返回 null，
 * 由调用方使用配置的兜底学科；不会把不确定文本强行归到任一学科。
 */
export function inferTomatodoSubject(
  candidateText: TomatodoSubjectCandidateText,
  ...additionalCandidates: TomatodoSubjectCandidateText[]
): Exclude<TomatodoSubject, '学习'> | null {
  for (const rawText of [candidateText, ...additionalCandidates]) {
    if (!rawText || !rawText.trim()) continue;
    const text = rawText.toLocaleLowerCase();

    // 明确学科名优先：例如“函数物理”仍应按“物理”而非泛化的“函数”判断。
    const explicit = findFirstRuleMatch(text, 'aliases');
    if (explicit) return explicit;

    const keyword = findFirstRuleMatch(text, 'keywords');
    if (keyword) return keyword;
  }
  return null;
}

function findFirstRuleMatch(
  text: string,
  field: 'aliases' | 'keywords',
): Exclude<TomatodoSubject, '学习'> | null {
  let best:
    { subject: Exclude<TomatodoSubject, '学习'>; index: number; keywordLength: number } | undefined;

  for (const rule of SUBJECT_KEYWORD_RULES) {
    for (const rawKeyword of rule[field]) {
      const keyword = rawKeyword.toLocaleLowerCase();
      const index = text.indexOf(keyword);
      if (index < 0) continue;
      if (
        !best ||
        index < best.index ||
        (index === best.index && keyword.length > best.keywordLength)
      ) {
        best = { subject: rule.subject, index, keywordLength: keyword.length };
      }
    }
  }
  return best?.subject ?? null;
}

export function getTomatodoMarker(segmentId: string): string {
  return `[FocusLink:tomatodo:segment:${segmentId}]`;
}

export function parseSegmentIdFromMarker(s1: string | null | undefined): string | null {
  if (!s1) return null;
  const match = /\[FocusLink:tomatodo:segment:([^\]]+)\]/.exec(s1);
  return match ? match[1] : null;
}

export interface TomatodoSegmentLike {
  id: string;
  endedAt: number | null;
  activeElapsedMs: number;
}

export function shouldSyncSegmentToTomatodo(segment: TomatodoSegmentLike): boolean {
  return segment.endedAt !== null && segment.activeElapsedMs > 0;
}

export interface TomatodoPCRecord {
  id: number;
  name: string;
  time: number;
  startDate: number;
  createDate: number;
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

export function buildTomatodoRecord(input: BuildTomatodoRecordInput): Omit<TomatodoPCRecord, 'id'> {
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
    s9: TOMATODO_CLOUD_V053_MARKER,
    isComplete: 1,
    // 新记录必须保持待同步；只有番茄 Todo 的云上传接口确认成功后才能置 1。
    isSynced: 0,
    isTransfer: 0,
    boundDeviceId: null,
  };
}

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

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function hasTomatodoMarker(record: { s1?: string | null }, segmentId: string): boolean {
  const marker = getTomatodoMarker(segmentId);
  return (record.s1 ?? '').includes(marker);
}

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

export function resolveSegmentSubject(
  segment: { tomatodoSubject: TomatodoSubject | null; title?: string | null },
  _defaultSubject: TomatodoSubject,
  ...candidateTexts: TomatodoSubjectCandidateText[]
): TomatodoSubject {
  // 手动选择永远是最高优先级；兼容旧库中的“杂”并迁移为“学习”。
  if ((segment.tomatodoSubject as string | null) === '杂') return TOMATODO_FALLBACK_SUBJECT;
  if (segment.tomatodoSubject && isTomatodoSubject(segment.tomatodoSubject)) {
    return segment.tomatodoSubject;
  }
  const inferred = inferTomatodoSubject(segment.title, ...candidateTexts);
  if (inferred) return inferred;
  return TOMATODO_FALLBACK_SUBJECT;
}
