// CLI 预留 - 通过本地 HTTP/IPC 与主进程通信
// 当前为骨架，MVP 阶段不集成到打包流程
//
// 预期命令：
//   focuslink start | pause | resume | stop | status
//   focuslink list-sessions | list-tasks
//   focuslink link-task --segment <id> --task <id>
//   focuslink sync
//
// 实现方式：主进程启动一个本地 HTTP server (127.0.0.1:随机端口)，
// 将端口写入 userData/cli-port 文件，CLI 读取后发请求。
// 当前导出命令注册函数，后续在 main.ts 中启用。
import http from 'node:http';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { TimerManager } from './timer/manager.js';
import { logger } from './logger.js';

let server: http.Server | null = null;

export function startCliServer(timer: TimerManager): void {
  if (server) return;
  server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      switch (url.pathname) {
        case '/status':
          res.end(JSON.stringify(timer.getSnapshot()));
          return;
        case '/toggle':
          res.end(JSON.stringify(timer.toggle()));
          return;
        case '/pause':
          res.end(JSON.stringify(timer.pause()));
          return;
        case '/resume':
          res.end(JSON.stringify(timer.resume()));
          return;
        case '/stop':
          res.end(JSON.stringify(timer.stop()));
          return;
        default:
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'not found' }));
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
  server.listen(0, '127.0.0.1', () => {
    const addr = server?.address();
    if (addr && typeof addr === 'object') {
      const port = addr.port;
      const portFile = path.join(app.getPath('userData'), 'cli-port');
      fs.writeFileSync(portFile, String(port));
      logger.info('cli', `CLI server listening on 127.0.0.1:${port}`);
    }
  });
}

export function stopCliServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}
