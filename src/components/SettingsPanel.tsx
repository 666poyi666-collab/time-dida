// 设置页 - 快捷键/主题/计时行为/任务来源/CLI/同步/滴答账号/系统
import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import type { AppSettings } from '@shared/types';
import { APP_VERSION } from '@shared/version';
import { Icon } from './Icon';

const HOTKEY_LABELS: Record<keyof AppSettings['hotkeys'], string> = {
  toggleTimer: '开始 / 暂停 / 继续',
  stopTimer: '结束当前专注',
  toggleWindow: '打开 / 隐藏主窗口',
  linkTask: '快速关联任务',
  toggleMiniWindow: '显示 / 隐藏专注小窗',
};

const ACCENTS = [
  { id: 'indigo', label: '靛蓝', color: '#818cf8' },
  { id: 'violet', label: '紫罗兰', color: '#a78bfa' },
  { id: 'emerald', label: '翠绿', color: '#34d399' },
  { id: 'rose', label: '玫瑰', color: '#fb7185' },
  { id: 'amber', label: '琥珀', color: '#fbbf24' },
  { id: 'sky', label: '天蓝', color: '#38bdf8' },
];

const TABS = [
  { id: 'appearance', label: '外观', icon: Icon.Palette },
  { id: 'tasks', label: '任务', icon: Icon.ListChecks },
  { id: 'hotkeys', label: '快捷键', icon: Icon.Keyboard },
  { id: 'mini', label: '小窗', icon: Icon.Monitor },
  { id: 'sync', label: '同步', icon: Icon.Refresh },
  { id: 'general', label: '通用', icon: Icon.Settings },
  { id: 'about', label: '关于', icon: Icon.Info },
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
      <div className="shrink-0 border-b border-border/60 px-6 pb-4 pt-6">
        <div className="mx-auto max-w-2xl">
          <h2 className="font-display mb-4 text-xl font-bold text-fg">设置</h2>
          <div className="flex flex-wrap gap-0.5 rounded-lg border border-border/50 bg-bg-subtle/30 p-0.5">
            {TABS.map((tab) => {
              const TabIcon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`motion-press flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-all duration-[var(--motion-fast)] ${
                    isActive
                      ? 'bg-accent/12 text-accent shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.2)]'
                      : 'text-fg-muted hover:bg-bg-subtle/70 hover:text-fg'
                  }`}
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
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {activeTab === 'appearance' && (
            <>
              {/* 外观 */}
              <Section title="外观">
                <Row label="主题">
                  <div className="flex gap-2">
                    <ChoiceBtn
                      active={settings.theme === 'dark'}
                      onClick={() => update({ theme: 'dark' })}
                    >
                      深色
                    </ChoiceBtn>
                    <ChoiceBtn
                      active={settings.theme === 'light'}
                      onClick={() => update({ theme: 'light' })}
                    >
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
                        className={`motion-press h-6 w-6 rounded-full transition-transform ${
                          settings.accentColor === a.id
                            ? 'scale-110 ring-2 ring-fg/10'
                            : 'hover:scale-105'
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
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    window.focuslink.mini.setOpacity(v);
                    update({ miniWindow: { ...settings.miniWindow, opacity: v } });
                  }}
                  className="w-40"
                />
              </Row>
              <Row
                label="主窗口隐藏时自动显示小窗"
                desc="主窗口最小化或隐藏到托盘时，自动弹出专注小窗"
              >
                <Toggle
                  checked={settings.miniWindow.autoShowOnMainHide}
                  onChange={(v) =>
                    update({ miniWindow: { ...settings.miniWindow, autoShowOnMainHide: v } })
                  }
                />
              </Row>
              <Row label="专注开始时自动显示小窗" desc="开始专注时若主窗口不在前台，自动显示小窗">
                <Toggle
                  checked={settings.miniWindow.autoShowOnFocusStart}
                  onChange={(v) =>
                    update({ miniWindow: { ...settings.miniWindow, autoShowOnFocusStart: v } })
                  }
                />
              </Row>
              <Row label="专注结束后自动隐藏小窗" desc="专注结束时自动隐藏小窗（默认关）">
                <Toggle
                  checked={settings.miniWindow.autoHideOnFocusEnd}
                  onChange={(v) =>
                    update({ miniWindow: { ...settings.miniWindow, autoHideOnFocusEnd: v } })
                  }
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
                    addToast('已恢复默认展开大小 420×184', 'success');
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

          {activeTab === 'tasks' && (
            <>
              {/* 任务来源 + 滴答清单 CLI */}
              <Section
                title="任务来源"
                desc="选择右侧任务列表的数据来源；CLI 优先自动探测，可手动配置"
              >
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
                      {cliDetecting ? (
                        <Icon.Loader size="xs" spin />
                      ) : (
                        <Icon.Search size="xs" />
                      )}
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
                        <span
                          className={`font-medium ${providerInfo.providerType === 'dida' ? 'text-emerald-400' : providerInfo.providerType === 'ticktick' ? 'text-sky-400' : 'text-amber-400'}`}
                        >
                          {providerInfo.providerType === 'dida'
                            ? 'dida'
                            : providerInfo.providerType === 'ticktick'
                              ? 'ticktick'
                              : '未知'}
                        </span>
                        <span className="text-fg-subtle">· 可执行文件：</span>
                        <code className="font-mono text-fg">
                          {providerInfo.executable || '(未配置)'}
                        </code>
                      </div>
                      {providerInfo.executablePath && (
                        <div className="mt-0.5 truncate text-fg-subtle">
                          路径：
                          <code className="font-mono text-fg-muted">
                            {providerInfo.executablePath}
                          </code>
                        </div>
                      )}
                      {providerInfo.hasStaleTicktickTemplates && (
                        <div className="mt-1.5 rounded bg-rose-500/10 px-2 py-1 text-[10px] text-rose-400">
                          ⚠ 当前命令模板仍包含 ticktick 字面量，但探测到的是 dida。请点击下方「应用
                          dida 默认模板」按钮修复。
                        </div>
                      )}
                    </div>
                  )}
                  {/* 当前生效命令 */}
                  {settings.ticktickCli && (
                    <div className="mb-2 space-y-0.5 rounded bg-bg-subtle/40 px-2 py-1.5 text-[10px]">
                      <div className="truncate text-fg-subtle">
                        任务列表：
                        <code className="font-mono text-fg-muted">
                          {settings.ticktickCli.listTasksCommand}
                        </code>
                      </div>
                      <div className="truncate text-fg-subtle">
                        项目列表：
                        <code className="font-mono text-fg-muted">
                          {settings.ticktickCli.listProjectsCommand}
                        </code>
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
                      className="input min-w-[200px] font-mono text-xs"
                      value={settings.ticktickCli.executable}
                      onChange={(e) =>
                        update({
                          ticktickCli: { ...settings.ticktickCli, executable: e.target.value },
                        })
                      }
                      placeholder="留空则用自动探测结果"
                    />
                  </Row>
                  <div className="mt-2 space-y-1.5">
                    <Row label="列出任务命令">
                      <input
                        className="input min-w-[200px] font-mono text-xs"
                        value={settings.ticktickCli.listTasksCommand}
                        onChange={(e) =>
                          update({
                            ticktickCli: {
                              ...settings.ticktickCli,
                              listTasksCommand: e.target.value,
                            },
                          })
                        }
                      />
                    </Row>
                    <Row label="搜索任务命令">
                      <input
                        className="input min-w-[200px] font-mono text-xs"
                        value={settings.ticktickCli.searchTasksCommand}
                        onChange={(e) =>
                          update({
                            ticktickCli: {
                              ...settings.ticktickCli,
                              searchTasksCommand: e.target.value,
                            },
                          })
                        }
                      />
                    </Row>
                    <Row label="追加备注命令">
                      <input
                        className="input min-w-[200px] font-mono text-xs"
                        value={settings.ticktickCli.appendNoteCommand}
                        onChange={(e) =>
                          update({
                            ticktickCli: {
                              ...settings.ticktickCli,
                              appendNoteCommand: e.target.value,
                            },
                          })
                        }
                      />
                    </Row>
                    <Row label="超时（毫秒）">
                      <input
                        type="number"
                        className="input w-24 text-xs"
                        value={settings.ticktickCli.timeoutMs}
                        onChange={(e) =>
                          update({
                            ticktickCli: {
                              ...settings.ticktickCli,
                              timeoutMs: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Row>
                  </div>
                </div>
              </Section>

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
                      active={settings.syncMode === 'focus-record'}
                      onClick={() => update({ syncMode: 'focus-record' })}
                    >
                      云端专注记录（推荐）
                    </ChoiceBtn>
                    <ChoiceBtn
                      active={settings.syncMode === 'comment'}
                      onClick={() => update({ syncMode: 'comment' })}
                    >
                      写入任务评论/备注
                    </ChoiceBtn>
                    <ChoiceBtn
                      active={settings.syncMode === 'local-only'}
                      onClick={() => update({ syncMode: 'local-only' })}
                    >
                      仅本地
                    </ChoiceBtn>
                  </div>
                </Row>
              </Section>

              {/* 滴答清单账号 */}
              <Section
                title="滴答清单 / TickTick"
                desc="需在开发者平台创建应用获取 Client ID 和 Secret"
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
                  <>
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
                  </>
                ) : (
                  <div className="flex items-center justify-between rounded-lg border border-emerald-500/15 bg-emerald-500/10 px-4 py-3">
                    <span className="text-sm text-emerald-400">已连接（{region}）</span>
                    <button className="btn-ghost text-xs" onClick={handleLogout}>
                      <Icon.LogOut size="sm" />
                      断开
                    </button>
                  </div>
                )}
                <p className="text-xs text-fg-subtle">
                  回调地址需配置为：
                  <code className="rounded bg-bg-subtle px-1 py-0.5">
                    http://localhost:18321/callback
                  </code>
                </p>
              </Section>
            </>
          )}

          {activeTab === 'general' && (
            <>
              {/* 系统与后台运行 */}
              <Section title="系统与后台运行">
                <Row label="最小化到托盘">
                  <Toggle
                    checked={settings.minimizeToTray}
                    onChange={(v) => update({ minimizeToTray: v })}
                  />
                </Row>
                <Row label="关闭窗口时最小化到托盘">
                  <Toggle
                    checked={settings.closeToTray}
                    onChange={(v) => update({ closeToTray: v })}
                  />
                </Row>
                <Row label="启动后最小化到托盘" desc="手动启动也隐藏主界面；开机自启动会自动进托盘">
                  <Toggle
                    checked={settings.startMinimizedToTray}
                    onChange={(v) => update({ startMinimizedToTray: v })}
                  />
                </Row>
                <Row label="启动时显示专注小窗">
                  <Toggle
                    checked={settings.showMiniOnStart}
                    onChange={(v) => update({ showMiniOnStart: v })}
                  />
                </Row>
                <Row label="开机自启动" desc="系统登录时带隐藏参数启动，不弹出主界面">
                  <Toggle checked={settings.autoStart} onChange={(v) => update({ autoStart: v })} />
                </Row>
              </Section>
            </>
          )}

          {activeTab === 'about' && (
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
      className={`inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[10.5px] font-medium ${cls}`}
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
    <div className="rounded-lg border border-border/60 bg-bg-card/70 p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="mb-3">
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        {desc && <p className="mt-0.5 text-[11.5px] text-fg-subtle">{desc}</p>}
      </div>
      <div className="space-y-2.5">{children}</div>
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
    <div className="flex items-center justify-between gap-3">
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
        active ? 'bg-accent text-accent-fg shadow-sm' : 'bg-bg-subtle/60 text-fg-muted hover:bg-bg-subtle hover:text-fg'
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
      className={`motion-press toggle-track ${
        checked ? 'bg-accent' : 'bg-bg-subtle border border-border/50'
      }`}
      style={{ boxShadow: checked ? 'inset 0 1px 0 rgb(255 255 255 / 0.12)' : 'none' }}
    >
      <span
        className={`toggle-thumb ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        style={{ boxShadow: '0 1px 3px rgb(0 0 0 / 0.15), 0 0 0 0.5px rgb(0 0 0 / 0.05)' }}
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

function formatHotkey(accelerator: string | null): string {
  if (!accelerator) return '未注册';
  return accelerator
    .split('+')
    .map((part) => (part === 'CommandOrControl' ? 'Ctrl' : part === 'Return' ? 'Enter' : part))
    .join(' + ');
}


