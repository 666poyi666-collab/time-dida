// 轻量 JSON 文件存储 - 替代 electron-store（v10 为纯 ESM，主进程 CJS 无法 require）
// 接口刻意保持与 electron-store 子集兼容：get/set/delete/has/store/onDidChange
// 文件位置：app.getPath('userData')/<name>.json
// encryptionKey 仅做 XOR 混淆（避免明文），不是密码学加密；生产建议 keytar。
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

export interface JsonStoreOptions<T> {
  name: string;
  defaults: T;
  encryptionKey?: string;
}

export class JsonStore<T extends object> {
  private filePath: string;
  private defaults: T;
  private encryptionKey?: string;
  private cache: T | null = null;

  constructor(opts: JsonStoreOptions<T>) {
    const userData = app.getPath('userData');
    if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
    this.filePath = path.join(userData, `${opts.name}.json`);
    this.defaults = opts.defaults;
    this.encryptionKey = opts.encryptionKey;
  }

  private encode(obj: T): string {
    const json = JSON.stringify(obj);
    if (!this.encryptionKey) return json;
    // 简单 XOR 混淆 + base64，避免明文 token 落盘
    const key = this.encryptionKey;
    let out = '';
    for (let i = 0; i < json.length; i++) {
      out += String.fromCharCode(json.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return Buffer.from(out, 'binary').toString('base64');
  }

  private decode(text: string): T {
    try {
      if (!this.encryptionKey) return JSON.parse(text) as T;
      const key = this.encryptionKey;
      const buf = Buffer.from(text, 'base64');
      let out = '';
      for (let i = 0; i < buf.length; i++) {
        out += String.fromCharCode(buf[i] ^ key.charCodeAt(i % key.length));
      }
      return JSON.parse(out) as T;
    } catch (err) {
      logger.warn('jsonStore', `decode failed for ${path.basename(this.filePath)}`, err);
      return this.defaults;
    }
  }

  private load(): T {
    if (this.cache) return this.cache;
    if (!fs.existsSync(this.filePath)) {
      this.cache = this.defaults;
      return this.defaults;
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8').trim();
      if (!raw) {
        this.cache = this.defaults;
        return this.defaults;
      }
      const data = this.decode(raw);
      this.cache = { ...this.defaults, ...data };
      return this.cache;
    } catch (err) {
      logger.warn('jsonStore', `load failed for ${path.basename(this.filePath)}`, err);
      this.cache = this.defaults;
      return this.defaults;
    }
  }

  private persist(data: T): void {
    this.cache = data;
    try {
      const text = this.encode(data);
      fs.writeFileSync(this.filePath, text, 'utf8');
    } catch (err) {
      logger.error('jsonStore', `persist failed for ${path.basename(this.filePath)}`, err);
    }
  }

  get store(): T {
    return this.load();
  }

  set store(value: T) {
    this.persist(value);
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.load()[key];
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    const data = { ...this.load(), [key]: value };
    this.persist(data);
  }

  delete<K extends keyof T>(key: K): void {
    const data = { ...this.load() };
    delete data[key];
    this.persist(data);
  }

  has<K extends keyof T>(key: K): boolean {
    return key in this.load();
  }

  clear(): void {
    this.persist(this.defaults);
  }
}
