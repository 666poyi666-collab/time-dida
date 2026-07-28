/** Executable entry for the loopback contract-test backend only. */
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_DEVICE_SYNC_TEST_ACCOUNT,
  DEFAULT_DEVICE_SYNC_TEST_HOST,
  DEFAULT_DEVICE_SYNC_TEST_PORT,
  DEFAULT_DEVICE_SYNC_TEST_ORIGINS,
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
  pairingExchange?: (nonce: string, deviceId: string) => { accessToken: string } | null;
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

export const PERSONAL_CLOUD_RETIRED_MESSAGE =
  'retired: Account Durable Object is the only FocusLink production authority';

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
    pairingExchange: options.pairingExchange,
    store: createDeviceSyncCloudStore({ persistencePath: options.persistencePath }),
  });
  await server.listen();
  return server;
}

export async function startPersonalCloud(
  _options: StartPersonalCloudOptions,
): Promise<DeviceSyncCloudServer> {
  throw new Error(PERSONAL_CLOUD_RETIRED_MESSAGE);
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
  if (process.env.FOCUSLINK_CLOUD_MODE === 'production') {
    throw new Error(PERSONAL_CLOUD_RETIRED_MESSAGE);
  }
  const server = await startDeviceSyncTestBackend({
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
  process.stdout.write(`FocusLink test sync backend listening on http://${host}:${address.port}\n`);

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

if (isDirectExecution()) {
  void runFromCommandLine().catch((error) => {
    process.stderr.write(
      `FocusLink test sync backend failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
