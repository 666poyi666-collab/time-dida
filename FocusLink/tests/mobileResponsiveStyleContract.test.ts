import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function compactCss(file: string): string {
  return fs
    .readFileSync(path.join(projectRoot, 'src', 'mobile', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
}

describe('phone, tablet and watch responsive style contract', () => {
  it('keeps the complete eight-digit watch clock and both actions inside the viewport', () => {
    const css = compactCss('watch.css');

    expect(css).toMatch(/\.watch-main\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.watch-clock-cell\s*\{[^}]*overflow:\s*hidden[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.watch-clock\s*\{[^}]*font-size:\s*min\(68px,\s*17\.5vw,\s*22vh\)/);
    expect(css).toMatch(
      /\.watch-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(/\.watch-actions button\s*\{[^}]*min-width:\s*0/);
  });

  it('wraps phone sync failures and expands tablet runtime facts instead of ellipsizing them', () => {
    const css = compactCss('mobile.css');

    expect(css).toMatch(
      /@media \(max-width:\s*620px\)[\s\S]*?\.sync-copy span\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*text-overflow:\s*clip[^}]*white-space:\s*normal/,
    );
    expect(css).toMatch(
      /@media \(min-width:\s*760px\)[\s\S]*?\.runtime-facts dd\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*text-overflow:\s*clip[^}]*white-space:\s*normal/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*480px\)[\s\S]*?\.focus-actions\s*\{[^}]*margin-right:\s*calc\(-1 \* max\(14px,[^}]*margin-left:\s*calc\(-1 \* max\(14px/,
    );
  });
});
