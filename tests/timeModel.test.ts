// 三时间模型计算测试 - 验证 activeElapsed/pauseElapsed/wallElapsed
// 这是整个项目最重要的测试，验证核心场景：
//   专注 45min -> 暂停 5min -> 专注 45min -> 结束
//   结果：active=90min, pause=5min, wall=95min
import { describe, it, expect } from 'vitest';
import { formatMinutes } from '../src/lib/time';

/**
 * 模拟 TimerManager 的三时间计算逻辑（纯函数版本，便于测试）
 * running 时 activeElapsed += delta；paused 时 pauseElapsed += delta
 * wallElapsed 始终 = now - startedAt
 */
function simulateTimeline(
  events: Array<{ t: number; type: 'start' | 'pause' | 'resume' | 'stop' }>,
) {
  let activeElapsedMs = 0;
  let pauseElapsedMs = 0;
  let state: 'idle' | 'running' | 'paused' | 'finished' = 'idle';
  let lastTick = 0;
  let startedAt = 0;
  let wallMs = 0;

  for (const e of events) {
    switch (e.type) {
      case 'start': {
        state = 'running';
        startedAt = e.t;
        lastTick = e.t;
        break;
      }
      case 'pause': {
        // 结算 active 增量
        activeElapsedMs += Math.max(0, e.t - lastTick);
        lastTick = e.t;
        state = 'paused';
        break;
      }
      case 'resume': {
        // 结算 pause 增量
        pauseElapsedMs += Math.max(0, e.t - lastTick);
        lastTick = e.t;
        state = 'running';
        break;
      }
      case 'stop': {
        if (state === 'running') {
          activeElapsedMs += Math.max(0, e.t - lastTick);
        } else if (state === 'paused') {
          pauseElapsedMs += Math.max(0, e.t - lastTick);
        }
        wallMs = Math.max(0, e.t - startedAt);
        state = 'finished';
        break;
      }
    }
  }
  if (state !== 'finished' && startedAt > 0) {
    wallMs = Math.max(0, (events[events.length - 1]?.t ?? Date.now()) - startedAt);
  }
  return { activeElapsedMs, pauseElapsedMs, wallElapsedMs: wallMs, state };
}

describe('三时间模型', () => {
  const MIN = 60_000;

  it('核心场景：45专注 + 5暂停 + 45专注 = 90专注 / 5暂停 / 95总跨度', () => {
    const result = simulateTimeline([
      { t: 0, type: 'start' },
      { t: 45 * MIN, type: 'pause' },
      { t: 50 * MIN, type: 'resume' },
      { t: 95 * MIN, type: 'stop' },
    ]);
    expect(result.activeElapsedMs).toBe(90 * MIN);
    expect(result.pauseElapsedMs).toBe(5 * MIN);
    expect(result.wallElapsedMs).toBe(95 * MIN);
    expect(result.state).toBe('finished');
  });

  it('无暂停的简单专注', () => {
    const result = simulateTimeline([
      { t: 0, type: 'start' },
      { t: 30 * MIN, type: 'stop' },
    ]);
    expect(result.activeElapsedMs).toBe(30 * MIN);
    expect(result.pauseElapsedMs).toBe(0);
    expect(result.wallElapsedMs).toBe(30 * MIN);
  });

  it('多次暂停累加', () => {
    const result = simulateTimeline([
      { t: 0, type: 'start' },
      { t: 20 * MIN, type: 'pause' },
      { t: 25 * MIN, type: 'resume' }, // pause 5
      { t: 40 * MIN, type: 'pause' },
      { t: 48 * MIN, type: 'resume' }, // pause 8
      { t: 60 * MIN, type: 'stop' },
    ]);
    // active: 20 + 15 + 12 = 47
    expect(result.activeElapsedMs).toBe(47 * MIN);
    // pause: 5 + 8 = 13
    expect(result.pauseElapsedMs).toBe(13 * MIN);
    // wall: 60
    expect(result.wallElapsedMs).toBe(60 * MIN);
  });

  it('activeElapsed 不包含暂停时间', () => {
    const result = simulateTimeline([
      { t: 0, type: 'start' },
      { t: 10 * MIN, type: 'pause' },
      { t: 100 * MIN, type: 'resume' }, // 暂停 90 分钟
      { t: 110 * MIN, type: 'stop' },
    ]);
    expect(result.activeElapsedMs).toBe(20 * MIN); // 10 + 10
    expect(result.pauseElapsedMs).toBe(90 * MIN);
    expect(result.wallElapsedMs).toBe(110 * MIN);
  });

  it('wallElapsed 始终等于自然跨度', () => {
    const result = simulateTimeline([
      { t: 1000, type: 'start' },
      { t: 1000 + 5 * MIN, type: 'pause' },
      { t: 1000 + 15 * MIN, type: 'resume' },
      { t: 1000 + 20 * MIN, type: 'stop' },
    ]);
    expect(result.wallElapsedMs).toBe(20 * MIN);
  });

  it('不出现负时间（delta 被 clamp 为 0）', () => {
    // 模拟时间回退（系统时间被修改）
    const result = simulateTimeline([
      { t: 1000, type: 'start' },
      { t: 500, type: 'pause' }, // 时间回退
      { t: 800, type: 'resume' },
      { t: 1200, type: 'stop' },
    ]);
    expect(result.activeElapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.pauseElapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe('历史短专注格式', () => {
  it('does not present a non-zero short session as zero minutes', () => {
    expect(formatMinutes(1_000)).toBe('<1 分钟');
    expect(formatMinutes(29_999)).toBe('<1 分钟');
    expect(formatMinutes(60_000)).toBe('1 分钟');
  });
});
