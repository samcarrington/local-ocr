# Phase 4 After-Action: Server/Domain Migration and Type Split

Date: 2026-08-12

## Objective and outcome

Phase 4 moved the OCR domain into Nitro-aligned server directories without
changing behaviour. The gate passed: the domain modules now live under
`server/`, browser-safe job and OCR DTOs live in `shared/ocr.ts`, and all
existing domain and API-contract tests continue to pass.

## What worked

- Moving each domain directory as a unit preserved its internal relative import
  structure and kept the test suite co-located with its implementation.
- Updating every external consumer in the same change avoided stale
  `src/core`, `src/ocr`, and `src/convert` imports, including the Phase 2
  probe and local model-server scripts.
- The dependency-free `pnpm check:architecture` gate is lightweight and is
  included in `pnpm test`, preventing browser-facing `app/` and `shared/`
  modules from statically importing implementation code under `server/`.

## Design discovery and resolution

The legacy TypeScript configuration assumed all source files were beneath
`src/`. Moving domain modules invalidated that assumption: explicit
type-checking exposed `rootDir` errors and the legacy build entry would no
longer match emitted output. Phase 4 therefore also updates the TypeScript
build root, declares the package as ESM, and points `start` to
`dist/src/server.js`.

This is a deliberate compatibility bridge, not a decision to retain the
Express runtime. The bridge remains necessary until Phase 5 has established
Nitro route parity and Phase 8 removes the legacy stack.

## Validation

| Command | Result |
| --- | --- |
| `pnpm test` | Passed: 16 files, 154 tests, including the architecture check. |
| `pnpm exec tsc --noEmit` | Passed. |
| `pnpm build` | Passed. |
| `pnpm build:nuxt` | Passed; generated a 41.7 MB Nitro node-server output. |

## Follow-up risks

- The legacy Express API remains in `src/api.ts` and `src/server.ts`; it must
  stay as the route-contract reference until Phase 5 proves Nitro parity.
- The architecture check deliberately covers static imports only. Do not
  introduce dynamic paths or aliases from `app/` or `shared/` into `server/`.
- The Phase 2 route test uses mocks at its new `server/` paths. Future
  refactors must update those mocks with the implementation paths.
