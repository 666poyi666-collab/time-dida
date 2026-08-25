import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./src/index.ts",
      // Wrangler resolves `.dev.vars` beside the selected config. Keep the
      // test config in an isolated fixture directory so production/local
      // credentials in the repository root can never enter the test worker.
      wrangler: { configPath: "./tests/fixtures/wrangler.test.jsonc" },
      miniflare: {
        bindings: {
          FOCUSLINK_ACCOUNT_KEY: "test-account",
          FOCUSLINK_DEVICE_ID: "device-reader01",
          FOCUSLINK_DEVICE_TOKEN:
            "fl2_account1_reader01_0123456789abcdefghijklmnopqrstuvwxyzABCDE",
          FOCUSLINK_PAIR_AUTHORITY_TOKEN:
            "fla_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
          FOCUSLINK_PAIR_SERVICE_CREDENTIAL:
            "fls_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
          FOCUSLINK_MCP_SERVICE_TOKEN:
            "mcp-service-secret-0123456789abcdefghijklmnopqrstuvwxyz",
          FOCUSLINK_PAIR_SERVICE_CLIENT_ID: "poyi-oauth-as",
          FOCUSLINK_PAIRING_ENABLED: "true",
          FOCUSLINK_BOOTSTRAP_ENABLED: "true",
          FOCUSLINK_OWNER_LABEL: "Poyi",
          FOCUSLINK_OWNER_SUBJECT: "poyi-owner",
          FOCUSLINK_IDENTITY_AUTHORITY_TOKEN:
            "fia_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
          FOCUSLINK_BOOTSTRAP_PEPPER:
            "test-bootstrap-pepper-that-is-at-least-32-bytes!!",
          OAUTH_ISSUER: "https://oauth.test",
          OAUTH_AUDIENCE: "https://worker.test/mcp",
          OAUTH_JWKS_URL: "https://oauth.test/jwks.json",
          OAUTH_TOKEN_STATUS_URL: "https://oauth.test/introspect",
          OAUTH_RS_CLIENT_ID: "foxlink-cloud-mcp-test",
          OAUTH_RS_CLIENT_SECRET: "test-rs-client-secret-0123456789abcdef",
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
        d1Databases: ["DB"],
        serviceBindings: {
          FOCUSLINK_UPSTREAM: async (request: Request) => {
            const url = new URL(request.url);
            if (url.pathname === "/internal/mcp/v1/focus/summary") {
              if (
                request.headers.get("x-focuslink-mcp-service") !==
                "mcp-service-secret-0123456789abcdefghijklmnopqrstuvwxyz"
              ) {
                return Response.json(
                  { error: "unauthenticated" },
                  { status: 401 },
                );
              }
              const from = Number(url.searchParams.get("from"));
              const to = Number(url.searchParams.get("to"));
              const endedAt = Math.min(to - 1, from + 30_000);
              return Response.json({
                schemaVersion: 1,
                authority: "focuslink-account-do",
                generatedAt: to,
                lastVerifiedAt: to - 1_000,
                dataThrough: endedAt,
                freshness: {
                  state: "fresh",
                  ageMs: 1_000,
                  staleAfterMs: 900_000,
                },
                range: { from, to },
                totals: {
                  focusCount: 1,
                  activeMs: 30_000,
                  pausedMs: 0,
                  wallMs: 30_000,
                },
                tasks: [
                  {
                    taskId: "task-chemistry",
                    source: "local",
                    title: "化学复习",
                    focusCount: 1,
                    activeMs: 30_000,
                    lastFocusedAt: endedAt,
                  },
                ],
                recentSessions: [
                  {
                    sessionId: "session-task-1",
                    startedAt: endedAt - 30_000,
                    endedAt,
                    status: "finished",
                    activeMs: 30_000,
                    pausedMs: 0,
                    wallMs: 30_000,
                    title: "化学复习",
                    task: {
                      taskId: "task-chemistry",
                      source: "local",
                      title: "化学复习",
                    },
                    segmentTasks: [
                      {
                        taskId: "task-chemistry",
                        source: "local",
                        title: "化学复习",
                        activeMs: 30_000,
                      },
                    ],
                  },
                ],
                changeSeq: 2,
              });
            }
            if (url.pathname === "/internal/mcp/v1/focus/records") {
              if (
                request.headers.get("x-focuslink-mcp-service") !==
                "mcp-service-secret-0123456789abcdefghijklmnopqrstuvwxyz"
              ) {
                return Response.json(
                  { error: "unauthenticated" },
                  { status: 401 },
                );
              }
              const from = Number(url.searchParams.get("from"));
              const to = Number(url.searchParams.get("to"));
              const endedAt = to - 1;
              return Response.json({
                schemaVersion: 1,
                authority: "focuslink-account-do",
                generatedAt: to,
                lastVerifiedAt: to - 1_000,
                freshness: {
                  state: "fresh",
                  ageMs: 1_000,
                  staleAfterMs: 900_000,
                },
                range: { from, to },
                records: [
                  {
                    id: "session-record-1",
                    startedAt: endedAt - 30_000,
                    endedAt,
                    status: "finished",
                    activeElapsedMs: 25_000,
                    pausedElapsedMs: 5_000,
                    wallElapsedMs: 30_000,
                    title: "化学复习",
                    task: {
                      taskId: "task-chemistry",
                      source: "local",
                      title: "化学复习",
                    },
                    segments: [
                      {
                        id: "segment-record-1",
                        startedAt: endedAt - 30_000,
                        endedAt,
                        activeElapsedMs: 25_000,
                        title: "化学复习",
                        task: {
                          taskId: "task-chemistry",
                          source: "local",
                          title: "化学复习",
                        },
                      },
                    ],
                    pauses: [
                      {
                        id: "pause-record-1",
                        segmentId: "segment-record-1",
                        startedAt: endedAt - 20_000,
                        endedAt: endedAt - 15_000,
                        durationMs: 5_000,
                      },
                    ],
                    corrected: false,
                    revision: { ledger: 1, metadata: 1, correction: null },
                  },
                ],
                live: {
                  revision: 7,
                  serverTime: to,
                  state: "running",
                  session: {
                    id: "live-session-1",
                    title: "当前专注",
                    state: "running",
                    startedAt: to - 60_000,
                    activeElapsedMs: 60_000,
                    pauseElapsedMs: 0,
                    wallElapsedMs: 60_000,
                    currentPauseStartedAt: null,
                    task: {
                      taskId: "task-live",
                      source: "local",
                      title: "生物",
                    },
                    segments: [
                      { id: "live-segment-1", startedAt: to - 60_000, endedAt: null },
                    ],
                    pauses: [],
                    updatedAt: to,
                  },
                },
              });
            }
            if (url.pathname === "/sync/v2/status") {
              return Response.json({
                protocolVersion: 2,
                syncEpoch: "sync-1",
                cursorEpoch: "cursor-1",
                accountGeneration: 1,
                changeSeq: 1,
                serverTime: Date.now(),
              });
            }
            if (url.pathname === "/sync/v2/live") {
              return Response.json({
                protocolVersion: 1,
                revision: 7,
                session: null,
                serverTime: 1_700_000_000_000,
              });
            }
            if (url.pathname === "/sync/v1/pair/offers") {
              const authorization = request.headers.get("authorization");
              if (
                authorization ===
                "Bearer fl2_account1_reader01_0123456789abcdefghijklmnopqrstuvwxyzABCDE"
              ) {
                return Response.json({ error: "forbidden" }, { status: 403 });
              }
              const deviceOffer = authorization?.startsWith("Bearer fl2_");
              if (deviceOffer) {
                return Response.json({
                  code: "01234567",
                  expiresAt: Date.now() + 10 * 60 * 1_000,
                });
              }
              return Response.json({
                nonce: "n".repeat(43),
                expiresAt: Date.now() + 10 * 60 * 1_000,
                devicePublicId: "reader01",
              });
            }
            if (url.pathname === "/sync/v1/pair/devices") {
              return Response.json({
                devices: [
                  {
                    deviceId: "device-reader01",
                    devicePublicId: "reader01",
                    displayName: "Test phone",
                    scopes: ["sync:read", "sync:write"],
                    expiresAt: Date.now() + 60_000,
                    revokedAt: null,
                    lastSeenAt: Date.now(),
                    watermark: 1,
                    stale: false,
                  },
                ],
                serverTime: Date.now(),
              });
            }
            if (
              url.pathname === "/sync/v1/pair/devices/device-reader01/revoke"
            ) {
              return Response.json({
                deviceId: "device-reader01",
                revokedAt: Date.now(),
              });
            }
            return Response.json(
              { error: { code: "test_upstream_unavailable" } },
              { status: 503 },
            );
          },
        },
      },
    })),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 15_000,
    deps: {
      optimizer: {
        ssr: {
          // AJV's CommonJS build performs extensionless relative requires. It
          // must be bundled before modules enter the Workers isolate, especially
          // when the checkout path contains non-ASCII characters.
          enabled: true,
          include: ["ajv", "ajv-formats"],
        },
      },
    },
  },
});
