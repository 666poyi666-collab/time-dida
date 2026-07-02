// 系统托盘 - 显示/隐藏窗口、开始/暂停/继续、结束、专注小窗、设置、退出
// 托盘图标：使用 build/tray.ico；状态变化时叠加色调（运行/暂停/完成）
import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TimerManager } from './timer/manager.js';
import type { TimerState } from '@shared/types';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;

export interface TrayCallbacks {
  onShowMini?: () => void;
  onHideMini?: () => void;
  onCollapseMini?: () => void;
  onExpandMini?: () => void;
  onResetMini?: () => void;
}

/** 加载托盘图标：优先用 build/tray.ico，失败时回退到生成 SVG */
function makeIcon(state: TimerState): Electron.NativeImage {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'tray.ico')
    : path.join(__dirname, '..', 'build', 'tray.ico');
  try {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) {
      // 暂停/完成态不再改色，直接用原图标，保持品牌一致性
      return img;
    }
  } catch (err) {
    logger.warn('tray', 'failed to load tray.ico, fallback to svg', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  // 回退：生成简易 SVG 图标
  const colors: Record<TimerState, string> = {
    idle: '#64748b',
    running: '#6366f1',
    paused: '#f59e0b',
    stopping: '#6366f1',
    finished: '#10b981',
  };
  const color = colors[state] ?? '#64748b';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <rect width="16" height="16" rx="3" fill="${color}"/>
  <circle cx="8" cy="8" r="3" fill="#ffffff" opacity="0.9"/>
</svg>`;
  const fallback = nativeImage.createFromBuffer(Buffer.from(svg, 'utf-8'));
  fallback.setTemplateImage(true);
  return fallback;
}

export function createTray(
  window: BrowserWindow,
  timer: TimerManager,
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
        click: () => timer.toggle(),
      },
      {
        label: '结束专注',
        enabled: state === 'running' || state === 'paused',
        click: () => timer.stop(),
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
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
