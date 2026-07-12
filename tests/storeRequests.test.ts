import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/app/store';

describe('one-shot task picker requests', () => {
  beforeEach(() => {
    useStore.setState({ taskPickerRequest: 0 });
  });

  it('is consumed after the timer page handles it', () => {
    useStore.getState().requestTaskPicker();
    expect(useStore.getState().taskPickerRequest).toBe(1);

    useStore.getState().consumeTaskPickerRequest();
    expect(useStore.getState().taskPickerRequest).toBe(0);
  });
});
