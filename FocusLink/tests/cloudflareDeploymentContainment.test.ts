import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readWranglerConfig(name = 'wrangler.jsonc'): {
  source: string;
  config: Record<string, unknown>;
} {
  const source = fs.readFileSync(path.join(projectRoot, name), 'utf8');
  const json = source.replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1');
  return { source, config: JSON.parse(json) as Record<string, unknown> };
}

describe('FocusLink authority deployment containment', () => {
  it('cannot recreate workers.dev, preview or custom-domain public ingress', () => {
    const { config } = readWranglerConfig();

    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config).not.toHaveProperty('routes');
    expect(config).not.toHaveProperty('route');
  });

  it('documents required secrets without committing them as vars', () => {
    const { source, config } = readWranglerConfig();
    const vars = config.vars as Record<string, unknown>;

    for (const secret of [
      'FOCUSLINK_SYNC_TOKEN',
      'FOCUSLINK_DEVICE_PEPPER',
      'FOCUSLINK_MCP_SERVICE_TOKEN',
      'FOCUSLINK_PAIR_AUTHORITY_TOKEN',
      'FOCUSLINK_IDENTITY_AUTHORITY_TOKEN',
      'FOCUSLINK_AUTHORITY_CAPABILITY',
    ]) {
      expect(source).toContain(secret);
      expect(vars).not.toHaveProperty(secret);
    }
  });

  it('pins staging observation to the central identity-focus audience', () => {
    const { source, config } = readWranglerConfig('wrangler.staging.jsonc');
    const vars = config.vars as Record<string, unknown>;

    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config).not.toHaveProperty('routes');
    expect(vars.FOCUSLINK_AUTHORITY_AUDIENCE).toBe(
      'https://personal-mcp-authority-staging.focuslink-poyi-6465e9.workers.dev/authority/identity-focus',
    );
    expect(source).toContain('FOCUSLINK_AUTHORITY_CAPABILITY');
    expect(source).toContain('FOCUSLINK_IDENTITY_AUTHORITY_TOKEN');
    expect(vars).not.toHaveProperty('FOCUSLINK_AUTHORITY_CAPABILITY');
    expect(vars).not.toHaveProperty('FOCUSLINK_IDENTITY_AUTHORITY_TOKEN');
  });

  it('allows an expired unchanged state to advance through an atomic DO checkpoint', () => {
    const source = fs.readFileSync(
      path.join(projectRoot, 'cloudflare', 'accountDurableObject.ts'),
      'utf8',
    );

    expect(source).not.toContain('state_hash TEXT NOT NULL UNIQUE');
    expect(source).toContain("'authority_observation_schema_version', '2'");
    expect(source).toContain('this.ctx.storage.transactionSync(() => {');
    expect(source).toContain('this.ensureAuthorityObservation(Date.now())');
    expect(source).toContain('this.assertAuthorityObservationDependencies()');
  });

  it('does not replay the full account schema on every Durable Object wake', () => {
    const source = fs.readFileSync(
      path.join(projectRoot, 'cloudflare', 'accountDurableObject.ts'),
      'utf8',
    );
    const initializer = source.slice(source.indexOf('private initializeSchema(): void'));
    const fastPath = initializer.indexOf("WHERE key = 'account_schema_version'");
    const legacyFastPath = initializer.indexOf(
      "WHERE key = 'authority_observation_schema_version'",
    );
    const fullSchema = initializer.indexOf('CREATE TABLE IF NOT EXISTS entities');

    expect(fastPath).toBeGreaterThanOrEqual(0);
    expect(legacyFastPath).toBeGreaterThan(fastPath);
    expect(fullSchema).toBeGreaterThan(legacyFastPath);
    expect(initializer).toContain("VALUES ('account_schema_version', '1')");
  });

  it('publishes completed live sessions to v2 and backfills legacy-only bundles', () => {
    const source = fs.readFileSync(
      path.join(projectRoot, 'cloudflare', 'accountDurableObject.ts'),
      'utf8',
    );
    const publishLive = source.slice(
      source.indexOf('private publishLiveBundle'),
      source.indexOf('private readLive'),
    );
    const syncV2 = source.slice(
      source.indexOf('private syncV2'),
      source.indexOf('private applyV2Mutation'),
    );

    expect(publishLive).toContain("'focus_ledger_v2'");
    expect(publishLive).toContain("'focus_metadata_v2'");
    expect(publishLive).toContain('splitBundleForSyncV2(bundle, deviceId)');
    expect(syncV2.indexOf('this.backfillLegacyCompletedBundles()')).toBeLessThan(
      syncV2.indexOf('const epoch = this.v2Epoch()'),
    );
    expect(source).toContain("'legacy_v1_completed_bundle_backfill_version', '1'");
  });

  it('keeps every Focus Guard entity opaque behind the Account DO envelope validator', () => {
    const source = fs.readFileSync(
      path.join(projectRoot, 'cloudflare', 'accountDurableObject.ts'),
      'utf8',
    );

    for (const entityType of [
      'focus_guard_rule_v1',
      'focus_guard_state_v1',
      'focus_guard_completion_v1',
      'focus_guard_config_v1',
    ]) {
      expect(source).toContain(`'${entityType}'`);
    }
    expect(source).toContain('isEncryptedFocusGuardEnvelopeV1');
    expect(source).toContain('invalid_encrypted_focus_guard_envelope');
    expect(source).not.toContain('focus_guard_plaintext');
  });

  it('keeps the retired Node service from becoming a second production authority', () => {
    const server = fs.readFileSync(path.join(projectRoot, 'cloud', 'server.ts'), 'utf8');
    const dockerfile = fs.readFileSync(path.join(projectRoot, 'cloud', 'Dockerfile'), 'utf8');
    const compose = fs.readFileSync(path.join(projectRoot, 'cloud', 'docker-compose.yml'), 'utf8');

    expect(server).toContain('PERSONAL_CLOUD_RETIRED_MESSAGE');
    expect(server).not.toContain("profile: 'personal-cloud'");
    expect(dockerfile).toContain('FocusLink retired Node authority');
    expect(dockerfile).not.toContain('EXPOSE 8787');
    expect(compose).not.toContain('focuslink-cloud:');
    expect(compose).not.toContain('FOCUSLINK_CLOUD_ACCOUNTS');
    expect(compose).not.toContain('focuslink-cloud-data');
  });
});
