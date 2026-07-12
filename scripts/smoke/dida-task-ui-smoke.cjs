// Real dida task UI smoke for a packaged FocusLink build.
//
// Usage:
//   node scripts/smoke/dida-task-ui-smoke.cjs <FocusLink.exe> [screenshot-directory]
//
// This test uses an isolated Electron userData directory, creates exactly one
// uniquely named dida task, and only mutates/deletes that task by its returned id.
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..', '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageVersion = String(packageJson.version || '').trim();
const executableArgument = process.argv[2] || process.env.FOCUSLINK_EXE || '';
const executable = executableArgument ? path.resolve(executableArgument) : '';
const outputDir = path.resolve(
  process.argv[3] ||
    path.join(os.tmpdir(), `focuslink-dida-task-ui-${packageVersion || 'unknown'}-${Date.now()}`),
);
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
const requestedProjectId = process.env.FOCUSLINK_DIDA_SMOKE_PROJECT_ID?.trim() || '';
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const taskTitle = `FocusLink ${packageVersion} UI 临时验证 ${runId}`;

let app = null;
let appExit = null;
let socket = null;
let userDataDir = '';
let commandId = 0;
let projectId = '';
let taskId = '';
let taskCreated = false;
const pending = new Map();
const appOutput = { stdout: '', stderr: '' };

class OutdatedPackagedUiError extends Error {
  constructor(details) {
    super(`PACKAGED_UI_OUTDATED: ${details}。请先重建 packaged FocusLink.exe，再运行本脚本。`);
    this.name = 'OutdatedPackagedUiError';
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rememberOutput(channel, chunk) {
  const limit = 64 * 1024;
  appOutput[channel] = `${appOutput[channel]}${String(chunk || '')}`.slice(-limit);
}

function runDida(args, timeout = 30_000) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    return Promise.reject(new TypeError('dida arguments must be a string array'));
  }
  return new Promise((resolve, reject) => {
    // Keep every dida call on execFile + argv. Never interpolate task text or ids
    // into a shell command string.
    execFile(
      process.execPath,
      [cliEntry, ...args],
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = String(stdout || '').trim();
        if (error) {
          reject(
            new Error(
              `dida ${args.slice(0, 3).join(' ')} failed: ${String(stderr || '').trim() || error.message}`,
            ),
          );
          return;
        }
        if (output === 'undefined') {
          reject(new Error(`dida ${args.slice(0, 3).join(' ')} returned undefined`));
          return;
        }
        resolve(output);
      },
    );
  });
}

function parseJson(output, label) {
  if (!output || output === 'undefined') {
    throw new Error(`${label} returned ${output || 'empty output'}`);
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} returned invalid JSON: ${output.slice(0, 260)}`);
  }
}

async function readTask(expectedProjectId, expectedTaskId) {
  const task = parseJson(
    await runDida(['task', 'get', expectedProjectId, expectedTaskId, '--json']),
    'task get',
  );
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new Error('task get did not return a task object');
  }
  return task;
}

async function waitForRemoteStatus(expectedStatus, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastTask = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      lastTask = await readTask(projectId, taskId);
      if (Number(lastTask.status) === expectedStatus) return lastTask;
    } catch (error) {
      lastError = error;
    }
    await delay(350);
  }
  throw new Error(
    `task get did not reach status=${expectedStatus}; lastStatus=${String(lastTask?.status)}${lastError ? `; lastError=${lastError.message}` : ''}`,
  );
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('failed to reserve a CDP port'));
        else resolve(port);
      });
    });
  });
}

async function waitForPage(port) {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (app?.exitCode != null) {
      throw new Error(
        `FocusLink exited before CDP was ready (code ${app.exitCode}): ${appOutput.stderr.trim()}`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
      const targets = await response.json();
      const page = targets.find(
        (target) => target.type === 'page' && !String(target.url || '').includes('mini.html'),
      );
      if (page?.webSocketDebuggerUrl) return page;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(
    `timed out waiting for the FocusLink renderer: ${lastError?.message || 'no CDP target'}`,
  );
}

function send(method, params = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(`cannot send ${method}: CDP socket is not open`));
  }
  const id = ++commandId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }), (error) => {
      if (!error) return;
      pending.delete(id);
      reject(error);
    });
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description;
    throw new Error(description || response.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return response.result?.value;
}

async function waitForUi(label, expression, accept = Boolean, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      lastValue = await evaluate(expression);
      if (accept(lastValue)) return lastValue;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  let diagnostics = null;
  try {
    diagnostics = await evaluate(`(() => ({
      activeNav: [...document.querySelectorAll('.global-nav-button')]
        .find((button) => button.classList.contains('active'))?.textContent?.trim() || null,
      busy: document.querySelector('.task-workbench-list')?.getAttribute('aria-busy') || null,
      bodyText: document.body.innerText.slice(0, 500)
    }))()`);
  } catch {
    // Keep the original timeout as the useful failure.
  }
  throw new Error(
    `timed out waiting for ${label}; lastValue=${JSON.stringify(lastValue)}${lastError ? `; lastError=${lastError.message}` : ''}; diagnostics=${JSON.stringify(diagnostics)}`,
  );
}

async function capture(name) {
  await send('Page.bringToFront');
  await delay(180);
  const response = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const png = Buffer.from(response.data || '', 'base64');
  if (png.length < 8 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`CDP returned an invalid PNG for ${name}`);
  }
  const file = path.join(outputDir, `${name}.png`);
  fs.writeFileSync(file, png);
  return file;
}

async function waitForWorkbenchIdle() {
  await waitForUi(
    'task workbench to finish loading',
    `(() => {
      const list = document.querySelector('.task-workbench-list');
      return Boolean(list) && list.getAttribute('aria-busy') === 'false';
    })()`,
    Boolean,
    90_000,
  );
  const loadError = await evaluate(
    `document.querySelector('.task-empty-state.danger')?.innerText?.trim() || ''`,
  );
  if (loadError) throw new Error(`FocusLink could not load dida tasks: ${loadError}`);
}

async function clickRefresh() {
  const clicked = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="刷新滴答清单"]');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('refresh dida task button was not available');
  await delay(180);
  await waitForWorkbenchIdle();
}

async function setSearch(value) {
  const changed = await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="搜索任务"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return false;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error('task search input was not available');
}

function openTaskRowExpression(title) {
  return `(() => {
    const title = ${JSON.stringify(title)};
    return [...document.querySelectorAll('.task-workbench-row')].find((row) =>
      row.querySelector('.task-row-title-line strong')?.textContent?.trim() === title
    ) || null;
  })()`;
}

async function waitForOpenTask() {
  return waitForUi(
    'temporary task in the active task list',
    `(() => {
      const row = ${openTaskRowExpression(taskTitle)};
      if (!row) return null;
      return {
        title: row.querySelector('.task-row-title-line strong')?.textContent?.trim() || '',
        checked: row.querySelector('[role="checkbox"]')?.getAttribute('aria-checked') || null
      };
    })()`,
    (value) => value?.title === taskTitle && value.checked === 'false',
    20_000,
  );
}

async function clickOpenTaskCheckbox() {
  const clicked = await evaluate(`(() => {
    const row = ${openTaskRowExpression(taskTitle)};
    const checkbox = row?.querySelector('[role="checkbox"]');
    if (!checkbox || checkbox.disabled) return false;
    checkbox.click();
    return true;
  })()`);
  if (!clicked) throw new Error('temporary active task checkbox was not clickable');
}

async function waitForUndoBar() {
  return waitForUi(
    'six-second completion undo bar',
    `(() => {
      const bar = document.querySelector('.task-undo-bar[role="status"]');
      if (!bar) return null;
      return {
        title: bar.querySelector('strong')?.textContent?.trim() || '',
        action: [...bar.querySelectorAll('button')]
          .find((button) => button.textContent?.trim() === '撤销')?.textContent?.trim() || ''
      };
    })()`,
    (value) => value?.title === taskTitle && value.action === '撤销',
    20_000,
  );
}

async function clickUndo() {
  const clicked = await evaluate(`(() => {
    const bar = document.querySelector('.task-undo-bar[role="status"]');
    if (bar?.querySelector('strong')?.textContent?.trim() !== ${JSON.stringify(taskTitle)}) {
      return false;
    }
    const button = [...bar.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === '撤销');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('completion undo action was not clickable');
}

async function waitForUndoBarToExpire(firstObservedAt) {
  await waitForUi(
    'completion undo bar to expire',
    `!document.querySelector('.task-undo-bar[role="status"]')`,
    Boolean,
    9_000,
  );
  const lifetimeMs = Date.now() - firstObservedAt;
  // AnimatePresence keeps the node around for its short exit transition, so use
  // a narrow tolerance around the intended six-second availability window.
  if (lifetimeMs < 5_500 || lifetimeMs > 7_500) {
    throw new Error(`undo bar lifetime was ${lifetimeMs}ms; expected approximately 6000ms`);
  }
  return lifetimeMs;
}

async function clickTaskFilter(label) {
  const clicked = await evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const button = [...document.querySelectorAll('.task-view-list button')]
      .find((candidate) => candidate.textContent?.includes(label));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`task filter ${label} was not available`);
  await delay(180);
  await waitForWorkbenchIdle();
}

async function waitForCompletedTaskAtTop() {
  await waitForUi(
    'temporary task in the completed list',
    `(() => [...document.querySelectorAll('.task-completed-row')].some((row) =>
      row.querySelector('.task-row-title-line strong')?.textContent?.trim() === ${JSON.stringify(taskTitle)}
    ))()`,
    Boolean,
    90_000,
  );
  const inspection = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('.task-completed-row')];
      const titles = rows.map((row) =>
        row.querySelector('.task-row-title-line strong')?.textContent?.trim() || ''
      );
      const row = rows.find((candidate) =>
        candidate.querySelector('.task-row-title-line strong')?.textContent?.trim() === ${JSON.stringify(taskTitle)}
      );
      return {
        index: row ? rows.indexOf(row) : -1,
        firstTitle: titles[0] || null,
        group: row?.parentElement?.querySelector('.task-completed-group')?.textContent?.trim() || null,
        firstGroup: document.querySelector('.task-completed-group')?.textContent?.trim() || null,
        sort: document.querySelector('select[aria-label="任务排序"]')?.value || null,
        range: document.querySelector('select[aria-label="已完成任务日期范围"]')?.value || null
      };
    })()`);
  const valid =
    inspection?.index === 0 &&
    inspection.firstTitle === taskTitle &&
    inspection.group === '今天' &&
    inspection.firstGroup === '今天' &&
    inspection.sort === 'completed';
  if (!valid) {
    throw new Error(
      `completed ordering assertion failed: ${JSON.stringify(inspection)}; the temporary task must be the first recent item under 今天`,
    );
  }
  return inspection;
}

async function clickCompletedRestore() {
  const clicked = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.task-completed-row')].find((candidate) =>
      candidate.querySelector('.task-row-title-line strong')?.textContent?.trim() === ${JSON.stringify(taskTitle)}
    );
    const button = row?.querySelector('.task-restore-action');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('completed task restore action was not clickable');
}

async function createTemporaryTask() {
  const projects = parseJson(await runDida(['project', 'list', '--json']), 'project list');
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error('no dida project is available for the temporary UI task');
  }
  projectId = requestedProjectId;
  if (!projectId) {
    projectId =
      String(projects.find((project) => project?.name === '待办清单')?.id || '') ||
      String(projects[0]?.id || '');
  }
  if (!projectId || !projects.some((project) => String(project?.id || '') === projectId)) {
    throw new Error('requested dida smoke project does not exist');
  }

  const created = parseJson(
    await runDida(['task', 'create', '--title', taskTitle, '--project', projectId, '--json']),
    'task create',
  );
  taskId = String(created?.id || '');
  if (!taskId) throw new Error('task create returned no id');
  taskCreated = true;

  const confirmed = await waitForRemoteStatus(0);
  if (String(confirmed.id || '') !== taskId || String(confirmed.title || '') !== taskTitle) {
    throw new Error('task get did not return the exact temporary task created by this run');
  }
}

async function verifyLatestTaskUi() {
  const inspection = await evaluate(`(() => {
    const sort = document.querySelector('select[aria-label="任务排序"]');
    const openSortLabels = sort ? [...sort.options].map((option) => option.textContent?.trim()) : [];
    return {
      shell: Boolean(document.querySelector('.task-workspace-shell')),
      workbench: Boolean(document.querySelector('.task-workbench-list')),
      search: Boolean(document.querySelector('input[aria-label="搜索任务"]')),
      refresh: Boolean(document.querySelector('button[aria-label="刷新滴答清单"]')),
      sort: Boolean(sort),
      openSortLabels,
      exposedSourceSelector: Boolean(document.querySelector('.task-source-rail, .picker-source-button'))
    };
  })()`);
  const expectedSortLabels = ['滴答顺序', '截止日期', '任务名称'];
  const latest =
    inspection.shell &&
    inspection.workbench &&
    inspection.search &&
    inspection.refresh &&
    inspection.sort &&
    !inspection.exposedSourceSelector &&
    expectedSortLabels.every((label) => inspection.openSortLabels.includes(label));
  if (!latest) throw new OutdatedPackagedUiError(JSON.stringify(inspection));
  return inspection;
}

async function openPackagedApp() {
  const port = await findFreePort();
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-dida-task-ui-userdata-'));
  app = spawn(
    executable,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--hidden'],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  app.stdout?.on('data', (chunk) => rememberOutput('stdout', chunk));
  app.stderr?.on('data', (chunk) => rememberOutput('stderr', chunk));
  appExit = new Promise((resolve) => app.once('exit', (code, signal) => resolve({ code, signal })));

  const page = await waitForPage(port);
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  socket.on('close', () => {
    for (const request of pending.values()) request.reject(new Error('CDP socket closed'));
    pending.clear();
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await evaluate(`(async () => {
    await window.focuslink.settings.set({ theme: 'light', taskSource: 'ticktick-cli' });
    window.focuslink.window.show();
    return true;
  })()`);
  await send('Page.bringToFront');
  await delay(300);

  const navigated = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="任务"]') ||
      [...document.querySelectorAll('.global-nav-button')]
        .find((candidate) => candidate.textContent?.trim() === '任务');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!navigated) throw new Error('task navigation button was not found');
  await waitForUi(
    'task workspace',
    `Boolean(document.querySelector('.task-workspace-shell'))`,
    Boolean,
    20_000,
  );
}

async function runSmoke() {
  if (!executable) {
    throw new Error(
      'Usage: node scripts/smoke/dida-task-ui-smoke.cjs <FocusLink.exe> [screenshot-directory]',
    );
  }
  if (!fs.existsSync(executable)) throw new Error(`FocusLink executable not found: ${executable}`);
  if (!fs.existsSync(cliEntry)) throw new Error(`dida CLI entry not found: ${cliEntry}`);
  if (!packageVersion) throw new Error('package.json does not contain a version');
  fs.mkdirSync(outputDir, { recursive: true });

  process.stderr.write('[dida-task-ui] starting isolated packaged app\n');
  await openPackagedApp();
  const uiInspection = await verifyLatestTaskUi();
  await waitForWorkbenchIdle();

  process.stderr.write('[dida-task-ui] creating one temporary dida task\n');
  await createTemporaryTask();
  await clickTaskFilter('待完成');
  await clickRefresh();
  await setSearch(taskTitle);
  await waitForOpenTask();

  const screenshots = {};
  screenshots.active = await capture('00-active-task');

  process.stderr.write('[dida-task-ui] completing and undoing through the UI\n');
  await clickOpenTaskCheckbox();
  await waitForUndoBar();
  await waitForRemoteStatus(2);
  screenshots.undoAvailable = await capture('01-completed-undo-available');
  await clickUndo();
  await waitForRemoteStatus(0);
  await waitForOpenTask();
  screenshots.undone = await capture('02-undone-active');

  process.stderr.write('[dida-task-ui] completing again and measuring the undo window\n');
  await clickOpenTaskCheckbox();
  await waitForUndoBar();
  const undoFirstObservedAt = Date.now();
  await waitForRemoteStatus(2);
  screenshots.completedAgain = await capture('03-completed-again');
  const undoLifetimeMs = await waitForUndoBarToExpire(undoFirstObservedAt);

  process.stderr.write('[dida-task-ui] checking recent/today ordering and restoring\n');
  // Clear the unique-title search before entering completed tasks so index=0
  // proves global recent ordering, rather than merely ordering one filtered row.
  await setSearch('');
  await delay(100);
  await clickTaskFilter('已完成');
  const completedInspection = await waitForCompletedTaskAtTop();
  screenshots.completedToday = await capture('04-completed-today');
  await clickCompletedRestore();
  await waitForRemoteStatus(0);
  await clickTaskFilter('待完成');
  await setSearch(taskTitle);
  await waitForOpenTask();
  screenshots.restored = await capture('05-restored-active');

  return {
    ok: true,
    packageVersion,
    executable,
    cliEntry,
    outputDir,
    temporaryTask: { id: taskId, projectId, title: taskTitle },
    uiInspection,
    undo: {
      clickedAndVerifiedStatus0: true,
      measuredLifetimeMs: undoLifetimeMs,
      expectedLifetimeMs: 6000,
    },
    secondCompletionVerifiedStatus2: true,
    completedInspection,
    completedRestoreVerifiedStatus0: true,
    screenshots,
  };
}

async function closePackagedApp() {
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`(() => {
        window.setTimeout(() => window.focuslink.window.quit(), 0);
        return true;
      })()`);
    } catch {
      // Fall through to the process-level stop below.
    }
    socket.close();
  }
  if (app && app.exitCode == null) {
    await Promise.race([appExit, delay(2_500)]);
  }
  if (app && app.exitCode == null) {
    app.kill();
    await Promise.race([appExit, delay(1_500)]);
  }
}

async function deleteTemporaryTask() {
  if (!taskCreated || !taskId || !projectId) return;
  const task = await readTask(projectId, taskId);
  if (String(task.id || '') !== taskId || String(task.title || '') !== taskTitle) {
    throw new Error('refusing cleanup: the returned task no longer matches this smoke run');
  }
  await runDida(['task', 'delete', projectId, taskId]);
  taskCreated = false;
}

function removeIsolatedUserData() {
  if (!userDataDir) return;
  const resolved = path.resolve(userDataDir);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase();
  if (!resolved.toLowerCase().startsWith(tempRoot)) {
    throw new Error(`refusing to remove userData outside the temp directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function main() {
  let result = null;
  let primaryError = null;
  const cleanupErrors = [];
  try {
    result = await runSmoke();
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await closePackagedApp();
    } catch (error) {
      cleanupErrors.push(new Error(`app cleanup failed: ${error.message}`));
    }
    try {
      await deleteTemporaryTask();
    } catch (error) {
      cleanupErrors.push(new Error(`temporary dida task cleanup failed: ${error.message}`));
    }
    try {
      removeIsolatedUserData();
    } catch (error) {
      cleanupErrors.push(new Error(`userData cleanup failed: ${error.message}`));
    }
  }

  if (primaryError) {
    if (cleanupErrors.length > 0) {
      primaryError.message = `${primaryError.message}; ${cleanupErrors.map((error) => error.message).join('; ')}`;
    }
    throw primaryError;
  }
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'smoke cleanup failed');

  result.temporaryTaskDeleted = true;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  if (appOutput.stderr.trim()) {
    process.stderr.write(`[packaged stderr]\n${appOutput.stderr.trim()}\n`);
  }
  process.exitCode = 1;
});
