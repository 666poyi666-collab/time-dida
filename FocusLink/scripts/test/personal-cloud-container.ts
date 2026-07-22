import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { DEVICE_SYNC_PROTOCOL_VERSION } from '../../shared/sync/deviceProtocol';
import { LIVE_FOCUS_PROTOCOL_VERSION } from '../../shared/sync/liveFocusProtocol';
import {
  TASK_SNAPSHOT_PROTOCOL_VERSION,
  toTaskSnapshotPayload,
} from '../../shared/sync/taskSnapshotProtocol';

function readTestPort(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : fallback;
}

const cloudPort = readTestPort('FOCUSLINK_TEST_CLOUD_PORT', 18_787);
const webPort = readTestPort('FOCUSLINK_TEST_WEB_PORT', 18_080);
const cloudUrl = `http://127.0.0.1:${cloudPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
const token = randomBytes(32).toString('hex');
const project = `focuslink-test-${process.pid}-${Date.now()}`.toLowerCase();
const composeFiles = ['-f', 'cloud/docker-compose.yml', '-f', 'cloud/docker-compose.test.yml'];
const environment = {
  ...process.env,
  FOCUSLINK_CLOUD_ACCOUNTS: JSON.stringify([
    { accountId: 'container-validation', accessToken: token },
  ]),
  FOCUSLINK_CLOUD_ALLOWED_ORIGINS: 'https://validation.invalid',
  FOCUSLINK_TEST_CLOUD_PORT: String(cloudPort),
  FOCUSLINK_TEST_WEB_PORT: String(webPort),
};

function docker(...args: string[]): void {
  const result = spawnSync('docker', ['compose', '-p', project, ...composeFiles, ...args], {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(
      `docker compose ${args.join(' ')} failed\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitForHealth(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'not ready';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not become healthy: ${lastError}`);
}

async function api(path: string, method = 'GET', body?: unknown, accessToken = token) {
  return fetch(`${cloudUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

async function command(
  commandId: string,
  action: 'start' | 'pause' | 'resume' | 'finish',
  expectedRevision: number,
  sessionId: string,
  extra: Record<string, unknown> = {},
) {
  const response = await api('/v1/live/command', 'POST', {
    protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
    deviceId: 'container-phone',
    command: { commandId, action, expectedRevision, sessionId, ...extra },
  });
  assert(response.ok, `command ${commandId} returned HTTP ${response.status}`);
  return (await response.json()) as {
    ack: { status: string; revision: number };
    snapshot: { revision: number; state: string };
  };
}

async function runScenario(): Promise<void> {
  await waitForHealth(`${cloudUrl}/health`);
  await waitForHealth(`${webUrl}/healthz`);

  assert((await api('/v1/live', 'GET', undefined, 'wrong-token')).status === 401, 'bad token');
  const deniedOrigin = await fetch(`${cloudUrl}/v1/live`, {
    headers: { Authorization: `Bearer ${token}`, Origin: 'https://denied.invalid' },
  });
  assert(deniedOrigin.status === 403, 'CORS denial was not enforced');

  const snapshot = toTaskSnapshotPayload(
    [
      {
        id: 'project-first',
        source: 'ticktick',
        externalId: 'project-first',
        name: '第一张清单',
        color: null,
      },
    ],
    [
      {
        id: 'task-mobile',
        source: 'ticktick',
        externalId: 'task-mobile',
        projectId: 'project-first',
        title: '手机跨设备验收',
        status: 'pending',
        priority: 3,
        dueDate: null,
        tags: ['FocusLink'],
        content: null,
      },
    ],
    Date.now(),
  );
  const publish = await api('/v1/tasks', 'POST', {
    protocolVersion: TASK_SNAPSHOT_PROTOCOL_VERSION,
    deviceId: 'container-pc',
    snapshot,
  });
  assert(publish.ok, `task publish returned HTTP ${publish.status}`);
  const tasks = (await (await api('/v1/tasks')).json()) as {
    revision: number;
    snapshot: { tasks: Array<{ id: string }> } | null;
  };
  assert(tasks.revision === 1, 'task revision did not advance');
  assert(tasks.snapshot?.tasks[0]?.id === 'task-mobile', 'phone could not read PC tasks');

  const freeStartBody = {
    protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
    deviceId: 'container-phone',
    command: {
      commandId: 'free-start',
      action: 'start',
      expectedRevision: 0,
      sessionId: 'free-session',
      title: '自由专注',
    },
  };
  const freeStart = (await (await api('/v1/live/command', 'POST', freeStartBody)).json()) as {
    ack: { status: string };
  };
  assert(freeStart.ack.status === 'applied', 'free focus did not start');
  const duplicate = (await (await api('/v1/live/command', 'POST', freeStartBody)).json()) as {
    ack: { status: string };
  };
  assert(duplicate.ack.status === 'duplicate', 'command replay was not idempotent');

  assert(
    (await command('free-pause', 'pause', 1, 'free-session')).ack.status === 'applied',
    'pause',
  );
  assert(
    (await command('stale-pause', 'pause', 1, 'free-session')).ack.status === 'conflict',
    'stale command did not conflict',
  );
  assert(
    (await command('free-resume', 'resume', 2, 'free-session')).ack.status === 'applied',
    'resume',
  );
  assert(
    (await command('free-finish', 'finish', 3, 'free-session')).ack.status === 'applied',
    'finish',
  );

  const linked = await command('linked-start', 'start', 4, 'linked-session', {
    title: '手机跨设备验收',
    task: {
      taskId: 'task-mobile',
      taskSource: 'ticktick',
      taskTitle: '手机跨设备验收',
    },
  });
  assert(linked.ack.status === 'applied', 'linked focus did not start');
  assert(
    (await command('linked-finish', 'finish', 5, 'linked-session')).ack.status === 'applied',
    'linked focus did not finish',
  );

  const ledger = (await (
    await api('/v1/sync', 'POST', {
      protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
      deviceId: 'container-pc-restart',
      cursor: null,
      mutations: [],
      pullLimit: 500,
    })
  ).json()) as { changes: Array<{ entityId: string; payload: unknown }> };
  assert(ledger.changes.length === 2, 'PC did not receive exactly two completed sessions');
  assert(
    ledger.changes.some((change) => change.entityId === 'linked-session'),
    'linked session was absent from the ledger',
  );

  docker('restart', 'focuslink-cloud');
  await waitForHealth(`${cloudUrl}/health`);
  const persistedTasks = (await (await api('/v1/tasks')).json()) as { revision: number };
  const persistedLive = (await (await api('/v1/live')).json()) as {
    snapshot: { revision: number; state: string };
  };
  assert(persistedTasks.revision === 1, 'task snapshot was lost after restart');
  assert(
    persistedLive.snapshot.revision === 6 && persistedLive.snapshot.state === 'idle',
    'live state was lost after restart',
  );

  docker('stop', 'focuslink-cloud');
  let failedWhileOffline = false;
  try {
    await fetch(`${cloudUrl}/health`, { signal: AbortSignal.timeout(3_000) });
  } catch {
    failedWhileOffline = true;
  }
  assert(failedWhileOffline, 'offline cloud unexpectedly accepted a request');
  docker('start', 'focuslink-cloud');
  await waitForHealth(`${cloudUrl}/health`);
}

async function main(): Promise<void> {
  try {
    const buildOption = process.env.FOCUSLINK_TEST_SKIP_BUILD === '1' ? '--no-build' : '--build';
    docker('up', buildOption, '--detach', '--wait');
    await runScenario();
    process.stdout.write('FocusLink isolated personal-cloud integration passed.\n');
  } finally {
    try {
      docker('down', '--volumes', '--remove-orphans');
    } catch (error) {
      process.stderr.write(`Test environment cleanup failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
