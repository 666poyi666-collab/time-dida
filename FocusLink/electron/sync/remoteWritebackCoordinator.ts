import { getSession, listSegments } from '../db/index.js';
import { logger } from '../logger.js';
import { ensureSessionSyncQueued, readSyncQueueItems, runPending } from './syncService.js';
import { getTomatodoSyncStatus, syncSessionToTomatodo } from './tomatodoSyncService.js';
import { shouldSyncSegmentToTomatodo } from '../../shared/tomatodoPolicy.js';
import {
  claimNextRemoteWriteback,
  completeRemoteWriteback,
  renewRemoteWritebackLease,
  retryRemoteWriteback,
  type RemoteWritebackItem,
} from './remoteWritebackStore.js';

export interface RemoteWritebackRunResult {
  processed: number;
  completed: number;
  deferred: number;
}

const MAX_ITEMS_PER_RUN = 16;
const LEASE_HEARTBEAT_MS = 20_000;
const inFlightByScope = new Map<string, Promise<RemoteWritebackRunResult>>();
const rerunRequestedScopes = new Set<string>();

class RemoteWritebackLeaseLostError extends Error {
  constructor() {
    super('remote_writeback_lease_lost');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function deliverDida(item: RemoteWritebackItem): Promise<void> {
  const session = getSession(item.sessionId);
  if (!session) throw new Error('remote_session_not_found');
  const eligible = listSegments(item.sessionId).filter(
    (segment) => segment.taskSource === 'ticktick' && !!segment.taskId && !!segment.endedAt,
  );
  // No linked dida segment is a terminal no-op, not a retryable provider failure.
  if (eligible.length === 0) return;
  const queueItems = ensureSessionSyncQueued(item.sessionId);
  if (!queueItems.every((queueItem) => queueItem.status === 'synced')) await runPending();
  const persisted = readSyncQueueItems(queueItems.map((queueItem) => queueItem.id));
  if (
    persisted.length !== queueItems.length ||
    persisted.some((queueItem) => queueItem.status !== 'synced')
  ) {
    const states = persisted.map((queueItem) => queueItem.status).join(',') || 'missing';
    throw new Error(`dida_queue_pending:${states}`);
  }
}

async function deliverTomatodo(item: RemoteWritebackItem): Promise<void> {
  if (!getSession(item.sessionId)) throw new Error('remote_session_not_found');
  const eligibleIds = listSegments(item.sessionId)
    .filter(shouldSyncSegmentToTomatodo)
    .map((segment) => segment.id);
  if (eligibleIds.length === 0) return;
  const before = getTomatodoSyncStatus(item.sessionId);
  if (
    before.enabled &&
    eligibleIds.every((segmentId) =>
      before.segments.some((segment) => segment.segmentId === segmentId && segment.cloudSynced),
    )
  ) {
    return;
  }
  const result = await syncSessionToTomatodo(item.sessionId);
  if (!result.ok) throw new Error(`tomatodo_queue_pending:${result.failed}`);
  const status = getTomatodoSyncStatus(item.sessionId);
  if (!status.enabled) throw new Error('tomatodo_disabled');
  const pending = eligibleIds.filter(
    (segmentId) =>
      !status.segments.some((segment) => segment.segmentId === segmentId && segment.cloudSynced),
  );
  if (pending.length > 0) throw new Error(`tomatodo_cloud_pending:${pending.length}`);
}

async function deliver(item: RemoteWritebackItem): Promise<void> {
  if (item.provider === 'dida') return deliverDida(item);
  return deliverTomatodo(item);
}

/**
 * Provider calls can outlive the original claim (especially while dida is cooling down). Renew the
 * SQLite lease rather than letting another recovery pass deliver the same intent concurrently.
 */
async function deliverWithLease(item: RemoteWritebackItem, leaseId: string): Promise<void> {
  let leaseLost = false;
  const markLeaseLost = (error?: unknown) => {
    if (leaseLost) return;
    leaseLost = true;
    logger.warn('remoteWriteback', 'provider lease lost during delivery', {
      connectionScope: item.connectionScope,
      sessionId: item.sessionId,
      provider: item.provider,
      error: error ? errorMessage(error) : undefined,
    });
  };
  try {
    if (!renewRemoteWritebackLease(item, leaseId)) {
      throw new RemoteWritebackLeaseLostError();
    }
  } catch (error) {
    markLeaseLost(error);
  }
  if (leaseLost) throw new RemoteWritebackLeaseLostError();

  const heartbeat = setInterval(() => {
    try {
      if (!renewRemoteWritebackLease(item, leaseId)) markLeaseLost();
    } catch (error) {
      markLeaseLost(error);
    }
  }, LEASE_HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    await deliver(item);
    if (leaseLost) throw new RemoteWritebackLeaseLostError();
  } finally {
    clearInterval(heartbeat);
  }
}

async function runBatch(connectionScope: string): Promise<RemoteWritebackRunResult> {
  const result: RemoteWritebackRunResult = { processed: 0, completed: 0, deferred: 0 };
  for (let index = 0; index < MAX_ITEMS_PER_RUN; index += 1) {
    const claim = claimNextRemoteWriteback(connectionScope);
    if (!claim.item) break;
    result.processed += 1;
    try {
      await deliverWithLease(claim.item, claim.leaseId);
      if (!completeRemoteWriteback(claim.item, claim.leaseId)) {
        throw new RemoteWritebackLeaseLostError();
      }
      result.completed += 1;
    } catch (error) {
      const leaseLost = error instanceof RemoteWritebackLeaseLostError;
      const released = leaseLost
        ? false
        : retryRemoteWriteback(claim.item, claim.leaseId, errorMessage(error));
      result.deferred += 1;
      logger.warn('remoteWriteback', 'provider delivery deferred', {
        connectionScope,
        sessionId: claim.item.sessionId,
        provider: claim.item.provider,
        leaseLost,
        leaseReleased: released,
        error: errorMessage(error),
      });
    }
  }
  return result;
}

export function runRemoteWritebacks(connectionScope: string): Promise<RemoteWritebackRunResult> {
  if (!connectionScope) {
    return Promise.reject(new Error('remote_writeback_connection_scope_required'));
  }
  const existing = inFlightByScope.get(connectionScope);
  if (existing) {
    rerunRequestedScopes.add(connectionScope);
    return existing;
  }
  const run = runBatch(connectionScope).finally(() => {
    inFlightByScope.delete(connectionScope);
    if (rerunRequestedScopes.delete(connectionScope)) {
      void runRemoteWritebacks(connectionScope).catch((error) => {
        logger.warn('remoteWriteback', 'coalesced run failed', { error: errorMessage(error) });
      });
    }
  });
  inFlightByScope.set(connectionScope, run);
  return run;
}
