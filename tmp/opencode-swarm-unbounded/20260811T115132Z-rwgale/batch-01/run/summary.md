# FocusLink v0.12.86 mini retry DeepSeek swarm

- Run: `20260811T115132Z-ccl0vv`
- Jobs: 1
- Completed: 1
- Failed: 0
- Agent: `plan`; variant: `max`; concurrency: 1

## mini-window-ui-retry: Retry focused mini window audit

- Status: completed
- Session: `ses_00f5617ebffeJSPcsWPE6eQxeB`
- Attempts: 1; continuations: 0

Evidence gathered (read-only, no edits). Plan below.

## v0.12.86 Mini Visual Polish Plan (fixed-preset, scope-tightened)

Sizes stay exactly as `MINI_WINDOW_COLLAPSED_SIZE` 184x44 / `MINI_WINDOW_EXPANDED_SIZE` 256x70 in `shared/miniWindowLayout.ts:15-16` (untouched). All polish is CSS-only in `temporal-mini.css`; no new DOM layers (smoke asserts absence of `material-glow/grain/focus-aura/signal`, MiniWindow.tsx:482-485). Drag/snap/auto-collapse/dock-transition untouched.

**CHANGES**
- `.mini-collapsed-content` (temporal-mini.css:99-108): grid columns `minmax(0,1fr) 27px` → `minmax(0,1fr) 30px`; keep padding `0 3px 0 11px`. Add scoped `.mini-collapsed-content .mini-icon-button { width:24px; height:100%; border-left-width:1px }` so only the collapsed expand affordance grows (expanded header buttons stay 20px, keeps 4-button layout).
- `.mini-collapsed-current` (line 119): `gap:7px`→`6px`, add `min-width:0`. Time 25px/17px-long unchanged (lines 145-166).
- `.mini-expanded-header` (257): `padding-left:8px`→`9px` for optical alignment with 6px state dot.
- `.mini-state-dot` expanded-only: `.mini-expanded-content .mini-state-dot { width:7px; height:7px }` (dot 6px stays collapsed). Breath animation untouched (52-63, reduced-motion static halo stays).
- `.mini-task-block` (288): `line-height:19px`→`18px`; marquee keyframes duration `9s`→`11s` and add `will-change:transform` (`.is-marquee`, 311-326). Long-task flow unchanged: `miniDisplayPolicy.ts` single→marquee→scroll; reduced-motion keeps is-scroll (keyboard focusable, tabIndex 0).
- `.mini-expanded-body` grid `1fr 104px` stays; `.mini-metric` (397-421): padding `0 5px`→`0 6px`, label 8px→8.5px, strong 9px→9.5px.
- `.mini-side-console` rows `minmax(0,30px) 18px`→`minmax(0,29px) 18px`; `.mini-primary/secondary-button` height 16px→17px, font 8.5px→9px, dock grid `1.35fr/1fr` stays.
- `.mini-expanded-progress` height 11px→10px; collapsed edge rail 4px unchanged (smoke floor ≥2).
- `.mini-expanded-content` rows `20px minmax(0,1fr)` unchanged (header=20px contract).

**TESTS**
- `npm test` geometry unit tests stay green (layout constants untouched).
- `mini-ui-smoke.cjs`: unchanged assertions must pass — viewport/shell/screenshot 184/256, buttons-inside-content, `bodyScroll[0]===256`, 4-edge dock+release, native WM_ENTERSIZEMOVE/EXITSIZEMOVE, drag-cancels-fold, collapsed font≥25, expanded focusCore width≥130.
- Add (new cases): (a) long-time `H:MM:SS` state asserting `.mini-time-long` (17px) with `timeComplete` true, no overflow, controls inside; note latent gap — current smoke only asserts short time, and 17px-long would trip the ≥25/≥20 floor, so add dedicated long-time assertions before any future floor changes; (b) CDP `Emulation.setEmulatedMedia prefers-reduced-motion` verifying `.is-marquee` animation is `none` and `is-scroll` container is focusable; (c) long task title producing `is-marquee`, marquee animation name asserted.

**RISKS**
- Collapsed button growth to 24px could clip on tight grid — mitigated by `min-width:0` + smoke inside-content check; revert if 184px strip overflows at CJK fonts.
- Metric font bump may overflow the 104px side column at max `formatDuration` strings — smoke `bodyScroll[0]===256` catches.
- Marquee 11s changes only visual pacing; reduced-motion path unaffected.

**ARTIFACTS** none (read-only).

**VERDICT** Approved: polish constrained to the two fixed presets; all controls, drag/snap/auto-collapse and no-third-size preserved. Execute only after reading `IMPLEMENTATION_LOG.md`/`SYNC_TROUBLESHOOTING.md`/`TEST_AND_RELEASE.md` per AGENTS.md gate, bump patch to 0.2.87-eligible, and run full verification suite + three-device install.

