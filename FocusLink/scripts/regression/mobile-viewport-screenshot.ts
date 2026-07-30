// Non-interactive responsive acceptance for the mobile build.
// Run from FocusLink/ after `npm run build:web`:
//   npx electron scripts/regression/mobile-viewport-screenshot-entry.cjs
//
// The driver never uses a review query or a temporary harness. It loads the
// production mobile entry, walks all four product views, checks overflow,
// control geometry and renderer console errors, then captures stable evidence.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const outputDir = path.resolve(projectRoot, 'test-data', 'mobile-viewport-screenshots');

const VIEWPORTS = [
  { id: 'phone-360', label: '360px phone', width: 360, height: 800, scale: 3, shell: 'mobile' },
  { id: 'phone-412', label: '412px phone', width: 412, height: 915, scale: 2.625, shell: 'mobile' },
  {
    id: 'tablet-640-portrait',
    label: 'Huawei 640×1024 portrait',
    width: 640,
    height: 1024,
    scale: 2.5,
    shell: 'mobile',
  },
  {
    id: 'tablet-760-portrait',
    label: '760px split boundary',
    width: 760,
    height: 1024,
    scale: 2,
    shell: 'mobile',
  },
  {
    id: 'phone-landscape',
    label: '915×412 landscape',
    width: 915,
    height: 412,
    scale: 2.625,
    shell: 'mobile',
  },
  { id: 'watch', label: 'OPPO OWW221 189×248', width: 189, height: 248, scale: 2, shell: 'watch' },
  {
    id: 'watch-legacy',
    label: 'OPPO OWW221 320×420',
    width: 320,
    height: 420,
    scale: 1.18,
    shell: 'watch',
  },
] as const;

const MOBILE_THEMES = ['light', 'dark'] as const;
const MOBILE_VIEWS = ['专注', '任务', '统计', '设置'] as const;

/** Every locally selectable family must load rather than silently fall back. */
const REQUIRED_FAMILIES = [
  'Noto Sans SC Variable',
  'LXGW WenKai',
  'LXGW Neo ZhiSong',
  'LXGW Marker Gothic',
  'LXGW Neo XiHei',
  'Smiley Sans',
  'JetBrains Mono',
];

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('window-all-closed', () => undefined);

app
  .whenReady()
  .then(async () => {
    fs.mkdirSync(outputDir, { recursive: true });
    const indexPath = path.join(projectRoot, 'dist-mobile', 'index.html');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`dist-mobile 未构建：${indexPath}（先跑 npm run build:web）`);
    }

    for (const viewport of VIEWPORTS) {
      const themes = viewport.shell === 'watch' ? (['dark'] as const) : MOBILE_THEMES;
      for (const theme of themes) {
        await validateViewport(indexPath, viewport, theme);
      }
    }

    console.log('[mobile] responsive acceptance done');
    app.exit(0);
  })
  .catch((error) => {
    console.error('[mobile] responsive acceptance failed', error);
    app.exit(1);
  });

async function validateViewport(
  indexPath: string,
  viewport: (typeof VIEWPORTS)[number],
  theme: (typeof MOBILE_THEMES)[number],
): Promise<void> {
  const rendererErrors: string[] = [];
  const win = new BrowserWindow({
    width: viewport.width,
    height: viewport.height,
    show: false,
    frame: false,
    useContentSize: true,
    backgroundColor: theme === 'dark' ? '#111714' : '#f4f3ed',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      partition: `mobile-smoke-${process.pid}-${viewport.id}-${theme}`,
    },
  });
  win.webContents.setZoomFactor(1);
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 3) rendererErrors.push(`${sourceId}:${line} ${message}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    rendererErrors.push(`render-process-gone ${details.reason}`);
  });
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    rendererErrors.push(`preload-error ${preloadPath} ${error.message}`);
  });

  try {
    await loadAndWait(win, indexPath);
    if (viewport.shell === 'mobile') {
      await setThemeAndReload(win, theme);
    }
    await sleep(500);
    await closeAccountSheet(win);
    win.showInactive();
    await sleep(160);

    const shell = await readShellMetrics(win);
    console.log(`[mobile] ${viewport.id}/${theme} ${JSON.stringify(shell)}`);
    assert(
      Math.abs(shell.innerWidth - viewport.width) <= 1,
      `${viewport.id} width ${shell.innerWidth}`,
    );
    assert(
      Math.abs(shell.innerHeight - viewport.height) <= 1,
      `${viewport.id} height ${shell.innerHeight}`,
    );
    assert(shell.scrollWidth <= shell.innerWidth + 1, `${viewport.id} shell overflow`);

    if (viewport.shell === 'watch') {
      assert(shell.runtime === 'watch-focus', `${viewport.id} did not keep watch renderer`);
      await capture(`${viewport.id}-dark-watch`, win);
      assertNoRendererErrors(viewport.id, rendererErrors);
      return;
    }

    assert(shell.runtime === 'mobile-focus', `${viewport.id} unexpectedly entered watch renderer`);
    assert(shell.theme === theme, `${viewport.id} expected ${theme}, got ${shell.theme}`);
    const expectedNavigation =
      viewport.width >= 760 || viewport.width > viewport.height ? 'sidebar' : 'bottom-tabs';
    assert(
      shell.navigation === expectedNavigation,
      `${viewport.id} expected ${expectedNavigation}, got ${shell.navigation}`,
    );
    assert(shell.smallestNavigationTarget >= 44, `${viewport.id} navigation target below 44px`);

    for (const view of MOBILE_VIEWS) {
      await openView(win, view);
      const metrics = await readViewMetrics(win, view);
      console.log(`[mobile] ${viewport.id}/${theme}/${view} ${JSON.stringify(metrics)}`);
      assert(metrics.scrollWidth <= metrics.innerWidth + 1, `${viewport.id}/${view} overflow`);
      assert(
        metrics.offenders.length === 0,
        `${viewport.id}/${view} offscreen ${metrics.offenders.join(', ')}`,
      );
      assert(metrics.smallestInteractiveTarget >= 44, `${viewport.id}/${view} target below 44px`);
      await capture(`${viewport.id}-${theme}-${view}`, win);
    }

    if (viewport.id === 'phone-412' && theme === 'light') await assertFonts(win);
    assertNoRendererErrors(`${viewport.id}/${theme}`, rendererErrors);
  } finally {
    win.destroy();
  }
}

async function setThemeAndReload(
  win: BrowserWindow,
  theme: (typeof MOBILE_THEMES)[number],
): Promise<void> {
  await win.webContents.executeJavaScript(`
    localStorage.setItem(
      'focuslink.mobile.appearance.v1',
      JSON.stringify({ theme: ${JSON.stringify(theme)}, focusColor: 'emerald', fontProfile: 'noto' })
    );
    localStorage.setItem('focuslink.mobile.endpoint', 'https://127.0.0.1:1');
    localStorage.setItem('focuslink.mobile.remember-token', 'true');
    localStorage.setItem('focuslink.mobile.token.local', 'mobile-smoke-token');
    localStorage.setItem('focuslink.mobile.account-id', 'mobile-smoke-account');
    localStorage.setItem('focuslink.mobile.account-label', '本地验收账号');
  `);
  await reloadAndWait(win);
}

async function closeAccountSheet(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(`
    document.querySelector('.connection-sheet .sheet-close')?.click()
  `);
  await sleep(160);
}

async function openView(win: BrowserWindow, label: (typeof MOBILE_VIEWS)[number]): Promise<void> {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('.app-navigation button')]
      .find((candidate) => candidate.textContent?.includes(${JSON.stringify(label)}));
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  assert(clicked === true, `missing navigation entry ${label}`);
  const expectedSelector: Record<(typeof MOBILE_VIEWS)[number], string> = {
    专注: '.focus-console',
    任务: '.task-browser',
    统计: '.dashboard-view',
    设置: '.settings-view',
  };
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await win.webContents.executeJavaScript(`(() => {
      const active = document.querySelector('.app-navigation button[aria-current="page"]');
      return active?.textContent?.includes(${JSON.stringify(label)}) === true &&
        document.querySelector(${JSON.stringify(expectedSelector[label])}) !== null;
    })()`);
    if (ready === true) {
      await sleep(80);
      return;
    }
    await sleep(50);
  }
  throw new Error(`view did not settle: ${label}`);
}

async function readShellMetrics(win: BrowserWindow): Promise<{
  innerWidth: number;
  innerHeight: number;
  scrollWidth: number;
  runtime?: string;
  theme: string;
  navigation: string;
  smallestNavigationTarget: number;
}> {
  return win.webContents.executeJavaScript(`(() => {
    const navigation = document.querySelector('.app-navigation');
    const navigationStyle = navigation ? getComputedStyle(navigation) : null;
    const targets = [...document.querySelectorAll('.app-navigation button')]
      .map((element) => element.getBoundingClientRect())
      .map((rect) => Math.min(rect.width, rect.height));
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
      runtime: document.documentElement.dataset.runtime,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      navigation: navigationStyle?.position === 'sticky' ? 'sidebar' : navigation ? 'bottom-tabs' : 'none',
      smallestNavigationTarget: targets.length ? Math.min(...targets) : 0,
    };
  })()`);
}

async function readViewMetrics(
  win: BrowserWindow,
  label: string,
): Promise<{
  label: string;
  innerWidth: number;
  scrollWidth: number;
  offenders: string[];
  smallestInteractiveTarget: number;
}> {
  return win.webContents.executeJavaScript(`(() => {
    const tolerance = 1;
    const offenders = [...document.querySelectorAll('main *')]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.position === 'fixed' || style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -tolerance || rect.right > window.innerWidth + tolerance);
      })
      .slice(0, 8)
      .map((element) => element.className || element.tagName.toLowerCase());
    const visibleTargets = [...document.querySelectorAll('main button, main input, main select, main [role="button"]')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map((element) => element.getBoundingClientRect())
      .map((rect) => Math.min(rect.width, rect.height));
    return {
      label: ${JSON.stringify(label)},
      innerWidth: window.innerWidth,
      scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
      offenders,
      smallestInteractiveTarget: visibleTargets.length ? Math.min(...visibleTargets) : 44,
    };
  })()`);
}

async function assertFonts(win: BrowserWindow): Promise<void> {
  const result = await win.webContents.executeJavaScript(`(async () => {
    const out = {};
    for (const family of ${JSON.stringify(REQUIRED_FAMILIES)}) {
      try {
        await document.fonts.load('16px "' + family + '"', '专注时间');
        out[family] = document.fonts.check('16px "' + family + '"', '专注时间');
      } catch (error) {
        out[family] = 'ERROR: ' + String(error && error.message);
      }
    }
    return out;
  })()`);
  const failed = Object.entries(result).filter(([, ok]) => ok !== true);
  for (const [family, state] of Object.entries(result)) {
    console.log(`[mobile] font ${state === true ? 'OK  ' : 'FAIL'} ${family}`);
  }
  if (failed.length > 0)
    throw new Error(`字体未落地：${failed.map(([family]) => family).join(', ')}`);
}

function loadAndWait(win: BrowserWindow, indexPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    win.webContents.once('did-finish-load', () => resolve());
    win.webContents.once('did-fail-load', (_event, code, description) =>
      reject(new Error(`加载失败 ${code} ${description}`)),
    );
    void win.loadFile(indexPath);
  });
}

function reloadAndWait(win: BrowserWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    win.webContents.once('did-finish-load', () => resolve());
    win.webContents.once('did-fail-load', (_event, code, description) =>
      reject(new Error(`重载失败 ${code} ${description}`)),
    );
    win.webContents.reload();
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function capture(tag: string, win: BrowserWindow): Promise<void> {
  // Hidden BrowserWindows can expose the previous compositor frame on the
  // first capture even after React's DOM has settled. Prime once, then persist
  // the next frame so filenames and visible active navigation stay aligned.
  await win.capturePage();
  win.webContents.invalidate();
  await sleep(24);
  const shot = await win.capturePage();
  fs.writeFileSync(path.join(outputDir, `${tag}.png`), shot.toPNG());
}

function assertNoRendererErrors(scope: string, errors: readonly string[]): void {
  if (errors.length > 0) throw new Error(`${scope} console: ${errors.join(' | ')}`);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
