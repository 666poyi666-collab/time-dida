const endpoint = new URL(
  process.env.FOCUSLINK_MCP_URL ??
    "https://foxlink-mcp.focuslink-poyi-6465e9.workers.dev/mcp",
);
const token = process.env.FOCUSLINK_MCP_ACCESS_TOKEN ?? "";
const now = Date.now();
const from = integerEnv("FOCUSLINK_VERIFY_FROM", now - 30 * 24 * 60 * 60 * 1000);
const to = integerEnv("FOCUSLINK_VERIFY_TO", now + 60_000);
const limit = integerEnv("FOCUSLINK_VERIFY_LIMIT", 100);
const minimumRecords = integerEnv("FOCUSLINK_EXPECT_MIN_RECORDS", 1);
const minimumTasks = integerEnv("FOCUSLINK_EXPECT_MIN_TASKS", 1);
const minimumActiveMs = integerEnv("FOCUSLINK_EXPECT_MIN_ACTIVE_MS", 1);

if (!/^https:$/.test(endpoint.protocol)) fail("FOCUSLINK_MCP_URL must use HTTPS");
if (!/^[\x21-\x7e]{32,8192}$/.test(token)) {
  fail("FOCUSLINK_MCP_ACCESS_TOKEN is missing or invalid");
}
if (!(from >= 0 && to > from && limit >= 1 && limit <= 100)) {
  fail("verification range or limit is invalid");
}

const discovered = await rpc("server/discover", {}, 1);
if (!discovered.message?.result?.supportedVersions?.includes("2026-07-28")) {
  fail("MCP server does not advertise 2026-07-28");
}
if (discovered.response.headers.get("mcp-session-id")) {
  fail("stateless MCP unexpectedly returned a session id");
}
const called = await rpc(
  "tools/call",
  {
    name: "focuslink_get_task_summary",
    arguments: { from, to, limit },
  },
  2,
);

const content = called.message?.result?.content;
const text = Array.isArray(content)
  ? content.find((part) => part?.type === "text" && typeof part.text === "string")?.text
  : null;
if (!text) fail("tool result has no text content");

let summary;
try {
  summary = JSON.parse(text);
} catch {
  fail("tool result is not JSON");
}
validateSummary(summary);

console.log(
  JSON.stringify(
    {
      ok: true,
      checkedAt: new Date().toISOString(),
      endpoint: endpoint.origin + endpoint.pathname,
      protocol: "2026-07-28",
      authority: summary.authority,
      freshness: summary.freshness,
      dataThrough: summary.dataThrough,
      totals: summary.totals,
      taskCount: summary.tasks.length,
      recentSessionCount: summary.recentSessions.length,
      changeSeq: summary.changeSeq,
      privacyBoundaryVerified: true,
    },
    null,
    2,
  ),
);

async function rpc(method, params, id) {
  const name = typeof params.name === "string" ? params.name : null;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(name ? { "mcp-name": name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "focuslink-pc-off-verifier",
            version: "2.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    fail(`MCP request returned HTTP ${response.status}, expected 200`);
  }
  const raw = await response.text();
  const frames = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  let parsed;
  try {
    parsed = frames.length > 0 ? JSON.parse(frames.at(-1)) : JSON.parse(raw);
  } catch {
    fail("MCP response is not JSON");
  }
  if (parsed?.error) fail(`MCP JSON-RPC error ${parsed.error.code ?? "unknown"}`);
  return { response, message: parsed };
}

function validateSummary(value) {
  if (!isObject(value)) fail("summary must be an object");
  if (value.schemaVersion !== 1 || value.authority !== "focuslink-account-do") {
    fail("summary authority contract mismatch");
  }
  if (
    !Number.isSafeInteger(value.generatedAt) ||
    !Number.isSafeInteger(value.lastVerifiedAt) ||
    value.lastVerifiedAt > value.generatedAt ||
    !Number.isSafeInteger(value.dataThrough)
  ) {
    fail("summary verification timestamps are invalid");
  }
  if (
    !isObject(value.freshness) ||
    !["fresh", "stale"].includes(value.freshness.state) ||
    !Number.isSafeInteger(value.freshness.ageMs) ||
    value.freshness.ageMs < 0 ||
    value.freshness.staleAfterMs !== 900_000
  ) {
    fail("summary freshness is not verifiable");
  }
  if (
    !isObject(value.range) ||
    value.range.from !== from ||
    value.range.to !== to ||
    !isObject(value.totals) ||
    !Number.isSafeInteger(value.totals.focusCount) ||
    !Number.isSafeInteger(value.totals.activeMs) ||
    !Number.isSafeInteger(value.totals.pausedMs) ||
    !Number.isSafeInteger(value.totals.wallMs) ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.recentSessions) ||
    !Number.isSafeInteger(value.changeSeq)
  ) {
    fail("summary DTO is incomplete");
  }
  if (
    value.totals.focusCount < minimumRecords ||
    value.totals.activeMs < minimumActiveMs ||
    value.tasks.length < minimumTasks ||
    value.recentSessions.length < minimumRecords
  ) {
    fail("cloud summary does not contain the expected real focus evidence");
  }
  const forbidden = new Set([
    "authorization",
    "cookie",
    "cookies",
    "credential",
    "credentials",
    "deviceid",
    "note",
    "notes",
    "tag",
    "tags",
    "token",
  ]);
  walk(value, (key) => {
    if (forbidden.has(key.toLowerCase())) {
      fail(`privacy boundary violation: forbidden key ${key}`);
    }
  });
}

function walk(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      visit(key);
      walk(item, visit);
    }
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integerEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) fail(`${name} must be a safe integer`);
  return value;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}
