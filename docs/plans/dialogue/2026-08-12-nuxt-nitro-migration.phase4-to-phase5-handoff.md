# Phase Handoff Notes: Nuxt/Nitro Migration (Phase 4 -> Phase 5)

Date: 2026-08-12
Scope: handoff after Phase 4 completion, before Phase 5 start.

## Snapshot

- Branch: `feature/move-to-fe-framework`
- Latest commit: `87a358e docs: phase 3 to phase 4 handoff`
- Working tree: dirty with the uncommitted Phase 4 implementation and
  documentation. `pnpm-lock.yaml` was already modified before Phase 4 and
  should be reviewed separately rather than overwritten.
- Current gate position: Phase 4 done; Phase 5 not started.

## What Phase 4 completed

- Moved `src/core/`, `src/ocr/`, and `src/convert/` to
  `server/core/`, `server/ocr/`, and `server/convert/`, retaining their tests.
- Created `shared/ocr.ts` for browser-safe OCR and job DTOs.
- Kept configuration, adapter, and filesystem types in
  `server/core/types.ts`; it re-exports shared DTO types for existing
  server-side consumers.
- Updated the legacy Express API, compatibility server, Phase 2 probe route,
  Phase 2 mocks, and local GLM-OCR/NuExtract3 scripts for the new paths.
- Added `pnpm check:architecture`, which rejects static imports from `app/` or
  `shared/` into `server/`; `pnpm test` runs this gate.
- Updated the legacy TypeScript compiler root and start entry so the
  compatibility server still type-checks and builds during the staged
  migration.

## Evidence index

- Ledger:
  `docs/plans/dialogue/2026-08-12-nuxt-nitro-migration.implementation-ledger.md`
- Gate evidence:
  `docs/plans/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase4/phase4-domain-migration-evidence.md`
- After-action:
  `docs/plans/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase4/phase4-after-action.md`
- Prior handoff:
  `docs/plans/dialogue/2026-08-12-nuxt-nitro-migration.phase3-to-phase4-handoff.md`

## Validation baseline at handoff

- `pnpm test`: 16 files, 154 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed.
- `pnpm build:nuxt`: passed, producing a 41.7 MB Nitro node-server output.

## Phase 5 guardrails

- Treat `src/api.ts` and `src/server.test.ts` as the behavioural contract
  source while extracting framework-neutral services. Do not remove Express or
  static assets in this phase.
- Write service and route contract tests before replacing an endpoint.
- Preserve every endpoint's URL, method, status, and JSON body exactly.
- Keep unexpected-error responses sanitised as
  `{ "error": "Internal server error" }`, while retaining server-side logging.
- Preserve preview-file containment checks; Phase 5 must strengthen them to
  canonical `realpath`, regular-file, and no-follow checks as specified by the
  migration plan.
- Keep the Phase 2 probe operational and update its mocks if an extracted
  dependency changes path.

## Phase 5 start checklist

1. Commit the intentional Phase 4 changes as a checkpoint; do not absorb the
   pre-existing `pnpm-lock.yaml` modification without review.
2. Confirm all Phase 5 ledger rows remain `not-started`.
3. Read `src/api.ts` alongside `src/server.test.ts` and classify each API
   responsibility into service, runtime dependency, or Nitro error utility.
4. Add tests for the first extracted service behaviour before moving it.
5. Add a shared Nitro route/error wrapper, then migrate one endpoint at a time.
6. Re-run the complete contract suite after each route family.
7. Record Phase 5 evidence and write the Phase 5 handoff artefact before
   marking the gate complete.

## Definition of done for Phase 5

- Framework-neutral OCR service, dependencies, runtime wiring, and error
  utility exist under `server/`.
- All planned Nitro API routes preserve the Express contract.
- Sanitised 5xx and preview-path security tests pass.
- Phase 5 ledger rows and evidence artefacts are complete.
