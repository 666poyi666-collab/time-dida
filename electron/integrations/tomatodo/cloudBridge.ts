// 番茄 Todo 原生云同步桥：通过其本地 CDP 页面调用 electronAPI。
// 只有云上传接口明确返回 success 后，才把 PCRecord.isSynced 标为 1。
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

import { logger } from '../../logger.js';
import type { TomatodoPCRecord } from '../../../shared/tomatodoPolicy.js';
import type { TomatodoSubject } from '@shared/types';

interface CdpTarget {
  type?: string;
  webSocketDebuggerUrl?: string;
}

export interface TomatodoBridgeWriteResult {
  /** false 表示番茄 Todo 没有开放本地调试桥，调用方应决定是否安全回退写文件。 */
  available: boolean;
  ok: boolean;
  /** marker 对应的记录在调用结束时确实存在。 */
  recordFound: boolean;
  localWritten: boolean;
  /** 本次调用新建记录或改变了业务分类（不计云同步状态字段）。 */
  localChanged: boolean;
  cloudSynced: boolean;
  skipped: boolean;
  recordId?: number;
  error?: string;
  cloudError?: string;
}

export interface TomatodoBridgeBatchWriteResult {
  available: boolean;
  ok: boolean;
  results: TomatodoBridgeWriteResult[];
  error?: string;
}

interface EvaluatedResult {
  ok: boolean;
  recordFound?: boolean;
  localWritten?: boolean;
  localChanged?: boolean;
  cloudSynced?: boolean;
  skipped?: boolean;
  recordId?: number;
  error?: string;
  cloudError?: string;
}

const DEFAULT_CDP_PORT = 9222;
const HTTP_TIMEOUT_MS = 1600;
const EVALUATE_TIMEOUT_MS = 12_000;

function candidatePorts(): number[] {
  const configuredPort = Number(process.env.FOCUSLINK_TOMATODO_CDP_PORT);
  const ports = new Set<number>();
  if (Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535) {
    ports.add(configuredPort);
  }
  const roaming = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  for (const folder of ['tomatodo', '番茄ToDo']) {
    const activePortFile = path.join(roaming, folder, 'DevToolsActivePort');
    try {
      const firstLine = fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/, 1)[0]?.trim();
      const port = Number(firstLine);
      if (Number.isInteger(port) && port > 0 && port <= 65535) ports.add(port);
    } catch {
      // 正常安装未开启调试端口时文件可能不存在。
    }
  }
  // DevToolsActivePort 是番茄 Todo 自己发布的端口，优先级应高于可能被其他应用占用的 9222。
  ports.add(DEFAULT_CDP_PORT);
  return [...ports];
}

function getJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: HTTP_TIMEOUT_MS }, (response) => {
      if ((response.statusCode ?? 500) >= 400) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.setEncoding('utf8');
      let raw = '';
      response.on('data', (chunk: string) => {
        raw += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

async function findPageTarget(): Promise<CdpTarget | null> {
  for (const port of candidatePorts()) {
    try {
      const targets = (await getJson(`http://127.0.0.1:${port}/json`)) as CdpTarget[];
      const page = Array.isArray(targets)
        ? targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
        : null;
      if (page) return page;
    } catch {
      // 继续尝试其他已知端口。
    }
  }
  return null;
}

function evaluate(target: CdpTarget, expression: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = target.webSocketDebuggerUrl;
    if (!url) {
      reject(new Error('missing_websocket_url'));
      return;
    }
    const socket = new WebSocket(url, { handshakeTimeout: HTTP_TIMEOUT_MS });
    const id = 1;
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error('tomatodo_bridge_timeout'), true),
      EVALUATE_TIMEOUT_MS,
    );
    const finish = (error?: Error, terminate = false, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (terminate) socket.terminate();
        else socket.close();
      } catch {
        // ignore close failures
      }
      if (error) reject(error);
      else resolve(value);
    };
    socket.once('error', (error) => finish(error));
    socket.once('open', () => {
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as {
          id?: number;
          result?: {
            exceptionDetails?: { text?: string; exception?: { description?: string } };
            result?: { value?: unknown };
          };
          error?: { message?: string };
        };
        if (message.id !== id) return;
        if (message.error) {
          finish(new Error(message.error.message ?? 'cdp_error'));
          return;
        }
        if (message.result?.exceptionDetails) {
          const details = message.result.exceptionDetails;
          finish(new Error(details.exception?.description ?? details.text ?? 'tomatodo_js_error'));
          return;
        }
        finish(undefined, false, message.result?.result?.value);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

async function evaluateJson(expression: string): Promise<{
  available: boolean;
  value?: EvaluatedResult;
  error?: string;
}> {
  const target = await findPageTarget();
  if (!target) return { available: false, error: 'tomatodo_bridge_unavailable' };
  try {
    const raw = await evaluate(target, expression);
    const value = typeof raw === 'string' ? (JSON.parse(raw) as EvaluatedResult) : undefined;
    if (!value) return { available: true, error: 'tomatodo_bridge_invalid_response' };
    return { available: true, value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('tomatodoBridge', 'CDP evaluation failed', { error: message });
    return { available: true, error: message };
  }
}

/**
 * 一次写入多个 marker，并只调用一次 cloudSyncUploadRecord。番茄云端会限制连续单条上传，
 * 会话级同步必须走这个批量事务，否则通常只有第一条能立即成功。
 */
export async function writeTomatodoRecordsThroughBridge(
  inputRecords: Array<Omit<TomatodoPCRecord, 'id'>>,
): Promise<TomatodoBridgeBatchWriteResult> {
  if (inputRecords.length === 0) return { available: true, ok: true, results: [] };
  const payload = JSON.stringify(inputRecords.map((record) => ({ ...record, id: null })));
  const expression = `
    (async function () {
      try {
        var api = window.electronAPI;
        if (!api || !api.addRecord || !api.getAllRecords || !api.updateRecord) {
          return JSON.stringify({ ok: false, error: 'tomatodo_record_api_unavailable', results: [] });
        }
        var inputs = ${payload};
        var records = await api.getAllRecords();
        var results = [];
        var pending = [];
        for (var input of inputs) {
          var existing = records.find(function (item) {
            return String(item.s1 || '').indexOf(String(input.s1 || '')) >= 0;
          }) || null;
          var inserted = existing;
          var skipped = !!existing;
          var localChanged = false;
          if (!inserted) {
            var added = await api.addRecord(input);
            localChanged = true;
            records = await api.getAllRecords();
            if (added && added.id != null) {
              inserted = records.find(function (item) { return item.id === added.id; }) || null;
            }
            if (!inserted) {
              inserted = records.find(function (item) {
                return item.s1 === input.s1 && item.startDate === input.startDate;
              }) || null;
            }
          }
          if (!inserted) {
            results.push({
              ok: false, recordFound: false, localWritten: false, localChanged: localChanged,
              cloudSynced: false, skipped: skipped, error: 'tomatodo_insert_failed'
            });
            continue;
          }
          if (inserted.name !== input.name) {
            inserted = Object.assign({}, inserted, { name: input.name, isSynced: 0 });
            await api.updateRecord(inserted);
            localChanged = true;
          }
          var cloudSynced = Number(inserted.isSynced) === 1;
          var result = {
            ok: true, recordFound: true, localWritten: true, localChanged: localChanged,
            cloudSynced: cloudSynced, skipped: skipped, recordId: inserted.id, cloudError: null
          };
          results.push(result);
          if (!cloudSynced) pending.push({ record: inserted, result: result });
        }

        if (pending.length > 0) {
          if (!api.cloudSyncGetStatus || !api.cloudSyncUploadRecord) {
            for (var item of pending) item.result.cloudError = 'tomatodo_cloud_api_unavailable';
          } else {
            try {
              var status = await api.cloudSyncGetStatus();
              if (status && (status.isBound || status.bound)) {
                for (var item of pending) {
                  item.record = Object.assign({}, item.record, {
                    isSynced: 0,
                    boundDeviceId: item.record.boundDeviceId || status.deviceToken || null
                  });
                  await api.updateRecord(item.record);
                }
                var uploaded = await api.cloudSyncUploadRecord({
                  records: pending.map(function (item) { return item.record; }),
                  updateTime: Date.now()
                });
                if (uploaded && uploaded.success) {
                  for (var item of pending) {
                    item.record = Object.assign({}, item.record, { isSynced: 1 });
                    await api.updateRecord(item.record);
                    item.result.cloudSynced = true;
                  }
                } else {
                  var uploadError = (uploaded && (uploaded.error || uploaded.message || uploaded.code)) || 'cloud_upload_failed';
                  for (var item of pending) item.result.cloudError = String(uploadError);
                }
              } else {
                for (var item of pending) item.result.cloudError = 'tomatodo_cloud_not_bound';
              }
            } catch (error) {
              var message = error && error.message ? error.message : String(error);
              for (var item of pending) item.result.cloudError = message;
            }
          }
        }
        return JSON.stringify({
          ok: results.every(function (result) { return result.ok; }),
          results: results
        });
      } catch (error) {
        return JSON.stringify({
          ok: false, results: [], error: error && error.message ? error.message : String(error)
        });
      }
    })()
  `;
  const evaluated = await evaluateJson(expression);
  if (!evaluated.available) {
    return { available: false, ok: false, results: [], error: evaluated.error };
  }
  const value = evaluated.value as
    | (EvaluatedResult & { results?: Array<Omit<TomatodoBridgeWriteResult, 'available'>> })
    | undefined;
  const results = (value?.results ?? []).map((result) => ({
    available: true,
    ok: Boolean(result.ok),
    recordFound: Boolean(result.recordFound),
    localWritten: Boolean(result.localWritten),
    localChanged: Boolean(result.localChanged),
    cloudSynced: Boolean(result.cloudSynced),
    skipped: Boolean(result.skipped),
    recordId: result.recordId,
    error: result.error,
    cloudError: result.cloudError ?? undefined,
  }));
  return {
    available: true,
    ok: Boolean(value?.ok) && results.length === inputRecords.length,
    results,
    error: value?.error ?? evaluated.error,
  };
}

/** 通过番茄 Todo 自己的数据库与云同步 API 写入，避免运行中直接改 JSON 被覆盖。 */
export async function writeTomatodoRecordThroughBridge(
  record: Omit<TomatodoPCRecord, 'id'>,
): Promise<TomatodoBridgeWriteResult> {
  const payload = JSON.stringify({ ...record, id: null });
  const expression = `
    (async function () {
      try {
        var api = window.electronAPI;
        if (!api || !api.addRecord || !api.getAllRecords || !api.updateRecord) {
          return JSON.stringify({ ok: false, error: 'tomatodo_record_api_unavailable' });
        }
        var input = ${payload};
        var records = await api.getAllRecords();
        var existing = records.find(function (item) {
          return String(item.s1 || '').indexOf(String(input.s1 || '')) >= 0;
        }) || null;
        var inserted = existing;
        var skipped = !!existing;
        var localChanged = false;
        if (!inserted) {
          var added = await api.addRecord(input);
          localChanged = true;
          records = await api.getAllRecords();
          if (added && added.id != null) {
            inserted = records.find(function (item) { return item.id === added.id; }) || null;
          }
          if (!inserted) {
            inserted = records.find(function (item) {
              return item.s1 === input.s1 && item.startDate === input.startDate;
            }) || null;
          }
        }
        if (!inserted) {
          return JSON.stringify({
            ok: false, recordFound: false, localWritten: false, localChanged: localChanged,
            error: 'tomatodo_insert_failed'
          });
        }
        // marker 相同且分类未变化时保持原同步状态，不能把已确认的 1 打回 0。
        if (inserted.name !== input.name) {
          inserted = Object.assign({}, inserted, { name: input.name, isSynced: 0 });
          await api.updateRecord(inserted);
          localChanged = true;
        }

        var cloudSynced = Number(inserted.isSynced) === 1;
        var cloudError = null;
        if (!cloudSynced && (!api.cloudSyncGetStatus || !api.cloudSyncUploadRecord)) {
          cloudError = 'tomatodo_cloud_api_unavailable';
        } else if (!cloudSynced) {
          try {
            var status = await api.cloudSyncGetStatus();
            if (status && (status.isBound || status.bound)) {
              inserted = Object.assign({}, inserted, {
                isSynced: 0,
                boundDeviceId: inserted.boundDeviceId || status.deviceToken || null
              });
              await api.updateRecord(inserted);
              var uploaded = await api.cloudSyncUploadRecord({ records: [inserted], updateTime: Date.now() });
              if (uploaded && uploaded.success) {
                inserted = Object.assign({}, inserted, { isSynced: 1 });
                await api.updateRecord(inserted);
                // 只有上传确认且本地状态成功持久化后才报告 cloudSynced。
                cloudSynced = true;
              } else {
                cloudError = (uploaded && uploaded.error) || 'cloud_upload_failed';
              }
            } else {
              cloudError = 'tomatodo_cloud_not_bound';
            }
          } catch (error) {
            cloudError = error && error.message ? error.message : String(error);
          }
        }
        return JSON.stringify({
          ok: true,
          recordFound: true,
          localWritten: true,
          localChanged: localChanged,
          cloudSynced: cloudSynced,
          skipped: skipped,
          recordId: inserted.id,
          cloudError: cloudError
        });
      } catch (error) {
        return JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) });
      }
    })()
  `;
  const evaluated = await evaluateJson(expression);
  if (!evaluated.available) {
    return {
      available: false,
      ok: false,
      recordFound: false,
      localWritten: false,
      localChanged: false,
      cloudSynced: false,
      skipped: false,
      error: evaluated.error,
    };
  }
  const value = evaluated.value;
  return {
    available: true,
    ok: Boolean(value?.ok),
    recordFound: Boolean(value?.recordFound),
    localWritten: Boolean(value?.localWritten),
    localChanged: Boolean(value?.localChanged),
    cloudSynced: Boolean(value?.cloudSynced),
    skipped: Boolean(value?.skipped),
    recordId: value?.recordId,
    error: value?.error ?? evaluated.error,
    cloudError: value?.cloudError,
  };
}

/** 在番茄 Todo 正运行时用其原生 API 更新分类并重新上云。 */
export async function updateTomatodoSubjectThroughBridge(
  segmentId: string,
  subject: TomatodoSubject,
): Promise<TomatodoBridgeWriteResult> {
  const marker = JSON.stringify(`[FocusLink:tomatodo:segment:${segmentId}]`);
  const subjectJson = JSON.stringify(subject);
  const expression = `
    (async function () {
      try {
        var api = window.electronAPI;
        if (!api || !api.getAllRecords || !api.updateRecord) {
          return JSON.stringify({ ok: false, error: 'tomatodo_record_api_unavailable' });
        }
        var records = await api.getAllRecords();
        var record = records.find(function (item) {
          return String(item.s1 || '').indexOf(${marker}) >= 0;
        }) || null;
        if (!record) return JSON.stringify({
          ok: true, recordFound: false, localWritten: false, localChanged: false,
          cloudSynced: false, skipped: true
        });
        var subjectChanged = record.name !== ${subjectJson};
        if (!subjectChanged && Number(record.isSynced) === 1) {
          return JSON.stringify({
            ok: true, recordFound: true, localWritten: true, localChanged: false,
            cloudSynced: true, skipped: true, recordId: record.id
          });
        }
        if (subjectChanged) {
          record = Object.assign({}, record, { name: ${subjectJson}, isSynced: 0 });
          await api.updateRecord(record);
        }
        var cloudSynced = false;
        var cloudError = null;
        try {
          if (!api.cloudSyncGetStatus || !api.cloudSyncUploadRecord) {
            cloudError = 'tomatodo_cloud_api_unavailable';
          } else {
            var status = await api.cloudSyncGetStatus();
            if (status && (status.isBound || status.bound)) {
            record.boundDeviceId = record.boundDeviceId || status.deviceToken || null;
            await api.updateRecord(record);
            var uploaded = await api.cloudSyncUploadRecord({ records: [record], updateTime: Date.now() });
            if (uploaded && uploaded.success) {
              record.isSynced = 1;
              await api.updateRecord(record);
              cloudSynced = true;
            } else {
              cloudError = (uploaded && uploaded.error) || 'cloud_upload_failed';
            }
            } else {
              cloudError = 'tomatodo_cloud_not_bound';
            }
          }
        } catch (error) {
          cloudError = error && error.message ? error.message : String(error);
        }
        return JSON.stringify({
          ok: true, recordFound: true, localWritten: true, localChanged: subjectChanged,
          cloudSynced: cloudSynced, skipped: !subjectChanged,
          recordId: record.id, cloudError: cloudError
        });
      } catch (error) {
        return JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) });
      }
    })()
  `;
  const evaluated = await evaluateJson(expression);
  const value = evaluated.value;
  return {
    available: evaluated.available,
    ok: Boolean(value?.ok),
    recordFound: Boolean(value?.recordFound),
    localWritten: Boolean(value?.localWritten),
    localChanged: Boolean(value?.localChanged),
    cloudSynced: Boolean(value?.cloudSynced),
    skipped: Boolean(value?.skipped),
    recordId: value?.recordId,
    error: value?.error ?? evaluated.error,
    cloudError: value?.cloudError,
  };
}

/** 删除联动优先交给番茄 Todo 自己执行，避免运行中直接改文件被回写覆盖。 */
export async function deleteTomatodoRecordThroughBridge(segmentId: string): Promise<{
  available: boolean;
  ok: boolean;
  deletedCount: number;
  error?: string;
}> {
  const marker = JSON.stringify(`[FocusLink:tomatodo:segment:${segmentId}]`);
  const expression = `
    (async function () {
      try {
        var api = window.electronAPI;
        if (!api || !api.getAllRecords || !api.deleteRecord) {
          return JSON.stringify({ ok: false, error: 'tomatodo_record_api_unavailable' });
        }
        var records = await api.getAllRecords();
        var matches = records.filter(function (item) {
          return String(item.s1 || '').indexOf(${marker}) >= 0;
        });
        for (var record of matches) await api.deleteRecord(record.id);
        return JSON.stringify({ ok: true, deletedCount: matches.length });
      } catch (error) {
        return JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) });
      }
    })()
  `;
  const evaluated = await evaluateJson(expression);
  const value = evaluated.value as (EvaluatedResult & { deletedCount?: number }) | undefined;
  return {
    available: evaluated.available,
    ok: Boolean(value?.ok),
    deletedCount: Number(value?.deletedCount ?? 0),
    error: value?.error ?? evaluated.error,
  };
}
