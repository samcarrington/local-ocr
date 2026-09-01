# Local OCR

Localhost-only PDF-to-Markdown OCR review app for Obsidian inbox workflows.

## Status

- PDF draft pipeline implemented.
- Nuxt/Nitro API and Vue review UI implemented.

## Constraints

- No cloud calls.
- Localhost bind by default.
- v1 has no CLI, watcher, or multi-user access.
- OCR servers and the Nitro listener reject non-loopback hosts.

## Architecture

The client-rendered Nuxt app owns browser review state in
`app/composables/useOcrReview.ts` and calls thin Nitro routes under
`server/api/`. `server/services/ocr-service.ts` coordinates configuration,
jobs, OCR adapters, conversion, and commits. `server/core/` owns the strict
YAML configuration, PDF extraction, local job store, and safe commit output.
`shared/ocr.ts` contains the browser-safe job contract.

PDFs follow an accept-before-commit workflow: native text is retained when it
meets `nativeTextMinChars`; otherwise the configured local OCR adapter receives
a rendered page. Every page remains reviewable until accepted. Partial commits
write explicit pending or failed placeholders and do not move the source;
accepting every page moves it to `inbox/processed/`.

## Setup

1. Copy config:

   ```bash
   cp ocrtool.config.example.yaml ocrtool.config.yaml
   ```

2. Edit paths if needed.
   - `engines.tesseract.trainedDataPath` must point at local Tesseract `*.traineddata` files.
   - `engines.deepseek-ocr.ollamaHost` must stay local (`localhost`, `127.0.0.1`, or `::1`).
   - `engines.deepseek-ocr-vlm.serverHost`, `engines.glm-ocr.serverHost`, and `engines.nuextract3-ocr.serverHost` must stay local (`localhost`, `127.0.0.1`, or `::1`).
3. Install deps:

   ```bash
   pnpm install
   ```

4. Start the Nitro server and mlx-vlm GLM-OCR server with the one-command launcher:

   ```bash
   pnpm start:glm-ocr
   ```

5. Open `http://127.0.0.1:3000` (or the value of `NITRO_PORT`).

## Config

Example:

```yaml
inboxPath: ./inbox
jobStorePath: ./.ocrtool/jobs
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
  deepseek-ocr-vlm:
    kind: deepseek-ocr-vlm
    serverHost: http://127.0.0.1:8080
    model: mlx-community/DeepSeek-OCR-2-8bit
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

The YAML file configures OCR and storage only. Set `NITRO_HOST` and
`NITRO_PORT` to configure the listener; the default Nuxt development listener
is loopback on port 3000. Existing YAML `host` and `port` keys are ignored with
one deprecation warning per process for this release.

- Tesseract adapter does not download language assets. Put `eng.traineddata` (or chosen language file) in `trainedDataPath` first.
- DeepSeek adapter rejects non-local Ollama hosts before any image leaves process.
- DeepSeek-OCR-2 VLM, GLM-OCR, and NuExtract3 adapters reject non-local mlx-vlm hosts before any image leaves process.

### DeepSeek-OCR-2 VLM

`deepseek-ocr-vlm` is a separate engine from the legacy Ollama-backed
`deepseek-ocr` adapter. It serves
`mlx-community/DeepSeek-OCR-2-8bit` through mlx-vlm's local API, so both paths
remain available for comparison. The adapter supports both current
OpenAI-compatible `/v1/*` endpoints and older mlx-vlm `/models` and
`/chat/completions` endpoints, including their respective image payload
formats.

DeepSeek-OCR-2 requires a model-family-specific processor initialisation path
when calling mlx-vlm from Python. The reproducible investigation, script, and
after-action report are in
[`docs/deepseek-ocr-investigation/`](docs/deepseek-ocr-investigation/).
The protocol-fallback path passed the IDE end-to-end review flow. The legacy
Ollama adapter remains available for comparison and recovery. The bundled
launcher also applies a DeepSeek-only host-memory tensor handoff before
mlx-vlm's continuous-batching GPU thread, preventing MLX's cross-thread stream
failure while leaving other models on the upstream server path. The shared
server has been smoke-tested with DeepSeek, NuExtract3, and a subsequent
DeepSeek reload.

```bash
pip install -U mlx-vlm
pnpm serve:mlx-vlm -- --engine deepseek-ocr-vlm
```

The launcher reads the `deepseek-ocr-vlm` model, host, and port from the OCR
configuration, refuses non-loopback binds, and supports the same overrides as
the other MLX launchers. One running mlx-vlm process can serve DeepSeek and
NuExtract3 requests on the same port; upstream mlx-vlm keeps one
text-generation model active at a time and switches it on demand.

```bash
pnpm serve:mlx-vlm -- --engine deepseek-ocr-vlm --model mlx-community/DeepSeek-OCR-2-8bit --port 8080
pnpm serve:mlx-vlm -- --engine deepseek-ocr-vlm --dry-run
```

## Output formats

Markdown is the canonical review and commit format. Every current engine
advertises Markdown only, and each committed file includes `output_format:
"markdown"` provenance in its frontmatter.

The shared contract reserves `json` and `html`, but the application does not
generate either from Markdown. They become selectable only when an engine
natively supports them: JSON must be schema-validated, and HTML must be
sanitised before preview or commit. This avoids presenting a conversion as
model-provided structured output.

## Whole-document conversion (anydoc)

Whole-document conversion uses firecrawl's native `anydoc` npm package to convert supported files directly to Markdown in one step. It is fully local and offline - no network calls are made, consistent with this project's no-cloud-calls stance. This is an alternative to the per-page OCR review pipeline used for PDFs.

Supported extensions:

`.doc`, `.docx`, `.docm`, `.ppt`, `.pps`, `.pot`, `.pptx`, `.pptm`, `.ppsx`, `.ppsm`, `.xls`, `.xlsx`, `.xlsm`, `.xlsb`, `.odt`, `.ods`, `.odp`, `.rtf`, `.epub`

For PDFs, **Review pages** remains the default per-page OCR flow. When a PDF already has a good text layer, **Quick convert (native text)** runs that PDF through `anydoc` instead. Scanned or image-only PDFs fail native conversion with a clear error pointing back to **Review pages**; this is expected, not a bug.

Known v1 limitation: embedded images in converted documents appear as alt text only. No image files are extracted, unlike the PDF pipeline's per-page figure extraction.

Document-kind jobs write to `inbox/<name>--<ext>/<name>--<ext>.md`. For example, `report.docx` becomes `inbox/report--docx/report--docx.md`. This differs from the PDF convention, `inbox/<name>/<name>.md`, to avoid collisions between a source file and its own output directory.

### `glm-ocr` config keys

| Key               | Default                      | Notes                                                                             |
| ----------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| `serverHost`      | `http://127.0.0.1:8080`      | Local mlx-vlm server base URL. Must be loopback. mlx-vlm defaults to port `8080`. |
| `model`           | `mlx-community/GLM-OCR-bf16` | Model id as loaded by the server; must match `--model`.                           |
| `chatTimeoutMs`   | `180000`                     | Per-page request timeout.                                                         |
| `maxOutputTokens` | `4096`                       | Maps to OpenAI `max_tokens`.                                                      |

### GLM-OCR one-command local startup

The supported P0 native launcher starts the local mlx-vlm GLM-OCR server,
waits until its OpenAI-compatible `GET /v1/models` endpoint reports the model
configured in the same OCR YAML file, and then starts Nuxt.

Prerequisites:

- Node `>=24 <25`, pnpm `11.9.0`, and project dependencies (`pnpm install`).
- Python 3 with `mlx-vlm` installed in the interpreter selected by `PYTHON`
  (or `python3` when `PYTHON` is unset).
- An `engines.glm-ocr` block in `ocrtool.config.yaml` (or the config named by
  `NUXT_OCRTOOL_CONFIG_PATH`) with a loopback `serverHost` and a model.

```bash
pip install mlx-vlm
pnpm start:glm-ocr
```

The launcher binds Nuxt to `127.0.0.1:3000` by default. Set a different
loopback `NITRO_HOST` or `NITRO_PORT` when needed:

```bash
NITRO_PORT=4312 pnpm start:glm-ocr
```

It fails before startup when Python/mlx-vlm is unavailable or the config is not
valid for GLM-OCR, and it stops both child processes on `Ctrl-C` or `SIGTERM`.
It does not download a model or make any hardware-compatibility claim; model
availability remains the responsibility of mlx-vlm.

Manual smoke procedure:

1. Start the command above and wait for `GLM-OCR is ready. Starting local Nuxt server...`.
2. Open `http://127.0.0.1:3000` (or the selected `NITRO_PORT`), create a PDF
   review job, select `glm-ocr`, and rerun a page.
3. Press `Ctrl-C`; the mlx-vlm and Nuxt processes should both stop.

`pnpm serve:mlx-vlm -- --engine glm-ocr` starts only the local model server.
It reads the selected engine's model, host, and port from your configuration
and refuses non-loopback binds. Options:

```bash
pnpm serve:mlx-vlm -- --engine glm-ocr --model mlx-community/GLM-OCR-bf16 --port 8080
pnpm serve:mlx-vlm -- --engine glm-ocr --dry-run
```

Set `PYTHON` (or `--python`) if mlx-vlm lives in a virtualenv whose interpreter is not `python3`. Equivalent manual command: `python -m mlx_vlm.server --model mlx-community/GLM-OCR-bf16 --host 127.0.0.1 --port 8080`.

The adapter probes `GET {serverHost}/v1/models` and posts page image data URLs to `POST {serverHost}/v1/chat/completions` with non-streaming OpenAI-compatible requests and prompt `Text Recognition:`. Capability is direct text recognition/model output only; this does not guarantee the official Z.ai SDK layout/Markdown pipeline.

### `nuextract3-ocr` config keys

| Key               | Default                       | Notes                                                                             |
| ----------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| `serverHost`      | `http://127.0.0.1:8080`       | Local mlx-vlm server base URL. Must be loopback. mlx-vlm defaults to port `8080`. |
| `model`           | `numind/NuExtract3-mlx-nvfp4` | Model id as loaded by the server; must match `--model`.                           |
| `chatTimeoutMs`   | `180000`                      | Per-page request timeout.                                                         |
| `maxOutputTokens` | `4096`                        | Maps to OpenAI `max_tokens`.                                                      |

### NuExtract3 (mlx-vlm) prerequisite

The `nuextract3-ocr` engine targets a local [mlx-vlm](https://github.com/Blaizzy/mlx-vlm) OpenAI-compatible server (Apple Silicon), the same way `deepseek-ocr` targets local Ollama. Install mlx-vlm, then start the server before selecting the engine:

```bash
pip install mlx-vlm
pnpm serve:mlx-vlm -- --engine nuextract3-ocr
```

`pnpm serve:mlx-vlm -- --engine nuextract3-ocr` reads the selected engine's
model, host, and port from your config and runs `python -m mlx_vlm.server`
accordingly, so the server and app stay in sync. Options:

```bash
# Override per invocation (see all flags with --help)
pnpm serve:mlx-vlm -- --engine nuextract3-ocr --model numind/NuExtract3-mlx-nvfp4 --port 8080
# Print the resolved command without launching
pnpm serve:mlx-vlm -- --engine nuextract3-ocr --dry-run
```

Set `PYTHON` (or `--python`) if mlx-vlm lives in a virtualenv whose interpreter is not `python3`. The equivalent manual command is `python -m mlx_vlm.server --model numind/NuExtract3-mlx-nvfp4 --host 127.0.0.1 --port 8080`.

The adapter posts the page image to `POST {serverHost}/v1/chat/completions` in NuExtract3's document-to-Markdown (`content`) mode with thinking disabled, and probes `GET {serverHost}/v1/models` for availability. No text prompt is sent — the model's chat template drives Markdown conversion by default.

## API

- `GET /api/pdfs` — list top-level inbox PDF filenames.
- `GET /api/documents` — list supported whole-document files in the top-level inbox.
- `POST /api/jobs` with `{ "file": "file.pdf", "mode": "pages" }` — create a per-page PDF review job. `mode` defaults to `pages`; PDFs also accept `document` for Quick convert (native text).
- `POST /api/jobs` with `{ "file": "file.docx", "mode": "document" }` — create a whole-document conversion job for a supported non-PDF file. Non-PDF files require `mode: "document"`.
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

Server stays local-only by config. Allowed bind hosts: `127.0.0.1`, `localhost`, `::1`. Default bind: `127.0.0.1:3000`.

## Operation and recovery

- A visible error panel describes failed inbox, draft, rerun, accept, commit,
  and discard requests. Acknowledge it, correct the local configuration or
  model service, then repeat the named action.
- For `glm-ocr`, prefer `pnpm start:glm-ocr`; it validates the configured
  loopback service, waits for its model, and stops both the model server and
  Nuxt on interruption.
- A model service must report the exact configured model id from
  `GET /v1/models`. Check the configured host and model before retrying a
  failed mlx-vlm request.
- Chandra MLX is intentionally not a selectable engine. Its current
  `mlx_vlm.server` path timed out on a simple local OCR request; the
  loopback-only benchmark harness remains for a future compatible release.

## v1 scope

- Local Nuxt/Nitro server.
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

- `pnpm dev` — start the Nuxt development server.
- `pnpm build:nuxt` — build the production Nuxt/Nitro server.
- `pnpm start` — run the built Nuxt/Nitro server.
- `pnpm start:glm-ocr` — start the configured loopback GLM-OCR mlx-vlm server, wait for it, then start local Nuxt.
- `pnpm serve:mlx-vlm -- --engine <engine>` — start the local mlx-vlm server for `deepseek-ocr-vlm`, `glm-ocr`, or `nuextract3-ocr` (`-- --help` for options).
- `pnpm test` — run Vitest and architecture checks.
- `pnpm test:coverage` — write separate app and server V8 coverage reports to
  `coverage/app/` and `coverage/server/`.
- `pnpm test:e2e` — run the Playwright review-flow checks.
- `pnpm benchmark:ocr -- --server-host http://127.0.0.1:8080 --model MODEL`
  — benchmark a local OpenAI-compatible OCR service. It rejects non-loopback
  hosts; use `--corpus DIR` with paired `<name>.png` and `<name>.txt` fixtures
  for a reproducible corpus.

## Verification

```bash
pnpm test
pnpm build:nuxt
pnpm test:e2e
```
