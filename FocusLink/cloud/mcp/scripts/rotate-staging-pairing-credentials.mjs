import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const confirmed = args.delete("--confirm-staging");
const validateOnly = args.delete("--validate-only");

if (args.size > 0 || (!confirmed && !validateOnly)) {
  throw new Error(
    "use --validate-only or --confirm-staging; production rotation is intentionally unsupported",
  );
}

const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositories = {
  oauth: "C:\\开发\\mcp开发\\poyi-oauth-as",
  gateway: gatewayRoot,
  authority: "C:\\Users\\poyi\\Desktop\\time1\\FocusLink",
};

for (const root of Object.values(repositories)) {
  if (!existsSync(resolve(root, "wrangler.staging.jsonc"))) {
    throw new Error(`missing staging config: ${root}`);
  }
}

function opaque(prefix) {
  return `${prefix}${randomBytes(48).toString("base64url")}`;
}

function putSecret(root, name, value) {
  if (validateOnly) return;
  const wrangler = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wrangler)) {
    throw new Error(`wrangler is not installed in ${root}`);
  }
  const result = spawnSync(
    process.execPath,
    [wrangler, "secret", "put", name, "--config", "wrangler.staging.jsonc"],
    {
      cwd: root,
      env: process.env,
      input: value,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    throw new Error(`failed to provision ${name} in ${root}`);
  }
  process.stdout.write(`provisioned ${name} in ${root}\n`);
}

const pairServiceCredential = opaque("fls_");
const pairAuthorityToken = opaque("fla_");

try {
  putSecret(
    repositories.oauth,
    "FOCUSLINK_PAIR_SERVICE_CREDENTIAL",
    pairServiceCredential,
  );
  putSecret(
    repositories.gateway,
    "FOCUSLINK_PAIR_SERVICE_CREDENTIAL",
    pairServiceCredential,
  );
  putSecret(
    repositories.gateway,
    "FOCUSLINK_PAIR_AUTHORITY_TOKEN",
    pairAuthorityToken,
  );
  putSecret(
    repositories.authority,
    "FOCUSLINK_PAIR_AUTHORITY_TOKEN",
    pairAuthorityToken,
  );
} finally {
  // Values live only for this process and are never printed or written to disk.
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    environment: "staging",
    validateOnly,
    rotatedBindings: validateOnly ? 0 : 4,
    secretsEmitted: false,
  })}\n`,
);
