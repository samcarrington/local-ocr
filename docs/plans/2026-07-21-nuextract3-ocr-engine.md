# NuExtract3 OCR Engine Implementation Plan

**Goal:** Add `nuextract3-ocr` as a selectable local OCR engine so NuExtract3's doc-to-Markdown conversion can be tested and reviewed through the existing inbox review workflow, alongside `tesseract` and `deepseek-ocr`.

**Architecture:** Mirrors the existing `deepseek-ocr` adapter — a local-only HTTP adapter implementing the shared `OcrAdapter` contract. Instead of Ollama's `/api/generate` (NuExtract3 is not published on Ollama's official library), the adapter targets [mlx-vlm](https://github.com/Blaizzy/mlx-vlm)'s built-in OpenAI-compatible server (`python -m mlx_vlm.server`), which serves `/v1/chat/completions` with image support and can load [numind/NuExtract3-mlx-nvfp4](https://huggingface.co/numind/NuExtract3-mlx-nvfp4) natively on Apple Silicon via MLX.

**Tech notes:**
- NuExtract3 (4B, Qwen3.5-4B base, Apache 2.0) supports both structured JSON extraction and image-to-Markdown conversion; only Markdown mode is in scope here.
- Markdown output uses HTML `<table>` for tables, LaTeX for math, and inline `<figure alt="...">` for images — no bounding boxes or cropped image files, unlike DeepSeek-OCR's grounded output. Figure/layout-block extraction is out of scope for v1.
- NuExtract3 uses a custom `chat_template.jinja` with a `mode="markdown"` argument in the reference `transformers` usage. Whether that survives through mlx-vlm's generic OpenAI-style endpoint, or needs to be reconstructed as explicit system/user prompt text, is unconfirmed and must be resolved in Task 0 before writing adapter code.

---

### Task 0: Research spike — confirm exact markdown-mode request shape

**Steps:**
1. Read NuExtract3's `chat_template.jinja` and README on Hugging Face ([numind/NuExtract3](https://huggingface.co/numind/NuExtract3), [numind/NuExtract3-GGUF](https://huggingface.co/numind/NuExtract3-GGUF)) to identify the exact system/user prompt structure for Markdown mode (vs. structured-extraction mode).
2. Install `mlx-vlm`, run `python -m mlx_vlm.server --model numind/NuExtract3-mlx-nvfp4` locally, and send one manual `curl` request against `/v1/chat/completions` with a sample document image to confirm:
   - Whether a `mode` field (or equivalent) is accepted/respected.
   - The exact response shape (`choices[0].message.content` vs. other).
   - Any echoed prompt/boilerplate that needs stripping (as `deepseek.ts` does with `cleanOcrMarkdown`).
3. Record findings inline as code comments only where the reasoning is non-obvious (e.g., why a specific prompt string is used).

### Task 1: Types and config schema

**Files:**
- Edit: `src/core/types.ts`
- Edit: `src/core/config.ts`
- Edit: `ocrtool.config.example.yaml`

**Steps:**
1. Add `Nuextract3OcrEngineConfig` to `types.ts`: `kind: 'nuextract3-ocr'`, `serverHost`, `model`, `chatTimeoutMs?`, `maxOutputTokens?`. Add to the `EngineConfig` union.
2. Add a zod schema for the new engine in `config.ts` (mirrors `deepseekEngineSchema`), add it to `enginesSchema`, and add `'nuextract3-ocr'` to the `defaultEngine` enum.
3. Add a commented-out example engine block to `ocrtool.config.example.yaml`.

### Task 2: Shared local-host guard

**Files:**
- Create: `src/ocr/local-host.ts`
- Edit: `src/ocr/deepseek.ts`

**Steps:**
1. Extract `isLocalHost` / `assertLocalHost` out of `deepseek.ts` (currently `isLocalOllamaHost` / `assertLocalOllamaHost`) into a shared module, generalized to any host/adapter name.
2. Update `deepseek.ts` to use the shared helper. No behavior change.

### Task 3: NuExtract3 adapter

**Files:**
- Create: `src/ocr/nuextract3.ts`
- Create: `src/ocr/nuextract3.test.ts`

**Steps:**
1. Implement `isAvailable()`: local-host check via the Task 2 helper, then a short-timeout probe of the mlx-vlm server (e.g. `/v1/models` or `/health`, whichever it exposes).
2. Implement `processPage()`: read page image as base64, POST an OpenAI-style chat completion request in Markdown mode (per Task 0 findings) to `{serverHost}/v1/chat/completions`, parse the response, and clean the returned markdown (strip fences/echoed prompt, following the pattern in `cleanOcrMarkdown`).
3. Return `{ markdown }` only — no `figures` or `layoutBlocks`, since NuExtract3 Markdown mode doesn't provide bbox data.
4. Write tests mirroring `deepseek.test.ts`: non-local host rejection, availability check (up/down), happy-path parse, upstream error handling, empty-content error.

### Task 4: Registry wiring

**Files:**
- Edit: `src/ocr/adapters.ts`

**Steps:**
1. Instantiate `Nuextract3OcrAdapter` when a `nuextract3-ocr` engine config is present, following the existing `tesseract` / `deepseek-ocr` pattern.

### Task 5: API and review UI

**Files:**
- Edit: `src/api.ts`
- Edit: `public/index.html`

**Steps:**
1. Add `'nuextract3-ocr'` to the engine allowlist in `readEngine` (`src/api.ts`).
2. Add a `<option value="nuextract3-ocr">nuextract3-ocr</option>` to the `#adapter-select` dropdown.

### Task 6: Docs

**Files:**
- Edit: `README.md`

**Steps:**
1. Document the new engine's config keys.
2. Add a setup note for installing and running `mlx_vlm.server` locally as a prerequisite, parallel to the existing Ollama/DeepSeek-OCR setup note.
3. Note the known limitation: no figure/layout-block extraction for this engine in v1.

### Task 7: Verification

**Commands:**
- `npm test`
- `npm run build`

**Checks:**
1. Unit tests pass, including new adapter and config tests.
2. TypeScript build passes.
3. Manual smoke test: run a real inbox PDF through `nuextract3-ocr` via the review UI and compare Markdown output quality against `tesseract` and `deepseek-ocr` on the same page.
