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
  if (url.protocol !== 'focuslink:') return null;
  // Chromium ~85 之前把非标准 scheme 当 opaque path 解析：hostname 为空、
  // pathname 是 "//pair"（手表的 WebView 停在 Chrome 83，正是这条路径）；
  // 新引擎则给出 hostname === 'pair'。两种形态都必须接受，否则老 WebView
  // 上每一个合法配对链接都会被当成无效。
  const target = url.hostname || url.pathname.replace(/^\/+/, '').replace(/[/?#].*$/, '');
  if (target !== 'pair') return null;
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
