import { describe, expect, it, vi } from "vitest";

import { handleCanonicalPairing, type PairingEnv } from "../src/pairing";

const PAIR_AUTHORITY_TOKEN = "fla_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
const READER_TOKEN =
  "fl2_account1_reader01_0123456789abcdefghijklmnopqrstuvwxyzABCDE";
const NONCE = "n".repeat(43);

describe("canonical one-time device pairing", () => {
  it("uses an edge-verified owner capability and a distinct private authority credential upstream", async () => {
    const upstream = binding(async (request) => {
      expect(new URL(request.url).pathname).toBe("/sync/v1/pair/offers");
      expect(request.headers.has("authorization")).toBe(false);
      expect(request.headers.get("x-focuslink-pair-authority")).toBe(
        PAIR_AUTHORITY_TOKEN,
      );
      expect(await request.json()).toEqual({
        displayName: "Windows laptop",
        scopes: ["sync:read", "sync:write", "live:read", "live:write"],
      });
      return Response.json({
        nonce: NONCE,
        expiresAt: Date.now() + 10 * 60 * 1_000,
        devicePublicId: "reader01",
      });
    });
    const response = await handleCanonicalPairing(
      pairRequest("/sync/v1/pair/offers", {
        displayName: "Windows laptop",
        scopes: ["sync:read", "sync:write", "live:read", "live:write"],
      }),
      pairEnv(upstream),
      true,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      nonce: NONCE,
      devicePublicId: "reader01",
    });
  });

  it("keeps claim unauthenticated except for the high-entropy nonce and preserves one-time replay", async () => {
    let consumed = false;
    const upstream = binding(async (request) => {
      expect(new URL(request.url).pathname).toBe("/sync/v1/pair/exchange");
      expect(request.headers.has("authorization")).toBe(false);
      expect(await request.json()).toEqual({
        nonce: NONCE,
        device: {
          platform: "windows",
          appVersion: "2.0.0",
          displayName: "Owner desktop",
        },
      });
      if (consumed) {
        return Response.json(
          { error: { code: "pairing_expired", message: "already used" } },
          { status: 410 },
        );
      }
      consumed = true;
      return Response.json({
        deviceId: "device-reader01",
        accessToken: READER_TOKEN,
        scopes: ["sync:read", "sync:write"],
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1_000,
      });
    });
    const env = pairEnv(upstream);
    const first = await handleCanonicalPairing(
      pairRequest("/sync/v1/pair/exchange", claim()),
      env,
      false,
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      deviceId: "device-reader01",
      accessToken: READER_TOKEN,
    });

    const replay = await handleCanonicalPairing(
      pairRequest("/sync/v1/pair/exchange", claim()),
      env,
      false,
    );
    expect(replay.status).toBe(410);
  });

  it("rejects OAuth, device, and OOB credentials on the anonymous claim surface", async () => {
    const upstream = binding(async () =>
      Response.json({ error: "must_not_run" }),
    );
    const env = pairEnv(upstream);
    const credentialHeaders: Array<Record<string, string>> = [
      { authorization: "Bearer eyJfake.oauth.token" },
      { authorization: `Bearer ${READER_TOKEN}` },
      {
        "x-focuslink-service-credential":
          env.FOCUSLINK_PAIR_SERVICE_CREDENTIAL!,
      },
      { "x-focuslink-pair-authority": env.FOCUSLINK_PAIR_AUTHORITY_TOKEN! },
    ];
    for (const headers of credentialHeaders) {
      const response = await handleCanonicalPairing(
        new Request("https://worker.test/sync/v1/pair/exchange", {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(claim()),
        }),
        env,
        false,
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "credential_boundary_violation" },
      });
    }
    expect(upstream.fetch).not.toHaveBeenCalled();
  });

  it("passes expired claims through and rejects malformed or short nonces before upstream", async () => {
    const upstream = binding(async () =>
      Response.json({ error: { code: "pairing_expired" } }, { status: 410 }),
    );
    const env = pairEnv(upstream);
    const expired = await handleCanonicalPairing(
      pairRequest("/sync/v1/pair/exchange", claim()),
      env,
      false,
    );
    expect(expired.status).toBe(410);

    const short = await handleCanonicalPairing(
      pairRequest("/sync/v1/pair/exchange", { ...claim(), nonce: "short" }),
      env,
      false,
    );
    expect(short.status).toBe(400);
    expect(upstream.fetch).toHaveBeenCalledOnce();
  });

  it("validates token-to-device binding in the authority claim response", async () => {
    const upstream = binding(async () =>
      Response.json({
        deviceId: "device-someone-else",
        accessToken: READER_TOKEN,
        scopes: ["sync:read"],
        expiresAt: Date.now() + 60_000,
      }),
    );
    const response = await handleCanonicalPairing(
      pairRequest("/sync/v1/pair/exchange", claim()),
      pairEnv(upstream),
      false,
    );
    expect(response.status).toBe(502);
  });

  it("rate-limits brute-force and replay attempts before the authority", async () => {
    const upstream = binding(async () =>
      Response.json({ error: "must_not_run" }),
    );
    const env = pairEnv(upstream);
    env.PAIR_RATE_LIMITER = {
      limit: vi.fn(async () => ({ success: false })),
    };
    const response = await handleCanonicalPairing(
      pairRequest("/sync/v1/pair/exchange", claim()),
      env,
      false,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(upstream.fetch).not.toHaveBeenCalled();
  });

  it("rejects owner-secret bypass, excessive scopes, and credential reuse", async () => {
    const upstream = binding(async () =>
      Response.json({ error: "must_not_run" }),
    );
    const env = pairEnv(upstream);

    const noOauth = await handleCanonicalPairing(
      pairRequest(
        "/sync/v1/pair/offers",
        {
          displayName: "phone",
          scopes: ["sync:read"],
        },
        `Bearer ${READER_TOKEN}`,
      ),
      env,
      false,
    );
    expect(noOauth.status).toBe(403);

    const excessive = await handleCanonicalPairing(
      pairRequest("/sync/v1/pair/offers", {
        displayName: "phone",
        scopes: ["sync:read", "devices:manage"],
      }),
      env,
      true,
    );
    expect(excessive.status).toBe(400);

    env.FOCUSLINK_DEVICE_TOKEN = PAIR_AUTHORITY_TOKEN;
    const reused = await handleCanonicalPairing(
      pairRequest("/sync/v1/pair/offers", {
        displayName: "phone",
        scopes: ["sync:read"],
      }),
      env,
      true,
    );
    expect(reused.status).toBe(503);
    expect(upstream.fetch).not.toHaveBeenCalled();
  });

  it("rejects pairing queries and authoritative redirects", async () => {
    const upstream = binding(
      async () =>
        new Response("{}", {
          status: 302,
          headers: {
            "content-type": "application/json",
            location: "https://evil.example",
          },
        }),
    );
    const env = pairEnv(upstream);
    const queried = await handleCanonicalPairing(
      pairRequest("/sync/v1/pair/exchange?ignored=true", claim()),
      env,
      false,
    );
    expect(queried.status).toBe(400);
    expect(upstream.fetch).not.toHaveBeenCalled();

    const redirected = await handleCanonicalPairing(
      pairRequest("/sync/v1/pair/exchange", claim()),
      env,
      false,
    );
    expect(redirected.status).toBe(502);
    expect(await redirected.json()).toMatchObject({
      error: { code: "authoritative_redirect_rejected" },
    });
  });

  it("lists and revokes devices only after the edge verifies the owner service", async () => {
    const upstream = binding(async (request) => {
      const path = new URL(request.url).pathname;
      expect(request.headers.get("x-focuslink-pair-authority")).toBe(
        PAIR_AUTHORITY_TOKEN,
      );
      expect(request.headers.has("authorization")).toBe(false);
      if (path === "/sync/v1/pair/devices") {
        expect(request.method).toBe("GET");
        return Response.json({
          devices: [
            {
              deviceId: "device-reader01",
              devicePublicId: "reader01",
              displayName: "Owner phone",
              scopes: ["sync:read", "sync:write"],
              expiresAt: Date.now() + 60_000,
              revokedAt: null,
              lastSeenAt: Date.now(),
              watermark: 4,
              stale: false,
            },
          ],
          serverTime: Date.now(),
        });
      }
      expect(path).toBe("/sync/v1/pair/devices/device-reader01/revoke");
      expect(request.method).toBe("POST");
      expect(await request.text()).toBe("");
      return Response.json({
        deviceId: "device-reader01",
        revokedAt: Date.now(),
      });
    });
    const env = pairEnv(upstream);
    const list = await handleCanonicalPairing(
      new Request("https://worker.test/sync/v1/pair/devices"),
      env,
      true,
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      schemaVersion: 1,
      omittedLegacyDeviceCount: 0,
      devices: [{ deviceId: "device-reader01", displayName: "Owner phone" }],
    });
    const revoke = await handleCanonicalPairing(
      new Request(
        "https://worker.test/sync/v1/pair/devices/device-reader01/revoke",
        {
          method: "POST",
        },
      ),
      env,
      true,
    );
    expect(revoke.status).toBe(200);
    expect(upstream.fetch).toHaveBeenCalledTimes(2);

    const denied = await handleCanonicalPairing(
      new Request("https://worker.test/sync/v1/pair/devices"),
      env,
      false,
    );
    expect(denied.status).toBe(403);
  });

  it("emits an exact V1 inventory for a legal empty device list", async () => {
    const serverTime = 1_750_000_000_000;
    const response = await handleCanonicalPairing(
      new Request("https://worker.test/sync/v1/pair/devices"),
      pairEnv(binding(async () => Response.json({ devices: [], serverTime }))),
      true,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      devices: [],
      serverTime,
      omittedLegacyDeviceCount: 0,
    });
  });

  it("keeps inventory transport and contract failures distinguishable", async () => {
    const cases = [
      {
        name: "network",
        upstream: binding(async () => {
          throw new Error("socket closed");
        }),
        status: 502,
        code: "authoritative_upstream_unreachable",
      },
      {
        name: "timeout",
        upstream: binding(async () => {
          throw new DOMException("deadline", "TimeoutError");
        }),
        status: 504,
        code: "authoritative_upstream_timeout",
      },
      {
        name: "non-json",
        upstream: binding(async () =>
          new Response("not json", {
            headers: { "content-type": "text/plain; charset=utf-8" },
          }),
        ),
        status: 502,
        code: "pair_response_not_json",
      },
      {
        name: "oversized",
        upstream: binding(async () =>
          new Response("{}", {
            headers: {
              "content-type": "application/json",
              "content-length": String(64 * 1024 + 1),
            },
          }),
        ),
        status: 502,
        code: "pair_response_too_large",
      },
      {
        name: "contract",
        upstream: binding(async () => Response.json({ devices: [] })),
        status: 502,
        code: "invalid_device_inventory_response",
      },
    ];

    for (const scenario of cases) {
      const response = await handleCanonicalPairing(
        new Request("https://worker.test/sync/v1/pair/devices"),
        pairEnv(scenario.upstream),
        true,
      );
      expect(response.status, scenario.name).toBe(scenario.status);
      expect(await response.json(), scenario.name).toMatchObject({
        error: { code: scenario.code },
      });
    }
  });

  it("projects legacy inventory rows and drops all safely ignorable fields", async () => {
    const serverTime = 1_750_000_000_000;
    const upstream = binding(async () =>
      Response.json({
        devices: [
          {
            deviceId: "device-reader01",
            devicePublicId: null,
            displayName: "  Legacy device  ",
            scopes: [
              "sync:read",
              "live:read",
              "devices:manage",
              "backups:manage",
            ],
            expiresAt: "1750000060000",
            revokedAt: null,
            lastSeenAt: "1750000000000",
            watermark: null,
            stale: false,
            legacyCredentialHint: "must-not-leak",
          },
          {
            deviceId: "device-reader02",
            displayName: "Never seen",
            scopes: ["sync:read"],
            expiresAt: null,
            revokedAt: null,
            lastSeenAt: null,
            stale: true,
            legacyVersion: 1,
          },
        ],
        serverTime: String(serverTime),
        authorityDebug: { ignored: true },
      }),
    );
    const response = await handleCanonicalPairing(
      new Request("https://worker.test/sync/v1/pair/devices"),
      pairEnv(upstream),
      true,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      devices: [
        {
          deviceId: "device-reader01",
          displayName: "Legacy device",
          scopes: [
            "sync:read",
            "live:read",
            "devices:manage",
            "backups:manage",
          ],
          expiresAt: 1_750_000_060_000,
          revokedAt: null,
          lastSeenAt: 1_750_000_000_000,
          stale: false,
        },
        {
          deviceId: "device-reader02",
          displayName: "Never seen",
          scopes: ["sync:read"],
          expiresAt: null,
          revokedAt: null,
          lastSeenAt: null,
          stale: true,
        },
      ],
      serverTime,
      omittedLegacyDeviceCount: 0,
    });
  });

  it("omits all noncanonical historical IDs while retaining manageable devices", async () => {
    const upstream = binding(async () =>
      Response.json({
        devices: [
          {
            deviceId: "web_7c6f2f0f-9afb-4a64-a1ae-23456789abcd",
            displayName: "Retired WebView",
            scopes: ["sync:read"],
            expiresAt: null,
            revokedAt: null,
            lastSeenAt: 1_750_000_000_000,
            stale: true,
          },
          {
            deviceId: "legacy-desktop-id",
            displayName: "Retired desktop",
            scopes: ["sync:read"],
            expiresAt: null,
            revokedAt: null,
            lastSeenAt: 1_750_000_000_000,
            stale: true,
          },
          {
            deviceId: "device-reader01",
            displayName: "Current phone",
            scopes: ["sync:read", "live:read"],
            expiresAt: null,
            revokedAt: null,
            lastSeenAt: 1_750_000_000_000,
            stale: false,
          },
        ],
        serverTime: 1_750_000_000_000,
      }),
    );
    const response = await handleCanonicalPairing(
      new Request("https://worker.test/sync/v1/pair/devices"),
      pairEnv(upstream),
      true,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      devices: [
        {
          deviceId: "device-reader01",
          displayName: "Current phone",
          scopes: ["sync:read", "live:read"],
          expiresAt: null,
          revokedAt: null,
          lastSeenAt: 1_750_000_000_000,
          stale: false,
        },
      ],
      serverTime: 1_750_000_000_000,
      omittedLegacyDeviceCount: 2,
    });
  });

  it.each([
    ["missing device id", { deviceId: null }],
    ["blank display name", { displayName: "   " }],
    ["control characters in display name", { displayName: "Phone\nadmin" }],
    ["scope containing whitespace", { scopes: ["sync:read", "devices manage"] }],
    ["scope containing markup", { scopes: ["sync:read", "devices:<script>"] }],
    ["scope with an empty segment", { scopes: ["sync:read", "devices::manage"] }],
    ["scope exceeding 64 characters", { scopes: ["sync:read", `device:${"a".repeat(58)}`] }],
    [
      "more than 16 scopes",
      {
        scopes: [
          "sync:read",
          ...Array.from({ length: 16 }, (_, index) => `feature${index}:read`),
        ],
      },
    ],
    ["duplicate scope", { scopes: ["sync:read", "sync:read"] }],
    ["missing sync read", { scopes: ["live:read"] }],
    ["fractional timestamp", { lastSeenAt: 1.5 }],
    ["non-canonical numeric timestamp", { expiresAt: " 1750000060000" }],
  ])("rejects %s in authoritative inventory fields", async (_name, override) => {
    const upstream = binding(async () =>
      Response.json({
        devices: [
          {
            deviceId: "device-reader01",
            displayName: "Owner phone",
            scopes: ["sync:read"],
            expiresAt: null,
            revokedAt: null,
            lastSeenAt: 1_750_000_000_000,
            stale: false,
            ...override,
          },
        ],
        serverTime: 1_750_000_000_000,
      }),
    );
    const response = await handleCanonicalPairing(
      new Request("https://worker.test/sync/v1/pair/devices"),
      pairEnv(upstream),
      true,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_device_inventory_response" },
    });
  });
});

function pairEnv(upstream: { fetch: ReturnType<typeof vi.fn> }): PairingEnv {
  return {
    FOCUSLINK_UPSTREAM: upstream as unknown as Fetcher,
    FOCUSLINK_PAIR_AUTHORITY_TOKEN: PAIR_AUTHORITY_TOKEN,
    FOCUSLINK_PAIR_SERVICE_CREDENTIAL:
      "fls_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
    FOCUSLINK_PAIRING_ENABLED: "true",
    FOCUSLINK_DEVICE_TOKEN:
      "fl2_account1_project1_0123456789abcdefghijklmnopqrstuvwxyzABCDE",
    OAUTH_RS_CLIENT_SECRET: "oauth-rs-client-secret-that-is-not-a-device-token",
    FOCUSLINK_ALLOWED_ORIGINS: "https://localhost",
    PAIR_RATE_LIMITER: {
      limit: vi.fn(async () => ({ success: true })),
    },
  };
}

function claim() {
  return {
    nonce: NONCE,
    device: {
      platform: "windows",
      appVersion: "2.0.0",
      displayName: "Owner desktop",
    },
  };
}

function binding(handler: (request: Request) => Promise<Response>) {
  return { fetch: vi.fn(handler) };
}

function pairRequest(
  path: string,
  value: unknown,
  authorization?: string,
): Request {
  return new Request(`https://worker.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(value),
  });
}
