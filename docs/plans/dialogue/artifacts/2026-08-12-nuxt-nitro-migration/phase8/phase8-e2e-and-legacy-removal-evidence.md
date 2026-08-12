# Phase 8 End-to-End Verification and Legacy Removal Evidence

Date: 2026-08-12

## Governing decision

The browser suite creates deterministic PDF and RTF fixtures in an ignored
temporary inbox. It exercises the Nuxt UI and real Nitro routes without
requiring local OCR engines or user inbox files.

The suite always starts a fresh Nuxt server explicitly bound to its configured
loopback port. Reusing an existing server was rejected because an incorrectly
forwarded CLI argument could otherwise make the suite exercise stale output.

The previous mocked-flow acceptance decision is superseded. Completion requires
isolated runs through the real Nuxt UI, real Nitro routes, and PDF/document
processing dependencies.

## Runtime configuration decision

The OCR config-file override is supplied through Nuxt runtime config as
`NUXT_OCRTOOL_CONFIG_PATH`, which the Nitro plugin and OCR service resolve
consistently. A direct process environment lookup was rejected because it did
not reliably reach the bundled Nitro runtime and allowed the verification
server to read the user inbox instead of its isolated fixture store.

## Delivered artefacts

- Added Playwright configuration and Chromium review-flow coverage.
- Corrected the Playwright Nuxt startup command and confirmed the ported
  `app/app.vue` is served rather than Nuxt's welcome screen.
- Moved retained Nuxt watcher and Phase 2 probe/host helpers from `src/` to
  `server/utils/`.
- Removed the Express compatibility server and tests, Express dependencies,
  and npm lockfile.
- Updated the README, TODO, implementation ledger, and historical migration
  plan status.

## Verification matrix

- PDF flow: create review, select an engine, rerun, accept both pages, and
  commit.
- Document flow: create document job, reconvert, accept, and discard.
- Failure and layout: render the sanitised `Internal server error` response
  and confirm no horizontal overflow at `375x812`.

`pnpm test:e2e` passed: 2 isolated real-runtime Playwright tests.

- The PDF flow creates a text-layer PDF, reviews and accepts its page, commits
  through Nitro, and verifies both the processed PDF and generated Markdown.
- The document flow converts and accepts an RTF, commits through Nitro, and
  verifies both the processed RTF and generated Markdown.

## Supporting regression gates

- `pnpm test:src` passed: 6 tests.
- `pnpm test:server` passed: 148 tests.
- `pnpm check:architecture` passed.
- `pnpm build:nuxt` passed.
