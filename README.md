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
   - `engines.glm-ocr.serverHost` and `engines.nuextract3-ocr.serverHost` must stay local (`localhost`, `127.0.0.1`, or `::1`).
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
  glm-ocr:
    kind: glm-ocr
    serverHost: http://127.0.0.1:8080
    model: mlx-community/GLM-OCR-bf16
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
- GLM-OCR and NuExtract3 adapters reject non-local mlx-vlm hosts before any image leaves process.

### `glm-ocr` config keys

| Key | Default | Notes |
|-----|---------|-------|
| `serverHost` | `http://127.0.0.1:8080` | Local mlx-vlm server base URL. Must be loopback. mlx-vlm defaults to port `8080`. |
| `model` | `mlx-community/GLM-OCR-bf16` | Model id as loaded by the server; must match `--model`. |
| `chatTimeoutMs` | `180000` | Per-page request timeout. |
| `maxOutputTokens` | `4096` | Maps to OpenAI `max_tokens`. |

### GLM-OCR (mlx-vlm) prerequisite

The `glm-ocr` engine targets a local mlx-vlm OpenAI-compatible server with `mlx-community/GLM-OCR-bf16`. Install mlx-vlm, then start the server before selecting the engine:

```bash
pip install mlx-vlm
npm run serve:glm-ocr
```

`npm run serve:glm-ocr` reads the `glm-ocr` model, host, and port from your config (falling back to defaults) and refuses non-loopback binds. Options:

```bash
npm run serve:glm-ocr -- --model mlx-community/GLM-OCR-bf16 --port 8080
npm run serve:glm-ocr -- --dry-run
```

Set `PYTHON` (or `--python`) if mlx-vlm lives in a virtualenv whose interpreter is not `python3`. Equivalent manual command: `python -m mlx_vlm.server --model mlx-community/GLM-OCR-bf16 --host 127.0.0.1 --port 8080`.

The adapter probes `GET {serverHost}/v1/models` and posts page image data URLs to `POST {serverHost}/v1/chat/completions` with non-streaming OpenAI-compatible requests and prompt `Text Recognition:`. Capability is direct text recognition/model output only; this does not guarantee the official Z.ai SDK layout/Markdown pipeline.

### `nuextract3-ocr` config keys

| Key | Default | Notes |
|-----|---------|-------|
| `serverHost` | `http://127.0.0.1:8080` | Local mlx-vlm server base URL. Must be loopback. mlx-vlm defaults to port `8080`. |
| `model` | `numind/NuExtract3-mlx-nvfp4` | Model id as loaded by the server; must match `--model`. |
| `chatTimeoutMs` | `180000` | Per-page request timeout. |
| `maxOutputTokens` | `4096` | Maps to OpenAI `max_tokens`. |

### NuExtract3 (mlx-vlm) prerequisite

The `nuextract3-ocr` engine targets a local [mlx-vlm](https://github.com/Blaizzy/mlx-vlm) OpenAI-compatible server (Apple Silicon), the same way `deepseek-ocr` targets local Ollama. Install mlx-vlm, then start the server before selecting the engine:

```bash
pip install mlx-vlm
npm run serve:nuextract3
```

`npm run serve:nuextract3` reads the `nuextract3-ocr` model, host, and port from your config (falling back to defaults) and runs `python -m mlx_vlm.server` accordingly, so the server and app stay in sync. Options:

```bash
# Override per invocation (see all flags with --help)
npm run serve:nuextract3 -- --model numind/NuExtract3-mlx-nvfp4 --port 8080
# Print the resolved command without launching
npm run serve:nuextract3 -- --dry-run
```

Set `PYTHON` (or `--python`) if mlx-vlm lives in a virtualenv whose interpreter is not `python3`. The equivalent manual command is `python -m mlx_vlm.server --model numind/NuExtract3-mlx-nvfp4 --host 127.0.0.1 --port 8080`.

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
- Markdown output into vault-friendly folder structure, with figure images extracted from source PDF pages copied into `<inbox>/<name>/images/` and linked as relative markdown images.

## PDF pipeline notes

- Uses `pdfjs-dist` legacy build in Node.
- Extracts native text per page.
- Renders page preview PNGs into per-job preview folders using `@napi-rs/canvas`.
- Resolves pdf.js standard font assets from installed `pdfjs-dist`, so preview rendering works from source and built `dist`.
- OCR fallback runs only when extracted native text length is below `nativeTextMinChars`.
- Review jobs stay `pending_review` until final full commit.
- Draft pages stay `pending` by default, including pages with native text.
- Commit frontmatter reports provenance as `native`, engine name, or `mixed`.
- Commit creates `<inbox>/<pdf-name>/images/` on every write and preserves figure files there as stable names like `page-001-figure-001.png`.
- Commit appends relative `![](images/...)` links near page content when figures exist and page markdown does not already include that exact link.

## Page images

- Embedded page images are extracted at job creation: `pdf.ts` reads each page's image draw operations, computes their bounding boxes, and crops them from the rendered page. This runs for every engine (disable with `extractImages: false`), and the crops survive engine reruns since they belong to the page, not the engine.
- On commit, engines that emit inline image placeholders (`nuextract3-ocr` outputs `<figure><img src="img_N.png">`) have those `src` values rewritten in document order to the saved crop files, so the committed markdown references real images. Engines with no inline image refs fall back to appended `![](images/...)` links.
- NuExtract3 itself provides no pixel data or bounding boxes for the images it identifies (only a description and a placeholder filename); the actual pixels come from the source-PDF crops described above.

### Limitation

- Node ESM `pdfjs-dist` + canvas rendering can be brittle across environments/fonts. Current implementation is best-effort and covered mainly at orchestration level in tests; preview rendering should be smoke-tested in target runtime if issues appear.
- Image extraction captures raster image draw operations only; purely vector graphics (e.g. logos drawn as paths) are not captured as discrete figures. Inline placeholders are mapped to crops by document order, so a count mismatch between what the engine identified and what the PDF exposes can leave a surplus placeholder unresolved.

## Commands

- `npm run dev` — start dev server.
- `npm run build` — compile TypeScript.
- `npm run start` — run built server.
- `npm run serve:nuextract3` — start the local mlx-vlm server for the `nuextract3-ocr` engine (`-- --help` for options).
- `npm run serve:glm-ocr` — start the local mlx-vlm server for the `glm-ocr` engine (`-- --help` for options).
- `npm test` — run Vitest.

## Verification

```bash
npm test
npm run build
```
