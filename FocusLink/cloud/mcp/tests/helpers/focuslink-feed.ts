import { expect, vi } from 'vitest';

import type {
  FeedChange,
  FeedEpoch,
  FeedEpochResponse,
  FeedSyncRequest,
  FeedSyncResponse,
} from '../../src/feed-types';
import { FOCUSLINK_SERVICE_ORIGIN } from '../../src/upstream';

export const TEST_DEVICE_ID = 'device-reader01';
export const TEST_DEVICE_TOKEN = 'fl2_account1_reader01_0123456789abcdefghijklmnopqrstuvwxyzABCDE';
export const TEST_ACCOUNT_KEY = 'test-account';
export const TEST_ORIGIN = FOCUSLINK_SERVICE_ORIGIN;

export function epochResponse(epoch: FeedEpoch = EPOCH_ONE, changeSeq = 0): FeedEpochResponse {
  return {
    protocolVersion: 2,
    ...epoch,
    changeSeq,
    serverTime: 1_700_000_000_000,
  };
}

export const EPOCH_ONE: FeedEpoch = {
  syncEpoch: 'sync-1',
  cursorEpoch: 'cursor-1',
  accountGeneration: 1,
};

export const EPOCH_TWO: FeedEpoch = {
  syncEpoch: 'sync-2',
  cursorEpoch: 'cursor-2',
  accountGeneration: 2,
};

export interface UpstreamCall {
  method: string;
  pathname: string;
  authorization: string | null;
  redirect: RequestRedirect | undefined;
  body: FeedSyncRequest | null;
}

export class FakeFocusLinkFeed {
  epoch: FeedEpoch;
  changes: FeedChange[];
  pageSize: number;
  reportedHeadChangeSeq: number | null;
  calls: UpstreamCall[] = [];
  failEpochWith: number | null = null;
  failSyncCall: number | null = null;

  constructor(input?: {
    epoch?: FeedEpoch;
    changes?: FeedChange[];
    pageSize?: number;
    reportedHeadChangeSeq?: number;
  }) {
    this.epoch = input?.epoch ?? EPOCH_ONE;
    this.changes = [...(input?.changes ?? [])].sort((a, b) => a.changeSeq - b.changeSeq);
    this.pageSize = input?.pageSize ?? 500;
    this.reportedHeadChangeSeq = input?.reportedHeadChangeSeq ?? null;
  }

  install(): void {
    vi.stubGlobal('fetch', vi.fn(this.fetch));
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // workerd intentionally does not implement Request.redirect="error". Keep
    // the fake usable while the adapter enforces redirects from the response
    // status (the production fetcher must use "manual").
    const safeInit =
      init?.redirect === 'error' ? ({ ...init, redirect: 'manual' } satisfies RequestInit) : init;
    const request =
      input instanceof Request
        ? input
        : new Request(typeof input === 'string' ? input : input.toString(), safeInit);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const body = method === 'POST' ? ((await request.clone().json()) as FeedSyncRequest) : null;
    this.calls.push({
      method,
      pathname: url.pathname,
      authorization: request.headers.get('authorization'),
      redirect: init?.redirect,
      body,
    });

    if (url.origin !== TEST_ORIGIN) return jsonError(404, 'wrong_origin');
    if (request.headers.get('authorization') !== `Bearer ${TEST_DEVICE_TOKEN}`)
      return jsonError(401, 'unauthenticated');

    if (method === 'GET' && url.pathname === '/sync/v2/status') {
      if (this.failEpochWith !== null) return jsonError(this.failEpochWith, 'epoch_unavailable');
      const response: FeedEpochResponse = {
        protocolVersion: 2,
        ...this.epoch,
        changeSeq: this.reportedHeadChangeSeq ?? this.changes.at(-1)?.changeSeq ?? 0,
        serverTime: Date.now(),
      };
      return Response.json(response);
    }

    if (method === 'POST' && url.pathname === '/sync/v2/exchange') {
      const postNumber = this.calls.filter(
        (call) => call.method === 'POST' && call.pathname === '/sync/v2/exchange',
      ).length;
      if (this.failSyncCall === postNumber) return jsonError(503, 'sync_unavailable');
      if (!body || body.protocolVersion !== 2 || body.deviceId !== TEST_DEVICE_ID)
        return jsonError(400, 'invalid_request');
      if (body.mutations.length !== 0) return jsonError(403, 'write_forbidden');
      if (!sameEpoch(body, this.epoch)) return jsonError(409, 'epoch_changed');

      const after = decodeCursor(body.cursor);
      const page = this.changes
        .filter((change) => change.changeSeq > after)
        .slice(0, this.pageSize);
      const lastSeq = page.at(-1)?.changeSeq ?? after;
      const response: FeedSyncResponse = {
        protocolVersion: 2,
        ...this.epoch,
        acks: [],
        changes: page,
        nextCursor: encodeCursor(lastSeq),
        hasMore: this.changes.some((change) => change.changeSeq > lastSeq),
        serverTime: Date.now(),
      };
      return Response.json(response);
    }

    return jsonError(404, 'not_found');
  };

  postBodies(): FeedSyncRequest[] {
    return this.calls.flatMap((call) => (call.body ? [call.body] : []));
  }

  expectReadOnlyCredential(): void {
    for (const call of this.calls) {
      expect(call.authorization).toBe(`Bearer ${TEST_DEVICE_TOKEN}`);
      expect(['/sync/v2/status', '/sync/v2/exchange']).toContain(call.pathname);
      if (call.body) expect(call.body.mutations).toEqual([]);
    }
  }
}

export function ledgerChange(changeSeq: number, entityId: string, revision = 1): FeedChange {
  return {
    changeSeq,
    entityType: 'focus_ledger_v2',
    entityId,
    revision,
    fingerprint: fingerprint(changeSeq, 'ledger'),
    deleted: false,
    payload: {
      sessionId: entityId,
      startedAt: 1_700_000_000_000 + changeSeq * 1_000,
      endedAt: 1_700_000_030_000 + changeSeq * 1_000,
      status: 'finished',
      activeElapsedMs: 30_000,
      pausedElapsedMs: 0,
      wallElapsedMs: 30_000,
      originDeviceId: 'phone-main',
      segments: [],
      pauses: [],
    },
    sourceDeviceId: 'phone-main',
  };
}

export function metadataChange(changeSeq: number, entityId: string, revision = 1): FeedChange {
  return {
    changeSeq,
    entityType: 'focus_metadata_v2',
    entityId,
    revision,
    fingerprint: fingerprint(changeSeq, 'metadata'),
    deleted: false,
    payload: {
      sessionId: entityId,
      title: `Session ${entityId}`,
      note: 'synced from FocusLink',
      subject: 'chemistry',
      tags: [{ tagId: 'tag-chem', name: '化学' }],
      taskAssociation: null,
      updatedAt: 1_700_000_040_000 + changeSeq,
      updatedByDeviceId: 'phone-main',
    },
    sourceDeviceId: 'phone-main',
  };
}

export function tombstoneChange(
  changeSeq: number,
  entityId: string,
  entityType: FeedChange['entityType'] = 'focus_ledger_v2',
  revision = 2,
): FeedChange {
  return {
    changeSeq,
    entityType,
    entityId,
    revision,
    fingerprint: fingerprint(changeSeq, 'deleted'),
    deleted: true,
    payload: null,
    sourceDeviceId: 'phone-main',
  };
}

function sameEpoch(left: FeedEpoch, right: FeedEpoch): boolean {
  return (
    left.syncEpoch === right.syncEpoch &&
    left.cursorEpoch === right.cursorEpoch &&
    left.accountGeneration === right.accountGeneration
  );
}

function encodeCursor(sequence: number): string {
  return `c${sequence.toString(36)}`;
}

function decodeCursor(cursor: string | null): number {
  if (cursor === null) return 0;
  const match = /^c([0-9a-z]+)$/.exec(cursor);
  return match ? Number.parseInt(match[1], 36) : -1;
}

function fingerprint(sequence: number, salt: string): string {
  return `${sequence.toString(16).padStart(8, '0')}${salt
    .split('')
    .map((char) => char.charCodeAt(0).toString(16))
    .join('')}`.padEnd(64, '0');
}

function jsonError(status: number, code: string): Response {
  return Response.json({ error: { code, message: code } }, { status });
}
