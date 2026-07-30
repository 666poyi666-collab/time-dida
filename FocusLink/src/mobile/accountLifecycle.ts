export interface MobileAccountLifecycle {
  issue(): number;
  invalidate(): number;
  isCurrent(operation: number): boolean;
  enqueueNative<T>(operation: () => Promise<T>): Promise<T>;
}

export interface MobileAccountRequestLease {
  signal: AbortSignal;
  isCurrent(): boolean;
  finish(): void;
}

export interface MobileAccountRequestLifecycle {
  issue(connectionKey: string): MobileAccountRequestLease;
  invalidate(): void;
  generation(): number;
}

export function mobileAccountConnectionKey(connection: {
  endpoint: string;
  token: string;
}): string {
  return `${connection.endpoint}\u0000${connection.token}`;
}

export function createMobileAccountRequestLifecycle(): MobileAccountRequestLifecycle {
  let currentGeneration = 0;
  let currentController: AbortController | null = null;
  let currentConnectionKey = '';

  return {
    issue(connectionKey) {
      currentGeneration += 1;
      currentController?.abort();
      const generation = currentGeneration;
      const controller = new AbortController();
      currentController = controller;
      currentConnectionKey = connectionKey;
      return {
        signal: controller.signal,
        isCurrent() {
          return (
            currentGeneration === generation &&
            currentController === controller &&
            currentConnectionKey === connectionKey &&
            !controller.signal.aborted
          );
        },
        finish() {
          if (currentController === controller) currentController = null;
        },
      };
    },
    invalidate() {
      currentGeneration += 1;
      currentController?.abort();
      currentController = null;
      currentConnectionKey = '';
    },
    generation() {
      return currentGeneration;
    },
  };
}

/**
 * Orders Keystore mutations and gives every account request a generation. A logout clear is
 * therefore guaranteed to run after older restores/configures and before a later login write.
 */
export function createMobileAccountLifecycle(): MobileAccountLifecycle {
  let generation = 0;
  let nativeQueue: Promise<void> = Promise.resolve();

  return {
    issue() {
      generation += 1;
      return generation;
    },
    invalidate() {
      generation += 1;
      return generation;
    },
    isCurrent(operation) {
      return operation === generation;
    },
    enqueueNative<T>(operation: () => Promise<T>): Promise<T> {
      const result = nativeQueue.then(operation, operation);
      nativeQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
