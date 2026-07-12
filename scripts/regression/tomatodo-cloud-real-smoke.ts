/**
 * Release-only real TomaToDo cloud bridge smoke.
 * Requires TomaToDo to be running with CDP and bound to its cloud account.
 */
import {
  deleteTomatodoRecordThroughBridge,
  writeTomatodoRecordThroughBridge,
} from '../../electron/integrations/tomatodo/cloudBridge';
import { buildTomatodoRecord } from '../../shared/tomatodoPolicy';

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const segmentId = `release-cloud-${runId}`;
const end = Date.now() - 30_000;
const start = end - 6_000;

async function main(): Promise<void> {
  let created = false;
  let verificationPassed = false;
  let cleanupSucceeded = false;
  let cleanupError: unknown = null;
  try {
    const record = buildTomatodoRecord({
      segmentId,
      subject: '学习',
      startedAt: start,
      endedAt: end,
      activeElapsedMs: end - start,
    });
    const first = await writeTomatodoRecordThroughBridge(record);
    created = first.recordFound;
    if (!first.available) throw new Error('番茄 Todo CDP 同步桥不可用');
    if (!first.ok || !first.localWritten) {
      throw new Error(`番茄 Todo 本地写入失败：${first.error ?? 'unknown error'}`);
    }
    if (!first.cloudSynced) {
      throw new Error(`番茄 Todo 云端未确认：${first.cloudError ?? 'unknown cloud error'}`);
    }

    const second = await writeTomatodoRecordThroughBridge(record);
    if (!second.ok || !second.recordFound || !second.cloudSynced || !second.skipped) {
      throw new Error('番茄 Todo marker 幂等验证失败');
    }
    verificationPassed = true;
  } finally {
    if (created) {
      try {
        const cleanup = await deleteTomatodoRecordThroughBridge(segmentId);
        if (!cleanup.available || !cleanup.ok || cleanup.deletedCount !== 1) {
          throw new Error(
            `番茄 Todo 临时记录清理失败：${cleanup.error ?? `deleted=${cleanup.deletedCount}`}`,
          );
        }
        const secondCleanup = await deleteTomatodoRecordThroughBridge(segmentId);
        if (!secondCleanup.ok || secondCleanup.deletedCount !== 0) {
          throw new Error('番茄 Todo 临时记录清理不幂等');
        }
        cleanupSucceeded = true;
      } catch (error) {
        cleanupError = error;
      }
    }
    if (cleanupError) throw cleanupError;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: verificationPassed && cleanupSucceeded,
        localWrittenAndVerified: true,
        cloudUploadedAndVerified: true,
        markerIdempotent: true,
        cleanupSucceeded,
      },
      null,
      2,
    )}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
