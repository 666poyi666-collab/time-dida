export interface MobileAccountLifecycle {
  issue(): number;
  invalidate(): number;
  isCurrent(operation: number): boolean;
  enqueueNative<T>(operation: () => Promise<T>): Promise<T>;
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
