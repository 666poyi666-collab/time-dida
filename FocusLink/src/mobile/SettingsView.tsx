import { Cloud, Database, SlidersHorizontal, UserRound } from 'lucide-react';
import { APP_COMMIT, APP_VERSION } from '@shared/version';
import type { LiveConnectionState } from './runtimeModel';
import { NativeSystemControls } from './NativeSystemControls';
import { SyncV2Management } from './SyncV2Management';
import {
  FOCUS_COLORS,
  FONT_PROFILES,
  MOBILE_FOCUS_LABELS,
  MOBILE_FONT_LABELS,
  MOBILE_THEME_LABELS,
  type MobileAppearance,
} from './appearance';

interface SettingsViewProps {
  connection: LiveConnectionState;
  accountLabel: string | null;
  authenticated: boolean;
  endpoint: string;
  token: string;
  taskCount: number;
  taskRevision: number;
  ledgerCount: number;
  onOpenAccount: () => void;
  appearance: MobileAppearance;
  onAppearanceChange: (value: MobileAppearance) => void;
}

export function SettingsView({
  connection,
  accountLabel,
  authenticated,
  endpoint,
  token,
  taskCount,
  taskRevision,
  ledgerCount,
  onOpenAccount,
  appearance,
  onAppearanceChange,
}: SettingsViewProps) {
  return (
    <section className="settings-view view-surface" aria-labelledby="settings-view-title">
      <header className="view-heading">
        <div>
          <p className="eyebrow">DEVICE & CLOUD</p>
          <h2 id="settings-view-title">账号与系统</h2>
        </div>
        <button className="settings-edit-button" type="button" onClick={onOpenAccount}>
          <UserRound aria-hidden="true" />
          <span>{authenticated ? '管理账号' : '登录账号'}</span>
        </button>
      </header>

      <div className="settings-status-grid">
        <StatusLine
          icon={Cloud}
          label="云同步"
          value={connectionLabel(connection)}
          tone={connection === 'live' ? 'ok' : 'warning'}
        />
        <StatusLine
          icon={UserRound}
          label="FocusLink 账号"
          value={authenticated ? (accountLabel ?? '已登录') : '未登录'}
          tone={authenticated ? 'ok' : 'warning'}
        />
        <StatusLine
          icon={Database}
          label="任务快照"
          value={`${taskCount} 项 · rev ${taskRevision}`}
        />
        <StatusLine icon={Database} label="本机会话" value={`${ledgerCount} 场`} />
      </div>

      <section className="mobile-appearance-panel" aria-labelledby="mobile-appearance-title">
        <div className="settings-section-heading">
          <div>
            <p className="eyebrow">SHARED VISUAL SYSTEM</p>
            <h3 id="mobile-appearance-title">界面外观</h3>
          </div>
          <span className="settings-section-note">与桌面端同一套主题</span>
        </div>

        <label className="appearance-select-row">
          <span>主题</span>
          <select
            value={appearance.theme}
            onChange={(event) =>
              onAppearanceChange({
                ...appearance,
                theme: event.target.value as MobileAppearance['theme'],
              })
            }
          >
            {Object.entries(MOBILE_THEME_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <div className="appearance-choice-group">
          <span>强调色</span>
          <div className="appearance-color-choices" role="group" aria-label="移动端强调色">
            {FOCUS_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`appearance-color-choice focus-color-${color} ${appearance.focusColor === color ? 'is-selected' : ''}`}
                aria-label={MOBILE_FOCUS_LABELS[color]}
                aria-pressed={appearance.focusColor === color}
                onClick={() => onAppearanceChange({ ...appearance, focusColor: color })}
              >
                <i aria-hidden="true" />
                <span>{MOBILE_FOCUS_LABELS[color]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="appearance-choice-group">
          <span>界面字体</span>
          <div className="appearance-font-choices" role="group" aria-label="移动端界面字体">
            {FONT_PROFILES.map((profile) => (
              <button
                key={profile}
                type="button"
                className={`appearance-font-choice font-profile-${profile} ${appearance.fontProfile === profile ? 'is-selected' : ''}`}
                aria-pressed={appearance.fontProfile === profile}
                onClick={() => onAppearanceChange({ ...appearance, fontProfile: profile })}
              >
                <strong>{MOBILE_FONT_LABELS[profile]}</strong>
                <small>专注 · FocusLink</small>
              </button>
            ))}
          </div>
        </div>
      </section>

      <NativeSystemControls />
      <SyncV2Management endpoint={endpoint} token={token} />

      {/* 版本与构建号从产品标题栏移到这里：排查时找得到，日常不占主界面。 */}
      <section className="settings-card">
        <header>
          <SlidersHorizontal aria-hidden="true" />
          <div>
            <h3>关于</h3>
            <p>版本与构建标识，反馈问题时附上这两项。</p>
          </div>
        </header>
        <div className="settings-status-grid">
          <StatusLine icon={Cloud} label="版本" value={`v${APP_VERSION}`} />
          <StatusLine icon={Database} label="构建" value={APP_COMMIT} />
        </div>
      </section>

      <div className="capability-boundary">
        <strong>桌面端专属操作</strong>
        <p>
          滴答清单写入、番茄 To-do
          投递、全局热键与迷你窗口继续由电脑端负责；移动端控制同一场专注并读取同步账本。
        </p>
      </div>
    </section>
  );
}

function StatusLine({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Cloud;
  label: string;
  value: string;
  tone?: 'ok' | 'warning';
}) {
  return (
    <div className={`settings-status-line ${tone ? `tone-${tone}` : ''}`}>
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function connectionLabel(connection: LiveConnectionState): string {
  if (connection === 'live') return '已确认';
  if (connection === 'connecting') return '连接中';
  if (connection === 'offline') return '设备离线';
  if (connection === 'error') return '需要重试';
  return '未登录';
}
