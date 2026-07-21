# Local OCR

Localhost-only PDF-to-Markdown OCR review app for Obsidian inbox workflows.

## Status

- PDF draft pipeline implemented.
- Local HTTP API implemented.
- Review UI served from `public/`.

## Constraints

- No cloud calls.
- Localhost bind by default.
- v1 has no CLI, watcher, or multi-user access.

## Setup

1. Copy config:

   ```bash
   cp ocrtool.config.example.yaml ocrtool.config.yaml
   ```

2. Edit paths if needed.
   - `engines.tesseract.trainedDataPath` must point at local Tesseract `*.traineddata` files.
   - `engines.deepseek-ocr.ollamaHost` must stay local (`localhost`, `127.0.0.1`, or `::1`).
   - `engines.nuextract3-ocr.serverHost` must stay local (`localhost`, `127.0.0.1`, or `::1`).
3. Install deps:

   ```bash
   npm install
   ```

4. Start server:

   ```bash
   npm run dev
   ```

5. Open `http://127.0.0.1:4312`.

## Config

Example:

```yaml
inboxPath: ./inbox
jobStorePath: ./.ocrtool/jobs
host: 127.0.0.1
port: 4312
defaultEngine: tesseract
nativeTextMinChars: 24
engines:
  tesseract:
    kind: tesseract
    lang: eng
    trainedDataPath: ./tessdata
  deepseek-ocr:
    kind: deepseek-ocr
    ollamaHost: http://127.0.0.1:11434
    model: deepseek-ocr
    chatTimeoutMs: 180000
    maxOutputTokens: 4096
  nuextract3-ocr:
    kind: nuextract3-ocr
    serverHost: http://127.0.0.1:8080
    model: numind/NuExtract3-mlx-nvfp4
    chatTimeoutMs: 180000
    maxOutputTokens: 4096
```

- Tesseract adapter does not download language assets. Put `eng.traineddata` (or chosen language file) in `trainedDataPath` first.
- DeepSeek adapter rejects non-local Ollama hosts before any image leaves process.
- NuExtract3 adapter rejects non-local mlx-vlm hosts before any image leaves process.

### `nuextract3-ocr` config keys

| Key | Default | Notes |
|-----|---------|-------|
| `serverHost` | `http://127.0.0.1:8080` | Local mlx-vlm server base URL. Must be loopback. mlx-vlm defaults to port `8080`. |
| `model` | `numind/NuExtract3-mlx-nvfp4` | Model id as loaded by the server; must match `--model`. |
| `chatTimeoutMs` | `180000` | Per-page request timeout. |
| `maxOutputTokens` | `4096` | Maps to OpenAI `max_tokens`. |

### NuExtract3 (mlx-vlm) prerequisite

The `nuextract3-ocr` engine targets a local [mlx-vlm](https://github.com/Blaizzy/mlx-vlm) OpenAI-compatible server (Apple Silicon), the same way `deepseek-ocr` targets local Ollama. Install and run it before selecting the engine:

```bash
pip install mlx-vlm
python -m mlx_vlm.server --model numind/NuExtract3-mlx-nvfp4
```

The adapter posts the page image to `POST {serverHost}/v1/chat/completions` in NuExtract3's document-to-Markdown (`content`) mode with thinking disabled, and probes `GET {serverHost}/v1/models` for availability. No text prompt is sent — the model's chat template drives Markdown conversion by default.

## API

- `GET /api/pdfs` — list top-level inbox PDF filenames.
- `POST /api/jobs` with `{ "pdf": "file.pdf" }` — create review job from inbox PDF, or resume existing `pending_review` job for same PDF.
- `GET /api/jobs/:id` — load draft job.
- `GET /api/jobs/:id/pages/:page/preview` — return preview PNG for page.
- `POST /api/jobs/:id/pages/:page/rerun` with `{ "engine": "tesseract" }` — rerun OCR for one page. Low native-text coverage now saves OCR output but adds page warning metadata with missing native snippets for manual comparison.
- `POST /api/jobs/:id/pages/:page/accept` — mark page accepted.
- `POST /api/jobs/:id/commit` — requires at least one accepted page, writes markdown output with placeholders for unaccepted pages, keeps job `pending_review` until every page is accepted, moves source PDF only on final full commit, returns `409` if job already committed or no pages accepted yet.
- `DELETE /api/jobs/:id` — discard draft job and preview artifacts, returns `409` if job already committed.

All API errors return JSON like:

```json
{ "error": "message" }
```

Server stays local-only by config. Allowed bind hosts: `127.0.0.1`, `localhost`, `::1`. Default bind: `127.0.0.1:4312`.

## v1 scope target

- Local Express server.
- PDF intake from configured inbox.
- Native-text extraction + OCR fallback.
- Per-page review and rerun before commit.
- Markdown output into vault-friendly folder structure, with adapter-provided figure images copied into `<inbox>/<name>/images/` and linked as relative markdown images.

## PDF pipeline notes

- Uses `pdfjs-dist` legacy build in Node.
- Extracts native text per page.
- Renders page preview PNGs into per-job preview folders using `@napi-rs/canvas`.
- Resolves pdf.js standard font assets from installed `pdfjs-dist`, so preview rendering works from source and built `dist`.
- OCR fallback runs only when extracted native text length is below `nativeTextMinChars`.
- Review jobs stay `pending_review` until final full commit.
- Draft pages stay `pending` by default, including pages with native text.
- Commit frontmatter reports provenance as `native`, engine name, or `mixed`.
- Commit creates `<inbox>/<pdf-name>/images/` on every write and preserves OCR adapter figure files there as stable names like `page-001-figure-001.png`.
- Commit appends relative `![](images/...)` links near page content when adapter figures exist and page markdown does not already include that exact link.

### Limitation

- Node ESM `pdfjs-dist` + canvas rendering can be brittle across environments/fonts. Current implementation is best-effort and covered mainly at orchestration level in tests; preview rendering should be smoke-tested in target runtime if issues appear.
- Native PDF embedded-image extraction is not implemented yet. Current commit step preserves only figure image files provided by OCR adapters via `page.figures`; embedded-image extraction from source PDFs is deferred.
- `nuextract3-ocr` returns Markdown only in v1 — no figure or layout-block extraction. NuExtract3's Markdown mode emits inline `<figure>`/`<table>` HTML and LaTeX rather than bounding boxes or cropped image files, so it provides no `figures`/`layoutBlocks` metadata (unlike `deepseek-ocr`).

## Commands

- `npm run dev` — start dev server.
- `npm run build` — compile TypeScript.
- `npm run start` — run built server.
- `npm test` — run Vitest.

## Verification

```bash
npm test
npm run build
```
