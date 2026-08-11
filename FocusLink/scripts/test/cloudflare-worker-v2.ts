import assert from 'node:assert/strict';

// Compatibility entrypoint for the former exchange-only probe. Legacy no-arg
// and `initial` invocations must remain isolated; external write modes are
// deliberately explicit and the canonical gate fail-closes without opt-in.
function compatibilityMode(value: string | undefined): string {
  return value === undefined || value === 'initial' ? 'local' : value;
}

if (process.argv[2] === 'self-check') {
  assert.equal(compatibilityMode(undefined), 'local');
  assert.equal(compatibilityMode('initial'), 'local');
  assert.equal(compatibilityMode('local'), 'local');
  assert.equal(compatibilityMode('run'), 'run');
  assert.equal(compatibilityMode('verify'), 'verify');
} else {
  process.argv[2] = compatibilityMode(process.argv[2]);
}

void import('./cloudflare-worker-protocol').catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
