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
| Expand API contract tests from `src/server.test.ts`          | owner-backend | done   | Added invalid payload plus positive payload contract assertions in `src/server.test.ts`; vitest target run passed (50/50). See `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase1/phase1-baseline-evidence.md`.                      |
| Add safe markdown subset tests                               | owner-backend | done   | Added safe subset preservation test in `src/core/commit.test.ts` with hardened unsafe-destination assertions; vitest target run passed (50/50). See `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase1/phase1-baseline-evidence.md`. |
| Capture Hallmark desktop/mobile screenshots and measurements | owner-test    | done   | Captured `hallmark-desktop-1440x1024.png` and `hallmark-mobile-375x812.png` with dimensions verified via `sips`. See `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase1/phase1-baseline-evidence.md`.                                |

Exit gate:

- [x] API + UI baseline contracts passing
- [x] Visual baseline artifacts stored

### Phase 2: Nitro runtime viability gate

| Item                                                               | Owner         | Status | Gate evidence                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Minimal Nuxt scaffold with `ssr: false` and active Nitro APIs      | owner-backend | done   | Established `nuxt.config.ts` with `ssr: false` and the `node-server` preset. The temporary Phase 2 probe routes were removed after the Phase 8 real-runtime suite superseded them. See `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase2/phase2-runtime-viability-evidence.md`.            |
| Loopback bind and Host header restrictions enforced                | owner-backend | done   | Added `server/middleware/host-guard.ts`; verified host rejection with `Host: evil.example` returning `403 Host header rejected` from copied runtime. See `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase2/phase2-runtime-viability-evidence.md`.                                        |
| Build copied `.output` outside repo and run                        | owner-release | done   | Built with `pnpm build:nuxt`, copied `.output` to `/tmp/local-ocr-phase2-run`, and ran `node .output/server/index.mjs` with `NITRO_HOST/NITRO_PORT`. See `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase2/phase2-runtime-viability-evidence.md`.                                        |
| Verify copied-output PDF preview, tesseract OCR, anydoc conversion | owner-test    | done   | `POST /api/phase2/probe` returned `200` with preview bytes, page markdown chars, and anydoc markdown chars in copied runtime. See `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase2/phase2-runtime-viability-evidence.md`.                                                               |
| Confirm no fallback to repository `node_modules`                   | owner-test    | done   | Copied-runtime failure reproduced missing `pdf.worker.mjs`; fixed via Nitro `traceInclude` in `nuxt.config.ts`; recopy + rerun passed proving copied output contains needed runtime assets. See `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase2/phase2-runtime-viability-evidence.md`. |

Exit gate:

- [x] Copied-output runtime gate passed
- [x] After-action notes captured in ledger and phase2 artifact file for handoff to phase 3

### Phase 3: Nuxt project establishment

| Item                                                        | Owner         | Status | Gate evidence                                                                                                                                                                                   |
| ----------------------------------------------------------- | ------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create Nuxt app/config files and split test configs         | owner-backend | done   | Added `vitest.config.server.ts` (server project), `vitest.workspace.ts`, updated `vitest.config.ts` with project name. `pnpm test:src` → 152 passed; `pnpm test:server` → 2 passed.             |
| Update `package.json`, lockfile, `.gitignore`, `biome.json` | owner-backend | done   | Added `test:src` / `test:server` scripts; `biome.json` ignores `.nuxt/**`, `.output/**`, `dist/**`; removed redundant `vitest.config.js`. `.gitignore` already covered `.nuxt/` and `.output/`. |
| Verify `pnpm build` and `pnpm start`                        | owner-test    | done   | `pnpm build:nuxt` → build complete (41.7 MB); `node .output/server/index.mjs` → Listening on http://127.0.0.1:14001.                                                                            |

Exit gate:

- [x] Nuxt scaffold builds and starts

### Phase 4: Server/domain migration and type split

| Item                                                                         | Owner         | Status | Gate evidence                                                                                                                                                           |
| ---------------------------------------------------------------------------- | ------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Move `src/core`, `src/ocr`, `src/convert` to `server/`                       | owner-backend | done   | Moved domain modules and updated all Phase 4 consumers. See `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase4/phase4-domain-migration-evidence.md`. |
| Update script imports for local model servers                                | owner-backend | done   | Updated `scripts/serve-nuextract3.ts` and `scripts/serve-glm-ocr.ts`; type-check passed. See Phase 4 evidence.                                                          |
| Split DTOs into `shared/ocr.ts` and internal types in `server/core/types.ts` | owner-backend | done   | Browser-safe DTOs now live in `shared/ocr.ts`; server-only config and adapter types remain internal. See Phase 4 evidence.                                              |
| Add architecture check for forbidden import direction                        | owner-backend | done   | Added `pnpm check:architecture`, run by `pnpm test`; Phase 4 evidence records the passing gate.                                                                         |
| Run domain tests after move                                                  | owner-test    | done   | `pnpm test` passed: 16 files, 154 tests. See Phase 4 evidence.                                                                                                          |

Exit gate:

- [x] Domain migration parity passed
- [x] New phase 4 artifact file created for handoff to phase 5

### Phase 5: Service extraction and route parity

| Item                                                 | Owner         | Status | Gate evidence                                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extract OCR service/dependencies/runtime/api-errors  | owner-backend | done   | Added framework-neutral orchestration in `server/services/ocr-service.ts`, injectable dependencies, once-per-process runtime wiring, and shared API-error normalisation. See Phase 5 evidence.                      |
| Implement Nitro API routes with shared error wrapper | owner-backend | done   | Added PDF, document, job, preview, rerun, acceptance, commit, and deletion routes using `server/utils/nitro-api.ts`. See Phase 5 evidence.                                                                          |
| Preserve exact URL and status-code contracts         | owner-backend | done   | Legacy URLs and status codes are preserved. The native Nitro error envelope, with the safe legacy error object in `data.error`, supersedes Express-only error-body parity; see the Phase 5 error-boundary decision. |
| Validate sanitised 5xx and logging behaviour         | owner-test    | done   | Shared API wrapper sanitises 5xx responses, retains the safe error object in Nitro `data`, and `logUnexpectedApiError` retains server detail. Built-output unknown-job smoke test passed. See Phase 5 evidence.     |
| Validate preview path security checks                | owner-test    | done   | Service tests verify symlink-escape rejection; implementation canonicalises paths and requires `O_NOFOLLOW` plus a regular file. See Phase 5 evidence.                                                              |

Exit gate:

- [x] Route and error contract parity passed
- [x] Phase 5 evidence and Phase 5-to-Phase 6 handoff created

### Phase 6: Runtime configuration migration

| Item                                                      | Owner         | Status | Gate evidence                                                                                                                                                                                                                           |
| --------------------------------------------------------- | ------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Move every retained listener to `NITRO_HOST`/`NITRO_PORT` | owner-backend | done   | Nitro startup validates domain config through `server/plugins/config.server.ts`; package scripts now run Nuxt/Nitro, and preserved Express compatibility code reads the same environment inputs. See Phase 6 evidence.                  |
| Deprecate YAML listener keys for one release              | owner-backend | done   | `loadConfig` removes YAML `host` and `port` before strict validation and emits one process-level compatibility warning. Example config and README now document the environment-only listener boundary. See Phase 6 evidence.            |
| Fail invalid YAML at startup                              | owner-test    | done   | The startup plugin invokes `loadConfig`; copied-output startup with an invalid numeric setting terminated before binding. See Phase 6 evidence.                                                                                         |
| Validate copied-runtime listener behaviour                | owner-test    | done | Copied `.output` started with `NITRO_HOST=127.0.0.1` and `NITRO_PORT=14005`; the temporary Phase 2 health endpoint verified the listener during migration and was retired after Phase 8. See Phase 6 evidence.                                  |
| Stabilise Nuxt development file watching                  | owner-backend | done   | Replaced the broad Nuxt watcher with its builder watcher and a Vite allow-list for `app/`, `server/`, `shared/`, and `src/`; this avoids the 31,561-file `.build-cache` tree without suppressing route discovery. See Phase 6 evidence. |

Exit gate:

- [x] Runtime config migration gate passed
- [x] Phase 6 evidence created for handoff to phase 7

### Phase 7: Frontend Vue port with parity

| Item                                                         | Owner          | Status | Gate evidence                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | -------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Port UI to component/composable structure                    | owner-frontend | done   | Replaced the static DOM controller with the Nuxt app shell, inbox, reviewer, navigation, and safe-markdown components backed by one OCR-review composable. See Phase 7 evidence.                                                                                           |
| Move CSS to Nuxt assets unchanged initially                  | owner-frontend | done   | Migrated the established interface CSS to `app/assets/css/` without visual redesign. See Phase 7 evidence.                                                                                                                                                                 |
| Preserve existing behavior, ARIA, and live regions           | owner-frontend | done   | PDF/document flows, controls, status and progress live regions, page semantics, preview cache busting, and safe markdown rendering are preserved. Adapter reruns now retain the selected engine, and document markdown uses the full reviewer width. See Phase 7 evidence. |
| Run component tests for state transitions/actions/navigation | owner-test     | done   | Focused review-state, safe-markdown, adapter-selection, rerun, and document-layout coverage added; `pnpm test:src` passed with 44 tests and `pnpm test:server` with 131. See Phase 7 evidence.                                                                             |
| Validate desktop/mobile parity and no overflow               | owner-test     | done   | Desktop 1440x1024 and mobile 375x812 comparisons passed with no horizontal overflow; see Phase 7 evidence.                                                                                                                                                                 |

Exit gate:

- [x] Frontend parity gate passed
- [x] Phase 7 evidence and Phase 7-to-Phase 8 handoff created

### Phase 8: End-to-end verification and legacy removal

| Item                                                           | Owner         | Status | Gate evidence                                                                                                                                                                                                          |
| -------------------------------------------------------------- | ------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run Playwright flows for PDF + document modes                  | owner-test    | done | Isolated Playwright flows create local PDF/RTF fixtures, exercise Nuxt and real Nitro routes, and verify committed files in the temporary store. `pnpm test:e2e` passed. See Phase 8 evidence. |
| Validate sanitized failure behavior and overflow constraints   | owner-test    | done   | Playwright verifies the sanitized error message and mobile 375px viewport has no horizontal overflow. See Phase 8 evidence.                                                                                            |
| Remove legacy Express/static files and deps after gate pass    | owner-backend | done | Removed the Express compatibility server, legacy source tree, `express`, `@types/express`, and `package-lock.json`; retained Nuxt support utilities under `server/utils`. |
| Update README, example config, TODO, and superseded plan notes | owner-release | done | README now documents pnpm and Nuxt/Nitro, TODO names the completed migration, and the historical plan is marked superseded. The example config already contains no listener keys. |

Exit gate:

- [x] Full verification matrix passed
- [x] Legacy stack removal approved

## Risk tracking slots

| Risk ID | Trigger signal                   | Current state | Mitigation evidence                                                                                                                                                                                                   |
| ------- | -------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1      | Copied-output runtime failure    | mitigated     | Reproduced and fixed missing `pdf.worker.mjs` via Nitro `traceInclude`; copied-runtime probe passed. See `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase2/phase2-runtime-viability-evidence.md`. |
| R2      | API contract drift               | mitigated     | Phase 5 legacy contract suite, Nitro build, and built-output error-envelope smoke test passed. See Phase 5 evidence.                                                                                                  |
| R3      | UI parity drift                  | open          | TODO                                                                                                                                                                                                                  |
| R4      | Preview path security regression | mitigated     | Canonical containment, no-follow file opening, regular-file validation, and a symlink escape unit test added in Phase 5.                                                                                              |

## Checkpoint board

| Checkpoint | Phase | Status | Evidence                                                                                                                                                |
| ---------- | ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A          | 0     | done   | User confirmation and metadata update                                                                                                                   |
| B          | 2     | done   | Copied-output runtime viability evidence in `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase2/phase2-runtime-viability-evidence.md` |
| C          | 5     | done   | Phase 5 route parity evidence and Phase 5-to-Phase 6 handoff.                                                                                           |
| D          | 7     | done   | Phase 7 desktop/mobile parity evidence in `phase7-vue-port-evidence.md`.                                                                                |
| E          | 8     | done        | Isolated real Nuxt UI-to-Nitro PDF/document flows and legacy removal evidence in `phase8-e2e-and-legacy-removal-evidence.md`.                           |

## Execution notes

- Keep this file as single source of phase status.
- Update status and gate evidence in same commit as implementation work.
