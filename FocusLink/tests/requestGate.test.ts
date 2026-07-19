// 统计页请求门闩：范围切换/行展开竞态下，旧响应永不覆盖新请求。
import { describe, expect, it } from 'vitest';
import { createRequestGate } from '../src/features/history/requestGate';

describe('统计请求门闩：旧响应不覆盖新请求', () => {
  it('只有最新发出的请求是 current', () => {
    const gate = createRequestGate();
    const first = gate.issue();
    expect(gate.isCurrent(first)).toBe(true);
    const second = gate.issue();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it('范围快速切换：只认最后一次发出的请求', () => {
    const gate = createRequestGate();
    const sevenDays = gate.issue();
    const halfMonth = gate.issue();
    const month = gate.issue();
    expect(gate.isCurrent(sevenDays)).toBe(false);
    expect(gate.isCurrent(halfMonth)).toBe(false);
    expect(gate.isCurrent(month)).toBe(true);
  });

  it('invalidate 使全部未完成请求失效（卸载/路由离开语义）', () => {
    const gate = createRequestGate();
    const pending = gate.issue();
    gate.invalidate();
    expect(gate.isCurrent(pending)).toBe(false);
    const next = gate.issue();
    expect(gate.isCurrent(next)).toBe(true);
  });
});
