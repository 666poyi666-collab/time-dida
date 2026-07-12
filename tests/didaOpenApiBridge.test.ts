import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reopenDidaTaskViaOpenApi } from '../electron/integrations/ticktick/didaOpenApiBridge';

const tempDirs: string[] = [];

function makeConfig(token = 'secret-test-token'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-dida-bridge-'));
  tempDirs.push(dir);
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ access_token: token }), 'utf8');
  return configPath;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('dida Open API reopen bridge', () => {
  it('reads the CLI token privately, preserves writable task fields, and verifies the reopen', async () => {
    const current = {
      id: 'task-1',
      projectId: 'project-1',
      title: '中文任务',
      content: '保留正文',
      priority: 5,
      tags: ['学习'],
      reminders: ['TRIGGER:PT0S'],
      focusSummaries: [
        { estimatedPomo: 2, estimatedDuration: 3_600, pomoCount: 8, pomoDuration: 12_000 },
      ],
      status: 2,
      completedTime: '2026-07-12T01:02:03.000Z',
    };
    // Real dida keeps the historical completedTime even though status=0 means reopened.
    const reopened = { ...current, status: 0 };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(current))
      .mockResolvedValueOnce(jsonResponse(reopened))
      .mockResolvedValueOnce(jsonResponse(reopened));

    await expect(
      reopenDidaTaskViaOpenApi('project-1', 'task-1', {
        configPath: makeConfig(),
        fetchImpl,
        baseUrl: 'https://example.invalid/open/v1/',
      }),
    ).resolves.toMatchObject({
      id: 'task-1',
      status: 0,
      completedTime: '2026-07-12T01:02:03.000Z',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://example.invalid/open/v1/project/project-1/task/task-1',
    );
    expect(fetchImpl.mock.calls[1][0]).toBe('https://example.invalid/open/v1/task/task-1');
    const updateInit = fetchImpl.mock.calls[1][1];
    expect(updateInit?.method).toBe('POST');
    expect(JSON.parse(String(updateInit?.body))).toEqual({
      id: 'task-1',
      projectId: 'project-1',
      title: '中文任务',
      status: 0,
      completedTime: null,
      content: '保留正文',
      reminders: ['TRIGGER:PT0S'],
      priority: 5,
      tags: ['学习'],
      focusSummaries: [{ estimatedPomo: 2, estimatedDuration: 3_600 }],
    });
    expect(String(updateInit?.body)).not.toContain('secret-test-token');
    expect(String(fetchImpl.mock.calls[1][0])).not.toContain('secret-test-token');
  });

  it('does not report success when dida accepts the update but keeps the task completed', async () => {
    const completed = {
      id: 'task-1',
      projectId: 'project-1',
      title: '任务',
      status: 2,
      completedTime: '2026-07-12T01:02:03.000Z',
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(completed))
      .mockResolvedValueOnce(jsonResponse(completed))
      .mockResolvedValueOnce(jsonResponse(completed));

    await expect(
      reopenDidaTaskViaOpenApi('project-1', 'task-1', {
        configPath: makeConfig(),
        fetchImpl,
      }),
    ).rejects.toThrow(/仍为已完成状态/);
  });

  it('returns a precise relogin error without exposing the token', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('expired', { status: 401 }));
    const error = await reopenDidaTaskViaOpenApi('project-1', 'task-1', {
      configPath: makeConfig(),
      fetchImpl,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/dida auth login/);
    expect((error as Error).message).not.toContain('secret-test-token');
  });

  it('bounds a stalled bridge request with a precise timeout error', async () => {
    const timeout = new Error('aborted');
    timeout.name = 'TimeoutError';
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(timeout);
    await expect(
      reopenDidaTaskViaOpenApi('project-1', 'task-1', {
        configPath: makeConfig(),
        fetchImpl,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/请求超时（1000ms）/);
  });
});
