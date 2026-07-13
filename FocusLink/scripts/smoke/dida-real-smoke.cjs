// 发布前真实 dida CLI 验收；会创建并清理临时任务与专注记录。
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const root = path.resolve(__dirname, '..', '..');

const cliEntry =
  process.env.DIDA_CLI_ENTRY ||
  path.join(
    process.env.APPDATA || '',
    'npm',
    'node_modules',
    '@suibiji',
    'dida-cli',
    'dist',
    'index.js',
  );
const requestedProjectId = process.argv[2] || '';
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const commentMarker = `[FocusLink:segment:release-comment-${runId}]`;
const focusMarker = `[FocusLink:segment:release-focus-${runId}]`;
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const taskTitle = `FocusLink ${packageVersion} 临时验证 ${runId}`;

if (!fs.existsSync(cliEntry)) {
  throw new Error(`dida CLI entry not found: ${cliEntry}`);
}

function runDida(args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cliEntry, ...args],
      { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `dida ${args.slice(0, 3).join(' ')} failed: ${stderr.trim() || error.message}`,
            ),
          );
          return;
        }
        resolve(String(stdout || '').trim());
      },
    );
  });
}

function parseJson(stdout, label) {
  if (!stdout || stdout === 'undefined') {
    throw new Error(`${label} returned ${stdout || 'empty output'}`);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${label} returned invalid JSON: ${stdout.slice(0, 240)}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textOfComment(comment) {
  return String(comment?.title ?? comment?.content ?? '');
}

async function ensureComment(projectId, taskId, title) {
  const comments = parseJson(
    await runDida(['task', 'comment', 'list', projectId, taskId, '--json']),
    'comment list',
  );
  if (!Array.isArray(comments)) throw new Error('comment list did not return an array');
  if (comments.some((comment) => textOfComment(comment).includes(commentMarker))) {
    return 'skipped';
  }
  parseJson(
    await runDida(['task', 'comment', 'add', projectId, taskId, '--title', title, '--json']),
    'comment add',
  );
  return 'added';
}

async function findFocus(from, to) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const records = parseJson(
      await runDida(['focus', 'list', '--from', from, '--to', to, '--type', '1', '--json']),
      'focus list',
    );
    if (!Array.isArray(records)) throw new Error('focus list did not return an array');
    const match = records.find((record) => String(record?.note ?? '').includes(focusMarker));
    if (match) return match;
    await delay(500);
  }
  throw new Error('created focus record was not visible by marker');
}

async function main() {
  let projectId = requestedProjectId;
  let taskId = '';
  let focusId = '';
  let cleanupError = null;
  try {
    const projects = parseJson(await runDida(['project', 'list', '--json']), 'project list');
    if (!Array.isArray(projects) || projects.length === 0) {
      throw new Error('no dida project is available for the temporary smoke task');
    }
    if (!projectId) {
      projectId = projects.find((project) => project?.name === '待办清单')?.id || projects[0]?.id;
    }
    if (!projects.some((project) => project?.id === projectId)) {
      throw new Error('requested dida project does not exist');
    }

    const task = parseJson(
      await runDida(['task', 'create', '--title', taskTitle, '--project', projectId, '--json']),
      'task create',
    );
    taskId = String(task?.id ?? '');
    if (!taskId) throw new Error('task create returned no id');

    const commentText = `FocusLink 发布验证：中文参数与换行\n${commentMarker}`;
    const firstWrite = await ensureComment(projectId, taskId, commentText);
    const secondWrite = await ensureComment(projectId, taskId, commentText);
    const comments = parseJson(
      await runDida(['task', 'comment', 'list', projectId, taskId, '--json']),
      'comment verification',
    );
    const commentMarkerCount = comments.filter((comment) =>
      textOfComment(comment).includes(commentMarker),
    ).length;
    if (firstWrite !== 'added' || secondWrite !== 'skipped' || commentMarkerCount !== 1) {
      throw new Error(
        `comment idempotence failed: first=${firstWrite} second=${secondWrite} count=${commentMarkerCount}`,
      );
    }

    const startMs = Date.now() - 90_000;
    const endMs = startMs + 30_000;
    const focus = parseJson(
      await runDida([
        'focus',
        'create',
        '--type',
        '1',
        '--task-id',
        taskId,
        '--note',
        `FocusLink 发布验证\n${focusMarker}`,
        '--start-time',
        new Date(startMs).toISOString(),
        '--end-time',
        new Date(endMs).toISOString(),
        '--duration',
        '30',
        '--json',
      ]),
      'focus create',
    );
    focusId = String(focus?.id ?? '');
    if (!focusId) throw new Error('focus create returned no id');

    const fetchedFocus = parseJson(
      await runDida(['focus', 'get', focusId, '--type', '1', '--json']),
      'focus get',
    );
    const associatedTaskIds = [
      fetchedFocus?.taskId,
      ...(Array.isArray(fetchedFocus?.tasks) ? fetchedFocus.tasks.map((item) => item?.taskId) : []),
    ]
      .filter(Boolean)
      .map(String);
    if (!associatedTaskIds.includes(taskId)) {
      throw new Error(
        `focus task association mismatch: expected=${taskId} actual=${associatedTaskIds.join(',') || 'none'}`,
      );
    }

    const listedFocus = await findFocus(
      new Date(startMs - 60_000).toISOString(),
      new Date(endMs + 60_000).toISOString(),
    );
    const listedStart = Date.parse(String(listedFocus.startTime ?? listedFocus.start ?? ''));
    const listedEnd = Date.parse(String(listedFocus.endTime ?? listedFocus.end ?? ''));
    if (!Number.isFinite(listedStart) || !Number.isFinite(listedEnd)) {
      throw new Error('focus list did not return parseable startTime/endTime values');
    }
    if (listedEnd - listedStart !== 30000) {
      throw new Error(`focus interval mismatch: ${listedEnd - listedStart}ms`);
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          cliEntry,
          taskCreated: true,
          chineseCommentWritten: true,
          firstWrite,
          secondWrite,
          commentMarkerCount,
          focusCreated: true,
          focusTaskAssociationVerified: true,
          focusDurationSeconds: 30,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (focusId) {
      try {
        await runDida(['focus', 'delete', focusId, '--type', '1', '--json']);
      } catch (error) {
        cleanupError = error;
      }
    }
    if (taskId && projectId) {
      try {
        await runDida(['task', 'delete', projectId, taskId]);
      } catch (error) {
        cleanupError ||= error;
      }
    }
    if (cleanupError) throw cleanupError;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
