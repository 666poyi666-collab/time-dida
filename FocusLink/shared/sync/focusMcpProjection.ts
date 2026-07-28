import type { FocusLedgerV2, FocusMetadataV2 } from './v2Protocol';

export const FOCUS_MCP_PROJECTION_SCHEMA_VERSION = 1 as const;
export const FOCUS_MCP_FRESH_AFTER_MS = 15 * 60 * 1000;

export interface FocusProjectionLedger {
  revision: number;
  payload: FocusLedgerV2;
}

export interface FocusProjectionMetadata {
  revision: number;
  payload: FocusMetadataV2;
}

export interface FocusMcpTaskSummary {
  taskId: string | null;
  source: 'local' | 'ticktick' | null;
  title: string;
  focusCount: number;
  activeMs: number;
  lastFocusedAt: number;
}

export interface FocusMcpSessionSummary {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  status: 'finished' | 'aborted';
  activeMs: number;
  pausedMs: number;
  wallMs: number;
  title: string | null;
  task: {
    taskId: string;
    source: 'local' | 'ticktick';
    title: string | null;
  } | null;
  segmentTasks: Array<{
    taskId: string | null;
    source: 'local' | 'ticktick' | null;
    title: string;
    activeMs: number;
  }>;
}

export interface FocusMcpProjection {
  schemaVersion: typeof FOCUS_MCP_PROJECTION_SCHEMA_VERSION;
  authority: 'focuslink-account-do';
  generatedAt: number;
  lastVerifiedAt: number | null;
  dataThrough: number | null;
  freshness: {
    state: 'fresh' | 'stale' | 'unknown';
    ageMs: number | null;
    staleAfterMs: number;
  };
  range: { from: number; to: number };
  totals: {
    focusCount: number;
    activeMs: number;
    pausedMs: number;
    wallMs: number;
  };
  tasks: FocusMcpTaskSummary[];
  recentSessions: FocusMcpSessionSummary[];
  changeSeq: number;
}

export function buildFocusMcpProjection(input: {
  ledgers: readonly FocusProjectionLedger[];
  metadata: readonly FocusProjectionMetadata[];
  generatedAt: number;
  lastVerifiedAt: number | null;
  changeSeq: number;
  from: number;
  to: number;
  limit: number;
}): FocusMcpProjection {
  const metadataBySession = new Map(
    input.metadata.map((item) => [item.payload.sessionId, item.payload] as const),
  );
  const ledgers = input.ledgers
    .map((item) => item.payload)
    .filter(
      (ledger) =>
        isUsableLedger(ledger) && ledger.endedAt >= input.from && ledger.endedAt < input.to,
    )
    .sort((left, right) => right.endedAt - left.endedAt);

  const tasks = new Map<string, FocusMcpTaskSummary>();
  const sessions = ledgers.map((ledger) => {
    const metadata = metadataBySession.get(ledger.sessionId) ?? null;
    const segmentTasks = summarizeSessionTasks(ledger, metadata);
    for (const task of segmentTasks) {
      const key = `${task.source ?? 'none'}:${task.taskId ?? task.title}`;
      const current = tasks.get(key);
      if (current) {
        current.focusCount += 1;
        current.activeMs += task.activeMs;
        current.lastFocusedAt = Math.max(current.lastFocusedAt, ledger.endedAt);
      } else {
        tasks.set(key, {
          taskId: task.taskId,
          source: task.source,
          title: task.title,
          focusCount: 1,
          activeMs: task.activeMs,
          lastFocusedAt: ledger.endedAt,
        });
      }
    }
    return {
      sessionId: ledger.sessionId,
      startedAt: ledger.startedAt,
      endedAt: ledger.endedAt,
      status: ledger.status,
      activeMs: ledger.activeElapsedMs,
      pausedMs: ledger.pausedElapsedMs,
      wallMs: ledger.wallElapsedMs,
      title: metadata?.title ?? null,
      task: metadata?.taskAssociation ?? null,
      segmentTasks,
    } satisfies FocusMcpSessionSummary;
  });

  const ageMs =
    input.lastVerifiedAt === null ? null : Math.max(0, input.generatedAt - input.lastVerifiedAt);
  return {
    schemaVersion: FOCUS_MCP_PROJECTION_SCHEMA_VERSION,
    authority: 'focuslink-account-do',
    generatedAt: input.generatedAt,
    lastVerifiedAt: input.lastVerifiedAt,
    dataThrough: ledgers[0]?.endedAt ?? null,
    freshness: {
      state: ageMs === null ? 'unknown' : ageMs <= FOCUS_MCP_FRESH_AFTER_MS ? 'fresh' : 'stale',
      ageMs,
      staleAfterMs: FOCUS_MCP_FRESH_AFTER_MS,
    },
    range: { from: input.from, to: input.to },
    totals: sessions.reduce(
      (total, session) => ({
        focusCount: total.focusCount + 1,
        activeMs: total.activeMs + session.activeMs,
        pausedMs: total.pausedMs + session.pausedMs,
        wallMs: total.wallMs + session.wallMs,
      }),
      { focusCount: 0, activeMs: 0, pausedMs: 0, wallMs: 0 },
    ),
    tasks: [...tasks.values()].sort(
      (left, right) => right.activeMs - left.activeMs || right.lastFocusedAt - left.lastFocusedAt,
    ),
    recentSessions: sessions.slice(0, input.limit),
    changeSeq: input.changeSeq,
  };
}

function summarizeSessionTasks(
  ledger: FocusLedgerV2,
  metadata: FocusMetadataV2 | null,
): FocusMcpSessionSummary['segmentTasks'] {
  const associated = new Map<string, FocusMcpSessionSummary['segmentTasks'][number]>();
  for (const segment of ledger.segments) {
    if (!isNonEmptyString(segment.taskId) || !isTaskSource(segment.taskSource)) continue;
    const title = cleanTitle(segment.title) ?? metadata?.taskAssociation?.title ?? '未命名任务';
    const key = `${segment.taskSource}:${segment.taskId}`;
    const current = associated.get(key);
    if (current) current.activeMs += safeDuration(segment.activeElapsedMs);
    else {
      associated.set(key, {
        taskId: segment.taskId,
        source: segment.taskSource,
        title,
        activeMs: safeDuration(segment.activeElapsedMs),
      });
    }
  }
  if (associated.size > 0) return [...associated.values()];

  const fallback = metadata?.taskAssociation;
  return [
    {
      taskId: fallback?.taskId ?? null,
      source: fallback?.source ?? null,
      title: cleanTitle(fallback?.title) ?? cleanTitle(metadata?.title) ?? '自由专注',
      activeMs: safeDuration(ledger.activeElapsedMs),
    },
  ];
}

function isUsableLedger(value: FocusLedgerV2): boolean {
  return (
    isNonEmptyString(value.sessionId) &&
    Number.isSafeInteger(value.startedAt) &&
    Number.isSafeInteger(value.endedAt) &&
    value.endedAt >= value.startedAt &&
    (value.status === 'finished' || value.status === 'aborted') &&
    Array.isArray(value.segments)
  );
}

function isTaskSource(value: unknown): value is 'local' | 'ticktick' {
  return value === 'local' || value === 'ticktick';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title.length > 0 ? title.slice(0, 1_000) : null;
}

function safeDuration(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
