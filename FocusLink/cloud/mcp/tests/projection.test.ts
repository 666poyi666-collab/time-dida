import { describe, expect, it } from "vitest";

import type { FeedEntityRow } from "../src/feed-types";
import {
  materializeProjection,
  summarizeSessionsByTask,
  toMcpFocusRecord,
} from "../src/projection";

describe("FocusLink MCP projection", () => {
  it("aggregates focus counts and duration by concrete task", () => {
    const projection = materializeProjection([
      ledger("session-1", 1, 30_000),
      metadata("session-1", 2, "task-chem", "化学复习"),
      ledger("session-2", 3, 45_000),
      metadata("session-2", 4, "task-chem", "化学复习"),
      ledger("session-3", 5, 20_000),
      metadata("session-3", 6, "task-bio", "生物错题"),
      ledger("session-4", 7, 10_000),
    ]);

    const summary = summarizeSessionsByTask(projection.sessions);

    expect(summary.tasks).toEqual([
      expect.objectContaining({
        taskId: "task-chem",
        taskTitle: "化学复习",
        sessionCount: 2,
        activeElapsedMs: 75_000,
      }),
      expect.objectContaining({
        taskId: "task-bio",
        taskTitle: "生物错题",
        sessionCount: 1,
        activeElapsedMs: 20_000,
      }),
    ]);
    expect(summary.unassociated).toMatchObject({
      sessionCount: 1,
      activeElapsedMs: 10_000,
    });
  });

  it("exposes only the minimal server-readable focus record to MCP", () => {
    const projection = materializeProjection([
      ledger("session-private", 1, 30_000),
      metadata("session-private", 2, "task-1", "数学"),
    ]);
    const record = toMcpFocusRecord(projection.sessions[0]);

    expect(record).toMatchObject({
      id: "session-private",
      task: { taskId: "task-1", taskTitle: "数学" },
      activeElapsedMs: 30_000,
      revision: { lastChangeSeq: 2 },
    });
    expect(record).not.toHaveProperty("note");
    expect(record).not.toHaveProperty("tags");
    expect(record).not.toHaveProperty("originDeviceId");
    expect(record).not.toHaveProperty("segments");
    expect(record).not.toHaveProperty("pauses");
    expect(record).not.toHaveProperty("taskAssociation");
  });
});

function ledger(
  id: string,
  changeSeq: number,
  activeElapsedMs: number,
): FeedEntityRow {
  return row("focus_ledger_v2", id, changeSeq, {
    sessionId: id,
    startedAt: 1_700_000_000_000 + changeSeq * 1_000,
    endedAt: 1_700_000_000_000 + changeSeq * 1_000 + activeElapsedMs,
    status: "finished",
    activeElapsedMs,
    pausedElapsedMs: 0,
    wallElapsedMs: activeElapsedMs,
    originDeviceId: "private-device-id",
    segments: [{ private: true }],
    pauses: [],
  });
}

function metadata(
  id: string,
  changeSeq: number,
  taskId: string,
  taskTitle: string,
): FeedEntityRow {
  return row("focus_metadata_v2", id, changeSeq, {
    sessionId: id,
    title: taskTitle,
    note: "must not leave the projection boundary",
    subject: "private subject",
    tags: ["private-tag"],
    taskAssociation: { taskId, taskTitle, privateField: "hidden" },
    updatedAt: 1_700_000_100_000 + changeSeq,
  });
}

function row(
  entity_type: FeedEntityRow["entity_type"],
  entity_id: string,
  change_seq: number,
  payload: Record<string, unknown>,
): FeedEntityRow {
  return {
    account_key: "test-account",
    entity_type,
    entity_id,
    revision: 1,
    fingerprint: `${change_seq}`.padStart(64, "0"),
    deleted: 0,
    payload_json: JSON.stringify(payload),
    source_device_id: "private-device-id",
    change_seq,
    applied_at: "2026-07-28T00:00:00.000Z",
  };
}
