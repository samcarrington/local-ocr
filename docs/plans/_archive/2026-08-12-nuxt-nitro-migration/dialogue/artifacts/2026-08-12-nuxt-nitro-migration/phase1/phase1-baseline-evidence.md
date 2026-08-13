# Phase 1 Baseline Evidence

Date: 2026-08-12

## Contract test evidence

- Command: `vitest` (targeted files via tool)
- Result: 50 passed, 0 failed
- Files:
  - `src/server.test.ts`
  - `src/core/commit.test.ts`

## Visual baseline evidence (Hallmark)

- Runtime: `pnpm dev` at `http://127.0.0.1:4312/`
- Desktop screenshot:
  - File: `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase1/hallmark-desktop-1440x1024.png`
  - Requested viewport: 1440x1024
  - Captured full-page image: 1440x1133
- Mobile screenshot:
  - File: `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase1/hallmark-mobile-375x812.png`
  - Requested viewport: 375x812
  - Captured full-page image: 375x1699

## Notes

- UI baseline taken against current Express runtime before Nuxt/Nitro migration.
- Screenshot dimensions verified with `sips`.
- Test count includes additional positive payload validation and hardened safe-markdown subset assertions from review follow-up.
