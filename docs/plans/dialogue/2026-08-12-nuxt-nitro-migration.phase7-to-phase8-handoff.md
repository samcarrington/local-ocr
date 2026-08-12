# Phase Handoff Notes: Nuxt/Nitro Migration (Phase 7 -> Phase 8)

Date: 2026-08-12

## Completed

- Replaced the static HTML and imperative DOM controller with declarative Nuxt
  components and a single OCR-review composable.
- Preserved PDF and document review flows, safe markdown rendering, status and
  progress live regions, page navigation semantics, preview cache busting, and
  error handling.
- Moved the established visual styles into Nuxt assets without a redesign.
- Fixed PDF reruns to post the reactive, per-page adapter selection instead of
  falling back to Tesseract.
- Fixed document conversion mode so Markdown uses the full reviewer panel.
- Stabilised Nuxt development watching through the builder watcher and Vite
  source-tree allow-list.

## Evidence

See
`docs/plans/dialogue/artifacts/2026-08-12-nuxt-nitro-migration/phase7/phase7-vue-port-evidence.md`.

- Desktop comparison passed at 1440x1024; mobile comparison passed at
  375x812, with no horizontal overflow.
- `pnpm test:src` passed: 44 tests.
- `pnpm test:server` passed: 131 tests.
- `pnpm exec nuxt build` and `git diff --check` passed.

## Phase 8 guardrails

- Do not remove Express, static assets, or legacy dependencies until the
  Phase 8 end-to-end verification matrix passes.
- Preserve the Phase 5 decision: Nitro native error envelopes govern failed
  API responses, retaining the safe legacy error object in `data.error`.
- Preserve Phase 6 listener ownership: all retained listener entry points use
  `NITRO_HOST` and `NITRO_PORT`; YAML `host` and `port` stay compatibility-only
  inputs for the current release.
- Verify PDF and document flows through the Nuxt UI before removing the legacy
  implementation.
- Treat `docs/plans/dialogue/2026-08-12-nuxt-migration-snags.md` as the
  record for any new migration defects.
- Phase 5 through Phase 7 changes remain uncommitted. Do not overwrite or
  absorb unrelated changes while preparing the cleanup checkpoint.

## Next-session verification baseline

- Nuxt development server starts without `EMFILE` watcher failures and serves
  the Phase 2 health route on the configured loopback listener.
- The Nuxt UI supports PDF page review, selected-engine reruns, document
  conversion/reconversion, acceptance, commit, and draft discard flows.
- Phase 7 visual parity holds at the established desktop and mobile viewports.
