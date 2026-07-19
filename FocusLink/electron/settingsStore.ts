// 设置存储 - 使用 JsonStore 持久化设置（替代 electron-store v10 ESM）
// token 不存 localStorage；OAuth token 通过独立凭证存储（CredentialsStore）
import { JsonStore } from './jsonStore.js';
import { getSetting, setSetting, resetFailedSyncItems, getDb } from './db/index.js';
import { DEFAULT_SETTINGS } from '@shared/types';
import type { AppSettings } from '@shared/types';
import { mergeSettings } from '@shared/settingsPolicy';
import { resolveFocusColor, resolveFontProfile, resolveTimerStyle } from '@shared/theme';
import { getExpandedMiniWindowSize } from '@shared/miniWindowLayout';
import { logger } from './logger.js';
import {
  migrateLegacyTomatodoRecords,
  resolveTomatodoDbPath,
} from './integrations/tomatodo/localDb.js';

const store = new JsonStore<AppSettings>({
  name: 'focuslink-settings',
  defaults: DEFAULT_SETTINGS,
});

const SETTINGS_KEY = 'app_settings';
// v0.1.5 一次性迁移标记：强制关闭贴边自动收纳（UI 不稳定，交给 UI AI 重做）
const MIGRATION_V015_KEY = 'migration.v015.edgeAutoCollapseReset';
const MIGRATION_EDGE_DOCK_V080_KEY = 'migration.v080.edgeDockRestored';
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
const MIGRATION_TOMATODO_CLOUD_V053_KEY = 'migration.tomatodoCloudV053';
const MIGRATION_RECONCILE_DIDA_FOCUS_V060_KEY = 'migration.reconcileDidaFocusV060';
const MIGRATION_FLAG_DONE = '1';
let tomatodoCloudMigrationAttemptedThisRun = false;

export function getSettings(): AppSettings {
  // 优先从 electron-store 读取，回退到 DB，再回退到默认
  let settings: AppSettings;
  try {
    const fromStore = store.store;
    if (fromStore && Object.keys(fromStore).length > 0) {
      settings = mergeSettings(DEFAULT_SETTINGS, fromStore);
    } else {
      const fromDb = getSetting(SETTINGS_KEY);
      if (fromDb) {
        try {
          settings = mergeSettings(DEFAULT_SETTINGS, JSON.parse(fromDb));
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
  applyEdgeDockV080Migration(settings);
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
  applyTomatodoCloudV053Migration(settings);
  applyReconcileDidaFocusV060Migration();
  normalizeSegmentBehavior(settings);
  normalizeAppearanceSettings(settings);
  normalizeMiniWindowSize(settings);
  return settings;
}

/** 视觉设置迁移：收敛旧字体、旧专注色和旧计时字形，避免设置页出现无选中状态。 */
function normalizeAppearanceSettings(settings: AppSettings): void {
  const timerStyle = resolveTimerStyle(settings.timerStyle);
  const fontProfile = resolveFontProfile(settings.fontProfile);
  const focusColor = resolveFocusColor(settings.focusColor);
  if (
    timerStyle === settings.timerStyle &&
    fontProfile === settings.fontProfile &&
    focusColor === settings.focusColor
  ) {
    return;
  }
  logger.info('settings', 'normalize appearance settings', {
    timerStyle: `${String(settings.timerStyle)} -> ${timerStyle}`,
    fontProfile: `${String(settings.fontProfile)} -> ${fontProfile}`,
    focusColor: `${String(settings.focusColor)} -> ${focusColor}`,
  });
  settings.timerStyle = timerStyle;
  settings.fontProfile = fontProfile;
  settings.focusColor = focusColor;
  store.store = settings;
  setSetting(SETTINGS_KEY, JSON.stringify(settings));
}

/** 暂停后继续固定创建新片段；清理旧版仍保存的无效“继续原片段”选项。 */
function normalizeSegmentBehavior(settings: AppSettings): void {
  if (settings.segmentBehavior === 'new-segment') return;
  settings.segmentBehavior = 'new-segment';
  store.store = settings;
  setSetting(SETTINGS_KEY, JSON.stringify(settings));
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

/** v0.8.0 重写后的贴边逻辑有进入/离开双阈值与原生尺寸变更保护，可安全恢复。 */
function applyEdgeDockV080Migration(settings: AppSettings): void {
  const flag = getSetting(MIGRATION_EDGE_DOCK_V080_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;
  settings.miniWindow.edgeAutoCollapse = true;
  settings.miniWindow.edgeCollapseDelayMs = 260;
  settings.miniWindow.hoverToExpand = false;
  store.store = settings;
  setSetting(SETTINGS_KEY, JSON.stringify(settings));
  setSetting(MIGRATION_EDGE_DOCK_V080_KEY, MIGRATION_FLAG_DONE);
  logger.info('settings', 'v080 migration: enable stable mini edge docking');
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
    logger.warn(
      'settings',
      'failed to reset failed sync items',
      err instanceof Error ? err.message : String(err),
    );
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
    logger.warn(
      'settings',
      'failed to reset failed sync items',
      err instanceof Error ? err.message : String(err),
    );
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
    logger.warn(
      'settings',
      'failed to reset failed sync items',
      err instanceof Error ? err.message : String(err),
    );
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
    const stuckResult = db
      .prepare(
        "UPDATE sync_queue SET status = 'pending', retry_count = 0, last_error = NULL WHERE status = 'pending' AND retry_count > 0",
      )
      .run();
    const stuckCount = stuckResult.changes;
    if (failedCount > 0 || stuckCount > 0) {
      logger.info(
        'settings',
        `v0214 migration: reset ${failedCount} failed + ${stuckCount} stuck pending sync items`,
      );
    }
  } catch (err) {
    logger.warn(
      'settings',
      'failed to reset sync items',
      err instanceof Error ? err.message : String(err),
    );
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
    const stuckResult = db
      .prepare(
        "UPDATE sync_queue SET status = 'pending', retry_count = 0, last_error = NULL WHERE status = 'pending' AND retry_count > 0",
      )
      .run();
    const stuckCount = stuckResult.changes;
    if (failedCount > 0 || stuckCount > 0) {
      logger.info(
        'settings',
        `v0215 migration: reset ${failedCount} failed + ${stuckCount} stuck pending sync items`,
      );
    }
  } catch (err) {
    logger.warn(
      'settings',
      'failed to reset sync items',
      err instanceof Error ? err.message : String(err),
    );
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
    const stuckResult = db
      .prepare(
        "UPDATE sync_queue SET status = 'pending', retry_count = 0, last_error = NULL WHERE status = 'pending' AND retry_count > 0",
      )
      .run();
    const stuckCount = stuckResult.changes;
    if (failedCount > 0 || stuckCount > 0) {
      logger.info(
        'settings',
        `v0216 migration: reset ${failedCount} failed + ${stuckCount} stuck pending sync items`,
      );
    }
  } catch (err) {
    logger.warn(
      'settings',
      'failed to reset sync items',
      err instanceof Error ? err.message : String(err),
    );
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

/**
 * v0.5.3：把旧兜底“杂”迁移为“学习”，并将旧版误标为已上云的 FocusLink
 * PCRecord 恢复为待同步。外部库只处理带 FocusLink marker 的记录。
 */
function applyTomatodoCloudV053Migration(settings: AppSettings): void {
  const flag = getSetting(MIGRATION_TOMATODO_CLOUD_V053_KEY);
  if (flag === MIGRATION_FLAG_DONE) return;

  if ((settings.tomatodo.defaultSubject as string) === '杂') {
    settings.tomatodo.defaultSubject = '学习';
    store.store = settings;
    setSetting(SETTINGS_KEY, JSON.stringify(settings));
  }

  // TomaToDo 正在运行或文件暂时不可用时，把迁移留到下次 FocusLink 启动。
  // getSettings 是高频路径，同一进程内不能反复探测进程和外部文件。
  if (tomatodoCloudMigrationAttemptedThisRun) return;
  tomatodoCloudMigrationAttemptedThisRun = true;

  try {
    const dbPath = resolveTomatodoDbPath(settings.tomatodo.dbPath);
    const result = migrateLegacyTomatodoRecords(dbPath);
    if (!result.ok) {
      logger.warn('settings', 'tomatodo v0.5.3 migration deferred', { error: result.error });
      return;
    }
    logger.info('settings', 'tomatodo v0.5.3 migration complete', {
      resetRecords: result.updatedCount,
    });
    setSetting(MIGRATION_TOMATODO_CLOUD_V053_KEY, MIGRATION_FLAG_DONE);
  } catch (error) {
    logger.warn('settings', 'tomatodo v0.5.3 migration deferred', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * v0.6.0 修正了 dida 云专注的时间语义：end-start 必须等于有效专注时长，暂停只写入
 * note，不再同时传给 --pause-duration。旧版本已经标为 synced 的队列项也必须重新经过
 * marker + duration 对账，否则它们永远不会触发 createFocusRecord 的安全重建逻辑。
 *
 * 这里只重开 FocusLink 自己的 segment-focus 队列项；createFocusRecord 会保留正确记录、
 * 收敛重复 marker，并只重建能够确认时长错误的记录，因此不会盲目删除用户数据。
 */
function applyReconcileDidaFocusV060Migration(): void {
  if (getSetting(MIGRATION_RECONCILE_DIDA_FOCUS_V060_KEY) === MIGRATION_FLAG_DONE) return;
  try {
    const result = getDb()
      .prepare(
        "UPDATE sync_queue SET status = 'pending', retry_count = 0, last_error = NULL, updated_at = ? WHERE status = 'synced' AND type = 'segment-focus'",
      )
      .run(Date.now());
    logger.info('settings', 'v0.6.0 dida focus reconciliation queued', {
      resetItems: result.changes,
    });
    // Only persist the flag after the transaction succeeds. A temporarily unavailable database
    // must leave the migration retryable on the next settings read/startup.
    setSetting(MIGRATION_RECONCILE_DIDA_FOCUS_V060_KEY, MIGRATION_FLAG_DONE);
  } catch (error) {
    logger.warn('settings', 'v0.6.0 dida focus reconciliation deferred', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  store.store = settings;
  setSetting(SETTINGS_KEY, JSON.stringify(settings));
  logger.info('settings', 'saved', { theme: settings.theme, syncMode: settings.syncMode });
  return settings;
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const next = mergeSettings(current, partial);
  return saveSettings(next);
}

export function setHotkey(key: keyof AppSettings['hotkeys'], accelerator: string): AppSettings {
  const current = getSettings();
  current.hotkeys[key] = accelerator;
  return saveSettings(current);
}
