# Phase Handoff Notes: Nuxt/Nitro Migration (Phase 2 -> Phase 3)

Date: 2026-08-12
Scope: handoff after Phase 2 completion, before Phase 3 start.

## Snapshot

- Branch: feature/move-to-fe-framework
- Latest commit: 8b0f093 feat: implement phase 1 of the nuxt plan
- Working tree status at handoff: dirty (Phase 2 files staged in working tree, not committed yet)
- Current gate position: Phase 2 done, Phase 3 not started

## What was completed in Phase 2

- Added minimal Nuxt scaffold with `ssr: false` and Nitro `node-server` preset.
- Added Phase 2 Nitro endpoints:
  - `GET /api/phase2/health`
  - `POST /api/phase2/probe`
- Added host-header guard middleware for loopback-only enforcement.
- Proved copied-output runtime execution from outside repository tree.
- Reproduced copied-output failure (`pdf.worker.mjs` missing), fixed via Nitro `traceInclude`, revalidated success.
- Added Phase 2 helper modules and tests:
  - `src/phase2/host-guard-utils.ts`
  - `src/phase2/probe-utils.ts`
  - associated tests and route contract tests.

## Evidence index

- Ledger: docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/2026-08-12-nuxt-nitro-migration.implementation-ledger.md
- Phase 2 runtime evidence: docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase2/phase2-runtime-viability-evidence.md
- Prior handoff (Phase 1 -> 2): docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/2026-08-12-nuxt-nitro-migration.phase-handoff.md

## Validation baseline at handoff

- Full test suite: 152 passed, 0 failed
- Copied runtime endpoint checks in `/tmp/local-ocr-phase2-run`:
  - health endpoint returns `200`
  - host guard rejects foreign host with `403`
  - probe endpoint returns `200` and confirms preview/OCR/anydoc path

## After-action notes

- Localhost guard and probe helper logic now isolated in tested modules to reduce migration risk for later phases.
- Probe endpoint now sanitizes unexpected errors to avoid path leakage.
- Probe operations wrapped in explicit timeout guards.
- Temporary fallback probe document now uses unique temp filename and cleanup, avoids inbox pollution and collision risk.
- Nitro trace includes for pdf worker were required for copied-output viability.

## Risks to watch entering Phase 3

- R2 API contract drift risk remains open during Nuxt project establishment and later route migration.
- R3 UI parity risk untouched until frontend port phase.
- Phase 2 changes currently uncommitted; accidental drift risk if Phase 3 starts without checkpoint commit.

## Phase 3 start checklist

1. Commit Phase 2 working-tree changes as a checkpoint.
2. Confirm Phase 3 rows are still `not-started` in ledger.
3. Establish Nuxt project shell structure for planned split.
4. Update `package.json` scripts and lockfile consistency for Nuxt-first flows.
5. Reconcile `.gitignore` and `biome.json` for Nuxt output/cache paths.
6. Validate `pnpm build` and `pnpm start` against Nuxt runtime path.
7. Capture Phase 3 evidence artifact and update ledger rows in same commit.

## Suggested first commands for Phase 3 session

- pnpm install
- pnpm test
- pnpm build:nuxt
- pnpm start:nuxt

## Definition of done for Phase 3

- Phase 3 rows marked done with concrete evidence links.
- Nuxt scaffold build/start gate validated and documented.
- No regression to Phase 2 copied-output viability.
