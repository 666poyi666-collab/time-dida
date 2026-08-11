import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface TestStatement {
  run(...parameters: unknown[]): { changes: number };
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

interface QueueRow {
  connection_scope: string;
  session_id: string;
  provider: 'dida' | 'tomatodo';
  state: 'pending' | 'claimed' | 'completed';
  attempt_count: number;
  next_retry_at: number;
  lease_id: string | null;
  lease_expires_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface TestDatabase {
  prepare(sql: string): TestStatement;
  close(): void;
  transaction(operation: (...parameters: never[]) => unknown): (...parameters: never[]) => unknown;
}

const harness = vi.hoisted(() => ({ db: null as TestDatabase | null }));

vi.mock('../electron/db/index.js', () => ({
  getDb: () => {
    if (!harness.db) throw new Error('test database is not ready');
    return harness.db;
  },
}));

import {
  claimNextRemoteWriteback,
  completeRemoteWriteback,
  enqueueRemoteWritebackIntents,
  getNextRemoteWritebackRetryAt,
  hasRemoteWritebackIntentPair,
  listRemoteWritebacks,
  renewRemoteWritebackLease,
  retryRemoteWriteback,
} from '../electron/sync/remoteWritebackStore';

class InMemoryQueueDatabase implements TestDatabase {
  private rows: QueueRow[] = [];

  prepare(sql: string): TestStatement {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      run: (...parameters) => this.run(normalized, parameters),
      get: (...parameters) => this.get(normalized, parameters),
      all: (...parameters) => this.all(normalized, parameters),
    };
  }

  close(): void {}

  transaction(operation: (...parameters: never[]) => unknown): (...parameters: never[]) => unknown {
    return (...parameters) => {
      const snapshot = this.rows.map((row) => ({ ...row }));
      try {
        return operation(...parameters);
      } catch (error) {
        this.rows = snapshot;
        throw error;
      }
    };
  }

  private run(sql: string, parameters: unknown[]): { changes: number } {
    if (sql.startsWith('INSERT INTO remote_writeback_queue')) {
      const [connectionScope, sessionId, provider, createdAt, updatedAt] = parameters as [
        string,
        string,
        QueueRow['provider'],
        number,
        number,
      ];
      if (
        this.rows.some(
          (row) =>
            row.connection_scope === connectionScope &&
            row.session_id === sessionId &&
            row.provider === provider,
        )
      ) {
        return { changes: 0 };
      }
      this.rows.push({
        connection_scope: connectionScope,
        session_id: sessionId,
        provider,
        state: 'pending',
        attempt_count: 0,
        next_retry_at: 0,
        lease_id: null,
        lease_expires_at: null,
        last_error: null,
        created_at: createdAt,
        updated_at: updatedAt,
        completed_at: null,
      });
      return { changes: 1 };
    }

    if (sql.includes("SET state = 'claimed'")) {
      const [leaseId, leaseExpiresAt, updatedAt, connectionScope, sessionId, provider, now] =
        parameters as [
          string,
          number,
          number,
          string,
          string,
          QueueRow['provider'],
          number,
          number,
        ];
      const row = this.rows.find(
        (candidate) =>
          candidate.connection_scope === connectionScope &&
          candidate.session_id === sessionId &&
          candidate.provider === provider &&
          ((candidate.state === 'pending' && candidate.next_retry_at <= now) ||
            (candidate.state === 'claimed' && (candidate.lease_expires_at ?? Infinity) <= now)),
      );
      if (!row) return { changes: 0 };
      row.state = 'claimed';
      row.lease_id = leaseId;
      row.lease_expires_at = leaseExpiresAt;
      row.updated_at = updatedAt;
      return { changes: 1 };
    }

    if (sql.includes("SET state = 'completed'")) {
      const [completedAt, updatedAt, connectionScope, sessionId, provider, leaseId] =
        parameters as [number, number, string, string, QueueRow['provider'], string];
      const row = this.findClaimed(connectionScope, sessionId, provider, leaseId);
      if (!row) return { changes: 0 };
      row.state = 'completed';
      row.lease_id = null;
      row.lease_expires_at = null;
      row.last_error = null;
      row.completed_at = completedAt;
      row.updated_at = updatedAt;
      return { changes: 1 };
    }

    if (sql.includes('SET lease_expires_at = ?')) {
      const [leaseExpiresAt, updatedAt, connectionScope, sessionId, provider, leaseId] =
        parameters as [number, number, string, string, QueueRow['provider'], string];
      const row = this.findClaimed(connectionScope, sessionId, provider, leaseId);
      if (!row) return { changes: 0 };
      row.lease_expires_at = leaseExpiresAt;
      row.updated_at = updatedAt;
      return { changes: 1 };
    }

    if (sql.includes("SET state = 'pending'")) {
      const [
        attemptCount,
        nextRetryAt,
        lastError,
        updatedAt,
        connectionScope,
        sessionId,
        provider,
        leaseId,
      ] = parameters as [
        number,
        number,
        string,
        number,
        string,
        string,
        QueueRow['provider'],
        string,
      ];
      const row = this.findClaimed(connectionScope, sessionId, provider, leaseId);
      if (!row) return { changes: 0 };
      row.state = 'pending';
      row.attempt_count = attemptCount;
      row.next_retry_at = nextRetryAt;
      row.lease_id = null;
      row.lease_expires_at = null;
      row.last_error = lastError;
      row.updated_at = updatedAt;
      row.completed_at = null;
      return { changes: 1 };
    }

    throw new Error(`unsupported test write: ${sql}`);
  }

  private get(sql: string, parameters: unknown[]): unknown {
    if (sql.startsWith('SELECT connection_scope, session_id, provider')) {
      const [connectionScope, now] = parameters as [string, number, number];
      const row = this.rows
        .filter(
          (candidate) =>
            candidate.connection_scope === connectionScope &&
            ((candidate.state === 'pending' && candidate.next_retry_at <= now) ||
              (candidate.state === 'claimed' && (candidate.lease_expires_at ?? Infinity) <= now)),
        )
        .sort(compareRows)[0];
      return row
        ? {
            connection_scope: row.connection_scope,
            session_id: row.session_id,
            provider: row.provider,
          }
        : undefined;
    }

    if (sql.startsWith('SELECT * FROM remote_writeback_queue')) {
      const [connectionScope, sessionId, provider, leaseId] = parameters as [
        string,
        string,
        QueueRow['provider'],
        string,
      ];
      const row = this.findClaimed(connectionScope, sessionId, provider, leaseId);
      return row ? { ...row } : undefined;
    }

    if (sql.startsWith('SELECT MIN(')) {
      const [connectionScope] = parameters as [string];
      const candidates = this.rows
        .filter((row) => row.connection_scope === connectionScope && row.state !== 'completed')
        .map((row) =>
          row.state === 'claimed' ? (row.lease_expires_at ?? row.next_retry_at) : row.next_retry_at,
        );
      return { next_retry_at: candidates.length > 0 ? Math.min(...candidates) : null };
    }

    if (sql.startsWith('SELECT COUNT(DISTINCT provider)')) {
      const [connectionScope, sessionId] = parameters as [string, string];
      const providers = new Set(
        this.rows
          .filter((row) => row.connection_scope === connectionScope && row.session_id === sessionId)
          .map((row) => row.provider),
      );
      return { provider_count: providers.size };
    }

    throw new Error(`unsupported test read: ${sql}`);
  }

  private all(sql: string, parameters: unknown[]): unknown[] {
    const sessionId = sql.includes('WHERE session_id = ?') ? (parameters[0] as string) : null;
    return this.rows
      .filter((row) => sessionId === null || row.session_id === sessionId)
      .sort(compareRows)
      .map((row) => ({ ...row }));
  }

  private findClaimed(
    connectionScope: string,
    sessionId: string,
    provider: QueueRow['provider'],
    leaseId: string,
  ): QueueRow | undefined {
    return this.rows.find(
      (row) =>
        row.connection_scope === connectionScope &&
        row.session_id === sessionId &&
        row.provider === provider &&
        row.state === 'claimed' &&
        row.lease_id === leaseId,
    );
  }
}

function compareRows(left: QueueRow, right: QueueRow): number {
  return (
    left.next_retry_at - right.next_retry_at ||
    left.created_at - right.created_at ||
    left.provider.localeCompare(right.provider)
  );
}

function createTestDatabase(): TestDatabase {
  return new InMemoryQueueDatabase();
}

describe('remote write-back durable store', () => {
  beforeEach(() => {
    harness.db = createTestDatabase();
  });

  afterEach(() => {
    harness.db?.close();
    harness.db = null;
  });

  it('deduplicates intents and claims only the requested connection scope', () => {
    enqueueRemoteWritebackIntents('scope-a', 'session-1', 100);
    enqueueRemoteWritebackIntents('scope-a', 'session-1', 101);
    enqueueRemoteWritebackIntents('scope-b', 'session-1', 102);

    expect(listRemoteWritebacks()).toHaveLength(4);
    expect(hasRemoteWritebackIntentPair('scope-a', 'session-1')).toBe(true);
    expect(hasRemoteWritebackIntentPair('scope-a', 'missing')).toBe(false);

    const firstA = claimNextRemoteWriteback('scope-a', 200, 1_000);
    const firstB = claimNextRemoteWriteback('scope-b', 200, 1_000);

    expect(firstA.item).toMatchObject({
      connectionScope: 'scope-a',
      sessionId: 'session-1',
      provider: 'dida',
      state: 'claimed',
    });
    expect(firstB.item).toMatchObject({
      connectionScope: 'scope-b',
      sessionId: 'session-1',
      provider: 'dida',
      state: 'claimed',
    });
  });

  it('leaves no provider intent behind when its enclosing projection transaction rolls back', () => {
    const rollback = harness.db!.transaction(() => {
      enqueueRemoteWritebackIntents('scope-a', 'session-rolled-back', 100);
      throw new Error('projection failed');
    });

    expect(rollback).toThrow('projection failed');
    expect(listRemoteWritebacks()).toEqual([]);
  });

  it('treats a transient SQLite writer lock as no claim instead of aborting the sync pass', () => {
    const database = harness.db!;
    harness.db = {
      prepare: database.prepare.bind(database),
      close: database.close.bind(database),
      transaction: () => () => {
        throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
      },
    };

    expect(claimNextRemoteWriteback('scope-a', 100, 1_000).item).toBeNull();
  });

  it('renews a lease and persists exponential retry without discarding a failed delivery', () => {
    enqueueRemoteWritebackIntents('scope-a', 'session-1', 100);
    const first = claimNextRemoteWriteback('scope-a', 200, 1_000);
    expect(first.item).not.toBeNull();
    const item = first.item!;

    expect(renewRemoteWritebackLease(item, first.leaseId, 300, 5_000)).toBe(true);
    expect(completeRemoteWriteback(item, 'stale-lease', 301)).toBe(false);
    expect(retryRemoteWriteback(item, first.leaseId, 'offline', 400)).toBe(true);
    expect(getNextRemoteWritebackRetryAt('scope-a')).toBe(0);

    const tomatodo = claimNextRemoteWriteback('scope-a', 401, 1_000);
    expect(tomatodo.item?.provider).toBe('tomatodo');
    expect(completeRemoteWriteback(tomatodo.item!, tomatodo.leaseId, 402)).toBe(true);

    expect(claimNextRemoteWriteback('scope-a', 30_399, 1_000).item).toBeNull();
    expect(getNextRemoteWritebackRetryAt('scope-a')).toBe(30_400);
    const retried = claimNextRemoteWriteback('scope-a', 30_400, 1_000);
    expect(retried.item).toMatchObject({ provider: 'dida', attemptCount: 1, lastError: 'offline' });
  });

  it('reclaims an expired lease after a crash without creating another intent row', () => {
    enqueueRemoteWritebackIntents('scope-a', 'session-1', 100);
    const first = claimNextRemoteWriteback('scope-a', 100, 10);
    expect(first.item?.provider).toBe('dida');

    const tomatodo = claimNextRemoteWriteback('scope-a', 101, 1_000);
    expect(completeRemoteWriteback(tomatodo.item!, tomatodo.leaseId, 102)).toBe(true);
    expect(getNextRemoteWritebackRetryAt('scope-a')).toBe(110);

    const recovered = claimNextRemoteWriteback('scope-a', 110, 1_000);
    expect(recovered.item).toMatchObject({ provider: 'dida', state: 'claimed' });
    expect(recovered.leaseId).not.toBe(first.leaseId);
    expect(listRemoteWritebacks()).toHaveLength(2);
  });
});
