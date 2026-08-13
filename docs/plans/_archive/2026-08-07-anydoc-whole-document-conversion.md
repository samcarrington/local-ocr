# Anydoc Whole-Document Conversion

**Goal:** Add firecrawl's `anydoc` (native npm package `@firecrawl/anydoc`, not the `-wasm` browser build) as a new whole-document-to-Markdown conversion path, separate from the existing per-page OCR adapter pipeline. Supports docx, pptx, xlsx, odt, ods, odp, rtf, epub, doc, docm, ppt, pptm, ppsx, ppsm, pps, pot, xls, xlsm, xlsb (all anydoc formats except csv), plus an optional manual "Quick convert" action for PDFs that already have a good text layer. Scanned PDFs keep using the existing per-page OCR pipeline, completely unchanged.

**Architecture:** anydoc converts a whole file to Markdown in a single call (no per-page image), so it is NOT implemented as an `OcrAdapter` and is NOT registered in `src/ocr/adapters.ts`. Instead, a new `DraftJob` kind (`'document'`) runs a separate, much simpler pipeline: one file in, one Markdown string out, wrapped in a `DraftJob` with exactly one `DraftPage` so the existing accept/commit/job-store machinery can be reused almost entirely unchanged.

**Tech notes:**

- anydoc's Node API (`toMarkdown(path)`) rejects with a plain `Error` carrying `error.code`, one of: `unsupported` | `malformed` | `encrypted` | `resourceLimit` | `missingPart` | `io`. This is NOT a `ConvertError` class to instanceof-check - map by `.code`.
- `unsupported` on a `.pdf` source specifically means "no extractable text layer" (image-only PDF) - map to a message pointing the user back to "Review pages". `unsupported` on other formats is a generic bad-format message. `io` is an unexpected local filesystem problem, not a user input problem - map to 500, not 4xx.
- anydoc's `toMarkdown()` renders embedded images as alt-text only in v1 of this integration; no extracted image bytes/figures, unlike the PDF pipeline's per-page figure extraction. `toDocument()`'s asset bytes are a possible future enhancement, out of scope here.
- No new `engines:` config key - anydoc is deterministic and always available locally, not a user-selectable adapter like tesseract/deepseek-ocr/glm-ocr/nuextract3-ocr, so it does not go through the `OcrAdapter` registry or config schema.

---

## Task 1: Dependency

**Files:**

- Edit: `package.json`
- Edit: `pnpm-lock.yaml`

**Steps:**

1. Add `@firecrawl/anydoc` (native) as a dependency. Run `pnpm install` to update the lockfile.

## Task 2: Types and job-store backward compatibility

**Files:**

- Edit: `src/core/types.ts`
- Edit: `src/core/job-store.ts`
- Edit: `src/core/job-store.test.ts`

**Steps:**

1. Add `kind: 'pdf-pages' | 'document'` to `DraftJob`.
2. Rename `DraftJob.sourcePdfPath` -> `sourceFilePath`, and rename any other `*Pdf*`-named DraftJob/DraftPage fields found via grep (e.g. `movedSourcePdf`) to generic names, since jobs now cover non-PDF sources.
3. Make `DraftPage.imagePath` optional (`imagePath?: string`) - whole-document jobs have no per-page image.
4. Extend `PageEngineName` to `EngineName | 'native' | 'anydoc'` (a provenance tag only; anydoc is not part of `EngineConfig`/`EngineName`).
5. In `job-store.ts`, add ONE shared `normalizeJob()` helper used by BOTH `loadJob()` and `listJobs()` (both currently parse job JSON independently) that: defaults missing `kind` to `'pdf-pages'` for legacy persisted jobs, and maps an old persisted `sourcePdfPath` field to `sourceFilePath` when the new field is absent. This keeps existing `.ocrtool/jobs/*.json` files loadable without a migration script, in both code paths that read them.
6. Add job-store tests covering legacy JSON (missing `kind`, old `sourcePdfPath` field) loaded via both `loadJob` and `listJobs`.

## Task 3: anydoc conversion wrapper

**Files:**

- Create: `src/convert/anydoc.ts`
- Create: `src/convert/anydoc.test.ts`

**Steps:**

1. Define `ANYDOC_EXTENSIONS`: `.doc .docx .docm .ppt .pps .pot .pptx .pptm .ppsx .ppsm .xls .xlsx .xlsm .xlsb .odt .ods .odp .rtf .epub` (no `.csv`, no `.pdf` - pdf is handled by invoking this converter explicitly from the "Quick convert" UI action, not via the ambient allowlist).
2. Implement `convertDocumentToMarkdown(filePath: string): Promise<{ markdown: string }>` wrapping `toMarkdown()` from `@firecrawl/anydoc`.
3. Define `DocumentConversionError` with an HTTP status and human message, mapped from `error.code` per the Tech Notes above.
4. Tests: allowlist membership, error-code-to-status/message mapping for each code, PDF-specific `unsupported` message, mocked `@firecrawl/anydoc` import.

## Task 4: Whole-document draft job pipeline

**Files:**

- Edit: `src/core/pipeline.ts` (or new `src/core/document-pipeline.ts`)
- Add: matching test file

**Steps:**

1. Implement `createDocumentDraftJob(filePath: string, config: AppConfig): Promise<DraftJob>`.
2. Validate the resolved path stays inside `config.inboxPath`, mirroring the containment check `createDraftJob` already performs for PDFs.
3. Call `convertDocumentToMarkdown`; on success produce a `DraftJob` with `kind: 'document'` and exactly one `DraftPage`: `{ pageNumber: 1, nativeText: '', markdown: <result>, accepted: false, status: 'pending', engine: 'anydoc' }`, no `imagePath`.
4. On `DocumentConversionError`, propagate it for the API layer to turn into the appropriate HTTP status.
5. Tests: happy path, inbox-containment rejection, error propagation for each `DocumentConversionError` case.

## Task 5: API routes

**Files:**

- Edit: `src/api.ts`
- Add: matching test file

**Steps:**

1. Add `GET /api/documents`, mirroring the existing `listInboxPdfs`/`GET /api/pdfs` pattern, filtered by `ANYDOC_EXTENSIONS`.
2. Change `POST /api/jobs` request body from `{ pdf }` to `{ file, mode? }` where `mode` is `'pages' | 'document'`, default `'pages'`. Non-PDF files must use `mode: 'document'` (400 on mismatch); PDF files accept either mode.
3. Fix resume-matching: the existing "resume newest pending job for this source" logic must match on `sourceFilePath` AND `kind` together, not source path alone - otherwise a pending page-review job and a pending quick-convert job for the same PDF would incorrectly resume each other.
4. `POST /api/jobs/:id/pages/:page/rerun`: branch on `job.kind`. For `'document'`, ignore any `engine` field in the request body and instead re-run `convertDocumentToMarkdown` on `job.sourceFilePath`.
5. `GET /api/jobs/:id/pages/:page/preview`: return 404 with a clear message when `page.imagePath` is undefined (document jobs have no preview image).
6. Expose `createDocumentDraftJob` (or the converter) via the existing `ApiDependencies` dependency-injection pattern so routes stay unit-testable the same way existing routes are.
7. Tests: `/api/documents` listing, `POST /api/jobs` with `mode`, resume-matching correctness across kinds, document rerun branch, 404 preview for document pages.

## Task 6: Commit output

**Files:**

- Edit: `src/core/commit.ts`
- Add: matching test file

**Steps:**

1. Skip the per-page figure-copying step for `kind: 'document'` jobs (v1 has no extracted image bytes for these).
2. Change the front-matter key `source_pdf` -> `source_file` (applies to newly committed notes going forward only; do not touch already-committed files). Keep the `ocr_engine` front-matter key as-is; its value becomes `anydoc` for document jobs.
3. Give `kind: 'document'` jobs an extension-qualified output path, `inbox/<stem>.<ext>/<stem>.<ext>.md` (e.g. `inbox/report.docx/report.docx.md`), so they never collide with the existing PDF convention `inbox/<stem>/<stem>.md`. PDF job output paths are unchanged.
4. Reuse existing sanitization, atomic write, unaccepted-page-placeholder, and move-to-`inbox/processed/`-on-full-accept logic unchanged (all still operate correctly with exactly one `DraftPage`).
5. Tests: document-kind commit output path, front matter, no figure copying, move-to-processed.

## Task 7: Review UI

**Files:**

- Edit: `public/index.html`
- Edit: `public/app.js`
- Edit: `public/styles.css`

**Steps:**

1. Add an "Inbox Documents" list panel fed by `GET /api/documents`; each item posts `POST /api/jobs { file, mode: 'document' }`.
2. Add a second "Quick convert (native text)" button next to the existing "Review pages" action for PDF entries, posting the same endpoint with `mode: 'document'` for that filename.
3. In the job detail view, when `job.kind === 'document'`: hide the image preview pane, page navigation, and the OCR-adapter selector dropdown; relabel rerun/accept controls appropriately; verify `styles.css` layout still works with the image pane hidden (adjust grid/flex rules if needed).

## Task 8: Docs

**Files:**

- Edit: `README.md`
- Edit: `ocrtool.config.example.yaml`

**Steps:**

1. Document the new capability: supported formats, the manual PDF routing choice (Review pages vs Quick convert), and the v1 embedded-image limitation.
2. No new config keys to document (anydoc has none), but add a short note in the example config file's comments explaining why (it isn't a config-driven engine).

## Task 9: Verification

**Commands:**

- `npm test`
- `npm run build` (or `npx tsc --noEmit`)

**Checks:**

1. All unit tests pass, including new anydoc/pipeline/commit/api/job-store tests.
2. TypeScript build passes.
3. Manual smoke test after `pnpm install`: convert one real office document (e.g. a `.docx`), run "Quick convert" on one text-based PDF, and confirm the existing scanned-PDF per-page OCR flow is unaffected.
