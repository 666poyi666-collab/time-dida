import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RETRYABLE_CODES = new Set(['EACCES', 'EBUSY', 'EAGAIN', 'ENOTEMPTY', 'EPERM']);
const RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 4_000, 8_000];
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const PROTECTED_PROJECT_TEMP_NAMES = new Set(['android-apk-backups', 'device-screens']);
const PROJECT_TEMP_NAME =
  /^(?:release[-_]|v\d|focuslink[-_]|device-screens$|android-apk-backups$|dry-run-focuslink$|.*-smoke\.cjs$)/i;
const EXTERNAL_TEMP_NAME = /^focuslink[-_]/i;
const GENERATED_FILE_NAME = /^(?:\.tmp-|.*-result\.json$)/i;

/** Return metadata only for an existing direct child of an explicitly approved root. */
export function assertSafeDirectChild(target, allowedRoot) {
  const root = path.resolve(allowedRoot);
  const candidate = path.resolve(target);
  if (candidate === root || path.dirname(candidate) !== root) {
    throw new Error(`refusing to clean non-direct child: ${candidate}`);
  }
  const stat = fs.lstatSync(candidate, { throwIfNoEntry: false });
  if (!stat) return null;
  if (stat.isSymbolicLink()) throw new Error(`refusing to clean symbolic link: ${candidate}`);
  return stat;
}

async function inspectTree(target) {
  const stat = await fsp.lstat(target);
  if (stat.isSymbolicLink()) throw new Error(`refusing to traverse symbolic link: ${target}`);
  if (!stat.isDirectory()) return { files: 1, directories: 0, bytes: stat.size };

  let files = 0;
  let directories = 1;
  let bytes = 0;
  const entries = await fsp.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`refusing to traverse symbolic link: ${child}`);
    const summary = await inspectTree(child);
    files += summary.files;
    directories += summary.directories;
    bytes += summary.bytes;
  }
  return { files, directories, bytes };
}

async function makeWritable(target) {
  let stat;
  try {
    stat = await fsp.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink()) return;
  try {
    await fsp.chmod(target, stat.isDirectory() ? 0o700 : 0o600);
  } catch (error) {
    if (!['EINVAL', 'ENOSYS', 'EPERM'].includes(error?.code)) throw error;
  }
  if (!stat.isDirectory()) return;
  const entries = await fsp.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) await makeWritable(path.join(target, entry.name));
  }
}

/** Remove a target with bounded Windows lock/readonly retries and postcondition verification. */
export async function removePathWithRetry(target, options = {}) {
  const maxAttempts = options.maxAttempts ?? RETRY_DELAYS_MS.length + 1;
  const allowedRoot = options.allowedRoot ?? path.dirname(path.resolve(target));
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const stat = assertSafeDirectChild(target, allowedRoot);
      if (!stat) return { removed: true, attempts: attempt + 1 };
      await makeWritable(target);
      await fsp.rm(target, { recursive: true, force: true, maxRetries: 0 });
      if (fs.existsSync(target)) throw new Error(`cleanup postcondition failed: ${target}`);
      return { removed: true, attempts: attempt + 1 };
    } catch (error) {
      if (error?.code === 'ENOENT') return { removed: true, attempts: attempt + 1 };
      lastError = error;
      if (!RETRYABLE_CODES.has(error?.code) || attempt + 1 >= maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt] ?? 8_000));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`cleanup failed after bounded retries: ${target}: ${message}`);
}

function isOldEnough(stat, now, maxAgeMs) {
  return now - stat.mtimeMs >= maxAgeMs;
}

function addCandidate(candidates, target, root, reason, now, maxAgeMs) {
  const stat = assertSafeDirectChild(target, root);
  if (!stat || !isOldEnough(stat, now, maxAgeMs)) return;
  candidates.push({ path: path.resolve(target), root: path.resolve(root), reason, stat });
}

function listDirectChildren(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).map((entry) => ({
    entry,
    path: path.join(root, entry.name),
  }));
}

/** Build a conservative cleanup plan; only generated fixture paths are discovered. */
export function buildCleanupPlan({
  focuslinkRoot,
  workspaceRoot,
  externalRoots = [],
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
}) {
  const candidates = [];
  const projectTempRoot = path.join(workspaceRoot, '.tmp');
  for (const { entry, path: target } of listDirectChildren(projectTempRoot)) {
    if (
      !PROJECT_TEMP_NAME.test(entry.name) ||
      PROTECTED_PROJECT_TEMP_NAMES.has(entry.name.toLowerCase())
    )
      continue;
    addCandidate(candidates, target, projectTempRoot, 'stale workspace fixture', now, maxAgeMs);
  }

  const focuslinkTempRoot = path.join(focuslinkRoot, '.tmp');
  for (const { entry, path: target } of listDirectChildren(focuslinkTempRoot)) {
    if (
      !PROJECT_TEMP_NAME.test(entry.name) ||
      PROTECTED_PROJECT_TEMP_NAMES.has(entry.name.toLowerCase())
    )
      continue;
    addCandidate(candidates, target, focuslinkTempRoot, 'stale project fixture', now, maxAgeMs);
  }

  for (const name of ['test-data', 'dist-selftest']) {
    addCandidate(
      candidates,
      path.join(focuslinkRoot, name),
      focuslinkRoot,
      'generated regression output',
      now,
      maxAgeMs,
    );
  }
  for (const { entry, path: target } of listDirectChildren(focuslinkRoot)) {
    if (entry.isDirectory() || !GENERATED_FILE_NAME.test(entry.name)) continue;
    addCandidate(candidates, target, focuslinkRoot, 'generated regression result', now, maxAgeMs);
  }

  for (const externalRoot of externalRoots) {
    const root = path.resolve(externalRoot);
    for (const { entry, path: target } of listDirectChildren(root)) {
      if (!entry.isDirectory() || !EXTERNAL_TEMP_NAME.test(entry.name)) continue;
      addCandidate(candidates, target, root, 'stale external fixture', now, maxAgeMs);
    }
  }

  const unique = new Map(candidates.map((candidate) => [candidate.path.toLowerCase(), candidate]));
  return [...unique.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function summarizeCandidate(candidate) {
  try {
    return { ...candidate, summary: await inspectTree(candidate.path) };
  } catch (error) {
    return {
      ...candidate,
      summary: null,
      inspectError: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseArgs(argv) {
  const args = new Set(argv);
  const maxAgeArg = argv.find((value) => value.startsWith('--max-age-hours='));
  const maxAgeHours = maxAgeArg ? Number(maxAgeArg.slice('--max-age-hours='.length)) : 24;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours < 0) {
    throw new Error('--max-age-hours must be a non-negative number');
  }
  return { apply: args.has('--apply'), maxAgeMs: maxAgeHours * 60 * 60 * 1_000 };
}

function defaultRoots(focuslinkRoot) {
  const roots = [os.tmpdir()];
  if (process.platform === 'win32' && fs.existsSync('C:/Temp')) roots.push('C:/Temp');
  return roots.filter(
    (root, index) =>
      roots.indexOf(root) === index && path.resolve(root) !== path.resolve(focuslinkRoot),
  );
}

export function assertFocusLinkProjectRoot(root) {
  const candidate = path.resolve(root);
  const packagePath = path.join(candidate, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch {
    throw new Error(`refusing to clean outside a FocusLink project: ${candidate}`);
  }
  if (packageJson?.name !== 'focuslink') {
    throw new Error(`refusing to clean outside a FocusLink project: ${candidate}`);
  }
  return candidate;
}

export async function runCleanup({
  focuslinkRoot = process.cwd(),
  workspaceRoot = path.resolve(focuslinkRoot, '..'),
  externalRoots = defaultRoots(focuslinkRoot),
  apply = false,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  now = Date.now(),
} = {}) {
  const projectRoot = assertFocusLinkProjectRoot(focuslinkRoot);
  const plan = buildCleanupPlan({
    focuslinkRoot: projectRoot,
    workspaceRoot: path.resolve(workspaceRoot),
    externalRoots,
    now,
    maxAgeMs,
  });
  const inspected = [];
  for (const candidate of plan) inspected.push(await summarizeCandidate(candidate));

  const result = {
    mode: apply ? 'apply' : 'dry-run',
    maxAgeMs,
    protected: [...PROTECTED_PROJECT_TEMP_NAMES],
    candidates: inspected.map((candidate) => ({
      path: candidate.path,
      reason: candidate.reason,
      summary: candidate.summary,
      inspectError: candidate.inspectError,
    })),
    removed: [],
    failed: [],
  };
  if (!apply) return result;

  for (const candidate of inspected) {
    if (candidate.inspectError) {
      result.failed.push({ path: candidate.path, error: candidate.inspectError });
      continue;
    }
    try {
      const removal = await removePathWithRetry(candidate.path, { allowedRoot: candidate.root });
      result.removed.push({ path: candidate.path, ...removal, summary: candidate.summary });
    } catch (error) {
      result.failed.push({
        path: candidate.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

async function main() {
  const { apply, maxAgeMs } = parseArgs(process.argv.slice(2));
  const result = await runCleanup({ apply, maxAgeMs });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.failed.length > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
