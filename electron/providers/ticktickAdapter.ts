// TickTick / 滴答清单 适配器
// 架构：稳定官方任务同步 + 实验性 Focus 适配器 + 本地记录兜底
//
// 稳定通道：使用 TickTick Open API / Dida365 Open API
//   - OAuth 授权（PKCE loopback）
//   - 拉取项目/任务
//   - 在任务备注/描述中追加专注记录
//
// 实验性：ExperimentalTickTickFocusAdapter（默认关闭，单独文件）
//
// 注意：官方 API 主要提供 tasks:read / tasks:write scope，
//   Focus/Pomodoro 写入能力依赖非官方 V2/session API，不稳定，
//   不允许写死进核心逻辑，只能作为可选适配器。
import { shell } from 'electron';
import crypto from 'node:crypto';
import { credentials } from '../credentials.js';
import { upsertTaskCache, listTaskCache } from '../db/index.js';
import { logger } from '../logger.js';
import type {
  TaskProvider,
  Project,
  Task,
  TaskUpdateInput,
  FocusRecord,
  TaskCache,
  TaskSource,
} from '@shared/types';

const SERVICE = 'ticktick';

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

  private async apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const cred = credentials.get(SERVICE);
    if (!cred) throw new Error('未登录 TickTick');
    if (cred.expiresAt && cred.expiresAt < Date.now() + 60_000) {
      await this.refreshToken();
    }
    const token = credentials.get(SERVICE)?.accessToken;
    if (!token) throw new Error('access token 缺失');
    const res = await fetch(`${this.endpoints.apiBase}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
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
    const res = await fetch(this.endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
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
    const res = await fetch(this.endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
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
        rawJson: null,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      upsertTaskCache(cache);
    });
    return mapped;
  }

  async getTask(taskId: string): Promise<Task | null> {
    // TickTick 需要 projectId 才能查单任务，这里先从缓存找
    const cached = listTaskCache('ticktick').find(
      (t) => t.externalId === taskId || t.id === `ticktick:${taskId}`,
    );
    return cached
      ? {
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
        }
      : null;
  }

  async updateTask(taskId: string, input: Partial<TaskUpdateInput>): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    const res = await this.apiFetch(`/task/${task.projectId}/${task.externalId}`, {
      method: 'POST',
      body: JSON.stringify({
        title: input.title ?? task.title,
        content: input.content ?? task.content ?? '',
        ...(input.status ? { status: input.status } : {}),
      }),
    });
    if (!res.ok) throw new Error(`updateTask: ${res.status}`);
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
    await this.updateTask(task.externalId || task.id.replace(/^ticktick:/, ''), {
      status: 'completed',
    });
  }
}

// ============ 类型转换 ============
interface TickTickTask {
  id: string;
  projectId: string;
  title: string;
  content?: string;
  status?: number;
  priority?: number;
  dueDate?: string;
  tags?: string[];
}
interface TickTickTaskProjectData {
  tasks?: TickTickTask[];
}

function tickTickToTask(t: TickTickTask): Task {
  return {
    id: `ticktick:${t.id}`,
    source: 'ticktick',
    externalId: t.id,
    projectId: t.projectId,
    title: t.title,
    status: t.status === 2 ? 'completed' : 'incomplete',
    priority: t.priority ?? null,
    dueDate: t.dueDate ? Date.parse(t.dueDate) : null,
    tags: t.tags ?? [],
    content: t.content ?? null,
  };
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
