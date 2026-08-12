# Phase 4 Domain Migration Evidence

Date: 2026-08-12

## Completed migration

- Moved `src/core/`, `src/ocr/`, and `src/convert/` to `server/`.
- Extracted browser-safe OCR and job DTOs to `shared/ocr.ts`.
- Retained configuration, adapter, and filesystem implementation types in
  `server/core/types.ts`.
- Updated legacy API, Phase 2 probe route, tests, and local model-server
  scripts to use the new module locations.
- Added `pnpm check:architecture`, a dependency-free static-import check that
  rejects `app/` and `shared/` imports into `server/`.
- Updated the legacy TypeScript build root and start entry point so the
  compatibility server continues to compile from its new module locations.

## Gate commands and results

| Command | Result |
| --- | --- |
| `pnpm test` | Passed: 16 test files, 154 tests; includes architecture check. |
| `pnpm exec tsc --noEmit` | Passed. |
| `pnpm build` | Passed: legacy compatibility server compiled. |
| `pnpm build:nuxt` | Passed: Nitro node-server output built (41.7 MB). |

## Import-boundary decision

The architecture check uses a dependency-free Node script rather than adding
ESLint/import tooling. This preserves the existing toolchain while enforcing
the Phase 4 rule that browser-facing `app/` and `shared/` code cannot depend on
server implementation modules.
