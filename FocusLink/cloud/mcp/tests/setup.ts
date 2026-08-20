import { applyD1Migrations, env, reset, type D1Migration } from "cloudflare:test";
import { beforeEach, vi } from "vitest";
import { clearOAuthCachesForTest } from "../src/oauth";

declare global {
  namespace Cloudflare {
    interface Env {
      FOCUSLINK_ACCOUNT_KEY: string;
      FOCUSLINK_UPSTREAM: Fetcher;
      FOCUSLINK_DEVICE_ID: string;
      FOCUSLINK_DEVICE_TOKEN: string;
      FOCUSLINK_PAIR_AUTHORITY_TOKEN: string;
      FOCUSLINK_PAIR_SERVICE_CREDENTIAL: string;
      FOCUSLINK_PAIR_SERVICE_CLIENT_ID: string;
      FOCUSLINK_MCP_SERVICE_TOKEN: string;
      FOCUSLINK_PAIRING_ENABLED: string;
      PAIR_RATE_LIMITER: RateLimit;
      OAUTH_ISSUER: string;
      OAUTH_AUDIENCE: string;
      OAUTH_JWKS_URL: string;
      OAUTH_TOKEN_STATUS_URL: string;
      OAUTH_RS_CLIENT_ID: string;
      OAUTH_RS_CLIENT_SECRET: string;
      DB: D1Database;
      TEST_MIGRATIONS?: D1Migration[];
    }
  }
}

beforeEach(async () => {
  clearOAuthCachesForTest();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS!);
});
