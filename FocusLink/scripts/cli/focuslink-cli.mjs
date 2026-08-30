#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(directory, '..', '..');
const tsxCli = path.join(workspace, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const source = path.join(directory, 'focuslink-cli.ts');
const child = spawn(process.execPath, [tsxCli, source, ...process.argv.slice(2)], {
  cwd: workspace,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

child.once('error', () => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: 'focuslink_cli_launcher_failed' })}\n`,
  );
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
