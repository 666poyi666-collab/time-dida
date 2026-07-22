import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startPersonalCloud, type DeviceSyncCloudServer } from '../cloud/server';

const TOKEN = 'personal-cloud-token-with-more-than-32-characters';

describe('deployable personal cloud entry', () => {
  const servers: DeviceSyncCloudServer[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  async function start(maxRequestsPerMinute = 600) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-personal-cloud-'));
    directories.push(directory);
    const server = await startPersonalCloud({
      host: '127.0.0.1',
      port: 0,
      accounts: [{ accountId: 'owner', accessToken: TOKEN }],
      allowedOrigins: ['https://focus.example'],
      persistencePath: path.join(directory, 'store.json'),
      requireForwardedHttps: true,
      maxRequestsPerMinute,
    });
    servers.push(server);
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');
    return `http://127.0.0.1:${address.port}`;
  }

  it('reports production health and rejects non-HTTPS application traffic', async () => {
    const url = await start();
    await expect(fetch(`${url}/health`).then((response) => response.json())).resolves.toMatchObject(
      {
        production: true,
        service: 'focuslink-device-sync-personal-cloud',
      },
    );

    const insecure = await fetch(`${url}/v1/live`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(insecure.status).toBe(400);
    await expect(insecure.json()).resolves.toMatchObject({ error: { code: 'https_required' } });

    const secure = await fetch(`${url}/v1/live`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'X-Forwarded-Proto': 'https',
        Origin: 'https://focus.example',
      },
    });
    expect(secure.status).toBe(200);
    expect(secure.headers.get('x-frame-options')).toBe('DENY');
    expect(secure.headers.get('access-control-allow-origin')).toBe('https://focus.example');

    const native = await fetch(`${url}/v1/live`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'X-Forwarded-Proto': 'https',
        Origin: 'https://localhost',
      },
    });
    expect(native.status).toBe(200);
    expect(native.headers.get('access-control-allow-origin')).toBe('https://localhost');
  });

  it('validates production credentials and enforces the process safety limit', async () => {
    await expect(
      startPersonalCloud({
        accounts: [{ accountId: 'owner', accessToken: 'too-short' }],
        allowedOrigins: ['https://focus.example'],
        persistencePath: path.join(os.tmpdir(), 'unused-focuslink-store.json'),
      }),
    ).rejects.toThrow(/at least 32/);

    const url = await start(2);
    expect((await fetch(`${url}/health`)).status).toBe(200);
    expect((await fetch(`${url}/health`)).status).toBe(200);
    const limited = await fetch(`${url}/health`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });
});
