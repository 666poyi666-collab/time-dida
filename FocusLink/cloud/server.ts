/** Executable entry for loopback contract tests and a deployable single-account personal cloud. */
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_DEVICE_SYNC_TEST_ACCOUNT,
  DEFAULT_DEVICE_SYNC_TEST_HOST,
  DEFAULT_DEVICE_SYNC_TEST_PORT,
  DEFAULT_DEVICE_SYNC_TEST_ORIGINS,
  DEVICE_SYNC_NATIVE_ORIGINS,
  createDeviceSyncCloudServer,
  type DeviceSyncCloudServer,
} from './deviceSyncServer';
import { createDeviceSyncCloudStore } from './deviceSyncStore';

export * from './deviceSyncServer';
export * from './deviceSyncStore';

export interface StartDeviceSyncTestBackendOptions {
  host?: string;
  port?: number;
  token?: string;
  accountId?: string;
  allowedOrigins?: readonly string[];
  persistencePath?: string;
}

export interface PersonalCloudAccount {
  accountId: string;
  accessToken: string;
}

export interface StartPersonalCloudOptions {
  host?: string;
  port?: number;
  accounts: readonly PersonalCloudAccount[];
  allowedOrigins: readonly string[];
  persistencePath: string;
  requireForwardedHttps?: boolean;
  maxRequestsPerMinute?: number;
}

export async function startDeviceSyncTestBackend(
  options: StartDeviceSyncTestBackendOptions = {},
): Promise<DeviceSyncCloudServer> {
  const token = options.token?.trim();
  const accountId = options.accountId ?? DEFAULT_DEVICE_SYNC_TEST_ACCOUNT;
  if (!token || token.length < 16 || !accountId) {
    throw new Error(
      'set FOCUSLINK_CLOUD_TEST_TOKEN to a test credential of at least 16 characters',
    );
  }

  const server = createDeviceSyncCloudServer({
    host: options.host ?? DEFAULT_DEVICE_SYNC_TEST_HOST,
    port: options.port ?? DEFAULT_DEVICE_SYNC_TEST_PORT,
    allowedOrigins: options.allowedOrigins ?? DEFAULT_DEVICE_SYNC_TEST_ORIGINS,
    tokenAccounts: new Map([[token, accountId]]),
    store: createDeviceSyncCloudStore({ persistencePath: options.persistencePath }),
  });
  await server.listen();
  return server;
}

export async function startPersonalCloud(
  options: StartPersonalCloudOptions,
): Promise<DeviceSyncCloudServer> {
  if (options.accounts.length === 0) throw new Error('at least one cloud account is required');
  if (options.allowedOrigins.length === 0) throw new Error('at least one HTTPS origin is required');
  const tokenAccounts = new Map<string, string>();
  for (const account of options.accounts) {
    const accountId = account.accountId.trim();
    const accessToken = account.accessToken.trim();
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(accountId)) {
      throw new Error('cloud accountId must use 1-200 safe characters');
    }
    if (accessToken.length < 32 || /\s/.test(accessToken)) {
      throw new Error(`cloud token for ${accountId} must contain at least 32 non-space characters`);
    }
    if (tokenAccounts.has(accessToken)) throw new Error('cloud access tokens must be unique');
    tokenAccounts.set(accessToken, accountId);
  }
  for (const origin of options.allowedOrigins) {
    const url = new URL(origin);
    if (url.origin !== origin || url.protocol !== 'https:') {
      throw new Error(`production origin must be an exact HTTPS origin: ${origin}`);
    }
  }
  const server = createDeviceSyncCloudServer({
    host: options.host ?? '0.0.0.0',
    port: options.port ?? 8787,
    profile: 'personal-cloud',
    requireForwardedHttps: options.requireForwardedHttps ?? true,
    maxRequestsPerMinute: options.maxRequestsPerMinute ?? 600,
    allowedOrigins: [...new Set([...options.allowedOrigins, ...DEVICE_SYNC_NATIVE_ORIGINS])],
    tokenAccounts,
    store: createDeviceSyncCloudStore({ persistencePath: options.persistencePath }),
  });
  await server.listen();
  return server;
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function parsePort(raw: string | undefined, fallback = DEFAULT_DEVICE_SYNC_TEST_PORT): number {
  if (!raw) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('FOCUSLINK_CLOUD_TEST_PORT must be an integer between 0 and 65535');
  }
  return port;
}

function parseOrigins(raw: string | undefined): readonly string[] {
  if (!raw) return DEFAULT_DEVICE_SYNC_TEST_ORIGINS;
  const origins = [
    ...new Set(
      raw
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ];
  if (origins.length === 0) throw new Error('FOCUSLINK_CLOUD_TEST_ORIGINS must not be empty');
  return origins;
}

async function runFromCommandLine(): Promise<void> {
  const production = process.env.FOCUSLINK_CLOUD_MODE === 'production';
  const server = production
    ? await startPersonalCloud({
        host: process.env.HOST,
        port: parsePort(process.env.PORT, 8787),
        accounts: parseProductionAccounts(process.env.FOCUSLINK_CLOUD_ACCOUNTS),
        allowedOrigins: parseProductionOrigins(process.env.FOCUSLINK_CLOUD_ALLOWED_ORIGINS),
        persistencePath:
          process.env.FOCUSLINK_CLOUD_STORE ?? path.resolve('/data', 'focuslink-cloud.json'),
        requireForwardedHttps: process.env.FOCUSLINK_CLOUD_REQUIRE_HTTPS !== 'false',
        maxRequestsPerMinute: parsePositiveInteger(
          process.env.FOCUSLINK_CLOUD_RATE_LIMIT,
          600,
          'FOCUSLINK_CLOUD_RATE_LIMIT',
        ),
      })
    : await startDeviceSyncTestBackend({
        host: process.env.FOCUSLINK_CLOUD_TEST_HOST,
        port: parsePort(process.env.FOCUSLINK_CLOUD_TEST_PORT),
        token: process.env.FOCUSLINK_CLOUD_TEST_TOKEN,
        accountId: process.env.FOCUSLINK_CLOUD_TEST_ACCOUNT,
        allowedOrigins: parseOrigins(process.env.FOCUSLINK_CLOUD_TEST_ORIGINS),
        persistencePath:
          process.env.FOCUSLINK_CLOUD_TEST_STORE ?? path.resolve('.tmp', 'device-sync-cloud.json'),
      });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('test backend has no TCP address');
  const host = address.address.includes(':') ? `[${address.address}]` : address.address;
  process.stdout.write(
    `FocusLink ${production ? 'personal cloud' : 'test sync backend'} listening on http://${host}:${address.port}\n`,
  );

  const stop = (signal: NodeJS.Signals) => {
    void server
      .close()
      .then(() => {
        process.stdout.write(`FocusLink test sync backend stopped by ${signal}\n`);
      })
      .catch((error) => {
        process.stderr.write(
          `FocusLink test sync backend shutdown failed: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
        process.exitCode = 1;
      });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

function parseProductionAccounts(raw: string | undefined): PersonalCloudAccount[] {
  if (!raw) throw new Error('FOCUSLINK_CLOUD_ACCOUNTS is required in production mode');
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('FOCUSLINK_CLOUD_ACCOUNTS must be valid JSON');
  }
  if (!Array.isArray(value)) throw new Error('FOCUSLINK_CLOUD_ACCOUNTS must be a JSON array');
  return value.map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      Array.isArray(item) ||
      typeof (item as Record<string, unknown>).accountId !== 'string' ||
      typeof (item as Record<string, unknown>).accessToken !== 'string'
    ) {
      throw new Error('each cloud account requires string accountId and accessToken');
    }
    return {
      accountId: (item as Record<string, string>).accountId,
      accessToken: (item as Record<string, string>).accessToken,
    };
  });
}

function parseProductionOrigins(raw: string | undefined): string[] {
  if (!raw) throw new Error('FOCUSLINK_CLOUD_ALLOWED_ORIGINS is required in production mode');
  return [
    ...new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

if (isDirectExecution()) {
  void runFromCommandLine().catch((error) => {
    process.stderr.write(
      `FocusLink test sync backend failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
