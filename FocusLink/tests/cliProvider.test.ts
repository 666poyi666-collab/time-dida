import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FocusSegment, TaskCache } from '../shared/types';

const cliSettingsState = vi.hoisted(() => ({ executable: '', timeoutMs: 10_000 }));
const cliDbState = vi.hoisted(() => ({
  segment: null as FocusSegment | null,
  taskCache: [] as TaskCache[],
  batchWrites: [] as TaskCache[][],
  cloudFocusUpdates: [] as Array<{ segmentId: string; cloudFocusId: string | null }>,
}));

vi.mock('../electron/settingsStore.js', () => ({
  getSettings: vi.fn(() => ({
    ticktickCli: {
      executable: cliSettingsState.executable,
      listTasksCommand: 'dida task filter --json',
      searchTasksCommand: 'dida task filter --json',
      getTaskCommand: 'dida task get {{projectId}} {{taskId}} --json',
      appendNoteCommand: 'dida task update {{taskId}} --content "{{content}}"',
      listProjectsCommand: 'dida project list --json',
      timeoutMs: cliSettingsState.timeoutMs,
    },
  })),
  saveSettings: vi.fn((settings) => settings),
}));

vi.mock('../electron/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../electron/db/index.js', () => ({
  listTaskCache: vi.fn(() => cliDbState.taskCache),
  upsertTaskCache: vi.fn((task: TaskCache) => {
    const index = cliDbState.taskCache.findIndex((item) => item.id === task.id);
    if (index >= 0) cliDbState.taskCache[index] = task;
    else cliDbState.taskCache.push(task);
  }),
  upsertTaskCaches: vi.fn((tasks: readonly TaskCache[]) => {
    cliDbState.batchWrites.push([...tasks]);
    for (const task of tasks) {
      const index = cliDbState.taskCache.findIndex((item) => item.id === task.id);
      if (index >= 0) cliDbState.taskCache[index] = task;
      else cliDbState.taskCache.push(task);
    }
  }),
  getSegment: vi.fn(() => cliDbState.segment),
  setSegmentCloudFocusId: vi.fn((segmentId: string, cloudFocusId: string | null) => {
    cliDbState.cloudFocusUpdates.push({ segmentId, cloudFocusId });
    if (cliDbState.segment?.id === segmentId) {
      cliDbState.segment = { ...cliDbState.segment, cloudFocusId };
    }
  }),
}));

import {
  buildCompletedDidaChecklistItems,
  buildDidaChecklistItemsWithCompletion,
  buildDidaFocusTiming,
  didaFocusDurationMatches,
  getDidaCloudFocusDurationMs,
  isUndefinedCliOutput,
  normalizeCompletedDays,
  planDidaFocusReconciliation,
  resolveDidaExecTarget,
  splitCommandLine,
  testCommand,
  TickTickCliProvider,
} from '../electron/tasks/cliProvider';

function fakeFiles(...files: string[]): (candidate: string) => boolean {
  const normalized = new Set(files.map((file) => path.win32.normalize(file).toLowerCase()));
  return (candidate) => normalized.has(path.win32.normalize(candidate).toLowerCase());
}

function makeFocusRecord(taskId: string | null = 'task-1') {
  const startedAt = Date.parse('2026-07-10T01:02:03.400Z');
  return {
    sessionId: 'session-1',
    segmentId: 'seg-1',
    taskId,
    taskTitle: '中文任务',
    startedAt,
    endedAt: startedAt + 10_000,
    activeElapsedMs: 10_000,
    pauseElapsedMs: 0,
    wallElapsedMs: 10_000,
  };
}

describe('dida executable resolution', () => {
  it('finds the npm JS entry from APPDATA when USERPROFILE is unavailable', () => {
    const home = 'C:\\Users\\tester';
    const appData = 'D:\\Profiles\\tester\\Roaming';
    const script = path.win32.join(
      appData,
      'npm',
      'node_modules',
      '@suibiji',
      'dida-cli',
      'dist',
      'index.js',
    );
    const node = 'C:\\Program Files\\nodejs\\node.exe';

    const target = resolveDidaExecTarget('', {
      platform: 'win32',
      homedir: home,
      env: { APPDATA: appData, ProgramFiles: 'C:\\Program Files', PATH: '' },
      fileExists: fakeFiles(script, node),
    });

    expect(target.executablePath).toBe(script);
    expect(target.file).toBe(node);
    expect(target.kind).toBe('node-script');
  });

  it('finds the npm JS entry from USERPROFILE without APPDATA or PATH', () => {
    const home = 'C:\\Users\\tester';
    const npmRoot = path.win32.join(home, 'AppData', 'Roaming', 'npm');
    const script = path.win32.join(
      npmRoot,
      'node_modules',
      '@suibiji',
      'dida-cli',
      'dist',
      'index.js',
    );
    const node = 'C:\\Program Files\\nodejs\\node.exe';

    const target = resolveDidaExecTarget('', {
      platform: 'win32',
      homedir: home,
      env: { USERPROFILE: home, ProgramFiles: 'C:\\Program Files', PATH: '' },
      fileExists: fakeFiles(script, node),
    });

    expect(target).toEqual({
      file: node,
      argsPrefix: [script],
      executablePath: script,
      kind: 'node-script',
    });
  });

  it('honors a manual npm shim with environment variables', () => {
    const home = 'C:\\Users\\tester';
    const npmRoot = path.win32.join(home, 'AppData', 'Roaming', 'npm');
    const shim = path.win32.join(npmRoot, 'dida.cmd');
    const script = path.win32.join(
      npmRoot,
      'node_modules',
      '@suibiji',
      'dida-cli',
      'dist',
      'index.js',
    );
    const node = 'C:\\Program Files\\nodejs\\node.exe';

    const target = resolveDidaExecTarget('%USERPROFILE%\\AppData\\Roaming\\npm\\dida.cmd', {
      platform: 'win32',
      homedir: home,
      env: { USERPROFILE: home, ProgramFiles: 'C:\\Program Files', PATH: '' },
      fileExists: fakeFiles(shim, script, node),
    });

    expect(target.file).toBe(node);
    expect(target.argsPrefix).toEqual([script]);
    expect(target.kind).toBe('node-script');
  });

  it('falls back to an npm cmd shim through execFile argv when no Node binary is discoverable', () => {
    const home = 'C:\\Users\\tester';
    const npmRoot = path.win32.join(home, 'AppData', 'Roaming', 'npm');
    const shim = path.win32.join(npmRoot, 'dida.cmd');

    const target = resolveDidaExecTarget('', {
      platform: 'win32',
      homedir: home,
      env: {
        USERPROFILE: home,
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
        ProgramFiles: 'D:\\Missing',
        PATH: '',
      },
      fileExists: fakeFiles(shim),
    });

    expect(target).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      argsPrefix: ['/d', '/s', '/c', shim],
      executablePath: shim,
      kind: 'cmd-shim',
    });
  });

  it('runs a manually configured real JS entry through Node even when the path has spaces', () => {
    const home = 'C:\\Users\\tester';
    const script = 'C:\\Tools With Space\\dida-cli\\dist\\index.js';
    const node = 'C:\\Program Files\\nodejs\\node.exe';
    const target = resolveDidaExecTarget(script, {
      platform: 'win32',
      homedir: home,
      env: { USERPROFILE: home, ProgramFiles: 'C:\\Program Files', PATH: '' },
      fileExists: fakeFiles(script, node),
    });

    expect(target.file).toBe(node);
    expect(target.argsPrefix).toEqual([script]);
    expect(target.executablePath).toBe(script);
  });

  it('does not silently replace an explicit custom executable with an auto-detected dida', () => {
    const home = 'C:\\Users\\tester';
    const script = path.win32.join(
      home,
      'AppData',
      'Roaming',
      'npm',
      'node_modules',
      '@suibiji',
      'dida-cli',
      'dist',
      'index.js',
    );
    const node = 'C:\\Program Files\\nodejs\\node.exe';

    const target = resolveDidaExecTarget('my-dida --profile school', {
      platform: 'win32',
      homedir: home,
      env: { USERPROFILE: home, ProgramFiles: 'C:\\Program Files', PATH: 'C:\\Tools' },
      fileExists: fakeFiles(script, node),
    });

    expect(target).toEqual({
      file: 'my-dida',
      argsPrefix: ['--profile', 'school'],
      executablePath: 'my-dida',
      kind: 'path-command',
    });
  });

  it('keeps manual arguments while resolving the bare dida alias without PATH', () => {
    const home = 'C:\\Users\\tester';
    const script = path.win32.join(
      home,
      'AppData',
      'Roaming',
      'npm',
      'node_modules',
      '@suibiji',
      'dida-cli',
      'dist',
      'index.js',
    );
    const node = 'C:\\Program Files\\nodejs\\node.exe';

    const target = resolveDidaExecTarget('dida --profile school', {
      platform: 'win32',
      homedir: home,
      env: { USERPROFILE: home, ProgramFiles: 'C:\\Program Files', PATH: '' },
      fileExists: fakeFiles(script, node),
    });

    expect(target.file).toBe(node);
    expect(target.argsPrefix).toEqual([script, '--profile', 'school']);
  });
});

describe('dida command parsing', () => {
  it('keeps Chinese text, newlines and quoted arguments in one argv item', () => {
    const title = '专注 25 分钟\n[FocusLink:segment:seg-1]';
    const args = splitCommandLine(`dida task comment add project task --title "${title}" --json`);
    expect(args).toEqual([
      'dida',
      'task',
      'comment',
      'add',
      'project',
      'task',
      '--title',
      title,
      '--json',
    ]);
  });

  it('rejects shell pipelines and command chaining', () => {
    expect(() => splitCommandLine('dida task filter --json | more')).toThrow(/不支持/);
    expect(() => splitCommandLine('dida --version && whoami')).toThrow(/不支持/);
  });

  it('preserves an explicitly empty quoted argument', () => {
    expect(splitCommandLine('dida task update task --content "" --json')).toEqual([
      'dida',
      'task',
      'update',
      'task',
      '--content',
      '',
      '--json',
    ]);
  });
});

describe('dida focus time semantics', () => {
  it('sets end to start + active only so the TickTick UI shows the real focus span', () => {
    const timing = buildDidaFocusTiming({
      startedAt: Date.parse('2026-07-06T23:04:20.426Z'),
      activeElapsedMs: 1_674_900,
      pauseElapsedMs: 1_960_000,
    });

    expect(timing.pauseDurationSec).toBe(0);
    expect(timing.expectedDurationMs).toBe(1_674_900);
    expect(timing.endMs - timing.startMs).toBe(timing.expectedDurationMs);
  });

  it('does not include pause in end time even when pause is non-zero', () => {
    const timing = buildDidaFocusTiming({
      startedAt: 1_000_000,
      activeElapsedMs: 25_000,
      pauseElapsedMs: 1_501,
    });
    expect(timing.pauseDurationSec).toBe(0);
    expect(timing.endMs).toBe(1_025_000);
  });
});

describe('existing dida focus duration validation', () => {
  it('detects the old zero-duration record as mismatched', () => {
    const record = {
      id: 'focus-old',
      duration: 0,
      note: '[FocusLink:segment:seg-1]',
    };
    expect(getDidaCloudFocusDurationMs(record)).toBe(0);
    expect(didaFocusDurationMatches(record, 1_674_900)).toBe(false);
  });

  it('accepts small server rounding differences', () => {
    expect(didaFocusDurationMatches({ id: 'focus-ok', duration: 1_674_000 }, 1_674_900)).toBe(true);
  });

  it('derives duration from start/end/pause when the duration field is absent', () => {
    const record = {
      id: 'focus-derived',
      startTime: '2026-07-01T00:00:00.000Z',
      endTime: '2026-07-01T00:30:30.000Z',
      pauseDuration: 30,
    };
    expect(getDidaCloudFocusDurationMs(record)).toBe(30 * 60 * 1000);
    expect(didaFocusDurationMatches(record, 30 * 60 * 1000)).toBe(true);
  });

  it('does not request a destructive rebuild when duration cannot be verified', () => {
    expect(didaFocusDurationMatches({ id: 'focus-unknown' }, 60_000)).toBeNull();
  });
});

describe('dida focus marker reconciliation', () => {
  const marker = '[FocusLink:segment:seg-1]';

  it('creates only when the marker is absent', () => {
    expect(
      planDidaFocusReconciliation(
        [{ id: 'other', note: '[FocusLink:segment:seg-other]', duration: 60_000 }],
        marker,
        60_000,
      ),
    ).toEqual({ action: 'create', markerMatches: [] });
  });

  it('reuses a verified marker and identifies duplicates for cleanup', () => {
    const plan = planDidaFocusReconciliation(
      [
        { id: 'correct', note: marker, duration: 60_000 },
        { id: 'old-wrong', note: marker, duration: 0 },
      ],
      marker,
      60_000,
    );
    expect(plan.action).toBe('keep');
    if (plan.action !== 'keep') throw new Error('expected keep plan');
    expect(plan.keeper.id).toBe('correct');
    expect(plan.durationVerified).toBe(true);
    expect(plan.duplicates.map((record) => record.id)).toEqual(['old-wrong']);
  });

  it('rebuilds only when every matching marker has a confirmed wrong duration', () => {
    const plan = planDidaFocusReconciliation(
      [
        { id: 'old-zero', note: marker, duration: 0 },
        { id: 'old-short', note: marker, duration: 10_000 },
      ],
      marker,
      60_000,
    );
    expect(plan.action).toBe('rebuild');
    if (plan.action !== 'rebuild') throw new Error('expected rebuild plan');
    expect(plan.stale.map((record) => record.id)).toEqual(['old-zero', 'old-short']);
  });

  it('keeps unverifiable marker data without destructive cleanup', () => {
    const plan = planDidaFocusReconciliation(
      [
        { id: 'unknown', note: marker },
        { id: 'old-zero', note: marker, duration: 0 },
      ],
      marker,
      60_000,
    );
    expect(plan.action).toBe('keep');
    if (plan.action !== 'keep') throw new Error('expected keep plan');
    expect(plan.keeper.id).toBe('unknown');
    expect(plan.durationVerified).toBe(false);
    expect(plan.duplicates).toEqual([]);
  });

  it('passes corrected timing as argv, rebuilds one bad marker, then skips the retry', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-focus-test-'));
    const statePath = path.join(tempDir, 'focus-state.json');
    const callsPath = path.join(tempDir, 'focus-calls.jsonl');
    const fakeCliPath = path.join(tempDir, 'fake-focus-dida.mjs');
    fs.writeFileSync(
      statePath,
      JSON.stringify([{ id: 'old-zero', note: marker, duration: 0 }]),
      'utf8',
    );
    fs.writeFileSync(
      fakeCliPath,
      [
        "import fs from 'node:fs';",
        'const args = process.argv.slice(2);',
        `const statePath = ${JSON.stringify(statePath)};`,
        `const callsPath = ${JSON.stringify(callsPath)};`,
        "fs.appendFileSync(callsPath, JSON.stringify(args) + '\\n');",
        "let records = JSON.parse(fs.readFileSync(statePath, 'utf8'));",
        'const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };',
        "if (args[0] === 'focus' && args[1] === 'list') {",
        '  process.stdout.write(JSON.stringify(records));',
        "} else if (args[0] === 'focus' && args[1] === 'create') {",
        "  const startTime = value('--start-time');",
        "  const endTime = value('--end-time');",
        "  const pauseDuration = Number(value('--pause-duration') || 0);",
        '  records.push({',
        "    id: 'focus-new',",
        "    note: value('--note'),",
        '    startTime,',
        '    endTime,',
        '    pauseDuration,',
        '    duration: Date.parse(endTime) - Date.parse(startTime) - pauseDuration * 1000,',
        '  });',
        "  fs.writeFileSync(statePath, JSON.stringify(records), 'utf8');",
        "  process.stdout.write(JSON.stringify({ id: 'focus-new' }));",
        "} else if (args[0] === 'focus' && args[1] === 'delete') {",
        '  records = records.filter((record) => record.id !== args[2]);',
        "  fs.writeFileSync(statePath, JSON.stringify(records), 'utf8');",
        '  process.stdout.write(JSON.stringify({ success: true }));',
        '} else {',
        "  process.stderr.write('unexpected command: ' + JSON.stringify(args));",
        '  process.exitCode = 2;',
        '}',
      ].join('\n'),
      'utf8',
    );

    cliSettingsState.executable = `"${process.execPath}" "${fakeCliPath}"`;
    const startedAt = Date.parse('2026-07-10T01:02:03.400Z');
    const record = {
      sessionId: 'session-1',
      segmentId: 'seg-1',
      taskId: null,
      taskTitle: '中文任务',
      startedAt,
      endedAt: startedAt + 31_000,
      activeElapsedMs: 25_400,
      pauseElapsedMs: 5_600,
      wallElapsedMs: 31_000,
    };

    try {
      const provider = new TickTickCliProvider();
      await expect(provider.createFocusRecord(record)).resolves.toBe('focus-new');
      await expect(provider.createFocusRecord(record)).resolves.toBe('focus-new');

      const calls = fs
        .readFileSync(callsPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string[]);
      const createCalls = calls.filter((args) => args[0] === 'focus' && args[1] === 'create');
      const deleteCalls = calls.filter((args) => args[0] === 'focus' && args[1] === 'delete');
      expect(createCalls).toHaveLength(1);
      expect(deleteCalls).toEqual([['focus', 'delete', 'old-zero', '--type', '1', '--json']]);

      const createArgs = createCalls[0];
      const value = (name: string) => createArgs[createArgs.indexOf(name) + 1];
      expect(value('--start-time')).toBe('2026-07-10T01:02:03.400Z');
      expect(value('--end-time')).toBe('2026-07-10T01:02:28.800Z');
      expect(value('--duration')).toBe('25');
      expect(createArgs).not.toContain('--pause-duration');
      expect(value('--note')).toContain('中文任务');
      expect(value('--note')).toContain(marker);

      const cloudRecords = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Array<{
        id: string;
        duration: number;
      }>;
      expect(cloudRecords).toHaveLength(1);
      expect(cloudRecords[0]).toMatchObject({ id: 'focus-new', duration: 25_400 });
    } finally {
      cliSettingsState.executable = '';
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('dida workspace task refresh', () => {
  it('defaults to active tasks and loads a bounded completed window only when requested', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-task-workspace-list-'));
    const callsPath = path.join(tempDir, 'calls.jsonl');
    const fakeCliPath = path.join(tempDir, 'fake-dida.mjs');
    fs.writeFileSync(
      fakeCliPath,
      [
        "import fs from 'node:fs';",
        'const args = process.argv.slice(2);',
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        "if (args[1] === 'filter') process.stdout.write(JSON.stringify([{ id: 'parent', projectId: 'project-1', title: '父任务', status: 0, items: [{ id: 'done-child', title: '已完成子项', status: 1, completedTime: '2026-07-12T01:02:03.000Z' }] }, { id: 'reopened', projectId: 'project-1', title: '已恢复普通任务', status: 0, completedTime: '2026-07-12T02:03:04.000Z' }]));",
        "else process.stdout.write(JSON.stringify([{ id: 'done', projectId: 'project-1', title: '已完成', status: 2, completedTime: '2026-07-12T03:04:05.000Z', createdTime: '2026-07-01T01:02:03.000Z', modifiedTime: '2026-07-12T03:04:06.000Z' }, { id: 'reopened', projectId: 'project-1', title: '旧完成副本', status: 2, completedTime: '2026-07-11T03:04:05.000Z' }]));",
      ].join('\n'),
      'utf8',
    );

    cliSettingsState.executable = `"${process.execPath}" "${fakeCliPath}"`;
    cliDbState.taskCache = [];
    cliDbState.batchWrites = [];
    try {
      const provider = new TickTickCliProvider();
      const activeOnly = await provider.listWorkspaceTasks('project-1');
      expect(activeOnly.map((task) => task.id)).toEqual(['parent', 'reopened']);

      const tasks = await provider.listWorkspaceTasks('project-1', {
        includeCompleted: true,
        completedDays: 14,
      });
      expect(tasks).toHaveLength(3);
      expect(tasks.find((task) => task.id === 'done')).toMatchObject({
        isCompleted: true,
        completedAt: Date.parse('2026-07-12T03:04:05.000Z'),
        createdAt: Date.parse('2026-07-01T01:02:03.000Z'),
        updatedAt: Date.parse('2026-07-12T03:04:06.000Z'),
      });
      // completed 端点仍有旧副本时，活动端点的 status=0 必须胜出。
      expect(tasks.find((task) => task.id === 'reopened')).toMatchObject({
        title: '已恢复普通任务',
        status: 'pending',
        isCompleted: false,
        completedAt: null,
      });
      expect(tasks.find((task) => task.id === 'parent')?.children?.[0]).toMatchObject({
        id: 'done-child',
        isCompleted: true,
      });
      expect(cliDbState.taskCache.find((task) => task.externalId === 'done-child')?.status).toBe(
        'completed',
      );
      const doneCache = cliDbState.taskCache.find((task) => task.externalId === 'done');
      expect(JSON.parse(doneCache?.rawJson ?? '{}')).toMatchObject({
        completedAt: Date.parse('2026-07-12T03:04:05.000Z'),
        createdAt: Date.parse('2026-07-01T01:02:03.000Z'),
        updatedAt: Date.parse('2026-07-12T03:04:06.000Z'),
      });
      expect(cliDbState.batchWrites).toHaveLength(2);
      expect(cliDbState.batchWrites[0].map((task) => task.externalId)).toEqual([
        'parent',
        'done-child',
        'reopened',
      ]);
      const calls = fs
        .readFileSync(callsPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string[]);
      expect(calls).toEqual([
        ['task', 'filter', '--projects', 'project-1', '--status', '0', '--json'],
        [
          'task',
          'completed',
          '--projects',
          'project-1',
          '--start-date',
          expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          '--end-date',
          expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          '--json',
        ],
      ]);
      const completedCall = calls[1];
      const startAt = Date.parse(completedCall[completedCall.indexOf('--start-date') + 1]);
      const endAt = Date.parse(completedCall[completedCall.indexOf('--end-date') + 1]);
      expect(endAt - startAt).toBe(14 * 24 * 60 * 60 * 1000);
    } finally {
      cliSettingsState.executable = '';
      cliDbState.taskCache = [];
      cliDbState.batchWrites = [];
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('single-flights active task reads, reuses the short cache, and bypasses it only when forced', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-task-cache-'));
    const callsPath = path.join(tempDir, 'calls.jsonl');
    const fakeCliPath = path.join(tempDir, 'fake-dida.mjs');
    const activeTask = {
      id: 'task-cache',
      projectId: 'project-1',
      title: '缓存任务',
      status: 0,
    };
    fs.writeFileSync(
      fakeCliPath,
      [
        "import fs from 'node:fs';",
        'const args = process.argv.slice(2);',
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'task' && args[1] === 'filter') {",
        `  process.stdout.write(${JSON.stringify(JSON.stringify([activeTask]))});`,
        "} else if (args[0] === 'task' && args[1] === 'complete') {",
        "  process.stdout.write(JSON.stringify({ id: 'task-cache', status: 2 }));",
        '} else {',
        "  process.stderr.write('unexpected command: ' + JSON.stringify(args));",
        '  process.exitCode = 2;',
        '}',
      ].join('\n'),
      'utf8',
    );

    cliSettingsState.executable = `"${process.execPath}" "${fakeCliPath}"`;
    cliDbState.taskCache = [];
    cliDbState.batchWrites = [];
    try {
      let now = 1_000;
      const provider = new TickTickCliProvider({
        rawTaskCacheTtlMs: 100,
        now: () => now,
      });
      await Promise.all([provider.listWorkspaceTasks(), provider.listWorkspaceTasks()]);
      await provider.listWorkspaceTasks();
      now += 101;
      await provider.listWorkspaceTasks();
      await Promise.all([
        provider.listWorkspaceTasks(undefined, { force: true }),
        provider.listWorkspaceTasks(undefined, { force: true }),
      ]);
      await provider.listWorkspaceTasks();

      await provider.setTaskCompleted(
        {
          id: 'task-cache',
          source: 'ticktick',
          externalId: 'task-cache',
          projectId: 'project-1',
          title: '缓存任务',
          status: 'pending',
          isCompleted: false,
          priority: null,
          dueDate: null,
          tags: [],
          content: null,
        },
        true,
      );
      await provider.listWorkspaceTasks();

      const calls = fs
        .readFileSync(callsPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string[]);
      expect(calls.filter((args) => args[0] === 'task' && args[1] === 'filter')).toHaveLength(4);
      expect(calls.filter((args) => args[0] === 'task' && args[1] === 'complete')).toEqual([
        ['task', 'complete', 'project-1', 'task-cache'],
      ]);
      // One transaction per actual read: initial, TTL expiry, explicit force, and mutation invalidation.
      expect(cliDbState.batchWrites).toHaveLength(4);
    } finally {
      cliSettingsState.executable = '';
      cliDbState.taskCache = [];
      cliDbState.batchWrites = [];
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('clamps invalid completed history windows', () => {
    expect(normalizeCompletedDays(undefined)).toBe(30);
    expect(normalizeCompletedDays(Number.NaN)).toBe(30);
    expect(normalizeCompletedDays(0)).toBe(1);
    expect(normalizeCompletedDays(50_000)).toBe(3650);
  });
});

describe('dida task context failures stay retryable', () => {
  it('does not create an unassociated focus when task list is rate limited', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-task-rate-limit-'));
    const callsPath = path.join(tempDir, 'calls.jsonl');
    const fakeCliPath = path.join(tempDir, 'fake-dida.mjs');
    fs.writeFileSync(
      fakeCliPath,
      [
        "import fs from 'node:fs';",
        'const args = process.argv.slice(2);',
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'task' && args[1] === 'filter') {",
        "  process.stderr.write('HTTP 429 Too Many Requests');",
        '  process.exitCode = 1;',
        '} else {',
        "  process.stderr.write('unexpected command');",
        '  process.exitCode = 2;',
        '}',
      ].join('\n'),
      'utf8',
    );

    cliSettingsState.executable = `"${process.execPath}" "${fakeCliPath}"`;
    cliDbState.taskCache = [];
    try {
      const provider = new TickTickCliProvider();
      await expect(provider.createFocusRecord(makeFocusRecord())).rejects.toThrow(
        /CLI 任务列表失败/,
      );
      await expect(provider.createFocusRecord(makeFocusRecord())).rejects.toThrow(
        /CLI 任务列表失败/,
      );
      const calls = fs
        .readFileSync(callsPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string[]);
      // Transient failures must not poison the successful-result cache.
      expect(calls).toEqual([
        ['task', 'filter', '--status', '0', '--json'],
        ['task', 'filter', '--status', '0', '--json'],
      ]);
      expect(calls.some((args) => args[0] === 'focus' && args[1] === 'create')).toBe(false);
    } finally {
      cliSettingsState.executable = '';
      cliDbState.taskCache = [];
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not create an unassociated focus when task list times out', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-task-timeout-'));
    const callsPath = path.join(tempDir, 'calls.jsonl');
    const fakeCliPath = path.join(tempDir, 'fake-dida.mjs');
    fs.writeFileSync(
      fakeCliPath,
      [
        "import fs from 'node:fs';",
        'const args = process.argv.slice(2);',
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        'setTimeout(() => {}, 5000);',
      ].join('\n'),
      'utf8',
    );

    cliSettingsState.executable = `"${process.execPath}" "${fakeCliPath}"`;
    // Give the child Node process enough time to start and persist its argv before
    // the provider kills the deliberately hanging command. A 50 ms timeout was
    // shorter than process startup on a busy Windows runner and made this test flaky.
    cliSettingsState.timeoutMs = 1_000;
    cliDbState.taskCache = [];
    try {
      const provider = new TickTickCliProvider();
      await expect(provider.createFocusRecord(makeFocusRecord())).rejects.toThrow(
        /CLI 任务列表失败/,
      );
      const calls = fs
        .readFileSync(callsPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string[]);
      expect(calls).toEqual([['task', 'filter', '--status', '0', '--json']]);
    } finally {
      cliSettingsState.executable = '';
      cliSettingsState.timeoutMs = 10_000;
      cliDbState.taskCache = [];
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('propagates a transient task get failure instead of treating the cached task as deleted', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-task-get-rate-limit-'));
    const callsPath = path.join(tempDir, 'calls.jsonl');
    const fakeCliPath = path.join(tempDir, 'fake-dida.mjs');
    fs.writeFileSync(
      fakeCliPath,
      [
        "import fs from 'node:fs';",
        'const args = process.argv.slice(2);',
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'task' && args[1] === 'filter') {",
        "  process.stdout.write('[]');",
        "} else if (args[0] === 'task' && args[1] === 'get') {",
        "  process.stderr.write('HTTP 429 rate limit exceeded');",
        '  process.exitCode = 1;',
        '} else {',
        "  process.stderr.write('unexpected command');",
        '  process.exitCode = 2;',
        '}',
      ].join('\n'),
      'utf8',
    );

    const now = Date.now();
    cliDbState.taskCache = [
      {
        id: 'ticktick:task-1',
        source: 'ticktick',
        externalId: 'task-1',
        projectId: 'project-1',
        title: '缓存任务',
        status: 'pending',
        priority: null,
        dueDate: null,
        tags: null,
        content: null,
        rawJson: null,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ];
    cliSettingsState.executable = `"${process.execPath}" "${fakeCliPath}"`;
    try {
      const provider = new TickTickCliProvider();
      await expect(provider.createFocusRecord(makeFocusRecord())).rejects.toThrow(
        /CLI 读取任务失败/,
      );
      const calls = fs
        .readFileSync(callsPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string[]);
      expect(calls).toEqual([
        ['task', 'filter', '--status', '0', '--json'],
        ['task', 'get', 'project-1', 'task-1', '--json'],
      ]);
      expect(calls.some((args) => args[0] === 'focus' && args[1] === 'create')).toBe(false);
    } finally {
      cliSettingsState.executable = '';
      cliDbState.taskCache = [];
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves a cached checklist child through its parent when filter omits the child', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-checklist-parent-focus-'));
    const callsPath = path.join(tempDir, 'calls.jsonl');
    const fakeCliPath = path.join(tempDir, 'fake-checklist-parent-dida.mjs');
    const parent = {
      id: 'parent-1',
      projectId: 'project-1',
      title: '父任务',
      status: 0,
      items: [{ id: 'child-1', title: '清单子项', status: 0 }],
    };
    fs.writeFileSync(
      fakeCliPath,
      [
        "import fs from 'node:fs';",
        'const args = process.argv.slice(2);',
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'task' && args[1] === 'filter') {",
        "  process.stdout.write('[]');",
        "} else if (args[0] === 'task' && args[1] === 'get') {",
        `  process.stdout.write(${JSON.stringify(JSON.stringify(parent))});`,
        "} else if (args[0] === 'focus' && args[1] === 'list') {",
        "  process.stdout.write('[]');",
        "} else if (args[0] === 'focus' && args[1] === 'create') {",
        "  process.stdout.write(JSON.stringify({ id: 'focus-child-parent' }));",
        '} else {',
        "  process.stderr.write('unexpected command: ' + JSON.stringify(args));",
        '  process.exitCode = 2;',
        '}',
      ].join('\n'),
      'utf8',
    );

    const now = Date.now();
    cliDbState.taskCache = [
      {
        id: 'ticktick:child-1',
        source: 'ticktick',
        externalId: 'child-1',
        projectId: 'project-1',
        title: '清单子项',
        status: 'pending',
        priority: null,
        dueDate: null,
        tags: null,
        content: null,
        rawJson: JSON.stringify({ parentId: 'parent-1' }),
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ];
    cliSettingsState.executable = `"${process.execPath}" "${fakeCliPath}"`;
    try {
      const provider = new TickTickCliProvider();
      await expect(provider.createFocusRecord(makeFocusRecord('child-1'))).resolves.toBe(
        'focus-child-parent',
      );
      const calls = fs
        .readFileSync(callsPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string[]);
      expect(calls).toContainEqual(['task', 'get', 'project-1', 'parent-1', '--json']);
      const create = calls.find((args) => args[0] === 'focus' && args[1] === 'create');
      expect(create).toBeDefined();
      if (!create) throw new Error('focus create was not called');
      expect(create[create.indexOf('--task-id') + 1]).toBe('parent-1');
      expect(calls.some((args) => args.includes('child-1') && args[1] === 'get')).toBe(false);
    } finally {
      cliSettingsState.executable = '';
      cliDbState.taskCache = [];
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('dida focus deletion safety', () => {
  function setDeleteSegment(cloudFocusId: string | null): void {
    const startedAt = Date.parse('2026-07-10T01:02:03.400Z');
    cliDbState.segment = {
      id: 'seg-delete',
      sessionId: 'session-delete',
      taskId: 'task-1',
      taskSource: 'ticktick',
      title: '待删除',
      startedAt,
      endedAt: startedAt + 10_000,
      activeElapsedMs: 10_000,
      note: null,
      cloudFocusId,
      tomatodoSubject: null,
      createdAt: startedAt,
      updatedAt: startedAt + 10_000,
    };
    cliDbState.cloudFocusUpdates = [];
  }

  it('deletes every cloud record sharing the segment marker exactly once', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-delete-duplicates-'));
    const callsPath = path.join(tempDir, 'calls.jsonl');
    const fakeCliPath = path.join(tempDir, 'fake-dida.mjs');
    const marker = '[FocusLink:segment:seg-delete]';
    fs.writeFileSync(
      fakeCliPath,
      [
        "import fs from 'node:fs';",
        'const args = process.argv.slice(2);',
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'focus' && args[1] === 'list') {",
        `  process.stdout.write(${JSON.stringify(
          JSON.stringify([
            { id: 'focus-primary', note: marker, duration: 10_000 },
            { id: 'focus-duplicate', note: marker, duration: 10_000 },
            { id: 'focus-other', note: '[FocusLink:segment:other]', duration: 10_000 },
          ]),
        )});`,
        "} else if (args[0] === 'focus' && args[1] === 'delete') {",
        '  process.stdout.write(JSON.stringify({ success: true }));',
        '} else {',
        "  process.stderr.write('unexpected command');",
        '  process.exitCode = 2;',
        '}',
      ].join('\n'),
      'utf8',
    );

    setDeleteSegment('focus-primary');
    cliSettingsState.executable = `"${process.execPath}" "${fakeCliPath}"`;
    try {
      const provider = new TickTickCliProvider();
      await expect(provider.deleteFocusRecord('seg-delete')).resolves.toBe(true);
      const calls = fs
        .readFileSync(callsPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string[]);
      expect(calls.filter((args) => args[0] === 'focus' && args[1] === 'delete')).toEqual([
        ['focus', 'delete', 'focus-primary', '--type', '1', '--json'],
        ['focus', 'delete', 'focus-duplicate', '--type', '1', '--json'],
      ]);
      expect(cliDbState.cloudFocusUpdates).toEqual([
        { segmentId: 'seg-delete', cloudFocusId: null },
      ]);
    } finally {
      cliSettingsState.executable = '';
      cliDbState.segment = null;
      cliDbState.cloudFocusUpdates = [];
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('propagates marker lookup errors and keeps the local cloud id intact', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-delete-query-error-'));
    const callsPath = path.join(tempDir, 'calls.jsonl');
    const fakeCliPath = path.join(tempDir, 'fake-dida.mjs');
    fs.writeFileSync(
      fakeCliPath,
      [
        "import fs from 'node:fs';",
        'const args = process.argv.slice(2);',
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        "process.stderr.write('HTTP 429 Too Many Requests');",
        'process.exitCode = 1;',
      ].join('\n'),
      'utf8',
    );

    setDeleteSegment('focus-primary');
    cliSettingsState.executable = `"${process.execPath}" "${fakeCliPath}"`;
    try {
      const provider = new TickTickCliProvider();
      await expect(provider.deleteFocusRecord('seg-delete')).rejects.toThrow(
        /CLI 读取云端专注记录失败/,
      );
      const calls = fs
        .readFileSync(callsPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string[]);
      expect(calls).toEqual([expect.arrayContaining(['focus', 'list'])]);
      expect(calls.some((args) => args[0] === 'focus' && args[1] === 'delete')).toBe(false);
      expect(cliDbState.segment?.cloudFocusId).toBe('focus-primary');
      expect(cliDbState.cloudFocusUpdates).toEqual([]);
    } finally {
      cliSettingsState.executable = '';
      cliDbState.segment = null;
      cliDbState.cloudFocusUpdates = [];
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('dida checklist completion payload', () => {
  it('preserves every target and sibling field while changing only the target status', async () => {
    const targetItem = {
      id: 'child-target',
      title: '目标子项',
      status: 0,
      completedTime: null,
      sortOrder: 10,
      startDate: '2026-07-10T01:00:00.000Z',
      dueDate: '2026-07-10T02:00:00.000Z',
      timeZone: 'Asia/Shanghai',
      reminders: ['TRIGGER:PT0S'],
      customMeta: { source: 'school', color: '#7c3aed' },
    };
    const siblingItem = {
      id: 'child-sibling',
      title: '兄弟子项',
      status: 2,
      completedTime: '2026-07-09T03:04:05.000Z',
      sortOrder: 20,
      isAllDay: false,
      timeZone: 'Asia/Shanghai',
      reminders: ['TRIGGER:P0DT1H0M0S'],
      unknownArray: [1, { keep: true }],
    };
    const invalidButPreservedEntry = 'future-cli-extension';

    const purePayload = buildCompletedDidaChecklistItems(
      [targetItem, siblingItem, invalidButPreservedEntry],
      'ticktick:child-target',
    );
    expect(purePayload).toEqual([
      { ...targetItem, status: 2 },
      siblingItem,
      invalidButPreservedEntry,
    ]);
    expect(targetItem.status).toBe(0);

    const parent = {
      id: 'parent-1',
      projectId: 'project-1',
      title: '父任务',
      status: 0,
      items: [targetItem, siblingItem, invalidButPreservedEntry],
    };
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-checklist-test-'));
    const callsPath = path.join(tempDir, 'calls.jsonl');
    const fakeCliPath = path.join(tempDir, 'fake-checklist-dida.mjs');
    fs.writeFileSync(
      fakeCliPath,
      [
        "import fs from 'node:fs';",
        'const args = process.argv.slice(2);',
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'task' && args[1] === 'filter') {",
        `  process.stdout.write(${JSON.stringify(JSON.stringify([parent]))});`,
        "} else if (args[0] === 'task' && args[1] === 'update') {",
        "  process.stdout.write(JSON.stringify({ id: 'parent-1' }));",
        '} else {',
        "  process.stderr.write('unexpected command: ' + JSON.stringify(args));",
        '  process.exitCode = 2;',
        '}',
      ].join('\n'),
      'utf8',
    );

    cliSettingsState.executable = `"${process.execPath}" "${fakeCliPath}"`;
    try {
      const provider = new TickTickCliProvider();
      await provider.completeTask({
        id: 'child-target',
        source: 'ticktick',
        externalId: 'child-target',
        projectId: 'project-1',
        title: '目标子项',
        status: 'pending',
        priority: null,
        dueDate: null,
        tags: [],
        content: null,
        parentId: 'parent-1',
      });

      const calls = fs
        .readFileSync(callsPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string[]);
      const updateCalls = calls.filter((args) => args[0] === 'task' && args[1] === 'update');
      expect(updateCalls).toHaveLength(1);
      const updateArgs = updateCalls[0];
      expect(updateArgs.slice(0, 7)).toEqual([
        'task',
        'update',
        'parent-1',
        '--id',
        'parent-1',
        '--project',
        'project-1',
      ]);
      const itemsIndex = updateArgs.indexOf('--items');
      expect(itemsIndex).toBeGreaterThan(0);
      expect(JSON.parse(updateArgs[itemsIndex + 1])).toEqual([
        { ...targetItem, status: 2 },
        siblingItem,
        invalidButPreservedEntry,
      ]);
      expect(calls.some((args) => args[0] === 'task' && args[1] === 'complete')).toBe(false);
    } finally {
      cliSettingsState.executable = '';
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('restores a checklist item with the full parent items array and clears completedTime', async () => {
    const targetItem = {
      id: 'child-target',
      title: '目标子项',
      status: 2,
      completedTime: '2026-07-10T03:04:05.000Z',
      sortOrder: 10,
      customMeta: { preserve: true },
    };
    const siblingItem = {
      id: 'child-sibling',
      title: '兄弟子项',
      status: 2,
      completedTime: '2026-07-09T03:04:05.000Z',
      reminders: ['TRIGGER:P0DT1H0M0S'],
    };
    expect(
      buildDidaChecklistItemsWithCompletion([targetItem, siblingItem], 'child-target', false),
    ).toEqual([{ ...targetItem, status: 0, completedTime: null }, siblingItem]);

    const parent = {
      id: 'parent-1',
      projectId: 'project-1',
      title: '父任务',
      status: 0,
      items: [targetItem, siblingItem],
    };
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-checklist-reopen-'));
    const callsPath = path.join(tempDir, 'calls.jsonl');
    const fakeCliPath = path.join(tempDir, 'fake-checklist-dida.mjs');
    fs.writeFileSync(
      fakeCliPath,
      [
        "import fs from 'node:fs';",
        'const args = process.argv.slice(2);',
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'task' && args[1] === 'filter') {",
        `  process.stdout.write(${JSON.stringify(JSON.stringify([parent]))});`,
        "} else if (args[0] === 'task' && args[1] === 'update') {",
        "  process.stdout.write(JSON.stringify({ id: 'parent-1' }));",
        '} else {',
        "  process.stderr.write('unexpected command: ' + JSON.stringify(args));",
        '  process.exitCode = 2;',
        '}',
      ].join('\n'),
      'utf8',
    );

    cliSettingsState.executable = `"${process.execPath}" "${fakeCliPath}"`;
    try {
      const provider = new TickTickCliProvider();
      await provider.setTaskCompleted(
        {
          id: 'child-target',
          source: 'ticktick',
          externalId: 'child-target',
          projectId: 'project-1',
          title: '目标子项',
          status: 'completed',
          isCompleted: true,
          priority: null,
          dueDate: null,
          tags: [],
          content: null,
          parentId: 'parent-1',
        },
        false,
      );

      const calls = fs
        .readFileSync(callsPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string[]);
      const updateArgs = calls.find((args) => args[0] === 'task' && args[1] === 'update');
      expect(updateArgs).toBeDefined();
      if (!updateArgs) throw new Error('task update was not called');
      expect(JSON.parse(updateArgs[updateArgs.indexOf('--items') + 1])).toEqual([
        { ...targetItem, status: 0, completedTime: null },
        siblingItem,
      ]);
    } finally {
      cliSettingsState.executable = '';
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('dida normal task restore command', () => {
  it('uses argv status 0 and accepts only a confirmed incomplete task', async () => {
    const completedTask = {
      id: 'task-restore',
      projectId: 'project-1',
      title: '恢复任务',
      status: 2,
      completedTime: '2026-07-10T03:04:05.000Z',
    };
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-task-reopen-'));
    const callsPath = path.join(tempDir, 'calls.jsonl');
    const fakeCliPath = path.join(tempDir, 'fake-reopen-dida.mjs');
    fs.writeFileSync(
      fakeCliPath,
      [
        "import fs from 'node:fs';",
        'const args = process.argv.slice(2);',
        `fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');`,
        "if (args[0] === 'task' && args[1] === 'filter') {",
        `  process.stdout.write(${JSON.stringify(JSON.stringify([completedTask]))});`,
        "} else if (args[0] === 'task' && args[1] === 'update') {",
        "  process.stdout.write(JSON.stringify({ id: 'task-restore', projectId: 'project-1', title: '恢复任务', status: 0, completedTime: null }));",
        '} else {',
        "  process.stderr.write('unexpected command: ' + JSON.stringify(args));",
        '  process.exitCode = 2;',
        '}',
      ].join('\n'),
      'utf8',
    );

    cliSettingsState.executable = `"${process.execPath}" "${fakeCliPath}"`;
    try {
      const provider = new TickTickCliProvider();
      await provider.setTaskCompleted(
        {
          id: 'task-restore',
          source: 'ticktick',
          externalId: 'task-restore',
          projectId: 'project-1',
          title: '恢复任务',
          status: 'completed',
          isCompleted: true,
          priority: null,
          dueDate: null,
          tags: [],
          content: null,
        },
        false,
      );
      const calls = fs
        .readFileSync(callsPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as string[]);
      expect(calls).toEqual([
        ['task', 'filter', '--status', '0', '--json'],
        [
          'task',
          'update',
          'task-restore',
          '--id',
          'task-restore',
          '--project',
          'project-1',
          '--status',
          '0',
          '--json',
        ],
      ]);
    } finally {
      cliSettingsState.executable = '';
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('dida output policy', () => {
  it('classifies exit-code-zero undefined output as a failure sentinel', () => {
    expect(isUndefinedCliOutput('  undefined\r\n')).toBe(true);
    expect(isUndefinedCliOutput('{"id":"ok"}')).toBe(false);
  });

  it('uses execFile argv for Chinese/newline text and rejects real exit-zero undefined output', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-cli-test-'));
    const capturePath = path.join(tempDir, 'argv.json');
    const fakeCliPath = path.join(tempDir, 'fake-dida.mjs');
    fs.writeFileSync(
      fakeCliPath,
      [
        "import fs from 'node:fs';",
        `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(process.argv.slice(2)));`,
        "if (process.argv[2] === 'undefined-test') process.stdout.write('undefined\\n');",
        'else process.stdout.write(JSON.stringify({ ok: true }));',
      ].join('\n'),
      'utf8',
    );

    cliSettingsState.executable = `"${process.execPath}" "${fakeCliPath}"`;
    const text = '专注 25 分钟\n[FocusLink:segment:seg-argv]';
    try {
      const success = await testCommand(
        `dida task comment add project task --title "${text}" --json`,
        5000,
      );
      expect(success.status).toBe('success');
      expect(success.stdout).toBe('{"ok":true}');
      expect(JSON.parse(fs.readFileSync(capturePath, 'utf8'))).toEqual([
        'task',
        'comment',
        'add',
        'project',
        'task',
        '--title',
        text,
        '--json',
      ]);

      const undefinedResult = await testCommand('dida undefined-test', 5000);
      expect(undefinedResult).toMatchObject({
        status: 'failed',
        error: 'dida 返回 undefined',
      });
    } finally {
      cliSettingsState.executable = '';
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
