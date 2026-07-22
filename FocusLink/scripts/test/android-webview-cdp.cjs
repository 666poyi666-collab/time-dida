const WebSocket = require('ws');

const port = Number(process.env.FOCUSLINK_CDP_PORT || '9222');
const expression = process.env.FOCUSLINK_CDP_EXPRESSION;
if (!expression) throw new Error('FOCUSLINK_CDP_EXPRESSION is required');

async function main() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
    if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
    return response.json();
  });
  const target = targets.find((candidate) => candidate.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('No debuggable Android WebView page found');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    if (!message.id) return;
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    if (message.error) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  try {
    await call('Runtime.enable');
    const result = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'WebView evaluation failed');
    }
    process.stdout.write(`${JSON.stringify(result.result?.value ?? null)}\n`);
  } finally {
    socket.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || String(error)}\n`);
  process.exitCode = 1;
});
