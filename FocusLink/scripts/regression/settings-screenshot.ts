// 隔离 Electron 实例，逐个分组截图设置页，并断言信息架构的硬约束。
// 运行方式（在 FocusLink/ 下）：
//   npx electron scripts/regression/settings-screenshot-entry.cjs
//
// 断言的是「重构后不能再退回去」的性质，而不是像素：
//   - 每个分组都必须有内容（空分组说明注册表里 tab 写错了）；
//   - 每个分区在整页中只出现一次（旧结构把一个 tab 拆成 5 段的直接后果就是重复渲染）；
//   - 滴答清单的「怎么连」和「同步什么」必须落在同一个分组里；
//   - 搜索必须能跨分组命中标题里没有的词；
//   - 最小窗口下不产生横向溢出。
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureIsolatedUserData } from './isolatedUserData';
import { initDatabase, closeDatabase } from '../../electron/db/index.js';
import { TimerManager } from '../../electron/timer/manager.js';
import { FocusTimerController } from '../../electron/timer/focusTimerController.js';
import { registerIpc } from '../../electron/ipc.js';
import { MAIN_WINDOW_DEFAULT_SIZE } from '@shared/mainWindowLayout';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const outputDir = path.resolve(projectRoot, 'test-data', 'settings-screenshots');

const TAB_LABELS = ['外观', '专注', '快捷键', '连接与同步', '跨设备', '系统'] as const;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app
  .whenReady()
  .then(async () => {
    configureIsolatedUserData('settings-screenshot', true);
    fs.mkdirSync(outputDir, { recursive: true });
    initDatabase();

    const timer = new FocusTimerController(new TimerManager());
    timer.recover();

    const mainWindow = new BrowserWindow({
      width: MAIN_WINDOW_DEFAULT_SIZE.width,
      height: MAIN_WINDOW_DEFAULT_SIZE.height,
      show: false,
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: '#f5f7f4',
      webPreferences: {
        preload: path.join(projectRoot, 'dist-electron', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    registerIpc(timer, mainWindow, () => undefined);
    mainWindow.loadFile(path.join(projectRoot, 'dist', 'index.html'));
    await waitForDidFinishLoad(mainWindow);
    mainWindow.show();
    await sleep(700);

    mainWindow.webContents.send('navigate', 'settings');
    await waitForSelector(mainWindow, '.settings-page');
    await sleep(420);

    // 导航项必须与预期分组完全一致，顺序也要对上。
    const navLabels: string[] = await mainWindow.webContents.executeJavaScript(
      `[...document.querySelectorAll('.settings-nav-list .settings-tab')].map((b) => b.textContent.trim())`,
    );
    if (navLabels.join('|') !== TAB_LABELS.join('|')) {
      throw new Error(`Unexpected settings tabs: ${JSON.stringify(navLabels)}`);
    }

    // 逐个分组：截图 + 断言非空 + 记录分区标题。
    const seenTitles = new Map<string, string>();
    for (const [index, label] of TAB_LABELS.entries()) {
      await clickTab(mainWindow, index);
      await sleep(360);
      const titles = await sectionTitles(mainWindow);
      if (titles.length === 0) {
        throw new Error(`Settings group "${label}" rendered no sections`);
      }
      for (const title of titles) {
        const previous = seenTitles.get(title);
        if (previous) {
          throw new Error(`Section "${title}" appears in both "${previous}" and "${label}"`);
        }
        seenTitles.set(title, label);
      }
      await captureMain(`settings-${String(index)}-${label}`, mainWindow);
      console.log(`[settings] ${label}: ${titles.join(' / ')}`);
    }

    // 番茄同步默认关闭。隔离夹具临时开启后确认四个事实域同时可见，
    // 只读取桥接状态，不触发连接、启动外部应用或上传业务记录。
    await mainWindow.webContents.executeJavaScript(`(async () => {
      const current = await window.focuslink.settings.get();
      await window.focuslink.settings.set({
        tomatodo: { ...current.tomatodo, enabled: true },
      });
    })()`);
    await clickTab(mainWindow, 3);
    await sleep(420);
    const tomatodoFacts: string[] = await mainWindow.webContents.executeJavaScript(
      `[...document.querySelectorAll('.settings-tomatodo-overview .settings-fact-copy > span:first-child')].map((el) => el.textContent.trim())`,
    );
    const expectedTomatodoFacts = ['本机写入', '上传队列', '桌面桥接', '手机端显示'];
    if (tomatodoFacts.join('|') !== expectedTomatodoFacts.join('|')) {
      throw new Error(`Unexpected TomaToDo status facts: ${JSON.stringify(tomatodoFacts)}`);
    }
    await captureMain('settings-integrations-tomatodo', mainWindow);

    // 选择 FocusLink 本地任务时，滴答清单区块按产品边界隐藏；若用户显式选择外部来源，
    // 连接方式与同步去向必须同组，这正是重构要解决的拆分。
    const connectionGroup = seenTitles.get('滴答清单 · 连接方式');
    const destinationGroup = seenTitles.get('滴答清单 · 同步去向');
    if ((connectionGroup || destinationGroup) && connectionGroup !== destinationGroup) {
      throw new Error(
        `Dida connection/destination split across groups: ${connectionGroup} vs ${destinationGroup}`,
      );
    }

    // 搜索：跨分组，且能命中只存在于 keywords 的词。
    await clickTab(mainWindow, 0);
    await sleep(220);
    await typeSearch(mainWindow, '自启动');
    await sleep(320);
    const autostart = await sectionTitles(mainWindow);
    if (!autostart.includes('系统与后台运行')) {
      throw new Error(`Keyword search missed its section: ${JSON.stringify(autostart)}`);
    }
    // 搜索结果必须标出来源分组，否则用户不知道下次去哪找。
    const groupChips: string[] = await mainWindow.webContents.executeJavaScript(
      `[...document.querySelectorAll('.settings-section-group')].map((el) => el.textContent.trim())`,
    );
    if (groupChips.length !== autostart.length) {
      throw new Error(`Search results missing group chips: ${JSON.stringify(groupChips)}`);
    }
    await captureMain('settings-search-keyword', mainWindow);

    await typeSearch(mainWindow, '二维码');
    await sleep(320);
    const qr = await sectionTitles(mainWindow);
    if (!qr.includes('设备配对与同步')) {
      throw new Error(`Cross-group search failed: ${JSON.stringify(qr)}`);
    }

    // 空结果必须给出明确出口，而不是一片空白。
    await typeSearch(mainWindow, 'zzz不存在的设置');
    await sleep(320);
    await waitForSelector(mainWindow, '.settings-empty');
    await captureMain('settings-search-empty', mainWindow);

    await typeSearch(mainWindow, '');
    await sleep(260);

    // 深色主题：整页与「连接与同步」组各一张。
    await mainWindow.webContents.executeJavaScript(
      `window.focuslink.settings.set({ theme: 'dark' })`,
    );
    await waitForSelector(mainWindow, 'html.dark');
    await sleep(420);
    await captureMain('settings-dark-appearance', mainWindow);
    await clickTab(mainWindow, 3);
    await sleep(360);
    await captureMain('settings-dark-integrations', mainWindow);
    await mainWindow.webContents.executeJavaScript(
      `window.focuslink.settings.set({ theme: 'light' })`,
    );
    await waitForSelector(mainWindow, 'html.light');
    await sleep(320);

    // 最小主窗下不允许横向溢出（设置页有多列选择器，最容易在这里破）。
    mainWindow.setContentSize(980, 660);
    await sleep(360);
    for (const [index, label] of TAB_LABELS.entries()) {
      await clickTab(mainWindow, index);
      await sleep(280);
      const layout = await mainWindow.webContents.executeJavaScript(`(() => {
        const scroll = document.querySelector('.settings-scroll');
        return {
          viewportWidth: window.innerWidth,
          documentScrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
          contentScrollWidth: scroll ? scroll.scrollWidth : 0,
          contentClientWidth: scroll ? scroll.clientWidth : 0,
        };
      })()`);
      if (layout.documentScrollWidth > layout.viewportWidth + 1) {
        throw new Error(`Settings "${label}" overflowed the window: ${JSON.stringify(layout)}`);
      }
      if (layout.contentScrollWidth > layout.contentClientWidth + 1) {
        throw new Error(`Settings "${label}" overflowed its column: ${JSON.stringify(layout)}`);
      }
    }
    await captureMain('settings-980x660', mainWindow);

    console.log('[settings] all structural assertions passed');
    timer.dispose();
    closeDatabase();
    app.exit(0);
  })
  .catch((error) => {
    console.error('[settings] failed', error);
    try {
      closeDatabase();
    } catch {
      // The database may not have opened yet.
    }
    app.exit(1);
  });

async function clickTab(win: BrowserWindow, index: number): Promise<void> {
  await win.webContents.executeJavaScript(
    `document.querySelectorAll('.settings-nav-list .settings-tab')[${index}]?.click()`,
  );
}

async function sectionTitles(win: BrowserWindow): Promise<string[]> {
  return win.webContents.executeJavaScript(`
    [...document.querySelectorAll('.settings-section-heading h3')].map((h) => {
      const clone = h.cloneNode(true);
      clone.querySelector('.settings-section-group')?.remove();
      return clone.textContent.trim();
    })
  `);
}

/** 通过原生 setter 派发 input 事件，让 React 的受控输入真正收到变更。 */
async function typeSearch(win: BrowserWindow, value: string): Promise<void> {
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.settings-search-input');
    if (!input) throw new Error('settings search input not found');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value',
    ).set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: ${JSON.stringify(value)},
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

function waitForDidFinishLoad(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (win.webContents.isLoadingMainFrame()) {
      win.webContents.once('did-finish-load', () => resolve());
    } else {
      resolve();
    }
  });
}

function waitForSelector(win: BrowserWindow, selector: string, timeoutMs = 8000): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      if (win.isDestroyed()) {
        reject(new Error(`Window closed while waiting for selector: ${selector}`));
        return;
      }
      const present = await win.webContents.executeJavaScript(
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      );
      if (present) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for selector ${selector}`));
        return;
      }
      setTimeout(() => void check(), 50);
    };
    void check();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureMain(tag: string, win: BrowserWindow): Promise<void> {
  const shot = await win.capturePage();
  fs.writeFileSync(path.join(outputDir, `${tag}.png`), shot.toPNG());
  console.log(`[settings] captured ${tag}`);
}
