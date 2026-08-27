import { Cloud, Database, SlidersHorizontal, UserRound } from 'lucide-react';
import { APP_COMMIT, APP_VERSION } from '@shared/version';
import type { LiveConnectionState } from './runtimeModel';
import { NativeSystemControls } from './NativeSystemControls';
import { TimerDial } from '../features/focus/TimerDial';
import {
  FOCUS_COLORS,
  FONT_PROFILES,
  TIMER_STYLES,
  MOBILE_FOCUS_LABELS,
  MOBILE_FONT_LABELS,
  MOBILE_TIMER_LABELS,
  MOBILE_THEME_LABELS,
  type MobileAppearance,
} from './appearance';

interface SettingsViewProps {
  connection: LiveConnectionState;
  accountLabel: string | null;
  authenticated: boolean;
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
          <p className="eyebrow">DEVICE SYNC & APPEARANCE</p>
          <h2 id="settings-view-title">同步与外观</h2>
        </div>
        <button className="settings-edit-button" type="button" onClick={onOpenAccount}>
          <UserRound aria-hidden="true" />
          <span>{authenticated ? '管理设备' : '配对设备'}</span>
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
          label="设备同步"
          value={authenticated ? (accountLabel ?? '已配对') : '未配对'}
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

        <label className="appearance-select-row">
          <span>界面字体</span>
          <select
            value={appearance.fontProfile}
            onChange={(event) =>
              onAppearanceChange({
                ...appearance,
                fontProfile: event.target.value as MobileAppearance['fontProfile'],
              })
            }
          >
            {FONT_PROFILES.map((profile) => (
              <option key={profile} value={profile}>
                {MOBILE_FONT_LABELS[profile]}
              </option>
            ))}
          </select>
        </label>
        <div
          className={`appearance-font-preview font-profile-${appearance.fontProfile}`}
          aria-live="polite"
        >
          <span>{MOBILE_FONT_LABELS[appearance.fontProfile]}</span>
          <strong>时间正在发生 · 清醒专注 12:48</strong>
        </div>

        <div className="appearance-choice-group appearance-timer-group">
          <span>计时仪表</span>
          <p>和电脑端使用同一组九种时间仪器；选择后立即应用到专注页。</p>
          <div className="appearance-timer-choices" role="group" aria-label="移动端计时仪表">
            {TIMER_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                className={`appearance-timer-choice ${appearance.timerStyle === style ? 'is-selected' : ''}`}
                aria-pressed={appearance.timerStyle === style}
                onClick={() => onAppearanceChange({ ...appearance, timerStyle: style })}
              >
                <span>{MOBILE_TIMER_LABELS[style]}</span>
                <div className="appearance-timer-preview" aria-hidden="true">
                  <TimerDial
                    ms={25 * 60_000 + 16_000}
                    state="running"
                    style={style}
                    coreRatio={0.62}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <NativeSystemControls />

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
          设备互相输入 8 位码后同步 FocusLink
          任务、清单颜色与专注记录；外部导入与投递只在桌面端设置中管理。
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
  return '未配对';
}
