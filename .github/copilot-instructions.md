# Local OCR Copilot Instructions

## Commands

- Use Node `>=24 <25` and pnpm `11.9.0`.
- `pnpm build` runs the TypeScript type-check; `pnpm build:nuxt` builds the production Nuxt/Nitro server.
- `pnpm test` runs both Vitest projects and the client/shared-to-server import-boundary check.
- `pnpm test:src` runs `app/**/*.test.ts`; run one test with `pnpm exec vitest run --config vitest.config.ts app/components/Reviewer.test.ts`.
- `pnpm test:server` runs `server/**/*.test.ts`; run one test with `pnpm exec vitest run --config vitest.config.server.ts server/core/commit.test.ts`.
- `pnpm test:e2e` runs Playwright with its own temporary OCR config and Nuxt dev server. Run one test with `pnpm exec playwright test e2e/ocr-review.spec.ts -g "reviews, accepts, and commits a PDF"`.
- `pnpm check:architecture` rejects imports from `app/` or `shared/` into `server/`.

## Architecture

- This is a client-rendered Nuxt 4 application (`ssr: false`) with Nitro API routes. `app/app.vue` wires the inbox and reviewer UI to `useOcrReview`; the composable owns browser-side state and calls `/api/*`.
- `server/api/` should remain thin: it obtains the runtime OCR service and maps HTTP input/output. Put workflow logic in `server/services/ocr-service.ts`; it coordinates configuration, job storage, conversion, OCR adapters, and commits.
- `server/core/` is the domain and filesystem layer: YAML configuration is parsed and validated by Zod, PDF pages are rendered/extracted into draft jobs, job JSON is persisted under `jobStorePath`, and commits produce Markdown plus image assets. `shared/ocr.ts` is the contract shared across client and server; do not import server code into client or shared code.
- PDF jobs use the review pipeline: extract native text and page previews, retain native text when it reaches `nativeTextMinChars`, otherwise run the configured OCR adapter. Every page remains pending until accepted. A partial commit writes explicit pending/failed placeholders and keeps the job reviewable; only full acceptance moves the source into `inbox/processed/`.
- Non-PDF supported documents use `@firecrawl/anydoc` as one whole-document draft (`kind: 'document'`), but reuse the same accept/commit lifecycle.

## Project conventions and constraints

- The product is local-only: do not add cloud calls or permit non-loopback OCR hosts. Host validation is enforced for the Nitro listener and for remote OCR adapters. Configure the listener with `NITRO_HOST` and `NITRO_PORT`; YAML `host` and `port` are deprecated and ignored.
- The OCR YAML config is deliberately strict. Extend the Zod schema and its TypeScript domain types together when adding configuration or an engine. `NUXT_OCRTOOL_CONFIG_PATH` supplies an explicit config file at runtime.
- Add an OCR engine through the full integration path: `EngineName` and config schema, adapter registry, service validation, UI selector, server tests, and any relevant README configuration.
- Treat generated OCR Markdown as untrusted. Preserve the commit sanitisation in `server/core/commit.ts`; committed images must stay local relative paths. PDF figure crops belong to the page rather than the engine so they survive page reruns.
- Use `.js` extensions in server-side relative imports, even though the source files are TypeScript, to match Node ESM output.
- E2E tests create and remove `e2e/.runtime`; use the checked-in `e2e/ocrtool.e2e.yaml` rather than a developer's local configuration.
