# Implementation Ledger: Nuxt/Nitro Migration

## Ledger rules

- Status values: `not-started` | `in-progress` | `blocked` | `done`.
- Gate evidence must link to concrete artifact: test output, screenshot set, PR diff, or commit hash.
- No phase can be marked `done` without all gate evidence fields completed.

## Owners

- `owner-backend`: Sam Carrington
- `owner-frontend`: Sam Carrington
- `owner-test`: Sam Carrington
- `owner-release`: Sam Carrington

## Phase ledger

### Phase 0: Plan anchor confirmation

| Item                                         | Owner         | Status | Gate evidence                                                 |
| -------------------------------------------- | ------------- | ------ | ------------------------------------------------------------- |
| Objectives confirmed against scope statement | owner-release | done   | User confirmation in dialogue: "confirmed - implement ledger" |
| Success criteria confirmed for execution     | owner-release | done   | Same confirmation and updated metadata                        |
| Scope deltas reviewed                        | owner-release | done   | No scope delta requested                                      |

Exit gate:

- [x] Phase 0 complete

### Phase 1: Baseline capture and regression lock

| Item                                                         | Owner         | Status | Gate evidence                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expand API contract tests from `src/server.test.ts`          | owner-backend | done   | Added invalid payload plus positive payload contract assertions in `src/server.test.ts`; vitest target run passed (50/50). See `docs/plans/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase1/phase1-baseline-evidence.md`.                      |
| Add safe markdown subset tests                               | owner-backend | done   | Added safe subset preservation test in `src/core/commit.test.ts` with hardened unsafe-destination assertions; vitest target run passed (50/50). See `docs/plans/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase1/phase1-baseline-evidence.md`. |
| Capture Hallmark desktop/mobile screenshots and measurements | owner-test    | done   | Captured `hallmark-desktop-1440x1024.png` and `hallmark-mobile-375x812.png` with dimensions verified via `sips`. See `docs/plans/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase1/phase1-baseline-evidence.md`.                                |

Exit gate:

- [x] API + UI baseline contracts passing
- [x] Visual baseline artifacts stored

### Phase 2: Nitro runtime viability gate

| Item                                                               | Owner         | Status      | Gate evidence |
| ------------------------------------------------------------------ | ------------- | ----------- | ------------- |
| Minimal Nuxt scaffold with `ssr: false` and active Nitro APIs      | owner-backend | not-started | TODO          |
| Loopback bind and Host header restrictions enforced                | owner-backend | not-started | TODO          |
| Build copied `.output` outside repo and run                        | owner-release | not-started | TODO          |
| Verify copied-output PDF preview, tesseract OCR, anydoc conversion | owner-test    | not-started | TODO          |
| Confirm no fallback to repository `node_modules`                   | owner-test    | not-started | TODO          |

Exit gate:

- [ ] Copied-output runtime gate passed

### Phase 3: Nuxt project establishment

| Item                                                        | Owner         | Status      | Gate evidence |
| ----------------------------------------------------------- | ------------- | ----------- | ------------- |
| Create Nuxt app/config files and split test configs         | owner-backend | not-started | TODO          |
| Update `package.json`, lockfile, `.gitignore`, `biome.json` | owner-backend | not-started | TODO          |
| Verify `pnpm build` and `pnpm start`                        | owner-test    | not-started | TODO          |

Exit gate:

- [ ] Nuxt scaffold builds and starts

### Phase 4: Server/domain migration and type split

| Item                                                                         | Owner         | Status      | Gate evidence |
| ---------------------------------------------------------------------------- | ------------- | ----------- | ------------- |
| Move `src/core`, `src/ocr`, `src/convert` to `server/`                       | owner-backend | not-started | TODO          |
| Update script imports for local model servers                                | owner-backend | not-started | TODO          |
| Split DTOs into `shared/ocr.ts` and internal types in `server/core/types.ts` | owner-backend | not-started | TODO          |
| Add architecture check for forbidden import direction                        | owner-backend | not-started | TODO          |
| Run domain tests after move                                                  | owner-test    | not-started | TODO          |

Exit gate:

- [ ] Domain migration parity passed

### Phase 5: Service extraction and route parity

| Item                                                 | Owner         | Status      | Gate evidence |
| ---------------------------------------------------- | ------------- | ----------- | ------------- |
| Extract OCR service/dependencies/runtime/api-errors  | owner-backend | not-started | TODO          |
| Implement Nitro API routes with shared error wrapper | owner-backend | not-started | TODO          |
| Preserve exact URL/status/body contracts             | owner-backend | not-started | TODO          |
| Validate sanitized 5xx and logging behavior          | owner-test    | not-started | TODO          |
| Validate preview path security checks                | owner-test    | not-started | TODO          |

Exit gate:

- [ ] Route and error contract parity passed

### Phase 6: Runtime configuration migration

| Item                                                    | Owner         | Status      | Gate evidence |
| ------------------------------------------------------- | ------------- | ----------- | ------------- |
| Listener ownership moved to `NITRO_HOST`/`NITRO_PORT`   | owner-backend | not-started | TODO          |
| Deprecated YAML keys tolerated with one warning release | owner-backend | not-started | TODO          |
| Invalid YAML fails at startup                           | owner-test    | not-started | TODO          |

Exit gate:

- [ ] Runtime config migration gate passed

### Phase 7: Frontend Vue port with parity

| Item                                                         | Owner          | Status      | Gate evidence |
| ------------------------------------------------------------ | -------------- | ----------- | ------------- |
| Port UI to component/composable structure                    | owner-frontend | not-started | TODO          |
| Move CSS to Nuxt assets unchanged initially                  | owner-frontend | not-started | TODO          |
| Preserve existing behavior, ARIA, and live regions           | owner-frontend | not-started | TODO          |
| Run component tests for state transitions/actions/navigation | owner-test     | not-started | TODO          |
| Validate desktop/mobile parity and no overflow               | owner-test     | not-started | TODO          |

Exit gate:

- [ ] Frontend parity gate passed

### Phase 8: End-to-end verification and legacy removal

| Item                                                           | Owner         | Status      | Gate evidence |
| -------------------------------------------------------------- | ------------- | ----------- | ------------- |
| Run Playwright flows for PDF + document modes                  | owner-test    | not-started | TODO          |
| Validate sanitized failure behavior and overflow constraints   | owner-test    | not-started | TODO          |
| Remove legacy Express/static files and deps after gate pass    | owner-backend | not-started | TODO          |
| Update README, example config, TODO, and superseded plan notes | owner-release | not-started | TODO          |

Exit gate:

- [ ] Full verification matrix passed
- [ ] Legacy stack removal approved

## Risk tracking slots

| Risk ID | Trigger signal                   | Current state | Mitigation evidence |
| ------- | -------------------------------- | ------------- | ------------------- |
| R1      | Copied-output runtime failure    | open          | TODO                |
| R2      | API contract drift               | open          | TODO                |
| R3      | UI parity drift                  | open          | TODO                |
| R4      | Preview path security regression | open          | TODO                |

## Checkpoint board

| Checkpoint | Phase | Status      | Evidence                              |
| ---------- | ----- | ----------- | ------------------------------------- |
| A          | 0     | done        | User confirmation and metadata update |
| B          | 2     | not-started | TODO                                  |
| C          | 5     | not-started | TODO                                  |
| D          | 7     | not-started | TODO                                  |
| E          | 8     | not-started | TODO                                  |

## Execution notes

- Keep this file as single source of phase status.
- Update status and gate evidence in same commit as implementation work.
