import type { DeviceSyncSessionBundle } from '@shared/sync/deviceProtocol';
import { completeOfflineFocusRuntime, type PendingDeviceSyncBundle } from './cache';
import { enqueueNativeCompletedLedgerBundle } from './nativeFocusRuntime';

/**
 * Production completion boundary used by MobileApp.
 *
 * The native mirror is attempted first so Android WorkManager can deliver
 * while the renderer is dead. IndexedDB remains the canonical foreground
 * outbox and is committed before the active draft can be discarded.
 */
export async function persistCompletedOfflineFocus(
  bundle: DeviceSyncSessionBundle,
  deviceId: string,
): Promise<{ nativeQueued: boolean; pending: PendingDeviceSyncBundle }> {
  const nativeQueued = await enqueueNativeCompletedLedgerBundle(bundle, deviceId).catch(
    () => false,
  );
  const pending = await completeOfflineFocusRuntime(bundle);
  return { nativeQueued, pending };
}
