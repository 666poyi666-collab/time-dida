import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DIDA_OPEN_API_BASE = 'https://api.dida365.com/open/v1';

interface DidaCliConfigFile {
  access_token?: unknown;
}

export interface DidaOpenApiTask {
  id: string;
  projectId: string;
  title: string;
  status?: number;
  completedTime?: string | null;
  parentId?: string | null;
  focusSummaries?: unknown[];
  content?: string;
  desc?: string;
  isAllDay?: boolean;
  startDate?: string;
  dueDate?: string;
  timeZone?: string;
  reminders?: string[];
  repeatFlag?: string;
  priority?: number;
  sortOrder?: number;
  items?: unknown[];
  tags?: string[];
}

export interface DidaOpenApiBridgeOptions {
  configPath?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

function defaultConfigPath(): string {
  return path.join(os.homedir(), '.config', 'dida-cli', 'config.json');
}

async function readCliToken(configPath: string): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error('未找到 dida CLI 登录配置，请先运行 dida auth login。');
    }
    throw new Error(`读取 dida CLI 登录配置失败：${code ?? '未知文件错误'}`);
  }

  let config: DidaCliConfigFile;
  try {
    config = JSON.parse(raw) as DidaCliConfigFile;
  } catch {
    throw new Error('dida CLI 登录配置不是有效 JSON，请重新登录。');
  }
  const token = typeof config.access_token === 'string' ? config.access_token.trim() : '';
  if (!token) throw new Error('dida CLI 尚未登录，请先运行 dida auth login。');
  return token;
}

async function didaRequest(
  fetchImpl: typeof fetch,
  baseUrl: string,
  token: string,
  requestPath: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${requestPath}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`滴答 Open API 请求超时（${timeoutMs}ms）。`);
    }
    throw new Error(
      `滴答 Open API 网络错误：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (response.ok) return response;
  let detail = '';
  try {
    detail = (await response.text()).trim().slice(0, 300);
  } catch {
    // Some proxy/network responses do not expose a readable body.
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('dida CLI 登录已失效，请重新运行 dida auth login。');
  }
  if (response.status === 429) {
    throw new Error('滴答请求频率受限，请稍后再恢复任务。');
  }
  throw new Error(
    `滴答 Open API 请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`,
  );
}

async function readRemoteTask(
  fetchImpl: typeof fetch,
  baseUrl: string,
  token: string,
  projectId: string,
  taskId: string,
  timeoutMs: number,
): Promise<DidaOpenApiTask> {
  const response = await didaRequest(
    fetchImpl,
    baseUrl,
    token,
    `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`,
    {},
    timeoutMs,
  );
  let task: DidaOpenApiTask;
  try {
    task = (await response.json()) as DidaOpenApiTask;
  } catch {
    throw new Error('滴答任务详情返回了无效 JSON，无法安全恢复。');
  }
  if (!task || typeof task !== 'object' || !task.id || !task.projectId || !task.title) {
    throw new Error('滴答任务详情缺少 id、projectId 或 title，无法安全恢复。');
  }
  if (String(task.id) !== taskId || String(task.projectId) !== projectId) {
    throw new Error('滴答任务详情与请求的任务/清单不一致，已取消恢复。');
  }
  return task;
}

function buildReopenPayload(task: DidaOpenApiTask): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    status: 0,
    completedTime: null,
  };
  const optionalKeys: Array<keyof DidaOpenApiTask> = [
    'parentId',
    'content',
    'desc',
    'isAllDay',
    'startDate',
    'dueDate',
    'timeZone',
    'reminders',
    'repeatFlag',
    'priority',
    'sortOrder',
    'items',
    'tags',
  ];
  for (const key of optionalKeys) {
    if (task[key] !== undefined) payload[key] = task[key];
  }
  if (Array.isArray(task.focusSummaries)) {
    const writableFocusSummaries = task.focusSummaries
      .map((value) => {
        if (!value || typeof value !== 'object') return null;
        const summary = value as Record<string, unknown>;
        const writable: Record<string, unknown> = {};
        if (summary.estimatedPomo !== undefined) writable.estimatedPomo = summary.estimatedPomo;
        if (summary.estimatedDuration !== undefined) {
          writable.estimatedDuration = summary.estimatedDuration;
        }
        return Object.keys(writable).length > 0 ? writable : null;
      })
      .filter((value): value is Record<string, unknown> => value !== null);
    if (writableFocusSummaries.length > 0) payload.focusSummaries = writableFocusSummaries;
  }
  return payload;
}

/**
 * Restore a normal dida task by reusing the access token already owned by dida CLI.
 * The token is read only inside this module and is never logged or returned.
 */
export async function reopenDidaTaskViaOpenApi(
  projectId: string,
  taskId: string,
  options: DidaOpenApiBridgeOptions = {},
): Promise<DidaOpenApiTask> {
  const configPath = options.configPath ?? defaultConfigPath();
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DIDA_OPEN_API_BASE).replace(/\/$/, '');
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 15_000);
  const token = await readCliToken(configPath);
  const current = await readRemoteTask(fetchImpl, baseUrl, token, projectId, taskId, timeoutMs);

  await didaRequest(
    fetchImpl,
    baseUrl,
    token,
    `/task/${encodeURIComponent(taskId)}`,
    {
      method: 'POST',
      body: JSON.stringify(buildReopenPayload(current)),
    },
    timeoutMs,
  );

  const confirmed = await readRemoteTask(fetchImpl, baseUrl, token, projectId, taskId, timeoutMs);
  // Dida currently keeps completedTime as historical metadata after reopening.
  // Explicit status=0 is the authoritative active-state flag for normal tasks.
  if (Number(confirmed.status) !== 0) {
    throw new Error(
      `滴答接受了恢复请求，但云端任务仍为已完成状态（status=${String(
        confirmed.status ?? '未知',
      )}）。`,
    );
  }
  return confirmed;
}
