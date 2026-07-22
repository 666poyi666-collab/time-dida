// Capture the currently running packaged app through an explicitly enabled CDP port.
// Usage: node scripts/review/capture-running-app.cjs <port> <outputDir>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9333);
const outputDir = path.resolve(
  process.argv[3] || path.join(os.tmpdir(), 'focuslink-running-app-review'),
);
const captureTimerStates = process.argv.includes('--states');
const captureThemes = process.argv.includes('--themes');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(
    (candidate) =>
      candidate.type === 'page' &&
      /^https?:/.test(candidate.url) &&
      !candidate.url.includes('mini.html'),
  );
  if (!target?.webSocketDebuggerUrl) throw new Error('Main renderer target was not found.');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  let id = 0;
  const pending = new Map();
  socket.on('message', (raw) => {
    const message = JSON.parse(raw);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  const evaluate = (expression) =>
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const capture = async (name) => {
    await delay(700);
    const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(outputDir, `${name}.png`), Buffer.from(result.data, 'base64'));
  };

  fs.mkdirSync(outputDir, { recursive: true });
  await send('Page.enable');
  await send('Runtime.enable');
  await evaluate('window.focuslink.window.show()');
  await delay(600);
  await evaluate(`window.focuslink.settings.set({
    theme: 'light'
  })`);

  for (const [label, name] of [
    ['专注', 'current-focus'],
    ['任务', 'current-tasks'],
    ['统计', 'current-stats'],
    ['设置', 'current-settings'],
  ]) {
    await evaluate(
      `document.querySelector(${JSON.stringify(`button[aria-label="${label}"]`)})?.click()`,
    );
    await capture(name);
  }

  if (captureThemes) {
    await evaluate(`document.querySelector('button[aria-label="专注"]')?.click()`);
    // 单一设计系统：主题族已移除，主题维度 = 明暗 × 五种计时仪表
    for (const style of ['standard', 'flip', 'pixel', 'thin']) {
      for (const appearance of ['light', 'dark']) {
        await evaluate(`window.focuslink.settings.set({
          timerStyle: ${JSON.stringify(style)},
          theme: ${JSON.stringify(appearance)}
        })`);
        await capture(`instrument-${style}-${appearance}-focus`);
      }
    }
    await evaluate(`window.focuslink.settings.set({
      timerStyle: 'standard',
      theme: 'light'
    })`);
  }

  if (captureTimerStates) {
    await evaluate(`document.querySelector('button[aria-label="专注"]')?.click()`);
    await delay(500);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('开始专注')
    )?.click()`);
    await capture('current-focus-running');
    await evaluate(`Array.from(document.querySelectorAll('.timer-controls .btn-main-action')).find(
      (button) => button.textContent?.trim() === '暂停'
    )?.click()`);
    await capture('current-focus-paused');
    await evaluate(`Array.from(document.querySelectorAll('.timer-controls .btn-main-action')).find(
      (button) => button.textContent?.trim() === '继续'
    )?.click()`);
    await delay(900);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '结束'
    )?.click()`);
    await delay(500);
    await evaluate(`document.querySelector('button[aria-label="统计"]')?.click()`);
    await capture('current-stats-with-data');
    await evaluate(`document.querySelector('.history-page')?.scrollTo({ top: 900 })`);
    await capture('current-stats-with-data-lower');

    await evaluate(`(async () => {
      const snapshot = await window.focuslink.timer.getSnapshot();
      if (snapshot.state !== 'idle') await window.focuslink.timer.reset();
      await window.focuslink.timer.toggle();
      await window.focuslink.mini.show();
    })()`);
    await delay(900);
    const miniTarget = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
      (candidate) => candidate.type === 'page' && candidate.url.includes('mini.html'),
    );
    if (!miniTarget?.webSocketDebuggerUrl) throw new Error('Mini renderer target was not found.');
    const miniSocket = new WebSocket(miniTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      miniSocket.once('open', resolve);
      miniSocket.once('error', reject);
    });
    let miniId = 0;
    const miniPending = new Map();
    miniSocket.on('message', (raw) => {
      const message = JSON.parse(raw);
      const request = miniPending.get(message.id);
      if (!request) return;
      miniPending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    const miniSend = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const requestId = ++miniId;
        miniPending.set(requestId, { resolve, reject });
        miniSocket.send(JSON.stringify({ id: requestId, method, params }));
      });
    const miniEvaluate = (expression) =>
      miniSend('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    const miniCapture = async (name) => {
      await delay(500);
      const result = await miniSend('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
      });
      fs.writeFileSync(path.join(outputDir, `${name}.png`), Buffer.from(result.data, 'base64'));
    };
    await miniSend('Page.enable');
    await miniSend('Runtime.enable');
    await miniEvaluate(`window.focuslink.mini.expand()`);
    await miniCapture('current-mini-running-expanded');
    await miniEvaluate(`document.querySelector('button[aria-label="收起"]')?.click()`);
    await miniCapture('current-mini-running-collapsed');
    await miniEvaluate(`document.querySelector('button[aria-label="展开"]')?.click()`);
    await evaluate(`window.focuslink.timer.toggle()`);
    await miniCapture('current-mini-paused-expanded');
    await miniEvaluate(`document.querySelector('button[aria-label="收起"]')?.click()`);
    await miniCapture('current-mini-paused-collapsed');
    await evaluate(`window.focuslink.timer.reset()`);
    miniSocket.close();
  }

  socket.close();
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
