import { createDeviceSyncPairingUrl } from '../../shared/sync/pairingProtocol.js';
import { openAndroidPairingLink } from './androidReverseBridge.js';
import { createEmbeddedPairingOffer } from './embeddedDeviceSyncServer.js';

export interface AndroidPairingProvisionResult {
  pairedAndroidDevices: string[];
  androidPairingErrors: Array<{ serial: string; error: string }>;
}

/** Gives every connected device its own single-use offer; a nonce is never shared. */
export async function provisionConnectedAndroidDevices(
  serials: string[],
): Promise<AndroidPairingProvisionResult> {
  const pairedAndroidDevices: string[] = [];
  const androidPairingErrors: Array<{ serial: string; error: string }> = [];
  for (const serial of serials) {
    try {
      const offer = await createEmbeddedPairingOffer();
      await openAndroidPairingLink(serial, createDeviceSyncPairingUrl(offer));
      pairedAndroidDevices.push(serial);
    } catch (error) {
      androidPairingErrors.push({
        serial,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { pairedAndroidDevices, androidPairingErrors };
}
