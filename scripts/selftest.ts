// Self-test 脚本：在 Electron 主进程环境内执行真实计时流程
// 用法：npx electron scripts/selftest.ts
// 输出 JSON 结果到 stdout 和 selftest-result.json
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// 在 electron 主进程内加载
import { initDatabase, closeDatabase, listSessions, listSegments, listPauses, getSession } from '../electron/db/index.js';
import { TimerManager } from '../electron/timer/manager.js';
import { logger } from '../electron/logger.js';

const RESULT_FILE = path.join(process.cwd(), 'selftest-result.json');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function runSelfTest(): Promise<any> {
  logger.init();
  initDatabase();

  const timer = new TimerManager('new-segment');
  timer.recover();

  const result: any = {
    timestamp: new Date().toISOString(),
    steps: [],
    db: null,
    errors: [],
  };

  try {
    // 场景：专注 2s → 暂停 1s → 继续 2s → 结束
    // 期望：activeElapsed ≈ 4000, pauseElapsed ≈ 1000, wallElapsed ≈ 5000

    // 1. start
    let snap = timer.start();
    result.steps.push({ step: 'start', state: snap.state, sessionId: snap.sessionId, at: Date.now() });
    const sessionId = snap.sessionId!;
    const realStart = Date.now();

    // 2. 专注 2 秒
    await sleep(2000);

    // 3. pause
    snap = timer.pause();
    result.steps.push({
      step: 'pause',
      state: snap.state,
      activeElapsedMs: snap.activeElapsedMs,
      pauseElapsedMs: snap.pauseElapsedMs,
      at: Date.now(),
    });

    // 4. 暂停 1 秒
    await sleep(1000);

    // 5. resume
    snap = timer.resume();
    result.steps.push({
      step: 'resume',
      state: snap.state,
      activeElapsedMs: snap.activeElapsedMs,
      pauseElapsedMs: snap.pauseElapsedMs,
      at: Date.now(),
    });

    // 6. 专注 2 秒
    await sleep(2000);

    // 7. stop
    snap = timer.stop();
    result.steps.push({
      step: 'stop',
      state: snap.state,
      activeElapsedMs: snap.activeElapsedMs,
      pauseElapsedMs: snap.pauseElapsedMs,
      wallElapsedMs: snap.wallElapsedMs,
      at: Date.now(),
    });
    const realEnd = Date.now();

    // ===== 验证三时间模型 =====
    const active = snap.activeElapsedMs;
    const pause = snap.pauseElapsedMs;
    const wall = snap.wallElapsedMs;
    const realWall = realEnd - realStart;

    result.summary = {
      activeElapsedMs: active,
      pauseElapsedMs: pause,
      wallElapsedMs: wall,
      realWallMs: realWall,
      activeSeconds: (active / 1000).toFixed(2),
      pauseSeconds: (pause / 1000).toFixed(2),
      wallSeconds: (wall / 1000).toFixed(2),
      // 期望：active ≈ 4000, pause ≈ 1000, wall ≈ 5000
      activeOk: active >= 3500 && active <= 5500,
      pauseOk: pause >= 700 && pause <= 2000,
      wallOk: wall >= 4500 && wall <= 6500,
      noNegative: active >= 0 && pause >= 0 && wall >= 0,
      wallGeActive: wall >= active,
    };

    // ===== 验证 DB =====
    const session = getSession(sessionId);
    const segments = listSegments(sessionId);
    const pauses = listPauses(sessionId);

    result.db = {
      session: session
        ? {
            id: session.id,
            status: session.status,
            activeElapsedMs: session.activeElapsedMs,
            pauseElapsedMs: session.pauseElapsedMs,
            wallElapsedMs: session.wallElapsedMs,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            endedAtNotNull: session.endedAt !== null,
          }
        : null,
      segments: segments.map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        activeElapsedMs: s.activeElapsedMs,
        endedAtGeStartedAt: s.endedAt ? s.endedAt >= s.startedAt : false,
      })),
      pauses: pauses.map((p) => ({
        id: p.id,
        pauseStartedAt: p.pauseStartedAt,
        pauseEndedAt: p.pauseEndedAt,
        durationMs: p.durationMs,
        endedAtGeStartedAt: p.pauseEndedAt ? p.pauseEndedAt >= p.pauseStartedAt : false,
      })),
      segmentsCount: segments.length,
      pausesCount: pauses.length,
      // segment 时间不重叠
      segmentsNonOverlapping:
        segments.length === 2
          ? (segments[0].endedAt ?? 0) <= segments[1].startedAt
          : true,
    };

    result.success = result.summary.activeOk && result.summary.pauseOk && result.summary.noNegative;
  } catch (err: any) {
    result.errors.push(err?.message ?? String(err));
    result.success = false;
  } finally {
    timer.dispose();
    closeDatabase();
  }

  return result;
}

app.whenReady().then(async () => {
  const result = await runSelfTest();
  fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2), 'utf8');
  console.log('===== SELF-TEST RESULT =====');
  console.log(JSON.stringify(result, null, 2));
  // 清理后退出
  app.exit(result.success ? 0 : 1);
});
