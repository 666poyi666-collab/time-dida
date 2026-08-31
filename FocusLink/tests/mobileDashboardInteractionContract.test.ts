import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule, type Node, type Root, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readProjectFile(...segments: string[]): string {
  return fs.readFileSync(path.join(projectRoot, ...segments), 'utf8');
}

const dashboardSource = readProjectFile('src', 'mobile', 'DashboardView.tsx');
const mobileAppSource = readProjectFile('src', 'mobile', 'MobileApp.tsx');
const mobile13Root = postcss.parse(readProjectFile('src', 'mobile', 'mobile-1-3.css'));

function ancestorMedia(rule: Rule): string[] {
  const result: string[] = [];
  let parent: Node | undefined = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && (parent as AtRule).name === 'media') {
      result.push((parent as AtRule).params);
    }
    parent = parent.parent;
  }
  return result;
}

function expectRule(
  root: Root,
  selector: string,
  expected: Record<string, string>,
  media: string | null = null,
): void {
  let match: Rule | undefined;
  root.walkRules((rule) => {
    if (match || !rule.selectors.includes(selector)) return;
    const mediaRules = ancestorMedia(rule);
    if (media === null ? mediaRules.length > 0 : !mediaRules.includes(media)) return;
    const declarations = Object.fromEntries(
      (rule.nodes ?? [])
        .filter((node) => node.type === 'decl')
        .map((node) => [node.prop, node.value]),
    );
    if (Object.entries(expected).every(([property, value]) => declarations[property] === value)) {
      match = rule;
    }
  });
  expect(
    match,
    `${selector} should include ${JSON.stringify(expected)} in ${media ?? 'root'}`,
  ).toBeDefined();
}

describe('mobile dashboard interaction contract', () => {
  it('defaults to seven days and keeps selected-day state connected to its summary', () => {
    expect(dashboardSource).toContain("useState<DashboardRangeChoice>('7d')");
    expect(dashboardSource).toContain(
      'onSelect={(date) => setSelectedDate((current) => (current === date ? null : date))}',
    );
    expect(dashboardSource).toContain(
      '<SelectedDaySummary ledger={selectedLedger} onClear={() => setSelectedDate(null)} />',
    );
  });

  it('resolves timeline task state from the current task snapshot', () => {
    expect(mobileAppSource).toContain('tasks={taskSnapshot?.snapshot?.tasks ?? null}');
    expect(dashboardSource).toContain('resolveMobileTimelineTasks(interval, records, tasks)');
    expect(dashboardSource).toContain('专注记录结束不代表任务自动完成');
  });

  it('keeps proportional bars visual-only and provides non-overlapping keyboard targets', () => {
    expect(dashboardSource).toContain('role="group" aria-label="时间段明细入口"');
    expect(dashboardSource).toContain('className={`timeline-interval-choice ${interval.kind}`}');
    expectRule(mobile13Root, '.mobile-day-lane .ledger-interval', {
      'min-width': '4px',
      'pointer-events': 'none',
    });
    expectRule(mobile13Root, '.timeline-interval-choice', {
      'min-width': '180px',
      'min-height': '48px',
    });
  });

  it('reserves separate readout and donut columns at phone and narrow-phone widths', () => {
    expectRule(mobile13Root, '.ledger-dashboard-hero', {
      'grid-template-columns': 'minmax(0, 1fr) 112px',
      overflow: 'hidden',
    });
    expectRule(mobile13Root, '.ledger-dashboard-hero .dashboard-primary', {
      overflow: 'hidden',
    });
    expectRule(mobile13Root, '.ledger-dashboard-hero .mobile-time-donut', {
      width: '108px',
      height: '108px',
    });
    expectRule(
      mobile13Root,
      '.ledger-dashboard-hero',
      { 'grid-template-columns': 'minmax(0, 1fr) 96px' },
      '(max-width: 380px)',
    );
    expectRule(
      mobile13Root,
      '.ledger-dashboard-hero .mobile-time-donut',
      { width: '92px', height: '92px' },
      '(max-width: 380px)',
    );
  });

  it('removes dashboard detail and choice motion when reduced motion is requested', () => {
    expectRule(
      mobile13Root,
      '.timeline-interval-choice',
      { animation: 'none', transition: 'none' },
      '(prefers-reduced-motion: reduce)',
    );
  });
});
