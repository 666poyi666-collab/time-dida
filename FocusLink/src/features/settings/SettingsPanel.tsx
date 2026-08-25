// 设置页 - 紧凑分组列表：左侧分组导航 + 右侧连续行列表。
// FocusLink 只有一套视觉语言；外观只切换 light/dark/system。
// 强调色贯穿全部界面与专注状态；暂停保持红色。
// - 开关统一 42×24px，关闭态有清楚边界，disabled 可识别；
// - 语义标签：已同步/未同步/同步失败仅用于同步队列；dida 描述为「同步到滴答清单」；
//   番茄 To-do 使用「已写入本地/待上传/上传已确认」。
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../app/store';
import { ipcErrorMessage } from '../../app/ipcError';
import type { AppSettings } from '@shared/types';
import type {
  DeviceSyncManagedDevice,
  DeviceSyncStatus,
  TomatodoBridgeStatus,
} from '@shared/ipc/api';
import { APP_VERSION } from '@shared/version';
import { normalizeFocusLinkPairingCode } from '@shared/sync/pairingProtocol';
import { resolveFontProfile, resolveTimerStyle } from '@shared/theme';
import { motion } from 'framer-motion';
import { Icon } from '../../ui/Icon';
import { TimerDial } from '../focus/TimerDial';
import { presentDeviceSyncError } from './deviceSyncStatusPresentation';
import '../../styles/settings-motion.css';

const HOTKEY_LABELS: Record<keyof AppSettings['hotkeys'], string> = {
  toggleTimer: '开始 / 暂停 / 继续',
  stopTimer: '结束当前专注',
  toggleWindow: '打开 / 隐藏主窗口',
  linkTask: '快速关联任务',
  toggleMiniWindow: '显示 / 隐藏专注小窗',
};

/**
 * 分组按「用户此刻在想什么」划分，而不是按实现模块。
 *
 * 旧结构把外观、字体、小窗、快捷键、开机自启、关于全都堆进「界面与体验」，
 * 同时把滴答清单拆成两半——「怎么连」在连接页、「同步什么」在同步页，
 * 而这两件事用户是一起想的。
 */
const TABS = [
  { id: 'appearance', label: '外观', icon: Icon.Palette },
  { id: 'focus', label: '专注', icon: Icon.Timer },
  { id: 'hotkeys', label: '快捷键', icon: Icon.Keyboard },
  { id: 'integrations', label: '连接与同步', icon: Icon.Link },
  { id: 'devices', label: '跨设备', icon: Icon.Cloud },
  { id: 'system', label: '系统', icon: Icon.Settings },
] as const;

type SettingsTabId = (typeof TABS)[number]['id'];

/** 需要实时状态轮询的分组：滴答队列、番茄连接、跨设备状态都在这两页。 */
const LIVE_STATUS_TABS: ReadonlySet<string> = new Set<SettingsTabId>(['integrations', 'devices']);

type SettingsSection = {
  id: string;
  tab: SettingsTabId;
  title: string;
  desc?: string;
  /** 搜索用的额外词条：同义词、英文名、以及分区内具体条目的名字。 */
  keywords: string;
  render: () => React.ReactNode;
};

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
  { id: 'counter', label: '滚筒计数器', note: '里程表滚筒 · 逐位垂直进位' },
  { id: 'analog', label: '指针表圈', note: '60 刻度表圈 · 秒针擒纵步进' },
  { id: 'vernier', label: '游标标尺', note: '滑动秒刻度带 · 线性擒纵' },
  { id: 'draft', label: '制图描线', note: '描边空心数字 · 网格与尺寸标注' },
] as const satisfies ReadonlyArray<{
  id: AppSettings['timerStyle'];
  label: string;
  note: string;
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
  const [activeTab, setActiveTab] = useState<SettingsTabId>('appearance');
  const [search, setSearch] = useState('');
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyRegistrationStatus | null>(null);
  const [tomatodoPending, setTomatodoPending] = useState<number>(0);
  const [tomatodoPendingError, setTomatodoPendingError] = useState<string | null>(null);
  const [tomatodoBridge, setTomatodoBridge] = useState<TomatodoBridgeStatus | null>(null);
  const [tomatodoUploading, setTomatodoUploading] = useState(false);
  const [didaSyncRunning, setDidaSyncRunning] = useState(false);
  const [deviceSyncStatus, setDeviceSyncStatus] = useState<DeviceSyncStatus | null>(null);
  const [deviceSyncSaving, setDeviceSyncSaving] = useState(false);
  const [deviceSyncRunning, setDeviceSyncRunning] = useState(false);
  const [managedDevices, setManagedDevices] = useState<DeviceSyncManagedDevice[]>([]);
  const [devicePairingCode, setDevicePairingCode] = useState('');
  const [devicePairingOffer, setDevicePairingOffer] = useState<{
    code: string;
    expiresAt: number;
  } | null>(null);
  const [devicePairingRemaining, setDevicePairingRemaining] = useState(0);
  const [devicePairingCopied, setDevicePairingCopied] = useState(false);
  const devicePairingAutoAttemptRef = useRef('');
  useEffect(() => {
    if (!devicePairingOffer) {
      setDevicePairingRemaining(0);
      setDevicePairingCopied(false);
      return;
    }
    const update = () => {
      const remaining = Math.max(0, Math.ceil((devicePairingOffer.expiresAt - Date.now()) / 1_000));
      setDevicePairingRemaining(remaining);
      if (remaining === 0) setDevicePairingOffer(null);
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [devicePairingOffer]);
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

  // 搜索会把任意分组的状态条拉到眼前，因此搜索期间也必须保持轮询，
  // 否则搜出来的「同步队列」「番茄连接」显示的是进入设置页那一刻的旧状态。
  const needsLiveStatus = LIVE_STATUS_TABS.has(activeTab) || search.trim().length > 0;
  useEffect(() => {
    if (!needsLiveStatus) return;
    void refreshSyncState();
    const interval = setInterval(() => void refreshSyncState(), 5000);
    return () => clearInterval(interval);
    // refreshSyncState 读取当前渲染闭包；切换 Tab 时重建轮询即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsLiveStatus]);

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
      const status = await window.focuslink.deviceSync.status();
      setDeviceSyncStatus(status);
      if (status.signedIn) {
        try {
          setManagedDevices(await window.focuslink.deviceSync.listDevices());
        } catch {
          setManagedDevices([]);
        }
      } else {
        setManagedDevices([]);
      }
    } catch {
      setDeviceSyncStatus((current) =>
        current
          ? {
              ...current,
              running: false,
              lastError: 'sync_failed',
            }
          : null,
      );
    }
  };

  const handleRevokeDevice = async (device: DeviceSyncManagedDevice) => {
    if (device.deviceId === deviceSyncStatus?.deviceId) {
      addToast('不能从设备列表删除当前设备，请使用退出登录', 'info');
      return;
    }
    if (!window.confirm(`删除“${device.displayName}”？它将停止访问 FocusLink 同步。`)) return;
    setDeviceSyncSaving(true);
    try {
      await window.focuslink.deviceSync.revokeDevice(device.deviceId);
      setManagedDevices((current) => current.filter((item) => item.deviceId !== device.deviceId));
      addToast('设备已删除，后续同步已停止', 'success');
    } catch (error) {
      addToast(`删除设备失败：${ipcErrorMessage(error)}`, 'error');
    } finally {
      setDeviceSyncSaving(false);
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

  const handleDeviceSyncLogin = async () => {
    setDeviceSyncSaving(true);
    try {
      const result = await window.focuslink.deviceSync.login();
      setDeviceSyncStatus(result.status);
      setSettings(await window.focuslink.settings.get());
      if (result.syncError) {
        addToast('账号已登录；本机记录会在网络恢复后自动同步', 'info');
      } else if ((result.sync?.unresolvedConflicts ?? 0) > 0) {
        addToast('账号已登录；现有差异记录已安全保留', 'info');
      } else {
        addToast('登录成功，云同步已开启', 'success');
      }
    } catch (error) {
      addToast(`登录失败：${ipcErrorMessage(error)}`, 'error');
      await refreshDeviceSyncStatus();
    } finally {
      setDeviceSyncSaving(false);
    }
  };

  const handleDeviceSyncLogout = async () => {
    setDeviceSyncSaving(true);
    try {
      setDeviceSyncStatus(await window.focuslink.deviceSync.logout());
      setSettings(await window.focuslink.settings.get());
      addToast('已退出 FocusLink 账号；本机记录仍保留', 'success');
    } catch (error) {
      addToast(`退出失败：${ipcErrorMessage(error)}`, 'error');
    } finally {
      setDeviceSyncSaving(false);
    }
  };

  const handleCreateDevicePairingCode = async () => {
    setDeviceSyncSaving(true);
    try {
      const offer = await window.focuslink.deviceSync.createPairingCode();
      setDevicePairingOffer(offer);
      addToast('配对码已生成，10 分钟内在新设备输入', 'success');
    } catch (error) {
      addToast(`生成配对码失败：${ipcErrorMessage(error)}`, 'error');
    } finally {
      setDeviceSyncSaving(false);
    }
  };

  const handleRedeemDevicePairingCode = async (inputValue = devicePairingCode) => {
    const code = normalizeFocusLinkPairingCode(inputValue);
    if (!/^\d{8}$/.test(code)) {
      addToast('请输入 8 位数字配对码', 'info');
      return;
    }
    setDeviceSyncSaving(true);
    try {
      const result = await window.focuslink.deviceSync.redeemPairingCode(code);
      setDeviceSyncStatus(result.status);
      setSettings(await window.focuslink.settings.get());
      setDevicePairingCode('');
      devicePairingAutoAttemptRef.current = '';
      addToast(
        result.syncError ? '设备已加入同步，网络恢复后会继续同步' : '设备已加入多端同步',
        result.syncError ? 'info' : 'success',
      );
    } catch (error) {
      addToast(`配对失败：${ipcErrorMessage(error)}`, 'error');
      await refreshDeviceSyncStatus();
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
      addToast(`跨设备同步失败：${ipcErrorMessage(error)}`, 'error');
      await refreshDeviceSyncStatus();
    } finally {
      setDeviceSyncRunning(false);
    }
  };

  const handleRunDidaSync = async () => {
    setDidaSyncRunning(true);
    try {
      // `runPending` 只处理 status=pending 的队列项。达到重试上限后，
      // 项目会持久化为 failed；若只调用 runPending，点击“立即重试”
      // 看起来就像没有任何反应（典型表现是几十条失败记录始终不变）。
      // 每次手动重试前先读取主进程中的最新队列并逐项恢复失败项，
      // 避免依赖可能已经过期的 React 状态快照。
      const latestQueue = await window.focuslink.sync.list();
      const failedItems = latestQueue.filter((item) => item.status === 'failed');
      if (failedItems.length > 0) {
        await Promise.all(failedItems.map((item) => window.focuslink.sync.retry(item.id)));
      }
      const result = await window.focuslink.sync.runPendingNow();
      await refreshSyncState();
      if (result.failed > 0) {
        addToast(`${result.failed} 条同步失败，请检查连接页诊断`, 'error');
      } else if (result.processed === 0 && failedItems.length > 0) {
        // 例如仅本地模式或限流冷却：队列已经成功恢复为 pending，
        // 但本轮暂未实际发起远端请求。明确告知用户而非显示“没有未同步记录”。
        addToast(`已恢复 ${failedItems.length} 条失败记录，等待连接恢复后自动重试`, 'info');
      } else if (result.succeeded > 0) {
        addToast(`已同步 ${result.succeeded} 条记录到滴答清单`, 'success');
      } else {
        addToast('当前没有未同步的滴答记录', 'info');
      }
    } catch (error) {
      addToast(`同步到滴答清单失败：${ipcErrorMessage(error)}`, 'error');
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

  const bringMiniWindowToFront = async () => {
    try {
      const topmost = await window.focuslink.mini.bringToFront();
      addToast(
        topmost ? '专注小窗已置于最顶层' : '小窗层级未确认，请重试',
        topmost ? 'success' : 'error',
      );
    } catch (error) {
      addToast(`无法置顶专注小窗：${ipcErrorMessage(error)}`, 'error');
    }
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

  // 三态：还没探测完 / 探测到了 / 确认没有。中性色专门留给「还不知道」。
  const cliDetectTone =
    cliDetected === null ? 'tone-neutral' : cliDetected.found ? 'tone-success' : 'tone-warning';

  // 分区外框由注册表统一渲染，这里只提供内容。
  const oauthConnectionBody = (
    <>
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
    </>
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
  const deviceSyncError = presentDeviceSyncError(
    deviceSyncStatus?.lastError,
    deviceSyncStatus?.unresolvedConflicts,
  );

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

  // ---- 分区注册表 ----------------------------------------------------------
  // 每个分区在这里定义且只定义一次：所属分组、搜索词条、内容渲染函数。
  // 旧结构把同一个 tab 的内容拆成 5 段 JSX 与别的 tab 交错排布，新增一个分区
  // 得在五处里挑一处插入，先后顺序也无从判断；注册表让数组顺序就是呈现顺序。
  const sections: SettingsSection[] = [
    {
      id: 'theme',
      tab: 'appearance',
      title: '外观',
      desc: '亮色优先设计；深色沿用同一套结构与状态语义。',
      keywords: '主题 模式 深色 夜间 黑暗 浅色 明亮 亮色 跟随系统 theme dark light',
      render: () => (
        <Row label="外观模式" desc="切换后主窗口与跟随主题的小窗会立即更新">
          <div className="settings-theme-choices">
            <ChoiceBtn
              active={settings.theme === 'light'}
              onClick={() => update({ theme: 'light' })}
            >
              <Icon.Sun size="xs" />
              明亮
            </ChoiceBtn>
            <ChoiceBtn active={settings.theme === 'dark'} onClick={() => update({ theme: 'dark' })}>
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
      ),
    },
    {
      id: 'visual',
      tab: 'appearance',
      title: '界面与读数',
      desc: '字体、强调色与计时读数各自独立选择；暂停始终使用红色语义。',
      keywords:
        '字体 界面字体 文楷 致宋 漫黑 晰黑 得意黑 无衬线 强调色 主题色 配色 翡翠 钴蓝 鸢尾 琥珀 石墨 ' +
        '计时仪表 读数 样式 翻页 像素 七段 数码 衬线 font accent color timer style',
      render: () => (
        <div className="settings-visual-groups">
          <div className="settings-choice-group settings-choice-group-wide">
            <div className="settings-choice-heading">
              <strong>界面字体</strong>
              <span>应用于正文、任务与设置；计时数字保留各仪表自己的字形。</span>
            </div>
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
          </div>

          <div className="settings-choice-group settings-choice-group-inline">
            <div className="settings-choice-heading">
              <strong>全局强调色</strong>
              <span>同步应用到导航、操作、选中态、统计、专注读数与时间之带。</span>
            </div>
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
          </div>

          <div className="settings-choice-group settings-choice-group-wide">
            <div className="settings-choice-heading">
              <strong>计时仪表</strong>
              <span>只改变主计时读数；每种样式使用固定尺寸的真实预览。</span>
            </div>
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
          </div>

          <div className="settings-choice-group settings-choice-group-inline">
            <div className="settings-choice-heading">
              <strong>状态语义</strong>
              <span>操作与专注跟随强调色，暂停始终保持警示红。</span>
            </div>
            <div className="settings-state-colors">
              <span className="interface">操作 · 当前强调色</span>
              <span className="focus">专注 · 当前强调色</span>
              <span className="pause">暂停 · 红</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'mini-window',
      tab: 'focus',
      title: '专注小窗',
      desc: '主题、透明度、显示策略和手动收纳控制',
      keywords:
        '小窗 悬浮窗 迷你 浮窗 透明度 不透明 自动显示 自动隐藏 托盘 mini window opacity float',
      render: () => (
        <>
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
          <Row
            label="窗口层级"
            desc="小窗被其他窗口遮挡时，可在不改变位置与收纳状态的前提下重新置顶"
          >
            <button
              type="button"
              className="btn-outline text-[11px]"
              onClick={() => void bringMiniWindowToFront()}
            >
              置于最顶层
            </button>
          </Row>
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
          <Row label="主窗口隐藏时自动显示小窗" desc="主窗口最小化或隐藏到托盘时，自动弹出专注小窗">
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
        </>
      ),
    },
    {
      id: 'hotkeys',
      tab: 'hotkeys',
      title: '全局快捷键',
      desc: '点击捕获新组合键；冲突时会提示并保留旧快捷键',
      keywords:
        '快捷键 热键 组合键 全局 按键 开始 暂停 继续 结束 关联任务 显示小窗 恢复默认 ' +
        'hotkey shortcut accelerator keybinding',
      render: () => (
        <>
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
        </>
      ),
    },
    // FocusLink is the task product. Provider adapters stay opt-in and out of the main workspace.
    {
      id: 'dida-connection',
      tab: 'integrations',
      title: '任务来源与导入',
      desc: '默认使用 FocusLink 自有任务库；需要时再从第三方导入。',
      keywords:
        '滴答 滴答清单 ticktick dida cli 命令行 探测 检测 自检 可执行文件 路径 模板 超时 ' +
        '任务来源 provider executable',
      render: () => (
        <>
          <div className="settings-provider-list">
            <SyncModeChoice
              active={settings.taskSource === 'local'}
              onClick={() => update({ taskSource: 'local', syncMode: 'local-only' })}
              icon={<Icon.ListChecks size="md" />}
              title="FocusLink 任务库"
              badge="默认"
              desc="任务、清单和层级都保存在 FocusLink 中"
            />
          </div>

          <details
            className="settings-disclosure settings-external-task-disclosure"
            open={settings.taskSource !== 'local'}
          >
            <summary className="motion-press">外部任务导入</summary>
            <div className="settings-provider-list mt-3">
              <SyncModeChoice
                active={settings.taskSource === 'ticktick-cli'}
                onClick={() => update({ taskSource: 'ticktick-cli' })}
                icon={<Icon.Link size="md" />}
                title="滴答 CLI"
                desc="按需读取本机 CLI，导入后仍归 FocusLink 管理"
              />
              <SyncModeChoice
                active={settings.taskSource === 'ticktick-oauth'}
                onClick={() => update({ taskSource: 'ticktick-oauth' })}
                icon={<Icon.Cloud size="md" />}
                title="TickTick OAuth"
                desc="仅在 CLI 不可用时使用开发者应用"
              />
            </div>
          </details>

          {settings.taskSource === 'ticktick-cli' && (
            <div className="settings-provider-status">
              <div className="settings-provider-status-head">
                <div className="settings-provider-status-title">
                  <span className={`settings-provider-status-icon ${cliDetectTone}`}>
                    {cliDetected === null ? (
                      <Icon.Loader size="sm" spin />
                    ) : cliDetected.found ? (
                      <Icon.CheckCircleFilled size="sm" />
                    ) : (
                      <Icon.AlertCircle size="sm" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[12.5px] font-semibold text-fg">
                      滴答 CLI 连接
                      <span className={`settings-status-badge ${cliDetectTone}`}>
                        {cliDetected === null ? '检测中' : cliDetected.found ? '已连接' : '未连接'}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-fg-subtle">
                      {cliDetected === null
                        ? '正在探测本机可用的 dida 命令'
                        : cliDetected.found
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
                    <span className="ml-2 font-normal text-fg-subtle">仅在自动探测失败时调整</span>
                  </span>
                  <Icon.ChevronDown size="xs" tone="subtle" className="settings-provider-chevron" />
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
          )}
        </>
      ),
    },
    {
      id: 'device-sync',
      tab: 'devices',
      title: '手机 / 平板同步',
      desc: '电脑、手机和平板直接连接同一云端账号；电脑关闭不会中断移动端同步。',
      keywords: '手机 平板 安卓 android 移动端 跨设备 账号 登录 实时 云端 device sync account',
      render: () => (
        <>
          {!deviceSyncStatus?.signedIn && (
            <ol className="settings-pairing-steps" aria-label="配对步骤">
              <li>
                <b>1</b>
                <span>已授权设备打开多端同步</span>
              </li>
              <li>
                <b>2</b>
                <span>点“添加设备”生成 8 位码</span>
              </li>
              <li>
                <b>3</b>
                <span>在本机输入，任务/实时/账本自动同步</span>
              </li>
            </ol>
          )}
          <Row
            label="FocusLink 设备授权"
            desc="本机功能不依赖登录；授权后才把任务、专注和统计同步到其他设备"
          >
            {deviceSyncStatus?.signedIn ? (
              <div className="flex items-center gap-2">
                <span className="settings-status-badge tone-success">
                  {deviceSyncStatus.accountLabel ?? '已登录'}
                </span>
                <button
                  type="button"
                  className="btn-accent text-[11px]"
                  onClick={() => void handleCreateDevicePairingCode()}
                  disabled={deviceSyncSaving}
                >
                  {deviceSyncSaving ? <Icon.Loader size="xs" spin /> : <Icon.Plus size="xs" />}
                  添加设备
                </button>
                <button
                  type="button"
                  className="btn-outline text-[11px]"
                  onClick={() => void handleDeviceSyncLogout()}
                  disabled={deviceSyncSaving}
                >
                  退出登录
                </button>
              </div>
            ) : (
              <div className="settings-pairing-entry">
                <input
                  value={devicePairingCode}
                  onChange={(event) => {
                    const next = normalizeFocusLinkPairingCode(event.target.value);
                    if (!/^\d{0,8}$/.test(next)) return;
                    setDevicePairingCode(next);
                    if (next.length < 8) devicePairingAutoAttemptRef.current = '';
                    if (
                      next.length === 8 &&
                      devicePairingAutoAttemptRef.current !== next &&
                      !deviceSyncSaving
                    ) {
                      devicePairingAutoAttemptRef.current = next;
                      void handleRedeemDevicePairingCode(next);
                    }
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={9}
                  placeholder="1234 5678"
                  aria-label="8 位设备配对码"
                  aria-describedby="focuslink-desktop-pairing-hint"
                />
                <span id="focuslink-desktop-pairing-hint" className="settings-pairing-hint">
                  粘贴带空格的配对码，输入完整后自动加入同步
                </span>
                <button
                  type="button"
                  className="btn-accent text-[11px]"
                  onClick={() => void handleRedeemDevicePairingCode()}
                  disabled={deviceSyncSaving || devicePairingCode.length !== 8}
                >
                  {deviceSyncSaving ? <Icon.Loader size="xs" spin /> : <Icon.Link size="xs" />}
                  加入同步
                </button>
              </div>
            )}
          </Row>
          {deviceSyncStatus?.signedIn && devicePairingOffer && (
            <div className="settings-pairing-offer" role="status" aria-live="polite">
              <div>
                <span>在新设备输入</span>
                <strong aria-label={`配对码 ${devicePairingOffer.code}`}>
                  {devicePairingOffer.code.slice(0, 4)} {devicePairingOffer.code.slice(4)}
                </strong>
              </div>
              <p>
                一次性使用 · 剩余 {Math.floor(devicePairingRemaining / 60)}:
                {String(devicePairingRemaining % 60).padStart(2, '0')}
              </p>
              <button
                type="button"
                className="btn-outline text-[11px]"
                onClick={() => {
                  const copy = navigator.clipboard?.writeText(devicePairingOffer.code);
                  if (!copy) return;
                  void copy
                    .then(() => {
                      setDevicePairingCopied(true);
                      window.setTimeout(() => setDevicePairingCopied(false), 1_500);
                    })
                    .catch(() => setDevicePairingCopied(false));
                }}
              >
                {devicePairingCopied ? '已复制' : '复制配对码'}
              </button>
            </div>
          )}
          {deviceSyncStatus?.signedIn && managedDevices.length > 0 && (
            <div className="settings-device-roster" aria-label="已配对设备">
              <div className="settings-device-roster-heading">
                <strong>已配对设备</strong>
                <span>{managedDevices.length} 台</span>
              </div>
              {managedDevices.map((device) => (
                <div className="settings-device-row" key={device.deviceId}>
                  <div>
                    <strong>{device.displayName}</strong>
                    <span>
                      {device.deviceId === deviceSyncStatus.deviceId
                        ? '此设备'
                        : (device.deviceKind ?? '设备')}
                      {device.stale ? ' · 久未同步' : ' · 最近在线'}
                    </span>
                  </div>
                  {device.deviceId === deviceSyncStatus.deviceId ? (
                    <span className="settings-status-badge tone-success">当前</span>
                  ) : (
                    <button
                      type="button"
                      className="btn-outline text-[11px]"
                      onClick={() => void handleRevokeDevice(device)}
                      disabled={deviceSyncSaving}
                    >
                      删除设备
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!deviceSyncStatus?.signedIn && (
            <div className="settings-account-explainer">
              <strong>没有配对码？</strong>
              <p>在另一台已加入 FocusLink 同步的设备中选择“添加设备”，生成一次性配对码。</p>
              <button
                type="button"
                className="btn-outline text-[11px]"
                onClick={() => void handleDeviceSyncLogin()}
                disabled={deviceSyncSaving}
              >
                首台设备或恢复账号
              </button>
            </div>
          )}
          <div
            className={`settings-status-strip ${
              deviceSyncError
                ? deviceSyncError.tone === 'warning'
                  ? 'tone-warning'
                  : 'tone-danger'
                : deviceSyncStatus?.lastSyncAt
                  ? 'tone-success'
                  : deviceSyncStatus?.configured
                    ? 'tone-warning'
                    : ''
            }`}
            aria-live="polite"
          >
            <span className="settings-status-strip-icon">
              {deviceSyncError?.tone === 'danger' ? (
                <Icon.AlertCircle size="sm" />
              ) : (
                <Icon.Cloud size="sm" />
              )}
            </span>
            <div className="settings-status-strip-copy">
              <p className="settings-status-strip-title">
                {deviceSyncError
                  ? deviceSyncError.title
                  : deviceSyncStatus?.lastSyncAt
                    ? '账本已完成跨设备同步'
                    : deviceSyncStatus?.configured
                      ? '连接已配置，等待首次同步'
                      : deviceSyncStatus?.signedIn
                        ? '账号已登录，等待首次同步'
                        : '登录后开启云同步'}
                <span
                  className={`settings-status-badge ${
                    deviceSyncStatus?.enabled ? 'tone-success' : 'tone-neutral'
                  }`}
                >
                  {deviceSyncStatus?.enabled ? '已启用' : '未启用'}
                </span>
              </p>
              <p className="settings-status-strip-desc">
                {deviceSyncError?.kind === 'conflict-present'
                  ? `${deviceSyncStatus?.unresolvedConflicts ?? 0} 条记录存在设备间差异，已安全保留，不会自动覆盖`
                  : deviceSyncError
                    ? (deviceSyncError.detail ?? '同步状态等待确认')
                    : deviceSyncStatus?.liveControlEnabled
                      ? deviceSyncStatus.liveConnected
                        ? `实时连接已确认 · rev ${deviceSyncStatus.liveRevision ?? 0} · ${deviceSyncStatus.liveState}${deviceSyncStatus.lastSyncAt ? ` · 上次账本同步：${new Date(deviceSyncStatus.lastSyncAt).toLocaleString('zh-CN')}` : ''}`
                        : `实时连接未确认；${deviceSyncStatus.lastSyncAt ? `上次账本同步：${new Date(deviceSyncStatus.lastSyncAt).toLocaleString('zh-CN')} · ` : ''}本机计时仍可使用，第三方凭据与本地路径不会上传`
                      : deviceSyncStatus?.lastSyncAt
                        ? `上次同步：${new Date(deviceSyncStatus.lastSyncAt).toLocaleString('zh-CN')}`
                        : deviceSyncStatus?.signedIn
                          ? '账号已登录，等待首次同步；本机计时不受网络影响'
                          : '登录后自动同步专注状态、任务和历史记录'}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="btn-outline text-[11px]"
                onClick={() => void refreshDeviceSyncStatus()}
                disabled={deviceSyncSaving}
              >
                {deviceSyncSaving ? <Icon.Loader size="xs" spin /> : <Icon.Refresh size="xs" />}
                刷新状态
              </button>
              <button
                type="button"
                className="btn-accent text-[11px]"
                onClick={handleRunDeviceSync}
                disabled={
                  deviceSyncRunning || !settings.deviceSync.enabled || !deviceSyncStatus?.signedIn
                }
              >
                {deviceSyncRunning ? <Icon.Loader size="xs" spin /> : <Icon.Refresh size="xs" />}
                立即同步
              </button>
            </div>
          </div>
        </>
      ),
    },
    {
      id: 'dida-sync',
      tab: 'integrations',
      title: '第三方同步去向',
      desc: '仅在你主动启用第三方任务适配器后使用；未同步与失败记录保留在本机。',
      keywords:
        '同步 去向 队列 未同步 同步失败 重试 云端专注 专注统计 任务评论 备注 仅本机 本地 ' +
        'sync mode comment focus-record local-only',
      render: () => (
        <>
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
                  {didaSyncRunning ? <Icon.Loader size="xs" spin /> : <Icon.Refresh size="xs" />}
                  立即重试
                </button>
              )}
            </div>
          )}
        </>
      ),
    },
    {
      id: 'dida-oauth',
      tab: 'integrations',
      title: 'TickTick OAuth（备用）',
      desc: 'dida CLI 不可用时再使用开发者应用连接；日常使用无需配置。',
      keywords:
        'oauth 开发者应用 client id secret 凭据 区域 海外 国内 回调 登录 断开 ticktick dida365',
      render: () => oauthConnectionBody,
    },
    {
      id: 'tomatodo',
      tab: 'integrations',
      title: '番茄 To-do 同步',
      desc: '专注结束后先安全写入本地；待上传记录由你按需连接并上传。',
      keywords:
        '番茄 tomatodo to-do 待上传 上传 桥接 连接 学科 语文 数学 英语 物理 化学 生物 学习 ' +
        '数据库 路径 dbPath',
      render: () => (
        <>
          <Row label="启用番茄 To-do 同步" desc="自动匹配六大学科；未识别时固定归入学习">
            <Toggle
              label="启用番茄 To-do 同步"
              checked={settings.tomatodo.enabled}
              onChange={(v) => update({ tomatodo: { ...settings.tomatodo, enabled: v } })}
            />
          </Row>
          {settings.tomatodo.enabled && (
            <>
              <Row
                label="未识别时归类"
                desc="语文、数学、英语、物理、化学、生物可在片段明细中直接调整"
              >
                <span className="settings-fixed-value">学习</span>
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
        </>
      ),
    },
    {
      id: 'system',
      tab: 'system',
      title: '系统与后台运行',
      desc: '窗口关闭行为、托盘常驻与开机自启动。',
      keywords:
        '托盘 最小化 关闭 后台 常驻 隐藏 开机 自启动 开机启动 登录启动 tray minimize autostart startup',
      render: () => (
        <>
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
        </>
      ),
    },
    {
      id: 'about',
      tab: 'system',
      title: '关于 FocusLink',
      desc: 'FocusLink 自有任务、专注计时与多端账本工作台',
      keywords: '关于 版本 version about 更新',
      render: () => (
        <Row label="当前版本">
          <span className="settings-version-chip text-diag">v{APP_VERSION}</span>
        </Row>
      ),
    },
  ];

  const availableSections = sections.filter((section) => {
    if (section.id === 'dida-sync') return settings.taskSource !== 'local';
    if (section.id === 'dida-oauth') return settings.taskSource === 'ticktick-oauth';
    return true;
  });
  const query = search.trim().toLowerCase();
  const searching = query.length > 0;
  // 搜索横跨全部分组：设置项藏在哪个分组是我们的分类结果，不该要求用户先猜对。
  const visibleSections = searching
    ? availableSections.filter((section) => sectionMatches(section, query))
    : availableSections.filter((section) => section.tab === activeTab);

  return (
    <div className="settings-page">
      {/* 工位横幅：当前分组身份 → 全局搜索（视图的主仪器） → 版本与外观诊断 */}
      <header className="settings-console view-console">
        <div className="console-identity">
          <span className="console-kicker">设置 · 控制面板</span>
          <span className="settings-console-word">
            {searching ? `搜索「${search.trim()}」` : TAB_LABELS[activeTab]}
          </span>
          <span className="settings-console-count">{visibleSections.length} 个分区</span>
        </div>
        <div className="console-readout">
          <div className={`settings-search ${searching ? 'active' : ''}`}>
            <Icon.Search size="sm" tone="subtle" />
            <input
              type="search"
              className="settings-search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSearch('');
              }}
              placeholder="搜索设置…（例如「自启动」「二维码」「字体」）"
              aria-label="搜索设置"
            />
            {searching ? (
              <>
                <span className="settings-search-count">{visibleSections.length} 项</span>
                <button
                  type="button"
                  className="settings-search-clear motion-press"
                  onClick={() => setSearch('')}
                  aria-label="清除搜索"
                >
                  <Icon.X size="xs" />
                </button>
              </>
            ) : null}
          </div>
        </div>
        <div className="console-actions">
          <span className="settings-console-diag text-diag">
            v{APP_VERSION} · {appearanceLabel}
          </span>
        </div>
      </header>

      <div className="settings-body">
        {/* 左侧分组导航：域名切换 */}
        <aside className="settings-nav">
          <nav className="settings-nav-list" role="tablist" aria-label="设置分类">
            {TABS.map((tab) => {
              const TabIcon = tab.icon;
              // 搜索期间结果横跨所有分组，此时高亮任何一个分组都是在说谎。
              const isActive = !searching && activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    setSearch('');
                    setActiveTab(tab.id);
                  }}
                  className={`settings-tab ${isActive ? 'active' : ''}`}
                >
                  {isActive ? (
                    <motion.span
                      layoutId="settings-tab-indicator"
                      className="settings-tab-indicator"
                      aria-hidden="true"
                      transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
                    />
                  ) : null}
                  <TabIcon size="sm" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* 分区规格表：编号分区，标题栏在左、内容在右 */}
        <div className="settings-scroll">
          <div className="settings-container settings-stack">
            {visibleSections.map((section, index) => (
              <Section
                key={section.id}
                index={index}
                title={section.title}
                desc={section.desc}
                group={searching ? TAB_LABELS[section.tab] : undefined}
              >
                {section.render()}
              </Section>
            ))}

            {searching && visibleSections.length === 0 ? (
              <div className="settings-empty">
                <Icon.Search size="md" tone="subtle" />
                <p className="settings-empty-title">没有匹配「{search.trim()}」的设置</p>
                <p className="settings-empty-desc">换一个更短的词，或直接在左侧分组里翻找。</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

const TAB_LABELS = Object.fromEntries(TABS.map((tab) => [tab.id, tab.label])) as Record<
  SettingsTabId,
  string
>;

/**
 * 多个词按「全部命中」处理：逐字缩小结果比逐字扩大更符合搜索直觉。
 * 匹配范围包含 keywords，因此「自启动」能搜到标题里没有这三个字的「系统与后台运行」。
 */
function sectionMatches(section: SettingsSection, query: string): boolean {
  const haystack =
    `${section.title} ${section.desc ?? ''} ${section.keywords} ${TAB_LABELS[section.tab]}`.toLowerCase();
  return query.split(/\s+/).every((term) => haystack.includes(term));
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
  index,
  title,
  desc,
  group,
  children,
}: {
  /** 分区在当前视图中的序号：规格表编号（01/02/…），随分组或搜索结果重排。 */
  index: number;
  title: string;
  desc?: string;
  /** 搜索结果里标出该分区平时住在哪个分组，方便下次直接去那里找。 */
  group?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <span className="settings-section-index timer-digit" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>
        <h3>
          {title}
          {group ? <span className="settings-section-group">{group}</span> : null}
        </h3>
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
 * 危险操作二次确认按钮：第一次点击进入待确认态（.btn-danger 深红实心），
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
      className={`${armed ? 'btn-danger' : 'btn-outline'} text-xs`}
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
