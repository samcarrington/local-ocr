# Product Spec: Local PDF-to-Markdown OCR Pipeline for Obsidian Inbox

## Executive Summary

A local web app that converts PDFs sitting in an Obsidian inbox folder into markdown notes with embedded images, using entirely local OCR/document-understanding models — no cloud calls, no exposed vault data. The core conversion logic is a local service/library, not tied to any one interface; the web app is the v1 client because reviewing OCR output (confidence, layout, re-running a page with a different engine) needs visual comparison that a terminal can't give you. A CLI comes later as a second, thinner client over the same service, for batch/unattended runs once the review workflow is trusted. Engine logic is isolated behind a pluggable adapter interface so the underlying OCR model can be swapped, or re-run per page, without touching the rest of the pipeline. On success, the source PDF moves to a `processed/` subfolder; the vault only ever sees markdown + images.

Decisions locked in for v1: manual trigger (no daemon/watcher), web app first (CLI is v2), pluggable OCR interface with per-page re-run before commit, source PDF relocated to `processed/` after conversion, partial commit allowed (accept-and-write per page, no all-or-nothing gate), plain local server (no Electron/bundling overhead).

---

## 1. Objective

Turn `inbox/*.pdf` into `inbox/<name>/<name>.md` (or similar) with embedded images and readable text, fully offline, so PDFs stop being dead weight in the vault and become searchable/linkable notes.

## 2. Non-goals (v1)

- No auto-watching or background daemon — trigger is manual, whether from the web app or (later) the CLI.
- No cloud OCR/LLM calls, ever — this is the hard constraint, not a preference.
- No attempt to auto-summarize or restructure content beyond faithful transcription — that's a separate downstream step if you want it later.
- No CLI in v1 — it's designed for (thin client over the same service), but not built until the web review workflow is validated.
- No multi-user/remote access — this is a localhost-only app for one person, one vault.

## 3. Architecture: service + client split

To support "web now, CLI later" without rebuilding conversion logic twice, the core pipeline lives in a local service, not in the UI:

```
┌─────────────────────────────┐
│  Conversion Service (local)  │   <- pipeline, adapters, file I/O
│  localhost:PORT, HTTP/JSON   │
└───────────┬─────────────────┘
            │
   ┌────────┴────────┐
   │                 │
[Web App]        [CLI]  (v2)
review UI      batch runs
```

The web app and the future CLI both talk to the same service over a small local HTTP API (`POST /convert`, `GET /page/:id/preview`, `POST /page/:id/rerun`, `POST /job/:id/commit`). Nothing about the pipeline or adapters changes based on which client is driving it — only the review step is web-specific.

## 4. Pipeline (draft → review → commit)

Unlike a fire-and-forget CLI run, the web app needs a **staging state**: pages are converted to a draft, reviewed, optionally re-run per page, and only written into the vault (and the source PDF moved) on explicit commit.

```
[SCAN:@INBOX|filt=*.pdf] => [CLASSIFY:@PDF|mch=text-layer?]
   => [EXTRACT:@PDF|mode=native]   (born-digital pages: pdf.js text + image extraction)
   => [EXTRACT:@PDF|mode=ocr]      (scanned/image pages: rasterize => OCR adapter)
=> [DRAFT:@JOB|status=pending_review]
=> [REVW:@JOB|per_page: rerun with different adapter?] (loop until accepted)
=> [WRIT:@MD|dst=inbox/<name>/<name>.md] => [MOVE:@PDF|dst=inbox/processed/] => [Ω]
```

Step by step:

1. **Input selection** — user opens the web app, picks a PDF from the inbox (or a batch later, via CLI).
2. **Page-type classification** — for each page, check whether the PDF already has a native text layer (via pdf.js). Born-digital pages skip OCR entirely for text extraction; OCR only runs where there's no text layer (scans, image-only pages). Skipping OCR where it's not needed is a real speed and quality win, not just an optimization.
3. **Native path** (pdf.js): extract text directly, extract embedded raster images to files.
4. **OCR path**: rasterize page to PNG, run through the active OCR adapter, get back markdown-ish text + optional figure crops + a confidence signal (see §6).
5. **Draft, not commit**: results are held as a draft job, not yet written to the vault. This is what makes review possible.
6. **Review loop**: for each page, the web app shows the rendered source image next to the extracted markdown. If a page looks wrong (garbled table, scrambled columns, low confidence), the user re-runs just that page with a different adapter from the dropdown, without re-processing the whole document. Repeat until each page is accepted.
7. **Commit (partial allowed)**: pages can be committed as soon as they're individually accepted — you don't need to accept all pages of a document before writing anything. A page still pending review is written as a placeholder (e.g. `[[OCR PENDING: page 12]]`) so the markdown file is always in a valid, readable state. The source PDF only moves to `inbox/processed/` once every page in the document is accepted — while any page is still pending, the PDF stays in the inbox as the source of truth for the outstanding page(s).

## 5. OCR Engine Adapter Interface

This is the part worth designing properly rather than hardcoding one tool, since you explicitly want to swap engines later.

```
interface OcrAdapter {
  name: string
  isAvailable(): Promise<boolean>        // e.g. checks Ollama is running, model pulled
  processPage(imagePath: string, opts?: { mode?: "markdown" | "plain" | "layout" }): Promise<{
    markdown: string
    confidence?: number                  // 0-1 if the engine exposes one; undefined if not
    figures?: { bbox: [number,number,number,number], imagePath: string }[]
  }>
}
```

Not every engine will natively expose a confidence score — DeepSeek-OCR and GLM-OCR don't return a calibrated number out of the box. Where the engine doesn't provide one, treat `confidence` as absent and lean on the review UI's side-by-side view rather than inventing a fake score. This is worth testing against real output before deciding whether it's worth engineering a proxy signal (e.g. flagging pages with unusually short/garbled output).

Config picks the adapter:

```yaml
# ocrtool.config.yaml
defaultEngine: deepseek-ocr   # deepseek-ocr | glm-ocr | tesseract
inboxPath: ./inbox            # relative paths resolve from server cwd
jobStorePath: ./.ocrtool/jobs
host: 127.0.0.1
port: 4312
nativeTextMinChars: 24
engines:
  deepseek-ocr:
    kind: deepseek-ocr
    ollamaHost: http://localhost:11434
    model: deepseek-ocr
  glm-ocr:
    kind: glm-ocr
    mode: selfhosted     # or mlx
    apiHost: localhost
    apiPort: 8080
  tesseract:
    kind: tesseract
    lang: eng
```

Candidate adapters, mapped to the interface:

| Adapter | Notes for implementation |
|---|---|
| **deepseek-ocr** | Thin wrapper over Ollama's `/api/chat` with the image + a prompt like `<\|grounding\|>Convert the document to markdown.` Simplest adapter to write first — single HTTP call, no server management beyond `ollama serve`. |
| **glm-ocr** | Two sub-modes worth keeping separate in config: self-hosted (vLLM/SGLang server) or MLX (via mlx-vlm on Apple Silicon). Heavier install (layout-detection dependency), but strongest layout/table fidelity if quality becomes the bottleneck. |
| **tesseract.js** | Lowest-friction fallback, weakest on tables/complex layout. Good as the "always works, no model download" baseline adapter to validate the interface itself before wiring up model-based engines. |

Suggestion: build `tesseract.js` as the first adapter purely to prove out the interface cheaply (it's a few lines, no model pull, no server), then build `deepseek-ocr` as the real v1 default, then add `glm-ocr` once you want to compare quality. That gives you a working pluggable seam after the first adapter instead of after the third.

## 6. Review UI requirements

The locked-in requirement is per-page re-run with a different engine before commit. The minimum UI to make that decision meaningfully requires seeing what you're deciding on — so this section spells out the smallest view that supports the re-run requirement, without adding review features beyond what was asked.

Per page, the web app shows:

- The rasterized source page image.
- The current extracted markdown for that page (rendered, not raw).
- Confidence indicator, when the active adapter provides one (see §5); otherwise no indicator rather than a misleading placeholder.
- An adapter picker + "Re-run this page" action, scoped to that page only — not a full-document re-run.
- Accept / keep-as-is action, advancing the page to "accepted" state.

Job-level:
- Progress indicator (N of M pages accepted).
- Commit action, available as soon as at least one page is accepted — writes accepted pages now, leaves pending pages as placeholders, and re-opens the same job later for the rest (see §4 step 7).
- Cancel/discard action — drops the draft, source PDF stays untouched in the inbox.

This is deliberately a single-page-at-a-time review flow, not a document-wide diff/compare tool — that's more UI than the stated requirement needs for v1, and can be added later if single-page review proves too slow for long documents.

## 7. Output conventions

- One folder per source PDF: `inbox/<name>/<name>.md` + `inbox/<name>/images/*.png`.
- Markdown front matter recording provenance (source filename, engine used, conversion date) — useful later if you ever want to re-run with a better engine and diff results:

```yaml
---
source_pdf: paper.pdf
ocr_engine: deepseek-ocr
converted: 2026-07-13
---
```

- Image links relative, so the note is portable within the vault.

## 8. Open design questions to flag (not decisions I'm making for you)

- **Native-text vs OCR classification threshold**: what counts as "enough" native text layer to skip OCR for a page? A page with one stray text box but a scanned body should still go through OCR. Worth a small experiment against a handful of your real PDFs rather than guessing a heuristic.
- **Failure handling**: if OCR partially fails on one page of a 40-page PDF, do you want a partial markdown file with a `[[OCR FAILED: page 12]]` marker, or a hard stop? Affects whether the PDF gets moved to `processed/` at all.
- **Multi-column / academic paper layout**: GLM-OCR's layout-detection step exists specifically for this; tesseract.js and a naive DeepSeek-OCR prompt may scramble column order. Worth testing against whatever your inbox actually contains (papers vs. articles vs. slides) before committing to a default engine.

One assumption made in resolving partial commit (flagging it explicitly rather than burying it): the source PDF stays in `inbox/` — not moved to `processed/` — until *every* page in that document is accepted, since a partially-committed doc still needs the PDF as the source for its pending pages. If you'd rather have it move on first commit regardless, that's a one-line change in §4 step 7.

## 9. MVP scope

1. Local conversion service (HTTP API: convert, preview, rerun-page, commit) — plain server (FastAPI/Flask, or a Node equivalent), no Electron or bundling layer.
2. Web app: single-page-at-a-time review UI per §6, plain HTML/JS frontend served by the same local server.
3. Adapters: tesseract.js (interface proof) → deepseek-ocr (real default).
4. pdf.js for native text/image extraction + page rasterization.
5. Config file for engine selection / defaults.
6. Partial commit support: write accepted pages, placeholder pending ones, move PDF only when the document is fully accepted.
7. CLI: deferred to v2, once the service API is stable enough to be a second client.

## 10. Suggested next step

A small, low-risk experiment before writing the full pipeline: pick 3-5 representative PDFs from your actual inbox (mix of scanned scan / born-digital / paper-with-figures) and run them through the DeepSeek-OCR Ollama CLI manually, by hand, to see real output quality before any code is written. That validates the "OCR path" quality assumption cheaply and tells us whether GLM-OCR's layout step is actually needed for your content or is over-engineering for v1.
