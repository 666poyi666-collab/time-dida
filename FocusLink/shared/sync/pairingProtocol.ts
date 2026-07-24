import { DEVICE_SYNC_PROTOCOL_VERSION, normalizeDeviceSyncEndpoint } from './deviceProtocol';

export interface DeviceSyncPairingLink {
  protocolVersion: number;
  endpoint: string;
  nonce: string;
  expiresAt: number;
}

export function createDeviceSyncPairingUrl(input: DeviceSyncPairingLink): string {
  const url = new URL('focuslink://pair');
  url.searchParams.set('protocolVersion', String(input.protocolVersion));
  url.searchParams.set('endpoint', normalizeDeviceSyncEndpoint(input.endpoint));
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('expiresAt', String(input.expiresAt));
  return url.toString();
}

export function parseDeviceSyncPairingUrl(
  rawUrl: string,
  now = Date.now(),
): DeviceSyncPairingLink | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'focuslink:' || url.hostname !== 'pair') return null;
  const protocolVersion = Number(url.searchParams.get('protocolVersion'));
  const nonce = url.searchParams.get('nonce') ?? '';
  const expiresAt = Number(url.searchParams.get('expiresAt'));
  if (
    protocolVersion !== DEVICE_SYNC_PROTOCOL_VERSION ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(nonce) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now
  ) {
    return null;
  }
  try {
    return {
      protocolVersion,
      endpoint: normalizeDeviceSyncEndpoint(url.searchParams.get('endpoint') ?? ''),
      nonce,
      expiresAt,
    };
  } catch {
    return null;
  }
}
