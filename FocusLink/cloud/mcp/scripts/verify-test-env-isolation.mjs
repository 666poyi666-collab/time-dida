import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "tests/fixtures/wrangler.test.jsonc");
const configDirectory = dirname(configPath);
const vitestConfig = readFileSync(resolve(root, "vitest.config.ts"), "utf8");

if (configDirectory === root) {
  throw new Error("test environment isolation is not configured");
}
if (!vitestConfig.includes("./tests/fixtures/wrangler.test.jsonc")) {
  throw new Error("vitest is not pinned to the isolated Wrangler fixture");
}

const hasCredentialFile = readdirSync(configDirectory).some((name) =>
  /^(?:\.dev\.vars|\.env)(?:\..+)?$/.test(name),
);
if (hasCredentialFile) {
  // Deliberately do not print the filename or its contents.
  throw new Error("credential-like files are forbidden beside the test Wrangler fixture");
}
