import crypto from 'node:crypto';
import { getDeviceSyncToken } from './deviceSyncCredentials.js';
import { ensureAndroidReverseBridges } from './androidReverseBridge.js';
import { provisionConnectedAndroidDevices } from './androidPairingProvisioner.js';
import {
  AndroidSyncCoordinator,
  type AndroidSyncCoordinationResult,
} from './androidSyncCoordinatorPolicy.js';

function currentCredentialGeneration(): string | null {
  const token = getDeviceSyncToken();
  return token ? crypto.createHash('sha256').update(token).digest('hex') : null;
}

const coordinator = new AndroidSyncCoordinator({
  ensureBridges: ensureAndroidReverseBridges,
  provisionDevices: provisionConnectedAndroidDevices,
  credentialGeneration: currentCredentialGeneration,
});

export function coordinateAndroidSyncDevices(): Promise<AndroidSyncCoordinationResult> {
  return coordinator.coordinate();
}
