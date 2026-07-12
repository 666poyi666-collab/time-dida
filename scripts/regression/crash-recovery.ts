// 崩溃恢复测试：模拟 running/paused 状态下强杀，重启后 recover() 验证
// 用法：
//   阶段1（崩溃前 running）：npx electron dist-selftest/crash-recovery.cjs start
//   阶段2（恢复 running）：  npx electron dist-selftest/crash-recovery.cjs recover-running
//   阶段3（恢复 paused）：    npx electron dist-selftest/crash-recovery.cjs recover-paused
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  initDatabase,
  closeDatabase,
  listSessions,
  getActiveSession,
  listSegments,
  listPauses,
  getSession,
} from '../../electron/db/index.js';
import { TimerManager } from '../../electron/timer/manager.js';
import { logger } from '../../electron/logger.js';
import { configureIsolatedUserData } from './isolatedUserData.js';

const RESULT_FILE = path.join(process.cwd(), 'crash-recovery-result.json');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const phase = process.argv[2] || 'start';
configureIsolatedUserData('crash-recovery', phase === 'start');

function writeResult(data: any): void {
  fs.writeFileSync(RESULT_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log('===== CRASH RECOVERY RESULT =====');
  console.log(JSON.stringify(data, null, 2));
}

app.whenReady().then(async () => {
  logger.init();
  initDatabase();

  try {
    if (phase === 'start') {
      // ===== 阶段1：start + 等2s + 强退（app.exit 跳过应用自己的优雅退出流程）=====
      const timer = new TimerManager('new-segment');
      timer.recover(); // 清理可能的旧 active session（finished 的不影响）
      const snap = timer.start();
      await sleep(2000);
      // 不 stop，直接退出，模拟崩溃
      // 注意：process.exit 不会触发 before-quit，所以 dispose 不会被调用
      writeResult({
        phase: 'start-crashed',
        sessionId: snap.sessionId,
        message: 'started, waited 2s, then exited without timer disposal',
        activeElapsedAtCrash: timer.getSnapshot().activeElapsedMs,
      });
      // 关闭 DB 连接（避免 WAL 未刷盘），然后强制退出
      timer.persistSnapshot?.();
      // 只解除进程内 interval，不调用 dispose/stop；数据库里的 active 会话保持崩溃现场。
      (timer as unknown as { stopTick: () => void }).stopTick();
      closeDatabase();
      app.exit(0);
    } else if (phase === 'recover-running') {
      // ===== 阶段2：重启，recover() 应恢复为 running =====
      const timer = new TimerManager('new-segment');
      timer.recover();
      const snap = timer.getSnapshot();
      const session = getActiveSession();
      writeResult({
        phase: 'recovered-running',
        state: snap.state,
        sessionId: snap.sessionId,
        activeElapsedMs: snap.activeElapsedMs,
        pauseElapsedMs: snap.pauseElapsedMs,
        hasActiveSession: session !== null,
        // 期望：state=running, activeElapsed >= 2000（含崩溃前的2s + 重启时间）
        stateOk: snap.state === 'running',
        activeOk: snap.activeElapsedMs >= 1500, // 至少 1.5s
        noNegative: snap.activeElapsedMs >= 0 && snap.pauseElapsedMs >= 0,
        sessionActiveInDb: session?.status === 'active',
      });
      // 现在 pause，然后崩溃（测试 paused 恢复）
      timer.pause();
      await sleep(1000);
      timer.persistSnapshot?.();
      closeDatabase();
      app.exit(0);
    } else if (phase === 'recover-paused') {
      // ===== 阶段3：重启，recover() 应恢复为 paused =====
      const timer = new TimerManager('new-segment');
      timer.recover();
      const snap = timer.getSnapshot();
      const session = getActiveSession();
      // 然后 stop 结束会话
      const finalSnap = timer.stop();
      const sessionId = finalSnap.sessionId;
      const segments = sessionId ? listSegments(sessionId) : [];
      const pauses = sessionId ? listPauses(sessionId) : [];

      writeResult({
        phase: 'recovered-paused-then-stopped',
        recoveredState: snap.state,
        recoveredActiveMs: snap.activeElapsedMs,
        recoveredPauseMs: snap.pauseElapsedMs,
        finalState: finalSnap.state,
        finalActiveMs: finalSnap.activeElapsedMs,
        finalPauseMs: finalSnap.pauseElapsedMs,
        finalWallMs: finalSnap.wallElapsedMs,
        // 期望：recover 后 state=paused
        recoveredPausedOk: snap.state === 'paused',
        // 期望：pauseElapsed >= 1000（崩溃前 pause 了 1s）
        pauseOk: finalSnap.pauseElapsedMs >= 700,
        noNegative:
          finalSnap.activeElapsedMs >= 0 &&
          finalSnap.pauseElapsedMs >= 0 &&
          finalSnap.wallElapsedMs >= 0,
        wallGeActive: finalSnap.wallElapsedMs >= finalSnap.activeElapsedMs,
        segmentsCount: segments.length,
        pausesCount: pauses.length,
        sessionStatus: session?.status,
        success:
          snap.state === 'paused' &&
          finalSnap.pauseElapsedMs >= 700 &&
          finalSnap.activeElapsedMs >= 0,
      });
      closeDatabase();
      app.exit(0);
    } else {
      throw new Error(`unknown crash-recovery phase: ${phase}`);
    }
  } catch (err: any) {
    writeResult({ phase, error: err?.message ?? String(err), stack: err?.stack });
    app.exit(1);
  }
});
