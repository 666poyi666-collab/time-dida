/**
 * Release-only real TomaToDo cloud bridge smoke.
 * Requires TomaToDo to be running with CDP and bound to its cloud account.
 */
import {
  deleteTomatodoRecordThroughBridge,
  writeTomatodoRecordThroughBridge,
} from '../../electron/integrations/tomatodo/cloudBridge';
import { ensureTomatodoBridge } from '../../electron/integrations/tomatodo/bridgeLifecycle';
import { buildTomatodoRecord } from '../../shared/tomatodoPolicy';

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const segmentId = `release-cloud-${runId}`;
const end = Date.now() - 30_000;
const start = end - 6_000;

async function main(): Promise<void> {
  if (process.argv.includes('--probe-only')) {
    const status = await ensureTomatodoBridge();
    if (!status.connected) {
      throw new Error(status.error ?? `番茄 Todo bridge 状态异常：${status.state}`);
    }
    process.stdout.write(
      `${JSON.stringify({ ok: true, probeOnly: true, bridge: status }, null, 2)}\n`,
    );
    return;
  }

  let writeAttempted = false;
  let localRecordObserved = false;
  let verificationPassed = false;
  let cleanupSucceeded = false;
  let primaryError: unknown = null;
  let cleanupError: unknown = null;
  try {
    const record = buildTomatodoRecord({
      segmentId,
      subject: '学习',
      startedAt: start,
      endedAt: end,
      activeElapsedMs: end - start,
    });
    // 从调用开始就按 marker 尝试清理；即使 CDP 响应在 addRecord 之后丢失，也不能跳过回收。
    writeAttempted = true;
    const first = await writeTomatodoRecordThroughBridge(record);
    localRecordObserved = first.recordFound;
    if (!first.available) throw new Error('番茄 Todo CDP 同步桥不可用');
    if (!first.ok || !first.localWritten) {
      throw new Error(`番茄 Todo 本地写入失败：${first.error ?? 'unknown error'}`);
    }
    if (first.cloudRecordReadbackSupported !== false) {
      throw new Error('番茄 Todo bridge 能力声明异常：本版本不支持专注记录云端回读');
    }
    if (!first.uploadConfirmed) {
      throw new Error(`番茄 Todo 上传接口未确认：${first.cloudError ?? 'unknown cloud error'}`);
    }

    const second = await writeTomatodoRecordThroughBridge(record);
    if (!second.ok || !second.recordFound || !second.uploadConfirmed || !second.skipped) {
      throw new Error('番茄 Todo marker 幂等验证失败');
    }
    verificationPassed = true;
  } catch (error) {
    primaryError = error;
  } finally {
    if (writeAttempted) {
      try {
        const cleanup = await deleteTomatodoRecordThroughBridge(segmentId);
        if (!cleanup.available || !cleanup.ok) {
          throw new Error(
            `番茄 Todo 临时记录清理失败：${cleanup.error ?? `deleted=${cleanup.deletedCount}`}`,
          );
        }
        if (
          cleanup.cleanupScope !== 'local-record-only' ||
          cleanup.remoteDeleteSupported !== false
        ) {
          throw new Error('番茄 Todo bridge 返回了不可信的远端删除能力声明');
        }
        if (cleanup.deletedCount > 1 || (localRecordObserved && cleanup.deletedCount !== 1)) {
          throw new Error(`番茄 Todo 临时 marker 清理数量异常：deleted=${cleanup.deletedCount}`);
        }
        const secondCleanup = await deleteTomatodoRecordThroughBridge(segmentId);
        if (!secondCleanup.available || !secondCleanup.ok || secondCleanup.deletedCount !== 0) {
          throw new Error('番茄 Todo 临时记录清理不幂等');
        }
        cleanupSucceeded = true;
      } catch (error) {
        cleanupError = error;
      }
    }
  }

  if (primaryError) {
    if (cleanupError && primaryError instanceof Error) {
      const cleanupMessage =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      primaryError.message = `${primaryError.message}; cleanup: ${cleanupMessage}`;
    }
    throw primaryError;
  }
  if (cleanupError) throw cleanupError;

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: verificationPassed && cleanupSucceeded,
        localMarkerWrittenAndVerified: true,
        cloudUploadConfirmed: true,
        cloudRecordReadbackSupported: false,
        markerIdempotent: true,
        localCleanupSucceeded: cleanupSucceeded,
        remoteDeleteSupported: false,
        remoteCleanupVerified: false,
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
