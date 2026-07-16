// 设置页 - 快捷键/主题/计时行为/任务来源/CLI/同步/滴答账号/系统
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../app/store';
import type { AppSettings } from '@shared/types';
import type { TomatodoBridgeStatus } from '@shared/ipc/api';
import { APP_VERSION } from '@shared/version';
import { TOMATODO_SUBJECT_OPTIONS } from '@shared/tomatodoPolicy';
import { Icon } from '../../ui/Icon';

const HOTKEY_LABELS: Record<keyof AppSettings['hotkeys'], string> = {
  toggleTimer: '开始 / 暂停 / 继续',
  stopTimer: '结束当前专注',
  toggleWindow: '打开 / 隐藏主窗口',
  linkTask: '快速关联任务',
  toggleMiniWindow: '显示 / 隐藏专注小窗',
};

const TABS = [
  { id: 'connections', label: '连接', icon: Icon.Link },
  { id: 'sync', label: '同步', icon: Icon.Refresh },
  { id: 'experience', label: '体验', icon: Icon.Settings },
] as const;

const ACCENT_OPTIONS = [
  { id: 'indigo', label: '静谧靛蓝', color: '#4e4eb2' },
  { id: 'violet', label: '柔雾紫', color: '#71549c' },
  { id: 'emerald', label: '松针绿', color: '#23845f' },
  { id: 'sky', label: '湖水蓝', color: '#2f7597' },
  { id: 'rose', label: '莓果红', color: '#b54c69' },
  { id: 'amber', label: '暖陶金', color: '#a6692b' },
] as const;

const FONT_OPTIONS = [
  {
    id: 'manrope',
    label: '舒展',
    detail: '圆润舒展 · Noto Sans SC',
    sample: '专注节奏 Focus 24:16',
  },
  {
    id: 'geist',
    label: '锐界',
    detail: '紧凑锐利 · 微软雅黑 UI',
    sample: '专注节奏 Focus 24:16',
  },
] as const satisfies ReadonlyArray<{
  id: AppSettings['fontProfile'];
  label: string;
  detail: string;
  sample: string;
}>;

type HotkeyKey = keyof AppSettings['hotkeys'];
type HotkeyRegistrationStatus = {
  registered: Partial<Record<HotkeyKey, { action: HotkeyKey; accelerator: string }>>;
  failed: Array<{ key: HotkeyKey; accelerator: string; success: boolean; error?: string }>;
};
type HotkeyBadgeState = {
  label: string;
  tone: 'ok' | 'warn' | 'error' | 'unknown';
  title?: string;
};

export function SettingsPanel() {
  const { settings, setSettings, syncQueue, setSyncQueue, addToast } = useStore();
  const [capturing, setCapturing] = useState<keyof AppSettings['hotkeys'] | null>(null);
  // captureKey 清理函数 ref：组件卸载时若仍在捕获，需移除全局监听
  const captureCleanupRef = useRef<(() => void) | null>(null);

  // 组件卸载时清理 captureKey 的全局监听，防止泄漏
  useEffect(() => {
    return () => {
      if (captureCleanupRef.current) {
        captureCleanupRef.current();
        captureCleanupRef.current = null;
      }
    };
  }, []);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [region, setRegion] = useState<'ticktick' | 'dida365'>('dida365');
  const [loginLoading, setLoginLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [cliDetecting, setCliDetecting] = useState(false);
  const [cliDetected, setCliDetected] = useState<{
    found: boolean;
    executable: string;
    helpOutput?: string;
  } | null>(null);
  const [providerInfo, setProviderInfo] = useState<{
    providerType: 'dida' | 'ticktick' | 'unknown';
    executable: string;
    executablePath: string;
    hasStaleTicktickTemplates: boolean;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<string>('connections');
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyRegistrationStatus | null>(null);
  const [tomatodoPending, setTomatodoPending] = useState<number>(0);
  const [tomatodoPendingError, setTomatodoPendingError] = useState<string | null>(null);
  const [tomatodoBridge, setTomatodoBridge] = useState<TomatodoBridgeStatus | null>(null);
  const [tomatodoUploading, setTomatodoUploading] = useState(false);
  const [didaSyncRunning, setDidaSyncRunning] = useState(false);

  useEffect(() => {
    window.focuslink.ticktick.status().then((s) => {
      setConnected(s.connected);
      setRegion(s.region as 'ticktick' | 'dida365');
    });
    window.focuslink.cli.detect().then((r) => {
      setCliDetected(r);
    });
    refreshProviderInfo();
    refreshHotkeyStatus();
    refreshTomatodoPending();
    refreshTomatodoBridge();
  }, []);

  useEffect(() => {
    if (activeTab !== 'sync') return;
    void refreshSyncState();
    const interval = setInterval(() => void refreshSyncState(), 5000);
    return () => clearInterval(interval);
    // refreshSyncState 读取当前渲染闭包；切换 Tab 时重建轮询即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    const unsub = window.focuslink.on('hotkey:registered', () => {
      refreshHotkeyStatus();
    });
    return () => unsub();
  }, []);

  const refreshProviderInfo = async () => {
    try {
      const r = await window.focuslink.cli.getCurrentProvider();
      setProviderInfo(r);
    } catch {
      // ignore
    }
  };

  const refreshHotkeyStatus = async () => {
    try {
      const status = await window.focuslink.hotkey.status();
      setHotkeyStatus(status as HotkeyRegistrationStatus);
    } catch {
      setHotkeyStatus(null);
    }
  };

  const refreshTomatodoPending = async () => {
    try {
      const count = await window.focuslink.tomatodo.pendingCount();
      setTomatodoPending(count);
      setTomatodoPendingError(null);
    } catch (error) {
      setTomatodoPendingError(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshTomatodoBridge = async () => {
    try {
      setTomatodoBridge(await window.focuslink.tomatodo.bridgeStatus());
    } catch (error) {
      setTomatodoBridge({
        state: 'launch-failed',
        connected: false,
        running: false,
        installed: true,
        launched: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const refreshSyncState = async () => {
    await Promise.all([
      refreshTomatodoPending(),
      refreshTomatodoBridge(),
      window.focuslink.sync
        .list()
        .then((items) => setSyncQueue(items))
        .catch(() => undefined),
    ]);
  };

  const handleRunDidaSync = async () => {
    setDidaSyncRunning(true);
    try {
      const result = await window.focuslink.sync.runPending();
      await refreshSyncState();
      if (result.failed > 0) {
        addToast(`${result.failed} 条滴答同步仍失败，请检查连接页诊断`, 'error');
      } else if (result.succeeded > 0) {
        addToast(`已同步 ${result.succeeded} 条记录到滴答清单`, 'success');
      } else {
        addToast('当前没有等待同步的滴答记录', 'info');
      }
    } catch (error) {
      addToast(`滴答同步失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setDidaSyncRunning(false);
    }
  };

  const handleUploadPending = async () => {
    setTomatodoUploading(true);
    try {
      let bridge = await window.focuslink.tomatodo.bridgeStatus();
      setTomatodoBridge(bridge);

      if (bridge.state === 'restart-required') {
        addToast('请先完全退出番茄 Todo，再点击“连接并上传”', 'info');
        return;
      }

      if (!bridge.connected) {
        if (!bridge.installed) {
          addToast('未找到番茄 Todo，请先安装或检查安装位置', 'error');
          return;
        }
        bridge = await window.focuslink.tomatodo.ensureBridge();
        setTomatodoBridge(bridge);
        if (!bridge.connected) {
          const message =
            bridge.state === 'restart-required'
              ? '请完全退出番茄 Todo 后再点击“连接并上传”'
              : bridge.error || '番茄 Todo 连接尚未就绪，请稍后重试';
          addToast(message, bridge.state === 'restart-required' ? 'info' : 'error');
          return;
        }
      }

      const result = await window.focuslink.tomatodo.uploadPending();
      if (result.uploaded > 0) {
        addToast(`番茄 Todo 已确认上传 ${result.uploaded} 条记录`, 'success');
      } else if (result.error) {
        addToast(result.error, 'info');
      } else {
        addToast('没有待上传的记录', 'info');
      }
      await Promise.all([refreshTomatodoPending(), refreshTomatodoBridge()]);
    } catch (e) {
      addToast('上传失败：' + (e as Error).message, 'error');
    } finally {
      setTomatodoUploading(false);
    }
  };

  const detectCli = async () => {
    setCliDetecting(true);
    try {
      const r = await window.focuslink.cli.detect();
      setCliDetected(r);
      await refreshProviderInfo();
      // 重新读取设置（detect 可能已自动迁移模板）
      const s = await window.focuslink.settings.get();
      setSettings(s);
      if (r.found) {
        if (providerInfo?.hasStaleTicktickTemplates) {
          addToast(`探测到 CLI：${r.executable}，已自动迁移为 dida 模板`, 'success');
        } else {
          addToast(`探测到 CLI：${r.executable}`, 'success');
        }
      } else {
        addToast('未探测到滴答清单 CLI，请手动配置可执行文件路径', 'info');
      }
    } catch (e) {
      addToast('探测失败：' + (e as Error).message, 'error');
    } finally {
      setCliDetecting(false);
    }
  };

  const applyDidaTemplates = async () => {
    try {
      const res = await window.focuslink.cli.applyDidaDefaults();
      if (res.ok) {
        const s = await window.focuslink.settings.get();
        setSettings(s);
        await refreshProviderInfo();
        addToast('已应用 dida 默认模板，正在测试任务读取...', 'success');
        // 立即测试任务读取
        const testRes = await window.focuslink.cli.listTasks();
        if (testRes.ok) {
          addToast(`dida 任务读取成功：${testRes.data.length} 个任务`, 'success');
        } else {
          addToast('dida 任务读取失败：' + testRes.error, 'error');
        }
      } else {
        addToast('应用失败：' + res.error, 'error');
      }
    } catch (e) {
      addToast('应用异常：' + (e as Error).message, 'error');
    }
  };

  // 文本输入专用更新：乐观更新但延迟持久化（防抖），避免每次按键都 IPC + 磁盘写
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsRef = useRef<Partial<AppSettings> | null>(null);
  const settingsWriteSeqRef = useRef(0);

  // 切页/关闭设置页时也要提交最后一次输入，不能因为清理 timer 静默丢掉 CLI 路径。
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      const pending = pendingSettingsRef.current;
      pendingSettingsRef.current = null;
      if (pending) void window.focuslink.settings.set(pending).catch(() => undefined);
    };
  }, []);

  if (!settings) return null;

  const activeAccent =
    ACCENT_OPTIONS.find((accent) => accent.id === settings.accentColor) ?? ACCENT_OPTIONS[0];

  const persistDebouncedSettings = async () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = null;
    const pendingPartial = pendingSettingsRef.current;
    pendingSettingsRef.current = null;
    if (!pendingPartial) return;
    const seq = ++settingsWriteSeqRef.current;
    try {
      const next = await window.focuslink.settings.set(pendingPartial);
      if (seq === settingsWriteSeqRef.current) setSettings(next);
    } catch {
      pendingSettingsRef.current = pendingPartial;
      addToast('设置保存失败，离开前请重试', 'error');
    }
  };

  // 只向主进程发送实际变更的字段；主进程基于最新设置深合并，避免覆盖小窗等外部更新。
  const update = async (partial: Partial<AppSettings>) => {
    const pendingPartial = pendingSettingsRef.current;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = null;
    pendingSettingsRef.current = null;
    const writePartial = { ...(pendingPartial ?? {}), ...partial };
    const current = useStore.getState().settings ?? settings;
    const optimistic = { ...current, ...writePartial };
    setSettings(optimistic); // 立即更新 UI，避免文本输入卡顿
    const seq = ++settingsWriteSeqRef.current;
    try {
      const next = await window.focuslink.settings.set(writePartial);
      if (seq === settingsWriteSeqRef.current) setSettings(next); // 用服务端返回的真实值校正
    } catch {
      const latest = await window.focuslink.settings.get().catch(() => current);
      if (seq === settingsWriteSeqRef.current) setSettings(latest);
      addToast('设置保存失败，请重试', 'error');
    }
  };

  const updateDebounced = (partial: Partial<AppSettings>) => {
    const current = useStore.getState().settings ?? settings;
    const optimistic = { ...current, ...partial };
    setSettings(optimistic);
    pendingSettingsRef.current = { ...(pendingSettingsRef.current ?? {}), ...partial };
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void persistDebouncedSettings();
    }, 400);
  };

  const captureKey = (key: keyof AppSettings['hotkeys']) => {
    setCapturing(key);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(null);
        cleanup();
        return;
      }
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      const keyName = normalizeKey(e.key);
      if (keyName) parts.push(keyName);
      if (parts.length >= 2) {
        applyHotkey(key, parts.join('+'));
        cleanup();
      }
    };
    const cleanup = () => {
      window.removeEventListener('keydown', handler, true);
      setCapturing(null);
      captureCleanupRef.current = null;
    };
    // 若上次捕获未清理（理论上不会，但防御性处理）
    if (captureCleanupRef.current) {
      captureCleanupRef.current();
    }
    captureCleanupRef.current = cleanup;
    window.addEventListener('keydown', handler, true);
  };

  const applyHotkey = async (key: keyof AppSettings['hotkeys'], accelerator: string) => {
    try {
      // setHotkey 现在返回 { settings, registration }，注册失败会保留旧快捷键
      const res = await window.focuslink.settings.setHotkey(key, accelerator);
      setSettings(res.settings);
      await refreshHotkeyStatus();
      if (res.registration.success) {
        addToast(`已设置：${accelerator}`, 'success');
      } else {
        addToast(`快捷键注册失败：${accelerator}（可能被其他软件占用，已保留旧快捷键）`, 'error');
      }
    } catch (e) {
      addToast('设置失败：' + (e as Error).message, 'error');
    }
  };

  const resetHotkeys = async () => {
    const next = await window.focuslink.hotkey.resetDefaults();
    setSettings(next);
    await refreshHotkeyStatus();
    addToast('已恢复默认快捷键', 'success');
  };

  const handleLogin = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      addToast('请填写 Client ID 和 Secret', 'info');
      return;
    }
    setLoginLoading(true);
    try {
      const next = await window.focuslink.ticktick.login(
        clientId.trim(),
        clientSecret.trim(),
        region,
      );
      setSettings(next);
      setConnected(true);
      addToast('滴答清单已连接', 'success');
    } catch (e) {
      addToast('登录失败：' + (e as Error).message, 'error');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const next = await window.focuslink.ticktick.logout();
      setSettings(next);
      setConnected(false);
      addToast('已断开滴答清单', 'info');
    } catch (e) {
      addToast('失败：' + (e as Error).message, 'error');
    }
  };

  const oauthConnection = (
    <Section
      title="TickTick OAuth（备用）"
      desc="dida CLI 不可用时再使用开发者应用连接；日常使用无需配置。"
    >
      <Row label="区域">
        <div className="flex gap-2">
          <ChoiceBtn active={region === 'dida365'} onClick={() => setRegion('dida365')}>
            滴答清单（国内）
          </ChoiceBtn>
          <ChoiceBtn active={region === 'ticktick'} onClick={() => setRegion('ticktick')}>
            TickTick（海外）
          </ChoiceBtn>
        </div>
      </Row>
      {!connected ? (
        <details className="rounded-lg border border-border/60 bg-bg-subtle/25">
          <summary className="motion-press cursor-pointer list-none px-3 py-2 text-[11px] font-medium text-fg-muted hover:text-fg">
            配置 OAuth 凭据
          </summary>
          <div className="space-y-3 border-t border-border/50 p-3">
            <Row label="Client ID">
              <input
                className="input"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="应用的 Client ID"
              />
            </Row>
            <Row label="Client Secret">
              <input
                className="input"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="应用的 Client Secret"
              />
            </Row>
            <button className="btn-primary" onClick={handleLogin} disabled={loginLoading}>
              {loginLoading ? <Icon.Loader size="sm" spin /> : null}
              连接滴答清单
            </button>
            <p className="text-xs text-fg-subtle">
              回调地址：
              <code className="rounded bg-bg-subtle px-1 py-0.5">
                http://localhost:18321/callback
              </code>
            </p>
          </div>
        </details>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-success/20 bg-success/10 px-4 py-3">
          <span className="text-sm text-success">已连接（{region}）</span>
          <button className="btn-ghost text-xs" onClick={handleLogout}>
            <Icon.LogOut size="sm" />
            断开
          </button>
        </div>
      )}
    </Section>
  );

  const didaPendingCount = syncQueue.filter((item) => item.status === 'pending').length;
  const didaFailedCount = syncQueue.filter((item) => item.status === 'failed').length;
  const didaNeedsAttention = didaPendingCount + didaFailedCount;

  const tomatodoBridgeLabel = (() => {
    switch (tomatodoBridge?.state) {
      case 'connected':
        return '番茄 Todo 已连接';
      case 'stopped':
        return '需要上传时可按需启动番茄 Todo';
      case 'restart-required':
        return '请完全退出番茄 Todo，再点击“连接并上传”';
      case 'not-installed':
        return '未找到番茄 Todo 安装程序';
      case 'launch-timeout':
        return '连接等待超时，可重新尝试';
      case 'launch-failed':
        return tomatodoBridge.error || '连接失败，可重新尝试';
      default:
        return '正在检查番茄 Todo 连接';
    }
  })();
  const tomatodoCanConnect =
    tomatodoBridge?.state === 'stopped' ||
    tomatodoBridge?.state === 'restart-required' ||
    tomatodoBridge?.state === 'launch-failed' ||
    tomatodoBridge?.state === 'launch-timeout';
  const tomatodoActionLabel = tomatodoBridge?.connected ? '立即上传' : '连接并上传';
  const tomatodoActionDisabled =
    tomatodoUploading ||
    !tomatodoBridge ||
    tomatodoBridge.state === 'not-installed' ||
    (!tomatodoBridge.connected && !tomatodoCanConnect);

  return (
    <div className="settings-page flex h-full flex-col">
      {/* 设置域切换 */}
      <div className="settings-tabs-shell shrink-0 px-6">
        <div className="mx-auto max-w-5xl">
          <div className="settings-tabs-bar inline-flex flex-wrap">
            {TABS.map((tab) => {
              const TabIcon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`settings-tab ${isActive ? 'active' : ''}`}
                >
                  <TabIcon size="sm" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-5xl">
          {activeTab === 'experience' && (
            <>
              {/* 外观 */}
              <Section title="外观" desc="明亮主题强调通透与层次；原深色主题完整保留。">
                <Row label="界面主题" desc="切换后主窗口与跟随主题的小窗会立即更新">
                  <div className="settings-theme-choices">
                    <ChoiceBtn
                      active={settings.theme === 'light'}
                      onClick={() => update({ theme: 'light' })}
                    >
                      <Icon.Sun size="xs" />
                      明亮
                    </ChoiceBtn>
                    <ChoiceBtn
                      active={settings.theme === 'dark'}
                      onClick={() => update({ theme: 'dark' })}
                    >
                      <Icon.Moon size="xs" />
                      深色
                    </ChoiceBtn>
                  </div>
                </Row>
                <Row label="字体气质" desc="舒展强调阅读呼吸；锐界使用更紧凑的中文字面与数字节奏">
                  <div className="settings-font-choices" aria-label="字体气质">
                    {FONT_OPTIONS.map((font) => (
                      <button
                        key={font.id}
                        type="button"
                        className={`settings-font-choice font-preview-${font.id} ${settings.fontProfile === font.id ? 'active' : ''}`}
                        onClick={() => update({ fontProfile: font.id })}
                        aria-pressed={settings.fontProfile === font.id}
                      >
                        <span className="settings-font-sample">{font.sample}</span>
                        <span className="settings-font-meta">
                          <strong>{font.label}</strong>
                          <small>{font.detail}</small>
                        </span>
                        {settings.fontProfile === font.id && (
                          <span className="settings-font-check">
                            <Icon.Check size="xs" />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </Row>
                <Row label="强调色" desc="每种颜色会同步重塑导航、关键动作与环境光场">
                  <div className="settings-accent-control">
                    <div className="settings-accent-choices" aria-label="强调色">
                      {ACCENT_OPTIONS.map((accent) => (
                        <button
                          key={accent.id}
                          type="button"
                          className={settings.accentColor === accent.id ? 'active' : ''}
                          style={{ '--accent-preview': accent.color } as React.CSSProperties}
                          onClick={() => update({ accentColor: accent.id })}
                          aria-label={accent.label}
                          aria-pressed={settings.accentColor === accent.id}
                          title={accent.label}
                        >
                          <span />
                          {settings.accentColor === accent.id && <Icon.Check size="xs" />}
                        </button>
                      ))}
                    </div>
                    <span
                      className="settings-accent-current"
                      style={{ '--accent-preview': activeAccent.color } as React.CSSProperties}
                    >
                      <i />
                      {activeAccent.label}
                      <small>动态光场</small>
                    </span>
                  </div>
                </Row>
              </Section>
            </>
          )}

          {activeTab === 'experience' && (
            <Section title="专注小窗" desc="主题、透明度、显示策略和手动收纳控制">
              <Row label="跟随主界面主题">
                <Toggle
                  label="跟随主界面主题"
                  checked={settings.miniWindow.followMainTheme}
                  onChange={(v) =>
                    update({ miniWindow: { ...settings.miniWindow, followMainTheme: v } })
                  }
                />
              </Row>
              {!settings.miniWindow.followMainTheme && (
                <Row label="小窗主题">
                  <div className="flex gap-2">
                    <ChoiceBtn
                      active={settings.miniWindow.themeMode === 'system'}
                      onClick={() =>
                        update({ miniWindow: { ...settings.miniWindow, themeMode: 'system' } })
                      }
                    >
                      跟随系统
                    </ChoiceBtn>
                    <ChoiceBtn
                      active={settings.miniWindow.themeMode === 'dark'}
                      onClick={() =>
                        update({ miniWindow: { ...settings.miniWindow, themeMode: 'dark' } })
                      }
                    >
                      深色
                    </ChoiceBtn>
                    <ChoiceBtn
                      active={settings.miniWindow.themeMode === 'light'}
                      onClick={() =>
                        update({ miniWindow: { ...settings.miniWindow, themeMode: 'light' } })
                      }
                    >
                      浅色
                    </ChoiceBtn>
                  </div>
                </Row>
              )}
              <Row label={`小窗透明度（${Math.round(settings.miniWindow.opacity * 100)}%）`}>
                <input
                  type="range"
                  min="0.6"
                  max="1"
                  step="0.02"
                  value={settings.miniWindow.opacity}
                  aria-label="小窗透明度"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    window.focuslink.mini.setOpacity(v);
                    update({ miniWindow: { ...settings.miniWindow, opacity: v } });
                  }}
                  className="settings-opacity-slider w-40"
                />
              </Row>
              <Row
                label="主窗口隐藏时自动显示小窗"
                desc="主窗口最小化或隐藏到托盘时，自动弹出专注小窗"
              >
                <Toggle
                  label="主窗口隐藏时自动显示小窗"
                  checked={settings.miniWindow.autoShowOnMainHide}
                  onChange={(v) =>
                    update({ miniWindow: { ...settings.miniWindow, autoShowOnMainHide: v } })
                  }
                />
              </Row>
              <Row label="专注开始时自动显示小窗" desc="开始专注时若主窗口不在前台，自动显示小窗">
                <Toggle
                  label="专注开始时自动显示小窗"
                  checked={settings.miniWindow.autoShowOnFocusStart}
                  onChange={(v) =>
                    update({ miniWindow: { ...settings.miniWindow, autoShowOnFocusStart: v } })
                  }
                />
              </Row>
              <Row label="专注结束后自动隐藏小窗" desc="专注结束时自动隐藏小窗（默认关）">
                <Toggle
                  label="专注结束后自动隐藏小窗"
                  checked={settings.miniWindow.autoHideOnFocusEnd}
                  onChange={(v) =>
                    update({ miniWindow: { ...settings.miniWindow, autoHideOnFocusEnd: v } })
                  }
                />
              </Row>
            </Section>
          )}

          {activeTab === 'experience' && (
            <>
              {/* 快捷键 */}
              <Section title="全局快捷键" desc="点击捕获新组合键；冲突时会提示并保留旧快捷键">
                {(Object.keys(HOTKEY_LABELS) as HotkeyKey[]).map((key) => {
                  const status = getHotkeyBadgeState(key, settings.hotkeys[key], hotkeyStatus);
                  const activeAccelerator = hotkeyStatus?.registered[key]?.accelerator ?? null;
                  const activeDiffers =
                    !!activeAccelerator && activeAccelerator !== settings.hotkeys[key];
                  return (
                    <Row key={key} label={HOTKEY_LABELS[key]}>
                      <div className="flex min-w-[260px] flex-col items-end gap-1.5">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            className="btn-outline min-w-[180px] justify-between font-mono text-xs"
                            onClick={() => captureKey(key)}
                            title={settings.hotkeys[key]}
                          >
                            {capturing === key ? (
                              <span className="text-accent">按下组合键...</span>
                            ) : (
                              <span>{formatHotkey(settings.hotkeys[key])}</span>
                            )}
                          </button>
                          <HotkeyStatusBadge state={status} />
                        </div>
                        <p
                          className={`max-w-[360px] text-right text-[11px] ${
                            status.tone === 'ok'
                              ? 'text-fg-subtle'
                              : status.tone === 'warn'
                                ? 'text-warning'
                                : status.tone === 'error'
                                  ? 'text-danger'
                                  : 'text-fg-subtle'
                          }`}
                        >
                          {status.tone === 'ok'
                            ? `当前生效：${formatHotkey(activeAccelerator ?? settings.hotkeys[key])}`
                            : activeDiffers
                              ? `当前实际生效：${formatHotkey(activeAccelerator)}，设置值尚未接管`
                              : (status.title ?? '当前快捷键尚未注册成功')}
                        </p>
                      </div>
                    </Row>
                  );
                })}
                <div className="pt-1">
                  <button className="btn-ghost text-xs" onClick={resetHotkeys}>
                    恢复默认快捷键
                  </button>
                </div>
              </Section>
            </>
          )}

          {activeTab === 'connections' && (
            <>
              {/* 滴答清单连接方式。任务产品语义保持唯一，CLI/OAuth 只是传输实现。 */}
              <Section
                title="滴答连接"
                desc="任务固定来自滴答清单；这里只选择连接方式，默认使用本机 CLI。"
              >
                <div className="settings-provider-list">
                  <SyncModeChoice
                    active={settings.taskSource !== 'ticktick-oauth'}
                    onClick={() => update({ taskSource: 'ticktick-cli' })}
                    icon={<Icon.Link size="md" />}
                    title="滴答 CLI"
                    badge="推荐"
                    desc="复用本机登录，支持任务与专注云同步"
                  />
                  <SyncModeChoice
                    active={settings.taskSource === 'ticktick-oauth'}
                    onClick={() => update({ taskSource: 'ticktick-oauth' })}
                    icon={<Icon.Cloud size="md" />}
                    title="OAuth"
                    desc="仅在 CLI 不可用时使用开发者应用"
                  />
                </div>

                <div className="settings-provider-status">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                          cliDetected?.found
                            ? 'bg-success/12 text-success'
                            : 'bg-warning/12 text-warning'
                        }`}
                      >
                        {cliDetected?.found ? (
                          <Icon.CheckCircleFilled size="sm" />
                        ) : (
                          <Icon.AlertCircle size="sm" />
                        )}
                      </span>
                      <div>
                        <p className="text-[12px] font-semibold text-fg">滴答 CLI 连接</p>
                        <p className="mt-0.5 text-[11.5px] text-fg-subtle">
                          {cliDetected?.found
                            ? '已就绪，可读取任务与同步专注'
                            : '尚未探测到可用命令'}
                        </p>
                      </div>
                    </div>
                    <button
                      className="btn-outline text-[11px]"
                      onClick={detectCli}
                      disabled={cliDetecting}
                    >
                      {cliDetecting ? <Icon.Loader size="xs" spin /> : <Icon.Search size="xs" />}
                      重新探测
                    </button>
                  </div>
                  <details className="settings-provider-advanced mt-2">
                    <summary className="motion-press cursor-pointer list-none px-3 py-2 text-[11px] font-medium text-fg-muted hover:text-fg">
                      <span>
                        高级 CLI 配置
                        <span className="ml-2 font-normal text-fg-subtle">
                          仅在自动探测失败时调整
                        </span>
                      </span>
                      <Icon.ChevronDown
                        size="xs"
                        tone="subtle"
                        className="settings-provider-chevron"
                      />
                    </summary>
                    <div className="space-y-2 border-t border-border/50 p-3">
                      {providerInfo && (
                        <div className="border-l-2 border-border-strong/50 px-3 py-1.5 text-[11px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-fg-subtle">CLI 类型</span>
                            <strong className="font-medium text-success">
                              {providerInfo.providerType === 'dida'
                                ? 'dida'
                                : providerInfo.providerType === 'ticktick'
                                  ? 'ticktick'
                                  : '未知'}
                            </strong>
                            <span className="text-fg-subtle">·</span>
                            <code className="font-mono text-fg">
                              {providerInfo.executable || '(未配置)'}
                            </code>
                          </div>
                          {providerInfo.executablePath && (
                            <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">
                              {providerInfo.executablePath}
                            </div>
                          )}
                          {providerInfo.hasStaleTicktickTemplates && (
                            <div className="mt-1.5 rounded bg-danger/10 px-2 py-1 text-[11px] text-danger">
                              当前模板与 dida 不一致，请应用默认模板。
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className="btn-outline text-[11px]"
                          onClick={applyDidaTemplates}
                          title="一键写入 dida 默认命令模板"
                        >
                          应用 dida 默认模板
                        </button>
                        <span className="text-[11px] text-fg-subtle">
                          点击后会覆盖当前命令模板为 dida 标准模板并立即测试
                        </span>
                      </div>
                      <Row label="可执行文件路径">
                        <input
                          className="input min-w-[200px] font-mono text-xs"
                          value={settings.ticktickCli.executable}
                          onChange={(e) =>
                            updateDebounced({
                              ticktickCli: { ...settings.ticktickCli, executable: e.target.value },
                            })
                          }
                          onBlur={() => void persistDebouncedSettings()}
                          placeholder="留空则用自动探测结果"
                        />
                      </Row>
                      <div className="mt-2 space-y-1.5">
                        <Row label="列出任务命令">
                          <input
                            className="input min-w-[200px] font-mono text-xs"
                            value={settings.ticktickCli.listTasksCommand}
                            onChange={(e) =>
                              updateDebounced({
                                ticktickCli: {
                                  ...settings.ticktickCli,
                                  listTasksCommand: e.target.value,
                                },
                              })
                            }
                            onBlur={() => void persistDebouncedSettings()}
                          />
                        </Row>
                        <Row label="搜索任务命令">
                          <input
                            className="input min-w-[200px] font-mono text-xs"
                            value={settings.ticktickCli.searchTasksCommand}
                            onChange={(e) =>
                              updateDebounced({
                                ticktickCli: {
                                  ...settings.ticktickCli,
                                  searchTasksCommand: e.target.value,
                                },
                              })
                            }
                            onBlur={() => void persistDebouncedSettings()}
                          />
                        </Row>
                        <Row label="追加备注命令">
                          <input
                            className="input min-w-[200px] font-mono text-xs"
                            value={settings.ticktickCli.appendNoteCommand}
                            onChange={(e) =>
                              updateDebounced({
                                ticktickCli: {
                                  ...settings.ticktickCli,
                                  appendNoteCommand: e.target.value,
                                },
                              })
                            }
                            onBlur={() => void persistDebouncedSettings()}
                          />
                        </Row>
                        <Row label="超时（毫秒）">
                          <input
                            type="number"
                            min={1000}
                            className="input w-24 text-xs"
                            value={settings.ticktickCli.timeoutMs}
                            onChange={(e) =>
                              update({
                                ticktickCli: {
                                  ...settings.ticktickCli,
                                  timeoutMs: Math.max(1000, Number(e.target.value) || 10000),
                                },
                              })
                            }
                          />
                        </Row>
                      </div>
                    </div>
                  </details>
                </div>
              </Section>
              {oauthConnection}
            </>
          )}

          {activeTab === 'sync' && (
            <>
              <Section title="滴答清单同步" desc="选择专注结束后的唯一主同步去向。">
                <div className="grid grid-cols-3 gap-3 max-[760px]:grid-cols-1">
                  <SyncModeChoice
                    active={settings.syncMode === 'focus-record'}
                    onClick={() => update({ syncMode: 'focus-record' })}
                    icon={<Icon.Cloud size="md" />}
                    title="云端专注"
                    badge="推荐"
                    desc="显示在滴答专注统计中"
                  />
                  <SyncModeChoice
                    active={settings.syncMode === 'comment'}
                    onClick={() => update({ syncMode: 'comment' })}
                    icon={<Icon.FileText size="md" />}
                    title="任务评论"
                    desc="写入关联任务评论，失败时回退正文"
                  />
                  <SyncModeChoice
                    active={settings.syncMode === 'local-only'}
                    onClick={() => update({ syncMode: 'local-only' })}
                    icon={<Icon.HardDrive size="md" />}
                    title="仅保存在本机"
                    desc="关闭滴答云端写入"
                  />
                </div>
                {settings.syncMode !== 'local-only' && (
                  <div
                    className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 ${
                      didaFailedCount > 0
                        ? 'border-danger/25 bg-danger/8'
                        : didaPendingCount > 0
                          ? 'border-warning/25 bg-warning/8'
                          : 'border-success/20 bg-success/8'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          didaFailedCount > 0
                            ? 'bg-danger/12 text-danger'
                            : didaPendingCount > 0
                              ? 'bg-warning/12 text-warning'
                              : 'bg-success/12 text-success'
                        }`}
                      >
                        {didaFailedCount > 0 ? (
                          <Icon.AlertCircle size="sm" />
                        ) : (
                          <Icon.CheckCircleFilled size="sm" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-fg">
                          {didaNeedsAttention === 0
                            ? '滴答同步队列已清空'
                            : `${didaPendingCount} 条等待同步 · ${didaFailedCount} 条失败`}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-fg-subtle">
                          失败记录会保留在本机，不会丢失专注数据
                        </p>
                      </div>
                    </div>
                    {didaNeedsAttention > 0 && (
                      <button
                        type="button"
                        className="btn-outline shrink-0 text-[11px]"
                        onClick={handleRunDidaSync}
                        disabled={didaSyncRunning}
                      >
                        {didaSyncRunning ? (
                          <Icon.Loader size="xs" spin />
                        ) : (
                          <Icon.Refresh size="xs" />
                        )}
                        立即重试
                      </button>
                    )}
                  </div>
                )}
              </Section>

              <Section
                title="番茄 Todo 同步"
                desc="专注结束后先安全写入本地；待传记录由你按需连接并上传。"
              >
                <Row label="启用番茄 Todo 同步" desc="自动匹配六大学科；未识别时使用下方默认分类">
                  <Toggle
                    label="启用番茄 Todo 同步"
                    checked={settings.tomatodo.enabled}
                    onChange={(v) => update({ tomatodo: { ...settings.tomatodo, enabled: v } })}
                  />
                </Row>
                {settings.tomatodo.enabled && (
                  <>
                    <Row label="未识别时归类">
                      <select
                        className="input !w-auto !py-1.5 text-xs"
                        value={settings.tomatodo.defaultSubject}
                        onChange={(e) =>
                          update({
                            tomatodo: {
                              ...settings.tomatodo,
                              defaultSubject: e.target
                                .value as AppSettings['tomatodo']['defaultSubject'],
                            },
                          })
                        }
                      >
                        {TOMATODO_SUBJECT_OPTIONS.map((subject) => (
                          <option key={subject.value} value={subject.value}>
                            {subject.value}
                          </option>
                        ))}
                      </select>
                    </Row>
                    <details className="rounded-xl border border-border/45 bg-bg-subtle/20">
                      <summary className="motion-press cursor-pointer list-none px-3 py-2.5 text-[11px] font-medium text-fg-muted hover:text-fg">
                        高级：自定义数据库路径
                      </summary>
                      <div className="border-t border-border/40 p-3">
                        <input
                          className="input w-full font-mono text-xs"
                          value={settings.tomatodo.dbPath}
                          onChange={(e) =>
                            updateDebounced({
                              tomatodo: { ...settings.tomatodo, dbPath: e.target.value },
                            })
                          }
                          onBlur={() => void persistDebouncedSettings()}
                          placeholder="自动探测 AppData/Roaming/tomatodo/tomatodo_db.json"
                        />
                      </div>
                    </details>
                    <div
                      className="flex min-h-11 items-center justify-between gap-4 border-t border-border/45 pt-3"
                      aria-live="polite"
                    >
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                            tomatodoPendingError ||
                            tomatodoBridge?.state === 'launch-failed' ||
                            tomatodoBridge?.state === 'launch-timeout' ||
                            tomatodoBridge?.state === 'not-installed'
                              ? 'bg-danger'
                              : tomatodoBridge?.state === 'restart-required' || tomatodoPending > 0
                                ? 'bg-warning'
                                : tomatodoBridge?.connected
                                  ? 'bg-success'
                                  : 'bg-fg-subtle/55'
                          }`}
                        />
                        <div className="min-w-0">
                          <p
                            className={`text-[12px] font-semibold ${
                              tomatodoPendingError ? 'text-danger' : 'text-fg'
                            }`}
                          >
                            {tomatodoPendingError
                              ? '无法读取待上传记录'
                              : tomatodoPending > 0
                                ? `${tomatodoPending} 条记录待上传`
                                : '当前无待上传'}
                          </p>
                          <p className="mt-0.5 text-[11px] leading-4 text-fg-subtle">
                            {tomatodoPendingError
                              ? '检查数据库路径或番茄 Todo 文件权限后重试'
                              : tomatodoBridgeLabel}
                          </p>
                        </div>
                      </div>
                      {!tomatodoPendingError && tomatodoPending > 0 && (
                        <button
                          type="button"
                          className="btn-outline shrink-0 text-[11px]"
                          onClick={handleUploadPending}
                          disabled={tomatodoActionDisabled}
                        >
                          {tomatodoUploading ? (
                            <Icon.Loader size="xs" spin />
                          ) : tomatodoBridge?.connected ? (
                            <Icon.Upload size="xs" />
                          ) : (
                            <Icon.Link size="xs" />
                          )}
                          {tomatodoUploading
                            ? tomatodoBridge?.connected
                              ? '正在上传'
                              : '正在连接'
                            : tomatodoActionLabel}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </Section>
            </>
          )}

          {activeTab === 'experience' && (
            <>
              {/* 系统与后台运行 */}
              <Section title="系统与后台运行">
                <Row label="最小化到托盘">
                  <Toggle
                    label="最小化到托盘"
                    checked={settings.minimizeToTray}
                    onChange={(v) => update({ minimizeToTray: v })}
                  />
                </Row>
                <Row label="关闭窗口时最小化到托盘">
                  <Toggle
                    label="关闭窗口时最小化到托盘"
                    checked={settings.closeToTray}
                    onChange={(v) => update({ closeToTray: v })}
                  />
                </Row>
                <Row label="启动后最小化到托盘" desc="手动启动也隐藏主界面；开机自启动会自动进托盘">
                  <Toggle
                    label="启动后最小化到托盘"
                    checked={settings.startMinimizedToTray}
                    onChange={(v) => update({ startMinimizedToTray: v })}
                  />
                </Row>
                <Row label="启动时显示专注小窗">
                  <Toggle
                    label="启动时显示专注小窗"
                    checked={settings.showMiniOnStart}
                    onChange={(v) => update({ showMiniOnStart: v })}
                  />
                </Row>
                <Row label="开机自启动" desc="系统登录时带隐藏参数启动，不弹出主界面">
                  <Toggle
                    label="开机自启动"
                    checked={settings.autoStart}
                    onChange={(v) => update({ autoStart: v })}
                  />
                </Row>
              </Section>
            </>
          )}

          {activeTab === 'experience' && (
            <>
              <Section title="FocusLink" desc="全局快捷键驱动的专注计时器 + 滴答清单任务关联工具">
                <Row label="当前版本">
                  <span className="rounded-md border border-border bg-bg-subtle px-2.5 py-1 text-xs font-mono text-fg-muted">
                    v{APP_VERSION}
                  </span>
                </Row>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function getHotkeyBadgeState(
  key: HotkeyKey,
  accelerator: string,
  status: HotkeyRegistrationStatus | null,
): HotkeyBadgeState {
  if (!status) return { label: '检测中', tone: 'unknown' };
  const failed = status.failed.find((item) => item.key === key);
  if (failed) {
    return {
      label: '注册失败',
      tone: 'error',
      title: failed.error ?? '快捷键可能被系统或其他软件占用',
    };
  }
  const registered = status.registered[key];
  if (registered?.accelerator === accelerator) {
    return { label: '已生效', tone: 'ok' };
  }
  if (registered) {
    return {
      label: '已回退',
      tone: 'warn',
      title: `当前实际生效：${registered.accelerator}`,
    };
  }
  return { label: '未注册', tone: 'error', title: '当前组合键尚未注册为全局快捷键' };
}

function HotkeyStatusBadge({ state }: { state: HotkeyBadgeState }) {
  const cls =
    state.tone === 'ok'
      ? 'border-success/25 bg-success/10 text-success'
      : state.tone === 'warn'
        ? 'border-warning/25 bg-warning/10 text-warning'
        : state.tone === 'error'
          ? 'border-danger/25 bg-danger/10 text-danger'
          : 'border-border bg-bg-subtle text-fg-subtle';
  return (
    <span
      className={`inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium ${cls}`}
      title={state.title}
    >
      {state.tone === 'ok' ? <Icon.CheckCircleFilled size="xs" /> : <Icon.AlertCircle size="xs" />}
      {state.label}
    </span>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {desc && <p className="mt-1 text-[11.5px] leading-relaxed text-fg-subtle">{desc}</p>}
      </div>
      <div className="settings-section-content">{children}</div>
    </section>
  );
}

function Row({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row flex min-h-[48px] items-center justify-between gap-4">
      <div className="min-w-0">
        <span className="block text-[13px] text-fg">{label}</span>
        {desc && <span className="block text-[11px] text-fg-subtle">{desc}</span>}
      </div>
      {children}
    </div>
  );
}

function ChoiceBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`motion-press choice-btn ${
        active
          ? 'bg-accent text-accent-fg shadow-sm'
          : 'bg-bg-subtle/60 text-fg-muted hover:bg-bg-subtle hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

function SyncModeChoice({
  active,
  onClick,
  icon,
  title,
  desc,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`settings-provider-choice motion-press ${active ? 'active' : ''}`}
      aria-pressed={active}
    >
      <span className="settings-provider-radio" aria-hidden="true">
        <i />
      </span>
      <span className="settings-provider-icon">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold text-fg">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-fg-subtle">{desc}</span>
      </span>
      {badge && <span className="settings-provider-badge">{badge}</span>}
      <Icon.ChevronRight size="xs" className="settings-provider-arrow" />
    </button>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`motion-press toggle-track ${checked ? 'checked' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={`${label}：${checked ? '已开启，点击关闭' : '已关闭，点击开启'}`}
      title={`${label}：${checked ? '已开启' : '已关闭'}`}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

function normalizeKey(key: string): string | null {
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  // F1-F12, Enter, Escape etc.
  if (/^F\d{1,2}$/.test(key)) return key;
  const map: Record<string, string> = {
    Enter: 'Return',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  };
  return map[key] ?? null;
}

function formatHotkey(accelerator: string | null): string {
  if (!accelerator) return '未注册';
  return accelerator
    .split('+')
    .map((part) => (part === 'CommandOrControl' ? 'Ctrl' : part === 'Return' ? 'Enter' : part))
    .join(' + ');
}
