// 设置存储 - 使用 JsonStore 持久化设置（替代 electron-store v10 ESM）
// token 不存 localStorage；OAuth token 通过独立凭证存储（CredentialsStore）
import { JsonStore } from './jsonStore.js';
import { getSetting, setSetting } from './db/index.js';
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
