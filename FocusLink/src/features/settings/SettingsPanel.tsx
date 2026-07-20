// 设置页 - 紧凑分组列表：左侧分组导航 + 右侧连续行列表。
// FocusLink 只有一套视觉语言；外观只切换 light/dark/system。
// 强调色贯穿全部界面与专注状态；暂停保持红色。
// - 开关统一 42×24px，关闭态有清楚边界，disabled 可识别；
// - 语义标签：已同步/未同步/同步失败仅用于同步队列；dida 描述为「同步到滴答清单」；
//   番茄 To-do 使用「已写入本地/待上传/上传已确认」。
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../app/store';
import type { AppSettings } from '@shared/types';
import type { DeviceSyncStatus, TomatodoBridgeStatus } from '@shared/ipc/api';
import { APP_VERSION } from '@shared/version';
import { TOMATODO_SUBJECT_OPTIONS } from '@shared/tomatodoPolicy';
import { resolveFontProfile, resolveTimerStyle } from '@shared/theme';
import { Icon } from '../../ui/Icon';
import { TimerDial } from '../focus/TimerDial';

const HOTKEY_LABELS: Record<keyof AppSettings['hotkeys'], string> = {
  toggleTimer: '开始 / 暂停 / 继续',
  stopTimer: '结束当前专注',
  toggleWindow: '打开 / 隐藏主窗口',
  linkTask: '快速关联任务',
  toggleMiniWindow: '显示 / 隐藏专注小窗',
};

const TABS = [
  { id: 'experience', label: '界面与体验', icon: Icon.Settings },
  { id: 'connections', label: '连接', icon: Icon.Link },
  { id: 'sync', label: '同步', icon: Icon.Refresh },
] as const;

const FOCUS_COLOR_OPTIONS = [
  { id: 'emerald', label: '翡翠', color: '#0e9f6e' },
  { id: 'cobalt', label: '钴蓝', color: '#2367c4' },
  { id: 'violet', label: '鸢尾', color: '#7149bc' },
  { id: 'amber', label: '琥珀', color: '#bb7718' },
  { id: 'graphite', label: '石墨', color: '#434c58' },
] as const;

const FONT_PROFILE_OPTIONS = [
  {
    id: 'noto',
    label: '现代无衬线',
    sample: '待完成 · 时间仪器',
    note: '中性清晰，适合高密度信息',
  },
  {
    id: 'wenkai',
    label: '霞鹜文楷',
    sample: '待完成 · 时间仪器',
    note: '楷体骨架，温润而有书写感',
  },
  {
    id: 'zhisong',
    label: '霞鹜新致宋',
    sample: '待完成 · 时间仪器',
    note: '现代宋体，横细竖重且有编辑气质',
  },
  {
    id: 'marker',
    label: '霞鹜漫黑',
    sample: '待完成 · 时间仪器',
    note: '马克笔笔触，轻松而有鲜明个性',
  },
  {
    id: 'xihei',
    label: '霞鹜新晰黑',
    sample: '清醒专注 · 正线体',
    note: '正线细黑，横竖克制、骨架清楚，适合 Cloud 式清爽界面',
  },
  {
    id: 'smiley',
    label: '得意黑',
    sample: '时间正在发生 12:48',
    note: '倾斜窄体展示字，轮廓大胆，与常规黑体明显不同',
  },
] as const satisfies ReadonlyArray<{
  id: AppSettings['fontProfile'];
  label: string;
  sample: string;
  note: string;
}>;

const TIMER_STYLE_OPTIONS = [
  { id: 'standard', label: '标准等宽', note: 'JetBrains Mono · 沉稳仪器读数' },
  { id: 'flip', label: '翻页机械', note: '上下分片翻牌 · 中央转轴' },
  { id: 'pixel', label: '像素点阵', note: '实体格点 · 专注核心充能' },
  { id: 'thin', label: '高反差编辑', note: 'Bodoni 衬线 · 纤细排版' },
  { id: 'segment', label: '七段数码', note: '真实段码 · 工业仪表' },
] as const satisfies ReadonlyArray<{
  id: AppSettings['timerStyle'];
  label: string;
  note: string;
}>;

// 番茄 To-do 学科下拉的可选值（与 TOMATODO_SUBJECT_OPTIONS 同源）
const TOMATODO_SUBJECT_VALUES = TOMATODO_SUBJECT_OPTIONS.map((subject) => subject.value);

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
  const [activeTab, setActiveTab] = useState<string>('experience');
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyRegistrationStatus | null>(null);
  const [tomatodoPending, setTomatodoPending] = useState<number>(0);
  const [tomatodoPendingError, setTomatodoPendingError] = useState<string | null>(null);
  const [tomatodoBridge, setTomatodoBridge] = useState<TomatodoBridgeStatus | null>(null);
  const [tomatodoUploading, setTomatodoUploading] = useState(false);
  const [didaSyncRunning, setDidaSyncRunning] = useState(false);
  const [deviceSyncStatus, setDeviceSyncStatus] = useState<DeviceSyncStatus | null>(null);
  const [deviceSyncToken, setDeviceSyncToken] = useState('');
  const [deviceSyncSaving, setDeviceSyncSaving] = useState(false);
  const [deviceSyncRunning, setDeviceSyncRunning] = useState(false);
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
    refreshDeviceSyncStatus();
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

  const refreshDeviceSyncStatus = async () => {
    try {
      setDeviceSyncStatus(await window.focuslink.deviceSync.status());
    } catch (error) {
      setDeviceSyncStatus((current) =>
        current
          ? {
              ...current,
              running: false,
              lastError: error instanceof Error ? error.message : String(error),
            }
          : null,
      );
    }
  };

  const refreshSyncState = async () => {
    await Promise.all([
      refreshTomatodoPending(),
      refreshTomatodoBridge(),
      refreshDeviceSyncStatus(),
      window.focuslink.sync
        .list()
        .then((items) => setSyncQueue(items))
        .catch(() => undefined),
    ]);
  };

  const handleSaveDeviceSync = async () => {
    const currentSettings = useStore.getState().settings;
    if (!currentSettings) return;
    setDeviceSyncSaving(true);
    try {
      const status = await window.focuslink.deviceSync.configure({
        enabled: currentSettings.deviceSync.enabled,
        endpoint: currentSettings.deviceSync.endpoint,
        autoSync: currentSettings.deviceSync.autoSync,
        liveControlEnabled: currentSettings.deviceSync.liveControlEnabled,
        accessToken: deviceSyncToken.trim() || undefined,
      });
      setDeviceSyncStatus(status);
      setDeviceSyncToken('');
      setSettings(await window.focuslink.settings.get());
      if (status.enabled && status.configured) {
        const result = await window.focuslink.deviceSync.syncNow();
        await refreshDeviceSyncStatus();
        if (result.unresolvedConflicts > 0 || result.rejected > 0) {
          addToast(
            `连接已保存；同步仍有 ${result.unresolvedConflicts} 个冲突、${result.rejected} 个拒绝项`,
            'error',
          );
        } else {
          addToast(
            `连接并同步成功：上传 ${result.pushed}，导入 ${result.imported}${status.liveControlEnabled ? '，实时连接正在建立' : ''}`,
            'success',
          );
        }
      } else {
        addToast('跨设备同步连接已保存', 'success');
      }
    } catch (error) {
      addToast(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setDeviceSyncSaving(false);
    }
  };

  const handleRunDeviceSync = async () => {
    setDeviceSyncRunning(true);
    try {
      const result = await window.focuslink.deviceSync.syncNow();
      await refreshDeviceSyncStatus();
      if (result.unresolvedConflicts > 0 || result.rejected > 0) {
        addToast(
          `跨设备同步未完全收敛：${result.unresolvedConflicts} 个冲突待处理，${result.rejected} 个被拒绝`,
          'error',
        );
      } else {
        addToast(`跨设备同步完成：上传 ${result.pushed}，导入 ${result.imported}`, 'success');
      }
    } catch (error) {
      addToast(
        `跨设备同步失败：${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
      await refreshDeviceSyncStatus();
    } finally {
      setDeviceSyncRunning(false);
    }
  };

  const handleRunDidaSync = async () => {
    setDidaSyncRunning(true);
    try {
      const result = await window.focuslink.sync.runPending();
      await refreshSyncState();
      if (result.failed > 0) {
        addToast(`${result.failed} 条同步失败，请检查连接页诊断`, 'error');
      } else if (result.succeeded > 0) {
        addToast(`已同步 ${result.succeeded} 条记录到滴答清单`, 'success');
      } else {
        addToast('当前没有未同步的滴答记录', 'info');
      }
    } catch (error) {
      addToast(
        `同步到滴答清单失败：${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
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
        addToast('请先完全退出番茄 To-do，再点击“连接并上传”', 'info');
        return;
      }

      if (!bridge.connected) {
        if (!bridge.installed) {
          addToast('未找到番茄 To-do，请先安装或检查安装位置', 'error');
          return;
        }
        bridge = await window.focuslink.tomatodo.ensureBridge();
        setTomatodoBridge(bridge);
        if (!bridge.connected) {
          const message =
            bridge.state === 'restart-required'
              ? '请完全退出番茄 To-do 后再点击“连接并上传”'
              : bridge.error || '番茄 To-do 连接尚未就绪，请稍后重试';
          addToast(message, bridge.state === 'restart-required' ? 'info' : 'error');
          return;
        }
      }

      const result = await window.focuslink.tomatodo.uploadPending();
      if (result.uploaded > 0) {
        addToast(`番茄 To-do 上传已确认：${result.uploaded} 条记录`, 'success');
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

  const appearanceLabel =
    settings.theme === 'light' ? '明亮' : settings.theme === 'dark' ? '深色' : '跟随系统';

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
        <details className="settings-disclosure mt-2.5">
          <summary className="motion-press">配置 OAuth 凭据</summary>
          <div className="space-y-3">
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
            <button className="btn-accent" onClick={handleLogin} disabled={loginLoading}>
              {loginLoading ? <Icon.Loader size="sm" spin /> : null}
              连接滴答清单
            </button>
            <p className="text-diag">
              回调地址：
              <code className="rounded bg-bg-subtle px-1 py-0.5">
                http://localhost:18321/callback
              </code>
            </p>
          </div>
        </details>
      ) : (
        <div className="settings-status-strip tone-success mt-2.5">
          <span className="settings-status-strip-icon">
            <Icon.CheckCircleFilled size="sm" />
          </span>
          <div className="settings-status-strip-copy">
            <p className="settings-status-strip-title">
              已连接
              <span className="text-diag">{region}</span>
            </p>
            <p className="settings-status-strip-desc">开发者应用连接可用；日常仍推荐使用本机 CLI</p>
          </div>
          <ConfirmButton
            label="断开"
            confirmLabel="确认断开？"
            onConfirm={handleLogout}
            icon={<Icon.LogOut size="sm" />}
          />
        </div>
      )}
    </Section>
  );

  const didaPendingCount = syncQueue.filter((item) => item.status === 'pending').length;
  const didaFailedCount = syncQueue.filter((item) => item.status === 'failed').length;
  const didaNeedsAttention = didaPendingCount + didaFailedCount;
  // 同步队列语义标签契约：已同步 / 未同步 / 同步失败
  const didaQueueTitle =
    didaNeedsAttention === 0
      ? '全部已同步'
      : [
          didaPendingCount > 0 ? `${didaPendingCount} 条未同步` : null,
          didaFailedCount > 0 ? `${didaFailedCount} 条同步失败` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const tomatodoBridgeLabel = (() => {
    switch (tomatodoBridge?.state) {
      case 'connected':
        return '番茄 To-do 已连接';
      case 'stopped':
        return '需要上传时可按需启动番茄 To-do';
      case 'restart-required':
        return '请完全退出番茄 To-do，再点击“连接并上传”';
      case 'not-installed':
        return '未找到番茄 To-do 安装程序';
      case 'launch-timeout':
        return '连接等待超时，可重新尝试';
      case 'launch-failed':
        return tomatodoBridge.error || '连接失败，可重新尝试';
      default:
        return '正在检查番茄 To-do 连接';
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
  const tomatodoBadge = (() => {
    if (
      tomatodoPendingError ||
      tomatodoBridge?.state === 'launch-failed' ||
      tomatodoBridge?.state === 'launch-timeout'
    ) {
      return { tone: 'tone-danger', label: '连接失败' };
    }
    if (tomatodoBridge?.state === 'not-installed') {
      return { tone: 'tone-neutral', label: '未安装' };
    }
    if (tomatodoBridge?.state === 'restart-required') {
      return { tone: 'tone-warning', label: '需重启' };
    }
    if (tomatodoBridge?.connected) {
      return { tone: 'tone-success', label: '已连接' };
    }
    if (tomatodoBridge?.state === 'stopped') {
      return { tone: 'tone-neutral', label: '未连接' };
    }
    return { tone: 'tone-neutral', label: '检测中' };
  })();

  return (
    <div className="settings-page">
      {/* 左侧分组导航（Raycast 式侧栏）：域名切换 + 当前主题诊断 */}
      <aside className="settings-nav">
        <div className="settings-nav-head">
          <h2 className="text-page-title">设置</h2>
          <p className="text-diag">v{APP_VERSION}</p>
        </div>
        <nav className="settings-nav-list" role="tablist" aria-label="设置分类">
          {TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`settings-tab ${isActive ? 'active' : ''}`}
              >
                <TabIcon size="sm" />
                {tab.label}
              </button>
            );
          })}
        </nav>
        <div className="settings-nav-foot text-diag">FocusLink · {appearanceLabel}</div>
      </aside>

      {/* 分组列表内容 */}
      <div className="settings-scroll">
        <div className="settings-container settings-stack">
          {activeTab === 'experience' && (
            <>
              <Section title="外观" desc="亮色优先设计；深色沿用同一套结构与状态语义。">
                <Row label="外观模式" desc="切换后主窗口与跟随主题的小窗会立即更新">
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
                    <ChoiceBtn
                      active={settings.theme === 'system'}
                      onClick={() => update({ theme: 'system' })}
                    >
                      <Icon.Monitor size="xs" />
                      跟随系统
                    </ChoiceBtn>
                  </div>
                </Row>
              </Section>

              <Section
                title="专注仪表"
                desc="所选强调色贯穿导航、按钮、任务、统计与专注状态；暂停始终保持红色。"
              >
                <div>
                  <Row label="界面字体" desc="改变正文、任务与设置文字；计时数字使用各自独立字体">
                    <div className="font-profile-choices" aria-label="界面字体">
                      {FONT_PROFILE_OPTIONS.map((profile) => (
                        <button
                          key={profile.id}
                          type="button"
                          className={`font-profile-choice preview-${profile.id} ${resolveFontProfile(settings.fontProfile) === profile.id ? 'active' : ''}`}
                          onClick={() => update({ fontProfile: profile.id })}
                          aria-pressed={resolveFontProfile(settings.fontProfile) === profile.id}
                        >
                          <span className="fp-name">{profile.label}</span>
                          <strong className="fp-sample">{profile.sample}</strong>
                          <span className="fp-note">{profile.note}</span>
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row
                    label="全局强调色"
                    desc="同时应用到导航、操作、选中态、统计图、专注读数与时间之带"
                  >
                    <div className="focus-color-choices" aria-label="专注强调色">
                      {FOCUS_COLOR_OPTIONS.map((color) => (
                        <button
                          key={color.id}
                          type="button"
                          className={`focus-color-swatch ${settings.focusColor === color.id ? 'active' : ''}`}
                          style={{ backgroundColor: color.color }}
                          onClick={() => update({ focusColor: color.id })}
                          aria-label={color.label}
                          aria-pressed={settings.focusColor === color.id}
                          title={color.label}
                        />
                      ))}
                      <span className="focus-color-note">
                        当前：{FOCUS_COLOR_OPTIONS.find((c) => c.id === settings.focusColor)?.label}
                      </span>
                    </div>
                  </Row>
                  <Row label="计时仪表" desc="只改变主计时读数的表现，不构成完整主题">
                    <div className="instrument-choices" aria-label="计时仪表样式">
                      {TIMER_STYLE_OPTIONS.map((style) => (
                        <button
                          key={style.id}
                          type="button"
                          className={`instrument-choice ${resolveTimerStyle(settings.timerStyle) === style.id ? 'active' : ''}`}
                          onClick={() => update({ timerStyle: style.id })}
                          aria-pressed={resolveTimerStyle(settings.timerStyle) === style.id}
                        >
                          <span className="ic-name">{style.label}</span>
                          <span className="ic-preview">
                            <TimerDial
                              ms={25 * 60_000 + 16_000}
                              state="running"
                              style={style.id}
                              coreRatio={0.62}
                            />
                          </span>
                          <span className="ic-note">{style.note}</span>
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row label="状态色" desc="三种语义色在全应用保持稳定">
                    <div className="settings-state-colors">
                      <span className="interface">操作 · 当前强调色</span>
                      <span className="focus">专注 · 当前强调色</span>
                      <span className="pause">暂停 · 红</span>
                    </div>
                  </Row>
                </div>
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
                  className="settings-opacity-slider"
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
                            className={`settings-hotkey-btn ${capturing === key ? 'capturing' : ''}`}
                            onClick={() => captureKey(key)}
                            title={settings.hotkeys[key]}
                          >
                            {capturing === key ? (
                              <span className="settings-hotkey-capturing">按下组合键…</span>
                            ) : (
                              <kbd>{formatHotkey(settings.hotkeys[key])}</kbd>
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
                  <div className="settings-provider-status-head">
                    <div className="settings-provider-status-title">
                      <span
                        className={`settings-provider-status-icon ${
                          cliDetected?.found ? 'tone-success' : 'tone-warning'
                        }`}
                      >
                        {cliDetected?.found ? (
                          <Icon.CheckCircleFilled size="sm" />
                        ) : (
                          <Icon.AlertCircle size="sm" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-[12.5px] font-semibold text-fg">
                          滴答 CLI 连接
                          <span
                            className={`settings-status-badge ${
                              cliDetected?.found ? 'tone-success' : 'tone-warning'
                            }`}
                          >
                            {cliDetected?.found ? '已连接' : '未连接'}
                          </span>
                        </p>
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
                  <details className="settings-provider-advanced">
                    <summary className="motion-press">
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
                        <div className="settings-diag-block text-diag">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>CLI 类型</span>
                            <strong className="font-medium text-success">
                              {providerInfo.providerType === 'dida'
                                ? 'dida'
                                : providerInfo.providerType === 'ticktick'
                                  ? 'ticktick'
                                  : '未知'}
                            </strong>
                            <span>·</span>
                            <code>{providerInfo.executable || '(未配置)'}</code>
                          </div>
                          {providerInfo.executablePath && (
                            <div className="mt-1 truncate">{providerInfo.executablePath}</div>
                          )}
                          {providerInfo.hasStaleTicktickTemplates && (
                            <div className="mt-1.5 rounded bg-danger/10 px-2 py-1 text-danger">
                              当前模板与 dida 不一致，请应用默认模板。
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <ConfirmButton
                          label="应用 dida 默认模板"
                          confirmLabel="确认覆盖模板？"
                          onConfirm={applyDidaTemplates}
                        />
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
              <Section
                title="FocusLink 跨设备同步"
                desc="同步已结束账本；可选让 PC、网页与安卓端共同控制同一场实时专注。当前服务仍是自托管测试后端。"
              >
                <Row label="启用跨设备同步" desc="结束后的会话、片段与暂停账本会在设备间同步">
                  <Toggle
                    label="启用跨设备同步"
                    checked={settings.deviceSync.enabled}
                    onChange={(enabled) =>
                      update({
                        deviceSync: { ...settings.deviceSync, enabled },
                      })
                    }
                  />
                </Row>
                <Row
                  label="PC 参与实时专注"
                  desc="启用后云端是活动计时的唯一事实源；断线时 PC 不会伪造已确认状态"
                >
                  <Toggle
                    label="PC 参与实时专注"
                    checked={settings.deviceSync.liveControlEnabled}
                    onChange={(liveControlEnabled) =>
                      update({
                        deviceSync: { ...settings.deviceSync, liveControlEnabled },
                      })
                    }
                  />
                </Row>
                <Row label="同步服务地址" desc="生产地址必须使用 HTTPS；HTTP 只允许本机测试服务">
                  <input
                    className="input min-w-[320px] font-mono text-xs"
                    value={settings.deviceSync.endpoint}
                    onChange={(event) =>
                      updateDebounced({
                        deviceSync: {
                          ...settings.deviceSync,
                          endpoint: event.target.value,
                        },
                      })
                    }
                    onBlur={() => void persistDebouncedSettings()}
                    placeholder="http://127.0.0.1:8787"
                  />
                </Row>
                <Row
                  label="访问令牌"
                  desc={
                    deviceSyncStatus?.tokenConfigured
                      ? '已由系统安全存储保护；留空不会覆盖现有令牌'
                      : '测试服务启动时配置的 Bearer token'
                  }
                >
                  <input
                    className="input min-w-[260px] font-mono text-xs"
                    type="password"
                    value={deviceSyncToken}
                    onChange={(event) => setDeviceSyncToken(event.target.value)}
                    autoComplete="off"
                    placeholder={
                      deviceSyncStatus?.tokenConfigured ? '已保存（留空保持）' : '输入访问令牌'
                    }
                  />
                </Row>
                <Row label="自动同步" desc="启动、专注结束及后台周期检查时补传">
                  <Toggle
                    label="自动同步"
                    checked={settings.deviceSync.autoSync}
                    onChange={(autoSync) =>
                      update({
                        deviceSync: { ...settings.deviceSync, autoSync },
                      })
                    }
                  />
                </Row>
                <div
                  className={`settings-status-strip ${
                    deviceSyncStatus?.lastError
                      ? 'tone-danger'
                      : deviceSyncStatus?.lastSyncAt
                        ? 'tone-success'
                        : deviceSyncStatus?.configured
                          ? 'tone-warning'
                          : ''
                  }`}
                  aria-live="polite"
                >
                  <span className="settings-status-strip-icon">
                    {deviceSyncStatus?.lastError ? (
                      <Icon.AlertCircle size="sm" />
                    ) : (
                      <Icon.Cloud size="sm" />
                    )}
                  </span>
                  <div className="settings-status-strip-copy">
                    <p className="settings-status-strip-title">
                      {deviceSyncStatus?.lastError
                        ? '跨设备同步失败'
                        : deviceSyncStatus?.lastSyncAt
                          ? '账本已完成跨设备同步'
                          : deviceSyncStatus?.configured
                            ? '连接已配置，等待首次同步'
                            : '尚未配置访问令牌'}
                      <span
                        className={`settings-status-badge ${
                          deviceSyncStatus?.enabled ? 'tone-success' : 'tone-neutral'
                        }`}
                      >
                        {deviceSyncStatus?.enabled ? '已启用' : '未启用'}
                      </span>
                    </p>
                    <p className="settings-status-strip-desc">
                      {deviceSyncStatus?.lastError
                        ? deviceSyncStatus.lastError
                        : deviceSyncStatus?.lastSyncAt
                          ? `上次同步：${new Date(deviceSyncStatus.lastSyncAt).toLocaleString('zh-CN')}`
                          : deviceSyncStatus?.liveControlEnabled
                            ? deviceSyncStatus.liveConnected
                              ? `实时连接已确认 · rev ${deviceSyncStatus.liveRevision ?? 0} · ${deviceSyncStatus.liveState}`
                              : 'PC 实时控制已启用，正在等待连接；第三方凭据与本地路径不会上传'
                            : '当前只同步已结束会话；第三方凭据与本地路径不会上传'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="btn-outline text-[11px]"
                      onClick={handleSaveDeviceSync}
                      disabled={deviceSyncSaving}
                    >
                      {deviceSyncSaving ? <Icon.Loader size="xs" spin /> : <Icon.Check size="xs" />}
                      保存并连接
                    </button>
                    <button
                      type="button"
                      className="btn-accent text-[11px]"
                      onClick={handleRunDeviceSync}
                      disabled={
                        deviceSyncRunning ||
                        !settings.deviceSync.enabled ||
                        !deviceSyncStatus?.tokenConfigured
                      }
                    >
                      {deviceSyncRunning ? (
                        <Icon.Loader size="xs" spin />
                      ) : (
                        <Icon.Refresh size="xs" />
                      )}
                      立即同步
                    </button>
                  </div>
                </div>
              </Section>

              <Section
                title="同步到滴答清单"
                desc="选择专注结束后的主同步去向；未同步与失败记录保留在本机。"
              >
                <div className="settings-sync-grid">
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
                    className={`settings-status-strip ${
                      didaFailedCount > 0
                        ? 'tone-danger'
                        : didaPendingCount > 0
                          ? 'tone-warning'
                          : 'tone-success'
                    }`}
                  >
                    <span className="settings-status-strip-icon">
                      {didaFailedCount > 0 ? (
                        <Icon.AlertCircle size="sm" />
                      ) : (
                        <Icon.CheckCircleFilled size="sm" />
                      )}
                    </span>
                    <div className="settings-status-strip-copy">
                      <p className="settings-status-strip-title">{didaQueueTitle}</p>
                      <p className="settings-status-strip-desc">
                        {didaNeedsAttention === 0
                          ? '专注记录已同步到滴答清单'
                          : '记录保留在本机，不会丢失专注数据'}
                      </p>
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
                title="番茄 To-do 同步"
                desc="专注结束后先安全写入本地；待上传记录由你按需连接并上传。"
              >
                <Row label="启用番茄 To-do 同步" desc="自动匹配六大学科；未识别时使用下方默认分类">
                  <Toggle
                    label="启用番茄 To-do 同步"
                    checked={settings.tomatodo.enabled}
                    onChange={(v) => update({ tomatodo: { ...settings.tomatodo, enabled: v } })}
                  />
                </Row>
                {settings.tomatodo.enabled && (
                  <>
                    <Row label="未识别时归类">
                      <SelectMenu
                        label="未识别时归类"
                        value={settings.tomatodo.defaultSubject}
                        options={TOMATODO_SUBJECT_VALUES}
                        onChange={(subject) =>
                          update({
                            tomatodo: {
                              ...settings.tomatodo,
                              defaultSubject: subject as AppSettings['tomatodo']['defaultSubject'],
                            },
                          })
                        }
                      />
                    </Row>
                    <details className="settings-disclosure mt-2.5">
                      <summary className="motion-press">高级：自定义数据库路径</summary>
                      <div>
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
                      className={`settings-status-strip ${
                        tomatodoPendingError ||
                        tomatodoBridge?.state === 'launch-failed' ||
                        tomatodoBridge?.state === 'launch-timeout'
                          ? 'tone-danger'
                          : tomatodoBridge?.state === 'restart-required' || tomatodoPending > 0
                            ? 'tone-warning'
                            : tomatodoBridge?.connected
                              ? 'tone-success'
                              : ''
                      }`}
                      aria-live="polite"
                    >
                      <span className="settings-status-strip-icon">
                        {tomatodoPendingError ||
                        tomatodoBridge?.state === 'launch-failed' ||
                        tomatodoBridge?.state === 'launch-timeout' ? (
                          <Icon.AlertCircle size="sm" />
                        ) : (
                          <Icon.Upload size="sm" />
                        )}
                      </span>
                      <div className="settings-status-strip-copy">
                        <p className="settings-status-strip-title">
                          {tomatodoPendingError
                            ? '无法读取待上传记录'
                            : tomatodoPending > 0
                              ? `${tomatodoPending} 条待上传`
                              : '当前无待上传记录'}
                          <span className={`settings-status-badge ${tomatodoBadge.tone}`}>
                            {tomatodoBadge.label}
                          </span>
                        </p>
                        <p className="settings-status-strip-desc">
                          {tomatodoPendingError
                            ? '检查数据库路径或番茄 To-do 文件权限后重试'
                            : tomatodoBridgeLabel}
                        </p>
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
              <Section
                title="关于 FocusLink"
                desc="全局快捷键驱动的专注计时器 + 滴答清单任务关联工具"
              >
                <Row label="当前版本">
                  <span className="settings-version-chip text-diag">v{APP_VERSION}</span>
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
  const tone =
    state.tone === 'ok'
      ? 'tone-success'
      : state.tone === 'warn'
        ? 'tone-warning'
        : state.tone === 'error'
          ? 'tone-danger'
          : 'tone-neutral';
  return (
    <span className={`settings-status-badge ${tone}`} title={state.title}>
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
        <h3>{title}</h3>
        {desc ? <p>{desc}</p> : null}
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
    <div className="settings-row">
      <div className="settings-row-label">
        <span className="settings-row-title">{label}</span>
        {desc ? <span className="settings-row-desc">{desc}</span> : null}
      </div>
      <div className="settings-row-control">{children}</div>
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
      className={`motion-press choice-btn ${active ? 'active' : ''} ${
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

/**
 * 42×24 开关：完全受控（checked 来自全局 settings，无本地状态），
 * 状态写入统一走 update() 乐观更新 + 服务端校正，因此不会出现
 * 「首次显示正常、后续状态失效」的受控失配；disabled 时停止一切动态。
 */
function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled || undefined}
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

/**
 * 下拉菜单：触发按钮 + .motion-popover 弹层（动画契约见 motion.css，
 * 样式为 settings 局部专属，已在 settings.css 注明归口）。
 * 支持点击外部 / Escape 关闭、上下方向键移动焦点、Enter 选择。
 */
function SelectMenu({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // 点击菜单外部时关闭
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // 打开时把焦点放到当前选中项，保证键盘可立即操作
  useEffect(() => {
    if (!open) return;
    rootRef.current
      ?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
      ?.focus();
  }, [open]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div className="settings-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="settings-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="settings-select-value">{value}</span>
        <Icon.ChevronDown size="xs" className={`settings-select-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div
          className="settings-select-menu motion-popover"
          role="listbox"
          aria-label={label}
          style={{ '--popover-origin': 'top right' } as React.CSSProperties}
          onKeyDown={handleMenuKeyDown}
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              className={`settings-select-option ${option === value ? 'active' : ''}`}
              onClick={() => {
                onChange(option);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <span>{option}</span>
              {option === value && <Icon.Check size="xs" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 危险操作二次确认按钮：第一次点击进入待确认态（.btn-pause 红色实心），
 * 3.2s 内再次点击才真正执行，失焦或超时自动还原。
 */
function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  icon,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  icon?: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const disarm = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setArmed(false);
  };

  const handleClick = () => {
    if (!armed) {
      setArmed(true);
      timerRef.current = setTimeout(() => setArmed(false), 3200);
      return;
    }
    disarm();
    void onConfirm();
  };

  return (
    <button
      type="button"
      className={`${armed ? 'btn-pause' : 'btn-outline'} text-xs`}
      aria-live="polite"
      onClick={handleClick}
      onBlur={disarm}
    >
      {icon}
      {armed ? confirmLabel : label}
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
