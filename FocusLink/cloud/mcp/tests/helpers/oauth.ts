import { vi } from "vitest";

export const TEST_OAUTH_ISSUER = "https://oauth.test";
export const TEST_OAUTH_AUDIENCE = "https://worker.test/mcp";
export const TEST_OAUTH_JWKS_URL = "https://oauth.test/jwks.json";
export const TEST_OAUTH_INTROSPECTION_URL = "https://oauth.test/introspect";
export const TEST_OAUTH_RS_CLIENT_ID = "foxlink-cloud-mcp-test";
export const TEST_OAUTH_RS_CLIENT_SECRET = "test-rs-client-secret-0123456789abcdef";

export interface OAuthClaims {
  iss: string;
  sub: string;
  aud: string;
  resource: string;
  scope: string;
  iat: number;
  exp: number;
  jti: string;
  client_id: string;
  token_use: "access_token";
}

export interface OAuthFixture {
  token: string;
  claims: OAuthClaims;
  calls: Array<{ method: string; url: string; authorization: string | null }>;
  install(): void;
}

export async function createOAuthFixture(
  overrides: Partial<OAuthClaims> = {},
): Promise<OAuthFixture> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicJwk = {
    ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<string, unknown>),
    kid: "test-rs256-key",
    use: "sig",
    alg: "RS256",
  };
  const iat = Math.floor(Date.now() / 1_000);
  const claims: OAuthClaims = {
    iss: TEST_OAUTH_ISSUER,
    sub: "poyi-owner",
    aud: TEST_OAUTH_AUDIENCE,
    resource: TEST_OAUTH_AUDIENCE,
    scope: "focuslink:read",
    iat,
    exp: iat + 240,
    jti: "test-jti-0001",
    client_id: "codex-worker-contract",
    token_use: "access_token",
    ...overrides,
  };
  const header = encodeJson({ alg: "RS256", kid: "test-rs256-key", typ: "at+jwt" });
  const payload = encodeJson(claims);
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(unsigned),
  );
  const token = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const calls: OAuthFixture["calls"] = [];

  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const safeInit =
      init?.redirect === "error" ? ({ ...init, redirect: "manual" } satisfies RequestInit) : init;
    const request =
      input instanceof Request
        ? input
        : new Request(typeof input === "string" ? input : input.toString(), safeInit);
    calls.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.get("authorization"),
    });

    if (request.method === "GET" && request.url === TEST_OAUTH_JWKS_URL) {
      return Response.json({ keys: [publicJwk] });
    }
    if (
      request.method === "GET" &&
      request.url === `${TEST_OAUTH_ISSUER}/.well-known/oauth-authorization-server`
    ) {
      return Response.json({
        issuer: TEST_OAUTH_ISSUER,
        jwks_uri: TEST_OAUTH_JWKS_URL,
        introspection_endpoint: TEST_OAUTH_INTROSPECTION_URL,
        introspection_endpoint_auth_methods_supported: ["client_secret_basic"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (request.method === "POST" && request.url === TEST_OAUTH_INTROSPECTION_URL) {
      const basic = `Basic ${btoa(`${TEST_OAUTH_RS_CLIENT_ID}:${TEST_OAUTH_RS_CLIENT_SECRET}`)}`;
      if (request.headers.get("authorization") !== basic) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const form = await request.formData();
      if (form.get("token") !== token || form.get("token_type_hint") !== "access_token") {
        return Response.json({ active: false });
      }
      return Response.json({
        active: true,
        token_type: "Bearer",
        ...claims,
      });
    }
    return Response.json({ error: "unexpected_test_outbound" }, { status: 503 });
  };

  return {
    token,
    claims,
    calls,
    install() {
      vi.stubGlobal("fetch", vi.fn(fetcher));
    },
  };
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
