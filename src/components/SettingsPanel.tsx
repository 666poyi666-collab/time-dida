// 设置页 - 快捷键/主题/计时行为/任务来源/CLI/同步/滴答账号/系统
import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import type { AppSettings } from '@shared/types';
import { LogOut, Loader2, Beaker, Search, Stethoscope, Copy, ChevronDown, ChevronRight, Palette, Keyboard, ListChecks, Monitor, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

const HOTKEY_LABELS: Record<keyof AppSettings['hotkeys'], string> = {
  toggleTimer: '开始 / 暂停 / 继续',
  stopTimer: '结束当前专注',
  toggleWindow: '打开 / 隐藏主窗口',
  linkTask: '快速关联任务',
  toggleMiniWindow: '显示 / 隐藏专注小窗',
};

const ACCENTS = [
  { id: 'indigo', label: '薄荷绿', color: '#10b981' },
  { id: 'violet', label: '紫', color: '#8b5cf6' },
  { id: 'emerald', label: '深绿', color: '#059669' },
  { id: 'rose', label: '玫瑰', color: '#f43f5e' },
  { id: 'amber', label: '琥珀', color: '#f59e0b' },
  { id: 'sky', label: '天蓝', color: '#0ea5e9' },
];

const TABS = [
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'tasks', label: '任务', icon: ListChecks },
  { id: 'hotkeys', label: '快捷键', icon: Keyboard },
  { id: 'mini', label: '小窗', icon: Monitor },
  { id: 'sync', label: '同步', icon: RefreshCw },
  { id: 'about', label: '关于', icon: Stethoscope },
] as const;

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
  const { settings, setSettings, addToast, setTicktickStatus } = useStore();
  const [capturing, setCapturing] = useState<keyof AppSettings['hotkeys'] | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [region, setRegion] = useState<'ticktick' | 'dida365'>('dida365');
  const [loginLoading, setLoginLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [cliDetecting, setCliDetecting] = useState(false);
  const [cliDetected, setCliDetected] = useState<{ found: boolean; executable: string; helpOutput?: string } | null>(null);
  const [providerInfo, setProviderInfo] = useState<{
    providerType: 'dida' | 'ticktick' | 'unknown';
    executable: string;
    executablePath: string;
    hasStaleTicktickTemplates: boolean;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<string>('appearance');
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyRegistrationStatus | null>(null);

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
  }, []);

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

  const testCliList = async () => {
    try {
      const res = await window.focuslink.cli.listTasks();
      if (res.ok) {
        addToast(`CLI 读取成功，共 ${res.data.length} 个任务`, 'success');
      } else {
        addToast('CLI 读取失败：' + res.error, 'error');
      }
    } catch (e) {
      addToast('CLI 测试异常：' + (e as Error).message, 'error');
    }
  };

  if (!settings) return null;

  const update = async (partial: Partial<AppSettings>) => {
    const next = await window.focuslink.settings.set({ ...settings, ...partial });
    setSettings(next);
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
    };
    window.addEventListener('keydown', handler, true);
  };

  const applyHotkey = async (
    key: keyof AppSettings['hotkeys'],
    accelerator: string
  ) => {
    try {
      // setHotkey 现在返回 { settings, registration }，注册失败会保留旧快捷键
      const res = await window.focuslink.settings.setHotkey(key, accelerator);
      setSettings(res.settings);
      await refreshHotkeyStatus();
      if (res.registration.success) {
        addToast(`已设置：${accelerator}`, 'success');
      } else {
        addToast(
          `快捷键注册失败：${accelerator}（可能被其他软件占用，已保留旧快捷键）`,
          'error'
        );
      }
    } catch (e) {
      addToast('设置失败：' + (e as Error).message, 'error');
    }
  };

  const testHotkey = async (accelerator: string) => {
    const ok = await window.focuslink.hotkey.test(accelerator);
    if (ok) addToast(`测试通过：${accelerator} 可注册`, 'success');
    else addToast(`测试失败：${accelerator} 无法注册（冲突）`, 'error');
    await refreshHotkeyStatus();
    return ok;
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
      await window.focuslink.ticktick.login(clientId.trim(), clientSecret.trim(), region);
      setConnected(true);
      setTicktickStatus(true, region);
      addToast('滴答清单已连接', 'success');
    } catch (e) {
      addToast('登录失败：' + (e as Error).message, 'error');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await window.focuslink.ticktick.logout();
      setConnected(false);
      setTicktickStatus(false, region);
      addToast('已断开滴答清单', 'info');
    } catch (e) {
      addToast('失败：' + (e as Error).message, 'error');
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 标题 + Tab 栏 */}
      <div className="shrink-0 border-b border-border px-6 pb-4 pt-6">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-4 text-lg font-semibold">设置</h2>
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-bg-subtle/50 p-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
                    isActive
                      ? 'nav-active bg-accent text-white shadow-sm'
                      : 'text-fg-muted hover:bg-bg-subtle hover:text-fg'
                  }`}
                >
                  <Icon size={13} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {activeTab === 'appearance' && (
            <>
              {/* 外观 */}
              <Section title="外观">
                <Row label="主题">
                  <div className="flex gap-2">
                    <ChoiceBtn active={settings.theme === 'dark'} onClick={() => update({ theme: 'dark' })}>
                      深色
                    </ChoiceBtn>
                    <ChoiceBtn active={settings.theme === 'light'} onClick={() => update({ theme: 'light' })}>
                      浅色
                    </ChoiceBtn>
                  </div>
                </Row>
                <Row label="主题色">
                  <div className="flex gap-2">
                    {ACCENTS.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => update({ accentColor: a.id })}
                        className={`h-7 w-7 rounded-full border-2 transition-transform ${
                          settings.accentColor === a.id ? 'scale-110 border-fg shadow-soft' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: a.color }}
                        title={a.label}
                      />
                    ))}
                  </div>
                </Row>
              </Section>

            </>
          )}

          {activeTab === 'mini' && (
            <Section title="专注小窗" desc="主题、透明度、显示策略和手动收纳控制">
              <Row label="跟随主界面主题">
                <Toggle
                  checked={settings.miniWindow.followMainTheme}
                  onChange={(v) => update({ miniWindow: { ...settings.miniWindow, followMainTheme: v } })}
                />
              </Row>
              {!settings.miniWindow.followMainTheme && (
                <Row label="小窗主题">
                  <div className="flex gap-2">
                    <ChoiceBtn
                      active={settings.miniWindow.themeMode === 'system'}
                      onClick={() => update({ miniWindow: { ...settings.miniWindow, themeMode: 'system' } })}
                    >
                      跟随系统
                    </ChoiceBtn>
                    <ChoiceBtn
                      active={settings.miniWindow.themeMode === 'dark'}
                      onClick={() => update({ miniWindow: { ...settings.miniWindow, themeMode: 'dark' } })}
                    >
                      深色
                    </ChoiceBtn>
                    <ChoiceBtn
                      active={settings.miniWindow.themeMode === 'light'}
                      onClick={() => update({ miniWindow: { ...settings.miniWindow, themeMode: 'light' } })}
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
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    window.focuslink.mini.setOpacity(v);
                    update({ miniWindow: { ...settings.miniWindow, opacity: v } });
                  }}
                  className="w-48"
                />
              </Row>
              <Row label="贴边自动收纳" desc="当前保持关闭，避免窗口贴边时跳动或误收起">
                <Toggle
                  checked={false}
                  onChange={() => addToast('贴边自动收纳当前保持关闭，可使用手动收起模式', 'info')}
                />
              </Row>
              <Row label="主窗口隐藏时自动显示小窗" desc="主窗口最小化或隐藏到托盘时，自动弹出专注小窗">
                <Toggle
                  checked={settings.miniWindow.autoShowOnMainHide}
                  onChange={(v) => update({ miniWindow: { ...settings.miniWindow, autoShowOnMainHide: v } })}
                />
              </Row>
              <Row label="专注开始时自动显示小窗" desc="开始专注时若主窗口不在前台，自动显示小窗">
                <Toggle
                  checked={settings.miniWindow.autoShowOnFocusStart}
                  onChange={(v) => update({ miniWindow: { ...settings.miniWindow, autoShowOnFocusStart: v } })}
                />
              </Row>
              <Row label="专注结束后自动隐藏小窗" desc="专注结束时自动隐藏小窗（默认关）">
                <Toggle
                  checked={settings.miniWindow.autoHideOnFocusEnd}
                  onChange={(v) => update({ miniWindow: { ...settings.miniWindow, autoHideOnFocusEnd: v } })}
                />
              </Row>
              <Row label="当前尺寸">
                <span className="text-xs font-mono text-fg-muted">
                  {settings.miniWindow.width} × {settings.miniWindow.height}
                  {settings.miniWindow.collapsed && ' (已收起)'}
                </span>
              </Row>
              <div className="flex gap-2">
                <button
                  className="btn-outline text-xs"
                  onClick={() => {
                    window.focuslink.mini.collapse();
                  }}
                >
                  收起小窗
                </button>
                <button
                  className="btn-outline text-xs"
                  onClick={() => {
                    window.focuslink.mini.expand();
                  }}
                >
                  展开小窗
                </button>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => {
                    window.focuslink.mini.reset();
                    addToast('已恢复默认大小 300×132', 'success');
                  }}
                >
                  恢复默认大小
                </button>
              </div>
            </Section>
          )}

          {activeTab === 'hotkeys' && (
            <>
              {/* 快捷键 */}
              <Section title="全局快捷键" desc="点击捕获新组合键；冲突时会提示并保留旧快捷键">
                {(Object.keys(HOTKEY_LABELS) as HotkeyKey[]).map((key) => {
                  const status = getHotkeyBadgeState(key, settings.hotkeys[key], hotkeyStatus);
                  const activeAccelerator = hotkeyStatus?.registered[key]?.accelerator ?? null;
                  const activeDiffers = !!activeAccelerator && activeAccelerator !== settings.hotkeys[key];
                  return (
                    <Row key={key} label={HOTKEY_LABELS[key]}>
                      <div className="flex min-w-[260px] flex-col items-end gap-1.5">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            className="btn-outline min-w-[180px] justify-between font-mono text-xs"
                            onClick={() => captureKey(key)}
                          >
                            {capturing === key ? (
                              <span className="text-accent">按下组合键...</span>
                            ) : (
                              <span>{settings.hotkeys[key]}</span>
                            )}
                          </button>
                          <HotkeyStatusBadge state={status} />
                          <button
                            className="rounded-md border border-border px-2 py-1 text-[10px] text-fg-muted hover:text-fg"
                            onClick={() => testHotkey(settings.hotkeys[key])}
                            title="测试该快捷键能否注册"
                          >
                            测试
                          </button>
                        </div>
                        <p
                          className={`max-w-[360px] text-right text-[10px] ${
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
                            ? `当前生效：${activeAccelerator ?? settings.hotkeys[key]}`
                            : activeDiffers
                              ? `当前实际生效：${activeAccelerator}，设置值尚未接管`
                              : status.title ?? '当前快捷键尚未注册成功'}
                        </p>
                      </div>
                    </Row>
                  );
                })}
                <div className="pt-1">
                  <button
                    className="btn-ghost text-xs"
                    onClick={resetHotkeys}
                  >
                    恢复默认快捷键
                  </button>
                </div>
              </Section>
            </>
          )}

          {activeTab === 'tasks' && (
            <>
              {/* 任务来源 + 滴答清单 CLI */}
              <Section title="任务来源" desc="选择右侧任务列表的数据来源；CLI 优先自动探测，可手动配置">
                <Row label="当前任务来源">
                  <div className="flex flex-col gap-1.5">
                    <ChoiceBtn
                      active={settings.taskSource === 'local'}
                      onClick={() => update({ taskSource: 'local' })}
                    >
                      本地任务
                    </ChoiceBtn>
                    <ChoiceBtn
                      active={settings.taskSource === 'ticktick-cli'}
                      onClick={() => update({ taskSource: 'ticktick-cli' })}
                    >
                      滴答清单 CLI
                    </ChoiceBtn>
                    <ChoiceBtn
                      active={settings.taskSource === 'ticktick-oauth'}
                      onClick={() => update({ taskSource: 'ticktick-oauth' })}
                    >
                      TickTick OAuth
                    </ChoiceBtn>
                  </div>
                </Row>

                <div className="rounded-lg border border-border bg-bg-subtle/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-fg-muted">滴答清单 CLI</span>
                    <button
                      className="btn-ghost text-[10px]"
                      onClick={detectCli}
                      disabled={cliDetecting}
                    >
                      {cliDetecting ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
                      重新探测
                    </button>
                  </div>
                  {cliDetected?.found ? (
                    <div className="mb-2 rounded bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400">
                      探测到：<code className="font-mono">{cliDetected.executable}</code>
                    </div>
                  ) : (
                    <div className="mb-2 rounded bg-bg-subtle px-2 py-1 text-[11px] text-fg-subtle">
                      未探测到 CLI，请在下方手动填写可执行文件路径
                    </div>
                  )}
                  {/* 当前 Provider 类型与真实命令显示 */}
                  {providerInfo && (
                    <div className="mb-2 rounded bg-bg-subtle/60 px-2 py-1.5 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className="text-fg-subtle">当前 CLI 类型：</span>
                        <span className={`font-medium ${providerInfo.providerType === 'dida' ? 'text-emerald-400' : providerInfo.providerType === 'ticktick' ? 'text-sky-400' : 'text-amber-400'}`}>
                          {providerInfo.providerType === 'dida' ? 'dida' : providerInfo.providerType === 'ticktick' ? 'ticktick' : '未知'}
                        </span>
                        <span className="text-fg-subtle">· 可执行文件：</span>
                        <code className="font-mono text-fg">{providerInfo.executable || '(未配置)'}</code>
                      </div>
                      {providerInfo.executablePath && (
                        <div className="mt-0.5 truncate text-fg-subtle">
                          路径：<code className="font-mono text-fg-muted">{providerInfo.executablePath}</code>
                        </div>
                      )}
                      {providerInfo.hasStaleTicktickTemplates && (
                        <div className="mt-1.5 rounded bg-rose-500/10 px-2 py-1 text-[10px] text-rose-400">
                          ⚠ 当前命令模板仍包含 ticktick 字面量，但探测到的是 dida。请点击下方「应用 dida 默认模板」按钮修复。
                        </div>
                      )}
                    </div>
                  )}
                  {/* 当前生效命令 */}
                  {settings.ticktickCli && (
                    <div className="mb-2 space-y-0.5 rounded bg-bg-subtle/40 px-2 py-1.5 text-[10px]">
                      <div className="truncate text-fg-subtle">
                        任务列表：<code className="font-mono text-fg-muted">{settings.ticktickCli.listTasksCommand}</code>
                      </div>
                      <div className="truncate text-fg-subtle">
                        项目列表：<code className="font-mono text-fg-muted">{settings.ticktickCli.listProjectsCommand}</code>
                      </div>
                    </div>
                  )}
                  {/* 应用 dida 默认模板按钮 */}
                  <div className="mb-2 flex items-center gap-2">
                    <button
                      className="btn-outline text-[10px]"
                      onClick={applyDidaTemplates}
                      title="一键写入 dida 默认命令模板"
                    >
                      应用 dida 默认模板
                    </button>
                    <span className="text-[10px] text-fg-subtle">
                      点击后会覆盖当前命令模板为 dida 标准模板并立即测试
                    </span>
                  </div>
                  <Row label="可执行文件路径">
                    <input
                      className="input min-w-[220px] font-mono text-xs"
                      value={settings.ticktickCli.executable}
                      onChange={(e) =>
                        update({ ticktickCli: { ...settings.ticktickCli, executable: e.target.value } })
                      }
                      placeholder="留空则用自动探测结果"
                    />
                  </Row>
                  <div className="mt-2 space-y-1.5">
                    <Row label="列出任务命令">
                      <input
                        className="input min-w-[220px] font-mono text-xs"
                        value={settings.ticktickCli.listTasksCommand}
                        onChange={(e) =>
                          update({ ticktickCli: { ...settings.ticktickCli, listTasksCommand: e.target.value } })
                        }
                      />
                    </Row>
                    <Row label="搜索任务命令">
                      <input
                        className="input min-w-[220px] font-mono text-xs"
                        value={settings.ticktickCli.searchTasksCommand}
                        onChange={(e) =>
                          update({ ticktickCli: { ...settings.ticktickCli, searchTasksCommand: e.target.value } })
                        }
                      />
                    </Row>
                    <Row label="追加备注命令">
                      <input
                        className="input min-w-[220px] font-mono text-xs"
                        value={settings.ticktickCli.appendNoteCommand}
                        onChange={(e) =>
                          update({ ticktickCli: { ...settings.ticktickCli, appendNoteCommand: e.target.value } })
                        }
                      />
                    </Row>
                    <Row label="超时（毫秒）">
                      <input
                        type="number"
                        className="input w-24 text-xs"
                        value={settings.ticktickCli.timeoutMs}
                        onChange={(e) =>
                          update({ ticktickCli: { ...settings.ticktickCli, timeoutMs: Number(e.target.value) } })
                        }
                      />
                    </Row>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button className="btn-outline text-xs" onClick={testCliList}>
                      测试读取任务
                    </button>
                    <span className="text-[10px] text-fg-subtle">支持占位符：{'{{projectId}} {{query}} {{taskId}} {{content}}'}</span>
                  </div>
                </div>
              </Section>

              {/* CLI 诊断面板 */}
              <CliDiagnosticPanel />
            </>
          )}

          {activeTab === 'sync' && (
            <>
              {/* 计时行为 */}
              <Section title="计时行为">
                <Row label="暂停后继续时">
                  <div className="flex gap-2">
                    <ChoiceBtn
                      active={settings.segmentBehavior === 'new-segment'}
                      onClick={() => update({ segmentBehavior: 'new-segment' })}
                    >
                      新建片段
                    </ChoiceBtn>
                    <ChoiceBtn
                      active={settings.segmentBehavior === 'continue-segment'}
                      onClick={() => update({ segmentBehavior: 'continue-segment' })}
                    >
                      继续当前片段
                    </ChoiceBtn>
                  </div>
                </Row>
              </Section>

              {/* 同步 */}
              <Section title="同步方式">
                <Row label="同步模式">
                  <div className="flex flex-col gap-1.5">
                    <ChoiceBtn
                      active={settings.syncMode === 'note'}
                      onClick={() => update({ syncMode: 'note' })}
                    >
                      稳定 · 写入任务备注
                    </ChoiceBtn>
                    <ChoiceBtn
                      active={settings.syncMode === 'experimental-focus'}
                      onClick={() => update({ syncMode: 'experimental-focus' })}
                    >
                      实验 · 写入 Focus 记录
                    </ChoiceBtn>
                    <ChoiceBtn
                      active={settings.syncMode === 'local-only'}
                      onClick={() => update({ syncMode: 'local-only' })}
                    >
                      仅本地
                    </ChoiceBtn>
                  </div>
                </Row>
                <Row label="实验性 Focus 同步">
                  <Toggle
                    checked={settings.experimentalFocusEnabled}
                    onChange={(v) => update({ experimentalFocusEnabled: v })}
                  />
                </Row>
                {settings.experimentalFocusEnabled && (
                  <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                    <Beaker size={13} />
                    实验性 Focus 同步依赖非官方 V2/session API，可能不稳定。所有记录会先保存本地。
                  </div>
                )}
              </Section>
            </>
          )}

          {activeTab === 'about' && (
            <>
              <Section title="FocusLink" desc="全局快捷键驱动的专注计时器 + 滴答清单任务关联工具">
                <Row label="当前版本">
                  <span className="rounded-md border border-border bg-bg-subtle px-2.5 py-1 text-xs font-mono text-fg-muted">
                    v0.1.5
                  </span>
                </Row>
              </Section>

              {/* 滴答清单账号 */}
              <Section title="滴答清单 / TickTick" desc="需在开发者平台创建应用获取 Client ID 和 Secret">
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
                  <>
                    <Row label="Client ID">
                      <input className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="应用的 Client ID" />
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
                      {loginLoading ? <Loader2 size={15} className="animate-spin" /> : null}
                      连接滴答清单
                    </button>
                  </>
                ) : (
                  <div className="flex items-center justify-between rounded-lg border border-emerald-500/15 bg-emerald-500/10 px-4 py-3">
                    <span className="text-sm text-emerald-400">已连接（{region}）</span>
                    <button className="btn-ghost text-xs" onClick={handleLogout}>
                      <LogOut size={13} />
                      断开
                    </button>
                  </div>
                )}
                <p className="text-xs text-fg-subtle">
                  回调地址需配置为：<code className="rounded bg-bg-subtle px-1 py-0.5">http://localhost:18321/callback</code>
                </p>
              </Section>

              {/* 系统 */}
              <Section title="系统与后台运行">
                <Row label="最小化到托盘">
                  <Toggle checked={settings.minimizeToTray} onChange={(v) => update({ minimizeToTray: v })} />
                </Row>
                <Row label="关闭窗口时最小化到托盘">
                  <Toggle checked={settings.closeToTray} onChange={(v) => update({ closeToTray: v })} />
                </Row>
                <Row label="启动后最小化到托盘">
                  <Toggle checked={settings.startMinimizedToTray} onChange={(v) => update({ startMinimizedToTray: v })} />
                </Row>
                <Row label="启动时显示专注小窗">
                  <Toggle checked={settings.showMiniOnStart} onChange={(v) => update({ showMiniOnStart: v })} />
                </Row>
                <Row label="开机自启动">
                  <Toggle checked={settings.autoStart} onChange={(v) => update({ autoStart: v })} />
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
  status: HotkeyRegistrationStatus | null
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
      className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] font-medium ${cls}`}
      title={state.title}
    >
      {state.tone === 'ok' ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
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
    <div className="card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {desc && <p className="mt-0.5 text-xs text-fg-subtle">{desc}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
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
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <span className="block text-sm text-fg-muted">{label}</span>
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
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
        active ? 'bg-accent text-accent-fg' : 'bg-bg-subtle text-fg-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-bg-subtle'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
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

// ============ CLI 诊断面板 ============
interface CliDiagnoseStep {
  name: string;
  ok: boolean;
  summary: string;
  record?: {
    command: string;
    cwd: string;
    timeoutMs: number;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    status: string;
    parseResult: string;
    error?: string;
  };
}
interface CliDiagnoseResult {
  provider: string;
  executable: string;
  executablePath: string;
  cwd: string;
  version: string;
  loggedIn: boolean | null;
  loginStatusText: string;
  steps: CliDiagnoseStep[];
  lastError: string | null;
  lastStdout: string;
  lastStderr: string;
  templates: AppSettings['ticktickCli'];
}

function CliDiagnosticPanel() {
  const { addToast } = useStore();
  const [diagnose, setDiagnose] = useState<CliDiagnoseResult | null>(null);
  const [running, setRunning] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const runDiagnose = async () => {
    setRunning(true);
    try {
      const res = await window.focuslink.cli.diagnose();
      if (res.ok) {
        setDiagnose(res.data);
        const failed = res.data.steps.filter((s: CliDiagnoseStep) => !s.ok).length;
        if (failed === 0) {
          addToast('诊断完成：所有步骤通过', 'success');
        } else {
          addToast(`诊断完成：${failed} 项失败`, 'error');
        }
      } else {
        addToast('诊断失败：' + res.error, 'error');
      }
    } catch (e) {
      addToast('诊断异常：' + (e as Error).message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const testProjectList = async () => {
    setRunning(true);
    try {
      const res = await window.focuslink.cli.listProjects();
      if (res.ok) {
        addToast(`项目列表测试成功：${res.data.length} 个项目`, 'success');
      } else {
        addToast('项目列表测试失败：' + res.error, 'error');
      }
    } catch (e) {
      addToast('测试异常：' + (e as Error).message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const testTaskList = async () => {
    setRunning(true);
    try {
      const res = await window.focuslink.cli.listTasks();
      if (res.ok) {
        addToast(`任务列表测试成功：${res.data.length} 个任务`, 'success');
      } else {
        addToast('任务列表测试失败：' + res.error, 'error');
      }
    } catch (e) {
      addToast('测试异常：' + (e as Error).message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const testSearch = async () => {
    setRunning(true);
    try {
      const res = await window.focuslink.cli.searchTasks('test');
      if (res.ok) {
        addToast(`搜索测试成功：${res.data.length} 个结果`, 'success');
      } else {
        addToast('搜索测试失败：' + res.error, 'error');
      }
    } catch (e) {
      addToast('测试异常：' + (e as Error).message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const copyDiagnose = async () => {
    if (!diagnose) return;
    const text = [
      '=== FocusLink CLI 诊断报告 ===',
      `时间：${new Date().toLocaleString('zh-CN')}`,
      `Provider: ${diagnose.provider}`,
      `Executable: ${diagnose.executable}`,
      `ExecutablePath: ${diagnose.executablePath}`,
      `CWD: ${diagnose.cwd}`,
      `Version: ${diagnose.version}`,
      `LoggedIn: ${diagnose.loggedIn}`,
      `LoginStatusText: ${diagnose.loginStatusText}`,
      `LastError: ${diagnose.lastError ?? '(无)'}`,
      '',
      '=== Steps ===',
      ...diagnose.steps.map((s: CliDiagnoseStep, i: number) => (
        `[${i + 1}] ${s.name}: ${s.ok ? 'OK' : 'FAIL'} - ${s.summary}`
      )),
      '',
      '=== Templates ===',
      `listProjectsCommand: ${diagnose.templates.listProjectsCommand}`,
      `listTasksCommand: ${diagnose.templates.listTasksCommand}`,
      `searchTasksCommand: ${diagnose.templates.searchTasksCommand}`,
      `getTaskCommand: ${diagnose.templates.getTaskCommand}`,
      `appendNoteCommand: ${diagnose.templates.appendNoteCommand}`,
      `timeoutMs: ${diagnose.templates.timeoutMs}`,
      '',
      '=== Last stdout (前 2000) ===',
      diagnose.lastStdout,
      '',
      '=== Last stderr (前 2000) ===',
      diagnose.lastStderr,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      addToast('诊断信息已复制到剪贴板', 'success');
    } catch {
      addToast('复制失败，请手动选择文本', 'error');
    }
  };

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Stethoscope size={14} />
            CLI 诊断面板
          </h3>
          <p className="mt-0.5 text-xs text-fg-subtle">
            一键检测 CLI 路径、版本、登录、项目、任务、搜索，便于定位读取失败原因
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          className="btn-primary text-xs"
          onClick={runDiagnose}
          disabled={running}
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Stethoscope size={12} />}
          完整诊断
        </button>
        <button className="btn-outline text-xs" onClick={testProjectList} disabled={running}>
          测试项目列表
        </button>
        <button className="btn-outline text-xs" onClick={testTaskList} disabled={running}>
          测试任务列表
        </button>
        <button className="btn-outline text-xs" onClick={testSearch} disabled={running}>
          测试搜索
        </button>
        <button className="btn-ghost text-xs" onClick={copyDiagnose} disabled={!diagnose}>
          <Copy size={11} />
          复制诊断信息
        </button>
      </div>

      {diagnose ? (
        <div className="space-y-3">
          {/* 基础信息 */}
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-bg-subtle/40 p-3 text-xs">
            <div>
              <span className="text-fg-subtle">CLI 路径：</span>
              <code className="font-mono text-fg">{diagnose.executablePath || diagnose.executable || '(未检测)'}</code>
            </div>
            <div>
              <span className="text-fg-subtle">版本：</span>
              <code className="font-mono text-fg">{diagnose.version || '(未知)'}</code>
            </div>
            <div>
              <span className="text-fg-subtle">登录状态：</span>
              <span className={diagnose.loggedIn ? 'text-emerald-400' : 'text-rose-400'}>
                {diagnose.loggedIn === null ? '未知' : diagnose.loggedIn ? '已登录' : '未登录'}
              </span>
            </div>
            <div>
              <span className="text-fg-subtle">CWD：</span>
              <code className="font-mono text-fg">{diagnose.cwd}</code>
            </div>
          </div>

          {/* 步骤列表 */}
          <div className="space-y-1.5">
            {diagnose.steps.map((step, idx) => {
              const expanded = expandedStep === step.name;
              return (
                <div key={idx} className="rounded-lg border border-border bg-bg-card">
                  <button
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-bg-subtle/30"
                    onClick={() => setExpandedStep(expanded ? null : step.name)}
                  >
                    <div className="flex items-center gap-2">
                      {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          step.ok ? 'bg-emerald-400' : 'bg-rose-400'
                        }`}
                      />
                      <span className="font-medium">{step.name}</span>
                    </div>
                    <span className={`truncate text-[11px] ${step.ok ? 'text-fg-muted' : 'text-rose-400'}`}>
                      {step.summary}
                    </span>
                  </button>
                  {expanded && step.record && (
                    <div className="border-t border-border bg-bg-subtle/20 px-3 py-2 text-[11px]">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        <div>
                          <span className="text-fg-subtle">命令：</span>
                          <code className="font-mono break-all">{step.record.command}</code>
                        </div>
                        <div>
                          <span className="text-fg-subtle">exitCode：</span>
                          <code className="font-mono">{String(step.record.exitCode)}</code>
                        </div>
                        <div>
                          <span className="text-fg-subtle">status：</span>
                          <code className="font-mono">{step.record.status}</code>
                        </div>
                        <div>
                          <span className="text-fg-subtle">parseResult：</span>
                          <code className="font-mono">{step.record.parseResult}</code>
                        </div>
                        <div>
                          <span className="text-fg-subtle">耗时：</span>
                          <code className="font-mono">{step.record.durationMs}ms</code>
                        </div>
                        <div>
                          <span className="text-fg-subtle">超时：</span>
                          <code className="font-mono">{step.record.timeoutMs}ms</code>
                        </div>
                      </div>
                      {step.record.error && (
                        <div className="mt-2 text-rose-400">
                          <span className="text-fg-subtle">error：</span>
                          {step.record.error}
                        </div>
                      )}
                      {step.record.stderr && (
                        <div className="mt-2">
                          <div className="text-fg-subtle">stderr：</div>
                          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-rose-500/5 p-2 font-mono text-[10px] text-rose-300">
                            {step.record.stderr.slice(0, 1000)}
                          </pre>
                        </div>
                      )}
                      {step.record.stdout && (
                        <div className="mt-2">
                          <div className="text-fg-subtle">stdout（前 1000 字符）：</div>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg-subtle/40 p-2 font-mono text-[10px] text-fg-muted">
                            {step.record.stdout.slice(0, 1000)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 最近一次错误 */}
          {diagnose.lastError && (
            <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] text-rose-400">
              <span className="font-semibold">最近一次错误：</span>
              {diagnose.lastError}
            </div>
          )}

          {/* 原始 stdout/stderr 折叠 */}
          <div>
            <button
              className="flex w-full items-center gap-2 px-1 py-1 text-left text-xs text-fg-muted hover:text-fg"
              onClick={() => setShowRaw(!showRaw)}
            >
              {showRaw ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              原始输出（stdout / stderr）
            </button>
            {showRaw && (
              <div className="mt-1 space-y-2">
                <div>
                  <div className="text-[11px] text-fg-subtle">原始 stdout：</div>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg-subtle/40 p-2 font-mono text-[10px] text-fg-muted">
                    {diagnose.lastStdout || '(空)'}
                  </pre>
                </div>
                <div>
                  <div className="text-[11px] text-fg-subtle">原始 stderr：</div>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg-subtle/40 p-2 font-mono text-[10px] text-rose-300">
                    {diagnose.lastStderr || '(空)'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-fg-subtle">
          点击上方"完整诊断"开始检测
        </div>
      )}
    </div>
  );
}
