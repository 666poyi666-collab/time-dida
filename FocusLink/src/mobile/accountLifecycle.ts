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

export interface MobileAccountCommitResult<T> {
  current: boolean;
  issues: string[];
  nativeState?: T;
}

export interface MobileAccountNativeTransition<T> {
  read(): Promise<T>;
  mutate(baseline: T): Promise<T>;
  restore(baseline: T, applied: T): Promise<void>;
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

/**
 * Commits the native credential first, then treats account-cache cleanup as best effort.
 * A cache failure must not leave the renderer on the old account after Keystore accepted
 * the new one; a superseding logout/login still prevents all renderer state commits.
 */
export async function runMobileAccountCommit<T>(
  lifecycle: MobileAccountLifecycle,
  operation: number,
  native: MobileAccountNativeTransition<T>,
  resetAccountState: () => Promise<readonly string[]>,
): Promise<MobileAccountCommitResult<T>> {
  return lifecycle.enqueueNative(async () => {
    if (!lifecycle.isCurrent(operation)) return { current: false, issues: [] };
    const baseline = await native.read();
    if (!lifecycle.isCurrent(operation)) return { current: false, issues: [] };
    const applied = await native.mutate(baseline);
    if (!lifecycle.isCurrent(operation)) {
      await native.restore(baseline, applied);
      return { current: false, issues: [] };
    }

    let issues: string[];
    try {
      issues = [...(await resetAccountState())];
    } catch {
      issues = ['account-cache'];
    }
    if (!lifecycle.isCurrent(operation)) {
      await native.restore(baseline, applied);
      return { current: false, issues: [] };
    }
    return { current: true, issues, nativeState: applied };
  });
}

/** Renderer logout state may be committed only after the durable native clear succeeds. */
export async function runMobileAccountLogout<T>(
  lifecycle: MobileAccountLifecycle,
  operation: number,
  native: MobileAccountNativeTransition<T>,
  resetAccountState: () => Promise<readonly string[]>,
): Promise<MobileAccountCommitResult<T>> {
  return runMobileAccountCommit(lifecycle, operation, native, resetAccountState);
}
