# FocusLink Project Rules

This file is for AI agents and maintainers working in this repository.

## Product Boundary

FocusLink is a desktop productivity tool:

- focus timer
- focus session / segment ledger
- dida / TickTick task association
- local-first sync queue

Do not turn it into a chat app, generic dashboard, or landing page.

## Directory Ownership

- `FocusLink/src/`: renderer UI only.
- `FocusLink/electron/`: Electron main process, SQLite access, timer manager, dida CLI provider, sync queue.
- `FocusLink/shared/`: shared types, version constants, and pure policies.
- `FocusLink/frontend-design/`: the only product/UI/interaction documentation tree; begin at `FocusLink/frontend-design/README.md`.
- `FocusLink/backend-design/`: the only architecture/IPC/data/test/release documentation tree; begin at `FocusLink/backend-design/README.md`.
- `FocusLink/`: the only source workspace. Build, test, design, and development commands run from here.
- `.github/`: issue forms, the canonical GitHub Release notes template, and the formal release workflow only.
- `release-v*/`: packaged release artifacts and that version's `RELEASE_NOTES.md` only.

Do not recreate `docs/`, `backend/`, `shared-contract/`, design archives, one-off fix reports, or parallel handoff documents. Reusable conclusions belong in one of the two specifications; version history belongs in root `CHANGELOG.md` and the matching release notes.

Do not add parallel source trees for the same feature.

## Dida Sync Rules

The dida CLI path has sharp edges. Preserve these rules:

- For dida CLI, write FocusLink sync records to task comments first.
- Fall back to task content only if comments fail.
- Checklist items are not normal tasks. Resolve the parent task and operate on the parent where dida requires it.
- Completing a checklist item means updating the parent task `items` array and setting the target item status to `2`.
- Use `execFile` / argument arrays for dida write operations. Do not build shell command strings for Chinese text, newlines, or JSON.
- Every synced segment must carry a stable marker like `[FocusLink:segment:<id>]`.
- Before writing, read existing comments/content and skip records whose marker already exists.
- Treat dida output `undefined` as failure, not success.

## TomaToDo Sync Rules

- Verify the TomaToDo CDP target by its title and required `electronAPI` methods before any read or write.
- User-triggered upload may launch a stopped standard TomaToDo installation with an argument array, loopback-only debugging, and port `0`; background retries must never launch an external app.
- If TomaToDo is already running without a verified bridge, return `restart-required`. Never terminate or silently restart the user's process.
- `cloudSyncUploadRecord` success means `上传已确认`; it is not independent cloud readback.
- The current client has no PCRecord remote-delete API. Keep cleanup labeled `local-record-only` and never claim remote cleanup was verified.

## UI Language Rules

Keep state labels precise:

- Use `已关联` / `未关联` only for local task association.
- Use `已同步` / `未同步` / `同步失败` only for cloud sync queue state.
- Do not use vague labels such as `可同步`.
- If a session has linked segments but no session default task, collapsed history rows must not say `未关联`.
- dida CLI sync should be described as `同步到滴答清单`; if fallback happens, mention task content only in diagnostics.

## Mini Window Rules

- Mini window has two fixed sizes: collapsed and expanded.
- `FocusLink/shared/miniWindowLayout.ts` is the only executable numeric size source. Do not duplicate sizes in Electron, CSS, settings, or tests; documentation may mirror current acceptance values but must change in the same patch as the constants.
- Do not reintroduce freeform resizing or a third size.
- Collapsed mode is a compact edge progress bar showing only progress/state, current time, and the expand affordance.
- Expanded mode is a dense control console showing the task, current time, cumulative focus/pause/total, and all current controls without nested cards.
- After a native drag is released near a display work-area edge, snap first and then auto-collapse. Never steal the pointer during drag.
- Expand toward the inside of the current display and clamp to its work area; cover multi-display and DPI behavior in layout tests and smoke tests.

## Verification Before Release

Run these from `FocusLink/` before packaging:

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run dist
```

For dida sync changes, also run a real temporary dida task test:

- create a temporary task
- add a FocusLink comment with Chinese text and a marker
- list comments and verify the marker exists once
- repeat the write and verify it is skipped
- verify normal-task complete/uncomplete, and checklist parent-item mutation when those paths changed
- delete the temporary task

## Release Rules

- Follow `FocusLink/backend-design/TEST_AND_RELEASE.md`; its gates are mandatory.
- Bump `FocusLink/package.json`, `FocusLink/package-lock.json`, `FocusLink/shared/version.ts`, `FocusLink/electron-builder.yml`, root README, root CHANGELOG, both design-spec versions, and release notes together.
- Use release directories like `release-v029` for `0.2.9` and `release-v0210` for `0.2.10`.
- Keep only the latest three release directories in the repo.
- Each release directory may contain only the installer, portable executable, `SHA256SUMS.txt`, and `RELEASE_NOTES.md`; remove `win-unpacked`, debug YAML, blockmaps, logs, screenshots, and test results.
- Generate the final artifacts from a clean commit, then verify installer/portable startup and recompute SHA256.
- Copy the completed `.github/RELEASE_NOTES_TEMPLATE.md` to the matching release directory and keep it consistent with the top CHANGELOG entry.
- Push `main` and the matching annotated tag, then create a GitHub Release with the same notes and attach both executables plus SHA256.
- Git push or tag push alone is never a completed release. Read back the GitHub Release and verify its tag, target commit, body, asset names, sizes, and download links.
- If authenticated GitHub Release creation fails, report the release as blocked; do not claim it is published.
