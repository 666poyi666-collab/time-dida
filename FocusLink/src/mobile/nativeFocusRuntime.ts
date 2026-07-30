import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  fingerprintDeviceSyncValue,
  type DeviceSyncSessionBundle,
} from '@shared/sync/deviceProtocol';
import { splitBundleForSyncV2, type SyncV2Mutation } from '@shared/sync/v2Protocol';
import { isAllowedFocusLinkSyncEndpoint } from '@shared/sync/identityProtocol';
import type { CachedBundle } from './cache';
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
  localAuthority: boolean;
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
  xiaomiEvidenceLevel?:
    'unsupported' | 'protocol-selected' | 'systemui-accepted' | 'visually-verified';
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

export interface NativeFocusConnection {
  endpoint: string;
  accessToken: string;
  deviceId: string;
}

export interface NativeAuthorityHistoryTask {
  taskId: string;
  source: 'local' | 'ticktick';
  title: string | null;
}

export interface NativeAuthorityHistoryRecord {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  status: 'finished' | 'aborted';
  activeMs: number;
  pausedMs: number;
  wallMs: number;
  title: string | null;
  task: NativeAuthorityHistoryTask | null;
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
  getConnection(): Promise<{
    configured: boolean;
    endpoint?: string;
    accessToken?: string;
    deviceId?: string;
  }>;
  enqueueCompletedLedgerBundle(options: {
    record: NativeCompletedLedgerRecord;
  }): Promise<{ queued?: boolean; pending?: number }>;
  updateAuthorityProjectionHistory(options: {
    history: NativeAuthorityHistoryRecord[];
    lastVerifiedAt: number;
    lastAttemptAt: number;
    pendingCount: number;
    lastErrorCode: string;
  }): Promise<{ accepted?: number; pending?: number }>;
  openBackgroundSettings(): Promise<{ opened?: boolean }>;
  openAutoStartSettings(): Promise<{ opened?: boolean }>;
  openOverlayPermissionSettings(): Promise<{ opened?: boolean; granted?: boolean }>;
  openExternalUrl(options: { url: string }): Promise<{ opened?: boolean }>;
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

interface NativeCompletedLedgerRecord {
  schemaVersion: 1;
  bundleId: string;
  deviceId: string;
  mutations: Array<
    Pick<
      SyncV2Mutation,
      'opId' | 'entityType' | 'entityId' | 'kind' | 'baseRevision' | 'baseFingerprint' | 'payload'
    >
  >;
}

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
  localAuthority = false,
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
    localAuthority,
    validUntilEpochMs: now + 30 * 60_000,
  };
}

export async function configureNativeFocusConnection(
  endpoint: string,
  accessToken: string,
  deviceId: string,
): Promise<void> {
  if (!isNativeFocusRuntimeAvailable()) return;
  if (!isAllowedFocusLinkSyncEndpoint(endpoint, accessToken.trim())) {
    throw new Error('设备凭据只能连接 FocusLink 官方同步服务');
  }
  await FocusRuntime.configureConnection({ endpoint, accessToken, deviceId });
}

export async function clearNativeFocusConnection(): Promise<void> {
  if (!isNativeFocusRuntimeAvailable()) return;
  await FocusRuntime.clearConnection();
}

/**
 * Durably mirrors a newly completed offline bundle into Android app-private
 * storage before IndexedDB removes the active draft. The native worker reuses
 * the same Keystore credential and intentionally owns no sync cursor.
 */
export async function enqueueNativeCompletedLedgerBundle(
  bundle: DeviceSyncSessionBundle,
  deviceId: string,
): Promise<boolean> {
  if (!isNativeFocusRuntimeAvailable()) return false;
  const split = splitBundleForSyncV2(bundle, deviceId);
  const entities = [
    { entityType: 'focus_ledger_v2' as const, entityId: bundle.session.id, payload: split.ledger },
    {
      entityType: 'focus_metadata_v2' as const,
      entityId: bundle.session.id,
      payload: split.metadata,
    },
  ];
  const mutations = entities.map((entity) => ({
    ...entity,
    opId: `v2-${fingerprintDeviceSyncValue({ entity, baseRevision: 0, deviceId })}`,
    kind: 'put' as const,
    baseRevision: 0,
    baseFingerprint: null,
  }));
  const result = await FocusRuntime.enqueueCompletedLedgerBundle({
    record: {
      schemaVersion: 1,
      bundleId: bundle.session.id,
      deviceId,
      mutations,
    },
  });
  return result.queued === true;
}

/**
 * Builds the exact, credential-free V1 history consumed by 不做手机控.
 * Invalid or arithmetically inconsistent legacy rows are omitted fail-closed.
 */
export function buildNativeAuthorityHistory(
  records: readonly CachedBundle[],
): NativeAuthorityHistoryRecord[] {
  const result: NativeAuthorityHistoryRecord[] = [];
  const seen = new Set<string>();
  const sorted = [...records].sort(
    (left, right) =>
      right.bundle.session.startedAt - left.bundle.session.startedAt ||
      left.bundle.session.id.localeCompare(right.bundle.session.id),
  );
  for (const cached of sorted) {
    if (result.length >= 500) break;
    const { session, segments } = cached.bundle;
    if (
      seen.has(session.id) ||
      !session.id ||
      session.id.length > 200 ||
      (session.status !== 'finished' && session.status !== 'aborted') ||
      !isSafeNonNegativeInteger(session.startedAt) ||
      !isSafeNonNegativeInteger(session.endedAt) ||
      !isSafeNonNegativeInteger(session.activeElapsedMs) ||
      !isSafeNonNegativeInteger(session.pauseElapsedMs) ||
      !isSafeNonNegativeInteger(session.wallElapsedMs) ||
      session.endedAt <= session.startedAt ||
      session.activeElapsedMs > Number.MAX_SAFE_INTEGER - session.pauseElapsedMs ||
      session.activeElapsedMs + session.pauseElapsedMs !== session.wallElapsedMs ||
      session.endedAt - session.startedAt !== session.wallElapsedMs
    ) {
      continue;
    }
    const task = projectionTask(session, segments);
    seen.add(session.id);
    result.push({
      sessionId: session.id,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      status: session.status,
      activeMs: session.activeElapsedMs,
      pausedMs: session.pauseElapsedMs,
      wallMs: session.wallElapsedMs,
      title: projectionTitle(session.title),
      task,
    });
  }
  return result;
}

export async function updateNativeAuthorityProjectionHistory(input: {
  records: readonly CachedBundle[];
  lastVerifiedAt: number | null;
  lastAttemptAt: number;
  pendingCount: number;
  lastErrorCode?: string;
}): Promise<boolean> {
  if (!isNativeFocusRuntimeAvailable()) return false;
  const history = buildNativeAuthorityHistory(input.records);
  const result = await FocusRuntime.updateAuthorityProjectionHistory({
    history,
    lastVerifiedAt: safeProjectionTimestamp(input.lastVerifiedAt ?? 0),
    lastAttemptAt: safeProjectionTimestamp(input.lastAttemptAt),
    pendingCount: Math.max(0, Math.floor(input.pendingCount)),
    lastErrorCode: input.lastErrorCode ?? '',
  });
  return result.accepted === history.length;
}

/**
 * Restores the Keystore-protected credential into renderer memory only.  The
 * caller must never write accessToken to Web Storage or IndexedDB.
 */
export async function readNativeFocusConnection(): Promise<NativeFocusConnection | null> {
  if (!isNativeFocusRuntimeAvailable()) return null;
  const value = await FocusRuntime.getConnection();
  if (
    value.configured !== true ||
    typeof value.endpoint !== 'string' ||
    typeof value.accessToken !== 'string' ||
    typeof value.deviceId !== 'string' ||
    !value.endpoint ||
    !value.accessToken ||
    !value.deviceId
  ) {
    return null;
  }
  return {
    endpoint: value.endpoint,
    accessToken: value.accessToken,
    deviceId: value.deviceId,
  };
}

function projectionTask(
  session: DeviceSyncSessionBundle['session'],
  segments: DeviceSyncSessionBundle['segments'],
): NativeAuthorityHistoryTask | null {
  if (isProjectionId(session.defaultTaskId) && isProjectionTaskSource(session.defaultTaskSource)) {
    return {
      taskId: session.defaultTaskId,
      source: session.defaultTaskSource,
      title: projectionTitle(session.defaultTaskTitle),
    };
  }
  const linked = [...segments]
    .sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id))
    .find(
      (segment) => isProjectionId(segment.taskId) && isProjectionTaskSource(segment.taskSource),
    );
  if (!linked || !isProjectionId(linked.taskId) || !isProjectionTaskSource(linked.taskSource)) {
    return null;
  }
  return {
    taskId: linked.taskId,
    source: linked.taskSource,
    title: projectionTitle(linked.title),
  };
}

function projectionTitle(value: string | null): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.slice(0, 240);
}

function isProjectionId(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function isProjectionTaskSource(value: unknown): value is 'local' | 'ticktick' {
  return value === 'local' || value === 'ticktick';
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function safeProjectionTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('authority projection timestamp must be a safe integer');
  }
  return value;
}

/**
 * Restores the existing Keystore credential or atomically migrates a legacy
 * renderer credential. The caller may purge Web Storage only after this
 * promise resolves with a connection.
 */
export async function restoreOrMigrateNativeFocusConnection(
  legacyConnection: NativeFocusConnection | null,
): Promise<NativeFocusConnection | null> {
  if (!isNativeFocusRuntimeAvailable()) return null;
  const stored = await readNativeFocusConnection();
  if (stored) return stored;
  if (!legacyConnection?.endpoint || !legacyConnection.accessToken || !legacyConnection.deviceId) {
    return null;
  }
  await configureNativeFocusConnection(
    legacyConnection.endpoint,
    legacyConnection.accessToken,
    legacyConnection.deviceId,
  );
  return legacyConnection;
}

export async function openNativeBackgroundSettings(): Promise<boolean> {
  if (!isNativeFocusRuntimeAvailable()) return false;
  return (await FocusRuntime.openBackgroundSettings()).opened === true;
}

export async function openNativeAutoStartSettings(): Promise<boolean> {
  if (!isNativeFocusRuntimeAvailable()) return false;
  return (await FocusRuntime.openAutoStartSettings()).opened === true;
}

export async function openNativeExternalUrl(url: string): Promise<boolean> {
  if (!isNativeFocusRuntimeAvailable()) return false;
  return (await FocusRuntime.openExternalUrl({ url })).opened === true;
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
  localAuthority = false,
): Promise<void> {
  if (!isNativeFocusRuntimeAvailable()) return;
  await FocusRuntime.updateSnapshot({
    snapshot: makeNativeDisplaySnapshot(snapshot, controlsEnabled, now, localAuthority),
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
