import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/app/store';

describe('one-shot task picker requests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({ taskPickerRequest: 0, toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is consumed after the timer page handles it', () => {
    useStore.getState().requestTaskPicker();
    expect(useStore.getState().taskPickerRequest).toBe(1);

    useStore.getState().consumeTaskPickerRequest();
    expect(useStore.getState().taskPickerRequest).toBe(0);
  });

  it('does not stack the same visible error hundreds of times', () => {
    const { addToast } = useStore.getState();

    addToast('无法连接实时同步服务', 'error');
    addToast('无法连接实时同步服务', 'error');
    addToast('无法连接实时同步服务', 'error');

    expect(useStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(3_200);
    expect(useStore.getState().toasts).toHaveLength(0);
  });
});
