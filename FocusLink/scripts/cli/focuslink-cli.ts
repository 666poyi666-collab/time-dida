#!/usr/bin/env -S npx tsx

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  TASK_SNAPSHOT_MUTATION_PATH,
  TASK_SNAPSHOT_PATH,
  TASK_SNAPSHOT_CAPABILITY_HEADER,
  TASK_SNAPSHOT_SCHEDULING_CAPABILITY,
  parseTaskSnapshotMutationResponse,
  parseTaskSnapshotResponse,
  type SyncedTask,
  type TaskSnapshotMutation,
  type TaskSnapshotMutationResponse,
  type TaskSnapshotResponse,
} from '../../shared/sync/taskSnapshotProtocol';
import { normalizeTaskRecurrenceDefinition } from '../../shared/taskRecurrence';
import { buildFocusLinkTimeContext } from '../../shared/timeContext';
import type { TaskRecurrenceDefinition } from '../../shared/types';

const MAX_RESPONSE_BYTES = 1_100_000;

export interface FocusLinkCliEnvironment {
  FOCUSLINK_ENDPOINT?: string;
  FOCUSLINK_DEVICE_TOKEN?: string;
  FOCUSLINK_CLI_DEVICE_ID?: string;
  FOCUSLINK_TIME_ZONE?: string;
  FOCUSLINK_MCP_ACCESS_TOKEN?: string;
}

export interface FocusLinkCliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

type FetchLike = typeof fetch;
type FlagValue = string | true | string[];

class FocusLinkCliError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'FocusLinkCliError';
  }
}

class FocusLinkTaskClient {
  private readonly endpoint: URL;

  constructor(
    endpoint: string,
    private readonly deviceToken: string,
    private readonly deviceId: string,
    private readonly fetchImpl: FetchLike,
  ) {
    this.endpoint = validateEndpoint(endpoint);
  }

  async read(): Promise<TaskSnapshotResponse> {
    const response = await this.request(TASK_SNAPSHOT_PATH, 'GET');
    const parsed = parseTaskSnapshotResponse(await responseJson(response));
    if (!parsed) throw new FocusLinkCliError('task_authority_protocol_error');
    return parsed;
  }

  async mutate(
    mutation: TaskSnapshotMutation,
    operationId: string,
    expectedRevision: number,
  ): Promise<TaskSnapshotMutationResponse> {
    const response = await this.request(TASK_SNAPSHOT_MUTATION_PATH, 'POST', {
      protocolVersion: 1,
      operationId,
      expectedRevision,
      deviceId: this.deviceId,
      mutation,
    });
    const parsed = parseTaskSnapshotMutationResponse(await responseJson(response));
    if (!parsed) throw new FocusLinkCliError('task_authority_protocol_error');
    return parsed;
  }

  private async request(pathname: string, method: 'GET' | 'POST', body?: unknown) {
    const url = new URL(pathname, this.endpoint);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.deviceToken}`,
          [TASK_SNAPSHOT_CAPABILITY_HEADER]: TASK_SNAPSHOT_SCHEDULING_CAPABILITY,
          ...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new FocusLinkCliError('task_authority_unavailable');
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new FocusLinkCliError('task_authority_redirect_rejected');
    }
    if (!response.ok) {
      const code = await responseErrorCode(response);
      throw new FocusLinkCliError(code);
    }
    return response;
  }
}

export async function runFocusLinkCli(
  argv: readonly string[],
  environment: FocusLinkCliEnvironment,
  io: FocusLinkCliIo,
  fetchImpl: FetchLike = fetch,
): Promise<number> {
  try {
    const parsed = parseArguments(argv);
    if (parsed.positionals.length === 0 || parsed.flags.has('help')) {
      io.stdout(helpText());
      return 0;
    }
    const client = createClient(environment, fetchImpl);
    const [domain, action = 'list'] = parsed.positionals;
    if (domain === 'time') {
      const snapshot = await client.read();
      const timezone =
        stringFlag(parsed.flags, 'timezone') ?? environment.FOCUSLINK_TIME_ZONE ?? 'Asia/Shanghai';
      writeJson(io, {
        authority: 'focuslink-account-do',
        revision: snapshot.revision,
        ...buildFocusLinkTimeContext(snapshot.serverTime, timezone),
      });
      return 0;
    }
    if (domain === 'projects') {
      await runProjectCommand(client, action, parsed.flags, io);
      return 0;
    }
    if (domain === 'tasks') {
      await runTaskCommand(client, action, parsed.flags, io);
      return 0;
    }
    throw new FocusLinkCliError('unknown_command');
  } catch (error) {
    const code = error instanceof FocusLinkCliError ? error.code : 'focuslink_cli_failed';
    io.stderr(JSON.stringify({ ok: false, error: code }));
    return 1;
  }
}

async function runProjectCommand(
  client: FocusLinkTaskClient,
  action: string,
  flags: ReadonlyMap<string, FlagValue>,
  io: FocusLinkCliIo,
) {
  const snapshot = await client.read();
  const projects =
    snapshot.snapshot?.projects.filter((project) => project.source === 'local') ?? [];
  if (!projects.some((project) => project.id === 'local-inbox')) {
    projects.unshift({ id: 'local-inbox', source: 'local', name: '收件箱', color: '#16899f' });
  }
  if (action === 'list') {
    writeJson(io, { revision: snapshot.revision, projects });
    return;
  }
  if (action === 'get') {
    const projectId = requiredStringFlag(flags, 'project-id');
    const project = projects.find((candidate) => candidate.id === projectId) ?? null;
    const tasks = snapshot.snapshot?.tasks.filter((task) => task.projectId === projectId) ?? [];
    writeJson(io, {
      revision: snapshot.revision,
      project,
      taskCount: tasks.length,
      openTaskCount: tasks.filter((task) => !task.isCompleted).length,
    });
    return;
  }
  let mutation: TaskSnapshotMutation;
  if (action === 'create') {
    mutation = {
      kind: 'create_project',
      name: requiredStringFlag(flags, 'name'),
      ...optionalStringProperty(flags, 'color', 'color'),
    };
  } else if (action === 'update') {
    mutation = {
      kind: 'update_project',
      projectId: requiredStringFlag(flags, 'project-id'),
      ...optionalStringProperty(flags, 'name', 'name'),
      ...(flags.has('clear-color')
        ? { color: null }
        : optionalStringProperty(flags, 'color', 'color')),
    };
  } else if (action === 'delete') {
    mutation = { kind: 'delete_project', projectId: requiredStringFlag(flags, 'project-id') };
  } else {
    throw new FocusLinkCliError('unknown_project_command');
  }
  writeJson(io, confirmation(await writeMutation(client, mutation, snapshot.revision, flags)));
}

async function runTaskCommand(
  client: FocusLinkTaskClient,
  action: string,
  flags: ReadonlyMap<string, FlagValue>,
  io: FocusLinkCliIo,
) {
  const snapshot = await client.read();
  const tasks = snapshot.snapshot?.tasks.filter((task) => task.source === 'local') ?? [];
  if (action === 'list') {
    writeJson(io, {
      revision: snapshot.revision,
      tasks: filterTasks(tasks, flags).slice(0, integerFlag(flags, 'limit') ?? 100),
    });
    return;
  }
  if (action === 'get') {
    const taskId = requiredStringFlag(flags, 'task-id');
    writeJson(io, {
      revision: snapshot.revision,
      task: tasks.find((task) => task.id === taskId) ?? null,
      subtasks: tasks.filter((task) => task.parentId === taskId),
    });
    return;
  }
  const taskId = action === 'create' ? null : requiredStringFlag(flags, 'task-id');
  let mutation: TaskSnapshotMutation;
  if (action === 'create') {
    mutation = {
      kind: 'create_task',
      title: requiredStringFlag(flags, 'title'),
      ...optionalStringProperty(flags, 'task-id', 'taskId'),
      ...nullableStringProperty(flags, 'project-id', 'projectId', 'inbox'),
      ...nullableStringProperty(flags, 'parent-id', 'parentId', 'none'),
      ...taskMetadata(flags, false),
    };
  } else if (action === 'update') {
    mutation = {
      kind: 'update_task',
      taskId: taskId!,
      ...optionalStringProperty(flags, 'title', 'title'),
      ...nullableStringProperty(flags, 'project-id', 'projectId', 'inbox'),
      ...nullableStringProperty(flags, 'parent-id', 'parentId', 'none'),
      ...taskMetadata(flags, true),
    };
  } else if (action === 'move') {
    mutation = {
      kind: 'move_task',
      taskId: taskId!,
      projectId: nullableRequiredStringFlag(flags, 'project-id', 'inbox'),
    };
  } else if (action === 'complete' || action === 'restore') {
    mutation = {
      kind: 'set_task_completed',
      taskId: taskId!,
      completed: action === 'complete',
    };
  } else if (action === 'delete') {
    mutation = { kind: 'delete_task', taskId: taskId! };
  } else {
    throw new FocusLinkCliError('unknown_task_command');
  }
  writeJson(io, confirmation(await writeMutation(client, mutation, snapshot.revision, flags)));
}

function taskMetadata(flags: ReadonlyMap<string, FlagValue>, allowClear: boolean) {
  const metadata: Record<string, unknown> = {};
  const priority = integerFlag(flags, 'priority');
  if (priority !== null) metadata.priority = priority;
  else if (allowClear && flags.has('clear-priority')) metadata.priority = null;
  const startDate = dateFlag(flags, 'start');
  if (startDate !== undefined) metadata.startDate = startDate;
  else if (allowClear && flags.has('clear-start')) metadata.startDate = null;
  const dueDate = dateFlag(flags, 'due');
  if (dueDate !== undefined) metadata.dueDate = dueDate;
  else if (allowClear && flags.has('clear-due')) metadata.dueDate = null;
  const tags = listFlag(flags, 'tag');
  if (tags.length > 0 || flags.has('tags')) metadata.tags = tags;
  else if (allowClear && flags.has('clear-tags')) metadata.tags = [];
  if (flags.has('clear-recurrence')) metadata.recurrence = null;
  else if (flags.has('frequency')) metadata.recurrence = recurrenceFromFlags(flags);
  return metadata;
}

function recurrenceFromFlags(flags: ReadonlyMap<string, FlagValue>): TaskRecurrenceDefinition {
  const value = {
    timezone: stringFlag(flags, 'timezone') ?? 'Asia/Shanghai',
    frequency: requiredStringFlag(flags, 'frequency'),
    interval: integerFlag(flags, 'interval') ?? 1,
    byWeekday: integerListFlag(flags, 'weekdays'),
    byMonthDay: integerListFlag(flags, 'month-days'),
    endAt: dateFlag(flags, 'repeat-end') ?? null,
    count: integerFlag(flags, 'repeat-count'),
    rollover: stringFlag(flags, 'rollover') ?? 'from_schedule',
  };
  const recurrence = normalizeTaskRecurrenceDefinition(value);
  if (!recurrence) throw new FocusLinkCliError('invalid_recurrence');
  return recurrence;
}

function filterTasks(tasks: readonly SyncedTask[], flags: ReadonlyMap<string, FlagValue>) {
  const query = stringFlag(flags, 'query')?.toLocaleLowerCase();
  const projectId = stringFlag(flags, 'project-id');
  const priority = integerFlag(flags, 'priority');
  const dueFrom = dateFlag(flags, 'due-from');
  const dueTo = dateFlag(flags, 'due-to');
  const startFrom = dateFlag(flags, 'start-from');
  const startTo = dateFlag(flags, 'start-to');
  const tags = listFlag(flags, 'tag');
  return tasks.filter((task) => {
    if (!flags.has('include-completed') && task.isCompleted) return false;
    if (projectId && task.projectId !== (projectId === 'inbox' ? 'local-inbox' : projectId))
      return false;
    if (priority !== null && task.priority !== priority) return false;
    if (dueFrom !== undefined && (task.dueDate ?? -1) < dueFrom) return false;
    if (dueTo !== undefined && (task.dueDate ?? Infinity) >= dueTo) return false;
    if (startFrom !== undefined && (task.startDate ?? -1) < startFrom) return false;
    if (startTo !== undefined && (task.startDate ?? Infinity) >= startTo) return false;
    if (tags.some((tag) => !task.tags.includes(tag))) return false;
    return (
      !query ||
      task.title.toLocaleLowerCase().includes(query) ||
      task.tags.some((tag) => tag.toLocaleLowerCase().includes(query))
    );
  });
}

async function writeMutation(
  client: FocusLinkTaskClient,
  mutation: TaskSnapshotMutation,
  observedRevision: number,
  flags: ReadonlyMap<string, FlagValue>,
) {
  const expectedRevision = integerFlag(flags, 'expected-revision') ?? observedRevision;
  const operationId = stringFlag(flags, 'operation-id') ?? `cli:${crypto.randomUUID()}`;
  return client.mutate(mutation, operationId, expectedRevision);
}

function confirmation(response: TaskSnapshotMutationResponse) {
  return {
    authority: 'focuslink-account-do',
    operationId: response.operationId,
    status: response.status,
    revision: response.revision,
    result: response.result,
    confirmed: true,
  };
}

function createClient(environment: FocusLinkCliEnvironment, fetchImpl: FetchLike) {
  const endpoint = environment.FOCUSLINK_ENDPOINT;
  const token = environment.FOCUSLINK_DEVICE_TOKEN;
  if (!token) {
    if (environment.FOCUSLINK_MCP_ACCESS_TOKEN) {
      throw new FocusLinkCliError('device_credential_required_oauth_token_not_accepted');
    }
    throw new FocusLinkCliError('focuslink_device_token_missing');
  }
  if (!endpoint) throw new FocusLinkCliError('focuslink_endpoint_missing');
  const tokenMatch = /^fl2_[A-Za-z0-9-]{6,80}_([A-Za-z0-9-]{6,80})_[A-Za-z0-9_-]{32,160}$/.exec(
    token,
  );
  if (!tokenMatch) {
    throw new FocusLinkCliError('focuslink_device_token_invalid');
  }
  const boundDeviceId = `device-${tokenMatch[1]}`;
  const deviceId = environment.FOCUSLINK_CLI_DEVICE_ID ?? boundDeviceId;
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(deviceId)) {
    throw new FocusLinkCliError('focuslink_cli_device_id_invalid');
  }
  if (deviceId !== boundDeviceId) {
    throw new FocusLinkCliError('focuslink_cli_device_identity_mismatch');
  }
  return new FocusLinkTaskClient(endpoint, token, deviceId, fetchImpl);
}

function validateEndpoint(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FocusLinkCliError('focuslink_endpoint_invalid');
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new FocusLinkCliError('focuslink_endpoint_invalid');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

async function responseJson(response: Response): Promise<unknown> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES)
    throw new FocusLinkCliError('task_authority_response_too_large');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new FocusLinkCliError('task_authority_protocol_error');
  }
}

async function responseErrorCode(response: Response): Promise<string> {
  try {
    const value = await responseJson(response);
    if (
      isRecord(value) &&
      typeof value.error === 'string' &&
      /^[a-z0-9_:-]{1,100}$/.test(value.error)
    ) {
      return value.error;
    }
  } catch {
    // Fall through to a status-only error; response bodies are never echoed.
  }
  if (response.status === 401) return 'device_credential_rejected';
  if (response.status === 403) return 'device_scope_denied';
  if (response.status === 409) return 'task_revision_conflict';
  return response.status >= 500 ? 'task_authority_unavailable' : 'task_mutation_rejected';
}

function parseArguments(argv: readonly string[]) {
  const positionals: string[] = [];
  const flags = new Map<string, FlagValue>();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const [rawName, inline] = value.slice(2).split('=', 2);
    const next = inline ?? (argv[index + 1]?.startsWith('--') ? undefined : argv[index + 1]);
    const flagValue: string | true = next === undefined ? true : next;
    if (inline === undefined && next !== undefined) index += 1;
    const previous = flags.get(rawName!);
    flags.set(
      rawName!,
      previous === undefined
        ? flagValue
        : Array.isArray(previous)
          ? [...previous, String(flagValue)]
          : [String(previous), String(flagValue)],
    );
  }
  return { positionals, flags };
}

function stringFlag(flags: ReadonlyMap<string, FlagValue>, name: string): string | undefined {
  const value = flags.get(name);
  if (value === undefined || value === true) return undefined;
  return Array.isArray(value) ? value.at(-1) : value;
}

function requiredStringFlag(flags: ReadonlyMap<string, FlagValue>, name: string): string {
  const value = stringFlag(flags, name)?.trim();
  if (!value) throw new FocusLinkCliError(`missing_${name.replaceAll('-', '_')}`);
  return value;
}

function integerFlag(flags: ReadonlyMap<string, FlagValue>, name: string): number | null {
  const raw = stringFlag(flags, name);
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FocusLinkCliError(`invalid_${name.replaceAll('-', '_')}`);
  }
  return value;
}

function dateFlag(flags: ReadonlyMap<string, FlagValue>, name: string): number | undefined {
  const raw = stringFlag(flags, name);
  if (raw === undefined) return undefined;
  const numeric = Number(raw);
  const value = Number.isFinite(numeric) ? numeric : Date.parse(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new FocusLinkCliError(`invalid_${name.replaceAll('-', '_')}`);
  }
  return value;
}

function listFlag(flags: ReadonlyMap<string, FlagValue>, name: string): string[] {
  const raw = flags.get(name);
  if (raw === undefined || raw === true) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return [
    ...new Set(
      values
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function integerListFlag(flags: ReadonlyMap<string, FlagValue>, name: string): number[] {
  return listFlag(flags, name)
    .map(Number)
    .sort((left, right) => left - right);
}

function optionalStringProperty(
  flags: ReadonlyMap<string, FlagValue>,
  flag: string,
  property: string,
) {
  const value = stringFlag(flags, flag);
  return value === undefined ? {} : { [property]: value };
}

function nullableStringProperty(
  flags: ReadonlyMap<string, FlagValue>,
  flag: string,
  property: string,
  nullValue: string,
) {
  const value = stringFlag(flags, flag);
  return value === undefined ? {} : { [property]: value === nullValue ? null : value };
}

function nullableRequiredStringFlag(
  flags: ReadonlyMap<string, FlagValue>,
  name: string,
  nullValue: string,
) {
  const value = requiredStringFlag(flags, name);
  return value === nullValue ? null : value;
}

function writeJson(io: FocusLinkCliIo, value: unknown) {
  io.stdout(JSON.stringify(value, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function helpText() {
  return `FocusLink CLI

环境：FOCUSLINK_ENDPOINT、FOCUSLINK_DEVICE_TOKEN；deviceId 从 fl2 凭据绑定段验证派生。
      ChatGPT Web 使用 OAuth MCP，OAuth access token 不用于本机 CLI。

命令：
  time [--timezone Asia/Shanghai]
  projects list|get|create|update|delete
  tasks list|get|create|update|move|complete|restore|delete

任务字段：--title --project-id --parent-id --priority 0..5 --start <ISO|ms> --due <ISO|ms>
          --tag <name> --frequency daily|weekly|monthly|yearly --interval N
          --weekdays 1,3,5 --month-days 1,15 --repeat-end <ISO|ms> --repeat-count N
          --rollover from_schedule|from_completion
写入控制：--operation-id <stable-id> --expected-revision <revision>`;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  void runFocusLinkCli(process.argv.slice(2), process.env, {
    stdout: (value) => process.stdout.write(`${value}\n`),
    stderr: (value) => process.stderr.write(`${value}\n`),
  }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

export const focusLinkCliModulePath = fileURLToPath(import.meta.url);
