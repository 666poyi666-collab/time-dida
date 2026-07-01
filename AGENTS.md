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

- `src/`: renderer UI only.
- `electron/`: Electron main process, SQLite access, timer manager, dida CLI provider, sync queue.
- `shared/`: shared types, version constants, and pure policies.
- `frontend-design/`: UI handoff documents for design agents.
- `backend/`: backend handoff documents.
- `shared-contract/`: frontend/backend contract notes.
- `release-v*/`: packaged artifacts only.

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

## UI Language Rules

Keep state labels precise:

- Use `已关联` / `未关联` only for local task association.
- Use `已同步` / `未同步` / `同步失败` only for cloud sync queue state.
- Do not use vague labels such as `可同步`.
- If a session has linked segments but no session default task, collapsed history rows must not say `未关联`.
- dida CLI sync should be described as `同步到滴答评论`; if fallback happens, mention task content only in diagnostics.

## Mini Window Rules

- Mini window has two fixed sizes: collapsed and expanded.
- Do not reintroduce freeform resizing unless the settings and layout tests are updated.
- Collapsed mode should show only current focus/pause and cumulative focus/pause.
- Expanded mode may show task title, current segment, cumulative stats, total wall time, and controls.

## Verification Before Release

Run these before packaging:

```bash
npm run typecheck
npm test
npm run build
npm run dist
```

For dida sync changes, also run a real temporary dida task test:

- create a temporary task
- add a FocusLink comment with Chinese text and a marker
- list comments and verify the marker exists once
- repeat the write and verify it is skipped
- delete the temporary task

## Release Rules

- Bump `package.json`, `package-lock.json`, `shared/version.ts`, `electron-builder.yml`, README, changelog, and frontend handoff version together.
- Use release directories like `release-v029` for `0.2.9` and `release-v0210` for `0.2.10`.
- Keep only the latest three release directories in the repo.
- Push `main` and the matching git tag.
- If GitHub Release creation is required, use an authenticated GitHub tool/token; git push alone does not create a Release page entry.
