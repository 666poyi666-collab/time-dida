// 日志系统 - 所有关键操作写日志
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private logFile: string | null = null;
  private stream: fs.WriteStream | null = null;
  private buffer: string[] = [];

  init(): void {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const today = new Date().toISOString().slice(0, 10);
    this.logFile = path.join(logsDir, `focuslink-${today}.log`);
    this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
    // flush buffer
    this.buffer.forEach((line) => this.stream?.write(line));
    this.buffer = [];
  }

  private write(level: LogLevel, scope: string, msg: string, meta?: unknown): void {
    const ts = new Date().toISOString();
    const metaStr = meta != null ? ' ' + JSON.stringify(meta) : '';
    const line = `[${ts}] [${level.toUpperCase()}] [${scope}] ${msg}${metaStr}\n`;
    if (this.stream) {
      this.stream.write(line);
    } else {
      this.buffer.push(line);
    }
    if (level === 'error') console.error(line.trim());
  }

  debug(scope: string, msg: string, meta?: unknown): void {
    this.write('debug', scope, msg, meta);
  }
  info(scope: string, msg: string, meta?: unknown): void {
    this.write('info', scope, msg, meta);
  }
  warn(scope: string, msg: string, meta?: unknown): void {
    this.write('warn', scope, msg, meta);
  }
  error(scope: string, msg: string, meta?: unknown): void {
    this.write('error', scope, msg, meta);
  }

  getLogDir(): string {
    return path.join(app.getPath('userData'), 'logs');
  }
}

export const logger = new Logger();
