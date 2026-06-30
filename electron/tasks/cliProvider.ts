// 本地滴答清单 CLI Provider
// 自动探测命令；用户可配置命令模板；超时控制；JSON 解析失败显示原始输出
// 安全：不在日志中泄露 token；命令执行有 timeout；CLI 不存在时不崩溃
//
// 诊断模式：
//   每次执行命令记录完整信息（exitCode/stdout/stderr/parseResult/error）。
//   diagnose() 一次性返回所有诊断字段供 UI 展示。
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  Task,
  Project,
  TaskProvider,
  TaskUpdateInput,
  FocusRecord,
  TickTickCliConfig,
  AppSettings,
  TaskCache,
} from '@shared/types';
import { getSettings, saveSettings } from '../settingsStore.js';
import { logger } from '../logger.js';
import { listTaskCache, upsertTaskCache } from '../db/index.js';

const execAsync = promisify(exec);

/** dida CLI 默认命令模板 - 探测到 dida 后自动应用 */
export const DIDA_DEFAULT_TEMPLATES: TickTickCliConfig = {
  executable: '',
  listTasksCommand: 'dida task filter --json',
  searchTasksCommand: 'dida task filter --json',
  getTaskCommand: 'dida task get {{projectId}} {{taskId}} --json',
  appendNoteCommand: 'dida task update {{taskId}} --content "{{content}}"',
  listProjectsCommand: 'dida project list --json',
  timeoutMs: 10000,
};

/** ticktick CLI 默认命令模板 - 仅当探测到 ticktick 命令时使用 */
export const TICKTICK_DEFAULT_TEMPLATES: TickTickCliConfig = {
  executable: '',
  listTasksCommand: 'ticktick tasks list --json',
  searchTasksCommand: 'ticktick tasks search "{{query}}" --json',
  getTaskCommand: 'ticktick tasks get {{taskId}} --json',
  appendNoteCommand: 'ticktick tasks note append "{{taskId}}" "{{content}}"',
  listProjectsCommand: 'ticktick projects list --json',
  timeoutMs: 10000,
};

/** 检测当前模板是否仍包含 ticktick 字面量（即旧版本残留） */
export function templatesContainTicktick(cfg: TickTickCliConfig): boolean {
  return (
    cfg.listTasksCommand.includes('ticktick') ||
    cfg.searchTasksCommand.includes('ticktick') ||
    cfg.listProjectsCommand.includes('ticktick') ||
    cfg.getTaskCommand.includes('ticktick') ||
    cfg.appendNoteCommand.includes('ticktick')
  );
}

/** 应用 dida 默认模板到设置并持久化 */
export function applyDidaDefaults(): AppSettings {
  const current = getSettings();
  const next: AppSettings = {
    ...current,
    ticktickCli: {
      ...DIDA_DEFAULT_TEMPLATES,
      // 保留用户已配置的 executable 和 timeoutMs
      executable: current.ticktickCli.executable,
      timeoutMs: current.ticktickCli.timeoutMs,
    },
  };
  const saved = saveSettings(next);
  logger.info('cli', 'applied dida default templates', saved.ticktickCli);
  return saved;
}

/** Windows 候选命令名，依次 where 探测 */
const CANDIDATE_CMDS = ['dida', 'ticktick', 'ticktick-cli', 'todo'];

/** 单步命令执行结果（用于诊断） */
export interface CliExecRecord {
  command: string;
  cwd: string;
  timeoutMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** success | failed | timeout | not-found | parse-failed */
  status: 'success' | 'failed' | 'timeout' | 'not-found' | 'parse-failed';
  /** 解析结果：success/failed/na */
  parseResult: 'success' | 'failed' | 'na';
  error?: string;
}

/** 单个测试步骤的诊断结果 */
export interface CliDiagnoseStep {
  name: string;
  ok: boolean;
  /** 简短摘要（UI 显示） */
  summary: string;
  /** 完整记录（诊断面板可展开） */
  record?: CliExecRecord;
}

/** 完整诊断报告 */
export interface CliDiagnoseResult {
  provider: 'dida';
  executable: string;
  executablePath: string;
  cwd: string;
  version: string;
  loggedIn: boolean | null;
  loginStatusText: string;
  steps: CliDiagnoseStep[];
  lastError: string | null;
  /** 最近一次原始 stdout（截断 2000 字符） */
  lastStdout: string;
  /** 最近一次原始 stderr（截断 2000 字符） */
  lastStderr: string;
  /** 当前生效的命令模板 */
  templates: TickTickCliConfig;
}

export interface CliDetectResult {
  found: boolean;
  executable: string;
  executablePath: string;
  candidates: { cmd: string; found: boolean };
  helpOutput?: string;
}

/** 最近一次执行记录（供 UI 显示） */
let lastRecord: CliExecRecord | null = null;

function truncate(s: string, n = 2000): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + `...(截断，共 ${s.length} 字符)` : s;
}

function maskSecret(s: string): string {
  return s.replace(/token=[^&\s"]+/gi, 'token=***');
}

/** 自动探测本地可用的滴答清单 CLI 命令；探测到 dida 时自动迁移旧 ticktick 模板 */
export async function detectCli(): Promise<CliDetectResult> {
  const isWin = process.platform === 'win32';
  const whereCmd = isWin ? 'where' : 'which';
  for (const cmd of CANDIDATE_CMDS) {
    try {
      const { stdout: whereOut } = await execAsync(`${whereCmd} ${cmd}`, {
        timeout: 3000,
        windowsHide: true,
      });
      const executablePath = whereOut.split(/\r?\n/)[0]?.trim() ?? '';
      // 探测成功，尝试 --help 解析能力
      let helpOutput: string | undefined;
      try {
        const { stdout } = await execAsync(`${cmd} --help`, {
          timeout: 5000,
          windowsHide: true,
        });
        helpOutput = stdout.slice(0, 800);
      } catch {
        // --help 失败不影响探测
      }
      logger.info('cli', `detected CLI: ${cmd} at ${executablePath}`);

      // 探测到 dida 后，若当前模板仍含 ticktick 字面量（旧版本残留），自动迁移为 dida 模板
      if (cmd === 'dida') {
        const cur = getSettings();
        if (templatesContainTicktick(cur.ticktickCli)) {
          logger.info('cli', 'auto-migrating ticktick templates -> dida templates');
          applyDidaDefaults();
        }
      }

      return {
        found: true,
        executable: cmd,
        executablePath,
        candidates: { cmd, found: true },
        helpOutput,
      };
    } catch {
      // 继续探测下一个
    }
  }
  logger.info('cli', 'no TickTick CLI detected');
  return {
    found: false,
    executable: '',
    executablePath: '',
    candidates: { cmd: '', found: false },
  };
}

/** 获取当前生效的 CLI 配置（用户配置优先，否则用探测结果） */
function getConfig(): TickTickCliConfig {
  const settings = getSettings();
  return settings.ticktickCli;
}

/** 渲染命令模板：替换 {{projectId}} {{query}} {{taskId}} {{content}} 占位符 */
function renderTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    // 简单转义双引号内容（避免破坏 shell 引号）
    const safe = v.replace(/"/g, '\\"');
    out = out.replace(new RegExp(`{{${k}}}`, 'g'), safe);
  }
  return out;
}

/**
 * 执行命令并返回完整诊断记录
 * - 命令不存在：status='not-found'
 * - 命令超时：status='timeout'
 * - 退出码非 0：status='failed'
 * - 成功：status='success'
 */
async function execWithDiagnose(
  command: string,
  timeoutMs: number,
  parseResult: 'success' | 'failed' | 'na' = 'na',
): Promise<{ stdout: string; stderr: string; record: CliExecRecord }> {
  const cwd = process.cwd();
  const masked = maskSecret(command);
  logger.info('cli', 'exec', { command: masked, cwd, timeoutMs });

  const startTs = Date.now();
  const record: CliExecRecord = {
    command: masked,
    cwd,
    timeoutMs,
    exitCode: null,
    stdout: '',
    stderr: '',
    durationMs: 0,
    status: 'success',
    parseResult,
  };

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 4,
      windowsHide: true,
    });
    record.stdout = stdout;
    record.stderr = stderr;
    record.exitCode = 0;
    record.durationMs = Date.now() - startTs;
    record.parseResult = parseResult;
    lastRecord = record;
    logger.info('cli', 'exec done', {
      exitCode: 0,
      durationMs: record.durationMs,
      stdoutLen: stdout.length,
      stderrLen: stderr.length,
    });
    return { stdout, stderr, record };
  } catch (err: unknown) {
    record.durationMs = Date.now() - startTs;
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
      signal?: string;
      killed?: boolean;
    };
    record.stdout = e.stdout ?? '';
    record.stderr = e.stderr ?? '';
    record.exitCode = typeof e.code === 'number' ? e.code : null;
    // 判断错误类型
    if (e.killed || e.signal === 'SIGTERM') {
      record.status = 'timeout';
      record.error = `命令超时（${timeoutMs}ms）`;
    } else if (e.code === 'ENOENT' || /not found|is not recognized/i.test(e.message ?? '')) {
      record.status = 'not-found';
      record.error = `命令不存在：${e.message}`;
    } else if (typeof e.code === 'number' && e.code !== 0) {
      record.status = 'failed';
      record.error = `退出码 ${e.code}：${e.message}`;
    } else {
      record.status = 'failed';
      record.error = e.message ?? String(err);
    }
    lastRecord = record;
    logger.error('cli', 'exec failed', {
      status: record.status,
      exitCode: record.exitCode,
      error: record.error,
      stdoutLen: record.stdout.length,
      stderrLen: record.stderr.length,
    });
    return { stdout: record.stdout, stderr: record.stderr, record };
  }
}

/** 兼容旧调用（保留 runCommand 接口） */
async function runCommand(command: string, timeoutMs: number): Promise<string> {
  const { stdout, record } = await execWithDiagnose(command, timeoutMs, 'na');
  if (record.status !== 'success' && record.status !== 'parse-failed') {
    // 命令本身失败（timeout/not-found/failed）抛出
    throw new Error(record.error ?? `命令执行失败：${command}`);
  }
  return stdout;
}

/** 尝试解析 JSON，失败时返回原始输出片段供 UI 展示 */
function parseJson<T>(
  raw: string,
  record?: CliExecRecord,
): { ok: true; data: T } | { ok: false; raw: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, raw: '(空输出)' };
  try {
    const data = JSON.parse(trimmed) as T;
    if (record) record.parseResult = 'success';
    return { ok: true, data };
  } catch {
    if (record) {
      record.parseResult = 'failed';
      if (record.status === 'success') record.status = 'parse-failed';
    }
    return { ok: false, raw: trimmed.slice(0, 300) };
  }
}

/** 执行任意命令并返回完整诊断（供设置页测试按钮调用） */
export async function testCommand(command: string, timeoutMs: number): Promise<CliExecRecord> {
  const { record } = await execWithDiagnose(command, timeoutMs);
  return record;
}

/** 完整诊断：探测 / 版本 / 登录 / 项目 / 任务 / 搜索 */
export async function diagnoseCli(): Promise<CliDiagnoseResult> {
  const cfg = getConfig();
  const steps: CliDiagnoseStep[] = [];
  let lastError: string | null = null;
  let lastStdout = '';
  let lastStderr = '';

  // 1. 探测
  const detect = await detectCli();
  const executable = cfg.executable?.trim() || detect.executable || 'dida';
  const executablePath = cfg.executable?.trim() || detect.executablePath || '';
  steps.push({
    name: '探测 CLI',
    ok: detect.found || !!cfg.executable,
    summary: detect.found
      ? `探测到：${detect.executable} (${detect.executablePath || '路径未知'})`
      : cfg.executable
        ? `使用手动配置：${cfg.executable}`
        : '未探测到任何 CLI',
  });

  // 2. 版本
  let version = '';
  try {
    const r = await execWithDiagnose(`${executable} --version`, 5000, 'na');
    version = r.stdout.trim();
    steps.push({
      name: '版本检测',
      ok: r.record.status === 'success',
      summary: version || r.record.error || '无输出',
      record: r.record,
    });
    lastStdout = r.stdout;
    lastStderr = r.stderr;
    if (r.record.status !== 'success') lastError = r.record.error ?? null;
  } catch (e) {
    steps.push({ name: '版本检测', ok: false, summary: (e as Error).message });
    lastError = (e as Error).message;
  }

  // 3. 登录状态
  let loggedIn: boolean | null = null;
  let loginStatusText = '';
  try {
    const r = await execWithDiagnose(`${executable} auth status`, 5000, 'na');
    loginStatusText = (r.stdout + r.stderr).trim();
    loggedIn = /已登录|logged in|authenticated/i.test(loginStatusText);
    steps.push({
      name: '登录状态',
      ok: r.record.status === 'success',
      summary: loggedIn ? '已登录' : loginStatusText || r.record.error || '未知',
      record: r.record,
    });
    lastStdout = r.stdout;
    lastStderr = r.stderr;
    if (r.record.status !== 'success') lastError = r.record.error ?? null;
  } catch (e) {
    steps.push({ name: '登录状态', ok: false, summary: (e as Error).message });
    lastError = (e as Error).message;
  }

  // 4. 项目列表
  try {
    const cmd = renderTemplate(cfg.listProjectsCommand, {});
    const r = await execWithDiagnose(cmd, cfg.timeoutMs, 'na');
    const parsed = parseJson<Project[]>(r.stdout, r.record);
    const count = parsed.ok ? parsed.data.length : 0;
    steps.push({
      name: '项目列表',
      ok: parsed.ok,
      summary: parsed.ok ? `成功，共 ${count} 个项目` : `解析失败：${parsed.raw.slice(0, 100)}`,
      record: r.record,
    });
    lastStdout = r.stdout;
    lastStderr = r.stderr;
    if (!parsed.ok) lastError = `项目列表解析失败：${parsed.raw}`;
    else if (r.record.status !== 'success') lastError = r.record.error ?? null;
  } catch (e) {
    steps.push({ name: '项目列表', ok: false, summary: (e as Error).message });
    lastError = (e as Error).message;
  }

  // 5. 任务列表
  try {
    const cmd = renderTemplate(cfg.listTasksCommand, {});
    const r = await execWithDiagnose(cmd, cfg.timeoutMs, 'na');
    const parsed = parseJson<unknown[]>(r.stdout, r.record);
    const tasks = parsed.ok ? normalizeTasks(parsed.data) : [];
    steps.push({
      name: '任务列表',
      ok: parsed.ok,
      summary: parsed.ok
        ? `成功，共 ${tasks.length} 个任务`
        : `解析失败：${parsed.raw.slice(0, 100)}`,
      record: r.record,
    });
    lastStdout = r.stdout;
    lastStderr = r.stderr;
    if (!parsed.ok) lastError = `任务列表解析失败：${parsed.raw}`;
    else if (r.record.status !== 'success') lastError = r.record.error ?? null;
  } catch (e) {
    steps.push({ name: '任务列表', ok: false, summary: (e as Error).message });
    lastError = (e as Error).message;
  }

  // 6. 搜索任务（空查询测试连通性）
  try {
    const cmd = renderTemplate(cfg.searchTasksCommand, { query: 'test' });
    const r = await execWithDiagnose(cmd, cfg.timeoutMs, 'na');
    const parsed = parseJson<unknown[]>(r.stdout, r.record);
    const tasks = parsed.ok ? normalizeTasks(parsed.data) : [];
    steps.push({
      name: '搜索任务',
      ok: parsed.ok,
      summary: parsed.ok
        ? `成功，共 ${tasks.length} 个结果`
        : `解析失败：${parsed.raw.slice(0, 100)}`,
      record: r.record,
    });
    lastStdout = r.stdout;
    lastStderr = r.stderr;
    if (!parsed.ok) lastError = `搜索解析失败：${parsed.raw}`;
    else if (r.record.status !== 'success') lastError = r.record.error ?? null;
  } catch (e) {
    steps.push({ name: '搜索任务', ok: false, summary: (e as Error).message });
    lastError = (e as Error).message;
  }

  return {
    provider: 'dida',
    executable,
    executablePath,
    cwd: process.cwd(),
    version,
    loggedIn,
    loginStatusText,
    steps,
    lastError,
    lastStdout: truncate(lastStdout, 2000),
    lastStderr: truncate(lastStderr, 2000),
    templates: cfg,
  };
}

export class TickTickCliProvider implements TaskProvider {
  name = 'ticktick-cli';

  get isAuthenticated(): boolean {
    // CLI 模式无独立鉴权，只要命令可用即可
    return true;
  }

  async auth(): Promise<void> {
    return;
  }
  async logout(): Promise<void> {
    return;
  }

  async listProjects(): Promise<Project[]> {
    const cfg = getConfig();
    const cmd = renderTemplate(cfg.listProjectsCommand, {});
    const { stdout, record } = await execWithDiagnose(cmd, cfg.timeoutMs, 'na');
    // 命令失败时抛出带详细信息
    if (record.status === 'not-found') {
      throw new Error(`CLI 命令不存在：${record.error}`);
    }
    if (record.status === 'timeout') {
      throw new Error(`CLI 命令超时（${cfg.timeoutMs}ms）`);
    }
    if (record.status === 'failed') {
      throw new Error(
        `CLI 执行失败（exitCode=${record.exitCode}）：${record.stderr.slice(0, 200) || record.error}`,
      );
    }
    const parsed = parseJson<Project[]>(stdout, record);
    if (!parsed.ok) {
      logger.warn('cli', 'listProjects JSON parse failed', { raw: parsed.raw });
      throw new Error(`CLI 输出不是 JSON。原始输出片段：${parsed.raw.slice(0, 200)}`);
    }
    return parsed.data.map((p) => ({
      id: String(p.id ?? p.externalId ?? ''),
      source: 'ticktick' as const,
      externalId: String(p.externalId ?? p.id ?? ''),
      name: p.name ?? '未命名',
      color: p.color ?? null,
    }));
  }

  async listTasks(projectId?: string): Promise<Task[]> {
    const cfg = getConfig();
    const cmd = renderTemplate(cfg.listTasksCommand, {
      projectId: projectId ?? '',
    });
    const { stdout, record } = await execWithDiagnose(cmd, cfg.timeoutMs, 'na');
    if (record.status === 'not-found') {
      throw new Error(`CLI 命令不存在：${record.error}`);
    }
    if (record.status === 'timeout') {
      throw new Error(`CLI 命令超时（${cfg.timeoutMs}ms）`);
    }
    if (record.status === 'failed') {
      throw new Error(
        `CLI 执行失败（exitCode=${record.exitCode}）：${record.stderr.slice(0, 200) || record.error}`,
      );
    }
    const parsed = parseJson<unknown[]>(stdout, record);
    if (!parsed.ok) {
      logger.warn('cli', 'listTasks JSON parse failed', { raw: parsed.raw });
      throw new Error(`CLI 输出不是 JSON。原始输出片段：${parsed.raw.slice(0, 200)}`);
    }
    const tasks = normalizeTasks(parsed.data);
    cacheTasks(tasks);
    return tasks;
  }

  async searchTasks(query: string): Promise<Task[]> {
    const cfg = getConfig();
    const cmd = renderTemplate(cfg.searchTasksCommand, { query });
    const { stdout, record } = await execWithDiagnose(cmd, cfg.timeoutMs, 'na');
    if (record.status === 'not-found') {
      throw new Error(`CLI 命令不存在：${record.error}`);
    }
    if (record.status === 'timeout') {
      throw new Error(`CLI 命令超时（${cfg.timeoutMs}ms）`);
    }
    if (record.status === 'failed') {
      throw new Error(
        `CLI 执行失败（exitCode=${record.exitCode}）：${record.stderr.slice(0, 200) || record.error}`,
      );
    }
    const parsed = parseJson<unknown[]>(stdout, record);
    if (!parsed.ok) {
      logger.warn('cli', 'searchTasks JSON parse failed', { raw: parsed.raw });
      throw new Error(`CLI 搜索输出不是 JSON。原始输出片段：${parsed.raw.slice(0, 200)}`);
    }
    const tasks = normalizeTasks(parsed.data);
    cacheTasks(tasks);
    return tasks;
  }

  async getTask(taskId: string): Promise<Task | null> {
    const cfg = getConfig();
    const cached = listTaskCache('ticktick').find(
      (t) => t.id === taskId || t.externalId === taskId || t.id === `ticktick:${taskId}`,
    );
    const projectId = cached?.projectId ?? '';
    if (!projectId && cfg.getTaskCommand.includes('{{projectId}}')) {
      return cached ? cacheToTask(cached) : null;
    }
    const cmd = renderTemplate(cfg.getTaskCommand, {
      taskId: cached?.externalId ?? taskId,
      projectId,
    });
    try {
      const { stdout, record } = await execWithDiagnose(cmd, cfg.timeoutMs, 'na');
      if (record.status !== 'success') return cached ? cacheToTask(cached) : null;
      const parsed = parseJson<unknown>(stdout, record);
      if (!parsed.ok) return cached ? cacheToTask(cached) : null;
      const list = normalizeTasks([parsed.data]);
      cacheTasks(list);
      return list[0] ?? null;
    } catch {
      return cached ? cacheToTask(cached) : null;
    }
  }

  async updateTask(_taskId: string, _input: Partial<TaskUpdateInput>): Promise<void> {
    // CLI 模式暂不支持修改任务（追加备注用 appendFocusRecordToTask）
    return;
  }

  async appendFocusRecordToTask(taskId: string, record: FocusRecord): Promise<void> {
    const cfg = getConfig();
    const task = await this.getTask(taskId);
    const block = formatFocusRecord(record);
    const content = task?.content?.trim() ? `${task.content.trim()}\n\n${block}` : block;
    const cmd = renderTemplate(cfg.appendNoteCommand, {
      taskId: task?.externalId ?? taskId,
      content,
    });
    const r = await execWithDiagnose(cmd, cfg.timeoutMs, 'na');
    if (r.record.status !== 'success') {
      logger.error('cli', 'appendFocusRecord failed', r.record.error);
      throw new Error(`CLI 追加备注失败：${r.record.error ?? r.record.stderr.slice(0, 200)}`);
    }
    logger.info('cli', 'appended focus record to task', { taskId });
  }

  async completeTask(task: Task): Promise<void> {
    const cfg = getConfig();
    const taskId = (task.externalId || task.id).replace(/^ticktick:/, '');
    const cachedForTask = listTaskCache('ticktick').find(
      (t) => t.id === task.id || t.externalId === task.externalId || t.externalId === taskId,
    );
    const projectId = task.projectId ?? cachedForTask?.projectId;
    if (!projectId) {
      throw new Error('缺少清单 ID，无法通过 dida CLI 完成该任务。请先刷新任务列表。');
    }
    const cmd = `dida task complete ${projectId} ${taskId}`;
    const r = await execWithDiagnose(cmd, cfg.timeoutMs, 'na');
    if (r.record.status !== 'success') {
      logger.error('cli', 'completeTask failed', r.record.error);
      throw new Error(`CLI 完成任务失败：${r.record.error ?? r.record.stderr.slice(0, 200)}`);
    }
    if (cachedForTask) {
      cachedForTask.status = 'completed';
      cachedForTask.updatedAt = Date.now();
      upsertTaskCache(cachedForTask);
    }
    logger.info('cli', 'completed task', { taskId, projectId });
  }
}

/** 把 CLI 返回的任意结构归一化为 Task[]（保留父子树结构，不再用 ↳ 前缀） */
function normalizeTasks(raw: unknown[], parentId?: string): Task[] {
  if (!Array.isArray(raw)) return [];
  const out: Task[] = [];
  for (let idx = 0; idx < raw.length; idx++) {
    const item = raw[idx];
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = String(obj.id ?? obj._id ?? obj.taskId ?? idx);
    const title = String(obj.title ?? obj.name ?? obj.content ?? '未命名');
    const projectId = obj.projectId
      ? String(obj.projectId)
      : obj.project
        ? String(obj.project)
        : null;
    // dida status 数字：0=未完成，1=进行中，2=已完成
    const statusNum = obj.status;
    let statusStr: string | null = null;
    let isCompleted = false;
    if (typeof statusNum === 'number') {
      statusStr =
        statusNum === 0
          ? 'pending'
          : statusNum === 1
            ? 'in-progress'
            : statusNum === 2
              ? 'completed'
              : String(statusNum);
      isCompleted = statusNum === 2;
    } else if (typeof statusNum === 'string') {
      statusStr = statusNum;
      isCompleted = statusNum === 'completed' || statusNum === '2';
    } else if (obj.completed === true || obj.isCompleted === true) {
      statusStr = 'completed';
      isCompleted = true;
    }
    // completedTime 非空也视为已完成
    if (!isCompleted && obj.completedTime) {
      isCompleted = true;
      if (!statusStr) statusStr = 'completed';
    }
    // 优先级：dida 用 0/1/3/5
    const priority = obj.priority !== undefined ? Number(obj.priority) : null;
    // 截止日期：dida 用 dueDate 字符串
    let dueDate: number | null = null;
    if (obj.dueDate) {
      const t = Date.parse(String(obj.dueDate));
      if (!isNaN(t)) dueDate = t;
    } else if (obj.due) {
      const t = Date.parse(String(obj.due));
      if (!isNaN(t)) dueDate = t;
    }
    // sortOrder：dida 排序字段
    const sortOrder = typeof obj.sortOrder === 'number' ? obj.sortOrder : null;
    // 递归处理子任务（dida 的 items 数组）→ children 树
    let children: Task[] | undefined;
    if (Array.isArray(obj.items) && obj.items.length > 0) {
      children = normalizeTasks(obj.items, id);
      // 子任务继承父任务的 projectId
      for (const st of children) {
        if (!st.projectId && projectId) st.projectId = projectId;
      }
    }
    out.push({
      id,
      source: 'ticktick' as const,
      externalId: String(obj.externalId ?? obj.id ?? id),
      projectId,
      title,
      status: statusStr,
      isCompleted,
      priority,
      dueDate,
      sortOrder,
      tags: Array.isArray(obj.tags) ? obj.tags.map(String) : [],
      content: obj.content
        ? String(obj.content)
        : obj.note
          ? String(obj.note)
          : obj.desc
            ? String(obj.desc)
            : null,
      parentId: parentId ?? null,
      children,
    });
  }
  return out;
}

function cacheToTask(c: TaskCache): Task {
  return {
    id: c.externalId,
    source: 'ticktick',
    externalId: c.externalId,
    projectId: c.projectId,
    title: c.title,
    status: c.status,
    priority: c.priority,
    dueDate: c.dueDate,
    tags: c.tags ? JSON.parse(c.tags) : [],
    content: c.content,
    isCompleted: c.status === 'completed',
  };
}

function cacheTasks(tasks: Task[]): void {
  const now = Date.now();
  const visit = (list: Task[]) => {
    for (const task of list) {
      upsertTaskCache({
        id: `ticktick:${task.externalId}`,
        source: 'ticktick',
        externalId: task.externalId,
        projectId: task.projectId,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        tags: JSON.stringify(task.tags ?? []),
        content: task.content,
        rawJson: null,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      if (task.children) visit(task.children);
    }
  };
  visit(tasks);
}
function formatFocusRecord(record: FocusRecord): string {
  const start = new Date(record.startedAt).toLocaleString('zh-CN');
  const end = record.endedAt ? new Date(record.endedAt).toLocaleString('zh-CN') : '进行中';
  const activeMin = Math.round(record.activeElapsedMs / 60000);
  const pauseMin = Math.round(record.pauseElapsedMs / 60000);
  return `[FocusLink] ${start} - ${end} | 专注 ${activeMin} 分钟 | 暂停 ${pauseMin} 分钟 | ${record.taskTitle ?? '无任务'}`;
}

export const ticktickCliProvider = new TickTickCliProvider();
