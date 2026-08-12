# Phase 7 Vue Port Evidence

Date: 2026-08-12

## Governing decision

The UI is ported to declarative Vue components backed by a single OCR-review
composable. The legacy static UI remains the behavioural and semantic reference,
and its CSS is migrated unchanged into Nuxt assets before visual refinement.

This keeps review/document flow parity and ARIA/live-region semantics traceable.
A UI redesign or a wrapper around the legacy DOM script was rejected because
either would obscure regressions.

## Delivered artefacts

- Replaced the static HTML and imperative controller with the Nuxt app shell,
  inbox, reviewer, navigation, and safe-markdown components.
- Added the OCR-review composable for inbox loading, PDF/document draft flows,
  page navigation, adapter selection, reruns, acceptance, commits, discards,
  errors, and status updates.
- Migrated the established CSS into `app/assets/css/` without visual redesign.
- Added focused review-state and safe-markdown tests, and migrated the
  adapter-selector coverage.

## Validation

- `pnpm test` passed: 173 tests.
- `pnpm exec nuxt build` passed.
- `git diff --check` passed.

## Remaining exit-gate evidence

- Desktop parity passed at 1440x1024; the rendered page height was 1133px,
  matching the Phase 1 baseline.
- Mobile parity passed at 375x812; the rendered page height was 1695px versus
  the 1699px baseline. Document and body widths matched both viewport widths,
  confirming no horizontal overflow.
- The current inbox contained one RTF document absent from the baseline; shell,
  responsive layout, controls, and empty-review state otherwise matched.
- The adapter-rerun regression was fixed by retaining selected engines
  reactively per page and posting `{ "engine": selectedEngine }` for PDF
  reruns; document reconversion remains bodyless.
- The document-width regression was fixed with a single-column reviewer layout
  in document mode, allowing Markdown to use the full main-panel width.
- `pnpm test:src` passed: 44 tests; `pnpm test:server` passed: 131 tests;
  `pnpm exec nuxt build` and `git diff --check` passed.
