import type {
  LiveFocusCommandAck,
  LiveFocusCommandResponse,
  LiveFocusState,
} from '@shared/sync/liveFocusProtocol';
import type { LiveFocusSnapshotLike } from './runtimeModel';
import { shouldAcceptLiveSnapshot } from '@shared/sync/liveSnapshotPolicy';

export type LiveSnapshotSource = 'none' | 'cache' | 'server' | 'local';

export function restoreCachedLiveSnapshot(
  cached: LiveFocusSnapshotLike | null,
  configured: boolean,
): LiveFocusSnapshotLike | null {
  return configured ? cached : null;
}

/**
 * A live snapshot is a compare-and-swap register, not mergeable document data.
 * Revisions only move forward; equal revisions may refresh elapsed materialization
 * but may never change the session identity or state.
 */
export function shouldApplyLiveSnapshot(
  current: LiveFocusSnapshotLike | null,
  incoming: LiveFocusSnapshotLike,
): boolean {
  return shouldAcceptLiveSnapshot(current, incoming);
}

export function commandAckNotice(
  action: 'start' | 'pause' | 'resume' | 'finish',
  expectedRevision: number,
  response: LiveFocusCommandResponse,
): string {
  const { ack } = response;
  const currentState = response.snapshot.state;
  if (ack.status === 'applied') return appliedCopy(action);
  if (ack.status === 'duplicate') {
    return `重复请求未再次执行；云端当前为${stateLabel(currentState)}（rev ${response.snapshot.revision}）`;
  }
  if (ack.status === 'conflict') {
    if (actionResultState(action) === currentState) {
      return `操作未重复执行；云端已经是${stateLabel(currentState)}（rev ${response.snapshot.revision}）`;
    }
    return `操作未执行：提交基于 rev ${expectedRevision}，云端当前为 rev ${response.snapshot.revision} · ${stateLabel(currentState)}`;
  }
  return rejectionCopy(ack, currentState, response.snapshot.revision);
}

export function nativeCommandAckNotice(
  source: 'notification' | 'quick-settings',
  action: 'pause' | 'resume' | 'finish',
  expectedRevision: number,
  response: LiveFocusCommandResponse,
): string {
  const prefix = source === 'notification' ? '通知动作' : '快捷设置动作';
  if (response.ack.status === 'applied') {
    return `${prefix}${appliedCopy(action).replace('云端已确认', '已确认')}`;
  }
  if (response.ack.status === 'duplicate') {
    return `${prefix}未重复执行；云端当前为${stateLabel(response.snapshot.state)}（rev ${response.snapshot.revision}）`;
  }
  return `${prefix}${commandAckNotice(action, expectedRevision, response)}`;
}

function appliedCopy(action: 'start' | 'pause' | 'resume' | 'finish'): string {
  if (action === 'start') return '云端已确认开始；其他在线设备将按新版本更新';
  if (action === 'pause') return '云端已确认暂停';
  if (action === 'resume') return '云端已确认继续';
  return '云端已确认结束，正在收敛已结束账本';
}

function rejectionCopy(ack: LiveFocusCommandAck, state: LiveFocusState, revision: number): string {
  const suffix = `；云端保持${stateLabel(state)}（rev ${revision}）`;
  if (ack.errorCode === 'active_session_exists') return `操作未执行：已有活动会话${suffix}`;
  if (ack.errorCode === 'session_mismatch') return `操作未执行：会话已切换${suffix}`;
  if (ack.errorCode === 'no_active_session') return `操作未执行：当前没有活动会话${suffix}`;
  if (ack.errorCode === 'not_running' || ack.errorCode === 'not_paused') {
    return `操作未执行：当前状态不接受这条命令${suffix}`;
  }
  return `云端拒绝操作${ack.errorCode ? `：${ack.errorCode}` : ''}${suffix}`;
}

function actionResultState(action: 'start' | 'pause' | 'resume' | 'finish'): LiveFocusState {
  if (action === 'pause') return 'paused';
  if (action === 'finish') return 'idle';
  return 'running';
}

function stateLabel(state: LiveFocusState): string {
  if (state === 'running') return '专注中';
  if (state === 'paused') return '已暂停';
  return '待开始';
}
