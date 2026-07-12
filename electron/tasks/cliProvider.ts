// 本地滴答清单 CLI Provider
// 自动探测命令；用户可配置命令模板；超时控制；JSON 解析失败显示原始输出
// 安全：不在日志中泄露 token；命令执行有 timeout；CLI 不存在时不崩溃
//
// 诊断模式：
//   每次执行命令记录完整信息（exitCode/stdout/stderr/parseResult/error）。
//   diagnose() 一次性返回所有诊断字段供 UI 展示。
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
  TaskWorkspaceRefreshOptions,
} from '@shared/types';
import { getSettings, saveSettings } from '../settingsStore.js';
import { logger } from '../logger.js';
import {
  listTaskCache,
  upsertTaskCache,
  upsertTaskCaches,
  getSegment,
  setSegmentCloudFocusId,
} from '../db/index.js';
import { reopenDidaTaskViaOpenApi } from '../integrations/ticktick/didaOpenApiBridge.js';

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
const DIDA_RAW_TASK_CACHE_TTL_MS = 30_000;

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
  completedTime?: unknown;
  createdTime?: unknown;
  modifiedTime?: unknown;
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

export interface TickTickCliProviderOptions {
  /** Successful active-task snapshots only; failures are never cached. */
  rawTaskCacheTtlMs?: number;
  now?: () => number;
}

interface DidaComment {
  id?: unknown;
  title?: unknown;
  content?: unknown;
}

export interface DidaCloudFocusRecord {
  id: string;
  note?: string;
  /** dida focus list/get 返回毫秒；create 的 --duration 输入则是秒。 */
  duration?: number | string;
  startTime?: string;
  endTime?: string;
  /** dida focus list/get 返回秒。 */
  pauseDuration?: number | string;
}

export interface DidaFocusTiming {
  startTime: string;
  endTime: string;
  startMs: number;
  endMs: number;
  expectedDurationMs: number;
  durationSec: number;
  pauseDurationSec: number;
}

export const DIDA_FOCUS_DURATION_TOLERANCE_MS = 1500;

/**
 * dida 服务端按 end-start-pause 计算 duration。
 * 旧版曾把 pause 加进 end 并传 --pause-duration，导致 TickTick UI 显示的
 * 时间跨度等于 active+pause（隔夜暂停会让 4 分钟专注显示为 8+ 小时）。
 * 现在 end 只加 active，不传 --pause-duration；服务端计算 duration=end-start=active。
 * 暂停时长仍保留在 note 文本中，不影响信息完整性。
 */
export function buildDidaFocusTiming(input: {
  startedAt: number;
  activeElapsedMs: number;
  pauseElapsedMs: number;
}): DidaFocusTiming {
  if (!Number.isFinite(input.startedAt)) throw new Error('专注开始时间无效');
  if (!Number.isFinite(input.activeElapsedMs) || input.activeElapsedMs <= 0) {
    throw new Error('专注时长无效');
  }
  const expectedDurationMs = Math.max(1000, Math.round(input.activeElapsedMs));
  const startMs = Math.round(input.startedAt);
  const endMs = startMs + expectedDurationMs;
  return {
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    startMs,
    endMs,
    expectedDurationMs,
    durationSec: Math.max(1, Math.round(expectedDurationMs / 1000)),
    pauseDurationSec: 0,
  };
}

/** 从 dida focus list/get 结果读取云端有效专注时长（毫秒）。 */
export function getDidaCloudFocusDurationMs(record: DidaCloudFocusRecord): number | null {
  const rawDuration = Number(record.duration);
  if (Number.isFinite(rawDuration) && rawDuration >= 0) return Math.round(rawDuration);

  const startMs = record.startTime ? Date.parse(record.startTime) : Number.NaN;
  const endMs = record.endTime ? Date.parse(record.endTime) : Number.NaN;
  const pauseSec = Number(record.pauseDuration ?? 0);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(pauseSec)) {
    return null;
  }
  return Math.max(0, Math.round(endMs - startMs - Math.max(0, pauseSec) * 1000));
}

/** duration 未知时返回 null，避免为了无法验证的差异破坏性重建。 */
export function didaFocusDurationMatches(
  record: DidaCloudFocusRecord,
  expectedDurationMs: number,
  toleranceMs = DIDA_FOCUS_DURATION_TOLERANCE_MS,
): boolean | null {
  const actualDurationMs = getDidaCloudFocusDurationMs(record);
  if (actualDurationMs === null) return null;
  return Math.abs(actualDurationMs - expectedDurationMs) <= Math.max(0, toleranceMs);
}

export type DidaFocusReconciliationPlan =
  | { action: 'create'; markerMatches: [] }
  | {
      action: 'keep';
      keeper: DidaCloudFocusRecord;
      duplicates: DidaCloudFocusRecord[];
      durationVerified: boolean;
      markerMatches: DidaCloudFocusRecord[];
    }
  | {
      action: 'rebuild';
      stale: DidaCloudFocusRecord[];
      markerMatches: DidaCloudFocusRecord[];
    };

/**
 * 对同一 marker 的云端记录作纯决策：正确记录直接复用；旧版错误时安全重建；
 * duration 不可验证时宁可复用也不破坏用户数据。
 */
export function planDidaFocusReconciliation(
  records: DidaCloudFocusRecord[],
  marker: string,
  expectedDurationMs: number,
): DidaFocusReconciliationPlan {
  const markerMatches = records.filter((focus) => (focus.note ?? '').includes(marker));
  if (markerMatches.length === 0) return { action: 'create', markerMatches: [] };

  const verified = markerMatches.find(
    (focus) => didaFocusDurationMatches(focus, expectedDurationMs) === true,
  );
  const unknown = markerMatches.find(
    (focus) => didaFocusDurationMatches(focus, expectedDurationMs) === null,
  );
  const keeper = verified ?? unknown;
  if (keeper) {
    return {
      action: 'keep',
      keeper,
      // 只有已经验证 keeper 正确时才收敛重复记录；未知数据不做破坏性清理。
      duplicates: verified ? markerMatches.filter((focus) => focus.id !== keeper.id) : [],
      durationVerified: !!verified,
      markerMatches,
    };
  }

  return { action: 'rebuild', stale: markerMatches, markerMatches };
}

function truncate(s: string, n = 2000): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + `...(截断，共 ${s.length} 字符)` : s;
}

function maskSecret(s: string): string {
  return s.replace(/token=[^&\s"]+/gi, 'token=***');
}

/** 自动探测本地可用的滴答清单 CLI 命令；探测到 dida 时自动迁移旧 ticktick 模板 */
export async function detectCli(): Promise<CliDetectResult> {
  const cfg = getConfig();

  // GUI/开机启动进程常常没有继承用户 npm PATH。先按手动配置、用户目录下的
  // npm 全局目录和 dida 包真实入口解析，再把 PATH 中的裸命令作为最后兜底。
  const didaTarget = resolveDidaExecTarget(cfg.executable);
  const versionResult = enforceDidaOutputPolicy(
    await execFileWithDiagnose(
      didaTarget.file,
      [...didaTarget.argsPrefix, '--version'],
      5000,
      'na',
    ),
  );
  if (versionResult.record.status === 'success') {
    const helpResult = enforceDidaOutputPolicy(
      await execFileWithDiagnose(didaTarget.file, [...didaTarget.argsPrefix, '--help'], 5000, 'na'),
    );
    const helpOutput =
      helpResult.record.status === 'success' ? helpResult.stdout.slice(0, 800) : undefined;
    logger.info('cli', `detected CLI: dida at ${didaTarget.executablePath}`);

    const cur = getSettings();
    if (templatesContainTicktick(cur.ticktickCli) || hasLegacyDidaAppendTemplate(cur.ticktickCli)) {
      logger.info('cli', 'auto-migrating stale CLI templates -> dida templates');
      applyDidaDefaults();
    }

    return {
      found: true,
      executable: 'dida',
      executablePath: didaTarget.executablePath,
      candidates: { cmd: 'dida', found: true },
      helpOutput,
    };
  }

  // 兼容历史 ticktick CLI 配置。这里同样用 execFile，不经 shell；dida 已在上面
  // 走过完整的无 PATH 解析，因此不再重复探测。
  for (const cmd of CANDIDATE_CMDS.filter((candidate) => candidate !== 'dida')) {
    const result = await execFileWithDiagnose(cmd, ['--help'], 5000, 'na');
    if (result.record.status !== 'success') continue;
    logger.info('cli', `detected CLI: ${cmd}`);
    return {
      found: true,
      executable: cmd,
      executablePath: cmd,
      candidates: { cmd, found: true },
      helpOutput: result.stdout.slice(0, 800),
    };
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
 * 把设置中的命令模板拆成 executable + argv。只处理引号/空白，不允许管道、重定向
 * 等 shell 语义；dida 的所有调用最终都会交给 execFile 参数数组。
 */
export function splitCommandLine(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let tokenStarted = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (ch === '\\' && command[i + 1] === quote) {
        current += quote;
        i += 1;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (tokenStarted) {
        args.push(current);
        current = '';
        tokenStarted = false;
      }
      continue;
    }
    current += ch;
    tokenStarted = true;
  }

  if (quote) throw new Error('CLI 命令包含未闭合的引号');
  if (tokenStarted) args.push(current);
  if (args.some((arg) => /^(?:\||\|\||&&|>|>>|<)$/.test(arg))) {
    throw new Error('CLI 命令模板不支持管道、重定向或命令串联');
  }
  return args;
}

function executableBasename(executable: string): string {
  return path.win32.basename(executable).toLowerCase();
}

function isDidaExecutable(executable: string): boolean {
  const basename = executableBasename(executable);
  return (
    basename === 'dida' ||
    basename === 'dida.cmd' ||
    basename === 'dida.exe' ||
    basename === 'dida.ps1' ||
    /(?:^|[\\/])@suibiji[\\/]dida-cli[\\/]/i.test(executable)
  );
}

function isDidaCommand(command: string): boolean {
  try {
    const [executable] = splitCommandLine(command);
    return !!executable && isDidaExecutable(executable);
  } catch {
    return false;
  }
}

function isDidaConfig(cfg: TickTickCliConfig): boolean {
  return (
    (!!cfg.executable && isDidaExecutable(cfg.executable)) ||
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

/**
 * dida 的 `task update --items` 会用整个数组覆盖父任务 checklist。必须原样保留每个
 * item 的 completedTime、日期、提醒以及 CLI 尚未建模的字段，只覆盖目标项 status。
 */
export function buildDidaChecklistItemsWithCompletion(
  rawItems: unknown[],
  childId: string,
  completed: boolean,
): unknown[] {
  const normalizedChildId = normalizeTaskId(childId);
  return rawItems.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const item = value as Record<string, unknown>;
    const itemId = item.externalId ?? item.id;
    if (itemId == null || String(itemId) !== normalizedChildId) return value;
    if (completed) {
      // 完成时只设置 status=2。completedTime 若服务端需要会自行生成；客户端不伪造时间。
      return { ...item, status: 2 };
    }
    // 恢复未完成必须同时清掉旧 completedTime，否则 dida/本地归一化仍会把它判为已完成。
    return { ...item, status: 0, completedTime: null };
  });
}

/** 兼容已有测试/调用点。 */
export function buildCompletedDidaChecklistItems(rawItems: unknown[], childId: string): unknown[] {
  return buildDidaChecklistItemsWithCompletion(rawItems, childId, true);
}

function normalizeTaskId(taskId: string): string {
  return taskId.replace(/^ticktick:/, '');
}

interface CachedTaskMeta {
  parentId?: string | null;
  completedAt?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}

function nullableTimestamp(value: unknown): number | null {
  if (value == null || value === '') return null;
  const timestamp = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseCachedMeta(rawJson: string | null): CachedTaskMeta {
  if (!rawJson) return {};
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    return {
      parentId: parsed.parentId == null ? null : String(parsed.parentId),
      completedAt: nullableTimestamp(parsed.completedAt),
      createdAt: nullableTimestamp(parsed.createdAt),
      updatedAt: nullableTimestamp(parsed.updatedAt),
    };
  } catch {
    return {};
  }
}

export function normalizeCompletedDays(value: number | undefined): number {
  if (!Number.isFinite(value)) return 30;
  return Math.min(3650, Math.max(1, Math.floor(value as number)));
}

export function isUndefinedCliOutput(stdout: string): boolean {
  return stdout.trim() === 'undefined';
}

type CliExecResult = { stdout: string; stderr: string; record: CliExecRecord };

/** dida 偶尔会以退出码 0 输出 `undefined`；这不是成功，必须进入重试/诊断路径。 */
function enforceDidaOutputPolicy(result: CliExecResult): CliExecResult {
  if (result.record.status !== 'success' || !isUndefinedCliOutput(result.stdout)) return result;
  result.record.status = 'failed';
  result.record.error = 'dida 返回 undefined';
  logger.error('cli', 'dida returned undefined with exit code 0', {
    command: result.record.command,
  });
  return result;
}

export interface DidaExecTarget {
  /** 实际传给 execFile 的程序。 */
  file: string;
  /** dida 子命令之前的固定参数（例如真实 JS 入口）。 */
  argsPrefix: string[];
  /** 供诊断 UI 展示的 dida shim/脚本真实路径。 */
  executablePath: string;
  kind: 'node-script' | 'cmd-shim' | 'powershell-shim' | 'executable' | 'path-command';
}

export interface DidaExecResolverOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: string;
  fileExists?: (candidate: string) => boolean;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const direct = env[name];
  if (direct) return direct;
  const found = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase());
  return found ? env[found] : undefined;
}

function expandExecutablePath(value: string, env: NodeJS.ProcessEnv, homedir: string): string {
  let expanded = value.trim();
  expanded = expanded.replace(/%([^%]+)%/g, (whole, name: string) => envValue(env, name) ?? whole);
  if (expanded === '~') expanded = homedir;
  else if (expanded.startsWith('~\\') || expanded.startsWith('~/')) {
    expanded = path.join(homedir, expanded.slice(2));
  }
  return expanded;
}

function findNodeExecutableForDida(
  options: Required<Pick<DidaExecResolverOptions, 'env' | 'platform' | 'homedir' | 'fileExists'>>,
): string | null {
  const { env, platform, homedir, fileExists } = options;
  const candidates = [
    envValue(env, 'NODE'),
    envValue(env, 'NVM_SYMLINK')
      ? path.join(
          envValue(env, 'NVM_SYMLINK') as string,
          platform === 'win32' ? 'node.exe' : 'node',
        )
      : undefined,
    envValue(env, 'ProgramFiles')
      ? path.join(envValue(env, 'ProgramFiles') as string, 'nodejs', 'node.exe')
      : undefined,
    envValue(env, 'ProgramFiles(x86)')
      ? path.join(envValue(env, 'ProgramFiles(x86)') as string, 'nodejs', 'node.exe')
      : undefined,
    platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : undefined,
    platform === 'win32' ? 'C:\\Program Files (x86)\\nodejs\\node.exe' : undefined,
    platform === 'win32'
      ? path.join(homedir, 'scoop', 'apps', 'nodejs-lts', 'current', 'node.exe')
      : undefined,
    platform === 'win32'
      ? path.join(homedir, 'scoop', 'apps', 'nodejs', 'current', 'node.exe')
      : undefined,
  ].filter((candidate): candidate is string => !!candidate);

  for (const candidate of candidates) {
    try {
      if (fileExists(candidate)) return candidate;
    } catch {
      // 继续检查其他候选。
    }
  }
  return platform === 'win32' ? null : 'node';
}

function makeTargetFromCandidate(
  candidate: string,
  options: Required<Pick<DidaExecResolverOptions, 'env' | 'platform' | 'homedir' | 'fileExists'>>,
): DidaExecTarget | null {
  const { env, platform, fileExists } = options;
  const expanded = expandExecutablePath(candidate, env, options.homedir);
  const extension = path.extname(expanded).toLowerCase();

  try {
    if (!fileExists(expanded)) return null;
  } catch {
    return null;
  }

  const packageScript = path.join(
    path.dirname(expanded),
    'node_modules',
    '@suibiji',
    'dida-cli',
    'dist',
    'index.js',
  );
  const nodeExe = findNodeExecutableForDida(options);

  if (
    (extension === '.cmd' || extension === '.bat' || executableBasename(expanded) === 'dida') &&
    fileExists(packageScript) &&
    nodeExe
  ) {
    return {
      file: nodeExe,
      argsPrefix: [packageScript],
      executablePath: packageScript,
      kind: 'node-script',
    };
  }
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    if (!nodeExe) return null;
    return {
      file: nodeExe,
      argsPrefix: [expanded],
      executablePath: expanded,
      kind: 'node-script',
    };
  }
  if (platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    return {
      file: envValue(env, 'COMSPEC') || 'cmd.exe',
      argsPrefix: ['/d', '/s', '/c', expanded],
      executablePath: expanded,
      kind: 'cmd-shim',
    };
  }
  if (platform === 'win32' && extension === '.ps1') {
    return {
      file: 'powershell.exe',
      argsPrefix: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', expanded],
      executablePath: expanded,
      kind: 'powershell-shim',
    };
  }
  return { file: expanded, argsPrefix: [], executablePath: expanded, kind: 'executable' };
}

/**
 * 解析 dida 的可执行目标。优先顺序：手动 executable -> npm 包真实 JS -> npm shim
 * -> PATH 裸命令。Windows 用户目录由 USERPROFILE/homedir 推导，不要求 APPDATA 存在。
 */
export function resolveDidaExecTarget(
  configuredExecutable = '',
  resolverOptions: DidaExecResolverOptions = {},
): DidaExecTarget {
  const env = resolverOptions.env ?? process.env;
  const platform = resolverOptions.platform ?? process.platform;
  const homedir = resolverOptions.homedir ?? os.homedir();
  const fileExists = resolverOptions.fileExists ?? fs.existsSync;
  const options = { env, platform, homedir, fileExists };

  const configured = expandExecutablePath(configuredExecutable, env, homedir);
  const configuredParts = configured ? splitCommandLine(configured) : [];
  const [configuredFile, ...configuredArgs] = configuredParts;
  if (configured) {
    // executable 设置框通常保存不带引号的完整 Windows 路径，其中可能包含空格。
    const directFullPath = makeTargetFromCandidate(configured, options);
    if (directFullPath) return directFullPath;

    const configuredScript = configuredArgs[0];
    if (
      configuredFile &&
      configuredScript &&
      /^node(?:\.exe)?$/i.test(executableBasename(configuredFile)) &&
      /\.(?:c|m)?js$/i.test(configuredScript) &&
      fileExists(configuredScript)
    ) {
      return {
        file: configuredFile,
        argsPrefix: configuredArgs,
        executablePath: configuredScript,
        kind: 'node-script',
      };
    }
    if (configuredFile && !/^(?:dida|dida\.cmd|dida\.exe|dida\.ps1)$/i.test(configuredFile)) {
      const direct = makeTargetFromCandidate(configuredFile, options);
      if (direct) {
        direct.argsPrefix.push(...configuredArgs);
        return direct;
      }
    }

    // 显式绝对路径或自定义命令必须优先于自动探测。只有裸 dida/dida.cmd 等
    // 通用别名才继续解析用户 npm 目录，以修复 GUI/开机启动进程缺 PATH 的场景。
    const isExplicitPath =
      platform === 'win32'
        ? path.win32.isAbsolute(configuredFile ?? '')
        : path.posix.isAbsolute(configuredFile ?? '');
    const isBareDidaAlias = /^(?:dida|dida\.cmd|dida\.exe|dida\.ps1)$/i.test(configuredFile ?? '');
    if (configuredFile && (isExplicitPath || !isBareDidaAlias)) {
      return {
        file: configuredFile,
        argsPrefix: configuredArgs,
        executablePath: configuredFile,
        kind: 'path-command',
      };
    }
  }

  const npmRoots = new Set<string>();
  const appData = envValue(env, 'APPDATA');
  const userProfile = envValue(env, 'USERPROFILE');
  const npmPrefix = envValue(env, 'NPM_CONFIG_PREFIX');
  if (appData) npmRoots.add(path.join(appData, 'npm'));
  if (userProfile) npmRoots.add(path.join(userProfile, 'AppData', 'Roaming', 'npm'));
  if (homedir) npmRoots.add(path.join(homedir, 'AppData', 'Roaming', 'npm'));
  if (npmPrefix) npmRoots.add(npmPrefix);

  for (const npmRoot of npmRoots) {
    const candidates = [
      path.join(npmRoot, 'node_modules', '@suibiji', 'dida-cli', 'dist', 'index.js'),
      path.join(npmRoot, platform === 'win32' ? 'dida.cmd' : 'dida'),
      path.join(npmRoot, platform === 'win32' ? 'dida.exe' : 'dida'),
    ];
    for (const candidate of candidates) {
      const target = makeTargetFromCandidate(candidate, options);
      if (target) {
        // 保留手动裸命令后附加的全局参数，例如 `dida --profile work`。
        target.argsPrefix.push(...configuredArgs);
        return target;
      }
    }
  }

  if (configuredFile) {
    return {
      file: configuredFile,
      argsPrefix: configuredArgs,
      executablePath: configuredFile,
      kind: 'path-command',
    };
  }
  return { file: 'dida', argsPrefix: [], executablePath: 'dida', kind: 'path-command' };
}

async function execDidaFileWithDiagnose(
  args: string[],
  timeoutMs: number,
  parseResult: 'success' | 'failed' | 'na' = 'na',
  configuredExecutable = getConfig().executable,
): Promise<{ stdout: string; stderr: string; record: CliExecRecord }> {
  const target = resolveDidaExecTarget(configuredExecutable);
  return enforceDidaOutputPolicy(
    await execFileWithDiagnose(
      target.file,
      [...target.argsPrefix, ...args],
      timeoutMs,
      parseResult,
    ),
  );
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
  try {
    const [executable, ...args] = splitCommandLine(command);
    if (!executable) throw new Error('CLI 命令为空');
    if (isDidaExecutable(executable)) {
      const configured = getConfig().executable.trim() || executable;
      return execDidaFileWithDiagnose(args, timeoutMs, parseResult, configured);
    }
    return execFileWithDiagnose(executable, args, timeoutMs, parseResult);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    const record: CliExecRecord = {
      command: maskSecret(command),
      cwd: process.cwd(),
      timeoutMs,
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      status: 'failed',
      parseResult,
      error,
    };
    logger.error('cli', 'command parse failed', { command: record.command, error });
    return { stdout: '', stderr: '', record };
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
  const executable = detect.executable || cfg.executable?.trim() || 'dida';
  const executablePath = detect.executablePath || cfg.executable?.trim() || '';
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
    const r = await execDidaFileWithDiagnose(['--version'], 5000, 'na', cfg.executable);
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
    const r = await execDidaFileWithDiagnose(['auth', 'status'], 5000, 'na', cfg.executable);
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
  private readonly rawTaskCacheTtlMs: number;
  private readonly now: () => number;
  private readonly rawTaskCache = new Map<
    string,
    { tasks: RawDidaTask[]; expiresAt: number; generation: number }
  >();
  private readonly rawTaskRequests = new Map<string, Promise<RawDidaTask[]>>();
  private readonly forcedRawTaskRequests = new Map<string, Promise<RawDidaTask[]>>();
  private rawTaskCacheGeneration = 0;

  constructor(options: TickTickCliProviderOptions = {}) {
    const configuredTtl = options.rawTaskCacheTtlMs ?? DIDA_RAW_TASK_CACHE_TTL_MS;
    this.rawTaskCacheTtlMs = Number.isFinite(configuredTtl)
      ? Math.max(0, configuredTtl)
      : DIDA_RAW_TASK_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

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
    if (isDidaConfig(cfg) && projectId) {
      const { stdout, record } = await execDidaFileWithDiagnose(
        ['task', 'filter', '--projects', projectId, '--json'],
        cfg.timeoutMs,
        'na',
      );
      if (record.status !== 'success') {
        throw new Error(`CLI 任务列表失败：${record.error ?? record.stderr.slice(0, 200)}`);
      }
      const parsed = parseJson<unknown[]>(stdout, record);
      if (!parsed.ok) throw new Error(`CLI 任务列表不是 JSON：${parsed.raw.slice(0, 200)}`);
      const tasks = normalizeTasks(parsed.data);
      cacheTasks(tasks);
      return tasks;
    }
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

  /**
   * 工作台默认只读取活动任务；仅在 UI 明确查看完成历史时读取限定时间窗。
   * 这样不会因为账号多年历史而阻塞 Electron 主进程和任务渲染。
   */
  async listWorkspaceTasks(
    projectId?: string,
    options: TaskWorkspaceRefreshOptions = {},
  ): Promise<Task[]> {
    const cfg = getConfig();
    if (!isDidaConfig(cfg)) return this.listTasks(projectId);
    const activeTasks = await this.listRawDidaTasks(projectId, options.force === true);
    if (!options.includeCompleted) {
      return normalizeTasks(activeTasks);
    }

    // dida 0.1.10 的 filter 只可靠返回活动任务；已完成普通任务从 completed 单独读取。
    // 活动任务先写且不允许历史端点覆盖，避免恢复后的状态被短暂旧值覆盖。
    const completedTasks = await this.listCompletedRawDidaTasks(projectId, options.completedDays);
    const merged = new Map<string, RawDidaTask>();
    for (const rawTask of activeTasks) {
      const id = rawTaskId(rawTask);
      if (id) merged.set(id, rawTask);
    }
    for (const rawTask of completedTasks) {
      const id = rawTaskId(rawTask);
      if (id && !merged.has(id)) merged.set(id, rawTask);
    }
    const tasks = normalizeTasks([...merged.values()]);
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

  private async listRawDidaTasks(projectId?: string, force = false): Promise<RawDidaTask[]> {
    const cacheKey = projectId ?? '__all__';
    if (force) {
      const forcedPending = this.forcedRawTaskRequests.get(cacheKey);
      if (forcedPending) return forcedPending;
      this.invalidateRawTaskCache();
    }
    const cached = this.rawTaskCache.get(cacheKey);
    if (
      cached &&
      cached.generation === this.rawTaskCacheGeneration &&
      cached.expiresAt > this.now()
    ) {
      return cached.tasks;
    }

    const pending = this.rawTaskRequests.get(cacheKey);
    if (pending) return pending;

    const generation = this.rawTaskCacheGeneration;
    let request: Promise<RawDidaTask[]>;
    request = (async () => {
      const cfg = getConfig();
      const args = ['task', 'filter'];
      if (projectId) args.push('--projects', projectId);
      args.push('--status', '0', '--json');
      const { stdout, record } = await execDidaFileWithDiagnose(args, cfg.timeoutMs, 'na');
      if (record.status !== 'success') {
        throw new Error(`CLI 任务列表失败：${record.error ?? record.stderr.slice(0, 200)}`);
      }
      const parsed = parseJson<unknown[]>(stdout, record);
      if (!parsed.ok) {
        throw new Error(`CLI 任务列表不是 JSON：${parsed.raw.slice(0, 200)}`);
      }
      const rawTasks = parsed.data.map(asRawTask).filter((task): task is RawDidaTask => !!task);
      if (generation === this.rawTaskCacheGeneration) {
        cacheTasks(normalizeTasks(rawTasks));
        if (this.rawTaskCacheTtlMs > 0) {
          this.rawTaskCache.set(cacheKey, {
            tasks: rawTasks,
            expiresAt: this.now() + this.rawTaskCacheTtlMs,
            generation,
          });
        }
      }
      return rawTasks;
    })().finally(() => {
      if (this.rawTaskRequests.get(cacheKey) === request) {
        this.rawTaskRequests.delete(cacheKey);
      }
      if (this.forcedRawTaskRequests.get(cacheKey) === request) {
        this.forcedRawTaskRequests.delete(cacheKey);
      }
    });
    this.rawTaskRequests.set(cacheKey, request);
    if (force) this.forcedRawTaskRequests.set(cacheKey, request);
    return request;
  }

  private invalidateRawTaskCache(): void {
    this.rawTaskCacheGeneration += 1;
    this.rawTaskCache.clear();
    // Do not let a request started before a task mutation satisfy a later read. It may still
    // finish, but its generation guard prevents it from repopulating the cache.
    this.rawTaskRequests.clear();
    this.forcedRawTaskRequests.clear();
  }

  private async listCompletedRawDidaTasks(
    projectId?: string,
    completedDays?: number,
  ): Promise<RawDidaTask[]> {
    const cfg = getConfig();
    const args = ['task', 'completed'];
    if (projectId) args.push('--projects', projectId);
    const days = normalizeCompletedDays(completedDays);
    const endAt = Date.now();
    const startAt = endAt - days * 24 * 60 * 60 * 1000;
    args.push('--start-date', new Date(startAt).toISOString());
    args.push('--end-date', new Date(endAt).toISOString());
    args.push('--json');
    const { stdout, record } = await execDidaFileWithDiagnose(args, cfg.timeoutMs, 'na');
    if (record.status !== 'success') {
      throw new Error(`CLI 已完成任务列表失败：${record.error ?? record.stderr.slice(0, 200)}`);
    }
    const parsed = parseJson<unknown[]>(stdout, record);
    if (!parsed.ok) {
      throw new Error(`CLI 已完成任务列表不是 JSON：${parsed.raw.slice(0, 200)}`);
    }
    return parsed.data.map(asRawTask).filter((task): task is RawDidaTask => !!task);
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
    // 任务上下文关系到 focus create 最终绑定普通任务还是 checklist 父任务。
    // 网络、限流、超时或解析错误时不能用“null”降级，否则调用方会把仍然存在的任务
    // 当成已删除，并创建一条无关联云专注。错误必须原样进入同步队列重试。
    const rawTasks = await this.listRawDidaTasks();
    const fromRaw = this.findContextInRawTasks(rawTasks, taskId);
    if (fromRaw) return fromRaw;

    // filter 列表中找不到此任务，但这不意味着任务已删除：
    // dida task filter 可能不返回归档/共享/特定项目的任务。
    // 若有缓存，用 dida task get 二次确认任务是否仍然存在。
    if (cached) {
      const cachedParentId = parseCachedMeta(cached.rawJson).parentId;
      if (cachedParentId) {
        const parentCache = this.getCachedTask(cachedParentId);
        const parentProjectId = cached.projectId ?? parentCache?.projectId ?? '';
        const verifiedParent = await this.verifyDidaTaskExists(
          parentCache?.externalId ?? cachedParentId,
          parentProjectId,
        );
        if (!verifiedParent) {
          logger.warn('cli', 'cached checklist parent no longer exists', {
            taskId,
            parentId: cachedParentId,
          });
          return null;
        }
        const nested = this.findContextInRawTasks([verifiedParent.rawTask], taskId);
        if (nested) return nested;

        // 少数 dida 版本的 task get 不回传 items；缓存中的 parentId 仍是明确关系，
        // 云专注必须绑定父任务，不能错误地 task get(childId) 或降级为无关联。
        const childTask = cacheToTask(cached);
        childTask.parentId = cachedParentId;
        return {
          task: childTask,
          parentTask: verifiedParent.task,
          rawTask: { id: childTask.externalId, title: childTask.title },
          rawParent: verifiedParent.rawTask,
          isChecklistItem: true,
        };
      }
      const verified = await this.verifyDidaTaskExists(cached.externalId, cached.projectId ?? '');
      if (verified) {
        logger.info('cli', 'task not in filter list but verified via task get', { taskId });
        return verified;
      }
      // 只有 task get 明确返回 not-found 才会到这里；其他错误会抛出。
      logger.warn('cli', 'task not found in filter nor via task get, likely deleted', { taskId });
      return null;
    }
    logger.warn('cli', 'task not found in dida task list and no cache available', { taskId });
    return null;
  }

  /** 用 dida task get 二次确认任务是否仍然存在。
   *  filter 可能不返回归档/共享项目的任务，但 task get 可以直接按 id 获取。
   *  返回 DidaTaskContext（任务存在）或 null（服务端明确返回不存在）。
   *  429、超时、undefined 和解析错误均抛出，让同步队列稍后重试。 */
  private async verifyDidaTaskExists(
    externalId: string,
    projectId: string,
  ): Promise<DidaTaskContext | null> {
    const cfg = getConfig();
    if (!projectId) {
      logger.warn('cli', 'verifyDidaTaskExists skipped: no projectId in cache', { externalId });
      throw new Error('缺少清单 ID，无法确认滴答任务是否仍然存在');
    }
    try {
      const { stdout, record } = await execDidaFileWithDiagnose(
        ['task', 'get', projectId, externalId, '--json'],
        cfg.timeoutMs,
        'na',
      );
      if (record.status !== 'success') {
        const detail = [record.stdout, record.stderr, record.error].filter(Boolean).join('\n');
        if (/\b404\b|not[ -]?found|任务不存在|找不到(?:该)?任务/i.test(detail)) {
          return null;
        }
        logger.warn('cli', 'verifyDidaTaskExists: task get failed', {
          externalId,
          projectId,
          status: record.status,
        });
        throw new Error(`CLI 读取任务失败：${record.error ?? record.stderr.slice(0, 200)}`);
      }
      const parsed = parseJson<unknown>(stdout, record);
      if (!parsed.ok) {
        logger.warn('cli', 'verifyDidaTaskExists: task get returned non-JSON', { externalId });
        throw new Error(`CLI 任务详情输出不是 JSON：${parsed.raw.slice(0, 200)}`);
      }
      const rawTask = asRawTask(parsed.data);
      if (!rawTask) throw new Error('CLI 任务详情返回格式异常');
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
      throw err;
    }
  }

  async getTask(taskId: string): Promise<Task | null> {
    const cfg = getConfig();
    const cached = this.getCachedTask(taskId);
    if (isDidaConfig(cfg)) {
      const context = await this.resolveDidaTaskContext(taskId);
      if (context) return context.task;
      // dida 配置下 null 只表示任务已明确不存在；临时 CLI 错误会直接抛出。
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
    if (!task) {
      logger.warn('cli', 'task not found in dida, comment sync failed', { taskId });
      throw new Error('滴答任务不存在或无法读取，未写入同步记录。请刷新任务列表后重新关联。');
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
  ): Promise<DidaCloudFocusRecord[]> {
    const fromIso = new Date(fromMs).toISOString();
    const toIso = new Date(toMs).toISOString();
    const r = await execDidaFileWithDiagnose(
      ['focus', 'list', '--from', fromIso, '--to', toIso, '--type', '1', '--json'],
      Math.max(cfg.timeoutMs, 15000),
      'na',
    );
    if (r.record.status !== 'success') {
      throw new Error(
        `CLI 读取云端专注记录失败：${r.record.error ?? r.record.stderr.slice(0, 200)}`,
      );
    }
    const parsed = parseJson<unknown[]>(r.stdout, r.record);
    if (!parsed.ok) {
      throw new Error(`CLI 云端专注记录输出不是 JSON：${parsed.raw.slice(0, 200)}`);
    }
    return parsed.data
      .filter(
        (item): item is DidaCloudFocusRecord =>
          !!item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string',
      )
      .map((item) => item as DidaCloudFocusRecord);
  }

  private async createDidaFocusRecord(
    externalTaskId: string | null,
    record: FocusRecord,
    cfg: TickTickCliConfig,
  ): Promise<string> {
    if (!record.endedAt) {
      throw new Error('专注记录未结束，无法同步到云端');
    }
    const timing = buildDidaFocusTiming(record);
    const marker = getFocusRecordMarker(record);
    const noteText = record.taskTitle
      ? `${formatFocusRecord(record)}\n${marker}`
      : `${formatFocusRecord(record)}\n${marker}`;

    const args = ['focus', 'create', '--type', '1'];
    // task-id 可选：任务已删除时不传，创建无关联的专注记录
    if (externalTaskId) {
      args.push('--task-id', externalTaskId);
    }
    args.push(
      '--note',
      noteText,
      '--start-time',
      timing.startTime,
      '--end-time',
      timing.endTime,
      '--duration',
      String(timing.durationSec),
      '--json',
    );

    const r = await execDidaFileWithDiagnose(args, Math.max(cfg.timeoutMs, 15000), 'na');
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
      throw new Error(
        `CLI 创建专注记录返回格式异常：${parsed.ok ? '缺少 id 字段' : parsed.raw.slice(0, 200)}`,
      );
    }
    return parsed.data.id;
  }

  private async deleteDidaFocusRecordById(focusId: string, cfg: TickTickCliConfig): Promise<void> {
    const { record } = await execDidaFileWithDiagnose(
      ['focus', 'delete', focusId, '--type', '1', '--json'],
      Math.max(cfg.timeoutMs, 15000),
      'na',
    );
    if (
      record.status === 'failed' &&
      /404|not found/i.test(record.stderr + record.stdout + (record.error ?? ''))
    ) {
      return;
    }
    if (record.status !== 'success') {
      throw new Error(`CLI 删除旧专注记录失败：${record.error ?? record.stderr.slice(0, 200)}`);
    }
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
        // resolveDidaTaskContext 返回 null：任务已明确不存在，创建无关联专注记录。
        logger.warn('cli', 'task not found in dida, creating unassociated focus record', {
          taskId,
        });
      }
    }

    const marker = getFocusRecordMarker(record);
    const timing = buildDidaFocusTiming(record);
    const listFrom = record.startedAt - 60_000;
    const listTo = Math.max(record.endedAt ?? 0, timing.endMs) + 60_000;
    // 去重读取失败时绝不能继续 create，否则网络/限流故障会制造重复云记录。
    const existing = await this.listDidaFocusRecords(listFrom, listTo, cfg);
    const plan = planDidaFocusReconciliation(existing, marker, timing.expectedDurationMs);
    if (plan.action === 'keep') {
      logger.info('cli', 'focus record already exists, skipping', {
        marker,
        focusId: plan.keeper.id,
        durationVerified: plan.durationVerified,
      });
      // 即使跳过也要存储 cloudFocusId，便于后续删除。
      if (record.segmentId) {
        setSegmentCloudFocusId(record.segmentId, plan.keeper.id);
      }
      // 若上一次“先创建替代记录、再删旧记录”在清理阶段中断，这里会保留已验证
      // 正确的一条并收敛重复 marker。duration 未知时不会返回待删除项。
      for (const duplicate of plan.duplicates) {
        await this.deleteDidaFocusRecordById(duplicate.id, cfg);
      }
      return plan.keeper.id;
    }

    if (plan.action === 'rebuild') {
      // 旧版曾把 end 设为 start+active，同时仍传 pause，导致服务端二次扣 pause。
      // 只有 marker 相同且所有记录的 duration 都已确认错误时才重建。先创建正确替代记录，
      // 再删除旧记录：创建失败时旧数据仍在；清理失败时下次运行会识别正确记录并继续收敛。
      logger.warn('cli', 'existing focus duration mismatch, rebuilding safely', {
        marker,
        focusIds: plan.stale.map((focus) => focus.id),
        expectedDurationMs: timing.expectedDurationMs,
        actualDurationMs: plan.stale.map((focus) => getDidaCloudFocusDurationMs(focus)),
      });
      const replacementId = await this.createDidaFocusRecord(externalTaskId, record, cfg);
      if (record.segmentId) setSegmentCloudFocusId(record.segmentId, replacementId);
      for (const stale of plan.stale) {
        await this.deleteDidaFocusRecordById(stale.id, cfg);
      }
      logger.info('cli', 'rebuilt dida focus record with corrected duration', {
        marker,
        replacementId,
        removedFocusIds: plan.stale.map((focus) => focus.id),
      });
      return replacementId;
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

    // 即使已经保存 cloudFocusId，也必须按 marker 查询一次：旧版本和中断恢复可能留下
    // 多条同 marker 记录。查询错误必须抛出，绝不能与“确实没有记录”混为一谈。
    const focusIds = new Set<string>();
    if (seg.cloudFocusId) focusIds.add(seg.cloudFocusId);
    for (const focusId of await this.findCloudFocusIdsByMarker(seg, cfg)) {
      focusIds.add(focusId);
    }

    if (focusIds.size === 0) {
      logger.info('cli', 'deleteFocusRecord: no cloud record found via marker', { segmentId });
      return true;
    }

    for (const focusId of focusIds) {
      await this.deleteDidaFocusRecordById(focusId, cfg);
    }
    // 所有重复记录均确认删除后才能清除本地引用。
    setSegmentCloudFocusId(segmentId, null);
    logger.info('cli', 'deleteFocusRecord: cloud records deleted', {
      segmentId,
      cloudFocusIds: [...focusIds],
    });
    return true;
  }

  /**
   * 通过 marker 在云端专注记录列表中反查全部匹配项。
   * marker 形如 [FocusLink:segment:<segmentId>]，写入专注记录的 note 字段。
   * 查询范围以 segment 起止时间各外扩 1 分钟，覆盖时区/取整误差。
   */
  private async findCloudFocusIdsByMarker(
    seg: FocusSegment,
    cfg: TickTickCliConfig,
  ): Promise<string[]> {
    if (!seg.endedAt) return [];
    const marker = `[FocusLink:segment:${seg.id}]`;
    const listFrom = seg.startedAt - 60_000;
    const listTo = seg.endedAt + 60_000;
    const existing = await this.listDidaFocusRecords(listFrom, listTo, cfg);
    return existing.filter((focus) => (focus.note ?? '').includes(marker)).map((focus) => focus.id);
  }

  async completeTask(task: Task): Promise<void> {
    await this.setTaskCompleted(task, true);
  }

  async setTaskCompleted(task: Task, completed: boolean): Promise<void> {
    const cfg = getConfig();
    const context = isDidaConfig(cfg)
      ? await this.resolveDidaTaskContext(task.externalId || task.id)
      : null;
    if (context?.isChecklistItem) {
      if (context.task.isCompleted === completed) return;
      await this.setDidaChecklistItemCompleted(context, cfg, completed);
      this.invalidateRawTaskCache();
      return;
    }

    if (isDidaConfig(cfg) && !context) {
      throw new Error('滴答任务不存在或已从当前账号移除，请刷新任务列表后重试。');
    }

    if (context?.task.isCompleted === completed) return;

    const taskId = normalizeTaskId(task.externalId || task.id);
    const cachedForTask = this.getCachedTask(taskId);
    const projectId = task.projectId ?? cachedForTask?.projectId ?? context?.task.projectId;
    if (!projectId) {
      throw new Error('缺少清单 ID，无法通过 dida CLI 更新任务状态。请先刷新任务列表。');
    }

    if (!completed) {
      if (!isDidaConfig(cfg)) {
        throw new Error('当前 CLI Provider 不支持恢复普通任务。请切换到 dida CLI 后重试。');
      }
      await this.reopenDidaTask(taskId, projectId, cfg);
      this.invalidateRawTaskCache();
      return;
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
    this.markCachedTaskCompleted(taskId, true);
    this.invalidateRawTaskCache();
    logger.info('cli', 'completed task', { taskId, projectId });
  }

  private async reopenDidaTask(
    taskId: string,
    projectId: string,
    cfg: TickTickCliConfig,
  ): Promise<void> {
    // dida CLI 未来版本可直接暴露 Update Task 的 status 字段；使用 argv 调用以兼容该
    // 能力。当前 CLI 若不认识 --status，会进入下面的明确错误，而不是假装恢复成功。
    const r = await execDidaFileWithDiagnose(
      ['task', 'update', taskId, '--id', taskId, '--project', projectId, '--status', '0', '--json'],
      cfg.timeoutMs,
      'na',
    );
    if (r.record.status !== 'success' || isUndefinedCliOutput(r.stdout)) {
      const detail = (r.record.stderr || r.record.error || r.stdout).trim().slice(0, 300);
      logger.error('cli', 'reopen task failed', detail);
      if (/unknown option\s+['"]?--status|未知选项[^\n]*--status/i.test(detail)) {
        // npm latest dida CLI 尚未暴露 --status；复用它已经安全保存的 token 调 Open API。
        // bridge 内部会 GET -> POST -> GET 验证，任何“接受但未恢复”都会抛错。
        await reopenDidaTaskViaOpenApi(projectId, taskId);
        this.markCachedTaskCompleted(taskId, false);
        logger.info('cli', 'reopened task through dida Open API bridge', { taskId, projectId });
        return;
      }
      throw new Error(
        `CLI 恢复任务失败：${
          isUndefinedCliOutput(r.stdout) ? 'dida 返回 undefined' : detail || '未知错误'
        }`,
      );
    }

    const parsed = parseJson<unknown>(r.stdout, r.record);
    const returnedTask = parsed.ok ? asRawTask(parsed.data) : null;
    let confirmed = returnedTask ? this.rawToTask(returnedTask, null, projectId) : null;
    if (!confirmed || confirmed.isCompleted) {
      const verified = await this.verifyDidaTaskExists(taskId, projectId);
      confirmed = verified?.task ?? null;
    }
    if (!confirmed) {
      throw new Error('dida 未返回恢复后的任务，无法确认云端状态。');
    }
    if (confirmed.isCompleted) {
      await reopenDidaTaskViaOpenApi(projectId, taskId);
    }

    this.markCachedTaskCompleted(taskId, false);
    logger.info('cli', 'reopened task', { taskId, projectId });
  }

  private markCachedTaskCompleted(taskId: string, completed: boolean): void {
    const cachedForTask = this.getCachedTask(taskId);
    if (!cachedForTask) return;
    const changedAt = Date.now();
    const meta = parseCachedMeta(cachedForTask.rawJson);
    cachedForTask.status = completed ? 'completed' : 'pending';
    cachedForTask.rawJson = JSON.stringify({
      ...meta,
      completedAt: completed ? changedAt : null,
      updatedAt: changedAt,
    });
    cachedForTask.updatedAt = changedAt;
    upsertTaskCache(cachedForTask);
  }

  private async setDidaChecklistItemCompleted(
    context: DidaTaskContext,
    cfg: TickTickCliConfig,
    completed: boolean,
  ): Promise<void> {
    const parentId = context.parentTask?.externalId ?? rawTaskId(context.rawParent);
    const projectId = context.parentTask?.projectId;
    const childId = context.task.externalId;
    const rawItems = Array.isArray(context.rawParent?.items) ? context.rawParent.items : [];
    if (!parentId || !projectId || rawItems.length === 0) {
      throw new Error('缺少父任务或清单信息，无法更新 checklist 子项。请先刷新任务列表。');
    }

    const items = buildDidaChecklistItemsWithCompletion(rawItems, childId, completed);
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
      logger.error('cli', 'update checklist item failed', r.record.error ?? r.stdout);
      throw new Error(
        `CLI ${completed ? '完成' : '恢复'} checklist 子项失败：${
          isUndefinedCliOutput(r.stdout)
            ? 'dida 返回 undefined'
            : (r.record.error ?? r.record.stderr.slice(0, 200))
        }`,
      );
    }

    this.markCachedTaskCompleted(childId, completed);
    logger.info('cli', completed ? 'completed checklist item' : 'reopened checklist item', {
      taskId: childId,
      parentId,
      projectId,
    });
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
    // dida 普通任务的显式 status 是权威状态：0=未完成，1=进行中，2=已完成。
    // 恢复普通任务后服务端可能保留历史 completedTime，不能因此把 status=0 判回已完成。
    // checklist 子项存在 status=1 + completedTime 的兼容返回，只有子项才使用该兜底。
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
    const hasExplicitStatus = typeof statusNum === 'number' || typeof statusNum === 'string';
    const explicitlyIncomplete =
      statusNum === 0 || statusNum === '0' || statusNum === 'pending' || statusNum === 'incomplete';
    const checklistCompletionFallback =
      parentId !== undefined && !explicitlyIncomplete && obj.completedTime;
    if (
      !isCompleted &&
      ((!hasExplicitStatus && obj.completedTime) || checklistCompletionFallback)
    ) {
      isCompleted = true;
      if (!statusStr) statusStr = 'completed';
    }
    const completedAt = isCompleted ? nullableTimestamp(obj.completedTime) : null;
    const createdAt = nullableTimestamp(obj.createdTime);
    const updatedAt = nullableTimestamp(obj.modifiedTime);
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
      completedAt,
      createdAt,
      updatedAt,
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
    completedAt: c.status === 'completed' ? (meta.completedAt ?? null) : null,
    createdAt: meta.createdAt ?? null,
    updatedAt: meta.updatedAt ?? null,
  };
}

function cacheTasks(tasks: Task[]): void {
  const now = Date.now();
  const rows = new Map<string, TaskCache>();
  const visit = (list: Task[]) => {
    for (const task of list) {
      const row: TaskCache = {
        id: `ticktick:${task.externalId}`,
        source: 'ticktick',
        externalId: task.externalId,
        projectId: task.projectId,
        title: task.title,
        // checklist 子项在 dida 响应中可能是 status=1 + completedTime；Task 已完成归一化
        // 后必须把语义写进缓存，否则后续只读缓存时会错误显示为未完成。
        status: task.isCompleted ? 'completed' : task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        tags: JSON.stringify(task.tags ?? []),
        content: task.content,
        rawJson: JSON.stringify({
          parentId: task.parentId ?? null,
          completedAt: task.completedAt ?? null,
          createdAt: task.createdAt ?? null,
          updatedAt: task.updatedAt ?? null,
        }),
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(row.id, row);
      if (task.children) visit(task.children);
    }
  };
  visit(tasks);
  upsertTaskCaches([...rows.values()]);
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
