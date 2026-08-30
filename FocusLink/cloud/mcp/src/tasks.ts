import { BoundedBodyError, readBoundedBody } from './bounded-body';
import { focuslinkUpstreamUrl } from './upstream';
import {
  parseTaskSnapshotMutationResponse,
  parseTaskSnapshotResponse,
  type SyncedTask,
  type SyncedTaskProject,
  type TaskSnapshotMutationRequest,
  type TaskSnapshotMutationResponse,
  type TaskSnapshotResponse,
} from '../../../shared/sync/taskSnapshotProtocol';
import { buildFocusLinkTimeContext } from '../../../shared/timeContext';

const MAX_RESPONSE_BYTES = 1_100_000;
const SERVICE_TOKEN = /^[A-Za-z0-9._~-]{32,4096}$/;
const MCP_DEVICE_ID = 'mcp-service';
const FOCUSLINK_INBOX_PROJECT: SyncedTaskProject = {
  id: 'local-inbox',
  source: 'local',
  name: '收件箱',
  color: '#16899f',
};

export interface TaskMcpEnv {
  FOCUSLINK_UPSTREAM: Fetcher;
  FOCUSLINK_MCP_SERVICE_TOKEN: string;
}

export class TaskAuthorityError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null = null,
  ) {
    super(code);
    this.name = 'TaskAuthorityError';
  }
}

export interface ListTaskInput {
  projectId?: string | null;
  includeCompleted: boolean;
  query?: string;
  priority?: number | null;
  startFrom?: number;
  startTo?: number;
  dueFrom?: number;
  dueTo?: number;
  tags?: string[];
  parentId?: string | null;
  limit: number;
}

export async function getFocusLinkCurrentTime(env: TaskMcpEnv, timezone: string) {
  const snapshot = await fetchFocusLinkTaskSnapshot(env);
  return {
    authority: 'focuslink-account-do' as const,
    revision: snapshot.revision,
    ...buildFocusLinkTimeContext(snapshot.serverTime, timezone),
  };
}

export async function fetchFocusLinkTaskSnapshot(env: TaskMcpEnv): Promise<TaskSnapshotResponse> {
  const response = await callAuthority(env, 'GET');
  return parseSnapshotResponse(response);
}

export async function mutateFocusLinkTasks(
  env: TaskMcpEnv,
  input: TaskSnapshotMutationRequest,
): Promise<TaskSnapshotMutationResponse> {
  const response = await callAuthority(env, 'POST', input);
  const parsed = await parseJsonResponse(response, MAX_RESPONSE_BYTES);
  const mutation = parseTaskSnapshotMutationResponse(parsed);
  if (!mutation) throw new TaskAuthorityError('task_authority_protocol_error', response.status);
  return mutation;
}

export async function listFocusLinkProjects(env: TaskMcpEnv): Promise<{
  revision: number;
  projects: SyncedTaskProject[];
  authority: 'focuslink-account-do';
}> {
  const snapshot = await fetchFocusLinkTaskSnapshot(env);
  const projects = (snapshot.snapshot?.projects ?? [])
    .filter((project) => project.source === 'local')
    .map((project) => ({ ...project }));
  // A brand-new account intentionally has revision=0/snapshot=null.  Expose the stable inbox
  // even before the first task write so MCP callers can create a task without guessing a list.
  if (!projects.some((project) => project.id === FOCUSLINK_INBOX_PROJECT.id)) {
    projects.unshift({ ...FOCUSLINK_INBOX_PROJECT });
  }
  return {
    authority: 'focuslink-account-do',
    revision: snapshot.revision,
    projects,
  };
}

export async function getFocusLinkProject(env: TaskMcpEnv, projectId: string) {
  const snapshot = await fetchFocusLinkTaskSnapshot(env);
  const projects = snapshot.snapshot?.projects ?? [];
  const project =
    projects.find((candidate) => candidate.source === 'local' && candidate.id === projectId) ??
    (projectId === FOCUSLINK_INBOX_PROJECT.id ? { ...FOCUSLINK_INBOX_PROJECT } : null);
  const tasks = (snapshot.snapshot?.tasks ?? []).filter(
    (task) => task.source === 'local' && task.projectId === projectId,
  );
  return {
    authority: 'focuslink-account-do' as const,
    revision: snapshot.revision,
    project,
    taskCount: tasks.length,
    openTaskCount: tasks.filter((task) => !task.isCompleted).length,
  };
}

export async function listFocusLinkTasks(
  env: TaskMcpEnv,
  input: ListTaskInput,
): Promise<{
  revision: number;
  tasks: SyncedTask[];
  authority: 'focuslink-account-do';
}> {
  const snapshot = await fetchFocusLinkTaskSnapshot(env);
  const all = snapshot.snapshot?.tasks ?? [];
  const query = input.query?.trim().toLocaleLowerCase() ?? '';
  const tasks = all
    .filter((task) => task.source === 'local')
    .filter(
      (task) =>
        input.projectId === undefined ||
        (input.projectId === null
          ? task.projectId === null || task.projectId === 'local-inbox'
          : task.projectId === input.projectId),
    )
    .filter((task) => input.includeCompleted || !task.isCompleted)
    .filter((task) => input.priority === undefined || task.priority === input.priority)
    .filter((task) => input.startFrom === undefined || (task.startDate ?? -1) >= input.startFrom)
    .filter((task) => input.startTo === undefined || (task.startDate ?? Infinity) < input.startTo)
    .filter((task) => input.dueFrom === undefined || (task.dueDate ?? -1) >= input.dueFrom)
    .filter((task) => input.dueTo === undefined || (task.dueDate ?? Infinity) < input.dueTo)
    .filter(
      (task) =>
        input.parentId === undefined ||
        (input.parentId === null ? task.parentId === null : task.parentId === input.parentId),
    )
    .filter(
      (task) =>
        !input.tags?.length || input.tags.every((tag) => task.tags.some((value) => value === tag)),
    )
    .filter(
      (task) =>
        !query ||
        task.title.toLocaleLowerCase().includes(query) ||
        task.tags.some((tag) => tag.toLocaleLowerCase().includes(query)),
    )
    .slice(0, input.limit);
  return { authority: 'focuslink-account-do', revision: snapshot.revision, tasks };
}

export async function getFocusLinkTask(
  env: TaskMcpEnv,
  taskId: string,
): Promise<{
  revision: number;
  task: SyncedTask | null;
  subtasks: SyncedTask[];
  authority: 'focuslink-account-do';
}> {
  const snapshot = await fetchFocusLinkTaskSnapshot(env);
  const task = (snapshot.snapshot?.tasks ?? []).find(
    (candidate) => candidate.source === 'local' && candidate.id === taskId,
  );
  const subtasks = task
    ? (snapshot.snapshot?.tasks ?? []).filter(
        (candidate) => candidate.source === 'local' && candidate.parentId === task.id,
      )
    : [];
  return {
    authority: 'focuslink-account-do',
    revision: snapshot.revision,
    task: task ?? null,
    subtasks,
  };
}

export function redactMutationConfirmation(
  response: TaskSnapshotMutationResponse,
): Record<string, unknown> {
  return {
    authority: 'focuslink-account-do',
    operationId: response.operationId,
    status: response.status,
    revision: response.revision,
    result: response.result,
    confirmed: true,
  };
}

export function makeTaskMutationRequest(
  operationId: string,
  expectedRevision: number,
  mutation: TaskSnapshotMutationRequest['mutation'],
): TaskSnapshotMutationRequest {
  return {
    protocolVersion: 1,
    operationId,
    expectedRevision,
    deviceId: MCP_DEVICE_ID,
    mutation,
  };
}

async function callAuthority(
  env: TaskMcpEnv,
  method: 'GET' | 'POST',
  body?: TaskSnapshotMutationRequest,
): Promise<Response> {
  if (!SERVICE_TOKEN.test(env.FOCUSLINK_MCP_SERVICE_TOKEN ?? '')) {
    throw new TaskAuthorityError('focuslink_mcp_service_not_configured');
  }
  if (!env.FOCUSLINK_UPSTREAM) throw new TaskAuthorityError('focuslink_authority_binding_missing');
  let response: Response;
  try {
    response = await env.FOCUSLINK_UPSTREAM.fetch(
      new Request(focuslinkUpstreamUrl('/internal/mcp/v1/tasks'), {
        method,
        headers: {
          accept: 'application/json',
          ...(method === 'POST' ? { 'content-type': 'application/json; charset=utf-8' } : {}),
          'x-focuslink-mcp-service': env.FOCUSLINK_MCP_SERVICE_TOKEN,
        },
        body: method === 'POST' ? JSON.stringify(body) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      }),
    );
  } catch {
    throw new TaskAuthorityError('focuslink_authority_unavailable');
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new TaskAuthorityError('focuslink_authority_redirect_rejected', response.status);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new TaskAuthorityError(taskAuthorityErrorCode(response.status), response.status);
  }
  return response;
}

async function parseSnapshotResponse(response: Response): Promise<TaskSnapshotResponse> {
  const parsed = await parseJsonResponse(response, MAX_RESPONSE_BYTES);
  const snapshot = parseTaskSnapshotResponse(parsed);
  if (!snapshot) throw new TaskAuthorityError('task_authority_protocol_error', response.status);
  return snapshot;
}

async function parseJsonResponse(response: Response, byteLimit: number): Promise<unknown> {
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(response.body, response.headers, byteLimit);
  } catch (error) {
    if (error instanceof BoundedBodyError && error.reason === 'too_large') {
      throw new TaskAuthorityError('task_authority_response_too_large', response.status);
    }
    throw new TaskAuthorityError('task_authority_unavailable', response.status);
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new TaskAuthorityError('task_authority_protocol_error', response.status);
  }
}

function taskAuthorityErrorCode(status: number): string {
  if (status === 401) return 'task_authority_service_rejected';
  if (status === 400) return 'task_mutation_request_invalid';
  if (status === 403) return 'task_mutation_forbidden';
  if (status === 404) return 'task_authority_route_missing';
  if (status === 405) return 'task_authority_method_not_allowed';
  if (status === 409) return 'task_revision_conflict';
  if (status === 422) return 'task_mutation_invalid';
  if (status >= 400 && status < 500) return `task_mutation_rejected_http_${status}`;
  return 'focuslink_authority_unavailable';
}
