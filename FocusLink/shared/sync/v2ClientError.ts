export type SyncV2ClientErrorCode =
  | 'aborted'
  | 'authentication_failed'
  | 'authorization_failed'
  | 'contract_error'
  | 'cursor_ahead'
  | 'network_error'
  | 'response_too_large'
  | 'sync_failed'
  | 'timeout';

export class SyncV2ClientError extends Error {
  readonly code: SyncV2ClientErrorCode;

  constructor(code: SyncV2ClientErrorCode, message?: string) {
    super(message ?? `canonical Sync v2 failed (${code})`);
    this.name = 'SyncV2ClientError';
    this.code = code;
  }
}

/**
 * Reduces arbitrary transport/runtime failures to a fixed, non-secret code.
 * Upstream bodies, request headers and exception messages must never become
 * durable status or log fields.
 */
export function classifySyncV2Error(error: unknown): SyncV2ClientErrorCode {
  if (error instanceof SyncV2ClientError) return error.code;
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted';
  if (error instanceof TypeError) return 'network_error';

  const message = error instanceof Error ? error.message : '';
  if (/\b401\b|authentication[_ -]?failed/i.test(message)) return 'authentication_failed';
  if (
    /\b403\b|authorization[_ -]?failed|scope (?:missing|insufficient|denied)|(?:missing|insufficient|denied) scope/i.test(
      message,
    )
  ) {
    return 'authorization_failed';
  }
  if (/超时|timeout/i.test(message)) return 'timeout';
  if (/超过允许的字节上限|too large/i.test(message)) return 'response_too_large';
  if (/cursor.*ahead|ahead.*cursor/i.test(message)) return 'cursor_ahead';
  if (/响应|response|cursor|epoch|ACK|change feed|格式|JSON|UTF-8|revision/i.test(message)) {
    return 'contract_error';
  }
  return 'sync_failed';
}

export function safeSyncV2Error(error: unknown): SyncV2ClientError {
  if (error instanceof SyncV2ClientError) return error;
  const code = classifySyncV2Error(error);
  return new SyncV2ClientError(code);
}
