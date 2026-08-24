// 隔离 Electron 实例，走遍桌面端四个页面，捕获明暗两套主题并断言全局排版契约。
// 运行方式（在 FocusLink/ 下）：
//   npx electron scripts/regression/desktop-ui-screenshot-entry.cjs
//
// 断言的重点是「静默失效」这一类问题：CSS 里引用了未定义的自定义属性时，
// 整条声明在计算期作废且不报任何错。`font: 620 13px/1.2 var(--font-display)`
// 这样的简写一旦失效，连字号字重一起丢，标题会悄悄退回浏览器默认值——
// 页面依旧能跑，只是看起来处处不对。这里把结果量出来。
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
const outputDir = path.resolve(projectRoot, 'test-data', 'desktop-ui-screenshots');

const PAGES = [
  { id: 'timer', label: '专注', anchor: '.timer-dial' },
  { id: 'tasks', label: '任务', anchor: '.app-stage' },
  { id: 'history', label: '统计', anchor: '.app-stage' },
  { id: 'settings', label: '设置', anchor: '.settings-page' },
] as const;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app
  .whenReady()
  .then(async () => {
    configureIsolatedUserData('desktop-ui-screenshot', true);
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
    timer.onSnapshot((snapshot) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tick', snapshot);
        mainWindow.webContents.send('timer:state-changed', snapshot);
      }
    });
    mainWindow.loadFile(path.join(projectRoot, 'dist', 'index.html'));
    await waitForDidFinishLoad(mainWindow);
    mainWindow.show();
    await sleep(800);

    // ── 全局排版契约 ──────────────────────────────────────────
    // 这些令牌被 Tailwind 的 font-mono / font-display 与多条 font 简写引用；
    // 未定义时不会报错，只会让排版整体走样。
    const tokens = await mainWindow.webContents.executeJavaScript(`(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        display: style.getPropertyValue('--font-display').trim(),
        mono: style.getPropertyValue('--font-mono').trim(),
        canvas: style.getPropertyValue('--app-canvas').trim(),
        companion: style.getPropertyValue('--app-accent-companion').trim(),
      };
    })()`);
    for (const [name, value] of Object.entries(tokens)) {
      if (!value) throw new Error(`Design token --${name} resolves to nothing`);
    }
    if (!/mono/i.test(String(tokens.mono))) {
      throw new Error(`--font-mono is not a monospace stack: ${String(tokens.mono)}`);
    }
    console.log('[ui] tokens resolve:', JSON.stringify(tokens));

    mainWindow.webContents.send('navigate', 'settings');
    await waitForSelector(mainWindow, '.settings-section-heading h3');
    await sleep(320);

    // 分区标题的字号字重来自一条 font 简写；简写作废时会退回 UA 的 h3 样式
    // （约 1.17em 加粗），这正是「标题莫名其妙很大」的成因。
    const heading = await mainWindow.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('.settings-section-heading h3');
      const style = getComputedStyle(el);
      return { fontSize: style.fontSize, fontWeight: style.fontWeight, family: style.fontFamily };
    })()`);
    if (heading.fontSize !== '15px') {
      throw new Error(`Section heading font shorthand did not apply: ${JSON.stringify(heading)}`);
    }
    console.log('[ui] section heading:', JSON.stringify(heading));

    // font-mono 必须真的落到等宽字体上，否则 CLI 命令与路径全用界面字体显示。
    await mainWindow.webContents.executeJavaScript(`(() => {
      const groups = [...document.querySelectorAll('.settings-nav-list .settings-tab')];
      groups[3]?.click();
    })()`);
    await sleep(320);
    const providerReveal = await mainWindow.webContents.executeJavaScript(`(() => {
      const external = document.querySelector('.settings-external-task-disclosure');
      if (!(external instanceof HTMLDetailsElement)) return false;
      external.open = true;
      const provider = [...external.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('滴答 CLI')
      );
      provider?.click();
      return Boolean(provider);
    })()`);
    if (!providerReveal) throw new Error('Explicit external task import control is unavailable');
    await sleep(320);
    await mainWindow.webContents.executeJavaScript(`
      document.querySelector('.settings-provider-advanced')?.setAttribute('open', '')
    `);
    await sleep(220);
    const monoFamily = await mainWindow.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('.settings-provider-advanced .font-mono');
      return el ? getComputedStyle(el).fontFamily : null;
    })()`);
    if (!monoFamily || !/mono/i.test(String(monoFamily))) {
      throw new Error(`Tailwind font-mono did not resolve: ${String(monoFamily)}`);
    }
    console.log('[ui] font-mono resolves to:', monoFamily);
    await mainWindow.webContents.executeJavaScript(`
      window.focuslink.settings.set({ taskSource: 'local', syncMode: 'local-only' })
    `);
    await sleep(320);

    // ── 子任务折叠：对真实滴答数据验证 ──────────────────────
    // 滴答的子任务有两种形态：任务内嵌的 checklist items，以及带 parentId、
    // 与父任务平级返回的独立任务。后者曾在解析阶段丢掉 parentId，于是既没有
    // 折叠箭头、又和主任务并排列在清单里。单元测试用的是构造数据，这里用本机
    // 真实清单再确认一次。没有 CLI 的机器上跳过，不让视觉回归因环境变红。
    mainWindow.webContents.send('navigate', 'tasks');
    await waitForSelector(mainWindow, '.app-stage');
    await settle(mainWindow, 'tasks');
    const collapse = await mainWindow.webContents.executeJavaScript(`(() => {
      const toggles = [...document.querySelectorAll('.task-workbench-chevron')];
      if (toggles.length === 0) return { skipped: true };
      const rowsBefore = document.querySelectorAll('.task-workbench-row').length;
      const expanded = toggles.filter((t) => t.classList.contains('expanded')).length;
      toggles[0].click();
      return { skipped: false, parents: toggles.length, rowsBefore, expanded };
    })()`);
    if (collapse.skipped) {
      console.log('[ui] subtask collapse: skipped (no parent rows in this environment)');
    } else {
      await sleep(700);
      const rowsAfter = await mainWindow.webContents.executeJavaScript(
        `document.querySelectorAll('.task-workbench-row').length`,
      );
      if (rowsAfter === collapse.rowsBefore) {
        throw new Error(
          `Subtask toggle changed nothing: ${JSON.stringify({ ...collapse, rowsAfter })}`,
        );
      }
      console.log(
        `[ui] subtask collapse works: ${collapse.parents} parents, ` +
          `${collapse.rowsBefore} → ${rowsAfter} rows`,
      );
      await capture('tasks-subtree-collapsed', mainWindow);
    }

    // ── 逐页截图（明 / 暗）+ 溢出检查 ────────────────────────
    for (const theme of ['light', 'dark'] as const) {
      await mainWindow.webContents.executeJavaScript(
        `window.focuslink.settings.set({ theme: ${JSON.stringify(theme)} })`,
      );
      await waitForSelector(mainWindow, `html.${theme}`);
      await sleep(300);
      for (const page of PAGES) {
        mainWindow.webContents.send('navigate', page.id);
        await waitForSelector(mainWindow, page.anchor);
        await settle(mainWindow, page.id);
        await capture(`${theme}-${page.id}`, mainWindow);
      }
    }

    await mainWindow.webContents.executeJavaScript(
      `window.focuslink.settings.set({ theme: 'light' })`,
    );
    await waitForSelector(mainWindow, 'html.light');
    mainWindow.setContentSize(980, 660);
    await sleep(320);
    for (const page of PAGES) {
      mainWindow.webContents.send('navigate', page.id);
      await waitForSelector(mainWindow, page.anchor);
      await settle(mainWindow, page.id);
      const overflow = await mainWindow.webContents.executeJavaScript(`(() => ({
        viewportWidth: window.innerWidth,
        scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
      }))()`);
      if (overflow.scrollWidth > overflow.viewportWidth + 1) {
        throw new Error(`Page "${page.label}" overflowed at 980x660: ${JSON.stringify(overflow)}`);
      }
      await capture(`min-${page.id}`, mainWindow);
    }

    console.log('[ui] all typography and layout assertions passed');
    timer.dispose();
    closeDatabase();
    app.exit(0);
  })
  .catch((error) => {
    console.error('[ui] failed', error);
    try {
      closeDatabase();
    } catch {
      // The database may not have opened yet.
    }
    app.exit(1);
  });

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

/**
 * 任务页要真的去跑一次 dida CLI，进程启动就要好几秒。固定 sleep 只会拍到骨架屏，
 * 看不出实际布局。这里等骨架消失，超时也不报错——本机没装 CLI 时停在读取中
 * 是正确行为，不该让视觉回归因此变红。
 */
async function settle(win: BrowserWindow, pageId: string): Promise<void> {
  if (pageId !== 'tasks') {
    await sleep(520);
    return;
  }
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const loading = await win.webContents.executeJavaScript(
      `Boolean(document.querySelector('.task-skeleton-list'))`,
    );
    if (!loading) break;
    await sleep(250);
  }
  await sleep(600);
}

async function capture(tag: string, win: BrowserWindow): Promise<void> {
  const shot = await win.capturePage();
  fs.writeFileSync(path.join(outputDir, `${tag}.png`), shot.toPNG());
  console.log(`[ui] captured ${tag}`);
}
