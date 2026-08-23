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

export interface TomatodoBridgeProbeResult {
  connected: boolean;
  pageDiscovered: boolean;
  error?: 'tomatodo_bridge_unavailable' | 'tomatodo_bridge_identity_not_verified';
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
  /** 电脑版已把同一条记录交给在线手机同步通道。 */
  phoneSyncConfirmed: boolean;
  /** 手机同步通道的可诊断失败原因。 */
  phoneSyncError?: string;
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

export interface TomatodoBridgeWriteOptions {
  /** 同时调用 TomaToDo 的直接手机同步通道。 */
  syncToPhone?: boolean;
}

interface EvaluatedResult {
  ok: boolean;
  recordFound?: boolean;
  localWritten?: boolean;
  localChanged?: boolean;
  uploadConfirmed?: boolean;
  phoneSyncConfirmed?: boolean;
  phoneSyncError?: string;
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

const TOMATODO_CLOUD_IDENTITY_METHODS = [
  'getAllRecords',
  'addRecord',
  'updateRecord',
  'deleteRecord',
  'getRecentUnsyncedRecordsForCurrentDevice',
  'cloudSyncGetStatus',
  'cloudSyncUploadRecord',
  'cloudSyncFetchTodo',
] as const;

const TOMATODO_PHONE_IDENTITY_METHODS = ['syncGetStatus', 'syncRecord'] as const;

async function isVerifiedTomatodoTarget(
  target: CdpTarget,
  requiredMethods: readonly string[] = TOMATODO_CLOUD_IDENTITY_METHODS,
): Promise<boolean> {
  const metadataTitle = JSON.stringify(String(target.title ?? ''));
  const methods = JSON.stringify(requiredMethods);
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

async function findPageTarget(
  requiredMethods: readonly string[] = TOMATODO_CLOUD_IDENTITY_METHODS,
): Promise<CdpTargetSearchResult> {
  let pageDiscovered = false;
  for (const port of candidatePorts()) {
    try {
      const targets = (await getJson(`http://127.0.0.1:${port}/json`)) as CdpTarget[];
      const pages = Array.isArray(targets)
        ? targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl)
        : [];
      if (pages.length > 0) pageDiscovered = true;
      for (const target of pages) {
        if (await isVerifiedTomatodoTarget(target, requiredMethods)) {
          return { target, pageDiscovered: true };
        }
      }
    } catch {
      // 继续尝试其他已知端口。
    }
  }
  return { target: null, pageDiscovered };
}

/**
 * Probe the native bridge without reading or mutating any TomaToDo records.
 * Identity verification evaluates only the document title and method presence.
 */
export async function probeTomatodoBridge(): Promise<TomatodoBridgeProbeResult> {
  const search = await findPageTarget();
  if (search.target) {
    return { connected: true, pageDiscovered: true };
  }
  return {
    connected: false,
    pageDiscovered: search.pageDiscovered,
    error: search.pageDiscovered
      ? 'tomatodo_bridge_identity_not_verified'
      : 'tomatodo_bridge_unavailable',
  };
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

async function evaluateJson(
  expression: string,
  requiredMethods: readonly string[] = TOMATODO_CLOUD_IDENTITY_METHODS,
): Promise<{
  available: boolean;
  value?: EvaluatedResult;
  error?: string;
}> {
  const search = await findPageTarget(requiredMethods);
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
  options: TomatodoBridgeWriteOptions = {},
): Promise<TomatodoBridgeBatchWriteResult> {
  if (inputRecords.length === 0) return { available: true, ok: true, results: [] };
  const syncToPhone = options.syncToPhone === true;
  const payload = JSON.stringify(inputRecords.map((record) => ({ ...record, id: null })));
  const expression = `
    (async function () {
      try {
        var api = window.electronAPI;
        if (!api || !api.addRecord || !api.getAllRecords || !api.updateRecord ||
            (${syncToPhone} && (!api.syncGetStatus || !api.syncRecord))) {
          return JSON.stringify({ ok: false, error: 'tomatodo_record_api_unavailable', results: [] });
        }
        var inputs = ${payload};
        var records = await api.getAllRecords();
        var prepared = [];
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
            prepared.push({
              record: null,
              result: {
                ok: false, recordFound: false, localWritten: false, localChanged: localChanged,
                uploadConfirmed: false, phoneSyncConfirmed: ${!syncToPhone},
                skipped: skipped, error: 'tomatodo_insert_failed'
              }
            });
            continue;
          }
          if (inserted.name !== input.name) {
            inserted = Object.assign({}, inserted, { name: input.name, isSynced: 0 });
            await api.updateRecord(inserted);
            localChanged = true;
          }
          prepared.push({
            record: inserted,
            result: {
              ok: true, recordFound: true, localWritten: true, localChanged: localChanged,
              uploadConfirmed: Number(inserted.isSynced) === 1,
              phoneSyncConfirmed: ${!syncToPhone},
              skipped: skipped, recordId: inserted.id, cloudError: null, phoneSyncError: null
            }
          });
        }

        var cloudCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        for (var cloudCandidate of prepared) {
          if (cloudCandidate.record && !cloudCandidate.result.uploadConfirmed &&
              Number(cloudCandidate.record.createDate || 0) < cloudCutoff) {
            cloudCandidate.result.cloudError = 'tomatodo_record_outside_seven_day_window';
          }
        }
        var pending = prepared.filter(function (item) {
          return item.record && !item.result.uploadConfirmed && !item.result.cloudError;
        });
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
        if (${syncToPhone}) {
          var phoneStatus = await api.syncGetStatus();
          var phoneConnected = phoneStatus && Number(phoneStatus.connectedCount || 0) > 0;
          if (!phoneConnected) {
            for (var phonePending of prepared) {
              if (phonePending.record) {
                phonePending.result.phoneSyncError = 'tomatodo_phone_not_connected';
              }
            }
          } else {
            for (var phoneItem of prepared) {
              if (!phoneItem.record) continue;
              try {
                var phoneRecord = Object.assign({}, phoneItem.record, { isSynced: 0 });
                var phoneAck = await api.syncRecord(phoneRecord, 'FocusLink手机同步');
                phoneItem.result.phoneSyncConfirmed = Boolean(phoneAck && phoneAck.success);
                if (!phoneItem.result.phoneSyncConfirmed) {
                  phoneItem.result.phoneSyncError =
                    (phoneAck && (phoneAck.error || phoneAck.message || phoneAck.code)) ||
                    'tomatodo_phone_sync_not_confirmed';
                }
              } catch (error) {
                phoneItem.result.phoneSyncError =
                  error && error.message ? error.message : String(error);
              }
            }
          }
        }
        return JSON.stringify({
          ok: prepared.every(function (item) { return item.result.ok; }),
          results: prepared.map(function (item) { return item.result; })
        });
      } catch (error) {
        return JSON.stringify({
          ok: false, results: [], error: error && error.message ? error.message : String(error)
        });
      }
    })()
  `;
  const requiredMethods = syncToPhone
    ? [...TOMATODO_CLOUD_IDENTITY_METHODS, ...TOMATODO_PHONE_IDENTITY_METHODS]
    : TOMATODO_CLOUD_IDENTITY_METHODS;
  const evaluated = await evaluateJson(expression, requiredMethods);
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
    phoneSyncConfirmed: Boolean(result.phoneSyncConfirmed),
    phoneSyncError: result.phoneSyncError ?? undefined,
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
  options: TomatodoBridgeWriteOptions = {},
): Promise<TomatodoBridgeWriteResult> {
  const result = await writeTomatodoRecordsThroughBridge([record], options);
  if (!result.available || !result.results[0]) {
    return {
      available: result.available,
      ok: false,
      recordFound: false,
      localWritten: false,
      localChanged: false,
      uploadConfirmed: false,
      phoneSyncConfirmed: false,
      cloudRecordReadbackSupported: false,
      skipped: false,
      error: result.error,
    };
  }
  return result.results[0];
}

/** 在番茄 Todo 正运行时用其原生 API 更新分类并请求重新上传。 */
export async function updateTomatodoSubjectThroughBridge(
  segmentId: string,
  subject: TomatodoSubject,
  options: TomatodoBridgeWriteOptions = {},
): Promise<TomatodoBridgeWriteResult> {
  const syncToPhone = options.syncToPhone === true;
  const marker = JSON.stringify(`[FocusLink:tomatodo:segment:${segmentId}]`);
  const subjectJson = JSON.stringify(subject);
  const expression = `
    (async function () {
      try {
        var api = window.electronAPI;
        if (!api || !api.getAllRecords || !api.updateRecord ||
            (${syncToPhone} && (!api.syncGetStatus || !api.syncRecord))) {
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
        if (!subjectChanged && Number(record.isSynced) === 1 && !${syncToPhone}) {
          return JSON.stringify({
            ok: true, recordFound: true, localWritten: true, localChanged: false,
            uploadConfirmed: true, phoneSyncConfirmed: true, skipped: true, recordId: record.id
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
          } else if (Number(record.createDate || 0) < Date.now() - 7 * 24 * 60 * 60 * 1000) {
            cloudError = 'tomatodo_record_outside_seven_day_window';
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
        var phoneSyncConfirmed = ${!syncToPhone};
        var phoneSyncError = null;
        if (${syncToPhone}) {
          try {
            var phoneStatus = await api.syncGetStatus();
            if (phoneStatus && Number(phoneStatus.connectedCount || 0) > 0) {
              var phoneAck = await api.syncRecord(
                Object.assign({}, record, { isSynced: 0 }),
                'FocusLink手机同步'
              );
              phoneSyncConfirmed = Boolean(phoneAck && phoneAck.success);
              if (!phoneSyncConfirmed) {
                phoneSyncError =
                  (phoneAck && (phoneAck.error || phoneAck.message || phoneAck.code)) ||
                  'tomatodo_phone_sync_not_confirmed';
              }
            } else {
              phoneSyncError = 'tomatodo_phone_not_connected';
            }
          } catch (error) {
            phoneSyncError = error && error.message ? error.message : String(error);
          }
        }
        return JSON.stringify({
          ok: true, recordFound: true, localWritten: true, localChanged: subjectChanged,
          uploadConfirmed: uploadConfirmed, phoneSyncConfirmed: phoneSyncConfirmed,
          phoneSyncError: phoneSyncError, skipped: !subjectChanged,
          recordId: record.id, cloudError: cloudError
        });
      } catch (error) {
        return JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) });
      }
    })()
  `;
  const requiredMethods = syncToPhone
    ? [...TOMATODO_CLOUD_IDENTITY_METHODS, ...TOMATODO_PHONE_IDENTITY_METHODS]
    : TOMATODO_CLOUD_IDENTITY_METHODS;
  const evaluated = await evaluateJson(expression, requiredMethods);
  const value = evaluated.value;
  return {
    available: evaluated.available,
    ok: Boolean(value?.ok),
    recordFound: Boolean(value?.recordFound),
    localWritten: Boolean(value?.localWritten),
    localChanged: Boolean(value?.localChanged),
    uploadConfirmed: Boolean(value?.uploadConfirmed),
    phoneSyncConfirmed: syncToPhone ? Boolean(value?.phoneSyncConfirmed) : true,
    phoneSyncError: value?.phoneSyncError,
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
