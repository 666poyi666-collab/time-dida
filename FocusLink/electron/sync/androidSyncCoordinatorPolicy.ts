import type { AndroidPairingProvisionResult } from './androidPairingProvisioner.js';

export interface AndroidSyncCoordinationResult extends AndroidPairingProvisionResult {
  connectedAndroidDevices: string[];
}

export interface AndroidSyncCoordinatorDependencies {
  ensureBridges: () => Promise<string[]>;
  provisionDevices: (serials: string[]) => Promise<AndroidPairingProvisionResult>;
  credentialGeneration: () => string | null;
}

export class AndroidSyncCoordinator {
  private operationTail: Promise<void> = Promise.resolve();
  private previousConnected = new Set<string>();
  private provisionedGeneration = new Map<string, string>();

  constructor(private readonly dependencies: AndroidSyncCoordinatorDependencies) {}

  coordinate(): Promise<AndroidSyncCoordinationResult> {
    const operation = this.operationTail.then(() => this.coordinateInternal());
    this.operationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async coordinateInternal(): Promise<AndroidSyncCoordinationResult> {
    const connectedAndroidDevices = await this.dependencies.ensureBridges();
    const connected = new Set(connectedAndroidDevices);
    for (const serial of this.previousConnected) {
      if (!connected.has(serial)) this.provisionedGeneration.delete(serial);
    }
    this.previousConnected = connected;

    const generation = this.dependencies.credentialGeneration();
    if (!generation) {
      this.provisionedGeneration.clear();
      return {
        connectedAndroidDevices,
        pairedAndroidDevices: [],
        androidPairingErrors: [],
      };
    }

    const pending = connectedAndroidDevices.filter(
      (serial) => this.provisionedGeneration.get(serial) !== generation,
    );
    if (pending.length === 0) {
      return {
        connectedAndroidDevices,
        pairedAndroidDevices: [],
        androidPairingErrors: [],
      };
    }

    const pairing = await this.dependencies.provisionDevices(pending);
    for (const serial of pairing.pairedAndroidDevices) {
      this.provisionedGeneration.set(serial, generation);
    }
    return { connectedAndroidDevices, ...pairing };
  }
}
