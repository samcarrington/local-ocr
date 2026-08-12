# Local OCR App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the MVP local PDF-to-Markdown OCR review app from `docs/obsidian-pdf-ocr-spec.md`.

**Architecture:** Node/TypeScript Express app with UI-independent core pipeline, pluggable OCR adapters, file-backed draft jobs, and a static localhost review UI. Draft jobs rasterize/extract pages, allow per-page rerun/accept, then commit accepted Markdown and placeholders into the configured inbox.

**Tech Stack:** Node 20+, TypeScript, Express, pdfjs-dist, canvas, tesseract.js, yaml, Vitest.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `README.md`
- Create: `ocrtool.config.example.yaml`

**Steps:**
1. Add npm scripts: `dev`, `build`, `start`, `test`.
2. Add runtime deps: `@napi-rs/canvas`, `express`, `pdfjs-dist`, `tesseract.js`, `yaml`, `zod`.
3. Add dev deps: `@types/express`, `@types/node`, `tsx`, `typescript`, `vitest`.
4. Document setup and config.
5. Run `npm install`, then `npm test`.

### Task 2: Domain models and config

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/config.ts`
- Test: `src/core/config.test.ts`

**Steps:**
1. Define `OcrAdapter`, `OcrResult`, `DraftJob`, `DraftPage`, config types.
2. Load `ocrtool.config.yaml` if present, otherwise safe defaults.
3. Validate config with zod.
4. Test default config and YAML overrides.

### Task 3: Job store and commit logic

**Files:**
- Create: `src/core/job-store.ts`
- Create: `src/core/commit.ts`
- Test: `src/core/commit.test.ts`

**Steps:**
1. Implement JSON-backed job save/load/delete.
2. Implement Markdown output with front matter and page sections.
3. Write pending placeholders for unaccepted pages.
4. Move PDF only when all pages are accepted.
5. Test partial and full commit behavior.

### Task 4: OCR adapters

**Files:**
- Create: `src/ocr/adapters.ts`
- Create: `src/ocr/tesseract.ts`
- Create: `src/ocr/deepseek.ts`

**Steps:**
1. Implement adapter registry.
2. Implement Tesseract adapter over `tesseract.js`.
3. Implement DeepSeek availability check and image chat call scaffold.
4. Keep confidence optional.

### Task 5: PDF processing pipeline

**Files:**
- Create: `src/core/pdf.ts`
- Create: `src/core/pipeline.ts`

**Steps:**
1. Load PDF with `pdfjs-dist/legacy/build/pdf.mjs`.
2. Extract native text per page.
3. Render page PNG previews into job folder.
4. OCR pages where native text is below threshold.
5. Create draft job state.

### Task 6: HTTP API

**Files:**
- Create: `src/server.ts`
- Create: `src/api.ts`

**Steps:**
1. Serve static `public/` files.
2. Implement all MVP endpoints from design doc.
3. Restrict binding to localhost by default.
4. Return useful JSON errors.

### Task 7: Review UI

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`

**Steps:**
1. List inbox PDFs.
2. Create/select job.
3. Show page preview and rendered Markdown.
4. Support rerun, accept, commit, discard.
5. Keep UI single-page and low-dependency.

### Task 8: Verification

**Commands:**
- `npm test`
- `npm run build`

**Checks:**
1. Unit tests pass.
2. TypeScript build passes.
3. README explains local-only constraint and v1 limits.
