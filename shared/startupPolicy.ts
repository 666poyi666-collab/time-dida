export const HIDDEN_START_ARG = '--hidden';
export const LEGACY_HIDDEN_START_ARGS = ['--start-minimized', '--minimized'] as const;

export function getLoginItemSettings(autoStart: boolean): {
  openAtLogin: boolean;
  args: string[];
} {
  return {
    openAtLogin: autoStart,
    args: autoStart ? [HIDDEN_START_ARG] : [],
  };
}

export function shouldStartHiddenToTray(
  startMinimizedToTray: boolean,
  argv: readonly string[],
): boolean {
  if (startMinimizedToTray) return true;
  return argv.some(
    (arg) =>
      arg === HIDDEN_START_ARG || (LEGACY_HIDDEN_START_ARGS as readonly string[]).includes(arg),
  );
}

export function shouldAutoSelectDidaTaskSource(input: {
  migrationDone: boolean;
  didaInstalled: boolean;
  taskSource: 'local' | 'ticktick-cli' | 'ticktick-oauth';
}): boolean {
  return !input.migrationDone && input.didaInstalled && input.taskSource === 'local';
}
