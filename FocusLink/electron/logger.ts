// 日志系统 - 所有关键操作写日志
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const MAX_LOG_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BUFFER_LINES = 500;

export function writeConsoleErrorSafely(
  line: string,
  sink: (value: string) => void = (value) => console.error(value),
): boolean {
  try {
    sink(line);
    return true;
  } catch {
    // A detached parent pipe can make console.error throw EPIPE. Logging must never
    // recursively become another uncaughtException.
    return false;
  }
}

export function shouldMirrorErrorToConsole(
  isPackaged: boolean,
  consoleAvailable: boolean,
): boolean {
  return !isPackaged && consoleAvailable;
}

/**
 * JSON.stringify(Error) normally produces `{}`, which erased the only useful evidence for the
 * intermittent main/renderer crashes reported in production. Keep errors, nested causes, bigint
 * values and circular diagnostic objects loggable without letting logging throw another error.
 */
export function serializeLogMeta(meta: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(meta, (_key, value: unknown) => {
      if (typeof value === 'bigint') return value.toString();
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
            cause: value.cause,
          };
        }
      }
      return value;
    });
    return json ?? String(meta);
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return JSON.stringify({ serializationError: reason, fallback: String(meta) });
  }
}

class Logger {
  private logFile: string | null = null;
  private stream: fs.WriteStream | null = null;
  private buffer: string[] = [];
  private writtenBytes = 0;
  private consoleAvailable = false;
  private consoleGuardsAttached = false;

  init(): void {
    this.consoleAvailable = !app.isPackaged;
    this.attachConsoleErrorGuards();
    const logsDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const today = new Date().toISOString().slice(0, 10);
    const dailyFile = path.join(logsDir, `focuslink-${today}.log`);
    const dailySize = fs.existsSync(dailyFile) ? fs.statSync(dailyFile).size : 0;
    this.logFile =
      dailySize >= MAX_LOG_FILE_BYTES
        ? path.join(logsDir, `focuslink-${today}-${Date.now()}.log`)
        : dailyFile;
    this.writtenBytes = this.logFile === dailyFile ? dailySize : 0;
    this.openStream();
    // flush buffer
    this.buffer.forEach((line) => this.writeToFile(line));
    this.buffer = [];
  }

  private attachConsoleErrorGuards(): void {
    if (this.consoleGuardsAttached) return;
    this.consoleGuardsAttached = true;
    const disableConsoleMirror = (): void => {
      this.consoleAvailable = false;
    };
    process.stdout?.on('error', disableConsoleMirror);
    process.stderr?.on('error', disableConsoleMirror);
  }

  private openStream(): void {
    if (!this.logFile) return;
    const stream = fs.createWriteStream(this.logFile, { flags: 'a' });
    stream.on('error', () => {
      if (this.stream === stream) this.stream = null;
    });
    this.stream = stream;
  }

  private rotate(timestamp: string): void {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    const today = timestamp.slice(0, 10);
    const suffix = timestamp.replace(/[^0-9]/g, '').slice(8);
    this.stream?.end();
    this.stream = null;
    this.logFile = path.join(logsDir, `focuslink-${today}-${suffix}.log`);
    this.writtenBytes = 0;
    this.openStream();
  }

  private pushBuffer(line: string): void {
    this.buffer.push(line);
    if (this.buffer.length > MAX_BUFFER_LINES) this.buffer.shift();
  }

  private writeToFile(line: string): void {
    const bytes = Buffer.byteLength(line);
    if (this.stream && this.writtenBytes + bytes > MAX_LOG_FILE_BYTES) {
      this.rotate(new Date().toISOString());
    }
    if (!this.stream) {
      this.pushBuffer(line);
      return;
    }
    try {
      this.stream.write(line);
      this.writtenBytes += bytes;
    } catch {
      this.stream = null;
      this.pushBuffer(line);
    }
  }

  private write(level: LogLevel, scope: string, msg: string, meta?: unknown): void {
    const ts = new Date().toISOString();
    const metaStr = meta != null ? ' ' + serializeLogMeta(meta) : '';
    const line = `[${ts}] [${level.toUpperCase()}] [${scope}] ${msg}${metaStr}\n`;
    this.writeToFile(line);
    if (level === 'error' && shouldMirrorErrorToConsole(app.isPackaged, this.consoleAvailable)) {
      this.consoleAvailable = writeConsoleErrorSafely(line.trim());
    }
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
