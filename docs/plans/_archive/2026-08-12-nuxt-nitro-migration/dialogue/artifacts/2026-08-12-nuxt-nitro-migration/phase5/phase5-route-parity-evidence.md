# Phase 5 Route Parity Evidence

Date: 2026-08-12

## Delivered artefacts

- `server/services/ocr-service.ts`: framework-neutral OCR orchestration,
  validation, job lifecycle operations, and hardened preview reads.
- `server/services/ocr-dependencies.ts` and `server/services/ocr-runtime.ts`:
  injectable dependencies and once-per-process production wiring.
- `server/utils/api-errors.ts` and `server/utils/nitro-api.ts`: shared API
  error normalisation, sanitised unexpected failures, and server-side logging.
- Nitro routes for PDFs, documents, jobs, previews, reruns, acceptance,
  commits, and deletion.

## Contract and security evidence

- `pnpm test:server`: 14 files and 131 tests passed, including service tests
  for stable inbox listings and rejection of preview symlinks escaping the
  canonical job preview directory.
- `pnpm test:src`: 3 files and 25 legacy API contract tests passed.
- `pnpm check:architecture`: passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build:nuxt`: passed; Nitro emitted every Phase 5 route.
- Built-output smoke test returned a Nitro `404` response from
  `GET /api/jobs/not-found`, with the safe legacy error object retained in
  `data.error`.

The native Nitro error-envelope decision is recorded in
`docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/2026-08-12-nuxt-nitro-migration.phase5-error-boundary-decision.md`
and supersedes legacy error-body parity.

Preview resolution canonicalises both the expected preview directory and target
path, rejects targets outside that directory, opens with `O_NOFOLLOW`, and
requires a regular file before returning its bytes.
