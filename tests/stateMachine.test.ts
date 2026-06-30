// 核心状态机测试 - 验证 Session/Segment/Pause 三时间模型的状态转换
import { describe, it, expect } from 'vitest';
import { transition, getToggleEvent, isTerminal } from '../electron/timer/stateMachine.js';
import type { TimerState, TimerEvent } from '@shared/types';

describe('Timer State Machine', () => {
  describe('合法状态转换', () => {
    it('idle + START -> running', () => {
      const r = transition('idle', 'START');
      expect(r.ok).toBe(true);
      expect(r.newState).toBe('running');
    });

    it('running + PAUSE -> paused', () => {
      const r = transition('running', 'PAUSE');
      expect(r.ok).toBe(true);
      expect(r.newState).toBe('paused');
    });

    it('paused + RESUME -> running', () => {
      const r = transition('paused', 'RESUME');
      expect(r.ok).toBe(true);
      expect(r.newState).toBe('running');
    });

    it('running + STOP -> finished', () => {
      const r = transition('running', 'STOP');
      expect(r.ok).toBe(true);
      expect(r.newState).toBe('finished');
    });

    it('paused + STOP -> finished', () => {
      const r = transition('paused', 'STOP');
      expect(r.ok).toBe(true);
      expect(r.newState).toBe('finished');
    });

    it('finished + RESET -> idle', () => {
      const r = transition('finished', 'RESET');
      expect(r.ok).toBe(true);
      expect(r.newState).toBe('idle');
    });
  });

  describe('非法状态转换被拒绝', () => {
    const illegal: Array<[TimerState, TimerEvent]> = [
      ['idle', 'PAUSE'],
      ['idle', 'RESUME'],
      ['idle', 'STOP'],
      ['running', 'START'],
      ['running', 'RESUME'],
      ['paused', 'START'],
      ['paused', 'PAUSE'],
      ['finished', 'START'],
      ['finished', 'PAUSE'],
      ['finished', 'RESUME'],
      ['finished', 'STOP'],
    ];

    illegal.forEach(([state, event]) => {
      it(`${state} + ${event} 被拒绝`, () => {
        const r = transition(state, event);
        expect(r.ok).toBe(false);
        expect(r.newState).toBe(state);
        expect(r.reason).toBeTruthy();
      });
    });
  });

  describe('Toggle 行为', () => {
    it('idle 状态 toggle 应触发 START', () => {
      expect(getToggleEvent('idle')).toBe('START');
    });

    it('running 状态 toggle 应触发 PAUSE', () => {
      expect(getToggleEvent('running')).toBe('PAUSE');
    });

    it('paused 状态 toggle 应触发 RESUME', () => {
      expect(getToggleEvent('paused')).toBe('RESUME');
    });

    it('finished 状态 toggle 应返回 null', () => {
      expect(getToggleEvent('finished')).toBeNull();
    });
  });

  describe('完整专注流程', () => {
    // 模拟：开始 -> 暂停 -> 继续 -> 暂停 -> 继续 -> 结束
    it('支持多次暂停/继续的完整流程', () => {
      let state: TimerState = 'idle';

      // 开始
      state = transition(state, 'START').newState;
      expect(state).toBe('running');

      // 第一次暂停
      state = transition(state, 'PAUSE').newState;
      expect(state).toBe('paused');

      // 继续
      state = transition(state, 'RESUME').newState;
      expect(state).toBe('running');

      // 第二次暂停
      state = transition(state, 'PAUSE').newState;
      expect(state).toBe('paused');

      // 继续
      state = transition(state, 'RESUME').newState;
      expect(state).toBe('running');

      // 结束
      state = transition(state, 'STOP').newState;
      expect(state).toBe('finished');

      expect(isTerminal(state)).toBe(true);

      // 重置
      state = transition(state, 'RESET').newState;
      expect(state).toBe('idle');
    });
  });
});
