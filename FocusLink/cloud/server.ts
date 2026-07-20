/**
 * Executable entry for the local FocusLink device-sync test backend.
 *
 * Importing this module only exposes factories. It starts listening only when this exact file (or
 * its bundled server.mjs output) is the process entry point. This remains a test backend: the
 * environment variables below are convenience configuration, not a production account system.
 */
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_DEVICE_SYNC_TEST_ACCOUNT,
  DEFAULT_DEVICE_SYNC_TEST_HOST,
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
    port: options.port ?? 8787,
    allowedOrigins: options.allowedOrigins ?? DEFAULT_DEVICE_SYNC_TEST_ORIGINS,
    tokenAccounts: new Map([[token, accountId]]),
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

function parsePort(raw: string | undefined): number {
  if (!raw) return 8787;
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
  process.stdout.write(
    `FocusLink test sync backend listening on http://${host}:${address.port} (not for production)\n`,
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

if (isDirectExecution()) {
  void runFromCommandLine().catch((error) => {
    process.stderr.write(
      `FocusLink test sync backend failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
