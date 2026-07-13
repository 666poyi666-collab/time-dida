// 全局快捷键管理
// 注册失败要提示用户；冲突时不能崩溃；修改后重新注册
// debounce 200ms 防止连按；触发时记录 before/after 状态日志
import { globalShortcut, BrowserWindow } from 'electron';
import type { AppSettings } from '@shared/types';
import { logger } from './logger.js';

export type HotkeyAction =
  'toggleTimer' | 'stopTimer' | 'toggleWindow' | 'linkTask' | 'toggleMiniWindow';

export interface HotkeyHandlers {
  toggleTimer: () => void;
  stopTimer: () => void;
  toggleWindow: () => void;
  linkTask: () => void;
  toggleMiniWindow: () => void;
}

export interface RegistrationResult {
  key: HotkeyAction;
  accelerator: string;
  success: boolean;
  error?: string;
}

export interface HotkeyRegistrationStatus {
  registered: Record<string, { action: HotkeyAction; accelerator: string }>;
  failed: RegistrationResult[];
}

let registered: Map<string, HotkeyAction> = new Map();
let lastResults: RegistrationResult[] = [];
let handlers: HotkeyHandlers | null = null;
// debounce：每个 action 上次触发时间，200ms 内重复触发忽略
const lastTriggeredAt: Map<HotkeyAction, number> = new Map();
const DEBOUNCE_MS = 200;

export function setHotkeyHandlers(h: HotkeyHandlers): void {
  handlers = h;
}

/** 注册单个快捷键，返回是否成功 */
function registerOne(accelerator: string, action: HotkeyAction): boolean {
  if (!accelerator || accelerator.trim() === '') return false;
  // 先尝试注销同名，并同步清理内部注册表
  globalShortcut.unregister(accelerator);
  registered.delete(accelerator);
  const ok = globalShortcut.register(accelerator, () => {
    onHotkeyTriggered(accelerator, action);
  });
  if (ok) {
    registered.set(accelerator, action);
    logger.info('hotkey', `registered: ${accelerator} -> ${action}`);
  } else {
    logger.warn('hotkey', `register FAILED (likely conflict): ${accelerator} -> ${action}`);
  }
  return ok;
}

/** 快捷键触发：debounce + 状态日志 */
function onHotkeyTriggered(accelerator: string, action: HotkeyAction): void {
  const now = Date.now();
  const lastAt = lastTriggeredAt.get(action) ?? 0;
  if (now - lastAt < DEBOUNCE_MS) {
    logger.info('hotkey', `debounced (within ${DEBOUNCE_MS}ms): ${accelerator} -> ${action}`);
    return;
  }
  lastTriggeredAt.set(action, now);

  // 记录 before 状态（通过 handler 外部提供的 stateGetter）
  const beforeState = stateGetter?.() ?? 'unknown';
  logger.info('hotkey', `trigger pressed`, {
    accelerator,
    action,
    beforeState,
    at: new Date(now).toISOString(),
  });

  try {
    handlers?.[action]();
    const afterState = stateGetter?.() ?? 'unknown';
    logger.info('hotkey', `trigger handled`, {
      accelerator,
      action,
      beforeState,
      afterState,
      success: true,
    });
  } catch (err) {
    logger.error('hotkey', `handler error for ${action}`, {
      accelerator,
      beforeState,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 状态查询回调 - 由 main.ts 注入，用于日志记录 before/after 状态 */
let stateGetter: (() => string) | null = null;
export function setStateGetter(fn: () => string): void {
  stateGetter = fn;
}

/** 按设置注册全部快捷键，返回每个快捷键的注册结果 */
export function registerAllHotkeys(settings: AppSettings): RegistrationResult[] {
  unregisterAll();
  const results: RegistrationResult[] = [];

  const entries: [HotkeyAction, string][] = [
    ['toggleTimer', settings.hotkeys.toggleTimer],
    ['stopTimer', settings.hotkeys.stopTimer],
    ['toggleWindow', settings.hotkeys.toggleWindow],
    ['linkTask', settings.hotkeys.linkTask],
    ['toggleMiniWindow', settings.hotkeys.toggleMiniWindow],
  ];

  for (const [action, accel] of entries) {
    const success = registerOne(accel, action);
    results.push({
      key: action,
      accelerator: accel,
      success,
      error: success ? undefined : '快捷键注册失败，可能与其他软件冲突',
    });
  }
  lastResults = results;
  return results;
}

/** 注册单个快捷键并返回结果（用于测试/修改单个快捷键） */
export function registerSingle(action: HotkeyAction, accelerator: string): RegistrationResult {
  if (!isValidAccelerator(accelerator)) {
    const result: RegistrationResult = {
      key: action,
      accelerator,
      success: false,
      error: '快捷键格式无效，请至少包含一个修饰键和一个按键',
    };
    lastResults = lastResults.filter((r) => r.key !== action);
    lastResults.push(result);
    return result;
  }

  const previous = Array.from(registered.entries()).filter(([, act]) => act === action);
  const conflictingAction = registered.get(accelerator);
  if (conflictingAction && conflictingAction !== action) {
    const result: RegistrationResult = {
      key: action,
      accelerator,
      success: false,
      error: '该快捷键已分配给 ' + conflictingAction,
    };
    lastResults = lastResults.filter((r) => r.key !== action);
    lastResults.push(result);
    return result;
  }

  for (const [accel] of previous) {
    globalShortcut.unregister(accel);
    registered.delete(accel);
  }

  const success = registerOne(accelerator, action);
  if (!success) {
    for (const [oldAccel, oldAction] of previous) {
      registerOne(oldAccel, oldAction);
    }
  }

  const result: RegistrationResult = {
    key: action,
    accelerator,
    success,
    error: success ? undefined : '快捷键注册失败，可能与系统或其他软件冲突；已恢复旧快捷键',
  };
  lastResults = lastResults.filter((r) => r.key !== action);
  lastResults.push(result);
  return result;
}
export function getRegistrationStatus(): HotkeyRegistrationStatus {
  const reg: Record<string, { action: HotkeyAction; accelerator: string }> = {};
  for (const [accel, action] of registered.entries()) {
    reg[action] = { action, accelerator: accel };
  }
  return {
    registered: reg,
    failed: lastResults.filter((r) => !r.success),
  };
}

export function unregisterAll(): void {
  for (const accel of registered.keys()) {
    globalShortcut.unregister(accel);
  }
  registered = new Map();
  logger.info('hotkey', 'all unregistered');
}

/** 验证快捷键格式是否合法（Electron accelerator） */
export function isValidAccelerator(accel: string): boolean {
  if (!accel) return false;
  const parts = accel.split('+');
  if (parts.length < 2) return false;
  return true;
}

/** 测试快捷键能否注册（不真正绑定 handler，注册后立即注销） */
export function testAccelerator(accelerator: string): boolean {
  if (!accelerator || !isValidAccelerator(accelerator)) return false;
  if (registered.has(accelerator)) {
    logger.info(
      'hotkey',
      'test accelerator ' + accelerator + ': OK (already registered by FocusLink)',
    );
    return true;
  }
  const ok = globalShortcut.register(accelerator, () => {});
  if (ok) {
    globalShortcut.unregister(accelerator);
  }
  logger.info('hotkey', 'test accelerator ' + accelerator + ': ' + (ok ? 'OK' : 'FAIL'));
  return ok;
}
/** 广播注册结果给所有窗口 */
export function broadcastResults(windows: BrowserWindow[], results: RegistrationResult[]): void {
  for (const win of windows) {
    if (!win.isDestroyed()) {
      for (const r of results) {
        win.webContents.send('hotkey:registered', {
          key: r.key,
          accelerator: r.accelerator,
          success: r.success,
          error: r.error,
        });
      }
    }
  }
}
