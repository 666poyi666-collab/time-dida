import type { AppSettings, SettingsDomain } from './types';

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

/** Merge only defined fields while preserving every untouched settings branch. */
export function mergeSettings<T>(base: T, override: DeepPartial<T>): T {
  const result = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = result[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      result[key] = mergeSettings(current, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/** Map a settings update to the smallest side-effect domains that must react. */
export function detectSettingsChangedDomains(
  prev: AppSettings,
  next: AppSettings,
): SettingsDomain[] {
  const domains: SettingsDomain[] = [];
  if (
    prev.theme !== next.theme ||
    prev.accentColor !== next.accentColor ||
    prev.fontProfile !== next.fontProfile
  ) {
    domains.push('theme');
  }
  if (JSON.stringify(prev.hotkeys) !== JSON.stringify(next.hotkeys)) {
    domains.push('hotkeys');
  }
  if (JSON.stringify(prev.miniWindow) !== JSON.stringify(next.miniWindow)) {
    domains.push('miniWindow');
  }
  if (
    prev.taskSource !== next.taskSource ||
    JSON.stringify(prev.ticktickCli) !== JSON.stringify(next.ticktickCli)
  ) {
    domains.push('taskProvider');
  }
  if (JSON.stringify(prev.layout) !== JSON.stringify(next.layout)) {
    domains.push('layout');
  }
  if (JSON.stringify(prev.tomatodo) !== JSON.stringify(next.tomatodo)) {
    domains.push('tomatodo');
  }
  if (
    prev.segmentBehavior !== next.segmentBehavior ||
    prev.syncMode !== next.syncMode ||
    prev.experimentalFocusEnabled !== next.experimentalFocusEnabled ||
    prev.minimizeToTray !== next.minimizeToTray ||
    prev.autoStart !== next.autoStart ||
    prev.startMinimizedToTray !== next.startMinimizedToTray ||
    prev.closeToTray !== next.closeToTray ||
    prev.showMiniOnStart !== next.showMiniOnStart ||
    JSON.stringify(prev.ticktick) !== JSON.stringify(next.ticktick)
  ) {
    domains.push('general');
  }
  if (domains.length === 0) domains.push('general');
  return domains;
}

export type TickTickTaskProvider = 'dida-cli' | 'ticktick-oauth';

/**
 * Pick a provider for a previously linked cloud task without making a local-only UI choice
 * strand that task. An explicit cloud provider wins; local mode falls back to an available
 * configured provider, with dida CLI preferred by the product contract.
 */
export function resolveTickTickTaskProvider(
  taskSource: 'local' | 'ticktick-cli' | 'ticktick-oauth',
  availability: { cli: boolean; oauth: boolean },
): TickTickTaskProvider | null {
  if (taskSource === 'ticktick-cli') return availability.cli ? 'dida-cli' : null;
  if (taskSource === 'ticktick-oauth') return availability.oauth ? 'ticktick-oauth' : null;
  if (availability.cli) return 'dida-cli';
  if (availability.oauth) return 'ticktick-oauth';
  return null;
}
