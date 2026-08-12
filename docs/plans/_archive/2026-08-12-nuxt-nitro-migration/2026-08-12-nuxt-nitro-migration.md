# Nuxt/Nitro Migration Plan

> **Superseded implementation plan:** Phase 8 completed on 2026-08-12. This
> document remains as the historical migration record; the implementation
> ledger and phase evidence record the delivered outcome.

## Goal

Replace Express plus static frontend with one full-stack Nuxt 4 application:

```text
app/       Vue frontend
server/    Nitro API and OCR domain
shared/    API DTOs only
```

Nuxt/Nitro becomes sole development and production server. Python remains external only for optional local OCR model servers.

Future phase plans may include local dockerisation of LLMs and other services, but this migration is focused on the Nuxt/Nitro transition.

## Objectives and success criteria

### Objectives

- Deliver one Nuxt 4 plus Nitro runtime that replaces Express and static HTML/JS serving.
- Preserve current OCR and conversion behavior and API contracts during migration.
- Preserve current UI behavior, ARIA semantics, and Hallmark desktop/mobile parity while moving to Vue.
- Complete migration with testable security controls for bind host and Host header restrictions.

### Success criteria

- `pnpm build` and `pnpm start` run Nuxt/Nitro only, serving frontend and API from `.output/server/index.mjs` on `127.0.0.1:4312`.
- Existing API endpoints retain path, method, successful response payload, and
  status-code contracts. Failed Nitro responses use the native envelope with
  safe legacy error detail in `data.error`, including malformed-request
  handling and sanitised 5xx behaviour.
- OCR, preview generation, rerun, accept, partial/full commit, and document conversion work through Nitro routes with no functional regression.
- Vue frontend preserves existing user-visible states and interactions, including mobile/desktop layout parity and no horizontal overflow.
- Express and static legacy assets are removed only after all parity and verification checks pass.

## Dialogue execution package

- Scope statement: `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/2026-08-12-nuxt-nitro-migration.scope-statement.md`
- Delivery plan: `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/2026-08-12-nuxt-nitro-migration.delivery-plan.md`
- Execution metadata: `docs/plans/_archive/2026-08-12-nuxt-nitro-migration/dialogue/2026-08-12-nuxt-nitro-migration.dialogue-meta.yaml`

## 1. Capture existing behavior

Before migration:

- Convert `src/server.test.ts` into explicit API contract coverage:
  - paths and methods
  - status codes
  - JSON bodies
  - malformed requests
  - sanitized 5xx responses and server logging
  - binary preview content type
  - resume and partial-commit semantics
- Add tests for current safe Markdown subset.
- Capture desktop/mobile Hallmark screenshots and layout measurements.
- Preserve current text, classes, ARIA, and state transitions.

## 2. Prove Nitro compatibility early

Create minimal Nuxt scaffold and verify before moving code:

- `ssr: false`, with Nitro APIs still active.
- Development and production bind to `127.0.0.1:4312`.
- Reject non-loopback bind hosts.
- Reject hostile `Host` headers to mitigate DNS rebinding.
- Build and copy `.output` outside repository.
- From copied output, run:
  - PDF preview generation with PDF.js fonts.
  - Real local Tesseract OCR with traineddata.
  - Anydoc conversion.
- Confirm no fallback to repository `node_modules`.

Resolve Nitro externalization or asset tracing before proceeding.

## 3. Establish Nuxt project

Create:

- `nuxt.config.ts`
- `app/app.vue`
- `app/pages/index.vue`
- Nuxt-aware `tsconfig.json`
- Backend and Nuxt Vitest configurations
- `playwright.config.ts`

Update:

- `package.json`
- `pnpm-lock.yaml`
- `.gitignore`
- `biome.json`

Use pnpm exclusively. Remove `package-lock.json` after migration passes.

Production:

```bash
pnpm build
pnpm start
```

`start` runs:

```bash
node .output/server/index.mjs
```

## 4. Move server modules

Mechanical moves, preserving tests:

```text
src/core/*       -> server/core/*
src/ocr/*        -> server/ocr/*
src/convert/*    -> server/convert/*
```

Update imports in:

- `scripts/serve-glm-ocr.ts`
- `scripts/serve-nuextract3.ts`

Split types:

- `shared/ocr.ts`: browser-safe request/response DTOs.
- `server/core/types.ts`: config, adapters, filesystem and internal types.

Add architecture check preventing `app/` or `shared/` from importing `server/`.

## 5. Extract framework-neutral service

Extract orchestration from `src/api.ts` into:

```text
server/services/ocr-service.ts
server/services/ocr-dependencies.ts
server/services/ocr-runtime.ts
server/utils/api-errors.ts
```

Responsibilities:

- Inbox listing.
- Job creation and resume.
- Rerun and acceptance.
- Partial/full commit.
- Draft deletion.
- Preview resolution.
- Input validation.

Service and adapter registry are initialized once per process. Handler factories accept injected dependencies for tests; production contains no test-mode switch.

## 6. Implement Nitro routes

<workflow priority="mandatory">
Write tests first to match the API contracts
</workflow>

Create:

```text
server/api/pdfs.get.ts
server/api/documents.get.ts
server/api/jobs/index.post.ts
server/api/jobs/[id].get.ts
server/api/jobs/[id].delete.ts
server/api/jobs/[id]/commit.post.ts
server/api/jobs/[id]/pages/[page]/preview.get.ts
server/api/jobs/[id]/pages/[page]/rerun.post.ts
server/api/jobs/[id]/pages/[page]/accept.post.ts
```

Preserve existing URLs, successful payloads, and status codes. Failed routes
use the Nitro-native envelope with safe legacy error detail in `data.error`.

Use one shared route/error wrapper that raises Nitro errors with the established
status code and safe message; the safe legacy error detail remains in
`data.error`.

```json
{
  "statusCode": 400,
  "statusMessage": "message",
  "data": { "error": "message" }
}
```

Unexpected errors log details server-side and expose only a sanitised message
in both `statusMessage` and `data.error`.

```json
{
  "statusCode": 500,
  "statusMessage": "Internal server error",
  "data": { "error": "Internal server error" }
}
```

Preview serving must use canonical `realpath` containment, regular-file checks, and no-follow opening beneath expected job preview directory.

## 7. Migrate runtime configuration

- `NITRO_HOST` and `NITRO_PORT` own listener configuration.
- Defaults: `127.0.0.1:4312`.
- YAML remains OCR/domain configuration.
- Remove `host` and `port` from example YAML.
- For one release, accept old YAML keys, ignore them, and emit one deprecation warning.
- Invalid YAML fails at startup, not on first request.
- Allow only loopback Host headers, including valid port forms.

## 8. Port frontend to Vue

Suggested structure:

```text
app/components/
  AppHeader.vue
  InboxSidebar.vue
  ReviewWorkspace.vue
  ReviewToolbar.vue
  PreviewPanel.vue
  MarkdownPanel.vue
  QualityWarning.vue
  PageNavigation.vue
  AppFooter.vue

app/composables/
  useOcrApi.ts
  useOcrWorkbench.ts

app/utils/
  markdown.ts
  workbench.ts
```

Move CSS unchanged initially:

```text
public/tokens.css     -> app/assets/css/tokens.css
public/workbench.css  -> app/assets/css/workbench.css
```

Do not migrate unused `public/styles.css`. It is a legacy artefact.

Preserve:

- PDF review and quick conversion.
- Whole-document mode.
- Per-page engine selection.
- Preview cache busting.
- First-unaccepted-page selection.
- Rerun, accept, partial/full commit, discard.
- Loading and disabled states.
- Warnings and live status regions.
- Existing safe Markdown subset.

Render Markdown through typed Vue nodes; never use `v-html`.

## 9. Verification

### Unit and service

- Domain tests after file moves.
- OCR service transitions.
- API validation and error normalization.
- Markdown parser.
- Preview path security.
- Host-header and listener restrictions.

### Nuxt integration

Test real Nitro routing and exact contracts, including malformed JSON and binary previews.

### Component

Cover:

- Inbox actions and empty states.
- PDF versus document modes.
- Adapter selection.
- Navigation and ARIA.
- Warning and Markdown rendering.
- Commit/discard enablement.

### Playwright

Use isolated temporary inbox/job stores and deterministic test-only dependency wiring:

- PDF review.
- Resume.
- Rerun.
- Accept and page advance.
- Partial and full commit.
- Discard.
- Document conversion.
- Sanitized failure.
- Desktop/mobile visual parity.
- No horizontal overflow.

## 10. Remove legacy architecture

Only after parity passes, delete:

- `src/`
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `public/tokens.css`
- `public/workbench.css`
- `vitest.config.js`

Remove:

- `express`
- `@types/express`
- Express scripts
- npm lockfile

Update README, example config, TODO, and mark historical Express plans as superseded rather than rewriting them.
