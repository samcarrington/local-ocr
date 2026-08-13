# TODO

- [x] Add more detailed documentation for the project
- [x] Implement unit tests for major workflows and coverage reporting
- [x] API errors should result in visible errors on client side, not just console logs
- [x] Migrate the application to Nuxt/Nitro and Vue
- [ ] Add Chandra OCR <https://github.com/datalab-to/chandra> and/or <https://huggingface.co/mlx-community/chandra-ocr-2-oQ8>
- [x] Visual overhaul to improve UI/UX
- [ ] Move Deepseek to mlx-vlm - <https://github.com/Blaizzy/mlx-vlm/blob/main/mlx_vlm/models/deepseekocr_2/README.md> or <https://huggingface.co/mlx-community/DeepSeek-OCR-2-bf16>
- [ ] If models support JSON, HTML, add options to review and save these as well as markdown
- [x] Add test coverage reporting
- [ ] Add a coverage badge to the README after selecting a CI-accessible report location
- [ ] Dockerize mlx-vlm so project can all be run at once, front, back and LLM local host
- [ ] Choose LLM to use for Obsidian pipeline app (separate from this project)
- [x] Improve markdown rendering to support more features (tables, h4, bold, etc.)
- [ ] Use different font rendering inside the markdown preview to distinguish from the site font/content
- [ ] Replace dodgy button icons with proper nuxt-icon icons
- [x] Improve markdown rendering with nuxt-friendly dependency rather than hand-rolled clean and parse
- [x] Add one-command local GLM-OCR and Nuxt startup

## Delivery notes (2026-08-13)

- **One-command local startup:** `pnpm start:glm-ocr` starts the configured
  loopback mlx-vlm GLM-OCR server, waits for its configured model, then starts
  Nuxt. It stops both processes together.
- **Client reliability and Markdown:** persistent, accessible client errors
  are implemented. The preview now uses `marked` and DOMPurify with strict
  local-only link and image handling.
- **Tests and coverage:** `pnpm test:coverage` emits separate app and server
  V8 reports. The README documents the supported test and coverage commands.
- **Output formats:** Markdown is canonical. The shared contract reserves JSON
  and HTML, but neither is fabricated from Markdown; an engine must advertise
  native support before JSON validation or HTML sanitisation/review is added.

## Deferred or separate work

- **Chandra OCR:** `mlx-community/chandra-ocr-2-oQ8` loaded and passed an
  initial loopback smoke test, but a fresh mlx-vlm server timed out on a simple
  OCR request. Defer integration until a compatible MLX model or server mode
  completes image inference reliably.
- **DeepSeek mlx-vlm migration:** `mlx-community/DeepSeek-OCR-4bit` loads but
  image inference fails in mlx-vlm continuous batching with a GPU stream error.
  Retain the Ollama adapter until a working MLX path is proven.
- **Dockerised MLX runtime:** Docker Desktop does not provide an equivalent
  Apple Metal runtime for the Linux container path. The native launcher is the
  supported accelerated route; Docker remains a future application-only or CPU
  fallback investigation.
- **Obsidian pipeline LLM:** intentionally separate product discovery; it has
  no implementation dependency on this application.
