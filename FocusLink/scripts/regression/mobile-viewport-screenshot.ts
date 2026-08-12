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

const FONT_PROFILE_EXPECTATIONS = {
  noto: 'Noto Sans SC Variable',
  wenkai: 'LXGW WenKai',
  zhisong: 'LXGW Neo ZhiSong',
  marker: 'LXGW Marker Gothic',
  xihei: 'LXGW Neo XiHei',
  smiley: 'Smiley Sans',
} as const;

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

    await validateFreshInstall(indexPath);

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
      await seedTaskSnapshot(win);
      await reloadAndWait(win);
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
      const watchTargets = await readWatchMetrics(win);
      assert(
        watchTargets.smallestInteractiveTarget >= 43.95,
        `${viewport.id} watch target below 44px`,
      );
      assert(watchTargets.smallestTextSize >= 9.95, `${viewport.id} watch text below 10px`);
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
    if (expectedNavigation === 'bottom-tabs') {
      assert(shell.navigationHeight <= 96, `${viewport.id} bottom navigation is too tall`);
      assert(
        shell.navigationBottom >= shell.innerHeight - 20,
        `${viewport.id} bottom navigation is not attached to the bottom edge`,
      );
      assert(
        shell.navigationTop >= shell.innerHeight - 120,
        `${viewport.id} bottom navigation covers the content plane`,
      );
    }
    // Chromium can report a 44px CSS minimum as 43.99998px after device-scale
    // rounding. Keep the acceptance threshold strict in intent without making
    // a sub-pixel rasterization artifact a false failure.
    assert(shell.smallestNavigationTarget >= 43.95, `${viewport.id} navigation target below 44px`);

    for (const view of MOBILE_VIEWS) {
      await openView(win, view);
      const metrics = await readViewMetrics(win, view);
      console.log(`[mobile] ${viewport.id}/${theme}/${view} ${JSON.stringify(metrics)}`);
      assert(metrics.scrollWidth <= metrics.innerWidth + 1, `${viewport.id}/${view} overflow`);
      assert(
        metrics.offenders.length === 0,
        `${viewport.id}/${view} offscreen ${metrics.offenders.join(', ')}`,
      );
      assert(
        metrics.smallestInteractiveTarget >= 43.95,
        `${viewport.id}/${view} target below 44px`,
      );
      if (view === '专注' && viewport.width >= 620) {
        const focusLayout = await readFocusLayout(win);
        assert(
          focusLayout.primaryTop < focusLayout.innerHeight && focusLayout.primaryBottom > 0,
          `${viewport.id} primary timer is outside the first viewport`,
        );
        if (viewport.id === 'tablet-640-portrait' || viewport.id === 'phone-landscape') {
          assert(
            focusLayout.primaryTop <= focusLayout.fieldsTop + 1,
            `${viewport.id} task fields precede the primary timer`,
          );
        }
        if (viewport.id === 'tablet-640-portrait') {
          // The 640 portrait tablet keeps the phone bottom navigation and a
          // sticky CTA. At rest the bar floats above the instrument; it must
          // stay above the fixed nav and never cover it.
          assert(
            focusLayout.navigationTop > 0,
            `${viewport.id} bottom navigation missing for sticky CTA reservation`,
          );
          assert(
            focusLayout.hasPrimaryAction &&
              focusLayout.primaryActionBottom > 0 &&
              focusLayout.primaryActionTop < focusLayout.innerHeight,
            `${viewport.id} sticky primary focus action is not visible (${focusLayout.primaryActionTop}–${focusLayout.primaryActionBottom})`,
          );
          assert(
            focusLayout.actionsBottom <= focusLayout.navigationTop + 1,
            `${viewport.id} sticky focus CTA covers the bottom navigation (${focusLayout.actionsBottom} vs ${focusLayout.navigationTop})`,
          );
          // The instrument reserves its trailing height so the ribbon and the
          // runtime metrics are fully readable at the end of the content.
          await scrollFocusView(win, 'bottom');
          const pinned = await readFocusLayout(win);
          assert(
            pinned.actionOverlaps.length === 0,
            `${viewport.id} sticky focus CTA hides ${pinned.actionOverlaps.join(', ')} at the end of the instrument`,
          );
          assert(
            pinned.actionsBottom <= pinned.navigationTop + 1,
            `${viewport.id} sticky focus CTA covers the bottom navigation after scrolling (${pinned.actionsBottom} vs ${pinned.navigationTop})`,
          );
          await scrollFocusView(win, 'top');
        } else {
          assert(
            focusLayout.actionOverlaps.length === 0,
            `${viewport.id} focus actions overlap ${focusLayout.actionOverlaps.join(', ')}`,
          );
        }
        if (viewport.id === 'phone-landscape') {
          assert(
            focusLayout.hasActions &&
              focusLayout.actionsTop >= -1 &&
              focusLayout.actionsBottom <= focusLayout.innerHeight + 1,
            `${viewport.id} focus actions are clipped (${focusLayout.actionsTop}–${focusLayout.actionsBottom} of ${focusLayout.innerHeight})`,
          );
          assert(
            focusLayout.hasPrimaryAction &&
              focusLayout.primaryActionTop >= -1 &&
              focusLayout.primaryActionBottom <= focusLayout.innerHeight + 1,
            `${viewport.id} primary focus action is clipped (${focusLayout.primaryActionTop}–${focusLayout.primaryActionBottom} of ${focusLayout.innerHeight})`,
          );
        }
      }
      if (view === '专注' && viewport.width < 620) {
        const focusLayout = await readFocusLayout(win);
        assert(
          focusLayout.navigationTop > 0,
          `${viewport.id} bottom navigation missing for sticky CTA reservation`,
        );
        assert(
          focusLayout.hasPrimaryAction &&
            focusLayout.primaryActionBottom > 0 &&
            focusLayout.primaryActionTop < focusLayout.innerHeight,
          `${viewport.id} sticky primary focus action is not visible (${focusLayout.primaryActionTop}–${focusLayout.primaryActionBottom})`,
        );
        assert(
          focusLayout.actionsBottom <= focusLayout.navigationTop + 1,
          `${viewport.id} sticky focus CTA covers the bottom navigation (${focusLayout.actionsBottom} vs ${focusLayout.navigationTop})`,
        );
        await scrollFocusView(win, 'bottom');
        const pinned = await readFocusLayout(win);
        assert(
          pinned.actionOverlaps.length === 0,
          `${viewport.id} sticky focus CTA hides ${pinned.actionOverlaps.join(', ')} at the end of the instrument`,
        );
        assert(
          pinned.actionsBottom <= pinned.navigationTop + 1,
          `${viewport.id} sticky focus CTA covers the bottom navigation after scrolling (${pinned.actionsBottom} vs ${pinned.navigationTop})`,
        );
        await scrollFocusView(win, 'top');
      }
      await capture(`${viewport.id}-${theme}-${view}`, win);
      if (
        view === '任务' &&
        theme === 'light' &&
        (viewport.id === 'phone-360' || viewport.id === 'tablet-760-portrait')
      ) {
        await captureExpandedTaskTree(viewport.id, win);
      }
    }

    if (viewport.id === 'phone-412' && theme === 'light') {
      await assertFonts(win);
      await assertFontProfiles(win);
    }
    assertNoRendererErrors(`${viewport.id}/${theme}`, rendererErrors);
  } finally {
    win.destroy();
  }
}

async function validateFreshInstall(indexPath: string): Promise<void> {
  const win = new BrowserWindow({
    width: 360,
    height: 800,
    show: false,
    frame: false,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: `mobile-smoke-fresh-${process.pid}`,
    },
  });
  try {
    await loadAndWait(win, indexPath);
    await sleep(500);
    const initial = await win.webContents.executeJavaScript(`(() => ({
      sheetOpen: document.querySelector('.connection-sheet') !== null,
      localStartVisible: [...document.querySelectorAll('.focus-action.primary')].some((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }),
    }))()`);
    assert(!initial.sheetOpen, 'fresh install is locked behind the account sheet');
    assert(initial.localStartVisible, 'fresh install cannot reach local focus start');

    await win.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#focus-title');
      if (!input) throw new Error('offline title input missing');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '本机离线验收');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(100);
    const offlineStartEnabled = await win.webContents.executeJavaScript(
      `document.querySelector('.focus-action.primary')?.disabled === false`,
    );
    assert(offlineStartEnabled === true, 'fresh install cannot enable local focus start');

    await win.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes('登录并同步')
      );
      if (!button) throw new Error('login entry missing');
      button.click();
    })()`);
    await sleep(200);
    const closable = await win.webContents.executeJavaScript(`(() => {
      const close = document.querySelector('[aria-label="关闭账号设置，返回本机模式"]');
      if (!close) return false;
      close.click();
      return true;
    })()`);
    assert(closable === true, 'unauthenticated account sheet has no local-mode close action');
    let closed = false;
    for (let attempt = 0; attempt < 20 && !closed; attempt += 1) {
      await sleep(100);
      closed = await win.webContents.executeJavaScript(
        `document.querySelector('.connection-sheet') === null`,
      );
    }
    assert(closed === true, 'unauthenticated account sheet did not close');
    console.log('[mobile] fresh-install local focus entry OK');
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
    localStorage.setItem(
      'focuslink.mobile.endpoint',
      'https://foxlink-mcp.focuslink-poyi-6465e9.workers.dev'
    );
    localStorage.setItem('focuslink.mobile.remember-token', 'true');
    localStorage.setItem(
      'focuslink.mobile.token.local',
      'fl2_smoke-account_smoke-device_0123456789abcdefghijklmnopqrstuvwxyzABCD'
    );
    localStorage.setItem('focuslink.mobile.account-id', 'smoke-account');
    localStorage.setItem('focuslink.mobile.account-label', '本地验收账号');
  `);
  await reloadAndWait(win);
}

async function seedTaskSnapshot(win: BrowserWindow): Promise<void> {
  const seeded = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const request = indexedDB.open('focuslink-mobile-preview', 5);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('meta', 'readwrite');
      const now = Date.now();
      transaction.objectStore('meta').put({
        key: 'taskSnapshot',
        value: {
          accountId: 'smoke-account',
          cachedAt: now,
          snapshot: {
            protocolVersion: 1,
            revision: 12,
            sourceDeviceId: 'device-desktop-smoke',
            serverTime: now,
            snapshot: {
              publishedAt: now - 60_000,
              projects: [
                { id: 'project-study', source: 'ticktick', name: '学习清单', color: '#0a8f68' },
                { id: 'project-review', source: 'ticktick', name: '本周复习', color: '#5b6fd8' }
              ],
              tasks: [
                { id: 'task-biology', source: 'ticktick', projectId: 'project-study', title: '生物 22–26 节复习', status: '0', priority: 3, dueDate: null, tags: ['生物', '复习'], parentId: null, isCompleted: false, updatedAt: now },
                { id: 'task-biology-22', source: 'ticktick', projectId: 'project-study', title: '第 22 节：遗传信息整理', status: '0', priority: 1, dueDate: null, tags: ['生物'], parentId: 'task-biology', isCompleted: false, updatedAt: now },
                { id: 'task-biology-23', source: 'ticktick', projectId: 'project-study', title: '第 23 节：错题回顾', status: '0', priority: 1, dueDate: null, tags: ['错题'], parentId: 'task-biology', isCompleted: false, updatedAt: now },
                { id: 'task-chemistry', source: 'ticktick', projectId: 'project-study', title: '整理化学实验题', status: '0', priority: 2, dueDate: null, tags: ['化学'], parentId: null, isCompleted: false, updatedAt: now },
                { id: 'task-weekly', source: 'ticktick', projectId: 'project-review', title: '周末知识点复盘', status: '0', priority: 0, dueDate: null, tags: ['复盘'], parentId: null, isCompleted: false, updatedAt: now },
                { id: 'task-weekly-notes', source: 'ticktick', projectId: 'project-review', title: '补全课堂笔记', status: '0', priority: 0, dueDate: null, tags: ['笔记'], parentId: 'task-weekly', isCompleted: false, updatedAt: now }
              ]
            }
          }
        }
      });
      transaction.oncomplete = () => { database.close(); resolve(true); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  })`);
  assert(seeded === true, 'mobile viewport smoke could not seed the cloud task snapshot');
}

async function captureExpandedTaskTree(viewportId: string, win: BrowserWindow): Promise<void> {
  const opened = await win.webContents.executeJavaScript(`(() => {
    const toggle = document.querySelector('.task-project-toggle');
    if (!(toggle instanceof HTMLButtonElement)) return false;
    toggle.click();
    return true;
  })()`);
  assert(opened === true, `${viewportId} missing cloud task project disclosure`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const visible = await win.webContents.executeJavaScript(
      `document.querySelector('.task-project-group.is-open .task-list') !== null`,
    );
    if (visible === true) {
      await sleep(80);
      const metrics = await readViewMetrics(win, '任务');
      assert(metrics.scrollWidth <= metrics.innerWidth + 1, `${viewportId}/任务展开 overflow`);
      assert(metrics.offenders.length === 0, `${viewportId}/任务展开 offscreen`);
      await capture(`${viewportId}-light-任务展开`, win);
      return;
    }
    await sleep(50);
  }
  throw new Error(`${viewportId} task project disclosure did not open`);
}

async function closeAccountSheet(win: BrowserWindow): Promise<void> {
  const sheetState = await win.webContents.executeJavaScript(`(() => {
    const sheet = document.querySelector('.connection-sheet');
    if (!sheet) return 'absent';
    const close = sheet.querySelector('.sheet-close');
    if (!(close instanceof HTMLButtonElement)) return 'unclosable';
    close.click();
    return 'clicked';
  })()`);
  if (sheetState === 'absent') return;
  if (sheetState !== 'clicked') {
    const diagnostic = await win.webContents.executeJavaScript(`(() => ({
      endpoint: localStorage.getItem('focuslink.mobile.endpoint'),
      remember: localStorage.getItem('focuslink.mobile.remember-token'),
      tokenLength: localStorage.getItem('focuslink.mobile.token.local')?.length ?? 0,
      sheetText: document.querySelector('.connection-sheet')?.textContent?.trim().slice(0, 160)
    }))()`);
    throw new Error(
      `configured mobile smoke account did not expose sheet close: ${JSON.stringify(diagnostic)}`,
    );
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const closed = await win.webContents.executeJavaScript(
      `document.querySelector('.connection-sheet') === null`,
    );
    if (closed === true) return;
    await sleep(50);
  }
  throw new Error('mobile account sheet did not close before viewport capture');
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
  navigationTop: number;
  navigationBottom: number;
  navigationHeight: number;
  smallestNavigationTarget: number;
  overflowElements: string[];
}> {
  return win.webContents.executeJavaScript(`(() => {
    const navigation = document.querySelector('.app-navigation');
    const navigationStyle = navigation ? getComputedStyle(navigation) : null;
    const navigationRect = navigation?.getBoundingClientRect();
    const targets = [...document.querySelectorAll('.app-navigation button')]
      .map((element) => element.getBoundingClientRect())
      .map((rect) => Math.min(rect.width, rect.height));
    const overflowElements = [...document.querySelectorAll('body *')]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
      })
      .slice(0, 8)
      .map((element) => element.className || element.tagName.toLowerCase());
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
      runtime: document.documentElement.dataset.runtime,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      navigation: navigationStyle?.position === 'sticky' ? 'sidebar' : navigation ? 'bottom-tabs' : 'none',
      navigationTop: navigationRect?.top ?? 0,
      navigationBottom: navigationRect?.bottom ?? 0,
      navigationHeight: navigationRect?.height ?? 0,
      smallestNavigationTarget: targets.length ? Math.min(...targets) : 0,
      overflowElements,
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

async function readWatchMetrics(win: BrowserWindow): Promise<{
  smallestInteractiveTarget: number;
  smallestTextSize: number;
}> {
  return win.webContents.executeJavaScript(`(() => {
    const targets = [...document.querySelectorAll('.watch-shell button')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map((element) => element.getBoundingClientRect())
      .map((rect) => Math.min(rect.width, rect.height));
    const textSizes = [...document.querySelectorAll(
      '.watch-state-line, .watch-subline, .watch-task-line, .watch-hint, .watch-notice, .watch-login button, .watch-actions button, .watch-task-list > button'
    )]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    return {
      smallestInteractiveTarget: targets.length ? Math.min(...targets) : 44,
      smallestTextSize: textSizes.length ? Math.min(...textSizes) : 10,
    };
  })()`);
}

async function scrollFocusView(win: BrowserWindow, edge: 'top' | 'bottom'): Promise<void> {
  await win.webContents.executeJavaScript(`(() => {
    window.scrollTo(0, ${edge === 'bottom' ? 'document.documentElement.scrollHeight' : '0'});
  })()`);
  await sleep(120);
}

async function readFocusLayout(win: BrowserWindow): Promise<{
  innerHeight: number;
  primaryTop: number;
  primaryBottom: number;
  fieldsTop: number;
  actionsTop: number;
  actionsBottom: number;
  primaryActionTop: number;
  primaryActionBottom: number;
  hasActions: boolean;
  hasPrimaryAction: boolean;
  navigationTop: number;
  actionOverlaps: string[];
}> {
  return win.webContents.executeJavaScript(`(() => {
    const primary = document.querySelector('.primary-readout')?.getBoundingClientRect();
    const fields = document.querySelector('.focus-start-fields, .active-title-block')?.getBoundingClientRect();
    const actions = document.querySelector('.focus-actions')?.getBoundingClientRect();
    const primaryAction = document.querySelector('.focus-action.primary')?.getBoundingClientRect();
    const navigation = document.querySelector('.app-navigation')?.getBoundingClientRect();
    const candidates = [
      ['task fields', document.querySelector('.focus-start-fields, .active-title-block')],
      ['primary timer', document.querySelector('.primary-readout')],
      ['timeline', document.querySelector('.mobile-temporal-ribbon')],
      ['runtime metrics', document.querySelector('.runtime-metrics')],
      // The sticky focus CTA must never cover the fixed bottom navigation on
      // phones and the 640 portrait tablet; it sticks above the nav instead.
      ['bottom navigation', document.querySelector('.app-navigation')],
    ];
    const intersects = (left, right) =>
      left.left < right.right - 1 && left.right > right.left + 1 &&
      left.top < right.bottom - 1 && left.bottom > right.top + 1;
    const actionOverlaps = actions
      ? candidates.filter(([, element]) => {
          if (!element) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && rect.width > 0 && rect.height > 0 && intersects(actions, rect);
        }).map(([label]) => label)
      : [];
    return {
      innerHeight: window.innerHeight,
      primaryTop: primary?.top ?? Number.POSITIVE_INFINITY,
      primaryBottom: primary?.bottom ?? Number.NEGATIVE_INFINITY,
      fieldsTop: fields?.top ?? Number.POSITIVE_INFINITY,
      actionsTop: actions?.top ?? Number.POSITIVE_INFINITY,
      actionsBottom: actions?.bottom ?? Number.NEGATIVE_INFINITY,
      primaryActionTop: primaryAction?.top ?? Number.POSITIVE_INFINITY,
      primaryActionBottom: primaryAction?.bottom ?? Number.NEGATIVE_INFINITY,
      hasActions: Boolean(actions),
      hasPrimaryAction: Boolean(primaryAction),
      navigationTop: navigation?.top ?? Number.POSITIVE_INFINITY,
      actionOverlaps,
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

async function assertFontProfiles(win: BrowserWindow): Promise<void> {
  const result = await win.webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const shell = document.querySelector('.mobile-shell');
    const profiles = ${JSON.stringify(FONT_PROFILE_EXPECTATIONS)};
    const classNames = Object.keys(profiles).map((profile) => 'font-profile-' + profile);
    const previous = classNames.filter((className) => root.classList.contains(className));
    const out = {};
    for (const [profile, expected] of Object.entries(profiles)) {
      root.classList.remove(...classNames);
      root.classList.add('font-profile-' + profile);
      const family = shell ? getComputedStyle(shell).fontFamily : '';
      out[profile] = { expected, family, applied: family.includes(expected) };
    }
    root.classList.remove(...classNames);
    root.classList.add(...previous);
    return out;
  })()`);
  const failed = Object.entries(result).filter(
    ([, value]) => !(value as { applied?: boolean }).applied,
  );
  for (const [profile, value] of Object.entries(result)) {
    const state = value as { applied: boolean; family: string };
    console.log(
      `[mobile] font-profile ${state.applied ? 'OK  ' : 'FAIL'} ${profile}: ${state.family}`,
    );
  }
  if (failed.length > 0) {
    throw new Error(`字体选择未作用于主界面：${failed.map(([profile]) => profile).join(', ')}`);
  }
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
