import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  formatClockDuration,
  liveStateLabel,
  projectLiveFocusDurations,
  type LiveFocusSnapshotLike,
} from './runtimeModel';

export type NativeFocusCommandType = 'pause' | 'resume' | 'finish';
export type NativeFocusCommandSource = 'notification' | 'quick-settings';

export const DEFAULT_NATIVE_PAUSE_REMINDER_DELAY_MINUTES = 3;
export const MIN_NATIVE_PAUSE_REMINDER_DELAY_MINUTES = 1;
export const MAX_NATIVE_PAUSE_REMINDER_DELAY_MINUTES = 240;

export interface NativeFocusCommand {
  id: string;
  type: NativeFocusCommandType;
  source: NativeFocusCommandSource;
  sessionId: string;
  stateRevision: number;
  issuedAtEpochMs: number;
}

interface NativeFocusDisplaySnapshot {
  state: LiveFocusSnapshotLike['state'];
  sessionId: string | null;
  stateRevision: number;
  title: string | null;
  timeLabel: string;
  detail?: string;
  primaryElapsedMs: number;
  primaryAdvances: boolean;
  controlsEnabled: boolean;
  validUntilEpochMs: number;
}

export interface NativeCloudPollStatus {
  attemptCount: number;
  lastAttemptAtEpochMs: number;
  lastSuccessAtEpochMs: number;
  lastRevision: number;
  lastError: string;
}

export interface NativePauseReminderPreference {
  enabled: boolean;
  delayMinutes: number;
}

export interface NativePictureInPictureAspectRatio {
  width: number;
  height: number;
}

export interface NativeImmersiveSystemBarsResult {
  enabled: boolean;
  supported: boolean;
}

export interface NativePictureInPictureResult {
  entered: boolean;
  supported: boolean;
  active: boolean;
}

export interface NativeSystemFocusSurface {
  selected?: 'xiaomi-island' | 'android-live-update' | 'ongoing-notification';
  xiaomiFocusProtocol?: number;
  xiaomiFocusPermission?: boolean;
  androidLiveUpdateSupported?: boolean;
  androidLiveUpdateAllowed?: boolean;
  standardNotificationAvailable?: boolean;
  overlayEnabled?: boolean;
  overlayPermissionGranted?: boolean;
}

export interface NativeFocusStatus {
  notificationPermission?: string;
  canPostNotification?: boolean;
  manufacturer?: string;
  batteryOptimizationExempt?: boolean;
  backgroundRestricted?: boolean;
  overlayPermissionGranted?: boolean;
  overlayEnabled?: boolean;
  systemSurface?: NativeSystemFocusSurface;
  pictureInPictureSupported?: boolean;
  pictureInPictureActive?: boolean;
  immersiveSystemBars?: boolean;
  nativeConnectionConfigured?: boolean;
  controlsAvailable?: boolean;
  pendingCommandCount?: number;
  cloudPoll?: NativeCloudPollStatus;
  snapshot?: NativeFocusDisplaySnapshot;
}

interface FocusRuntimePlugin {
  updateSnapshot(options: { snapshot: NativeFocusDisplaySnapshot }): Promise<void>;
  drainPendingCommands(): Promise<{ commands: NativeFocusCommand[] }>;
  completeCommands(options: { ids: string[] }): Promise<void>;
  getNativeStatus(): Promise<NativeFocusStatus>;
  requestNotificationPermission(): Promise<{
    notificationPermission?: string;
    canPostNotification?: boolean;
    settingsOpened?: boolean;
  }>;
  requestQuickSettingsTile(): Promise<{ status?: string; manualRequired?: boolean }>;
  configureConnection(options: {
    endpoint: string;
    accessToken: string;
    deviceId: string;
  }): Promise<void>;
  clearConnection(): Promise<void>;
  openBackgroundSettings(): Promise<{ opened?: boolean }>;
  openAutoStartSettings(): Promise<{ opened?: boolean }>;
  openOverlayPermissionSettings(): Promise<{ opened?: boolean; granted?: boolean }>;
  setOverlayEnabled(options: { enabled: boolean }): Promise<{
    enabled?: boolean;
    granted?: boolean;
  }>;
  setImmersiveSystemBars(options: { enabled: boolean }): Promise<NativeImmersiveSystemBarsResult>;
  enterPictureInPicture(options: {
    aspectRatio?: NativePictureInPictureAspectRatio;
  }): Promise<NativePictureInPictureResult>;
  getPauseReminderPreference(): Promise<NativePauseReminderPreference>;
  setPauseReminderPreference(options: {
    enabled: boolean;
    delayMinutes?: number;
  }): Promise<NativePauseReminderPreference>;
  addListener(
    eventName: 'nativeCommand',
    listener: (command: NativeFocusCommand) => void,
  ): Promise<PluginListenerHandle>;
}

const FocusRuntime = registerPlugin<FocusRuntimePlugin>('FocusRuntime');

export function isNativeFocusRuntimeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FocusRuntime');
}

export function normalizeNativePauseReminderDelayMinutes(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_NATIVE_PAUSE_REMINDER_DELAY_MINUTES;
  }
  return Math.min(
    MAX_NATIVE_PAUSE_REMINDER_DELAY_MINUTES,
    Math.max(MIN_NATIVE_PAUSE_REMINDER_DELAY_MINUTES, Math.round(value)),
  );
}

export function currentNativePictureInPictureAspectRatio():
  NativePictureInPictureAspectRatio | undefined {
  if (typeof window === 'undefined') return undefined;
  const width = Math.round(window.innerWidth);
  const height = Math.round(window.innerHeight);
  if (width < 1 || height < 1) return undefined;
  return { width, height };
}

export function nativeFocusCommandSuccessCopy(
  command: Pick<NativeFocusCommand, 'source' | 'type'>,
): string {
  const source = command.source === 'notification' ? '通知' : '快捷设置';
  if (command.type === 'pause') return `${source}动作已确认暂停`;
  if (command.type === 'resume') return `${source}动作已确认继续`;
  return `${source}动作已确认结束，正在收敛账本`;
}

export function makeNativeDisplaySnapshot(
  snapshot: LiveFocusSnapshotLike,
  controlsEnabled: boolean,
  now = Date.now(),
): NativeFocusDisplaySnapshot {
  const durations = projectLiveFocusDurations(snapshot, now);
  return {
    state: snapshot.state,
    sessionId: snapshot.sessionId,
    stateRevision: snapshot.revision,
    title: snapshot.title?.slice(0, 120) ?? null,
    timeLabel: formatClockDuration(durations.primaryElapsedMs),
    detail:
      snapshot.state === 'idle'
        ? '等待开始'
        : `${liveStateLabel(snapshot.state)} · 专注 ${formatClockDuration(durations.activeElapsedMs)} · 暂停 ${formatClockDuration(durations.pauseElapsedMs)}`,
    primaryElapsedMs: Math.floor(durations.primaryElapsedMs),
    primaryAdvances: snapshot.state !== 'idle',
    controlsEnabled,
    validUntilEpochMs: now + 30 * 60_000,
  };
}

export async function configureNativeFocusConnection(
  endpoint: string,
  accessToken: string,
  deviceId: string,
): Promise<void> {
  if (!isNativeFocusRuntimeAvailable()) return;
  await FocusRuntime.configureConnection({ endpoint, accessToken, deviceId });
}

export async function clearNativeFocusConnection(): Promise<void> {
  if (!isNativeFocusRuntimeAvailable()) return;
  await FocusRuntime.clearConnection();
}

export async function openNativeBackgroundSettings(): Promise<boolean> {
  if (!isNativeFocusRuntimeAvailable()) return false;
  return (await FocusRuntime.openBackgroundSettings()).opened === true;
}

export async function openNativeAutoStartSettings(): Promise<boolean> {
  if (!isNativeFocusRuntimeAvailable()) return false;
  return (await FocusRuntime.openAutoStartSettings()).opened === true;
}

export async function openNativeOverlayPermissionSettings(): Promise<{
  opened: boolean;
  granted: boolean;
}> {
  if (!isNativeFocusRuntimeAvailable()) return { opened: false, granted: false };
  const result = await FocusRuntime.openOverlayPermissionSettings();
  return { opened: result.opened === true, granted: result.granted === true };
}

export async function setNativeOverlayEnabled(enabled: boolean): Promise<{
  enabled: boolean;
  granted: boolean;
}> {
  if (!isNativeFocusRuntimeAvailable()) return { enabled: false, granted: false };
  const result = await FocusRuntime.setOverlayEnabled({ enabled });
  return { enabled: result.enabled === true, granted: result.granted === true };
}

export async function setNativeImmersiveSystemBars(
  enabled: boolean,
): Promise<NativeImmersiveSystemBarsResult> {
  if (!isNativeFocusRuntimeAvailable()) return { enabled: false, supported: false };
  return FocusRuntime.setImmersiveSystemBars({ enabled });
}

export async function enterNativePictureInPicture(
  aspectRatio = currentNativePictureInPictureAspectRatio(),
): Promise<NativePictureInPictureResult> {
  if (!isNativeFocusRuntimeAvailable()) {
    return { entered: false, supported: false, active: false };
  }
  return FocusRuntime.enterPictureInPicture(aspectRatio ? { aspectRatio } : {});
}

export async function readNativePauseReminderPreference(): Promise<NativePauseReminderPreference | null> {
  if (!isNativeFocusRuntimeAvailable()) return null;
  const preference = await FocusRuntime.getPauseReminderPreference();
  return {
    enabled: preference.enabled === true,
    delayMinutes: normalizeNativePauseReminderDelayMinutes(preference.delayMinutes),
  };
}

export async function setNativePauseReminderPreference(
  preference: Pick<NativePauseReminderPreference, 'enabled'> & { delayMinutes?: number },
): Promise<NativePauseReminderPreference | null> {
  if (!isNativeFocusRuntimeAvailable()) return null;
  const options: { enabled: boolean; delayMinutes?: number } = {
    enabled: preference.enabled,
  };
  if (preference.delayMinutes !== undefined) {
    options.delayMinutes = normalizeNativePauseReminderDelayMinutes(preference.delayMinutes);
  }
  const next = await FocusRuntime.setPauseReminderPreference(options);
  return {
    enabled: next.enabled === true,
    delayMinutes: normalizeNativePauseReminderDelayMinutes(next.delayMinutes),
  };
}

export async function updateNativeFocusSnapshot(
  snapshot: LiveFocusSnapshotLike,
  controlsEnabled: boolean,
  now = Date.now(),
): Promise<void> {
  if (!isNativeFocusRuntimeAvailable()) return;
  await FocusRuntime.updateSnapshot({
    snapshot: makeNativeDisplaySnapshot(snapshot, controlsEnabled, now),
  });
}

export async function drainNativeFocusCommands(): Promise<NativeFocusCommand[]> {
  if (!isNativeFocusRuntimeAvailable()) return [];
  return (await FocusRuntime.drainPendingCommands()).commands;
}

export async function completeNativeFocusCommands(ids: readonly string[]): Promise<void> {
  if (!isNativeFocusRuntimeAvailable() || ids.length === 0) return;
  await FocusRuntime.completeCommands({ ids: [...ids] });
}

export async function subscribeToNativeFocusCommands(
  listener: (command: NativeFocusCommand) => void,
): Promise<() => Promise<void>> {
  if (!isNativeFocusRuntimeAvailable()) return async () => undefined;
  const handle = await FocusRuntime.addListener('nativeCommand', listener);
  return async () => handle.remove();
}

export async function requestNativeNotificationPermission(): Promise<{
  granted: boolean;
  settingsOpened: boolean;
}> {
  if (!isNativeFocusRuntimeAvailable()) return { granted: false, settingsOpened: false };
  const result = await FocusRuntime.requestNotificationPermission();
  return {
    granted: result.canPostNotification === true,
    settingsOpened: result.settingsOpened === true,
  };
}

export async function requestNativeQuickSettingsTile(): Promise<{
  added: boolean;
  manualRequired: boolean;
}> {
  if (!isNativeFocusRuntimeAvailable()) return { added: false, manualRequired: false };
  const result = await FocusRuntime.requestQuickSettingsTile();
  return {
    added: result.status === 'added' || result.status === 'already-added',
    manualRequired: result.manualRequired === true,
  };
}

export async function readNativeFocusStatus(): Promise<NativeFocusStatus | null> {
  if (!isNativeFocusRuntimeAvailable()) return null;
  return FocusRuntime.getNativeStatus();
}
