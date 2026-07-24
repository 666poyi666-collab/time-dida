import { describe, expect, it, vi } from 'vitest';
import type { AndroidPairingProvisionResult } from '../electron/sync/androidPairingProvisioner';
import { AndroidSyncCoordinator } from '../electron/sync/androidSyncCoordinatorPolicy';

function setup() {
  let devices: string[] = [];
  let generation: string | null = 'generation-a';
  const ensureBridges = vi.fn(async () => [...devices]);
  const provisionDevices = vi.fn(
    async (serials: string[]): Promise<AndroidPairingProvisionResult> => ({
      pairedAndroidDevices: [...serials],
      androidPairingErrors: [],
    }),
  );
  const coordinator = new AndroidSyncCoordinator({
    ensureBridges,
    provisionDevices,
    credentialGeneration: () => generation,
  });
  return {
    coordinator,
    provisionDevices,
    setDevices: (next: string[]) => {
      devices = next;
    },
    setGeneration: (next: string | null) => {
      generation = next;
    },
  };
}

describe('Android sync coordinator', () => {
  it('pairs a late device once and keeps repeated polling idempotent', async () => {
    const fixture = setup();
    await fixture.coordinator.coordinate();
    fixture.setDevices(['tablet']);
    expect((await fixture.coordinator.coordinate()).pairedAndroidDevices).toEqual(['tablet']);
    expect((await fixture.coordinator.coordinate()).pairedAndroidDevices).toEqual([]);
    expect(fixture.provisionDevices).toHaveBeenCalledTimes(1);
  });

  it('pairs each device independently and retries only failed devices', async () => {
    const fixture = setup();
    fixture.setDevices(['tablet', 'phone']);
    fixture.provisionDevices.mockResolvedValueOnce({
      pairedAndroidDevices: ['phone'],
      androidPairingErrors: [{ serial: 'tablet', error: 'temporary failure' }],
    });
    expect(await fixture.coordinator.coordinate()).toMatchObject({
      pairedAndroidDevices: ['phone'],
      androidPairingErrors: [{ serial: 'tablet', error: 'temporary failure' }],
    });
    expect((await fixture.coordinator.coordinate()).pairedAndroidDevices).toEqual(['tablet']);
    expect(fixture.provisionDevices.mock.calls[1]?.[0]).toEqual(['tablet']);
  });

  it('re-pairs after disconnect and reconnect or credential rotation', async () => {
    const fixture = setup();
    fixture.setDevices(['tablet']);
    await fixture.coordinator.coordinate();
    fixture.setDevices([]);
    await fixture.coordinator.coordinate();
    fixture.setDevices(['tablet']);
    await fixture.coordinator.coordinate();
    fixture.setGeneration('generation-b');
    await fixture.coordinator.coordinate();
    expect(fixture.provisionDevices).toHaveBeenCalledTimes(3);
  });

  it('serializes concurrent triggers and does not duplicate pairing', async () => {
    const fixture = setup();
    fixture.setDevices(['tablet']);
    const [firstResult, secondResult] = await Promise.all([
      fixture.coordinator.coordinate(),
      fixture.coordinator.coordinate(),
    ]);
    expect(firstResult.pairedAndroidDevices).toEqual(['tablet']);
    expect(secondResult.pairedAndroidDevices).toEqual([]);
    expect(fixture.provisionDevices).toHaveBeenCalledTimes(1);
  });

  it('does not attempt pairing without a configured credential', async () => {
    const fixture = setup();
    fixture.setDevices(['tablet']);
    fixture.setGeneration(null);
    expect((await fixture.coordinator.coordinate()).pairedAndroidDevices).toEqual([]);
    expect(fixture.provisionDevices).not.toHaveBeenCalled();
  });
});
