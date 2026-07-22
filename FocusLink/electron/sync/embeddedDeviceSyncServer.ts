import path from 'node:path';
import { app } from 'electron';
import {
  DEFAULT_DEVICE_SYNC_TEST_HOST,
  DEFAULT_DEVICE_SYNC_TEST_PORT,
  startDeviceSyncTestBackend,
  type DeviceSyncCloudServer,
} from '../../cloud/server.js';
import { getSettings } from '../settingsStore.js';
import { logger } from '../logger.js';
import { getDeviceSyncToken } from './deviceSyncCredentials.js';

const embeddedPort =
  process.env.VITEST && Number.isInteger(Number(process.env.FOCUSLINK_EMBEDDED_DEVICE_SYNC_PORT))
    ? Number(process.env.FOCUSLINK_EMBEDDED_DEVICE_SYNC_PORT)
    : DEFAULT_DEVICE_SYNC_TEST_PORT;
const embeddedEndpoint = `http://${DEFAULT_DEVICE_SYNC_TEST_HOST}:${embeddedPort}`;
export const EMBEDDED_DEVICE_SYNC_ENDPOINT = embeddedEndpoint;

let server: DeviceSyncCloudServer | null = null;
let operationTail: Promise<void> = Promise.resolve();

export function reconcileEmbeddedDeviceSyncServer(): Promise<void> {
  const operation = operationTail.then(reconcileInternal);
  operationTail = operation.catch(() => undefined);
  return operation;
}

export async function closeEmbeddedDeviceSyncServer(): Promise<void> {
  await operationTail;
  if (!server) return;
  const current = server;
  server = null;
  await current.close();
  logger.info('deviceSync', 'embedded loopback service stopped');
}

async function reconcileInternal(): Promise<void> {
  const settings = getSettings().deviceSync;
  const endpoint = settings.endpoint.trim().replace(/\/$/, '');
  const token = settings.enabled ? getDeviceSyncToken() : null;
  const shouldRun = settings.enabled && endpoint === embeddedEndpoint && Boolean(token);

  if (!shouldRun) {
    if (server) {
      const current = server;
      server = null;
      await current.close();
      logger.info('deviceSync', 'embedded loopback service disabled');
    }
    return;
  }
  if (server) return;

  const started = await startDeviceSyncTestBackend({
    host: DEFAULT_DEVICE_SYNC_TEST_HOST,
    port: embeddedPort,
    token: token!,
    persistencePath: path.join(app.getPath('userData'), 'focuslink-device-sync-local.json'),
  });
  server = started;
  logger.info('deviceSync', 'embedded loopback service started', {
    endpoint: embeddedEndpoint,
  });
}
