// 版本信息 - 供主进程日志和渲染进程 UI 共用
// commit/buildTime 由 scripts/gen-version.js 在 build 时生成到 version.generated.ts
import { APP_COMMIT, APP_BUILD_TIME } from './version.generated';

export const APP_VERSION = '0.3.9';
export const APP_RELEASE_DIR = 'release-v039';
export { APP_COMMIT, APP_BUILD_TIME };
