import { DEVICE_SYNC_MAX_BODY_BYTES } from './deviceProtocol';

export async function readDeviceSyncResponseText(
  response: Response,
  byteLimit = DEVICE_SYNC_MAX_BODY_BYTES,
): Promise<string> {
  const declaredHeader = response.headers.get('content-length');
  if (declaredHeader !== null) {
    const declaredLength = Number(declaredHeader);
    if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
      throw new Error('同步服务响应超过允许的字节上限');
    }
  }

  if (!response.body) {
    const fallback = await response.text();
    if (new TextEncoder().encode(fallback).byteLength > byteLimit) {
      throw new Error('同步服务响应超过允许的字节上限');
    }
    return fallback;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > byteLimit) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the byte-limit error when a hostile stream also rejects cancellation.
      }
      throw new Error('同步服务响应超过允许的字节上限');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('同步服务响应不是有效 UTF-8');
  }
}

export async function readDeviceSyncJsonResponse(
  response: Response,
  byteLimit = DEVICE_SYNC_MAX_BODY_BYTES,
): Promise<unknown> {
  const text = await readDeviceSyncResponseText(response, byteLimit);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('同步服务没有返回有效 JSON');
  }
}
