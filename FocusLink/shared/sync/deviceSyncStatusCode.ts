export const DEVICE_SYNC_STATUS_ERROR_CODES = [
  'authentication_failed',
  'authorization_failed',
  'conflict_present',
  'contract_error',
  'cursor_ahead',
  'invalid_exchange_request',
  'network_error',
  'rejected_operation',
  'response_too_large',
  'sync_failed',
  'timeout',
] as const;

export type DeviceSyncStatusErrorCode = (typeof DEVICE_SYNC_STATUS_ERROR_CODES)[number];

const DEVICE_SYNC_STATUS_ERROR_CODE_SET = new Set<string>(DEVICE_SYNC_STATUS_ERROR_CODES);

/**
 * Convert retired localized durable values at the persistence boundary.
 * Renderer code must only classify the returned machine code.
 */
export function normalizeStoredDeviceSyncError(
  value: string | null | undefined,
): DeviceSyncStatusErrorCode | null {
  const raw = value?.trim() ?? '';
  if (!raw) return null;
  if (DEVICE_SYNC_STATUS_ERROR_CODE_SET.has(raw)) return raw as DeviceSyncStatusErrorCode;
  if (raw.includes('跨设备同步请求超时')) return 'timeout';
  if (raw.includes('无法连接跨设备同步服务')) return 'network_error';
  if (raw.includes('未解决的跨设备冲突')) return 'conflict_present';
  return 'sync_failed';
}

export function migrateStoredDeviceSyncError(
  value: string | null | undefined,
  persist: (normalized: DeviceSyncStatusErrorCode) => void,
): DeviceSyncStatusErrorCode | null {
  const raw = value?.trim() ?? '';
  const normalized = normalizeStoredDeviceSyncError(raw);
  if (raw && normalized && normalized !== raw) persist(normalized);
  return normalized;
}
