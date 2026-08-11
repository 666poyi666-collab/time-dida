# FocusLink v0.12.86 UI audit DeepSeek swarm

- Run: `20260811T113753Z-m7mhhp`
- Jobs: 5
- Completed: 4
- Failed: 1
- Agent: `plan`; variant: `max`; concurrency: 5

## desktop-main-ui: Audit desktop main workbench UI

- Status: completed
- Session: `ses_00f629458ffe7tlHyV7TKn48Fm`
- Attempts: 1; continuations: 0

Audit complete (read-only). All evidence from `FocusLink/src` v0.12.85 sources; no files changed, no EXEs touched.

## VERDICT

Time Instrument system is coherent: shared 3-segment `.view-console` grammar, meter-rail→monument→ledger focus plane, hairline partition, token-only color. One real layout conflict at the 980×660 minimum, several density/text-floor/dead-hook issues. Proposal is behavior-, wording- and timer-semantics-preserving; no nested cards.

## CHANGES (all `FocusLink/src/styles/linear-workbench.css` + `legacy-support.css` unless noted)

1. **980×660 focus conflict (primary).** Cascade collision: `@media (max-width:1080px)` (L4163) collapses `.focus-instrument` to 1 col with meter-rail as horizontal band, but later `@media (max-height:760px)` (L4267) re-asserts `grid-template-columns:206px 1fr`; at 980 both apply, later wins → monument ≈326px while `.dial-standard` min-width 4.8em@72px≈346px clips its frame. Fix: scope L4267 `.focus-instrument` to `(min-width:1081px) and (max-height:760px)`; add combined `(max-width:1080px) and (max-height:760px)` block keeping the band, ledger `384px→336px`, `.timer-context-title` clamp floor 19→16px.
2. **Ledger width tiers:** under 1100px reduce `.focus-console` ledger 384→336 (keep 440px @1600+, L4139).
3. **Console density:** `.console-identity` gap 14→10 (L210); hide `.focus-seg-no` readout <1100. History console at 980 wraps 3 control groups → taller header eats 660-height space; add `.history-header.view-console` stack rule (identity/readout/actions) at `max-width:1120px` mirroring L4248.
4. **Text-floor (spec §3.3 min 10px auxiliary):** bump `.ribbon-view-switch button` 9.5→10 (L1704), `.pixel-spec` 9→10 (L838), `.history-segment-marker span` 8→10 (L2280), `.stats-time-donut text.caption` 8→10 (L2842), `.ta<redacted>` 9→10 (legacy L783).
5. **Dead hook:** `.window-blurred` (App.tsx:82) has zero CSS rule — add subtle 0.97-opacity/desaturate or remove.
6. **Contrast quieting:** `.stats-time-donut` `drop-shadow(0 10px 24px black/0.12)` (L2797) violates §4.3 heavy-shadow ban → `var(--shadow-sm)`; keep blur (allowed donut glass).
7. **Long text:** most ellipsis/`overflow-wrap:anywhere` already correct (task row L700, ledger L1332/1394, inspector L1809). Add `overflow:hidden` guard + min-width:0 on `.ledger-row-duration`.

## TESTS

Extend `tests/mainWindowLayout.test.ts` (add 1280×720 budget) or add `tests/desktopResponsiveStyleContract.test.ts` mirroring `mobileResponsiveStyleContract.test.ts`: assert the combined 1080×760 block exists and max-height block is ≥1081-scoped; static-scan all styles for auxiliary `font-size <10px`; assert `.window-blurred` is styled. Then `npm run format:check / typecheck / lint / test / build`.

## RISKS

- Breakpoint source-order sensitivity — keep L4163/L4267 adjacent with the fix comment.
- 336px ledger may crowd `.ledger-row-sub` on long titles → verify multi-segment.
- Wrapped history controls vs 46px console min-height at 660 → screenshot gate.
- 10px floor bumps shift pixel/segment/ribbon density slightly — visual diff required.

## ARTIFACTS

Evidence: `linear-workbench.css` L191–233, L364–409, L1296–1456, L1725–1935, L4136–4331; `temporal-foundation.css` L62–204; `legacy-support.css` L356–808; `TimerPanel.tsx` L404–668; `TaskWorkspace.tsx` L300–599; `HistoryPanel.tsx` L833–927; `SettingsPanel.tsx` L1655–1736; `mainWindowLayout.test.ts`; `styleContract.test.ts`; `mobileResponsiveStyleContract.test.ts`.

## Screenshot acceptance

At 1240×800, 980×660, 1280×720: idle/running/paused/resume/finished; 44-ch monument title + long ledger/row titles; 5+ segments; hover/active/focus-visible/disabled on `.btn-solid/.btn-accent/.btn-outline/.btn-danger/.ta<redacted>`; light+dark; no horizontal scrollbar anywhere; standard/counter/vernier dials uncropped; ledger open/closed.

## mini-window-ui: Audit two-state mini window UI

- Status: failed
- Session: `ses_00f60604effetel3Di6Y7QSZkF`
- Attempts: 5; continuations: 3

Error: INCOMPLETE_FINISH: Worker session did not finish cleanly (last step reason: unknown)

## mobile-phone-ui: Audit Xiaomi phone UI

- Status: completed
- Session: `ses_00f5c4590ffexbRImZHMWrqJk8`
- Attempts: 5; continuations: 3

## AUDIT REPORT · Worker 3/5 — Xiaomi phone UI (360×800 / 412×915)

**Evidence read:** AGENTS.md; FRONTEND_SPEC §10 (v0.12.76-77 HIG, viewport, keyboard, a11y contracts); IMPLEMENTATION_LOG v0.12.71–0.12.85; `mobile.css` (6149 lines); `FocusConsole.tsx`, `MobileApp.tsx`, `AppNavigation.tsx`, `TaskBrowser.tsx`, `SettingsView.tsx`, `DashboardView.tsx`, `MobileTemporalRibbon.tsx`, `appearance.ts`, `viewportPolicy.ts`; `mobileResponsiveA11yContract.test.ts`, `mobileResponsiveStyleContract.test.ts`, `mobileViewportPolicy.test.ts`, `mobileAppearance.test.ts`; `mobile/index.html`, `AndroidManifest.xml`, `styles.xml`.

**VERDICT** — Phone layout is sound: focus-first order (`.focus-instrument` flex order in `@media (max-width:619px)`, mobile.css:4164), floating pill nav with solid+`reduced-transparency` fallback (:5203,5237,6125), 44px targets, safe-area topbar/nav/actions/dialog, `overflow-wrap:anywhere` task/active-title text, reduced-motion (:6139). Four concrete defects remain; none touch cloud/local authority, ACK wording, or the Xiaomi system-surface path.

**CHANGES** (v0.12.86/1286, cross-device ⇒ bump all 7 version sources + CHANGELOG + both specs + release notes):
1. **Keyboard** — `mobile/index.html` viewport meta add `interactive-widget=resizes-content`; `AndroidManifest.xml` MainActivity add `android:windowSoftInputMode="adjustResize"`. Today the IME can cover sticky `.focus-actions`/nav while typing the focus title (focus-first needs the action always in thumb reach).
2. **Detail-card/nav overlap** — `.ta<redacted>` base `bottom: calc(64px + env(safe-area-inset-bottom))` (mobile.css:5503) sits 8px behind the pill (top = 8+64=72px). Change to `calc(76px + env(safe-area-inset-bottom))`, matching `.focus-actions`.
3. **Ledger `partial` truncation** — at ≤619 only `.state-error` wraps (mobile.css:4749); extend the wrap rule to `.state-partial` so 待处理 counts are visible at ~124px column.
4. **System theme not live** — `appearance.ts:46` samples prefers-dark once; desktop App.tsx:191 has a listener. Add `installMobileSystemThemeListener` + MobileApp effect to re-apply (and update theme-color meta) when `theme==='system'`.

**TESTS** — Extend `mobileResponsiveStyleContract.test.ts`: detail bottom 76px, `state-partial` wrap, index.html `interactive-widget`, manifest `adjustResize`. Extend `mobileAppearance.test.ts`: fire matchMedia change → `.dark` toggles. Re-run production viewport smoke 360×800 / 412×915 / 640×1024 / 915×412 light+dark+reduced-motion, task expand, focused-input screenshot (no overflow, primary action in viewport). Full gate: format/typecheck/lint/Vitest/build/dist.

**RISKS** — `interactive-widget`/adjustResize varies by WebView; verify on xaga, keep visualViewport fallback. CSS changes may regress 360 overflow; smoke must assert it. Three-device install matrix (Windows/Xiaomi/Huawei) + APK backup is mandatory; missing install invalidates iteration. Theme listener must guard `typeof document/window`, avoid double-apply.

**ARTIFACTS** — `release-v01286/` 4 files from clean-commit dist (installer, portable, SHA256SUMS, RELEASE_NOTES); APK backup; LFS tmp 0; IMPLEMENTATION_LOG + CHANGELOG entries; three-device matrix. Evidence: files/lines cited above (all read-only).

## tablet-huawei-ui: Audit Huawei tablet responsive UI

- Status: completed
- Session: `ses_00f629441ffeP0J3PWNT31UuAm`
- Attempts: 1; continuations: 0

VERDICT: v0.12.85 Huawei UI is sound at the two split thresholds (760 sidebar / 915×412 short-landscape), but 640×1024 portrait violates one spec mandate and the stylesheet carries a half-dead legacy breakpoint layer. Concrete v0.12.86 upgrade below.

CHANGES
- `src/mobile/mobile.css`
  - In `@media (min-width:620px) and (max-width:759px) and (orientation:portrait)` (:5976) mirror the phone pattern (:5945): `.focus-actions{position:sticky;z-index:32;bottom:calc(84px+env(safe-area-inset-bottom,0))}` + `.focus-instrument{padding-bottom:calc(112px+env(safe-area-inset-bottom,0))}`. Today `.focus-actions{position:static}` (Apple base :5716) puts the primary action below the 1024px fold (chrome=208px, instrument≈840px); spec §10:337 requires the bar above bottom nav.
  - Same range: `.ta<redacted>{bottom:calc(84px+env(safe-area-inset-bottom))}` — current sticky bottom 64px (:5500) vs nav pill top ≈82px (:5203) gives an ~8px pill overlap (unverified; runner never measures overlap).
  - Delete dead legacy 620 overrides: `.app-frame` grid (:2938,:4854), `.app-navigation` rail (:2944,:4858), `.focus-console-body` 2-col (:3051,:3858), `.ta<redacted>` 2-col (:2990). Keep still-live: topbar 72px (:4848), sync-strip (:4895), ribbon `clamp(176px,20vw,260px)` (:3841), dashboard sizes (:4937). Note legacy `.app-navigation button` `grid-template-columns:14px 22px` (:4867) leaks into 640 pill buttons (Apple :5255 doesn't reset) — benign now, fragile.
- No TSX change; `viewportPolicy.ts:6` (620 = tablet-feature gate for 平板专注显示, FocusConsole.tsx:79/262) stays, but FRONTEND_SPEC §10 should state 620 gates device features, not layout.
- `src/mobile/FocusConsole.tsx`, `TaskBrowser.tsx`, capsule path (`.focus-system-tools` order 5) untouched.

TESTS
- `tests/mobileResponsiveStyleContract.test.ts`: assert new 620-759 portrait sticky `.focus-actions` + reservation; assert no `position:sticky .app-navigation` under `(min-width:620px)` across the FULL file (today only appleRoot).
- `tests/mobileResponsiveA11yContract.test.ts`: `.ta<redacted>` bottom ≥ nav pill top at 620-759.
- `scripts/regression/mobile-viewport-screenshot.ts`: add `.app-navigation` to `actionOverlaps` for bottom-tab viewports; add `scrollTo(0,400)` pin check (`actions.bottom ≤ nav.top`, `≥ innerHeight-100`) for 640/412; add 任务 overlap check vs nav. Re-run all VIEWPORTS × light/dark.
- Gates: `npm run format:check typecheck lint test build build:web` + runner + Huawei DBY-W09 real 640/760/915×412 captures + three-device install.

RISKS
- Sticky bar over 176px ribbon needs the padding reservation or it hides timeline/facts (mirror phone parity).
- Deleting legacy 620 declarations can drop live topbar/sync styles — keep allowlist, run contracts before/after.
- 640 first-screen screenshot shifts; re-capture, don't loosen assertions.
- Three-device gate mandatory (Windows/Xiaomi/Huawei same 0.12.86); OPPO retired.

ARTIFACTS
- Re-generate `test-data/mobile-viewport-screenshots/tablet-640-portrait-*, tablet-760-portrait-*, phone-landscape-*`.
- Evidence: `mobile.css`, `FocusConsole.tsx`, `TaskBrowser.tsx`, `MobileApp.tsx`, `viewportPolicy.ts`, `tests/mobile{ViewportPolicy,ResponsiveStyleContract,ResponsiveA11yContract}.test.ts`, `scripts/regression/mobile-viewport-screenshot.ts`, `frontend-design/FRONTEND_SPEC.md`.

## design-system-a11y: Audit cross-device design system and QA

- Status: completed
- Session: `ses_00f62948bffeb5p6vozW9fvl5C`
- Attempts: 1; continuations: 0

Audit complete (read-only; no files changed). Evidence gathered from token source, desktop/mobile CSS, icon system, tests, smoke/regression scripts, and release docs.

**Visual direction for v0.12.86** — keep the "时间仪器 Time Instrument" system as-is; no new theme. Tighten the existing discipline: one token ladder, accent-colored focus ring everywhere, glass confined to the 3 desktop floating chips + 4 mobile control layers, hairline + radius-0 panels, and complete missing states (disabled/loading/tooltip).

**VERDICT:** System is consistent and defensible — zero hex literals, radius-0 panels enforced (linear-workbench.css:1739,1912,2036,2720; temporal-mini.css:9), focus-visible global ring, 4.5:1 accent contrast asserted in smoke. But 9 concrete token/state gaps remain that break "唯一 token 来源" and a11y polish. OPPO frozen/out-of-scope.

**CHANGES** (minimal shared-token map):
- Replace `color: white` (linear-workbench.css:68) with `--app-danger-solid-fg`.
- Tokenize dark scrim rgb(0 0 0 / .56) (linear-workbench.css:2562) via `--app-ink`.
- Snap off-ladder radii: stats-ledger-float 12px/14px (2989,3021)→8/6px; legacy 5px/9px (legacy:55,446)→4/6px; toast/overlay 8px (legacy:65,1540)→6px; unify settings-select-menu 3px (win, linear-workbench:2550).
- Pause-red vs danger: `.ledger-sync.tone-danger/.tone-error` uses `--app-pause` (1443–1446) → `--app-danger`.
- Focus ring: stats-ledger-block ring `--app-text` (3082)→accent; stats-day-column `:focus`(3378)→`:focus-visible`; settings-search outline:none (2449)→add ring; keep global ring for mini.
- Add dark overrides for dial-standard/flip/stats-time-block white/black shading (593,691,696,3211).
- Define `@keyframes temporal-sweep` (currently dead, legacy:128) or drop animation.
- Disabled: add bg/text desaturation to `.btn-solid/.btn-accent/.btn-danger` (global 0.46 opacity only).
- Mobile: `.form-field input` font-size 13px→≥16px (mobile.css:961, spec mandates 16px).

**TESTS:**
- Automated: extend styleContract.test.ts (no literal hex/`color:white`, radius ∈ ladder, sweep keyframes exist, focus rings accent, sync-danger uses `--app-danger`); extend mobileResponsiveA11yContract.test.ts (input≥16px, 44px targets); add contrast assert for `--app-muted`≥4.5 and danger button in ui-state-smoke.cjs.
- Screenshot: rerun scripts/regression desktop-ui/settings/mobile-viewport/temporal-ribbon + visual-review.cjs — 4 pages × light/dark + mini collapsed/expanded + mobile 360/412/640/760/landscape. No pixel-diff tooling exists; DOM/computed asserts + PNG capture only — do not claim pixel regression.
- Device gate: bump to 0.12.86 (+versionCode 1286), Windows `/S` + Xiaomi/Huawei `adb install -r` same APK, readback DisplayVersion + versionName/versionCode; OPPO not installed.

**RISKS:** radius/dark-shading changes subtly alter donut/float aesthetics — screenshot diff before commit; 16px inputs reflow at 320px — retest 360×800; version bump forces full 3-device gate; do not claim untouched OPPO.

**ARTIFACTS:** survey tables above; evidence: themeTokens.test.ts, styleContract.test.ts, mobileResponsiveA11yContract.test.ts, ui-state-smoke.cjs:290–1022, mini-ui-smoke.cjs:996–1152, desktopInstrumentRegression.test.ts, TEST_AND_RELEASE.md:215–234.

