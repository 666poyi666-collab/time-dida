import { readFile, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2];
const expectedDeviceId = process.argv[3];
if (!source || !expectedDeviceId || !/^device-[A-Za-z0-9._:-]{1,190}$/.test(expectedDeviceId)) {
  throw new Error("usage: provision-projection-token <protected-json> <device-id>");
}

let parsed;
try {
  parsed = JSON.parse(await readFile(resolve(source), "utf8"));
} catch {
  throw new Error("projection credential bundle is unreadable");
}
if (
  !parsed ||
  Object.keys(parsed).sort().join(",") !== "accessToken,deviceId" ||
  parsed.deviceId !== expectedDeviceId ||
  !/^fl2_[A-Za-z0-9-]{6,80}_[A-Za-z0-9-]{6,80}_[A-Za-z0-9_-]{32,160}$/.test(
    parsed.accessToken,
  )
) {
  throw new Error("projection credential bundle is invalid");
}

const wrangler = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const child = spawnSync(
  process.execPath,
  [wrangler, "secret", "put", "FOCUSLINK_DEVICE_TOKEN"],
  {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    input: `${parsed.accessToken}\n`,
    stdio: ["pipe", "pipe", "pipe"],
  },
);
parsed.accessToken = "";
if (child.status !== 0) {
  throw new Error("projection Worker secret provisioning failed");
}
await unlink(resolve(source));
process.stdout.write(
  `${JSON.stringify({ ok: true, deviceId: expectedDeviceId, secretEmitted: false })}\n`,
);
