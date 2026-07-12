import http from 'node:http';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';

vi.mock('electron', () => ({
  app: { getPath: () => '' },
}));

import {
  updateTomatodoSubjectThroughBridge,
  writeTomatodoRecordsThroughBridge,
  writeTomatodoRecordThroughBridge,
} from '../electron/integrations/tomatodo/cloudBridge';
import { buildTomatodoRecord } from '../shared/tomatodoPolicy';
import type { TomatodoSubject } from '../shared/types';

type NativeRecord = Record<string, unknown> & {
  id: number;
  name: string;
  isSynced: number;
  s1: string;
};

describe('tomatodo cloud bridge CDP transaction', () => {
  let server: http.Server;
  let websocketServer: WebSocketServer;
  let port = 0;
  let lastExpression = '';
  let electronApi: Record<string, unknown>;

  beforeEach(async () => {
    electronApi = {};
    server = http.createServer((request, response) => {
      if (request.url === '/json') {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify([
            {
              type: 'page',
              webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/test`,
            },
          ]),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    websocketServer = new WebSocketServer({ server, path: '/devtools/page/test' });
    websocketServer.on('connection', (socket) => {
      socket.on('message', async (raw) => {
        const command = JSON.parse(raw.toString()) as {
          id: number;
          params?: { expression?: string };
        };
        lastExpression = command.params?.expression ?? '';
        try {
          const value = (await vm.runInNewContext(lastExpression, {
            window: { electronAPI: electronApi },
          })) as unknown;
          socket.send(
            JSON.stringify({
              id: command.id,
              result: { result: { value } },
            }),
          );
        } catch (error) {
          socket.send(
            JSON.stringify({
              id: command.id,
              result: {
                exceptionDetails: {
                  text: error instanceof Error ? error.message : String(error),
                },
              },
            }),
          );
        }
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        port = typeof address === 'object' && address ? address.port : 0;
        process.env.FOCUSLINK_TOMATODO_CDP_PORT = String(port);
        resolve();
      });
    });
  });

  afterEach(async () => {
    delete process.env.FOCUSLINK_TOMATODO_CDP_PORT;
    for (const client of websocketServer.clients) client.terminate();
    await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function recordFor(segmentId: string, subject: TomatodoSubject = '学习') {
    return buildTomatodoRecord({
      segmentId,
      subject,
      startedAt: 1_000,
      endedAt: 61_000,
      activeElapsedMs: 60_000,
    });
  }

  function installNativeApi(
    records: NativeRecord[],
    upload: (payload: unknown) => Promise<unknown> = async () => ({ success: true }),
  ): { addCalls: unknown[]; updateCalls: NativeRecord[]; uploadCalls: unknown[] } {
    const addCalls: unknown[] = [];
    const updateCalls: NativeRecord[] = [];
    const uploadCalls: unknown[] = [];
    electronApi = {
      getAllRecords: async () => records,
      addRecord: async (input: Omit<NativeRecord, 'id'>) => {
        addCalls.push(input);
        const inserted = { ...input, id: 201 + records.length } as NativeRecord;
        records.push(inserted);
        return inserted;
      },
      updateRecord: async (input: NativeRecord) => {
        updateCalls.push({ ...input });
        const index = records.findIndex((item) => item.id === input.id);
        if (index >= 0) records[index] = { ...input };
        return input;
      },
      cloudSyncGetStatus: async () => ({ isBound: true, deviceToken: 'test-device' }),
      cloudSyncUploadRecord: async (payload: unknown) => {
        uploadCalls.push(payload);
        return upload(payload);
      },
    };
    return { addCalls, updateCalls, uploadCalls };
  }

  it('uses native add/upload and marks isSynced=1 only after confirmed upload', async () => {
    const records: NativeRecord[] = [];
    const calls = installNativeApi(records);

    const result = await writeTomatodoRecordThroughBridge(recordFor('bridge-segment'));

    expect(result).toMatchObject({
      available: true,
      ok: true,
      recordFound: true,
      localWritten: true,
      localChanged: true,
      cloudSynced: true,
      skipped: false,
      recordId: 201,
    });
    expect(calls.addCalls).toHaveLength(1);
    expect(calls.uploadCalls).toHaveLength(1);
    expect(calls.updateCalls.at(-1)?.isSynced).toBe(1);
    expect(records[0]?.isSynced).toBe(1);
    expect(lastExpression).toContain('[FocusLink:tomatodo:segment:bridge-segment]');
  });

  it('keeps a matching cloud-confirmed marker idempotent without re-uploading', async () => {
    const records = [{ ...recordFor('already-synced'), id: 202, isSynced: 1 } as NativeRecord];
    const calls = installNativeApi(records);

    const result = await writeTomatodoRecordThroughBridge(recordFor('already-synced'));

    expect(result).toMatchObject({
      ok: true,
      recordFound: true,
      localChanged: false,
      cloudSynced: true,
      skipped: true,
    });
    expect(calls.addCalls).toHaveLength(0);
    expect(calls.updateCalls).toHaveLength(0);
    expect(calls.uploadCalls).toHaveLength(0);
    expect(records[0]?.isSynced).toBe(1);
  });

  it('uploads multiple pending markers in one native cloud batch', async () => {
    const records: NativeRecord[] = [];
    const calls = installNativeApi(records);

    const result = await writeTomatodoRecordsThroughBridge([
      recordFor('batch-one', '数学'),
      recordFor('batch-two', '化学'),
    ]);

    expect(result).toMatchObject({ available: true, ok: true });
    expect(result.results).toHaveLength(2);
    expect(result.results.every((item) => item.cloudSynced)).toBe(true);
    expect(calls.addCalls).toHaveLength(2);
    expect(calls.uploadCalls).toHaveLength(1);
    expect(calls.uploadCalls[0]).toMatchObject({
      records: [expect.objectContaining({ isSynced: 0 }), expect.objectContaining({ isSynced: 0 })],
    });
    expect(records.map((record) => record.isSynced)).toEqual([1, 1]);
  });

  it('retries a pending marker without creating a duplicate', async () => {
    const records = [{ ...recordFor('pending'), id: 203, isSynced: 0 } as NativeRecord];
    const calls = installNativeApi(records);

    const result = await writeTomatodoRecordThroughBridge(recordFor('pending'));

    expect(result).toMatchObject({
      ok: true,
      recordFound: true,
      localChanged: false,
      cloudSynced: true,
      skipped: true,
    });
    expect(calls.addCalls).toHaveLength(0);
    expect(calls.uploadCalls).toHaveLength(1);
    expect(records).toHaveLength(1);
    expect(records[0]?.isSynced).toBe(1);
  });

  it('leaves the local record pending when cloud upload is not confirmed', async () => {
    const records: NativeRecord[] = [];
    const calls = installNativeApi(records, async () => ({ success: false, error: 'offline' }));

    const result = await writeTomatodoRecordThroughBridge(recordFor('upload-failed'));

    expect(result).toMatchObject({
      ok: true,
      recordFound: true,
      localWritten: true,
      cloudSynced: false,
      cloudError: 'offline',
    });
    expect(calls.uploadCalls).toHaveLength(1);
    expect(records[0]?.isSynced).toBe(0);
    expect(calls.updateCalls.some((record) => record.isSynced === 1)).toBe(false);
  });

  it('reports a missing subject marker as not found instead of a successful update', async () => {
    const records: NativeRecord[] = [];
    const calls = installNativeApi(records);

    const result = await updateTomatodoSubjectThroughBridge('missing', '数学');

    expect(result).toMatchObject({
      ok: true,
      recordFound: false,
      localWritten: false,
      localChanged: false,
      cloudSynced: false,
      skipped: true,
    });
    expect(calls.updateCalls).toHaveLength(0);
    expect(calls.uploadCalls).toHaveLength(0);
  });

  it('does not reset an unchanged cloud-synced subject to pending', async () => {
    const records = [
      { ...recordFor('same-subject', '数学'), id: 204, isSynced: 1 } as NativeRecord,
    ];
    const calls = installNativeApi(records);

    const result = await updateTomatodoSubjectThroughBridge('same-subject', '数学');

    expect(result).toMatchObject({
      recordFound: true,
      localChanged: false,
      cloudSynced: true,
      skipped: true,
    });
    expect(calls.updateCalls).toHaveLength(0);
    expect(calls.uploadCalls).toHaveLength(0);
    expect(records[0]?.isSynced).toBe(1);
  });
});
