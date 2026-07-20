import { useEffect, useState } from 'react';
import {
  isNativeFocusRuntimeAvailable,
  readNativeFocusStatus,
  requestNativeNotificationPermission,
  requestNativeQuickSettingsTile,
} from './nativeFocusRuntime';

export function NativeSystemControls() {
  const [available] = useState(() => isNativeFocusRuntimeAvailable());
  const [permission, setPermission] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'notification' | 'tile' | null>(null);

  useEffect(() => {
    if (!available) return;
    let active = true;
    void readNativeFocusStatus()
      .then((status) => {
        if (active) setPermission(status?.notificationPermission ?? null);
      })
      .catch(() => {
        // Native capability actions remain available for an explicit retry.
      });
    return () => {
      active = false;
    };
  }, [available]);

  if (!available) return null;

  const enableNotifications = async () => {
    setBusy('notification');
    setNotice(null);
    try {
      const result = await requestNativeNotificationPermission();
      setPermission(result.granted ? 'granted' : 'denied');
      setNotice(
        result.granted
          ? '通知控制已启用；活动会话可从通知暂停、继续或结束。'
          : result.settingsOpened
            ? '已打开系统通知设置；允许 FocusLink 通知后返回应用即可启用控制。'
            : '通知权限未开启，可稍后在系统设置中授权。',
      );
    } catch (error) {
      setNotice(`无法启用通知控制：${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const addQuickSettingsTile = async () => {
    setBusy('tile');
    setNotice(null);
    try {
      const result = await requestNativeQuickSettingsTile();
      setNotice(
        result.added
          ? '已请求添加 FocusLink 快捷设置按钮。'
          : result.manualRequired
            ? '请下拉系统快捷设置，点“编辑”，再把 FocusLink 拖入常用按钮。'
            : '系统没有确认添加；可在快捷设置的“编辑”中手动查找 FocusLink。',
      );
    } catch (error) {
      setNotice(`无法请求快捷设置按钮：${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="native-system-controls" aria-label="Android 系统控制">
      <div>
        <strong>Android 系统控制</strong>
        <small>
          {permission === 'granted' ? '通知权限已开启' : '由你主动启用，不会在启动时自动弹出权限'}
        </small>
      </div>
      <div className="native-system-actions">
        <button type="button" onClick={() => void enableNotifications()} disabled={busy !== null}>
          {busy === 'notification' ? '请求中…' : '启用通知控制'}
        </button>
        <button type="button" onClick={() => void addQuickSettingsTile()} disabled={busy !== null}>
          {busy === 'tile' ? '请求中…' : '添加到快捷设置'}
        </button>
      </div>
      {notice && (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      )}
    </section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
