# Phase Handoff Notes: Nuxt/Nitro Migration (Phase 3 -> Phase 4)

Date: 2026-08-12
Scope: handoff after Phase 3 completion, before Phase 4 start.

## Snapshot

- Branch: feature/move-to-fe-framework
- Latest commit: 5d040f2 feat: implement phase 3 of nuxt migration
- Working tree status at handoff: clean
- Current gate position: Phase 3 done, Phase 4 not started

## What was completed in Phase 3

- Added `vitest.config.server.ts` covering `server/**/*.test.ts` with project name `server`.
- Added `vitest.workspace.ts` referencing both src and server configs.
- Updated `vitest.config.ts` with project name `src`.
- Removed redundant `vitest.config.js` (was a JS duplicate of the TS config).
- Added `test:src` and `test:server` scripts to `package.json`; `test` runs both sequentially.
- Updated `biome.json` with `files.ignore` covering `.nuxt/**`, `.output/**`, `dist/**`.
- Verified `pnpm build:nuxt` → 41.7 MB output, clean build.
- Verified `pnpm start:nuxt` → listening on `http://127.0.0.1:14001`.

## Evidence index

- Ledger: docs/plans/dialogue/2026-08-12-nuxt-nitro-migration.implementation-ledger.md
- Phase 3 rows: all three items marked done with commit hash `5d040f2`.
- Prior handoff (Phase 2 → 3): docs/plans/dialogue/2026-08-12-nuxt-nitro-migration.phase2-to-phase3-handoff.md

## Test baseline at handoff

- `pnpm test:src`: 15 test files, 152 tests passed
- `pnpm test:server`: 1 test file, 2 tests passed
- Combined (`pnpm test`): 154 tests passed, 0 failed

## After-action notes

- Workspace auto-discovery (`vitest run` with `vitest.workspace.ts` present) did not activate in vitest 4.1.10; `test` script runs both configs explicitly via `&&` chain instead.
- `biome.json` previously had no `files.ignore` block; now ignores all three Nuxt/build output dirs to prevent linter noise on generated files.
- `vitest.config.js` was a leftover JS duplicate created during initial project setup; removal had no impact on test runs.
- No `.gitignore` changes were needed; `.nuxt/` and `.output/` were already covered.

## Risks to watch entering Phase 4

- R2 API contract drift risk active: moving `src/core`, `src/ocr`, `src/convert` to `server/` will break relative import paths in both source and test files.
- Import resolution for tests after move must use the new `server/` paths; `vitest.config.server.ts` include pattern already covers `server/**/*.test.ts`.
- The `src/phase2/` utilities (`host-guard-utils.ts`, `probe-utils.ts`) are referenced by `server/` routes via `../../src/phase2/...`; these paths will need updating if Phase 4 moves those files too — check scope before assuming a move.
- `scripts/` files import from `src/`; update those imports in the same commit as the move.
- The architecture check task requires a decision on tooling (eslint-plugin-import, a custom Nitro module, or a simpler script) — confirm before building.

## Phase 4 start checklist

1. Confirm Phase 4 rows are still `not-started` in ledger.
2. Read `src/core/types.ts` to identify which types become shared DTOs vs stay internal.
3. Move `src/core`, `src/ocr`, `src/convert` to `server/core`, `server/ocr`, `server/convert`.
4. Create `shared/` directory with shared DTO types extracted from `types.ts`.
5. Update all internal imports (source files + test files + scripts).
6. Update `scripts/serve-nuextract3.ts` and `scripts/serve-glm-ocr.ts` import paths.
7. Decide and implement architecture import-direction check.
8. Run `pnpm test:src` and `pnpm test:server` — both must pass with zero regressions.
9. Run `pnpm build:nuxt` to verify Nitro still resolves moved modules.
10. Record evidence in ledger Phase 4 rows in the same commit.

## Suggested first commands for Phase 4 session

```
pnpm install
pnpm test
pnpm build:nuxt
```

Then read `src/core/types.ts` and `src/api.ts` to plan the DTO split before moving files.

## Definition of done for Phase 4

- All `src/core`, `src/ocr`, `src/convert` files live under `server/`.
- `shared/` contains only types safe to import from both `app/` and `server/`.
- No import of `server/` from `app/` or `shared/`.
- `pnpm test` passes (154+ tests, 0 failed).
- `pnpm build:nuxt` clean.
- Phase 4 ledger rows marked done with commit evidence.
