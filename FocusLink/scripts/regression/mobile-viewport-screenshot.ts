// 在真实设备视口下加载移动端构建产物，截图并断言字体真的落地。
// 运行方式（在 FocusLink/ 下，需先 npm run build:web）：
//   npx electron scripts/regression/mobile-viewport-screenshot-entry.cjs
//
// 为什么不用真机迭代：一次 adb 截图往返要十几秒，还要处理息屏、解锁、
// 导航。这里用与设备等同的 CSS 视口和 DPR 在本地跑，秒级出图；真机只做最后验收。
//
// 视口取自本机三台设备的实测值（adb shell wm size / wm density）：
//   华为 DBY-W09  1600×2560 @400dpi → 640×1024 dp
//   小米 22041216C 1080×2460 @440dpi → 393×895 dp
//   OPPO OWW221    378×496 物理；WebView 有 320px 视口下限 → 实际 320×420 CSS @1.18x
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const outputDir = path.resolve(projectRoot, 'test-data', 'mobile-viewport-screenshots');

const VIEWPORTS = [
  { id: 'phone', label: '小米 22041216C', width: 393, height: 895, scale: 2.75 },
  { id: 'tablet', label: '华为 DBY-W09', width: 640, height: 1024, scale: 2.5 },
  // 同一块表在不同启动条件下报告过两种 CSS 视口，两种都必须过。
  { id: 'watch', label: 'OPPO OWW221 (189×248 @2x)', width: 189, height: 248, scale: 2 },
  {
    id: 'watch-legacy',
    label: 'OPPO OWW221 (320×420 @1.18x)',
    width: 320,
    height: 420,
    scale: 1.18,
  },
] as const;

/** 六个可选字族都必须真的能用；任何一个静默回退，选它的用户就永远看不到自己选的字。 */
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

// 逐个视口开关窗口；不拦截的话销毁最后一个窗口会触发默认的 window-all-closed 退出，
// 跑完第一个视口就静默结束，看起来像"卡住了"。
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
      const win = new BrowserWindow({
        width: viewport.width,
        height: viewport.height,
        show: false,
        frame: false,
        useContentSize: true,
        backgroundColor: '#f4f3ed',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
      });
      win.webContents.setZoomFactor(1);
      await loadAndWait(win, indexPath);
      win.show();
      await sleep(2200);

      // 未配置同步时会自动弹出全屏「连接同步服务」面板，挡住整个主界面。
      // 要看的是主界面，先关掉它。（这个首启体验本身是待改的问题，另计。）
      await win.webContents.executeJavaScript(`
        document.querySelector('.connection-sheet .sheet-close')?.click()
      `);
      await sleep(900);

      const metrics = await win.webContents.executeJavaScript(`(() => ({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        // 横向溢出在小屏上是最常见的破版，先量出来。
        scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
        rootClasses: document.documentElement.className,
        runtime: document.documentElement.dataset.runtime,
      }))()`);
      console.log(`[mobile] ${viewport.id} (${viewport.label}) ${JSON.stringify(metrics)}`);
      if (metrics.scrollWidth > metrics.innerWidth + 1) {
        throw new Error(`${viewport.id} 横向溢出：${metrics.scrollWidth} > ${metrics.innerWidth}`);
      }
      // 手表视口必须分流到手表壳层，绝不允许整套控制台被塞进 189dp。
      if (viewport.id.startsWith('watch') && metrics.runtime !== 'watch-focus') {
        throw new Error(`watch 视口未启用手表壳层：runtime=${String(metrics.runtime)}`);
      }

      await capture(`${viewport.id}-light`, win);

      if (viewport.id === 'phone') {
        await assertFonts(win);
      }

      win.destroy();
    }

    console.log('[mobile] done');
    app.exit(0);
  })
  .catch((error) => {
    console.error('[mobile] failed', error);
    app.exit(1);
  });

/**
 * document.fonts.load 会真正触发下载并解析字形；只用 check() 在字体尚未被任何
 * 元素引用时永远返回 false，测不出「文件缺失」和「还没用到」的区别。
 */
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
  if (failed.length > 0) {
    throw new Error(`字体未落地：${failed.map(([f]) => f).join(', ')}`);
  }
}

function loadAndWait(win: BrowserWindow, indexPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    win.webContents.once('did-finish-load', () => resolve());
    win.webContents.once('did-fail-load', (_e, code, desc) =>
      reject(new Error(`加载失败 ${code} ${desc}`)),
    );
    void win.loadFile(indexPath);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function capture(tag: string, win: BrowserWindow): Promise<void> {
  const shot = await win.capturePage();
  fs.writeFileSync(path.join(outputDir, `${tag}.png`), shot.toPNG());
  console.log(`[mobile] captured ${tag}`);
}
