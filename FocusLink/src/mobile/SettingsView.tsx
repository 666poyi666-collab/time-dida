import { Cloud, Database, KeyRound, SlidersHorizontal } from 'lucide-react';
import type { LiveConnectionState } from './runtimeModel';
import { NativeSystemControls } from './NativeSystemControls';
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
  endpoint: string;
  hasToken: boolean;
  taskCount: number;
  taskRevision: number;
  ledgerCount: number;
  onOpenConnection: () => void;
  appearance: MobileAppearance;
  onAppearanceChange: (value: MobileAppearance) => void;
}

export function SettingsView({
  connection,
  endpoint,
  hasToken,
  taskCount,
  taskRevision,
  ledgerCount,
  onOpenConnection,
  appearance,
  onAppearanceChange,
}: SettingsViewProps) {
  return (
    <section className="settings-view view-surface" aria-labelledby="settings-view-title">
      <header className="view-heading">
        <div>
          <p className="eyebrow">DEVICE & CLOUD</p>
          <h2 id="settings-view-title">连接与系统</h2>
        </div>
        <button className="settings-edit-button" type="button" onClick={onOpenConnection}>
          <SlidersHorizontal aria-hidden="true" />
          <span>编辑连接</span>
        </button>
      </header>

      <div className="settings-status-grid">
        <StatusLine
          icon={Cloud}
          label="实时连接"
          value={connectionLabel(connection)}
          tone={connection === 'live' ? 'ok' : 'warning'}
        />
        <StatusLine
          icon={KeyRound}
          label="访问令牌"
          value={hasToken ? '已保存于本机' : '未配置'}
          tone={hasToken ? 'ok' : 'warning'}
        />
        <StatusLine
          icon={Database}
          label="任务快照"
          value={`${taskCount} 项 · rev ${taskRevision}`}
        />
        <StatusLine icon={Database} label="本机会话" value={`${ledgerCount} 场`} />
      </div>

      <div className="endpoint-readout">
        <span>同步服务地址</span>
        <code>{endpoint || '尚未配置'}</code>
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
  return '未配置';
}
