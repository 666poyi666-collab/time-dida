// 本地滴答清单 CLI Provider
// 自动探测命令；用户可配置命令模板；超时控制；JSON 解析失败显示原始输出
// 安全：不在日志中泄露 token；命令执行有 timeout；CLI 不存在时不崩溃
//
// 诊断模式：
//   每次执行命令记录完整信息（exitCode/stdout/stderr/parseResult/error）。
//   diagnose() 一次性返回所有诊断字段供 UI 展示。
import { exec, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  Task,
  Project,
  TaskProvider,
  TaskUpdateInput,
  FocusRecord,
  FocusSegment,
  TickTickCliConfig,
  AppSettings,
  TaskCache,
} from '@shared/types';
import { getSettings, saveSettings } from '../settingsStore.js';
import { logger } from '../logger.js';
import { listTaskCache, upsertTaskCache, getSegment, setSegmentCloudFocusId } from '../db/index.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** dida CLI 默认命令模板 - 探测到 dida 后自动应用 */
export const DIDA_DEFAULT_TEMPLATES: TickTickCliConfig = {
  executable: '',
  listTasksCommand: 'dida task filter --json',
  searchTasksCommand: 'dida task filter --json',
  getTaskCommand: 'dida task get {{projectId}} {{taskId}} --json',
  appendNoteCommand:
    'dida task update {{taskId}} --id {{taskId}} --project {{projectId}} --content "{{content}}"',
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

/** 旧版 dida 模板把 taskId 当作位置参数传给 update，会触发 "--id <id> 缺失"。 */
export function hasLegacyDidaAppendTemplate(cfg: TickTickCliConfig): boolean {
  const command = cfg.appendNoteCommand.trim();
  return (
    /^dida\s+task\s+update\b/.test(command) &&
    command.includes('{{taskId}}') &&
    command.includes('--content') &&
    (!command.includes('--id') || !command.includes('--project'))
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

interface RawDidaTask {
  id?: unknown;
  externalId?: unknown;
  projectId?: unknown;
  project?: unknown;
  title?: unknown;
  name?: unknown;
  content?: unknown;
  desc?: unknown;
  note?: unknown;
  status?: unknown;
  sortOrder?: unknown;
  timeZone?: unknown;
  isAllDay?: unknown;
  priority?: unknown;
  dueDate?: unknown;
  tags?: unknown;
  items?: unknown;
}

interface DidaTaskContext {
  task: Task;
  parentTask: Task | null;
  rawTask: RawDidaTask;
  rawParent: RawDidaTask | null;
  isChecklistItem: boolean;
}

interface DidaComment {
  id?: unknown;
  title?: unknown;
  content?: unknown;
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
        if (
          templatesContainTicktick(cur.ticktickCli) ||
          hasLegacyDidaAppendTemplate(cur.ticktickCli)
        ) {
          logger.info('cli', 'auto-migrating stale CLI templates -> dida templates');
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

function isDidaCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed === 'dida' || /^dida(?:\.cmd|\.exe)?\s/i.test(trimmed);
}

function isDidaConfig(cfg: TickTickCliConfig): boolean {
  return (
    isDidaCommand(cfg.listTasksCommand) ||
    isDidaCommand(cfg.getTaskCommand) ||
    isDidaCommand(cfg.appendNoteCommand)
  );
}

function asRawTask(value: unknown): RawDidaTask | null {
  return value && typeof value === 'object' ? (value as RawDidaTask) : null;
}

function rawTaskId(value: RawDidaTask | null): string | null {
  if (!value) return null;
  const id = value.externalId ?? value.id;
  return id == null ? null : String(id);
}

function normalizeTaskId(taskId: string): string {
  return taskId.replace(/^ticktick:/, '');
}

function parseCachedMeta(rawJson: string | null): { parentId?: string | null } {
  if (!rawJson) return {};
  try {
    const parsed = JSON.parse(rawJson) as { parentId?: unknown };
    return { parentId: parsed.parentId == null ? null : String(parsed.parentId) };
  } catch {
    return {};
  }
}

function isUndefinedCliOutput(stdout: string): boolean {
  return stdout.trim() === 'undefined';
}

function findNodeExecutable(): string | null {
  const candidates: string[] = [];
  const isElectron = !!process.versions.electron;
  if (!isElectron && process.execPath) {
    candidates.push(process.execPath);
  }
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node.exe'));
  }
  candidates.push('C:\\Program Files\\nodejs\\node.exe');
  candidates.push('C:\\Program Files (x86)\\nodejs\\node.exe');
  if (process.env.NVM_HOME) {
    candidates.push(path.join(process.env.NVM_HOME, process.version, 'node.exe'));
  }
  if (process.env.NODE) {
    candidates.push(process.env.NODE);
  }
  candidates.push('node');
  for (const candidate of candidates) {
    try {
      if (candidate === 'node' || fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // continue
    }
  }
  return null;
}

let didaExecTargetCache: { file: string; argsPrefix: string[] } | null = null;

function getDidaExecTarget(): { file: string; argsPrefix: string[] } {
  if (didaExecTargetCache) return didaExecTargetCache;
  if (process.platform === 'win32') {
    const npmRoot = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null;
    const cliScript = npmRoot
      ? path.join(npmRoot, 'node_modules', '@suibiji', 'dida-cli', 'dist', 'index.js')
      : null;
    if (cliScript && fs.existsSync(cliScript)) {
      const nodeExe = findNodeExecutable();
      if (nodeExe) {
        didaExecTargetCache = { file: nodeExe, argsPrefix: [cliScript] };
        logger.info('cli', 'using node + cliScript', { nodeExe, cliScript });
        return didaExecTargetCache;
      }
    }
    const cmdShim = npmRoot ? path.join(npmRoot, 'dida.cmd') : null;
    if (cmdShim && fs.existsSync(cmdShim)) {
      didaExecTargetCache = { file: 'cmd.exe', argsPrefix: ['/c', cmdShim] };
      logger.info('cli', 'using cmd.exe /c dida.cmd fallback');
      return didaExecTargetCache;
    }
  }
  didaExecTargetCache = { file: 'dida', argsPrefix: [] };
  return didaExecTargetCache;
}

async function execDidaFileWithDiagnose(
  args: string[],
  timeoutMs: number,
  parseResult: 'success' | 'failed' | 'na' = 'na',
): Promise<{ stdout: string; stderr: string; record: CliExecRecord }> {
  const target = getDidaExecTarget();
  return execFileWithDiagnose(target.file, [...target.argsPrefix, ...args], timeoutMs, parseResult);
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

async function execFileWithDiagnose(
  file: string,
  args: string[],
  timeoutMs: number,
  parseResult: 'success' | 'failed' | 'na' = 'na',
): Promise<{ stdout: string; stderr: string; record: CliExecRecord }> {
  const command = [file, ...args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))].join(' ');
  const masked = maskSecret(command);
  logger.info('cli', 'execFile', { command: masked, cwd: process.cwd(), timeoutMs });
  const startTs = Date.now();
  const record: CliExecRecord = {
    command: masked,
    cwd: process.cwd(),
    timeoutMs,
    exitCode: null,
    stdout: '',
    stderr: '',
    durationMs: 0,
    status: 'success',
    parseResult,
  };

  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 4,
      windowsHide: true,
      encoding: 'utf8',
    });
    record.stdout = stdout;
    record.stderr = stderr;
    record.exitCode = 0;
    record.durationMs = Date.now() - startTs;
    lastRecord = record;
    logger.info('cli', 'execFile done', {
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
    logger.error('cli', 'execFile failed', {
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

  private getCachedTask(taskId: string): TaskCache | null {
    const normalized = normalizeTaskId(taskId);
    return (
      listTaskCache('ticktick').find(
        (t) =>
          t.id === taskId ||
          t.externalId === taskId ||
          t.id === `ticktick:${normalized}` ||
          t.externalId === normalized,
      ) ?? null
    );
  }

  private async listRawDidaTasks(): Promise<RawDidaTask[]> {
    const cfg = getConfig();
    const { stdout, record } = await execDidaFileWithDiagnose(
      ['task', 'filter', '--status', '0,2', '--json'],
      cfg.timeoutMs,
      'na',
    );
    if (record.status !== 'success') {
      throw new Error(`CLI 任务列表失败：${record.error ?? record.stderr.slice(0, 200)}`);
    }
    const parsed = parseJson<unknown[]>(stdout, record);
    if (!parsed.ok) {
      throw new Error(`CLI 任务列表不是 JSON：${parsed.raw.slice(0, 200)}`);
    }
    const rawTasks = parsed.data.map(asRawTask).filter((task): task is RawDidaTask => !!task);
    cacheTasks(normalizeTasks(rawTasks));
    return rawTasks;
  }

  private rawToTask(
    rawTask: RawDidaTask,
    parentId?: string | null,
    projectId?: string | null,
  ): Task {
    const task = normalizeTasks([rawTask], parentId ?? undefined)[0];
    if (!task) {
      throw new Error('任务数据解析失败');
    }
    if (!task.projectId && projectId) task.projectId = projectId;
    return task;
  }

  private findContextInRawTasks(rawTasks: RawDidaTask[], taskId: string): DidaTaskContext | null {
    const normalized = normalizeTaskId(taskId);
    for (const rawParent of rawTasks) {
      const parentId = rawTaskId(rawParent);
      const parentProjectId =
        rawParent.projectId != null
          ? String(rawParent.projectId)
          : rawParent.project != null
            ? String(rawParent.project)
            : null;
      if (parentId === normalized) {
        const task = this.rawToTask(rawParent, null, parentProjectId);
        return {
          task,
          parentTask: null,
          rawTask: rawParent,
          rawParent: null,
          isChecklistItem: false,
        };
      }

      const rawItems = Array.isArray(rawParent.items) ? rawParent.items : [];
      for (const rawItemValue of rawItems) {
        const rawItem = asRawTask(rawItemValue);
        if (!rawItem || rawTaskId(rawItem) !== normalized) continue;
        const parentTask = this.rawToTask(rawParent, null, parentProjectId);
        const task = this.rawToTask(rawItem, parentId, parentProjectId);
        task.parentId = parentId;
        return {
          task,
          parentTask,
          rawTask: rawItem,
          rawParent,
          isChecklistItem: true,
        };
      }
    }
    return null;
  }

  private async resolveDidaTaskContext(taskId: string): Promise<DidaTaskContext | null> {
    const cached = this.getCachedTask(taskId);
    try {
      const rawTasks = await this.listRawDidaTasks();
      const fromRaw = this.findContextInRawTasks(rawTasks, taskId);
      if (fromRaw) return fromRaw;
      // filter 列表中找不到此任务，但这不意味着任务已删除：
      // dida task filter 可能不返回归档/共享/特定项目的任务。
      // 若有缓存，用 dida task get 二次确认任务是否仍然存在。
      if (cached) {
        const verified = await this.verifyDidaTaskExists(
          cached.externalId,
          cached.projectId ?? '',
        );
        if (verified) {
          logger.info('cli', 'task not in filter list but verified via task get', { taskId });
          return verified;
        }
        // task get 也拿不到 → 任务确实已删除
        logger.warn('cli', 'task not found in filter nor via task get, likely deleted', { taskId });
        return null;
      }
      logger.warn('cli', 'task not found in dida task list and no cache available', { taskId });
      return null;
    } catch (err) {
      logger.warn('cli', 'resolve dida task context from raw list failed', {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // 仅在 CLI 调用失败时回退到缓存
    if (!cached) return null;
    const task = cacheToTask(cached);
    return {
      task,
      parentTask: null,
      rawTask: {
        id: cached.externalId,
        projectId: cached.projectId,
        title: cached.title,
        content: cached.content,
        status: cached.status,
      },
      rawParent: null,
      isChecklistItem: false,
    };
  }

  /** 用 dida task get 二次确认任务是否仍然存在。
   *  filter 可能不返回归档/共享项目的任务，但 task get 可以直接按 id 获取。
   *  返回 DidaTaskContext（任务存在）或 null（任务不存在/get 失败）。 */
  private async verifyDidaTaskExists(
    externalId: string,
    projectId: string,
  ): Promise<DidaTaskContext | null> {
    const cfg = getConfig();
    if (!projectId) {
      logger.warn('cli', 'verifyDidaTaskExists skipped: no projectId in cache', { externalId });
      return null;
    }
    try {
      const { stdout, record } = await execDidaFileWithDiagnose(
        ['task', 'get', projectId, externalId, '--json'],
        cfg.timeoutMs,
        'na',
      );
      if (record.status !== 'success' || isUndefinedCliOutput(stdout)) {
        logger.warn('cli', 'verifyDidaTaskExists: task get failed or undefined', {
          externalId,
          projectId,
          status: record.status,
        });
        return null;
      }
      const parsed = parseJson<unknown>(stdout, record);
      if (!parsed.ok) {
        logger.warn('cli', 'verifyDidaTaskExists: task get returned non-JSON', { externalId });
        return null;
      }
      const rawTask = asRawTask(parsed.data);
      if (!rawTask) return null;
      const task = this.rawToTask(rawTask, null, projectId);
      // 更新缓存
      cacheTasks([task]);
      return {
        task,
        parentTask: null,
        rawTask,
        rawParent: null,
        isChecklistItem: false,
      };
    } catch (err) {
      logger.warn('cli', 'verifyDidaTaskExists error', {
        externalId,
        projectId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async getTask(taskId: string): Promise<Task | null> {
    const cfg = getConfig();
    const cached = this.getCachedTask(taskId);
    if (isDidaConfig(cfg)) {
      const context = await this.resolveDidaTaskContext(taskId);
      if (context) return context.task;
      // dida 配置下 resolveDidaTaskContext 返回 null 表示任务已从滴答删除（或 CLI 失败且无缓存）。
      // 不回退到缓存——缓存中可能是已删除的任务，会导致 focus create 传过期的 task-id。
      return null;
    }
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
    await this.appendFocusRecordsToTask(taskId, [record]);
  }

  private async updateDidaTaskContent(
    externalTaskId: string,
    projectId: string,
    content: string,
    cfg: TickTickCliConfig,
  ): Promise<void> {
    const r = isDidaConfig(cfg)
      ? await execDidaFileWithDiagnose(
          [
            'task',
            'update',
            externalTaskId,
            '--id',
            externalTaskId,
            '--project',
            projectId,
            '--content',
            content,
            '--json',
          ],
          cfg.timeoutMs,
          'na',
        )
      : await execWithDiagnose(
          renderTemplate(cfg.appendNoteCommand, {
            taskId: externalTaskId,
            projectId,
            content,
          }),
          cfg.timeoutMs,
          'na',
        );
    if (r.record.status !== 'success' || isUndefinedCliOutput(r.stdout)) {
      logger.error('cli', 'appendFocusRecord failed', r.record.error ?? r.stdout);
      throw new Error(
        `CLI 追加备注失败：${
          isUndefinedCliOutput(r.stdout)
            ? 'dida 返回 undefined，任务可能是 checklist 子项或不存在'
            : (r.record.error ?? r.record.stderr.slice(0, 200))
        }`,
      );
    }
  }

  private async listDidaTaskComments(
    externalTaskId: string,
    projectId: string,
    cfg: TickTickCliConfig,
  ): Promise<DidaComment[]> {
    const r = await execDidaFileWithDiagnose(
      ['task', 'comment', 'list', projectId, externalTaskId, '--json'],
      cfg.timeoutMs,
      'na',
    );
    if (r.record.status !== 'success') {
      throw new Error(`CLI 读取评论失败：${r.record.error ?? r.record.stderr.slice(0, 200)}`);
    }
    const parsed = parseJson<unknown[]>(r.stdout, r.record);
    if (!parsed.ok) {
      throw new Error(`CLI 评论输出不是 JSON：${parsed.raw.slice(0, 200)}`);
    }
    return parsed.data
      .filter((item): item is DidaComment => !!item && typeof item === 'object')
      .map((item) => item as DidaComment);
  }

  private async addDidaTaskComment(
    externalTaskId: string,
    projectId: string,
    title: string,
    cfg: TickTickCliConfig,
  ): Promise<void> {
    const r = await execDidaFileWithDiagnose(
      ['task', 'comment', 'add', projectId, externalTaskId, '--title', title, '--json'],
      cfg.timeoutMs,
      'na',
    );
    if (r.record.status !== 'success' || isUndefinedCliOutput(r.stdout)) {
      throw new Error(
        `CLI 添加评论失败：${
          isUndefinedCliOutput(r.stdout)
            ? 'dida 返回 undefined'
            : (r.record.error ?? r.record.stderr.slice(0, 200))
        }`,
      );
    }
  }

  private async appendDidaFocusComments(
    externalTaskId: string,
    projectId: string,
    taskTitle: string | null,
    records: FocusRecord[],
    cfg: TickTickCliConfig,
  ): Promise<{ added: number; skipped: number }> {
    const comments = await this.listDidaTaskComments(externalTaskId, projectId, cfg);
    const existingText = comments
      .map((comment) => String(comment.title ?? comment.content ?? ''))
      .join('\n');
    let added = 0;
    let skipped = 0;
    for (const record of records) {
      const marker = getFocusRecordMarker(record);
      if (existingText.includes(marker)) {
        skipped++;
        continue;
      }
      const commentTitle = taskTitle
        ? `【子任务：${taskTitle}】\n${formatFocusRecord(record)}\n${marker}`
        : `${formatFocusRecord(record)}\n${marker}`;
      await this.addDidaTaskComment(externalTaskId, projectId, commentTitle, cfg);
      added++;
    }
    return { added, skipped };
  }

  async appendFocusRecordsToTask(taskId: string, records: FocusRecord[]): Promise<void> {
    if (records.length === 0) return;
    const cfg = getConfig();
    const context = isDidaConfig(cfg) ? await this.resolveDidaTaskContext(taskId) : null;
    // dida 配置下：context 为 null 表示任务已删除，跳过 comment 同步
    // 非 dida 配置下：保留 getTask 回退逻辑
    const task = context?.task ?? (isDidaConfig(cfg) ? null : await this.getTask(taskId));
    // 任务在滴答中已删除：跳过 comment 同步，不报错
    if (!task) {
      logger.warn('cli', 'task not found in dida, skipping comment sync', { taskId });
      return;
    }
    const targetTask = context?.isChecklistItem ? context.parentTask : task;
    const externalTaskId = targetTask?.externalId ?? normalizeTaskId(taskId);
    const projectId = targetTask?.projectId ?? task?.projectId ?? findCachedTaskProjectId(taskId);
    if (!projectId && cfg.appendNoteCommand.includes('{{projectId}}')) {
      throw new Error('缺少清单 ID，无法通过 dida CLI 写入任务备注。请先刷新任务列表。');
    }

    if (isDidaConfig(cfg)) {
      try {
        const result = await this.appendDidaFocusComments(
          externalTaskId,
          projectId ?? '',
          context?.isChecklistItem ? (task?.title ?? null) : null,
          records,
          cfg,
        );
        logger.info('cli', 'appended focus comments to task', {
          taskId,
          targetTaskId: externalTaskId,
          checklistItem: context?.isChecklistItem ?? false,
          added: result.added,
          skipped: result.skipped,
        });
        return;
      } catch (err) {
        logger.warn('cli', 'append focus comments failed; fallback to task content', {
          taskId,
          targetTaskId: externalTaskId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const existingContent = targetTask?.content ?? '';
    const missingRecords = records.filter(
      (record) => !existingContent.includes(getFocusRecordMarker(record)),
    );
    if (missingRecords.length === 0) {
      logger.info('cli', 'focus records already exist in task content', {
        taskId,
        targetTaskId: externalTaskId,
      });
      return;
    }
    const missingBlock = missingRecords
      .map((record) => `${formatFocusRecord(record)}\n${getFocusRecordMarker(record)}`)
      .join('\n');
    const blockWithChecklistLabel =
      context?.isChecklistItem && task?.title
        ? `【子任务：${task.title}】\n${missingBlock}`
        : missingBlock;
    const baseContent = targetTask?.content?.trim() ?? '';
    const content = baseContent
      ? `${baseContent}\n\n${blockWithChecklistLabel}`
      : blockWithChecklistLabel;
    await this.updateDidaTaskContent(externalTaskId, projectId ?? '', content, cfg);
    if (targetTask) {
      const cached = listTaskCache('ticktick').find(
        (t) =>
          t.id === targetTask.id ||
          t.externalId === targetTask.externalId ||
          t.externalId === externalTaskId,
      );
      if (cached) {
        cached.content = content;
        cached.updatedAt = Date.now();
        upsertTaskCache(cached);
      }
    }
    logger.info('cli', 'appended focus records to task', {
      taskId,
      targetTaskId: externalTaskId,
      checklistItem: context?.isChecklistItem ?? false,
      count: records.length,
    });
  }

  private async listDidaFocusRecords(
    fromMs: number,
    toMs: number,
    cfg: TickTickCliConfig,
  ): Promise<Array<{ id: string; note?: string }>> {
    const fromIso = new Date(fromMs).toISOString();
    const toIso = new Date(toMs).toISOString();
    const r = await execDidaFileWithDiagnose(
      ['focus', 'list', '--from', fromIso, '--to', toIso, '--type', '1', '--json'],
      Math.max(cfg.timeoutMs, 15000),
      'na',
    );
    if (r.record.status !== 'success') {
      logger.warn('cli', 'listDidaFocusRecords failed', { error: r.record.error });
      return [];
    }
    const parsed = parseJson<unknown[]>(r.stdout, r.record);
    if (!parsed.ok) return [];
    return parsed.data
      .filter((item): item is { id: string; note?: string } => !!item && typeof item === 'object')
      .map((item) => item as { id: string; note?: string });
  }

  private async createDidaFocusRecord(
    externalTaskId: string | null,
    record: FocusRecord,
    cfg: TickTickCliConfig,
  ): Promise<string> {
    if (!record.endedAt) {
      throw new Error('专注记录未结束，无法同步到云端');
    }
    const startTime = new Date(record.startedAt).toISOString();
    // 滴答云端用 endTime - startTime 显示时长，因此 endTime 必须等于 startTime + activeElapsedMs，
    // 否则会把暂停时间也算进专注时长（segment.endedAt 包含暂停期间的墙时间）。
    const endTime = new Date(record.startedAt + record.activeElapsedMs).toISOString();
    const durationSec = Math.max(1, Math.round(record.activeElapsedMs / 1000));
    const pauseDurationSec = Math.max(0, Math.round(record.pauseElapsedMs / 1000));
    const marker = getFocusRecordMarker(record);
    const noteText = record.taskTitle
      ? `${formatFocusRecord(record)}\n${marker}`
      : `${formatFocusRecord(record)}\n${marker}`;

    const args = [
      'focus',
      'create',
      '--type',
      '1',
    ];
    // task-id 可选：任务已删除时不传，创建无关联的专注记录
    if (externalTaskId) {
      args.push('--task-id', externalTaskId);
    }
    args.push(
      '--note', noteText,
      '--start-time', startTime,
      '--end-time', endTime,
      '--duration', String(durationSec),
      '--pause-duration', String(pauseDurationSec),
      '--json',
    );

    const r = await execDidaFileWithDiagnose(
      args,
      Math.max(cfg.timeoutMs, 15000),
      'na',
    );
    if (r.record.status !== 'success' || isUndefinedCliOutput(r.stdout)) {
      throw new Error(
        `CLI 创建专注记录失败：${
          isUndefinedCliOutput(r.stdout)
            ? 'dida 返回 undefined'
            : (r.record.error ?? r.record.stderr.slice(0, 200))
        }`,
      );
    }
    const parsed = parseJson<{ id?: string }>(r.stdout, r.record);
    if (!parsed.ok || !parsed.data.id) {
      throw new Error(`CLI 创建专注记录返回格式异常：${parsed.ok ? '缺少 id 字段' : parsed.raw.slice(0, 200)}`);
    }
    return parsed.data.id;
  }

  async createFocusRecord(record: FocusRecord): Promise<string | null> {
    const cfg = getConfig();
    if (!isDidaConfig(cfg)) return null;

    const taskId = record.taskId;
    // focus create 不强制要求 taskId，未关联任务时创建无关联专注记录

    // 尝试解析任务上下文，但任务不存在时不报错
    let externalTaskId: string | null = null;
    if (taskId) {
      const context = await this.resolveDidaTaskContext(taskId);
      if (context) {
        const targetTask = context.isChecklistItem ? context.parentTask : context.task;
        externalTaskId = targetTask?.externalId ?? normalizeTaskId(taskId);
      } else {
        // resolveDidaTaskContext 返回 null：任务已从滴答删除，或 CLI 失败且无缓存。
        // 不调用 getTask 回退（getTask 在 dida 配置下也会返回 null），直接创建无关联专注记录。
        logger.warn('cli', 'task not found in dida, creating unassociated focus record', { taskId });
      }
    }

    const marker = getFocusRecordMarker(record);
    const listFrom = record.startedAt - 60_000;
    const listTo = (record.endedAt ?? Date.now()) + 60_000;
    try {
      const existing = await this.listDidaFocusRecords(listFrom, listTo, cfg);
      const matched = existing.find((f) => (f.note ?? '').includes(marker));
      if (matched) {
        logger.info('cli', 'focus record already exists, skipping', { marker, focusId: matched.id });
        // 即使跳过也要存储 cloudFocusId，便于后续删除
        if (record.segmentId && matched.id) {
          setSegmentCloudFocusId(record.segmentId, matched.id);
        }
        return matched.id;
      }
    } catch (err) {
      logger.warn('cli', 'failed to check existing focus records, proceeding to create', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const focusId = await this.createDidaFocusRecord(externalTaskId, record, cfg);
    logger.info('cli', 'created dida focus record', {
      taskId: taskId ?? 'none',
      targetTaskId: externalTaskId ?? 'none',
      focusId,
      marker,
    });
    // 存储 cloudFocusId，用于删除时联动云端
    if (record.segmentId && focusId) {
      setSegmentCloudFocusId(record.segmentId, focusId);
    }
    return focusId;
  }

  /** 删除已同步到滴答云端的专注记录 */
  async deleteFocusRecord(segmentId: string): Promise<boolean> {
    const cfg = getConfig();
    if (!isDidaConfig(cfg)) return false;
    const seg = getSegment(segmentId);
    if (!seg) {
      logger.warn('cli', 'deleteFocusRecord: segment not found', { segmentId });
      return false;
    }

    let focusIdToDelete: string | null = seg.cloudFocusId;

    // 兜底：cloudFocusId 为空时（v0.2.17 之前同步的历史记录），通过 marker 在云端反查。
    // 这样可以把错误的旧记录（如时间偏大的 2 小时 4 分钟）也删掉再重新同步。
    if (!focusIdToDelete) {
      logger.info('cli', 'deleteFocusRecord: no cloudFocusId, trying marker fallback', { segmentId });
      focusIdToDelete = await this.findCloudFocusIdByMarker(seg, cfg);
      if (focusIdToDelete) {
        logger.info('cli', 'deleteFocusRecord: found cloud record via marker', {
          segmentId,
          focusId: focusIdToDelete,
        });
      } else {
        // marker 也找不到，说明云端确实没有这条记录，视为成功
        logger.info('cli', 'deleteFocusRecord: no cloud record found via marker, treating as success', {
          segmentId,
        });
        return true;
      }
    }

    try {
      const { stdout, record } = await execDidaFileWithDiagnose(
        ['focus', 'delete', focusIdToDelete, '--type', '1', '--json'],
        Math.max(cfg.timeoutMs, 15000),
        'na',
      );
      // 404 视为成功（云端已被手动删除）
      if (record.status === 'failed' && /404|not found/i.test(record.stderr + record.stdout)) {
        logger.info('cli', 'deleteFocusRecord: cloud record not found (404), treating as success', {
          segmentId,
          cloudFocusId: focusIdToDelete,
        });
      } else if (record.status !== 'success') {
        logger.warn('cli', 'deleteFocusRecord: CLI failed', {
          segmentId,
          cloudFocusId: focusIdToDelete,
          status: record.status,
          stderr: record.stderr.slice(0, 200),
        });
        return false;
      }
      // 清除 cloudFocusId
      setSegmentCloudFocusId(segmentId, null);
      logger.info('cli', 'deleteFocusRecord: cloud record deleted', {
        segmentId,
        cloudFocusId: focusIdToDelete,
      });
      return true;
    } catch (err) {
      logger.warn('cli', 'deleteFocusRecord error', {
        segmentId,
        cloudFocusId: focusIdToDelete,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * 兜底方案：当本地未存储 cloudFocusId 时，通过 marker 在云端专注记录列表中反查。
   * marker 形如 [FocusLink:segment:<segmentId>]，写入专注记录的 note 字段。
   * 查询范围以 segment 起止时间各外扩 1 分钟，覆盖时区/取整误差。
   */
  private async findCloudFocusIdByMarker(
    seg: FocusSegment,
    cfg: TickTickCliConfig,
  ): Promise<string | null> {
    if (!seg.endedAt) return null;
    const marker = `[FocusLink:segment:${seg.id}]`;
    const listFrom = seg.startedAt - 60_000;
    const listTo = seg.endedAt + 60_000;
    try {
      const existing = await this.listDidaFocusRecords(listFrom, listTo, cfg);
      const matched = existing.find((f) => (f.note ?? '').includes(marker));
      return matched?.id ?? null;
    } catch (err) {
      logger.warn('cli', 'findCloudFocusIdByMarker failed', {
        segmentId: seg.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async completeTask(task: Task): Promise<void> {
    const cfg = getConfig();
    const context = isDidaConfig(cfg)
      ? await this.resolveDidaTaskContext(task.externalId || task.id)
      : null;
    if (context?.isChecklistItem) {
      await this.completeDidaChecklistItem(context, cfg);
      return;
    }

    const taskId = normalizeTaskId(task.externalId || task.id);
    const cachedForTask = this.getCachedTask(taskId);
    const projectId = task.projectId ?? cachedForTask?.projectId ?? context?.task.projectId;
    if (!projectId) {
      throw new Error('缺少清单 ID，无法通过 dida CLI 完成该任务。请先刷新任务列表。');
    }
    const r = isDidaConfig(cfg)
      ? await execDidaFileWithDiagnose(['task', 'complete', projectId, taskId], cfg.timeoutMs, 'na')
      : await execWithDiagnose(`dida task complete ${projectId} ${taskId}`, cfg.timeoutMs, 'na');
    if (r.record.status !== 'success' || isUndefinedCliOutput(r.stdout)) {
      logger.error('cli', 'completeTask failed', r.record.error);
      throw new Error(
        `CLI 完成任务失败：${
          isUndefinedCliOutput(r.stdout)
            ? 'dida 返回 undefined，任务可能不存在或是 checklist 子项'
            : (r.record.error ?? r.record.stderr.slice(0, 200))
        }`,
      );
    }
    if (cachedForTask) {
      cachedForTask.status = 'completed';
      cachedForTask.updatedAt = Date.now();
      upsertTaskCache(cachedForTask);
    }
    logger.info('cli', 'completed task', { taskId, projectId });
  }

  private async completeDidaChecklistItem(
    context: DidaTaskContext,
    cfg: TickTickCliConfig,
  ): Promise<void> {
    const parentId = context.parentTask?.externalId ?? rawTaskId(context.rawParent);
    const projectId = context.parentTask?.projectId;
    const childId = context.task.externalId;
    const rawItems = Array.isArray(context.rawParent?.items) ? context.rawParent.items : [];
    if (!parentId || !projectId || rawItems.length === 0) {
      throw new Error('缺少父任务或清单信息，无法完成 checklist 子项。请先刷新任务列表。');
    }

    const items = rawItems
      .map(asRawTask)
      .filter((item): item is RawDidaTask => !!item)
      .map((item) => ({
        id: rawTaskId(item) ?? undefined,
        title: String(item.title ?? item.name ?? ''),
        status: rawTaskId(item) === childId ? 2 : Number(item.status ?? 0),
        sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : undefined,
        timeZone: item.timeZone ? String(item.timeZone) : undefined,
        isAllDay: typeof item.isAllDay === 'boolean' ? item.isAllDay : undefined,
      }));
    const itemsJson = JSON.stringify(items);
    const r = await execDidaFileWithDiagnose(
      [
        'task',
        'update',
        parentId,
        '--id',
        parentId,
        '--project',
        projectId,
        '--items',
        itemsJson,
        '--json',
      ],
      cfg.timeoutMs,
      'na',
    );
    if (r.record.status !== 'success' || isUndefinedCliOutput(r.stdout)) {
      logger.error('cli', 'complete checklist item failed', r.record.error ?? r.stdout);
      throw new Error(
        `CLI 完成 checklist 子项失败：${
          isUndefinedCliOutput(r.stdout)
            ? 'dida 返回 undefined'
            : (r.record.error ?? r.record.stderr.slice(0, 200))
        }`,
      );
    }

    const cachedForTask = this.getCachedTask(childId);
    if (cachedForTask) {
      cachedForTask.status = 'completed';
      cachedForTask.updatedAt = Date.now();
      upsertTaskCache(cachedForTask);
    }
    logger.info('cli', 'completed checklist item', { taskId: childId, parentId, projectId });
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
  const meta = parseCachedMeta(c.rawJson);
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
    parentId: meta.parentId ?? null,
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
        rawJson: JSON.stringify({ parentId: task.parentId ?? null }),
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      if (task.children) visit(task.children);
    }
  };
  visit(tasks);
}

function findCachedTaskProjectId(taskId: string): string | null {
  const normalized = taskId.replace(/^ticktick:/, '');
  const cached = listTaskCache('ticktick').find(
    (task) =>
      task.id === taskId ||
      task.externalId === taskId ||
      task.id === `ticktick:${normalized}` ||
      task.externalId === normalized,
  );
  return cached?.projectId ?? null;
}

function formatFocusRecord(record: FocusRecord): string {
  const start = new Date(record.startedAt).toLocaleString('zh-CN');
  const end = record.endedAt ? new Date(record.endedAt).toLocaleString('zh-CN') : '进行中';
  const activeMin = Math.round(record.activeElapsedMs / 60000);
  const pauseMin = Math.round(record.pauseElapsedMs / 60000);
  return `[FocusLink] ${start} - ${end} | 专注 ${activeMin} 分钟 | 暂停 ${pauseMin} 分钟 | ${record.taskTitle ?? '无任务'}`;
}

function getFocusRecordMarker(record: FocusRecord): string {
  return record.segmentId
    ? `[FocusLink:segment:${record.segmentId}]`
    : `[FocusLink:session:${record.sessionId}]`;
}

export const ticktickCliProvider = new TickTickCliProvider();
