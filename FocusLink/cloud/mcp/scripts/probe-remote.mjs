const staging = process.argv.includes("--staging");
const canonical =
  process.env.FOXLINK_CANONICAL_URL ??
  (staging
    ? "https://foxlink-mcp-staging.focuslink-poyi-6465e9.workers.dev"
    : "https://foxlink-mcp.focuslink-poyi-6465e9.workers.dev");
const issuer =
  process.env.FOXLINK_OAUTH_ISSUER ??
  (staging
    ? "https://poyi-oauth-as-staging.focuslink-poyi-6465e9.workers.dev"
    : "https://poyi-oauth-as.focuslink-poyi-6465e9.workers.dev");

const fakeDeviceToken =
  "fl2_fakeacct_fake-device_00000000000000000000000000000000";
const fakeOAuthToken =
  "eyJhbGciOiJSUzI1NiIsInR5cCI6ImF0K2p3dCIsImtpZCI6ImZha2UifQ.eyJhdWQiOiJmYWtlIn0.fake";
const fakeNonce = "00000000000000000000000000000000";

const cases = [
  {
    name: "health",
    path: "/healthz",
    expectedStatus: 200,
    check: (body) => body?.ok === true && body?.service === "foxlink-cloud-mcp",
  },
  {
    name: "ready-real-dependencies",
    path: "/readyz",
    expectedStatus: 200,
    check: (body) =>
      body?.ok === true &&
      body?.storage === "ready" &&
      body?.configuration === "ready",
  },
  {
    name: "oauth-protected-resource",
    path: "/.well-known/oauth-protected-resource/mcp",
    expectedStatus: 200,
    check: (body) =>
      body?.resource === `${canonical}/mcp` &&
      Array.isArray(body?.authorization_servers) &&
      body.authorization_servers.length === 1 &&
      body.authorization_servers[0] === issuer &&
      Array.isArray(body?.scopes_supported) &&
      body.scopes_supported.length === 1 &&
      body.scopes_supported[0] === "focuslink:read",
  },
  {
    name: "mcp-requires-oauth",
    path: "/mcp",
    expectedStatus: 401,
    expectedChallenge: "Bearer ",
  },
  {
    name: "mcp-rejects-device-token",
    path: "/mcp",
    expectedStatus: 401,
    headers: { authorization: `Bearer ${fakeDeviceToken}` },
    expectedChallenge: "Bearer ",
  },
  {
    name: "sync-requires-device-token",
    path: "/sync/v2/status",
    expectedStatus: 401,
  },
  {
    name: "sync-rejects-oauth-token",
    path: "/sync/v2/status",
    expectedStatus: 401,
    headers: { authorization: `Bearer ${fakeOAuthToken}` },
  },
  {
    name: "fake-device-not-authorized",
    path: "/sync/v2/status",
    expectedStatus: 401,
    headers: { authorization: `Bearer ${fakeDeviceToken}` },
  },
  {
    name: "legacy-status-gone",
    path: "/sync/v1/status",
    expectedStatus: 410,
  },
  {
    name: "legacy-exchange-gone",
    method: "POST",
    path: "/sync/v1/exchange",
    expectedStatus: 410,
  },
  {
    name: "snapshot-push-gone",
    method: "POST",
    path: "/sync/push",
    expectedStatus: 410,
  },
  {
    name: "secret-in-url-mcp-gone",
    path: "/legacy-access-key/mcp",
    expectedStatus: 410,
  },
  {
    name: "pair-offer-is-not-public",
    method: "POST",
    path: "/sync/v1/pair/offers",
    expectedStatus: 403,
  },
  {
    name: "pair-offer-rejects-oauth",
    method: "POST",
    path: "/sync/v1/pair/offers",
    expectedStatus: 403,
    headers: { authorization: `Bearer ${fakeOAuthToken}` },
  },
  {
    name: "pair-exchange-rejects-credentials",
    method: "POST",
    path: "/sync/v1/pair/exchange",
    expectedStatus: 403,
    headers: {
      authorization: `Bearer ${fakeDeviceToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      nonce: fakeNonce,
      device: { platform: "android", appVersion: "staging-probe" },
    }),
  },
  {
    name: "pair-exchange-rejects-caller-device-id",
    method: "POST",
    path: "/sync/v1/pair/exchange",
    expectedStatus: 400,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nonce: fakeNonce,
      deviceId: "device-caller-controlled",
      device: { platform: "android", appVersion: "staging-probe" },
    }),
  },
  {
    name: "pair-exchange-reaches-account-authority",
    method: "POST",
    path: "/sync/v1/pair/exchange",
    expectedStatus: 410,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nonce: fakeNonce,
      device: { platform: "android", appVersion: "staging-probe" },
    }),
    expectedAuthority: "durable-object-v2",
    expectedAdapter: "sync-v1-pairing-to-v2",
  },
  {
    name: "pair-cors-allowlist",
    method: "OPTIONS",
    path: "/sync/v1/pair/exchange",
    expectedStatus: 204,
    headers: { origin: "capacitor://localhost" },
    expectedAllowOrigin: "capacitor://localhost",
  },
  {
    name: "pair-cors-deny-nonallowlisted",
    method: "OPTIONS",
    path: "/sync/v1/pair/exchange",
    expectedStatus: 403,
    headers: { origin: "https://attacker.invalid" },
  },
];

const results = [];
let failed = false;
for (const probe of cases) {
  try {
    const response = await fetch(`${canonical}${probe.path}`, {
      method: probe.method ?? "GET",
      headers: probe.headers,
      body: probe.body,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    let body = null;
    if (response.headers.get("content-type")?.startsWith("application/json")) {
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    } else {
      await response.body?.cancel();
    }
    const contractOk = probe.check ? Boolean(probe.check(body)) : true;
    const challengeOk = probe.expectedChallenge
      ? (response.headers.get("www-authenticate") ?? "").startsWith(
          probe.expectedChallenge,
        )
      : true;
    const allowOriginOk = probe.expectedAllowOrigin
      ? response.headers.get("access-control-allow-origin") ===
        probe.expectedAllowOrigin
      : true;
    const authorityOk = probe.expectedAuthority
      ? response.headers.get("x-focuslink-authority") ===
        probe.expectedAuthority
      : true;
    const adapterOk = probe.expectedAdapter
      ? response.headers.get("x-focuslink-adapter") === probe.expectedAdapter
      : true;
    const ok =
      response.status === probe.expectedStatus &&
      contractOk &&
      challengeOk &&
      allowOriginOk &&
      authorityOk &&
      adapterOk;
    failed ||= !ok;
    results.push({
      name: probe.name,
      method: probe.method ?? "GET",
      path: probe.path,
      expectedStatus: probe.expectedStatus,
      status: response.status,
      contractOk,
      challengeOk,
      allowOriginOk,
      authorityOk,
      adapterOk,
      ok,
    });
  } catch (error) {
    failed = true;
    results.push({
      name: probe.name,
      method: probe.method ?? "GET",
      path: probe.path,
      expectedStatus: probe.expectedStatus,
      status: "network_error",
      error: error instanceof Error ? error.name : "unknown",
      ok: false,
    });
  }
}

console.log(
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      canonical,
      issuer,
      passed: results.filter((result) => result.ok).length,
      total: results.length,
      ok: !failed,
      results,
    },
    null,
    2,
  ),
);
if (failed) process.exitCode = 1;
