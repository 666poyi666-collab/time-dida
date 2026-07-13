// TickTick / 滴答清单 适配器
// 架构：稳定官方任务同步 + 本地记录兜底
//
// 稳定通道：使用 TickTick Open API / Dida365 Open API
//   - OAuth 授权（PKCE loopback）
//   - 拉取项目/任务
//   - 在任务备注/描述中追加专注记录
//
// 注意：官方 API 主要提供 tasks:read / tasks:write scope，
//   Focus/Pomodoro 写入能力依赖非官方 V2/session API，不稳定，
//   不允许写死进核心逻辑。
import { shell } from 'electron';
import crypto from 'node:crypto';
import { credentials } from '../../credentials.js';
import { upsertTaskCache, listTaskCache } from '../../db/index.js';
import { logger } from '../../logger.js';
import type {
  TaskProvider,
  Project,
  Task,
  TaskUpdateInput,
  FocusRecord,
  TaskCache,
  TaskSource,
  TaskWorkspaceRefreshOptions,
} from '@shared/types';

const SERVICE = 'ticktick';
export const TICKTICK_REQUEST_TIMEOUT_MS = 15_000;

export interface TickTickAdapterOptions {
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const ENDPOINTS = {
  ticktick: {
    authBase: 'https://ticktick.com/oauth/authorize',
    token: 'https://ticktick.com/oauth/token',
    apiBase: 'https://api.ticktick.com/open/v1',
  },
  dida365: {
    authBase: 'https://dida365.com/oauth/authorize',
    token: 'https://dida365.com/oauth/token',
    apiBase: 'https://api.dida365.com/open/v1',
  },
} as const;

export class TickTickAdapter implements TaskProvider {
  name = 'ticktick';
  private region: 'ticktick' | 'dida365' = 'dida365';
  private clientId = '';
  private clientSecret = '';
  private redirectUri = 'http://localhost:18321/callback';
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TickTickAdapterOptions = {}) {
    const configuredTimeout = options.requestTimeoutMs ?? TICKTICK_REQUEST_TIMEOUT_MS;
    this.requestTimeoutMs = Number.isFinite(configuredTimeout)
      ? Math.max(1, configuredTimeout)
      : TICKTICK_REQUEST_TIMEOUT_MS;
    this.fetchImpl =
      options.fetchImpl ??
      (((input, init) => globalThis.fetch(input, init)) satisfies typeof fetch);
  }

  get isAuthenticated(): boolean {
    return credentials.has(SERVICE);
  }

  configure(region: 'ticktick' | 'dida365', clientId: string, clientSecret: string): void {
    this.region = region;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  setRegion(region: 'ticktick' | 'dida365'): void {
    this.region = region;
  }

  private get endpoints() {
    return ENDPOINTS[this.region];
  }

  private async fetchWithTimeout(
    input: string | URL | Request,
    init: RequestInit,
    operation: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const callerSignal = init.signal;
    const forwardAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) forwardAbort();
    else callerSignal?.addEventListener('abort', forwardAbort, { once: true });

    const timeoutError = new Error(`${operation} 请求超时（${this.requestTimeoutMs}ms）`);
    let didTimeout = false;
    let timeout: ReturnType<typeof setTimeout>;
    const timeoutGuard = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        didTimeout = true;
        controller.abort(timeoutError);
        reject(timeoutError);
      }, this.requestTimeoutMs);
      timeout.unref?.();
    });

    try {
      return await Promise.race([
        this.fetchImpl(input, { ...init, signal: controller.signal }),
        timeoutGuard,
      ]);
    } catch (error) {
      // Native fetch may reject from the abort event before the timeout guard settles. Keep a
      // deterministic timeout error so the sync queue can record and retry it consistently.
      if (didTimeout) throw timeoutError;
      throw error;
    } finally {
      clearTimeout(timeout!);
      callerSignal?.removeEventListener('abort', forwardAbort);
    }
  }

  private async apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const cred = credentials.get(SERVICE);
    if (!cred) throw new Error('未登录 TickTick');
    if (cred.expiresAt && cred.expiresAt < Date.now() + 60_000) {
      await this.refreshToken();
    }
    const token = credentials.get(SERVICE)?.accessToken;
    if (!token) throw new Error('access token 缺失');
    const res = await this.fetchWithTimeout(
      `${this.endpoints.apiBase}${path}`,
      {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.headers || {}),
        },
      },
      'TickTick API',
    );
    if (res.status === 429) {
      throw new Error('TickTick API 限流，请稍后重试');
    }
    return res;
  }

  async auth(): Promise<void> {
    if (!this.clientId) throw new Error('请先在设置中填写 Client ID');
    const codeVerifier = base64Url(crypto.randomBytes(32));
    const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = crypto.randomBytes(8).toString('hex');
    const params = new URLSearchParams({
      client_id: this.clientId,
      scope: 'tasks:read tasks:write',
      response_type: 'code',
      redirect_uri: this.redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    const authUrl = `${this.endpoints.authBase}?${params.toString()}`;
    logger.info('ticktick', 'starting oauth', { region: this.region });

    // 先打开授权页面，再启动本地回调服务器接收 code
    await shell.openExternal(authUrl);
    const code = await waitForCallback(this.redirectUri, state);
    await this.exchangeCodeForToken(code, codeVerifier);
    logger.info('ticktick', 'oauth success');
  }

  private async exchangeCodeForToken(code: string, verifier: string): Promise<void> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: 'authorization_code',
      code_verifier: verifier,
      redirect_uri: this.redirectUri,
    });
    const res = await this.fetchWithTimeout(
      this.endpoints.token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
      'TickTick OAuth',
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`获取 token 失败: ${res.status} ${text}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };
    credentials.set(SERVICE, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    });
  }

  private async refreshToken(): Promise<void> {
    const cred = credentials.get(SERVICE);
    if (!cred?.refreshToken) throw new Error('refresh token 缺失，请重新登录');
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: cred.refreshToken,
    });
    const res = await this.fetchWithTimeout(
      this.endpoints.token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
      'TickTick OAuth',
    );
    if (!res.ok) {
      credentials.delete(SERVICE);
      throw new Error(`刷新 token 失败: ${res.status}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    credentials.set(SERVICE, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? cred.refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    });
  }

  async logout(): Promise<void> {
    credentials.delete(SERVICE);
    logger.info('ticktick', 'logged out');
  }

  async listProjects(): Promise<Project[]> {
    const res = await this.apiFetch('/project');
    if (!res.ok) throw new Error(`listProjects: ${res.status}`);
    const data = (await res.json()) as Array<{
      id: string;
      name: string;
      color?: string;
    }>;
    return data.map((p) => ({
      id: p.id,
      source: 'ticktick' as TaskSource,
      externalId: p.id,
      name: p.name,
      color: p.color ?? null,
    }));
  }

  async listTasks(projectId?: string): Promise<Task[]> {
    const path = projectId ? `/project/${projectId}/data` : '/project/all/completed';
    const res = await this.apiFetch(path);
    if (!res.ok) throw new Error(`listTasks: ${res.status}`);
    const json = (await res.json()) as { tasks: TickTickTask[] } | TickTickTaskProjectData[];
    let tasks: TickTickTask[] = [];
    if (Array.isArray(json)) {
      // /project/all/completed 返回数组项目结构
      tasks = json.flatMap((p) => p.tasks ?? []);
    } else {
      tasks = json.tasks ?? [];
    }
    const mapped = tasks.map(tickTickToTask);
    // 缓存
    const now = Date.now();
    mapped.forEach((t) => {
      const cache: TaskCache = {
        id: `ticktick:${t.externalId}`,
        source: 'ticktick',
        externalId: t.externalId,
        projectId: t.projectId,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        tags: JSON.stringify(t.tags),
        content: t.content,
        rawJson: JSON.stringify({
          completedAt: t.completedAt ?? null,
          createdAt: t.createdAt ?? null,
          updatedAt: t.updatedAt ?? null,
        }),
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      upsertTaskCache(cache);
    });
    return mapped;
  }

  /** 默认只读活动任务；完成历史按 UI 请求和时间窗口延迟加载。 */
  async listWorkspaceTasks(
    projectId?: string,
    knownProjects?: readonly Project[],
    options: TaskWorkspaceRefreshOptions = {},
  ): Promise<Task[]> {
    const active: Task[] = [];
    if (projectId) {
      active.push(...(await this.listTasks(projectId)));
    } else {
      const projects = knownProjects ?? (await this.listProjects());
      for (const project of projects) {
        active.push(...(await this.listTasks(project.externalId)));
      }
    }
    if (!options.includeCompleted) return active;

    const completedSince = Date.now() - normalizeHistoryDays(options.completedDays) * 86_400_000;
    const completed = (await this.listTasks()).filter(
      (task) =>
        (!projectId || task.projectId === projectId) &&
        task.isCompleted === true &&
        (task.completedAt ?? 0) >= completedSince,
    );
    const merged = new Map<string, Task>();
    // 活动记录先写且不允许历史端点覆盖，避免恢复任务被短暂旧值覆盖。
    for (const task of active) merged.set(task.externalId, task);
    for (const task of completed) {
      if (!merged.has(task.externalId)) merged.set(task.externalId, task);
    }
    return [...merged.values()];
  }

  async getTask(taskId: string): Promise<Task | null> {
    // TickTick 需要 projectId 才能查单任务，这里先从缓存找
    const cached = listTaskCache('ticktick').find(
      (t) => t.externalId === taskId || t.id === `ticktick:${taskId}`,
    );
    if (!cached) return null;
    const meta = parseTaskCacheMeta(cached.rawJson);
    return {
      id: cached.id,
      source: cached.source,
      externalId: cached.externalId,
      projectId: cached.projectId,
      title: cached.title,
      status: cached.status,
      priority: cached.priority,
      dueDate: cached.dueDate,
      tags: cached.tags ? JSON.parse(cached.tags) : [],
      content: cached.content,
      isCompleted: cached.status === 'completed',
      completedAt: cached.status === 'completed' ? meta.completedAt : null,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
  }

  async updateTask(taskId: string, input: Partial<TaskUpdateInput>): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    if (!task.projectId) throw new Error(`任务缺少清单 ID: ${taskId}`);
    const res = await this.apiFetch(`/task/${task.externalId}`, {
      method: 'POST',
      body: JSON.stringify({
        id: task.externalId,
        projectId: task.projectId,
        title: input.title ?? task.title,
        content: input.content ?? task.content ?? '',
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.completedTime !== undefined ? { completedTime: input.completedTime } : {}),
      }),
    });
    if (!res.ok) throw new Error(await formatApiError('更新任务', res));

    if (input.status !== undefined) {
      const expectedStatus = Number(input.status);
      const confirmed = await this.fetchRemoteTask(task.projectId, task.externalId);
      if (confirmed.status !== expectedStatus) {
        throw new Error(
          `滴答接受了状态更新请求，但云端状态仍为 ${confirmed.status ?? '未知'}（期望 ${expectedStatus}）。`,
        );
      }
      this.setCachedCompletion(task.externalId, expectedStatus === 2);
    }
    logger.info('ticktick', 'updated task', { taskId });
  }

  /** 稳定通道：在任务备注/描述中追加专注记录 */
  async appendFocusRecordToTask(taskId: string, record: FocusRecord): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    const block = formatFocusRecord(record);
    const newContent = (task.content ?? '') + (task.content ? '\n\n' : '') + block;
    await this.updateTask(taskId, { content: newContent });
    logger.info('ticktick', 'appended focus record to task note', { taskId });
  }

  async completeTask(task: Task): Promise<void> {
    await this.setTaskCompleted(task, true);
  }

  async setTaskCompleted(task: Task, completed: boolean): Promise<void> {
    const externalId = task.externalId || task.id.replace(/^ticktick:/, '');
    const projectId = task.projectId;
    if (!projectId) throw new Error('任务缺少清单 ID，请刷新任务列表后重试。');

    if (completed) {
      const res = await this.apiFetch(`/project/${projectId}/task/${externalId}/complete`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(await formatApiError('完成任务', res));
      const confirmed = await this.fetchRemoteTask(projectId, externalId);
      if (confirmed.status !== 2) {
        throw new Error(
          `滴答接受了完成请求，但云端状态仍为 ${confirmed.status ?? '未知'}（期望 2）。`,
        );
      }
      this.setCachedCompletion(externalId, true);
      return;
    }

    await this.updateTask(externalId, { status: 0, completedTime: null });
  }

  private async fetchRemoteTask(projectId: string, taskId: string): Promise<TickTickTask> {
    const res = await this.apiFetch(`/project/${projectId}/task/${taskId}`);
    if (!res.ok) throw new Error(await formatApiError('确认任务状态', res));
    return (await res.json()) as TickTickTask;
  }

  private setCachedCompletion(taskId: string, completed: boolean): void {
    const cached = listTaskCache('ticktick').find(
      (item) => item.externalId === taskId || item.id === `ticktick:${taskId}`,
    );
    if (!cached) return;
    const changedAt = Date.now();
    const meta = parseTaskCacheMeta(cached.rawJson);
    cached.status = completed ? 'completed' : 'incomplete';
    cached.rawJson = JSON.stringify({
      ...meta,
      completedAt: completed ? changedAt : null,
      updatedAt: changedAt,
    });
    cached.updatedAt = changedAt;
    upsertTaskCache(cached);
  }
}

// ============ 类型转换 ============
interface TickTickTask {
  id: string;
  projectId: string;
  title: string;
  content?: string;
  status?: number;
  completedTime?: string | null;
  createdTime?: string | null;
  modifiedTime?: string | null;
  priority?: number;
  dueDate?: string;
  tags?: string[];
}
interface TickTickTaskProjectData {
  tasks?: TickTickTask[];
}

function tickTickToTask(t: TickTickTask): Task {
  const isCompleted = t.status === 2;
  return {
    id: `ticktick:${t.id}`,
    source: 'ticktick',
    externalId: t.id,
    projectId: t.projectId,
    title: t.title,
    status: t.status === 2 ? 'completed' : 'incomplete',
    isCompleted,
    completedAt: isCompleted ? parseTimestamp(t.completedTime) : null,
    createdAt: parseTimestamp(t.createdTime),
    updatedAt: parseTimestamp(t.modifiedTime),
    priority: t.priority ?? null,
    dueDate: t.dueDate ? Date.parse(t.dueDate) : null,
    tags: t.tags ?? [],
    content: t.content ?? null,
  };
}

function parseTimestamp(value: unknown): number | null {
  if (value == null || value === '') return null;
  const timestamp = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeHistoryDays(value: number | undefined): number {
  if (!Number.isFinite(value)) return 30;
  return Math.min(3650, Math.max(1, Math.floor(value as number)));
}

function parseTaskCacheMeta(rawJson: string | null): {
  completedAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
} {
  if (!rawJson) return { completedAt: null, createdAt: null, updatedAt: null };
  try {
    const value = JSON.parse(rawJson) as Record<string, unknown>;
    return {
      completedAt: parseTimestamp(value.completedAt),
      createdAt: parseTimestamp(value.createdAt),
      updatedAt: parseTimestamp(value.updatedAt),
    };
  } catch {
    return { completedAt: null, createdAt: null, updatedAt: null };
  }
}

async function formatApiError(action: string, response: Response): Promise<string> {
  let detail = '';
  try {
    detail = (await response.text()).trim().slice(0, 300);
  } catch {
    // Response bodies can be unavailable after a network/proxy failure.
  }
  return `${action}失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`;
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function formatFocusRecord(r: FocusRecord): string {
  const start = new Date(r.startedAt);
  const end = r.endedAt ? new Date(r.endedAt) : new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
      d.getMinutes(),
    )}`;
  const min = (ms: number) => Math.round(ms / 60000);
  return `[FocusLink]
${fmt(start)} - ${fmt(end)}
专注时长：${min(r.activeElapsedMs)} 分钟
暂停时长：${min(r.pauseElapsedMs)} 分钟
总跨度：${min(r.wallElapsedMs)} 分钟
${r.taskTitle ? `任务：${r.taskTitle}` : ''}
${r.note ? `备注：${r.note}` : ''}`.trim();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// ============ 本地回调服务器 ============
import http from 'node:http';
function waitForCallback(redirectUri: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(redirectUri);
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${url.port}`);
      const code = reqUrl.searchParams.get('code');
      const state = reqUrl.searchParams.get('state');
      const error = reqUrl.searchParams.get('error');
      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>授权失败</h1><p>请关闭此窗口并重试。</p>');
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }
      if (code && state === expectedState) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>授权成功</h1><p>请返回 FocusLink 应用。</p>');
        server.close();
        resolve(code);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>状态不匹配</h1>');
      }
    });
    server.listen(Number(url.port), '127.0.0.1', () => {
      logger.info('ticktick', `callback server listening on ${url.port}`);
    });
    // 自动打开浏览器
    shell.openExternal(
      `${redirectUri.replace('/callback', '')}`.replace('localhost:18321', 'localhost:18321'),
    );
    // 超时
    setTimeout(
      () => {
        server.close();
        reject(new Error('OAuth 超时'));
      },
      5 * 60 * 1000,
    );
  });
}

export const ticktickAdapter = new TickTickAdapter();
