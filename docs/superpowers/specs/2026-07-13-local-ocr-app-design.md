# Local OCR App Design

## Goal

Build a localhost-only Node/TypeScript web app that converts PDFs from an Obsidian inbox into Markdown notes with per-page OCR review before commit.

## Architecture

- Express serves both JSON API and a static single-page review UI.
- Core conversion logic stays UI-independent under `src/core`, so a later CLI can reuse it.
- OCR engines implement a shared adapter contract under `src/ocr`.
- Draft jobs live under `.ocrtool/jobs/<jobId>/` until committed.

## API

- `GET /api/pdfs` lists PDFs in configured inbox.
- `POST /api/jobs` creates draft job for selected PDF.
- `GET /api/jobs/:id` returns draft state.
- `GET /api/jobs/:id/pages/:page/preview` returns rasterized page PNG.
- `POST /api/jobs/:id/pages/:page/rerun` reruns one page with selected adapter.
- `POST /api/jobs/:id/pages/:page/accept` marks page accepted.
- `POST /api/jobs/:id/commit` writes accepted pages and pending placeholders.
- `DELETE /api/jobs/:id` discards draft job.

## MVP choices

- Stack: Node 20+, TypeScript, Express.
- PDF work: `pdfjs-dist` for text extraction and page rendering; OCR only when native text is below threshold.
- OCR: implement `tesseract.js` first; add DeepSeek-OCR adapter scaffold with availability check.
- UI: plain HTML/CSS/JS served by Express.
- Commit: write `inbox/<name>/<name>.md`; move source PDF to `inbox/processed/` only after every page is accepted.

## Deferred

- CLI client.
- Document-wide compare UI.
- Embedded image extraction from born-digital PDFs beyond page preview output.
- GLM-OCR adapter.
