import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readWranglerConfig(): { source: string; config: Record<string, unknown> } {
  const source = fs.readFileSync(path.join(projectRoot, 'wrangler.jsonc'), 'utf8');
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
    ]) {
      expect(source).toContain(secret);
      expect(vars).not.toHaveProperty(secret);
    }
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
