// 番茄 Todo 原生云同步桥：通过经过身份校验的本地 CDP 页面调用 electronAPI。
// 只有上传接口明确返回 success 后，才把 PCRecord.isSynced 标为 1；当前客户端没有
// 专注记录的独立云端回读或远端删除 API，不能把该响应描述成“云端回读”。
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
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

interface CdpTargetSearchResult {
  target: CdpTarget | null;
  pageDiscovered: boolean;
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
  /** 番茄 Todo 的 cloudSyncUploadRecord 明确返回 success；不代表独立云端回读。 */
  uploadConfirmed: boolean;
  /** 当前番茄 Todo electronAPI 不提供专注记录云端回读。 */
  cloudRecordReadbackSupported: false;
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
  uploadConfirmed?: boolean;
  skipped?: boolean;
  recordId?: number;
  error?: string;
  cloudError?: string;
}

export interface TomatodoBridgeDeleteResult {
  available: boolean;
  ok: boolean;
  deletedCount: number;
  /** 当前桥只能删除番茄 Todo 本地 PCRecord。 */
  cleanupScope: 'local-record-only';
  /** 当前番茄 Todo electronAPI / CloudSyncService 不提供远端记录删除。 */
  remoteDeleteSupported: false;
  error?: string;
}

const DEFAULT_CDP_PORT = 9222;
const HTTP_TIMEOUT_MS = 1600;
const EVALUATE_TIMEOUT_MS = 12_000;

function candidatePorts(): number[] {
  const configuredPort = Number(process.env.FOCUSLINK_TOMATODO_CDP_PORT);
  const ports = new Set<number>();
  if (Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535) {
    // 显式端口用于真实 smoke 和受控部署，不能失败后静默落到可能被其他应用占用的 9222。
    return [configuredPort];
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

const TOMATODO_IDENTITY_METHODS = [
  'getAllRecords',
  'addRecord',
  'updateRecord',
  'deleteRecord',
  'getRecentUnsyncedRecordsForCurrentDevice',
  'cloudSyncGetStatus',
  'cloudSyncUploadRecord',
  'cloudSyncFetchTodo',
] as const;

async function isVerifiedTomatodoTarget(target: CdpTarget): Promise<boolean> {
  const metadataTitle = JSON.stringify(String(target.title ?? ''));
  const methods = JSON.stringify(TOMATODO_IDENTITY_METHODS);
  const expression = `
    (function () {
      var api = window.electronAPI;
      var runtimeTitle = typeof document === 'object' ? String(document.title || '') : '';
      var titles = [${metadataTitle}, runtimeTitle].map(function (value) {
        return String(value || '').replace(/\\s+/g, '').toLowerCase();
      });
      var branded = titles.some(function (title) {
        return title === '番茄todo' || title === 'tomatodo';
      });
      var methods = ${methods};
      var missingMethods = methods.filter(function (name) {
        return !api || typeof api[name] !== 'function';
      });
      return JSON.stringify({ verified: branded && missingMethods.length === 0 });
    })()
  `;
  try {
    const raw = await evaluate(target, expression);
    if (typeof raw !== 'string') return false;
    const result = JSON.parse(raw) as { verified?: unknown };
    return result.verified === true;
  } catch {
    return false;
  }
}

async function findPageTarget(): Promise<CdpTargetSearchResult> {
  let pageDiscovered = false;
  for (const port of candidatePorts()) {
    try {
      const targets = (await getJson(`http://127.0.0.1:${port}/json`)) as CdpTarget[];
      const pages = Array.isArray(targets)
        ? targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl)
        : [];
      if (pages.length > 0) pageDiscovered = true;
      for (const target of pages) {
        if (await isVerifiedTomatodoTarget(target)) return { target, pageDiscovered: true };
      }
    } catch {
      // 继续尝试其他已知端口。
    }
  }
  return { target: null, pageDiscovered };
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
  const search = await findPageTarget();
  if (!search.target) {
    return {
      available: false,
      error: search.pageDiscovered
        ? 'tomatodo_bridge_identity_not_verified'
        : 'tomatodo_bridge_unavailable',
    };
  }
  try {
    const raw = await evaluate(search.target, expression);
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
 * 一次写入多个 marker，并只调用一次 cloudSyncUploadRecord。上传接口会限制连续单条调用，
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
              uploadConfirmed: false, skipped: skipped, error: 'tomatodo_insert_failed'
            });
            continue;
          }
          if (inserted.name !== input.name) {
            inserted = Object.assign({}, inserted, { name: input.name, isSynced: 0 });
            await api.updateRecord(inserted);
            localChanged = true;
          }
          var uploadConfirmed = Number(inserted.isSynced) === 1;
          var result = {
            ok: true, recordFound: true, localWritten: true, localChanged: localChanged,
            uploadConfirmed: uploadConfirmed, skipped: skipped, recordId: inserted.id, cloudError: null
          };
          results.push(result);
          if (!uploadConfirmed) pending.push({ record: inserted, result: result });
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
                    item.result.uploadConfirmed = true;
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
  const value = evaluated.value as (EvaluatedResult & { results?: EvaluatedResult[] }) | undefined;
  const results = (value?.results ?? []).map((result) => ({
    available: true,
    ok: Boolean(result.ok),
    recordFound: Boolean(result.recordFound),
    localWritten: Boolean(result.localWritten),
    localChanged: Boolean(result.localChanged),
    uploadConfirmed: Boolean(result.uploadConfirmed),
    cloudRecordReadbackSupported: false as const,
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

/** 通过番茄 Todo 自己的数据库与上传 API 写入，避免运行中直接改 JSON 被覆盖。 */
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

        var uploadConfirmed = Number(inserted.isSynced) === 1;
        var cloudError = null;
        if (!uploadConfirmed && (!api.cloudSyncGetStatus || !api.cloudSyncUploadRecord)) {
          cloudError = 'tomatodo_cloud_api_unavailable';
        } else if (!uploadConfirmed) {
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
                // 只有上传确认且本地状态成功持久化后才报告 uploadConfirmed。
                uploadConfirmed = true;
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
          uploadConfirmed: uploadConfirmed,
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
      uploadConfirmed: false,
      cloudRecordReadbackSupported: false,
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
    uploadConfirmed: Boolean(value?.uploadConfirmed),
    cloudRecordReadbackSupported: false,
    skipped: Boolean(value?.skipped),
    recordId: value?.recordId,
    error: value?.error ?? evaluated.error,
    cloudError: value?.cloudError,
  };
}

/** 在番茄 Todo 正运行时用其原生 API 更新分类并请求重新上传。 */
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
          uploadConfirmed: false, skipped: true
        });
        var subjectChanged = record.name !== ${subjectJson};
        if (!subjectChanged && Number(record.isSynced) === 1) {
          return JSON.stringify({
            ok: true, recordFound: true, localWritten: true, localChanged: false,
            uploadConfirmed: true, skipped: true, recordId: record.id
          });
        }
        if (subjectChanged) {
          record = Object.assign({}, record, { name: ${subjectJson}, isSynced: 0 });
          await api.updateRecord(record);
        }
        var uploadConfirmed = false;
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
              uploadConfirmed = true;
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
          uploadConfirmed: uploadConfirmed, skipped: !subjectChanged,
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
    uploadConfirmed: Boolean(value?.uploadConfirmed),
    cloudRecordReadbackSupported: false,
    skipped: Boolean(value?.skipped),
    recordId: value?.recordId,
    error: value?.error ?? evaluated.error,
    cloudError: value?.cloudError,
  };
}

/**
 * 删除联动交给番茄 Todo 本地数据库 API，避免运行中直接改文件被回写覆盖。
 * 当前客户端未暴露专注记录远端删除能力，因此返回值明确限定为本地清理。
 */
export async function deleteTomatodoRecordThroughBridge(
  segmentId: string,
): Promise<TomatodoBridgeDeleteResult> {
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
    cleanupScope: 'local-record-only',
    remoteDeleteSupported: false,
    error: value?.error ?? evaluated.error,
  };
}
