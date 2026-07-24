import path from 'node:path';
import crypto from 'node:crypto';
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
const pairingOffers = new Map<string, number>();
const PAIRING_TTL_MS = 2 * 60_000;

export interface EmbeddedPairingOffer {
  protocolVersion: 1;
  endpoint: string;
  nonce: string;
  shortCode: string;
  expiresAt: number;
}

export async function createEmbeddedPairingOffer(): Promise<EmbeddedPairingOffer> {
  await reconcileEmbeddedDeviceSyncServer();
  const token = getDeviceSyncToken();
  if (!server || !token) throw new Error('请先启用本机同步并保存访问令牌');
  const now = Date.now();
  for (const [nonce, expiresAt] of pairingOffers) {
    if (expiresAt <= now) pairingOffers.delete(nonce);
  }
  const nonce = crypto.randomBytes(24).toString('base64url');
  const expiresAt = now + PAIRING_TTL_MS;
  pairingOffers.set(nonce, expiresAt);
  return {
    protocolVersion: 1,
    endpoint: embeddedEndpoint,
    nonce,
    shortCode: nonce.slice(0, 8).toUpperCase(),
    expiresAt,
  };
}

function consumePairingOffer(nonce: string): { accessToken: string } | null {
  const normalized = nonce.toLowerCase();
  const matchedNonce = pairingOffers.has(nonce)
    ? nonce
    : [...pairingOffers.keys()].find(
        (candidate) => candidate.slice(0, 8).toLowerCase() === normalized,
      );
  if (!matchedNonce) return null;
  const expiresAt = pairingOffers.get(matchedNonce);
  pairingOffers.delete(matchedNonce);
  if (!expiresAt || expiresAt <= Date.now()) return null;
  const accessToken = getDeviceSyncToken();
  return accessToken ? { accessToken } : null;
}

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
    pairingExchange: consumePairingOffer,
  });
  server = started;
  logger.info('deviceSync', 'embedded loopback service started', {
    endpoint: embeddedEndpoint,
  });
}
