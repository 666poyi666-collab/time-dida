import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('release LFS hygiene', () => {
  it('keeps build metadata generation away from release executable filters', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'scripts', 'build', 'gen-version.js'),
      'utf8',
    );

    expect(source).toContain("const { execFileSync } = require('node:child_process')");
    expect(source).toContain("'filter.lfs.process='");
    expect(source).toContain("'filter.lfs.required=false'");
    expect(source).toContain("':(exclude)release-v*/FocusLink-*-x64*.exe'");
    expect(source).not.toContain("execSync('git status");
  });
});
