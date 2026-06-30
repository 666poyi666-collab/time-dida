// 实验性 TickTick Focus / Pomodoro 适配器
// 默认关闭。出错不能影响主程序。所有 Focus 记录必须先保存本地。
//
// 注意：TickTick 官方 Open API 主要是 tasks:read / tasks:write，
//   Focus/Pomodoro 写入能力依赖非官方 V2/session API 或第三方 SDK（ticktick-sdk），
//   不稳定，不能当成稳定官方接口来依赖。
//   这里只是一个占位适配器骨架，实际接入时需要 cookies/session，
//   不允许硬编码账号密码，token 必须安全保存。
import { credentials } from '../credentials.js';
import { logger } from '../logger.js';
import type { FocusRecord } from '@shared/types';

const SERVICE = 'ticktick-experimental';

/**
 * 实验性 Focus 适配器。
 * 当前实现：仅记录日志，不做真实 V2 调用（避免依赖不稳定 API）。
 * 接入时：
 *   1. 读取存储的 session cookie（非账号密码）
 *   2. 调用非官方 V2/session focus 接口
 *   3. 任何错误都 try/catch，绝不抛出到主流程
 *   4. 失败则返回 false，让 sync_queue 标记 failed
 */
export class ExperimentalTickTickFocusAdapter {
  name = 'experimental-ticktick-focus';

  get isEnabled(): boolean {
    return credentials.has(SERVICE);
  }

  async createFocusRecord(record: FocusRecord): Promise<boolean> {
    if (!this.isEnabled) {
      logger.warn('experimental-focus', 'not enabled, skipping');
      return false;
    }
    try {
      // TODO: 实际接入非官方 V2/session focus API
      // 当前仅记录，不调用真实接口
      logger.info('experimental-focus', 'would create focus record', {
        sessionId: record.sessionId,
        activeMs: record.activeElapsedMs,
      });
      return true;
    } catch (err) {
      // 出错不影响主程序，返回 false 由 sync_queue 处理
      logger.error('experimental-focus', 'createFocusRecord failed', err);
      return false;
    }
  }

  setSessionToken(token: string): void {
    credentials.set(SERVICE, { accessToken: token });
    logger.info('experimental-focus', 'session token set');
  }

  clear(): void {
    credentials.delete(SERVICE);
  }
}

export const experimentalFocusAdapter = new ExperimentalTickTickFocusAdapter();
