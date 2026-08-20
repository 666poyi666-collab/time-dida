export class BoundedBodyError extends Error {
  constructor(readonly reason: "too_large" | "unreadable") {
    super(reason);
  }
}

export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  headers: Headers,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declared = headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maximumBytes) {
    await body?.cancel().catch(() => undefined);
    throw new BoundedBodyError("too_large");
  }
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BoundedBodyError("too_large");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof BoundedBodyError) throw error;
    await reader.cancel().catch(() => undefined);
    throw new BoundedBodyError("unreadable");
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}
