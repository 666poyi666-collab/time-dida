// 设置存储 - 使用 JsonStore 持久化设置（替代 electron-store v10 ESM）
// token 不存 localStorage；OAuth token 通过独立凭证存储（CredentialsStore）
import { JsonStore } from './jsonStore.js';
import { getSetting, setSetting, resetFailedSyncItems, getDb } from './db/index.js';
import { DEFAULT_SETTINGS } from '@shared/types';
import type { AppSettings } from '@shared/types';
import { getExpandedMiniWindowSize } from '@shared/miniWindowLayout';
import { logger } from './logger.js';

const store = new JsonStore<AppSettings>({
  name: 'focuslink-settings',
  defaults: DEFAULT_SETTINGS,
});

const SETTINGS_KEY = 'app_settings';
// v0.1.5 一次性迁移标记：强制关闭贴边自动收纳（UI 不稳定，交给 UI AI 重做）
const MIGRATION_V015_KEY = 'migration.v015.edgeAutoCollapseReset';
const MIGRATION_DIDA_APPEND_ID_KEY = 'migration.didaAppendRequiresId';
const MIGRATION_DIDA_APPEND_PROJECT_KEY = 'migration.didaAppendRequiresProject';
const MIGRATION_SYNC_MODE_V0211_KEY = 'migration.syncModeV0211';
const MIGRATION_RESET_FAILED_SYNC_KEY = 'migration.resetFailedSyncV0211';
const MIGRATION_RESET_FAILED_SYNC_V0212_KEY = 'migration.resetFailedSyncV0212';
const MIGRATION_FORCE_FOCUS_RECORD_V0212_KEY = 'migration.forceFocusRecordV0212';
const MIGRATION_RESET_FAILED_SYNC_V0213_KEY = 'migration.resetFailedSyncV0213';
const MIGRATION_RESET_FAILED_SYNC_V0214_KEY = 'migration.resetFailedSyncV0214';
const MIGRATION_RESET_FAILED_SYNC_V0215_KEY = 'migration.resetFailedSyncV0215';
const MIGRATION_RESET_FAILED_SYNC_V0216_KEY = 'migration.resetFailedSyncV0216';
const MIGRATION_RESYNC_FOCUS_RECORD_V0410_KEY = 'migration.resyncFocusRecordV0410';
const MIGRATION_FLAG_DONE = '1';

export function getSettings(): AppSettings {
  // 优先从 electron-store 读取，回退到 DB，再回退到默认
  let settings: AppSettings;
  try {
    const fromStore = store.store;
    if (fromStore && Object.keys(fromStore).length > 0) {
      settings = deepMerge(DEFAULT_SETTINGS, fromStore);
    } else {
      const fromDb = getSetting(SETTINGS_KEY);
      if (fromDb) {
        try {
          settings = deepMerge(DEFAULT_SETTINGS, JSON.parse(fromDb));
        } catch {
          settings = DEFAULT_SETTINGS;
        }
      } else {
        settings = DEFAULT_SETTINGS;
      }
    }
  } catch (err) {
    logger.warn('settings', 'electron-store read failed', err);
    settings = DEFAULT_SETTINGS;
  }

  // v0.1.5 一次性迁移：强制关闭贴边自动收纳（仅执行一次）
  applyV015EdgeCollapseMigration(settings);
  applyDidaAppendIdMigration(settings);
  applyDidaAppendProjectMigration(settings);
  applySyncModeV0211Migration(settings);
  applyResetFailedSyncMigration();
  applyResetFailedSyncV0212Migration();
  applyForceFocusRecordV0212Migration(settings);
  applyResetFailedSyncV0213Migration();
  applyResetFailedSyncV0214Migration();
  applyResetFailedSyncV0215Migration();
  applyResetFailedSyncV0216Migration();
  applyResyncFocusRecordV0410Migration();
  normalizeMiniWindowSize(settings);
  return settings;
}

/** v0.1.5 一次性迁移：把 edgeAutoCollapse 强制重置为 false。
 *  通过 app_settings 表中的标记位避免重复执行。 */
function applyV015EdgeCollapseMigration(settings: AppSettings): void {
  const flag = getSetting(MIGRATION_V015_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;
  if (settings.miniWindow.edgeAutoCollapse) {
    logger.info('settings', 'v015 migration: force-disable edgeAutoCollapse');
    settings.miniWindow.edgeAutoCollapse = false;
    store.store = settings;
    setSetting(SETTINGS_KEY, JSON.stringify(settings));
  }
  setSetting(MIGRATION_V015_KEY, MIGRATION_FLAG_DONE);
}

function normalizeMiniWindowSize(settings: AppSettings): void {
  const expanded = getExpandedMiniWindowSize(settings.miniWindow.width, settings.miniWindow.height);
  if (
    expanded.width === settings.miniWindow.width &&
    expanded.height === settings.miniWindow.height
  ) {
    return;
  }
  logger.info('settings', 'normalize mini window expanded size', expanded);
  settings.miniWindow.width = expanded.width;
  settings.miniWindow.height = expanded.height;
  store.store = settings;
  setSetting(SETTINGS_KEY, JSON.stringify(settings));
}

function applyDidaAppendIdMigration(settings: AppSettings): void {
  const flag = getSetting(MIGRATION_DIDA_APPEND_ID_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;

  const command = settings.ticktickCli.appendNoteCommand.trim();
  if (
    /^dida\s+task\s+update\s+\{\{taskId\}\}\s+--content\b/.test(command) ||
    /^dida\s+task\s+update\s+--id\s+\{\{taskId\}\}\s+--content\b/.test(command)
  ) {
    logger.info('settings', 'migration: dida append note command now requires --id');
    settings.ticktickCli.appendNoteCommand =
      'dida task update {{taskId}} --id {{taskId}} --content "{{content}}"';
    store.store = settings;
    setSetting(SETTINGS_KEY, JSON.stringify(settings));
  }
  setSetting(MIGRATION_DIDA_APPEND_ID_KEY, MIGRATION_FLAG_DONE);
}

function applyDidaAppendProjectMigration(settings: AppSettings): void {
  const flag = getSetting(MIGRATION_DIDA_APPEND_PROJECT_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;

  const command = settings.ticktickCli.appendNoteCommand.trim();
  if (
    /^dida\s+task\s+update\b/.test(command) &&
    command.includes('{{taskId}}') &&
    command.includes('--content') &&
    !command.includes('--project')
  ) {
    logger.info('settings', 'migration: dida append note command now requires --project');
    settings.ticktickCli.appendNoteCommand =
      'dida task update {{taskId}} --id {{taskId}} --project {{projectId}} --content "{{content}}"';
    store.store = settings;
    setSetting(SETTINGS_KEY, JSON.stringify(settings));
  }
  setSetting(MIGRATION_DIDA_APPEND_PROJECT_KEY, MIGRATION_FLAG_DONE);
}

function applySyncModeV0211Migration(settings: AppSettings): void {
  const flag = getSetting(MIGRATION_SYNC_MODE_V0211_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;

  const oldMode = settings.syncMode as string;
  if (oldMode === 'note') {
    logger.info('settings', 'v0211 migration: syncMode note -> comment');
    settings.syncMode = 'comment';
  } else if (oldMode === 'experimental-focus') {
    logger.info('settings', 'v0211 migration: syncMode experimental-focus -> focus-record');
    settings.syncMode = 'focus-record';
  }
  store.store = settings;
  setSetting(SETTINGS_KEY, JSON.stringify(settings));
  setSetting(MIGRATION_SYNC_MODE_V0211_KEY, MIGRATION_FLAG_DONE);
}

function applyResetFailedSyncMigration(): void {
  const flag = getSetting(MIGRATION_RESET_FAILED_SYNC_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;
  try {
    const count = resetFailedSyncItems();
    if (count > 0) {
      logger.info('settings', `v0211 migration: reset ${count} failed sync items to pending`);
    }
  } catch (err) {
    logger.warn('settings', 'failed to reset failed sync items', err instanceof Error ? err.message : String(err));
  }
  setSetting(MIGRATION_RESET_FAILED_SYNC_KEY, MIGRATION_FLAG_DONE);
}

function applyResetFailedSyncV0212Migration(): void {
  const flag = getSetting(MIGRATION_RESET_FAILED_SYNC_V0212_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;
  try {
    const count = resetFailedSyncItems();
    if (count > 0) {
      logger.info('settings', `v0212 migration: reset ${count} failed sync items to pending`);
    }
  } catch (err) {
    logger.warn('settings', 'failed to reset failed sync items', err instanceof Error ? err.message : String(err));
  }
  setSetting(MIGRATION_RESET_FAILED_SYNC_V0212_KEY, MIGRATION_FLAG_DONE);
}

/** v0.2.12 迁移：强制将 comment 模式切换为 focus-record
 *  comment 模式依赖 projectId，当任务已删除或 projectId 错误时必然失败。
 *  focus-record 模式更可靠，且任务不存在时仍可创建无关联专注记录。 */
function applyForceFocusRecordV0212Migration(settings: AppSettings): void {
  const flag = getSetting(MIGRATION_FORCE_FOCUS_RECORD_V0212_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;
  if (settings.syncMode === 'comment') {
    logger.info('settings', 'v0212 migration: force syncMode comment -> focus-record');
    settings.syncMode = 'focus-record';
    store.store = settings;
    setSetting(SETTINGS_KEY, JSON.stringify(settings));
  }
  setSetting(MIGRATION_FORCE_FOCUS_RECORD_V0212_KEY, MIGRATION_FLAG_DONE);
}

/** v0.2.13 迁移：重置失败的同步项，用修复后的逻辑重新同步 */
function applyResetFailedSyncV0213Migration(): void {
  const flag = getSetting(MIGRATION_RESET_FAILED_SYNC_V0213_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;
  try {
    const count = resetFailedSyncItems();
    if (count > 0) {
      logger.info('settings', `v0213 migration: reset ${count} failed sync items to pending`);
    }
  } catch (err) {
    logger.warn('settings', 'failed to reset failed sync items', err instanceof Error ? err.message : String(err));
  }
  setSetting(MIGRATION_RESET_FAILED_SYNC_V0213_KEY, MIGRATION_FLAG_DONE);
}

/** v0.2.14 迁移：重置所有 pending+failed 同步项
 *  v0.2.13 修复了启动时 runPending() 未调用的问题，此迁移确保积压项被处理 */
function applyResetFailedSyncV0214Migration(): void {
  const flag = getSetting(MIGRATION_RESET_FAILED_SYNC_V0214_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;
  try {
    const db = getDb();
    // 重置 failed 项
    const failedCount = resetFailedSyncItems();
    // 重置卡住的 pending 项（retryCount > 0 的）
    const stuckResult = db.prepare("UPDATE sync_queue SET status = 'pending', retry_count = 0, last_error = NULL WHERE status = 'pending' AND retry_count > 0").run();
    const stuckCount = stuckResult.changes;
    if (failedCount > 0 || stuckCount > 0) {
      logger.info('settings', `v0214 migration: reset ${failedCount} failed + ${stuckCount} stuck pending sync items`);
    }
  } catch (err) {
    logger.warn('settings', 'failed to reset sync items', err instanceof Error ? err.message : String(err));
  }
  setSetting(MIGRATION_RESET_FAILED_SYNC_V0214_KEY, MIGRATION_FLAG_DONE);
}

/** v0.2.15 迁移：重置所有 pending+failed 同步项
 *  v0.2.15 修复了 getTask/createFocusRecord 缓存回退导致已删除任务的 ID 仍被传给 focus create 的问题。
 *  此迁移确保之前因传过期 task-id 而失败的项被重试，以无关联专注记录方式创建。 */
function applyResetFailedSyncV0215Migration(): void {
  const flag = getSetting(MIGRATION_RESET_FAILED_SYNC_V0215_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;
  try {
    const db = getDb();
    const failedCount = resetFailedSyncItems();
    const stuckResult = db.prepare("UPDATE sync_queue SET status = 'pending', retry_count = 0, last_error = NULL WHERE status = 'pending' AND retry_count > 0").run();
    const stuckCount = stuckResult.changes;
    if (failedCount > 0 || stuckCount > 0) {
      logger.info('settings', `v0215 migration: reset ${failedCount} failed + ${stuckCount} stuck pending sync items`);
    }
  } catch (err) {
    logger.warn('settings', 'failed to reset sync items', err instanceof Error ? err.message : String(err));
  }
  setSetting(MIGRATION_RESET_FAILED_SYNC_V0215_KEY, MIGRATION_FLAG_DONE);
}

/** v0.2.16 迁移：重置所有 pending+failed 同步项
 *  v0.2.16 修复了任务识别问题：filter 找不到任务时用 task get 二次确认，
 *  避免实际存在的任务被误判为已删除而创建无关联专注记录。
 *  此迁移重置之前因误判而失败的同步项，让它们用修复后的逻辑重试。 */
function applyResetFailedSyncV0216Migration(): void {
  const flag = getSetting(MIGRATION_RESET_FAILED_SYNC_V0216_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;
  try {
    const db = getDb();
    const failedCount = resetFailedSyncItems();
    const stuckResult = db.prepare("UPDATE sync_queue SET status = 'pending', retry_count = 0, last_error = NULL WHERE status = 'pending' AND retry_count > 0").run();
    const stuckCount = stuckResult.changes;
    if (failedCount > 0 || stuckCount > 0) {
      logger.info('settings', `v0216 migration: reset ${failedCount} failed + ${stuckCount} stuck pending sync items`);
    }
  } catch (err) {
    logger.warn('settings', 'failed to reset sync items', err instanceof Error ? err.message : String(err));
  }
  setSetting(MIGRATION_RESET_FAILED_SYNC_V0216_KEY, MIGRATION_FLAG_DONE);
}

/** v0.4.10 迁移：重置所有已标记为 synced 的 segment-focus 同步项
 *  v0.4.10 修复了 syncFocusRecordToCloud 的核心 bug：focus-record 模式下
 *  当 taskSource=ticktick-cli 时，错误地调用 appendFocusRecordsToTask（写评论）
 *  而非 createFocusRecord（创建云端专注记录），导致专注记录从未真正上传到滴答云端。
 *  此迁移将所有 synced 的 segment-focus 项重置为 pending，让修复后的逻辑重新处理。
 *  createFocusRecord 内置去重（通过 marker 匹配已有专注记录），不会产生重复。 */
function applyResyncFocusRecordV0410Migration(): void {
  const flag = getSetting(MIGRATION_RESYNC_FOCUS_RECORD_V0410_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;
  try {
    const db = getDb();
    // 重置所有 synced 的 segment-focus 项为 pending
    const result = db
      .prepare(
        "UPDATE sync_queue SET status = 'pending', retry_count = 0, last_error = NULL WHERE status = 'synced' AND type = 'segment-focus'",
      )
      .run();
    const resetCount = result.changes;
    if (resetCount > 0) {
      logger.info(
        'settings',
        `v0410 migration: reset ${resetCount} synced segment-focus items to pending for re-sync via createFocusRecord`,
      );
    }
  } catch (err) {
    logger.warn(
      'settings',
      'failed to reset synced segment-focus items',
      err instanceof Error ? err.message : String(err),
    );
  }
  setSetting(MIGRATION_RESYNC_FOCUS_RECORD_V0410_KEY, MIGRATION_FLAG_DONE);
}

export function saveSettings(settings: AppSettings): AppSettings {
  store.store = settings;
  setSetting(SETTINGS_KEY, JSON.stringify(settings));
  logger.info('settings', 'saved', { theme: settings.theme, syncMode: settings.syncMode });
  return settings;
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const next = deepMerge(current, partial);
  return saveSettings(next);
}

export function setHotkey(key: keyof AppSettings['hotkeys'], accelerator: string): AppSettings {
  const current = getSettings();
  current.hotkeys[key] = accelerator;
  return saveSettings(current);
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  const result: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const key in override) {
    const ov = (override as any)[key];
    if (ov && typeof ov === 'object' && !Array.isArray(ov)) {
      result[key] = deepMerge(result[key] ?? {}, ov);
    } else if (ov !== undefined) {
      result[key] = ov;
    }
  }
  return result as T;
}
