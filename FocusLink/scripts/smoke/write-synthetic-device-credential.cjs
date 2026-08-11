const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, safeStorage } = require('electron');

const target = path.resolve(process.argv[2] || '');
const tempRoot = path.resolve(os.tmpdir());
if (!target.toLowerCase().startsWith(`${tempRoot.toLowerCase()}${path.sep}`)) {
  throw new Error(`refusing synthetic credential outside the system temp directory: ${target}`);
}
if (!path.basename(target).startsWith('focuslink-live-fallback-')) {
  throw new Error(`unexpected synthetic credential directory: ${target}`);
}

app.setPath('userData', target);

app
  .whenReady()
  .then(() => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage is unavailable for the packaged live fallback smoke');
    }
    const encryptedToken = safeStorage
      .encryptString('focuslink-packaged-live-fallback-synthetic-token')
      .toString('base64');
    fs.writeFileSync(
      path.join(target, 'focuslink-device-sync-credential.json'),
      JSON.stringify({ version: 1, encryptedToken }),
      { encoding: 'utf8', mode: 0o600 },
    );
    app.quit();
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    app.exit(1);
  });
