// 系统托盘 - 显示/隐藏窗口、开始/暂停/继续、结束、专注小窗、设置、退出
// 托盘图标：使用 build/tray.ico；状态变化时叠加色调（运行/暂停/完成）
import { Tray, Menu, nativeImage, nativeTheme, BrowserWindow, app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FocusTimerController } from './timer/focusTimerController.js';
import type { TimerState } from '@shared/types';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;
let trayThemeListener: (() => void) | null = null;

export interface TrayCallbacks {
  onShowMini?: () => void;
  onHideMini?: () => void;
  onCollapseMini?: () => void;
  onExpandMini?: () => void;
  onResetMini?: () => void;
}

/** 生成状态托盘 SVG：F/L 两条时间材料相互穿插，L 使用当前状态色。 */
function makeStateSvg(state: TimerState, darkBackground: boolean): string {
  const tones: Record<TimerState, string> = {
    idle: '#7D8781',
    running: '#20A975',
    paused: '#D24339',
    stopping: '#87918B',
    finished: '#20A975',
  };
  const tone = tones[state] ?? tones.idle;
  const mark = darkBackground ? '#F2F3ED' : '#17221E';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <path d="M4.5 4.5v23M4.5 4.5h17M4.5 14.5h13" fill="none" stroke="${mark}" stroke-width="5.2" stroke-linecap="square" stroke-linejoin="miter"/>
  <path d="M19.5 12v15.5h8" fill="none" stroke="${tone}" stroke-width="4.4" stroke-linecap="square" stroke-linejoin="miter"/>
  <path d="M15.5 14.5h4" stroke="${mark}" stroke-width="5.2" stroke-linecap="square"/>
</svg>`;
}

/** 加载托盘图标：优先用状态 SVG，失败时回退到 build/tray.ico */
function makeIcon(state: TimerState): Electron.NativeImage {
  const stateIcon = nativeImage.createFromBuffer(
    Buffer.from(makeStateSvg(state, nativeTheme.shouldUseDarkColors), 'utf-8'),
  );
  if (!stateIcon.isEmpty()) return stateIcon;

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'tray.ico')
    : path.join(__dirname, '..', 'build', 'tray.ico');
  try {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) {
      return img;
    }
  } catch (err) {
    logger.warn('tray', 'failed to load tray.ico, fallback to svg', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const fallback = nativeImage.createFromBuffer(
    Buffer.from(makeStateSvg(state, nativeTheme.shouldUseDarkColors), 'utf-8'),
  );
  fallback.setTemplateImage(true);
  return fallback;
}

export function createTray(
  window: BrowserWindow,
  timer: FocusTimerController,
  callbacks: TrayCallbacks = {},
): Tray {
  tray = new Tray(makeIcon('idle'));
  tray.setToolTip('FocusLink');

  const rebuild = () => {
    const snap = timer.getSnapshot();
    const state = snap.state;
    const isActive = state === 'running';
    const isPaused = state === 'paused';
    const toggleLabel = isActive ? '暂停' : isPaused ? '继续' : '开始专注';
    const stateLabel =
      state === 'idle'
        ? '未开始'
        : state === 'running'
          ? `专注中 · ${formatMs(snap.activeElapsedMs)}`
          : state === 'paused'
            ? '已暂停'
            : state === 'finished'
              ? '已结束'
              : '未知';

    tray!.setImage(makeIcon(state));
    tray!.setToolTip(`FocusLink · ${stateLabel}`);

    const menu = Menu.buildFromTemplate([
      { label: `FocusLink`, enabled: false },
      { type: 'separator' },
      { label: `状态：${stateLabel}`, enabled: false },
      {
        label: toggleLabel,
        click: () =>
          void timer
            .toggle()
            .catch((error) => logger.warn('tray', 'toggle failed', { error: String(error) })),
      },
      {
        label: '结束专注',
        enabled: state === 'running' || state === 'paused',
        click: () =>
          void timer
            .stop()
            .catch((error) => logger.warn('tray', 'stop failed', { error: String(error) })),
      },
      { type: 'separator' },
      {
        label: window.isVisible() ? '隐藏主窗口' : '显示主窗口',
        click: () => {
          if (window.isVisible()) window.hide();
          else {
            window.show();
            window.focus();
          }
        },
      },
      ...(callbacks.onShowMini
        ? [
            {
              label: '显示专注小窗',
              click: () => callbacks.onShowMini?.(),
            },
            {
              label: '隐藏专注小窗',
              click: () => callbacks.onHideMini?.(),
            },
            {
              label: '缩小专注小窗',
              click: () => callbacks.onCollapseMini?.(),
            },
            {
              label: '展开小窗',
              click: () => callbacks.onExpandMini?.(),
            },
            {
              label: '重置小窗位置和大小',
              click: () => callbacks.onResetMini?.(),
            },
          ]
        : []),
      {
        label: '设置',
        click: () => {
          window.show();
          window.focus();
          window.webContents.send('navigate', 'settings');
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          logger.info('tray', 'quit requested');
          // 用 app.quit() 触发 before-quit 清理流程，绕过 closeToTray 拦截
          app.quit();
        },
      },
    ]);
    tray!.setContextMenu(menu);
  };

  rebuild();
  timer.onSnapshot(rebuild);
  trayThemeListener = rebuild;
  nativeTheme.on('updated', trayThemeListener);

  tray.on('click', () => {
    if (window.isVisible()) {
      window.hide();
    } else {
      window.show();
      window.focus();
    }
  });

  return tray;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function destroyTray(): void {
  if (trayThemeListener) {
    nativeTheme.removeListener('updated', trayThemeListener);
    trayThemeListener = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
