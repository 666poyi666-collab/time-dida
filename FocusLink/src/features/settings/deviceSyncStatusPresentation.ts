export type DeviceSyncErrorKind =
  | 'transport-unavailable'
  | 'conflict-present'
  | 'operation-rejected'
  | 'authentication-failed'
  | 'authorization-failed'
  | 'sync-failed';

export interface DeviceSyncErrorPresentation {
  kind: DeviceSyncErrorKind;
  tone: 'warning' | 'danger';
  title: string;
  detail: string | null;
}

const TRANSPORT_ERROR_CODES = new Set(['network_error', 'timeout']);
const CONFLICT_ERROR_CODES = new Set(['conflict_present']);

/**
 * Convert the durable Sync v2 error code into the single Settings presentation.
 *
 * Sync v2 intentionally persists compact, credential-safe codes rather than
 * upstream response text. Retired localized values are migrated by the main
 * process before they cross IPC; renderer code only handles machine codes.
 */
export function presentDeviceSyncError(
  lastError: string | null | undefined,
  unresolvedConflicts: number | null | undefined = 0,
): DeviceSyncErrorPresentation | null {
  const value = lastError?.trim() ?? '';
  if (!value) return null;
  const conflictCount =
    typeof unresolvedConflicts === 'number' &&
    Number.isSafeInteger(unresolvedConflicts) &&
    unresolvedConflicts > 0
      ? unresolvedConflicts
      : 0;

  if (TRANSPORT_ERROR_CODES.has(value)) {
    return {
      kind: 'transport-unavailable',
      tone: 'warning',
      title: '同步服务未连接，配置已保存',
      detail:
        value === 'timeout'
          ? '云端同步请求超时；账号和本机数据已保留，将自动重试。'
          : '暂时无法连接云端同步服务；账号和本机数据已保留，将自动重试。',
    };
  }

  if (CONFLICT_ERROR_CODES.has(value)) {
    // A stale status code is not evidence of a durable conflict. Once the
    // authoritative count reaches zero, use the normal latest-success state.
    if (conflictCount === 0) return null;
    return {
      kind: 'conflict-present',
      tone: 'warning',
      title: '同步已连接，有记录待确认',
      detail: null,
    };
  }

  if (value === 'authentication_failed') {
    return {
      kind: 'authentication-failed',
      tone: 'danger',
      title: '登录凭据已失效',
      detail: '请重新登录 FocusLink 账号后继续同步。',
    };
  }

  if (value === 'authorization_failed') {
    return {
      kind: 'authorization-failed',
      tone: 'danger',
      title: '当前账号没有同步权限',
      detail: '请确认账号授权后重新登录 FocusLink 账号。',
    };
  }

  if (value === 'contract_error') {
    return {
      kind: 'sync-failed',
      tone: 'danger',
      title: '跨设备同步失败',
      detail: '云端响应或同步协议异常，请稍后重试。',
    };
  }

  if (value === 'rejected_operation') {
    return {
      kind: 'operation-rejected',
      tone: 'warning',
      title: '同步已连接，部分记录未同步',
      detail: '云端拒绝了部分同步记录；记录已安全保留，等待后续处理。',
    };
  }

  if (value === 'response_too_large') {
    return {
      kind: 'sync-failed',
      tone: 'danger',
      title: '跨设备同步失败',
      detail: '云端账本超过单次同步上限，请稍后重试。',
    };
  }

  if (value === 'cursor_ahead') {
    return {
      kind: 'sync-failed',
      tone: 'danger',
      title: '跨设备同步失败',
      detail: '本机同步游标异常，已保留数据等待重新同步。',
    };
  }

  if (value === 'invalid_exchange_request') {
    return {
      kind: 'sync-failed',
      tone: 'danger',
      title: '跨设备同步失败',
      detail: '本机同步请求未通过校验，请稍后重试。',
    };
  }

  return {
    kind: 'sync-failed',
    tone: 'danger',
    title: '跨设备同步失败',
    detail: '云端同步暂时失败，请稍后重试。',
  };
}
