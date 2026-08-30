import type {
  DeviceSyncManagedDevice,
  DeviceSyncStatus,
  TomatodoBridgeStatus,
} from '@shared/ipc/api';
import { managedDeviceStateLabel } from '@shared/deviceRosterPolicy';

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

export type SettingsFactTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface SettingsStatusFact {
  label: string;
  value: string;
  detail: string;
  tone: SettingsFactTone;
}

export interface DeviceSyncOverviewPresentation {
  connection: SettingsStatusFact;
  latestSuccess: SettingsStatusFact;
}

export interface ObservedTimePresentation {
  relative: string;
  exact: string | null;
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
      title: '最近一次同步尝试未完成',
      detail:
        value === 'timeout'
          ? '最近一次云端请求超时；本机数据已保留，这不等同于当前设备离线。'
          : '最近一次云端请求未建立连接；本机数据已保留，这不等同于当前设备离线。',
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
      title: '最近一次设备凭据校验未通过',
      detail: '本机数据已保留；请用另一台设备的 8 位码重新配对后再同步。',
    };
  }

  if (value === 'authorization_failed') {
    return {
      kind: 'authorization-failed',
      tone: 'danger',
      title: '最近一次设备授权被拒绝',
      detail: '本机数据已保留；请确认该设备仍在已配对设备列表中。',
    };
  }

  if (value === 'contract_error') {
    return {
      kind: 'sync-failed',
      tone: 'danger',
      title: '最近一次同步尝试失败',
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
      title: '最近一次同步尝试失败',
      detail: '云端账本超过单次同步上限，请稍后重试。',
    };
  }

  if (value === 'cursor_ahead') {
    return {
      kind: 'sync-failed',
      tone: 'danger',
      title: '最近一次同步尝试失败',
      detail: '本机同步游标异常，已保留数据等待重新同步。',
    };
  }

  if (value === 'invalid_exchange_request') {
    return {
      kind: 'sync-failed',
      tone: 'danger',
      title: '最近一次同步尝试失败',
      detail: '本机同步请求未通过校验，请稍后重试。',
    };
  }

  return {
    kind: 'sync-failed',
    tone: 'danger',
    title: '最近一次同步尝试失败',
    detail: '云端同步暂时失败，请稍后重试。',
  };
}

export function presentObservedTime(
  timestamp: number | null | undefined,
  now = Date.now(),
): ObservedTimePresentation {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    return { relative: '尚无记录', exact: null };
  }

  const exact = new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const elapsed = now - timestamp;
  if (elapsed < -60_000) return { relative: '设备时间待校准', exact };
  if (elapsed < 60_000) return { relative: '刚刚', exact };
  if (elapsed < 60 * 60_000) {
    return { relative: `${Math.floor(elapsed / 60_000)} 分钟前`, exact };
  }
  if (elapsed < 24 * 60 * 60_000) {
    return { relative: `${Math.floor(elapsed / (60 * 60_000))} 小时前`, exact };
  }
  if (elapsed < 7 * 24 * 60 * 60_000) {
    return { relative: `${Math.floor(elapsed / (24 * 60 * 60_000))} 天前`, exact };
  }
  return { relative: exact, exact };
}

export function presentDeviceSyncOverview(
  status: DeviceSyncStatus | null | undefined,
  now = Date.now(),
): DeviceSyncOverviewPresentation {
  const observed = presentObservedTime(status?.lastSyncAt, now);
  const latestSuccess: SettingsStatusFact = status?.lastSyncAt
    ? {
        label: '最近账本确认',
        value: observed.relative,
        detail: observed.exact ?? '尚无成功同步时间',
        tone: 'success',
      }
    : {
        label: '最近账本确认',
        value: '尚无成功记录',
        detail: status?.signedIn ? '配对完成后等待第一次账本同步' : '配对后才会产生云端确认时间',
        tone: 'neutral',
      };

  if (!status) {
    return {
      connection: {
        label: '当前实时连接',
        value: '正在检查',
        detail: '正在读取设备同步状态',
        tone: 'neutral',
      },
      latestSuccess,
    };
  }

  if (!status.signedIn) {
    return {
      connection: {
        label: '当前实时连接',
        value: '未配对',
        detail: '输入另一台设备的 8 位本机码即可加入同步',
        tone: 'neutral',
      },
      latestSuccess,
    };
  }

  if (!status.enabled) {
    return {
      connection: {
        label: '当前实时连接',
        value: '同步已关闭',
        detail: '本机任务和专注记录仍会保留',
        tone: 'neutral',
      },
      latestSuccess,
    };
  }

  if (!status.liveControlEnabled) {
    return {
      connection: {
        label: '当前实时连接',
        value: '实时控制未启用',
        detail: status.running ? '账本同步正在执行' : '账本同步仍可单独执行',
        tone: status.running ? 'warning' : 'neutral',
      },
      latestSuccess,
    };
  }

  if (!status.liveConnected) {
    return {
      connection: {
        label: '当前实时连接',
        value: status.running ? '正在重新检查' : '尚未确认',
        detail: '本机计时可继续使用；刷新后确认当前网络状态',
        tone: 'warning',
      },
      latestSuccess,
    };
  }

  const liveStateLabel =
    status.liveState === 'running'
      ? '专注中'
      : status.liveState === 'paused'
        ? '暂停中'
        : status.liveState === 'idle'
          ? '空闲'
          : '状态待确认';
  return {
    connection: {
      label: '当前实时连接',
      value: '已确认',
      detail: `${liveStateLabel} · revision ${status.liveRevision ?? 0}`,
      tone: 'success',
    },
    latestSuccess,
  };
}

export function presentManagedDeviceActivity(
  device: DeviceSyncManagedDevice,
  now = Date.now(),
): SettingsStatusFact {
  const state = managedDeviceStateLabel(device);
  const observed = presentObservedTime(device.lastSeenAt, now);
  const detail = observed.exact ? `最近活动 ${observed.exact}` : '尚未上报最近活动时间';
  if (device.revokedAt !== null) {
    return { label: '设备状态', value: state, detail, tone: 'danger' };
  }
  if (device.expiresAt !== null && device.expiresAt <= now) {
    const expired = presentObservedTime(device.expiresAt, now);
    return {
      label: '设备状态',
      value: '设备凭据已过期',
      detail: expired.exact ? `凭据到期 ${expired.exact}` : detail,
      tone: 'danger',
    };
  }
  if (device.stale) {
    return { label: '设备状态', value: state, detail, tone: 'warning' };
  }
  return {
    label: '设备状态',
    value: state === '最近在线' ? `最近活动 ${observed.relative}` : state,
    detail,
    tone: 'neutral',
  };
}

export function presentTomatodoBridgeStatus(
  status: TomatodoBridgeStatus | null | undefined,
): SettingsStatusFact {
  if (!status) {
    return {
      label: '桌面桥接',
      value: '正在检查',
      detail: '正在读取番茄 To-do 运行状态',
      tone: 'neutral',
    };
  }
  if (status.state === 'connected') {
    return {
      label: '桌面桥接',
      value: '连接已确认',
      detail: '已校验番茄 To-do 窗口与桥接能力，可执行上传',
      tone: 'success',
    };
  }
  if (status.state === 'stopped') {
    return {
      label: '桌面桥接',
      value: '当前未连接',
      detail: '需要上传时可由手动操作按需启动',
      tone: 'neutral',
    };
  }
  if (status.state === 'restart-required') {
    return {
      label: '桌面桥接',
      value: '需要重新启动',
      detail: '番茄 To-do 已运行但没有可验证桥接，请完全退出后再连接',
      tone: 'warning',
    };
  }
  if (status.state === 'not-installed') {
    return {
      label: '桌面桥接',
      value: '未找到安装',
      detail: '未发现番茄 To-do 标准安装程序',
      tone: 'neutral',
    };
  }
  if (status.state === 'launch-timeout') {
    return {
      label: '桌面桥接',
      value: '最近连接超时',
      detail: '未在等待时间内发现经过身份校验的桥接窗口',
      tone: 'warning',
    };
  }
  return {
    label: '桌面桥接',
    value: '最近连接失败',
    detail: '未建立经过身份校验的桥接；可检查安装状态后重试',
    tone: 'danger',
  };
}
