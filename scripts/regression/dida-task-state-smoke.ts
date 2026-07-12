/**
 * Release-only real dida state smoke.
 * Creates one temporary task, completes it through dida CLI, restores it through
 * FocusLink's CLI-token Open API bridge, verifies both remote states, then deletes it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { reopenDidaTaskViaOpenApi } from '../../electron/integrations/ticktick/didaOpenApiBridge';

interface RemoteTask {
  id?: string;
  projectId?: string;
  title?: string;
  status?: number;
  completedTime?: string | null;
}

interface RemoteProject {
  id?: string;
  name?: string;
}

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
const requestedProjectId = process.argv[2]?.trim() || '';
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const taskTitle = `FocusLink ${process.env.npm_package_version ?? 'dev'} 任务状态临时验证 ${runId}`;

function runDida(args: string[], timeout = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cliEntry, ...args],
      { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
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
        resolve(output);
      },
    );
  });
}

function parseJson<T>(output: string, label: string): T {
  if (!output || output === 'undefined') {
    throw new Error(`${label} returned ${output || 'empty output'}`);
  }
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON: ${output.slice(0, 220)}`);
  }
}

async function readTask(projectId: string, taskId: string): Promise<RemoteTask> {
  return parseJson<RemoteTask>(
    await runDida(['task', 'get', projectId, taskId, '--json']),
    'task get',
  );
}

async function main(): Promise<void> {
  if (!fs.existsSync(cliEntry)) throw new Error(`dida CLI entry not found: ${cliEntry}`);

  let projectId = requestedProjectId;
  let taskId = '';
  let cleanupError: unknown = null;
  let verificationPassed = false;
  try {
    const projects = parseJson<RemoteProject[]>(
      await runDida(['project', 'list', '--json']),
      'project list',
    );
    if (!Array.isArray(projects) || projects.length === 0) {
      throw new Error('no dida project is available for the temporary state task');
    }
    if (!projectId) {
      projectId =
        projects.find((project) => project.name === '待办清单')?.id || projects[0]?.id || '';
    }
    if (!projectId || !projects.some((project) => project.id === projectId)) {
      throw new Error('requested dida project does not exist');
    }

    const created = parseJson<RemoteTask>(
      await runDida(['task', 'create', '--title', taskTitle, '--project', projectId, '--json']),
      'task create',
    );
    taskId = String(created.id || '');
    if (!taskId) throw new Error('task create returned no id');

    await runDida(['task', 'complete', projectId, taskId]);
    const completed = await readTask(projectId, taskId);
    if (Number(completed.status) !== 2 || !completed.completedTime) {
      throw new Error(
        `remote complete verification failed: status=${String(completed.status)} completedTime=${String(completed.completedTime)}`,
      );
    }

    const reopened = await reopenDidaTaskViaOpenApi(projectId, taskId);
    const confirmed = await readTask(projectId, taskId);
    if (Number(reopened.status) !== 0 || Number(confirmed.status) !== 0) {
      throw new Error(
        `remote reopen verification failed: bridge=${String(reopened.status)} readback=${String(confirmed.status)}`,
      );
    }

    verificationPassed = true;
  } finally {
    if (taskId && projectId) {
      try {
        await runDida(['task', 'delete', projectId, taskId]);
      } catch (error) {
        cleanupError = error;
      }
    }
    if (cleanupError) throw cleanupError;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: verificationPassed,
        taskCreated: true,
        completedAndVerified: true,
        reopenedAndVerified: true,
        cleanupSucceeded: true,
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
