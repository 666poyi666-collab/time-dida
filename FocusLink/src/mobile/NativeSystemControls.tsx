import { useCallback, useEffect, useState } from 'react';
import {
  isNativeFocusRuntimeAvailable,
  openNativeAutoStartSettings,
  openNativeBackgroundSettings,
  readNativeFocusStatus,
  requestNativeNotificationPermission,
  requestNativeQuickSettingsTile,
  type NativeFocusStatus,
} from './nativeFocusRuntime';

export function NativeSystemControls() {
  const [available] = useState(() => isNativeFocusRuntimeAvailable());
  const [status, setStatus] = useState<NativeFocusStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'notification' | 'tile' | 'background' | 'autostart' | null>(
    null,
  );

  const refreshStatus = useCallback(async () => {
    const next = await readNativeFocusStatus();
    setStatus(next);
  }, []);

  useEffect(() => {
    if (!available) return;
    let active = true;
    const read = () => {
      void readNativeFocusStatus()
        .then((next) => {
          if (active) setStatus(next);
        })
        .catch(() => {
          // Native capability actions remain available for an explicit retry.
        });
    };
    const readWhenVisible = () => {
      if (document.visibilityState === 'visible') read();
    };
    read();
    const interval = window.setInterval(readWhenVisible, 15_000);
    document.addEventListener('visibilitychange', readWhenVisible);
    window.addEventListener('focus', readWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', readWhenVisible);
      window.removeEventListener('focus', readWhenVisible);
    };
  }, [available]);

  if (!available) return null;

  const permission = status?.notificationPermission ?? null;
  const poll = status?.cloudPoll;
  const activeSnapshot =
    status?.snapshot?.state === 'running' || status?.snapshot?.state === 'paused';
  const pollHealthy =
    !activeSnapshot ||
    (poll?.lastSuccessAtEpochMs != null && Date.now() - poll.lastSuccessAtEpochMs < 70_000);

  const enableNotifications = async () => {
    setBusy('notification');
    setNotice(null);
    try {
      const result = await requestNativeNotificationPermission();
      setNotice(
        result.granted
          ? '通知控制已启用；活动会话可从通知暂停、继续或结束。'
          : result.settingsOpened
            ? '已打开系统通知设置；允许 FocusLink 通知后返回应用即可启用控制。'
            : '通知权限未开启，可稍后在系统设置中授权。',
      );
      await refreshStatus();
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

  const openBackgroundSettings = async () => {
    setBusy('background');
    setNotice(null);
    try {
      setNotice(
        (await openNativeBackgroundSettings())
          ? '已打开省电设置；请把 FocusLink 设为“不受限制”或加入允许名单。'
          : '系统没有提供统一入口，请在应用详情的电池设置中允许后台活动。',
      );
    } catch (error) {
      setNotice(`无法打开后台设置：${errorMessage(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const openAutoStartSettings = async () => {
    setBusy('autostart');
    setNotice(null);
    try {
      setNotice(
        (await openNativeAutoStartSettings())
          ? '已打开系统自启动设置；请允许 FocusLink 自启动和关联启动。'
          : '系统没有独立自启动入口，请在 FocusLink 应用详情中手动允许。',
      );
    } catch (error) {
      setNotice(`无法打开自启动设置：${errorMessage(error)}`);
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
      <div className="native-system-health" aria-live="polite">
        <span className={status?.nativeConnectionConfigured ? 'is-ok' : 'is-warning'}>
          {status?.nativeConnectionConfigured ? '原生后台连接已加密保存' : '原生后台连接未配置'}
        </span>
        <span className={status?.batteryOptimizationExempt ? 'is-ok' : 'is-warning'}>
          {status?.batteryOptimizationExempt ? '省电限制已豁免' : '仍受系统省电限制'}
        </span>
        {status?.backgroundRestricted && <span className="is-warning">系统已限制后台活动</span>}
        {activeSnapshot && (
          <span className={pollHealthy ? 'is-ok' : 'is-warning'}>
            {pollHealthy
              ? `后台同步正常 · 第 ${poll?.attemptCount ?? 0} 轮`
              : `后台同步待恢复${poll?.lastError ? ` · ${poll.lastError}` : ''}`}
          </span>
        )}
        {poll?.lastSuccessAtEpochMs ? (
          <span>最近确认 {formatStatusTime(poll.lastSuccessAtEpochMs)}</span>
        ) : null}
      </div>
      <div className="native-system-actions">
        <button type="button" onClick={() => void enableNotifications()} disabled={busy !== null}>
          {busy === 'notification' ? '请求中…' : '启用通知控制'}
        </button>
        <button type="button" onClick={() => void addQuickSettingsTile()} disabled={busy !== null}>
          {busy === 'tile' ? '请求中…' : '添加到快捷设置'}
        </button>
        <button
          type="button"
          onClick={() => void openBackgroundSettings()}
          disabled={busy !== null}
        >
          {busy === 'background' ? '正在打开…' : '关闭省电限制'}
        </button>
        <button type="button" onClick={() => void openAutoStartSettings()} disabled={busy !== null}>
          {busy === 'autostart' ? '正在打开…' : '允许系统自启动'}
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

function formatStatusTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
