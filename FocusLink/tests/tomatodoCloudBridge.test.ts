import http from 'node:http';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';

vi.mock('electron', () => ({
  app: { getPath: () => '' },
}));

import {
  deleteTomatodoRecordThroughBridge,
  probeTomatodoBridge,
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
  let targetTitle = '番茄ToDo';
  let documentTitle = '番茄ToDo';

  beforeEach(async () => {
    electronApi = {};
    targetTitle = '番茄ToDo';
    documentTitle = '番茄ToDo';
    server = http.createServer((request, response) => {
      if (request.url === '/json') {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify([
            {
              type: 'page',
              title: targetTitle,
              url: 'file:///C:/Program%20Files/TomaToDo/resources/app.asar/index.html',
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
            document: { title: documentTitle },
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
    const endedAt = Date.now() - 1_000;
    return buildTomatodoRecord({
      segmentId,
      subject,
      startedAt: endedAt - 60_000,
      endedAt,
      activeElapsedMs: 60_000,
    });
  }

  function installNativeApi(
    records: NativeRecord[],
    upload: (payload: unknown) => Promise<unknown> = async () => ({ success: true }),
  ): {
    addCalls: unknown[];
    deleteCalls: number[];
    updateCalls: NativeRecord[];
    uploadCalls: unknown[];
  } {
    const addCalls: unknown[] = [];
    const deleteCalls: number[] = [];
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
      deleteRecord: async (recordId: number) => {
        deleteCalls.push(recordId);
        const index = records.findIndex((item) => item.id === recordId);
        if (index >= 0) records.splice(index, 1);
        return { success: index >= 0 };
      },
      getRecentUnsyncedRecordsForCurrentDevice: async () => [],
      cloudSyncGetStatus: async () => ({ isBound: true, deviceToken: 'test-device' }),
      cloudSyncFetchTodo: async () => ({ success: true, todos: [] }),
      cloudSyncUploadRecord: async (payload: unknown) => {
        uploadCalls.push(payload);
        return upload(payload);
      },
    };
    return { addCalls, deleteCalls, updateCalls, uploadCalls };
  }

  it('probes bridge identity without reading or mutating records', async () => {
    const records: NativeRecord[] = [];
    const calls = installNativeApi(records);

    await expect(probeTomatodoBridge()).resolves.toEqual({
      connected: true,
      pageDiscovered: true,
    });
    expect(calls.addCalls).toHaveLength(0);
    expect(calls.updateCalls).toHaveLength(0);
    expect(calls.deleteCalls).toHaveLength(0);
    expect(calls.uploadCalls).toHaveLength(0);
  });

  it('rejects a CDP page that does not verify as TomaToDo', async () => {
    const records: NativeRecord[] = [];
    const calls = installNativeApi(records);
    targetTitle = 'Unrelated DevTools Page';
    documentTitle = 'Unrelated DevTools Page';

    const result = await writeTomatodoRecordThroughBridge(recordFor('wrong-target'));

    expect(result).toMatchObject({
      available: false,
      ok: false,
      uploadConfirmed: false,
      cloudRecordReadbackSupported: false,
      error: 'tomatodo_bridge_identity_not_verified',
    });
    expect(calls.addCalls).toHaveLength(0);
    expect(calls.uploadCalls).toHaveLength(0);
  });

  it('rejects a branded page that does not expose the TomaToDo API signature', async () => {
    const result = await writeTomatodoRecordThroughBridge(recordFor('missing-signature'));

    expect(result).toMatchObject({
      available: false,
      ok: false,
      uploadConfirmed: false,
      cloudRecordReadbackSupported: false,
      error: 'tomatodo_bridge_identity_not_verified',
    });
  });

  it('uses native add/upload and reports upload confirmation without claiming cloud readback', async () => {
    const records: NativeRecord[] = [];
    const calls = installNativeApi(records);

    const result = await writeTomatodoRecordThroughBridge(recordFor('bridge-segment'));

    expect(result).toMatchObject({
      available: true,
      ok: true,
      recordFound: true,
      localWritten: true,
      localChanged: true,
      uploadConfirmed: true,
      cloudRecordReadbackSupported: false,
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
      uploadConfirmed: true,
      cloudRecordReadbackSupported: false,
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
    expect(result.results.every((item) => item.uploadConfirmed)).toBe(true);
    expect(result.results.every((item) => !item.cloudRecordReadbackSupported)).toBe(true);
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
      uploadConfirmed: true,
      cloudRecordReadbackSupported: false,
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
      uploadConfirmed: false,
      cloudRecordReadbackSupported: false,
      cloudError: 'offline',
    });
    expect(calls.uploadCalls).toHaveLength(1);
    expect(records[0]?.isSynced).toBe(0);
    expect(calls.updateCalls.some((record) => record.isSynced === 1)).toBe(false);
  });

  it('does not confirm records outside TomaToDo seven-day cloud window', async () => {
    const records: NativeRecord[] = [];
    const calls = installNativeApi(records);
    const stale = recordFor('stale-record');
    stale.startDate = Date.now() - 8 * 24 * 60 * 60 * 1_000;
    stale.createDate = stale.startDate + 60_000;

    const result = await writeTomatodoRecordThroughBridge(stale);

    expect(result).toMatchObject({
      ok: true,
      localWritten: true,
      uploadConfirmed: false,
      cloudError: 'tomatodo_record_outside_seven_day_window',
    });
    expect(calls.uploadCalls).toHaveLength(0);
    expect(records[0]?.isSynced).toBe(0);
  });

  it('separates cloud upload confirmation from phone delivery when no phone is connected', async () => {
    const records: NativeRecord[] = [];
    const calls = installNativeApi(records);
    const syncRecord = vi.fn(async (_record: unknown, _reason: unknown) => ({ success: true }));
    electronApi.syncGetStatus = vi.fn(async () => ({ isRunning: true, connectedCount: 0 }));
    electronApi.syncRecord = syncRecord;

    const result = await writeTomatodoRecordThroughBridge(recordFor('phone-pending'), {
      syncToPhone: true,
    });

    expect(result).toMatchObject({
      ok: true,
      uploadConfirmed: true,
      phoneSyncConfirmed: false,
      phoneSyncError: 'tomatodo_phone_not_connected',
    });
    expect(syncRecord).not.toHaveBeenCalled();
    expect(records[0]?.isSynced).toBe(1);
    expect(calls.uploadCalls).toHaveLength(1);
  });

  it('hands a cloud-confirmed record to the direct phone channel when connected', async () => {
    const records: NativeRecord[] = [];
    installNativeApi(records);
    const syncRecord = vi.fn(async (_record: unknown, _reason: unknown) => ({ success: true }));
    electronApi.syncGetStatus = vi.fn(async () => ({ isRunning: true, connectedCount: 1 }));
    electronApi.syncRecord = syncRecord;

    const result = await writeTomatodoRecordThroughBridge(recordFor('phone-delivered'), {
      syncToPhone: true,
    });

    expect(result).toMatchObject({
      ok: true,
      uploadConfirmed: true,
      phoneSyncConfirmed: true,
    });
    expect(syncRecord).toHaveBeenCalledTimes(1);
    expect(syncRecord.mock.calls[0]?.[0]).toMatchObject({
      s1: '[FocusLink:tomatodo:segment:phone-delivered]',
      isSynced: 0,
    });
  });

  it('does not let an existing cloud marker skip a requested phone delivery', async () => {
    const records = [{ ...recordFor('phone-retry'), id: 220, isSynced: 1 } as NativeRecord];
    installNativeApi(records);
    const syncRecord = vi.fn(async (_record: unknown, _reason: unknown) => ({ success: true }));
    electronApi.syncGetStatus = vi.fn(async () => ({ isRunning: true, connectedCount: 1 }));
    electronApi.syncRecord = syncRecord;

    const result = await writeTomatodoRecordThroughBridge(recordFor('phone-retry'), {
      syncToPhone: true,
    });

    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      uploadConfirmed: true,
      phoneSyncConfirmed: true,
    });
    expect(syncRecord).toHaveBeenCalledTimes(1);
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
      uploadConfirmed: false,
      cloudRecordReadbackSupported: false,
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
      uploadConfirmed: true,
      cloudRecordReadbackSupported: false,
      skipped: true,
    });
    expect(calls.updateCalls).toHaveLength(0);
    expect(calls.uploadCalls).toHaveLength(0);
    expect(records[0]?.isSynced).toBe(1);
  });

  it('deletes only the matching local record and exposes the missing remote-delete capability', async () => {
    const records = [
      { ...recordFor('cleanup-target'), id: 205, isSynced: 1 } as NativeRecord,
      { ...recordFor('keep-target'), id: 206, isSynced: 1 } as NativeRecord,
    ];
    const calls = installNativeApi(records);

    const result = await deleteTomatodoRecordThroughBridge('cleanup-target');

    expect(result).toEqual({
      available: true,
      ok: true,
      deletedCount: 1,
      cleanupScope: 'local-record-only',
      remoteDeleteSupported: false,
      error: undefined,
    });
    expect(calls.deleteCalls).toEqual([205]);
    expect(records.map((record) => record.id)).toEqual([206]);
  });
});
