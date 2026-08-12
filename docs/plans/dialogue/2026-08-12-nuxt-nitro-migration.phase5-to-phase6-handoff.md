# Phase Handoff Notes: Nuxt/Nitro Migration (Phase 5 -> Phase 6)

Date: 2026-08-12

## Completed

- Added framework-neutral OCR service, dependency boundary, and production
  runtime singleton under `server/services/`.
- Added all planned Nitro API route handlers and shared error handling.
- Adopted Nitro's native error envelope; the safe legacy error object remains
  available in `data`, as recorded in the Phase 5 error-boundary decision.
- Preserved the legacy Express API as the Phase 5 behavioural contract source;
  it remains in place until the Phase 8 removal gate.
- Hardened preview reads with canonical containment, no-follow opens, and
  regular-file validation.
- Added service coverage for deterministic inbox listing and symlink escapes.

## Evidence

See
`docs/plans/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase5/phase5-route-parity-evidence.md`.

## Phase 6 guardrails

- Do not remove Express or static assets.
- Move listener ownership to `NITRO_HOST` and `NITRO_PORT`, retaining the
  documented loopback and Host-header restrictions.
- Treat YAML listener keys as deprecated compatibility inputs only; invalid
  YAML must fail at startup.
- The original migration plan's exact legacy error-body parity requirement is
  superseded by the Nitro-native error-boundary decision. Preserve safe error
  status codes and `data.error`; do not restore the Express-only envelope.
- Phase 5 changes are uncommitted. Do not overwrite them or absorb unrelated
  lockfile changes when creating the next checkpoint.

## Next-session verification baseline

- `pnpm test`: 25 legacy-contract and 131 server tests passed.
- `pnpm exec tsc --noEmit` and `pnpm build:nuxt` passed.
- A built Nitro server on `127.0.0.1:14005` returned a native Nitro `404`
  envelope for an unknown job, with the safe error object under `data.error`.
