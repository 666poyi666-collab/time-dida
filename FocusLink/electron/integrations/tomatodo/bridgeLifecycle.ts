import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { TomatodoBridgeStatus } from '@shared/ipc/api';
import { logger } from '../../logger.js';
import { probeTomatodoBridge, type TomatodoBridgeProbeResult } from './cloudBridge.js';
import { isTomatodoRunningAsync } from './localDb.js';

interface SpawnedProcess {
  once(event: 'error', listener: (error: Error) => void): unknown;
  unref(): void;
}

export interface TomatodoBridgeLifecycleDependencies {
  probeBridge?: () => Promise<TomatodoBridgeProbeResult>;
  isRunning?: () => Promise<boolean>;
  fileExists?: (candidate: string) => boolean;
  spawnProcess?: (
    executable: string,
    args: string[],
    options: { detached: boolean; stdio: 'ignore'; windowsHide: boolean },
  ) => SpawnedProcess;
  delay?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  platform?: NodeJS.Platform;
}

export interface EnsureTomatodoBridgeOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  dependencies?: TomatodoBridgeLifecycleDependencies;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const direct = env[name];
  if (direct) return direct;
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

/** Standard per-machine and per-user installation locations used by TomaToDo on Windows. */
export function getStandardTomatodoExecutableCandidates(
  dependencies: Pick<TomatodoBridgeLifecycleDependencies, 'env' | 'homedir' | 'platform'> = {},
): string[] {
  const env = dependencies.env ?? process.env;
  const homedir = dependencies.homedir ?? os.homedir();
  const platform = dependencies.platform ?? process.platform;
  if (platform !== 'win32') return [];

  const roots = [
    envValue(env, 'ProgramW6432'),
    envValue(env, 'ProgramFiles'),
    envValue(env, 'ProgramFiles(x86)'),
  ].filter((value): value is string => !!value);
  const candidates = roots.map((root) => path.join(root, 'TomaToDo', 'TomaToDo.exe'));
  const localAppData = envValue(env, 'LOCALAPPDATA') ?? path.join(homedir, 'AppData', 'Local');
  candidates.push(
    path.join(localAppData, 'Programs', 'TomaToDo', 'TomaToDo.exe'),
    path.join(localAppData, 'TomaToDo', 'TomaToDo.exe'),
  );

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveTomatodoExecutable(
  dependencies: Pick<
    TomatodoBridgeLifecycleDependencies,
    'env' | 'homedir' | 'platform' | 'fileExists'
  > = {},
): string | null {
  const fileExists = dependencies.fileExists ?? fs.existsSync;
  for (const candidate of getStandardTomatodoExecutableCandidates(dependencies)) {
    try {
      if (fileExists(candidate)) return candidate;
    } catch {
      // Continue through the remaining standard locations.
    }
  }
  return null;
}

function connectedStatus(executablePath: string | null, launched: boolean): TomatodoBridgeStatus {
  return {
    state: 'connected',
    connected: true,
    running: true,
    installed: true,
    launched,
    ...(executablePath ? { executablePath } : {}),
  };
}

function restartRequiredStatus(executablePath: string | null): TomatodoBridgeStatus {
  return {
    state: 'restart-required',
    connected: false,
    running: true,
    installed: true,
    launched: false,
    ...(executablePath ? { executablePath } : {}),
    error:
      '番茄 Todo 已在普通模式运行。请先正常退出番茄 Todo，再重试；FocusLink 不会强制关闭正在运行的应用。',
  };
}

function notInstalledStatus(): TomatodoBridgeStatus {
  return {
    state: 'not-installed',
    connected: false,
    running: false,
    installed: false,
    launched: false,
    error: '未在标准位置找到番茄 Todo，请先安装番茄 Todo 桌面端。',
  };
}

function resolveDependencies(dependencies: TomatodoBridgeLifecycleDependencies = {}) {
  return {
    probeBridge: dependencies.probeBridge ?? probeTomatodoBridge,
    isRunning: dependencies.isRunning ?? isTomatodoRunningAsync,
    fileExists: dependencies.fileExists ?? fs.existsSync,
    spawnProcess:
      dependencies.spawnProcess ??
      ((executable: string, args: string[], options: Parameters<typeof spawn>[2]) =>
        spawn(executable, args, options) as SpawnedProcess),
    delay:
      dependencies.delay ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    env: dependencies.env ?? process.env,
    homedir: dependencies.homedir ?? os.homedir(),
    platform: dependencies.platform ?? process.platform,
  };
}

/** Return the current bridge state without launching or changing either application. */
export async function getTomatodoBridgeStatus(
  dependencies: TomatodoBridgeLifecycleDependencies = {},
): Promise<TomatodoBridgeStatus> {
  const resolved = resolveDependencies(dependencies);
  const executablePath = resolveTomatodoExecutable(resolved);
  const probe = await resolved.probeBridge();
  if (probe.connected) return connectedStatus(executablePath, false);
  if (await resolved.isRunning()) return restartRequiredStatus(executablePath);
  if (!executablePath) return notInstalledStatus();
  return {
    state: 'stopped',
    connected: false,
    running: false,
    installed: true,
    launched: false,
    executablePath,
  };
}

async function ensureTomatodoBridgeImpl(
  options: EnsureTomatodoBridgeOptions,
): Promise<TomatodoBridgeStatus> {
  const resolved = resolveDependencies(options.dependencies);
  const executablePath = resolveTomatodoExecutable(resolved);
  const initialProbe = await resolved.probeBridge();
  if (initialProbe.connected) return connectedStatus(executablePath, false);
  if (await resolved.isRunning()) return restartRequiredStatus(executablePath);
  if (!executablePath) return notInstalledStatus();

  let launchError: string | undefined;
  try {
    const child = resolved.spawnProcess(
      executablePath,
      ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.once('error', (error) => {
      launchError = error.message;
    });
    child.unref();
  } catch (error) {
    launchError = error instanceof Error ? error.message : String(error);
  }

  if (launchError) {
    return {
      state: 'launch-failed',
      connected: false,
      running: false,
      installed: true,
      launched: false,
      executablePath,
      error: `启动番茄 Todo 同步桥失败：${launchError}`,
    };
  }

  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 12_000);
  const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 250);
  const attempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
  for (let attempt = 0; attempt < attempts; attempt++) {
    await resolved.delay(pollIntervalMs);
    if (launchError) {
      return {
        state: 'launch-failed',
        connected: false,
        running: false,
        installed: true,
        launched: false,
        executablePath,
        error: `启动番茄 Todo 同步桥失败：${launchError}`,
      };
    }
    const probe = await resolved.probeBridge();
    if (probe.connected) {
      logger.info('tomatodoBridge', 'launched verified TomaToDo bridge', { executablePath });
      return connectedStatus(executablePath, true);
    }
  }

  return {
    state: 'launch-timeout',
    connected: false,
    running: await resolved.isRunning(),
    installed: true,
    launched: true,
    executablePath,
    error: '番茄 Todo 已启动，但同步桥未在限定时间内就绪，请稍后重试。',
  };
}

let defaultEnsureInFlight: Promise<TomatodoBridgeStatus> | null = null;

/**
 * Ensure a verified bridge exists. A normally running TomaToDo process is never terminated;
 * callers receive restart-required and can present an explicit, user-controlled recovery step.
 */
export function ensureTomatodoBridge(
  options: EnsureTomatodoBridgeOptions = {},
): Promise<TomatodoBridgeStatus> {
  if (options.dependencies) return ensureTomatodoBridgeImpl(options);
  if (!defaultEnsureInFlight) {
    defaultEnsureInFlight = ensureTomatodoBridgeImpl(options).finally(() => {
      defaultEnsureInFlight = null;
    });
  }
  return defaultEnsureInFlight;
}
