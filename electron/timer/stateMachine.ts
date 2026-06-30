// 计时器状态机 - 纯函数，无副作用
// 核心状态转换：idle/running/paused/finished
// 不允许用散乱 boolean，所有转换都通过这个状态机
import type { TimerState, TimerEvent } from '@shared/types';

export interface StateMachineResult {
  newState: TimerState;
  ok: boolean;
  reason?: string;
}

/**
 * 状态转换表
 * idle + START -> running
 * running + PAUSE -> paused
 * paused + RESUME -> running
 * running + STOP -> finished
 * paused + STOP -> finished
 * finished + RESET -> idle
 */
const TRANSITIONS: Record<TimerState, Partial<Record<TimerEvent, TimerState>>> = {
  idle: { START: 'running' },
  running: { PAUSE: 'paused', STOP: 'finished' },
  paused: { RESUME: 'running', STOP: 'finished' },
  stopping: { STOP: 'finished' },
  finished: { RESET: 'idle' },
};

export function transition(current: TimerState, event: TimerEvent): StateMachineResult {
  const next = TRANSITIONS[current]?.[event];
  if (!next) {
    return {
      newState: current,
      ok: false,
      reason: `非法状态转换: ${current} + ${event}`,
    };
  }
  return { newState: next, ok: true };
}

/** Toggle 行为：根据当前状态决定 START/PAUSE/RESUME */
export function getToggleEvent(state: TimerState): TimerEvent | null {
  switch (state) {
    case 'idle':
      return 'START';
    case 'running':
      return 'PAUSE';
    case 'paused':
      return 'RESUME';
    default:
      return null;
  }
}

export function isTerminal(state: TimerState): boolean {
  return state === 'finished';
}
