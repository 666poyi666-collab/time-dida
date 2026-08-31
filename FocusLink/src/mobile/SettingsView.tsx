import {
  Cloud,
  Database,
  History,
  ListTodo,
  SlidersHorizontal,
  UserRound,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { APP_COMMIT, APP_DISPLAY_VERSION } from '@shared/version';
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
import {
  presentMobileLedgerFreshness,
  presentMobileSettingsConnection,
  type MobileSettingsFactTone,
  type MobileSettingsPullState,
} from './settingsStatusPresentation';

interface SettingsViewProps {
  connection: LiveConnectionState;
  online: boolean;
  accountLabel: string | null;
  authenticated: boolean;
  lastSyncAt: number | null;
  pullState: MobileSettingsPullState;
  taskCount: number;
  taskRevision: number;
  ledgerCount: number;
  onOpenAccount: () => void;
  appearance: MobileAppearance;
  onAppearanceChange: (value: MobileAppearance) => void;
}

export function SettingsView({
  connection,
  online,
  accountLabel,
  authenticated,
  lastSyncAt,
  pullState,
  taskCount,
  taskRevision,
  ledgerCount,
  onOpenAccount,
  appearance,
  onAppearanceChange,
}: SettingsViewProps) {
  const connectionFact = presentMobileSettingsConnection({
    authenticated,
    online,
    connection,
    accountLabel,
  });
  const ledgerFact = presentMobileLedgerFreshness({ authenticated, lastSyncAt, pullState });
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

      <div className="settings-status-grid" aria-label="同步状态">
        <StatusLine
          icon={Wifi}
          label="实时连接"
          value={connectionFact.value}
          detail={connectionFact.detail}
          tone={connectionFact.tone}
        />
        <StatusLine
          icon={History}
          label="账本新鲜度"
          value={ledgerFact.value}
          detail={ledgerFact.detail}
          tone={ledgerFact.tone}
        />
        <StatusLine
          icon={ListTodo}
          label="任务同步"
          value={`${taskCount} 项`}
          detail={`revision ${taskRevision}`}
        />
        <StatusLine
          icon={Database}
          label="本机专注记录"
          value={`${ledgerCount} 场`}
          detail="已结束且保存在本机"
        />
      </div>
      <p className="settings-fact-explainer">
        账本新鲜度 = 最近一次从云端确认专注记录的时间；它不是网速，也不代表任务同步状态。
      </p>

      <section className="mobile-appearance-panel" aria-labelledby="mobile-appearance-title">
        <div className="settings-section-heading">
          <div>
            <p className="eyebrow">SHARED VISUAL SYSTEM</p>
            <h3 id="mobile-appearance-title">界面外观</h3>
          </div>
          <span className="settings-section-note">与桌面端同一套主题</span>
        </div>

        <div className="appearance-choice-group appearance-theme-group">
          <span>主题</span>
          <div className="appearance-segmented" role="group" aria-label="移动端主题">
            {Object.entries(MOBILE_THEME_LABELS).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`appearance-segmented-option theme-${value} ${appearance.theme === value ? 'is-selected' : ''}`}
                aria-pressed={appearance.theme === value}
                onClick={() =>
                  onAppearanceChange({
                    ...appearance,
                    theme: value as MobileAppearance['theme'],
                  })
                }
              >
                <span className="appearance-segmented-swatch" aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

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

        <div className="appearance-font-controls">
          <div className="appearance-choice-group appearance-font-group">
            <span>界面字体</span>
            <p className="appearance-control-hint">每张卡片都用自己的字体绘制；点选后立即应用。</p>
            <div className="appearance-font-choices" role="group" aria-label="移动端界面字体">
              {FONT_PROFILES.map((profile) => (
                <button
                  key={profile}
                  type="button"
                  data-font-profile={profile}
                  className={`appearance-font-choice font-profile-${profile} ${appearance.fontProfile === profile ? 'is-selected' : ''}`}
                  aria-pressed={appearance.fontProfile === profile}
                  onClick={() => onAppearanceChange({ ...appearance, fontProfile: profile })}
                >
                  <strong>{MOBILE_FONT_LABELS[profile]}</strong>
                  <span className="appearance-font-sample">专注进行中 · 12:48</span>
                  <small>{appearance.fontProfile === profile ? '当前使用' : '点击应用'}</small>
                </button>
              ))}
            </div>
          </div>
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
          <StatusLine icon={Cloud} label="版本" value={`v${APP_DISPLAY_VERSION}`} />
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
  detail,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string;
  tone?: MobileSettingsFactTone;
}) {
  return (
    <div className={`settings-status-line ${tone ? `tone-${tone}` : ''}`}>
      <Icon aria-hidden="true" />
      <span className="settings-status-copy">
        <span>{label}</span>
        {detail ? <small>{detail}</small> : null}
      </span>
      <strong>{value}</strong>
    </div>
  );
}
