import type { FeedEntityRow } from "./feed-types";
import { listFeedEntities } from "./feed-store";

export interface MaterializedSession {
  id: string;
  startedAt: number;
  endedAt: number;
  status: "finished" | "aborted";
  activeElapsedMs: number;
  pausedElapsedMs: number;
  wallElapsedMs: number;
  originDeviceId: string;
  segments: unknown[];
  pauses: unknown[];
  title: string | null;
  note: string | null;
  subject: string | null;
  tags: unknown[];
  taskAssociation: Record<string, unknown> | null;
  metadataUpdatedAt: number | null;
  corrected: boolean;
  authority: {
    ledgerRevision: number;
    metadataRevision: number | null;
    correctionRevision: number | null;
    lastChangeSeq: number;
  };
}

export interface ProjectionResult {
  sessions: MaterializedSession[];
  tombstones: number;
  invalidEntities: number;
  /** Encrypted Focus Guard entities are counted but never interpreted by MCP. */
  opaqueEncryptedEntities: number;
  entityCount: number;
}

export interface FocusTaskSummary {
  taskId: string | null;
  taskTitle: string | null;
  sessionCount: number;
  finishedCount: number;
  abortedCount: number;
  activeElapsedMs: number;
  pausedElapsedMs: number;
  wallElapsedMs: number;
  firstFocusedAt: number;
  lastFocusedAt: number;
  latestSessionId: string;
}

export interface McpFocusRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  status: "finished" | "aborted";
  activeElapsedMs: number;
  pausedElapsedMs: number;
  wallElapsedMs: number;
  title: string | null;
  task: {
    taskId: string | null;
    taskTitle: string | null;
  } | null;
  corrected: boolean;
  revision: {
    ledger: number;
    metadata: number | null;
    correction: number | null;
    lastChangeSeq: number;
  };
}

export async function readProjection(
  db: D1Database,
  accountKey: string,
): Promise<ProjectionResult> {
  return materializeProjection(await listFeedEntities(db, accountKey));
}

export function materializeProjection(rows: FeedEntityRow[]): ProjectionResult {
  const ledgerRows = new Map<string, FeedEntityRow>();
  const metadataRows = new Map<string, FeedEntityRow>();
  const corrections = new Map<string, { row: FeedEntityRow; after: Record<string, unknown> }>();
  let tombstones = 0;
  let invalidEntities = 0;
  let opaqueEncryptedEntities = 0;

  for (const row of rows) {
    if (row.deleted === 1) {
      tombstones += 1;
      continue;
    }
    const payload = parsePayload(row.payload_json);
    if (!payload) {
      invalidEntities += 1;
      continue;
    }
    if (row.entity_type === "focus_ledger_v2") {
      ledgerRows.set(row.entity_id, row);
    } else if (row.entity_type === "focus_metadata_v2") {
      metadataRows.set(row.entity_id, row);
    } else if (row.entity_type === "focus_ledger_correction_v2") {
      const sessionId = payload.sessionId;
      const after = payload.after;
      if (typeof sessionId !== "string" || !isRecord(after)) {
        invalidEntities += 1;
        continue;
      }
      const existing = corrections.get(sessionId);
      if (!existing || existing.row.change_seq < row.change_seq) {
        corrections.set(sessionId, { row, after });
      }
    } else {
      opaqueEncryptedEntities += 1;
    }
  }

  const sessions: MaterializedSession[] = [];
  for (const [entityId, ledgerRow] of ledgerRows) {
    const baseLedger = parsePayload(ledgerRow.payload_json);
    if (!baseLedger) {
      invalidEntities += 1;
      continue;
    }
    const correction = corrections.get(entityId);
    const ledger = correction?.after ?? baseLedger;
    const metadataRow = metadataRows.get(entityId);
    const metadata = metadataRow ? parsePayload(metadataRow.payload_json) : null;
    const session = parseSession(entityId, ledger, metadata, {
      ledgerRevision: ledgerRow.revision,
      metadataRevision: metadataRow?.revision ?? null,
      correctionRevision: correction?.row.revision ?? null,
      lastChangeSeq: Math.max(
        ledgerRow.change_seq,
        metadataRow?.change_seq ?? 0,
        correction?.row.change_seq ?? 0,
      ),
    });
    if (!session) {
      invalidEntities += 1;
      continue;
    }
    sessions.push({ ...session, corrected: Boolean(correction) });
  }

  sessions.sort((left, right) => right.startedAt - left.startedAt || right.id.localeCompare(left.id));
  return { sessions, tombstones, invalidEntities, opaqueEncryptedEntities, entityCount: rows.length };
}

export function sessionsForLocalDate(
  sessions: MaterializedSession[],
  timeZone: string,
  date = new Date(),
): MaterializedSession[] {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const target = formatter.format(date);
  return sessions.filter((session) => formatter.format(new Date(session.startedAt)) === target);
}

export function sessionsInRange(
  sessions: MaterializedSession[],
  fromMs?: number,
  toMs?: number,
): MaterializedSession[] {
  return sessions.filter(
    (session) =>
      (fromMs === undefined || session.startedAt >= fromMs) &&
      (toMs === undefined || session.startedAt < toMs),
  );
}

export function summarizeSessionsByTask(
  sessions: MaterializedSession[],
): {
  tasks: FocusTaskSummary[];
  unassociated: FocusTaskSummary | null;
} {
  const groups = new Map<string, FocusTaskSummary>();

  for (const session of sessions) {
    const identity = taskIdentity(session);
    const key = identity.taskId
      ? `id:${identity.taskId}`
      : identity.taskTitle
        ? `title:${identity.taskTitle}`
        : "unassociated";
    const existing = groups.get(key);
    if (existing) {
      existing.sessionCount += 1;
      existing.finishedCount += session.status === "finished" ? 1 : 0;
      existing.abortedCount += session.status === "aborted" ? 1 : 0;
      existing.activeElapsedMs += session.activeElapsedMs;
      existing.pausedElapsedMs += session.pausedElapsedMs;
      existing.wallElapsedMs += session.wallElapsedMs;
      existing.firstFocusedAt = Math.min(existing.firstFocusedAt, session.startedAt);
      if (session.startedAt > existing.lastFocusedAt) {
        existing.lastFocusedAt = session.startedAt;
        existing.latestSessionId = session.id;
      }
      continue;
    }
    groups.set(key, {
      ...identity,
      sessionCount: 1,
      finishedCount: session.status === "finished" ? 1 : 0,
      abortedCount: session.status === "aborted" ? 1 : 0,
      activeElapsedMs: session.activeElapsedMs,
      pausedElapsedMs: session.pausedElapsedMs,
      wallElapsedMs: session.wallElapsedMs,
      firstFocusedAt: session.startedAt,
      lastFocusedAt: session.startedAt,
      latestSessionId: session.id,
    });
  }

  const unassociated = groups.get("unassociated") ?? null;
  groups.delete("unassociated");
  const tasks = [...groups.values()].sort(
    (left, right) =>
      right.activeElapsedMs - left.activeElapsedMs ||
      right.sessionCount - left.sessionCount ||
      (left.taskTitle ?? left.taskId ?? "").localeCompare(
        right.taskTitle ?? right.taskId ?? "",
      ),
  );
  return { tasks, unassociated };
}

export function toMcpFocusRecord(session: MaterializedSession): McpFocusRecord {
  const task = taskIdentity(session);
  return {
    id: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: session.status,
    activeElapsedMs: session.activeElapsedMs,
    pausedElapsedMs: session.pausedElapsedMs,
    wallElapsedMs: session.wallElapsedMs,
    title: session.title,
    task: task.taskId || task.taskTitle ? task : null,
    corrected: session.corrected,
    revision: {
      ledger: session.authority.ledgerRevision,
      metadata: session.authority.metadataRevision,
      correction: session.authority.correctionRevision,
      lastChangeSeq: session.authority.lastChangeSeq,
    },
  };
}

function parseSession(
  entityId: string,
  ledger: Record<string, unknown>,
  metadata: Record<string, unknown> | null,
  authority: MaterializedSession["authority"],
): Omit<MaterializedSession, "corrected"> | null {
  if (
    ledger.sessionId !== entityId ||
    !isFiniteNumber(ledger.startedAt) ||
    !isFiniteNumber(ledger.endedAt) ||
    (ledger.status !== "finished" && ledger.status !== "aborted") ||
    !isFiniteNonNegativeNumber(ledger.activeElapsedMs) ||
    !isFiniteNonNegativeNumber(ledger.pausedElapsedMs) ||
    !isFiniteNonNegativeNumber(ledger.wallElapsedMs) ||
    typeof ledger.originDeviceId !== "string" ||
    !Array.isArray(ledger.segments) ||
    !Array.isArray(ledger.pauses)
  ) return null;
  if (metadata && metadata.sessionId !== entityId) return null;
  return {
    id: entityId,
    startedAt: ledger.startedAt,
    endedAt: ledger.endedAt,
    status: ledger.status,
    activeElapsedMs: ledger.activeElapsedMs,
    pausedElapsedMs: ledger.pausedElapsedMs,
    wallElapsedMs: ledger.wallElapsedMs,
    originDeviceId: ledger.originDeviceId,
    segments: ledger.segments,
    pauses: ledger.pauses,
    title: nullableString(metadata?.title),
    note: nullableString(metadata?.note),
    subject: nullableString(metadata?.subject),
    tags: Array.isArray(metadata?.tags) ? metadata.tags : [],
    taskAssociation: isRecord(metadata?.taskAssociation) ? metadata.taskAssociation : null,
    metadataUpdatedAt: isFiniteNumber(metadata?.updatedAt) ? metadata.updatedAt : null,
    authority,
  };
}

function parsePayload(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function taskIdentity(session: MaterializedSession): {
  taskId: string | null;
  taskTitle: string | null;
} {
  const association = session.taskAssociation;
  const taskId =
    firstNonEmptyString(association?.taskId, association?.id, association?.task_id) ?? null;
  const taskTitle =
    firstNonEmptyString(
      association?.taskTitle,
      association?.title,
      association?.name,
      association?.task_name,
      session.title,
    ) ?? null;
  return { taskId, taskTitle };
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  )?.trim();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
