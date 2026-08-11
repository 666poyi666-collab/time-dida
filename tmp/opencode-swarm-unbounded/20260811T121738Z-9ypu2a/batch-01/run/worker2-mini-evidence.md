# Worker 2/3 retry-mini-finish evidence

Files changed (owned only):
- FocusLink/src/styles/temporal-mini.css (+19)
- FocusLink/scripts/smoke/mini-ui-smoke.cjs (+286)

## CSS fixed presets (all approved values applied)
- .mini-state-badge .mini-state-dot -> 7px (expanded state dot); collapsed dot stays 6px
- .mini-collapsed-content grid columns -> minmax(0,1fr) 30px; .mini-collapsed-content .mini-icon-button -> 24x24 min-width:24
- .mini-expanded-progress height 11px -> 10px
- .mini-marquee 9s -> 11s (11s linear infinite alternate)
- .mini-metric span 8px -> 8.5px; strong 9px -> 9.5px
- buttons height 16px -> 17px, font-size 8.5px -> 9px
- 184x44 / 256x70 constants/DOM/drag/snap untouched (shared/miniWindowLayout.ts not modified)

## Smoke additions (mini-ui-smoke.cjs)
- inspectMini.cssPresets instrumentation (collapsed grid columns, expand button rect+min-width, expanded dot, marquee animationName/duration, task block class/tabIndex/appRegion/title animation, metric fonts, button height/font, progress height, shell transition duration)
- assertResult: collapsed 30px column + 24px button + 24px min-width guard; expanded 7px dot / 8.5px metrics / 9.5px values / 17px controls / 9px text / 10px progress
- new phase verifyLongTimeAndReducedMotion:
  - long H:MM:SS probe (1:23:45 -> 17px mini-time-long, unclipped, inside shell) in expanded AND collapsed
  - long CJK task via timer.startWithTask -> marquee at 11s, copy preserved
  - Emulation.setEmulatedMedia prefers-reduced-motion:reduce + reload -> focusable (.is-scroll tabIndex=0, no-drag) task block, no marquee, no title animation, shell transition disabled
- waitForMiniAfterReload: tolerant poll across renderer navigation (reloads)
- wired into main() before report under results.longTimeAndReducedMotion

## Verification
- node --check mini-ui-smoke.cjs: PASS (twice, after edits)
- prettier --check on both owned files: PASS
- vitest miniDisplayPolicy/miniWindowLayout/miniBringToFrontContract/themeTokens/focusIconGeometry: 29/29 PASS
- styleContract.test.ts: 5/6 PASS; the 1 failure is a pre-existing broken assertion in the dirty working tree (compares join('；') string toEqual []), fails even with zero offenders and with no literal white added by this job; file is not owned by this job (touched by in-flight v0.12.86 work)
- static preset matrix check (CSS + layout + smoke regexes): 23/23 PASS
- Full packaged mini-ui-smoke requires a clean-commit dist build (v0.12.86 win-unpacked does not exist and working tree is dirty), so it is the downstream Release Gate responsibility.

## Risks
- Real-packaged smoke not executed here (dirty tree / no v0.12.86 build); assertions will run in Release Gate after clean commit + dist.
- 17px buttons in 18px footer row: 1px breathing room; footer overflow hidden; visual check deferred to packaged smoke screenshots.
- Concurrent jobs may still be editing shared styleContract.test.ts.
