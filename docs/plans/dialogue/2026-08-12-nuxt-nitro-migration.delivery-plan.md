# Delivery Plan: Nuxt/Nitro Migration

## Plan summary

- Delivery model: phase-gated migration with contract lock before code movement.
- Thread topic: Nuxt/Nitro migration dialogue implementation.
- Execution mode: dialogue-led, verify-after-each-gate.
- Implementation ledger: `docs/plans/dialogue/2026-08-12-nuxt-nitro-migration.implementation-ledger.md`

## Work breakdown

### Phase 0: Plan anchor confirmation

- Goal: confirm objectives and success criteria with user before implementation.
- Inputs: migration plan and dialogue scope statement.
- Exit criteria:
  - Objectives and success criteria explicitly confirmed.
  - Any scope deltas captured.
- Artefacts:
  - Confirmed anchor note in dialogue metadata.

### Phase 1: Baseline capture and regression lock

- Goal: encode current behavior as test and visual contracts.
- Tasks:
  - Expand `src/server.test.ts` contract coverage.
  - Add safe markdown subset tests.
  - Capture Hallmark desktop/mobile screenshots and measurements.
- Exit criteria:
  - API and UI baseline tests pass.
  - Visual references stored for parity checks.

### Phase 2: Nitro runtime viability gate

- Goal: prove Nuxt/Nitro can run required workloads in copied output.
- Tasks:
  - Scaffold minimal Nuxt with `ssr: false` and active Nitro APIs.
  - Enforce loopback binding and Host header checks.
  - Build and run from copied `.output` outside repo.
  - Execute preview generation, local Tesseract OCR, and anydoc conversion from copied output.
- Exit criteria:
  - No fallback to repository `node_modules`.
  - OCR and preview paths work in copied runtime.

### Phase 3: Nuxt project establishment

- Goal: establish project structure, config, and tooling.
- Tasks:
  - Add Nuxt app shell, config, Vitest split, Playwright config.
  - Update package scripts and lockfiles for pnpm-only runtime.
- Exit criteria:
  - `pnpm build` and `pnpm start` green in scaffolded state.

### Phase 4: Server/domain migration and type split

- Goal: move server code to Nitro-aligned directories without behavior change.
- Tasks:
  - Move `src/core`, `src/ocr`, `src/convert` to `server/`.
  - Split shared DTOs into `shared/ocr.ts`.
  - Add architecture rule blocking imports from `app/` or `shared/` into `server/`.
- Exit criteria:
  - Domain tests pass after move.
  - Import graph constraints enforced.

### Phase 5: Service extraction and route parity

- Goal: isolate OCR orchestration and map stable contracts to Nitro routes.
- Tasks:
  - Extract service and runtime dependency layers.
  - Implement Nitro route handlers with shared error wrapper.
  - Preserve exact endpoint behavior and JSON error envelope.
  - Enforce preview file containment and file safety checks.
- Exit criteria:
  - Route integration tests pass against exact contract suite.
  - Sanitized 5xx behavior preserved.

### Phase 6: Runtime configuration migration

- Goal: transition listener config to Nitro env with compatibility bridge.
- Tasks:
  - Move host/port ownership to `NITRO_HOST` and `NITRO_PORT`.
  - Deprecate YAML host/port keys with one warning release behavior.
  - Fail invalid YAML at startup.
- Exit criteria:
  - Startup behavior validated for valid and invalid config cases.

### Phase 7: Frontend Vue port with parity

- Goal: port UI to Vue without product behavior regressions.
- Tasks:
  - Implement component/composable structure.
  - Migrate CSS to Nuxt assets unchanged initially.
  - Preserve review/document flows and ARIA/live region semantics.
- Exit criteria:
  - Component tests pass for states, actions, and navigation.
  - Visual parity checks pass desktop/mobile.

### Phase 8: End-to-end verification and legacy removal

- Goal: prove parity then remove legacy stack.
- Tasks:
  - Execute Playwright flows for PDF and document modes.
  - Verify no overflow and sanitized failure behavior.
  - Remove Express/static files and legacy dependencies after pass.
  - Update docs and mark older plans as superseded.
- Exit criteria:
  - Full verification matrix passes.
  - Legacy architecture removed with no contract regressions.

## Dependency and ordering rules

- Phase 2 must pass before Phase 4 code movement.
- Phase 5 route work requires Phase 4 type and module stability.
- Phase 8 cleanup is blocked until all parity checks are green.

## Risk register

- R1 High: Copied Nitro output misses runtime assets or externalized modules.
  - Mitigation: force early copied-output gate in Phase 2.
- R2 High: API contract drift during route migration.
  - Mitigation: contract tests from Phase 1 as non-negotiable gate.
- R3 Medium: UI parity drift in Vue port.
  - Mitigation: visual baseline and component parity assertions.
- R4 Medium: Security regression in preview path serving.
  - Mitigation: explicit containment and regular-file checks with tests.

## Governance checkpoints

- Checkpoint A: anchor confirmation complete.
- Checkpoint B: runtime viability proven in copied output.
- Checkpoint C: route and error contract parity complete.
- Checkpoint D: frontend parity complete.
- Checkpoint E: legacy removal approved only after full verification pass.

## Next concern

Kick off Phase 1 baseline capture and attach first gate evidence links in the implementation ledger.
