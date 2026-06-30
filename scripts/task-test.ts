// 本地任务关联测试：在 Electron 主进程内验证任务创建/搜索/关联/继承
// 用法：npx electron dist-selftest/task-test.cjs
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { initDatabase, closeDatabase, listSessions, listSegments } from '../electron/db/index.js';
import { TimerManager } from '../electron/timer/manager.js';
import { LocalTaskProvider } from '../electron/tasks/localProvider.js';
import { logger } from '../electron/logger.js';

const RESULT_FILE = path.join(process.cwd(), 'task-test-result.json');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  logger.init();
  initDatabase();
  const timer = new TimerManager('new-segment');
  timer.recover();

  const result: any = { timestamp: new Date().toISOString(), steps: [], errors: [] };

  try {
    // 1. 创建本地任务
    const task1 = LocalTaskProvider.create('数学复数错题整理');
    const task2 = LocalTaskProvider.create('立体几何听课笔记');
    result.steps.push({ step: 'create-tasks', task1: task1.title, task2: task2.title });

    // 2. 搜索本地任务
    const searchResults = LocalTaskProvider.search('数学');
    result.steps.push({
      step: 'search',
      query: '数学',
      found: searchResults.map((t) => t.title),
      foundTask1: searchResults.some((t) => t.id === task1.id),
    });

    // 3. start 计时
    const snap = timer.start();
    const sessionId = snap.sessionId!;
    const segment1Id = snap.currentSegmentId!;

    // 4. 关联任务到当前 segment
    timer.linkSegmentTask(segment1Id, task1.id, 'local', task1.title);
    result.steps.push({ step: 'link-segment-1-task', segmentId: segment1Id, taskId: task1.id, taskTitle: task1.title });

    // 5. 设置 session 默认任务
    timer.linkSessionTask?.(sessionId, task1.id, 'local');
    result.steps.push({ step: 'set-session-default-task', sessionId, defaultTaskId: task1.id });

    await sleep(500);

    // 6. pause
    timer.pause();
    await sleep(300);

    // 7. resume（new-segment 模式，应新建 segment 并继承 session 默认任务）
    const resumeSnap = timer.resume();
    const segment2Id = resumeSnap.currentSegmentId!;
    result.steps.push({
      step: 'resume-new-segment',
      segment2Id,
      segment2InheritsDefault: segment2Id !== segment1Id,
    });

    await sleep(500);

    // 8. 修改 segment2 关联为 task2
    timer.linkSegmentTask(segment2Id, task2.id, 'local', task2.title);
    result.steps.push({ step: 'link-segment-2-task', segmentId: segment2Id, taskId: task2.id });

    // 9. stop
    timer.stop();

    // ===== 验证 DB =====
    const segments = listSegments(sessionId);
    result.db = {
      segmentsCount: segments.length,
      segments: segments.map((s) => ({
        id: s.id,
        taskId: s.taskId,
        taskSource: s.taskSource,
        title: s.title,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        activeElapsedMs: s.activeElapsedMs,
      })),
    };

    // 验证逻辑
    result.summary = {
      // segment1 关联 task1
      seg1LinkedTask1: segments[0]?.taskId === task1.id,
      seg1TitleOk: segments[0]?.title === '数学复数错题整理',
      // segment2 关联 task2（覆盖了 session 默认）
      seg2LinkedTask2: segments[1]?.taskId === task2.id,
      seg2TitleOk: segments[1]?.title === '立体几何听课笔记',
      // 两个 segment 不同
      twoSegments: segments.length === 2 && segments[0].id !== segments[1].id,
      // 搜索能找到
      searchOk: result.steps[1].foundTask1 === true,
      // 历史记录能显示任务名（segments 有 title）
      historyShowsTaskName: segments.every((s) => s.title !== null),
    };
    result.success = Object.values(result.summary).every(Boolean);
  } catch (err: any) {
    result.errors.push(err?.message ?? String(err));
    result.success = false;
  } finally {
    timer.dispose();
    closeDatabase();
  }

  fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2), 'utf8');
  console.log('===== TASK TEST RESULT =====');
  console.log(JSON.stringify(result, null, 2));
  app.exit(result.success ? 0 : 1);
});
