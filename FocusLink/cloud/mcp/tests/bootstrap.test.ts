import { describe, expect, it, vi } from "vitest";

import {
  handleBootstrap,
  handleBootstrapAdmin,
  validateBootstrapConfiguration,
  type BootstrapEnv,
  type BootstrapFlowRow,
} from "../src/bootstrap";

const IDENTITY_AUTHORITY_TOKEN =
  "fia_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const BOOTSTRAP_PEPPER = "bootstrap-pepper-that-is-at-least-32-bytes-long!!";
const INSTALLATION_ID = "android-test-installation-id-0001";
const REGISTERED_TOKEN =
  "fl2_poyi-owner_desktop01_0123456789abcdefghijklmnopqrstuvwxyzABCDE";

function validRegistration(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    installationId: INSTALLATION_ID,
    displayName: "小米手机",
    platform: "android",
    deviceKind: "phone",
    appVersion: "0.12.74",
    ...overrides,
  };
}

function validStartBody() {
  return { protocolVersion: 1, action: "start", registration: validRegistration() };
}

describe("owner-approved device bootstrap", () => {
  it("returns login-required with an owner login URL on a clean start", async () => {
    const db = memoryDb();
    const env = bootstrapEnv(db);
    const response = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", validStartBody()),
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      protocolVersion: 1,
      status: "login-required",
    });
    expect(body.flowId).toMatch(/^flow_[A-Za-z0-9_-]{32,160}$/);
    expect(body.pollToken).toMatch(/^flb_[A-Za-z0-9_-]{43,160}$/);
    expect(body.loginUrl).toBe(
      `https://poyi-oauth-as.focuslink-poyi-6465e9.workers.dev/owner/sign-in?bootstrap_flow=${encodeURIComponent(String(body.flowId))}`,
    );
    expect(body.retryAfterMs).toBe(5_000);
    expect(Number(body.expiresAt) - Number(body.serverTime)).toBeLessThanOrEqual(
      10 * 60_000,
    );
    expect(db.pendingRows()).toHaveLength(1);
  });

  it("serves pending until the owner approves, then mints the exact authenticated envelope once", async () => {
    const db = memoryDb();
    const env = bootstrapEnv(db);
    const start = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", validStartBody()),
      env,
    );
    const started = (await start.json()) as Record<string, unknown>;
    const flowId = String(started.flowId);
    const pollToken = String(started.pollToken);

    const pending = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", {
        protocolVersion: 1,
        action: "poll",
        flowId,
        pollToken,
      }),
      env,
    );
    expect(pending.status).toBe(200);
    expect(await pending.json()).toMatchObject({
      status: "pending",
      flowId,
    });

    const approve = await handleBootstrapAdmin(
      adminRequest(`/sync/v1/bootstrap/flows/${flowId}/approve`, { flowId }),
      env,
    );
    expect(approve.status).toBe(200);
    expect(await approve.json()).toEqual({ flowId, status: "approved" });

    const authenticated = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", {
        protocolVersion: 1,
        action: "poll",
        flowId,
        pollToken,
      }),
      env,
    );
    expect(authenticated.status).toBe(200);
    const body = (await authenticated.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      protocolVersion: 1,
      status: "authenticated",
      endpoint: "https://foxlink-mcp.focuslink-poyi-6465e9.workers.dev",
      accountLabel: "Poyi",
    });
    const device = body.device as Record<string, unknown>;
    expect(device).toMatchObject({
      protocolVersion: 1,
      accountPublicId: "poyi-owner",
      deviceId: "device-desktop01",
      tokenType: "Bearer",
    });
    expect(device.accessToken).toBe(REGISTERED_TOKEN);
    expect((device.scopes as string[]).sort()).toEqual(
      ["sync:read", "sync:write", "live:read", "live:write"].sort(),
    );
    expect(env.FOCUSLINK_UPSTREAM.fetch).toHaveBeenCalledTimes(1);
    const forwarded = env.FOCUSLINK_UPSTREAM.fetch.mock.calls[0][0] as Request;
    expect(new URL(forwarded.url).pathname).toBe("/sync/v1/devices/register");
    expect(forwarded.headers.get("x-focuslink-identity-authority")).toBe(
      IDENTITY_AUTHORITY_TOKEN,
    );
    expect(forwarded.headers.get("x-focuslink-owner-subject")).toBe("poyi-owner");
    expect(await forwarded.json()).toEqual(validRegistration());

    // A repeated poll after consumption must not mint twice.
    const replay = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", {
        protocolVersion: 1,
        action: "poll",
        flowId,
        pollToken,
      }),
      env,
    );
    expect(replay.status).toBe(410);
    expect(env.FOCUSLINK_UPSTREAM.fetch).toHaveBeenCalledTimes(1);
  });

  it("never authenticates before owner approval", async () => {
    const db = memoryDb();
    const env = bootstrapEnv(db);
    const start = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", validStartBody()),
      env,
    );
    const started = (await start.json()) as Record<string, unknown>;
    const flowId = String(started.flowId);
    const pollToken = String(started.pollToken);
    const poll = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", {
        protocolVersion: 1,
        action: "poll",
        flowId,
        pollToken,
      }),
      env,
    );
    expect(await poll.json()).toMatchObject({ status: "pending" });
    expect(env.FOCUSLINK_UPSTREAM.fetch).not.toHaveBeenCalled();
  });

  it("rejects an authenticated response shape from upstream", async () => {
    const db = memoryDb();
    const env = bootstrapEnv(db);
    const upstream = binding(async () =>
      Response.json({
        protocolVersion: 1,
        accountPublicId: "poyi-owner",
        deviceId: "device-wrong",
        accessToken:
          "fl2_poyi-owner_wrong-test_0123456789abcdefghijklmnopqrstuvwxyzABCDE",
        tokenType: "Bearer",
        scopes: ["sync:read", "sync:write", "live:read", "live:write"],
        expiresAt: Date.now() + 60_000,
        serverTime: Date.now(),
      }),
    );
    (env as { FOCUSLINK_UPSTREAM: unknown }).FOCUSLINK_UPSTREAM =
      upstream as unknown as BootstrapEnv["FOCUSLINK_UPSTREAM"];
    const start = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", validStartBody()),
      env,
    );
    const started = (await start.json()) as Record<string, unknown>;
    const flowId = String(started.flowId);
    const pollToken = String(started.pollToken);
    const approve = await handleBootstrapAdmin(
      adminRequest(`/sync/v1/bootstrap/flows/${flowId}/approve`, { flowId }),
      env,
    );
    expect(approve.status).toBe(200);
    const response = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", {
        protocolVersion: 1,
        action: "poll",
        flowId,
        pollToken,
      }),
      env,
    );
    expect(response.status).toBe(502);
  });

  it("rejects malformed registrations and anonymous credential smuggling", async () => {
    const db = memoryDb();
    const env = bootstrapEnv(db);
    const cases: Array<Record<string, unknown>> = [
      { ...validStartBody(), registration: { ...validRegistration(), installationId: "short" } },
      { ...validStartBody(), registration: { ...validRegistration(), platform: "ios" } },
      { ...validStartBody(), registration: { ...validRegistration(), deviceKind: "router" } },
      { ...validStartBody(), registration: { ...validRegistration(), scopes: ["sync:read"] } },
      { ...validStartBody(), extra: true },
    ];
    for (const body of cases) {
      const response = await handleBootstrap(
        bootstrapRequest("/account/v1/device/bootstrap", body),
        env,
      );
      expect(response.status).toBe(400);
    }
    expect(db.pendingRows()).toHaveLength(0);

    const smuggled = await handleBootstrap(
      new Request("https://worker.test/account/v1/device/bootstrap", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer anything",
        },
        body: JSON.stringify(validStartBody()),
      }),
      env,
    );
    expect(smuggled.status).toBe(403);
    expect(db.pendingRows()).toHaveLength(0);
  });

  it("rejects wrong poll tokens and expired flows", async () => {
    const db = memoryDb();
    const env = bootstrapEnv(db);
    const start = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", validStartBody()),
      env,
    );
    const started = (await start.json()) as Record<string, unknown>;
    const flowId = String(started.flowId);

    const wrong = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", {
        protocolVersion: 1,
        action: "poll",
        flowId,
        pollToken: `flb_${"y".repeat(43)}`,
      }),
      env,
    );
    expect(wrong.status).toBe(403);

    db.expire(flowId);
    const expired = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", {
        protocolVersion: 1,
        action: "poll",
        flowId,
        pollToken: String(started.pollToken),
      }),
      env,
    );
    expect(expired.status).toBe(410);
  });

  it("lists pending flows for the admin surface and denies on demand", async () => {
    const db = memoryDb();
    const env = bootstrapEnv(db);
    await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", validStartBody()),
      env,
    );
    const list = await handleBootstrapAdmin(
      new Request("https://worker.test/sync/v1/bootstrap/flows"),
      env,
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { flows: Array<{ flowId: string; displayName: string }> };
    expect(listed.flows).toHaveLength(1);
    expect(listed.flows[0]).toMatchObject({
      displayName: "小米手机",
      platform: "android",
      deviceKind: "phone",
      appVersion: "0.12.74",
    });

    const denied = await handleBootstrapAdmin(
      adminRequest(`/sync/v1/bootstrap/flows/${listed.flows[0].flowId}/deny`, {
        flowId: listed.flows[0].flowId,
      }),
      env,
    );
    expect(denied.status).toBe(200);
    expect(await denied.json()).toEqual({
      flowId: listed.flows[0].flowId,
      status: "denied",
    });
    const poll = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", {
        protocolVersion: 1,
        action: "poll",
        flowId: listed.flows[0].flowId,
        pollToken: `flb_${"z".repeat(43)}`,
      }),
      env,
    );
    expect(poll.status).toBe(403);
  });

  it("requires the fls_* admin hop and full configuration before serving flows", async () => {
    const db = memoryDb();
    const env = bootstrapEnv(db);
    const disabled = { ...env, FOCUSLINK_BOOTSTRAP_ENABLED: "false" };
    const off = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", validStartBody()),
      disabled,
    );
    expect(off.status).toBe(503);

    const missing = {
      ...env,
      FOCUSLINK_IDENTITY_AUTHORITY_TOKEN: undefined,
    };
    const unconfigured = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", validStartBody()),
      missing,
    );
    expect(unconfigured.status).toBe(503);
    expect(db.pendingRows()).toHaveLength(0);

    const config = validateBootstrapConfiguration(env);
    expect(config).toMatchObject({
      enabled: true,
      upstream: true,
      identityAuthority: true,
      ownerSubject: true,
      pepper: true,
    });
  });

  it("rate-limits start and poll surfaces", async () => {
    const db = memoryDb();
    const env = bootstrapEnv(db);
    env.PAIR_RATE_LIMITER = {
      limit: vi.fn(async () => ({ success: false })),
    };
    const response = await handleBootstrap(
      bootstrapRequest("/account/v1/device/bootstrap", validStartBody()),
      env,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(db.pendingRows()).toHaveLength(0);
  });
});

type MemRow = BootstrapFlowRow;

interface MemDb {
  pendingRows(): Array<{ flowId: string; registration: Record<string, unknown> }>;
  expire(flowId: string): void;
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<{ success: boolean }>;
      first(): Promise<unknown>;
      all(): Promise<{ results: unknown[] }>;
    };
  };
}

function memoryDb(): MemDb {
  const rows = new Map<string, MemRow>();
  const normalize = (value: unknown) => (value === undefined ? null : value);

  function prepare(sql: string) {
    const bound = {
      bind(...args: unknown[]) {
        return {
          async run() {
            await handleStatement(sql, args);
            return { success: true };
          },
          async first() {
            return handleFirst(sql, args);
          },
          async all() {
            return { results: handleAll(sql) };
          },
        };
      },
      async run() {
        await handleStatement(sql, []);
        return { success: true };
      },
      async first() {
        return handleFirst(sql, []);
      },
      async all() {
        return { results: handleAll(sql) };
      },
    };
    return bound;
  }

  async function handleStatement(sql: string, args: unknown[]) {
    if (sql.includes("INSERT INTO bootstrap_flows")) {
      const [flowId, registrationJson, pollTokenHmac, expiresAt, createdAt] = args as [
        string,
        string,
        string,
        number,
        number,
      ];
      rows.set(flowId, {
        flow_id: flowId,
        registration_json: registrationJson,
        poll_token_hmac: pollTokenHmac,
        status: "pending",
        expires_at: expiresAt,
        created_at: createdAt,
        consumed_at: null,
        device_json: null,
      });
    }
    if (sql.includes("UPDATE bootstrap_flows SET status")) {
      // Literal-status updates (expired) bind only the flow id; parameterized
      // status updates (approve/deny) bind [status, flowId].
      const flowId = sql.includes("SET status = ?")
        ? String(args[1])
        : String(args[0]);
      const row = rows.get(flowId);
      if (row) {
        row.status = sql.includes("'expired'")
          ? "expired"
          : sql.includes("'consumed'")
            ? "consumed"
            : sql.includes("'denied'")
              ? "denied"
              : "approved";
      }
    }
    if (sql.includes("status = 'consumed'")) {
      // UPDATE ... SET status = 'consumed', consumed_at = ?, device_json = ?
      // WHERE flow_id = ? AND status = 'approved' -> binds [now, device, flowId]
      const flowId = String(args[2]);
      const row = rows.get(flowId);
      if (row) {
        row.status = "consumed";
        row.consumed_at = normalize(args[0]) as number | null;
        row.device_json = normalize(args[1]) as string | null;
      }
    }
  }

  function handleFirst(sql: string, args: unknown[]) {
    if (sql.includes("COUNT(*) AS count")) return { count: 0 };
    if (sql.includes("FROM bootstrap_flows WHERE flow_id = ?")) {
      return rows.get(String(args[0])) ?? null;
    }
    if (sql.includes("SELECT flow_id, status, expires_at FROM bootstrap_flows")) {
      return rows.get(String(args[0])) ?? null;
    }
    return null;
  }

  function handleAll(sql: string) {
    if (sql.includes("FROM bootstrap_flows")) {
      return [...rows.values()];
    }
    return [];
  }

  return {
    pendingRows() {
      return [...rows.values()]
        .filter((row) => row.status === "pending" || row.status === "approved")
        .map((row) => ({
          flowId: row.flow_id,
          registration: JSON.parse(row.registration_json) as Record<string, unknown>,
        }));
    },
    expire(flowId: string) {
      const row = rows.get(flowId);
      if (row) row.expires_at = Date.now() - 1;
    },
    prepare,
  };
}

function bootstrapEnv(db: ReturnType<typeof memoryDb>): BootstrapEnv & {
  FOCUSLINK_UPSTREAM: { fetch: ReturnType<typeof vi.fn> };
} {
  return {
    DB: db as unknown as D1Database,
    FOCUSLINK_UPSTREAM: binding(async () =>
      Response.json({
        protocolVersion: 1,
        accountPublicId: "poyi-owner",
        deviceId: "device-desktop01",
        accessToken: REGISTERED_TOKEN,
        tokenType: "Bearer",
        scopes: ["sync:read", "sync:write", "live:read", "live:write"],
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1_000,
        serverTime: Date.now(),
      }),
    ) as unknown as BootstrapEnv["FOCUSLINK_UPSTREAM"],
    FOCUSLINK_IDENTITY_AUTHORITY_TOKEN: IDENTITY_AUTHORITY_TOKEN,
    FOCUSLINK_OWNER_SUBJECT: "poyi-owner",
    FOCUSLINK_OWNER_LABEL: "Poyi",
    FOCUSLINK_BOOTSTRAP_PEPPER: BOOTSTRAP_PEPPER,
    FOCUSLINK_BOOTSTRAP_ENABLED: "true",
    FOCUSLINK_ALLOWED_ORIGINS: "https://localhost",
    PAIR_RATE_LIMITER: {
      limit: vi.fn(async () => ({ success: true })),
    },
  } as unknown as BootstrapEnv & {
    FOCUSLINK_UPSTREAM: { fetch: ReturnType<typeof vi.fn> };
  };
}

function binding(handler: (request: Request) => Promise<Response>) {
  return { fetch: vi.fn(handler) };
}

function bootstrapRequest(path: string, value: unknown): Request {
  return new Request(`https://worker.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

function adminRequest(path: string, value: unknown): Request {
  return new Request(`https://worker.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "FocusLinkService fls_0123456789abcdefghijklmnopqrstuvwxyzABCDEF",
      "x-focuslink-service-client": "poyi-oauth-as",
      "x-focuslink-service-audience": `https://worker.test${path}`,
      "x-focuslink-service-action": path.endsWith("/approve")
        ? "focuslink.bootstrap.flow.approve"
        : "focuslink.bootstrap.flow.deny",
    },
    body: JSON.stringify(value),
  });
}
