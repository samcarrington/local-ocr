# Delivery Plan: Prioritised TODO Backlog

## Scope and success criteria

This plan turns the remaining `TODO.md` items into an ordered programme for
the local-only OCR review application. It preserves the Nuxt/Nitro migration
constraints: loopback-only model services, untrusted OCR output, typed client
and server boundaries, and the accept-before-commit workflow.

Success is a documented, tested release path in which:

- one documented local command starts the application and one supported local
  OCR model together;
- client-side failures are visible and actionable;
- Markdown is rendered safely with the product features users need;
- coverage is measured, reported, and raised around the major workflows;
- each adopted OCR engine is locally runnable, configurable, and benchmarked;
- output-format, container, and polish work builds on those stable contracts.

The primary outcome and success criterion above are confirmed. They supersede
the prior foundation-first ordering: a frictionless local startup path comes
before optional distribution work. The separate Obsidian-pipeline model choice
does not block this application.

## Priority order

| Priority | Workstream | TODO items | Why now | Depends on |
|---|---|---|---|---|
| P0 | One-command local startup | Dockerise mlx-vlm with frontend and backend | This is the confirmed primary outcome. Establish a native orchestration path first, then prove whether Docker can support the required local hardware/model runtime. | Existing GLM-OCR or NuExtract3 mlx-vlm path |
| P1 | Reliability, safe rendering, and test baseline | Visible API errors; unit tests; test coverage reporting; Markdown-rendering replacement and feature support | These reduce user-facing failure ambiguity and create a safety net before changing OCR contracts or rendering untrusted model output. | P0 startup path |
| P2 | OCR engine capability | Chandra OCR; migrate DeepSeek to mlx-vlm | Engines are the core product differentiator, but need a common local-server contract and a regression baseline. | P0, P1 |
| P2 | Output formats | JSON and HTML review/save options | Requires a defined engine capability model and a safe rendering/export contract. | P1, selected P2 engines |
| P3 | Product documentation and UI polish | Detailed docs; preview font; proper icons | Documentation must describe the shipped runtime; visual changes are low-risk after rendering is settled. | P0, P2 where applicable |
| P3 | Separate product discovery | Choose an LLM for the Obsidian pipeline app | It has no implementation dependency on local-ocr and should not consume this delivery stream. | None |

## P0: One-command local startup

### 1. Deliver a supported native one-command startup path

The current app and mlx-vlm server are separate commands. Add an explicitly
supported launcher that starts Nitro and one existing, documented
OpenAI-compatible mlx-vlm engine together, performs preflight validation, and
shuts both down cleanly on interruption.

- Select one existing baseline engine for this first slice (GLM-OCR or
  NuExtract3) and keep its model, configuration, and host on loopback.
- Add a package script and narrow runner that reads the same OCR configuration
  as the application, verifies required executables/model settings, starts
  the model server, waits for its availability endpoint, then starts Nuxt.
- Forward termination signals to both children, return non-zero on startup
  failure, and print concise recovery guidance without exposing local paths or
  secrets.
- Document the prerequisites and command in the README, and add automated
  tests for command construction and preflight failures plus a manual
  smoke-test procedure for a model-equipped machine.

**Exit criteria:** from a configured local checkout, one documented command
starts the review app and one supported local OCR model without cloud calls or
non-loopback exposure.

### 2. Make Docker a feasibility-gated equivalent, not a blocker

MLX acceleration and model availability can depend on Apple Silicon/Metal,
which may not be available inside Docker Desktop. Prove the runtime before
promising Compose as the primary startup mechanism.

- Spike a minimal Compose configuration with the Nuxt/Nitro service and the
  chosen model runtime; record whether required acceleration, model loading,
  bind mounts, and loopback-only networking work on target hardware.
- If viable, ship a multi-service Compose setup with explicit volumes for the
  inbox, job store, model cache, and configuration; published ports bind to
  loopback and services expose health checks.
- If not viable, document Docker as an application-only or CPU fallback and
  retain the native P0 launcher as the supported accelerated path. Do not
  present a non-functional container as full local OCR support.

**Exit criteria:** Docker has either a verified full-stack Compose path or a
clear, evidence-backed limitation and supported native alternative.

#### Recorded feasibility outcome (2026-08-12)

Full-stack Compose is deferred for the existing `mlx-vlm` GLM-OCR runtime.
Docker Desktop documents general container GPU support only for Windows with
WSL2 and NVIDIA GPUs; it does not provide standard Metal GPU passthrough to
Linux containers on macOS. MLX's Linux backends are CPU or CUDA, while
`mlx-vlm` is an MLX-on-Mac runtime. Docker Model Runner's separate
`llama.cpp`/Metal route is not compatible with the configured GLM-OCR model or
its `mlx_vlm.server` API.

The native `pnpm start:glm-ocr` launcher is therefore the supported accelerated
path. A future Docker change may package the application alone or provide a
CPU fallback, but must not claim equivalent local MLX/Metal OCR support.

## P1: Reliability, safe rendering, and test baseline

### 1. Make API errors clearly visible in the client

The composable already converts failed responses into `status`, which
`AppShell.vue` announces in a live region. Audit every failed and unavailable
state to establish the gap behind this TODO, then make errors a distinct,
persistent UI state rather than text indistinguishable from progress updates.

- Add typed client error state in `app/composables/useOcrReview.ts`, retaining
  the operation context, recovery action, and safe server message.
- Render an accessible error panel in `app/components/AppShell.vue` or the
  affected review/inbox component. It must be visually distinct, announced
  once, dismissible only after acknowledgement or a later successful action,
  and never expose stack traces or filesystem internals.
- Cover failed inbox loading, job creation, rerun, accept, commit, and discard
  requests in `app/composables/useOcrReview.test.ts` and component tests.

**Exit criteria:** every non-2xx API response produces a visible, accessible,
actionable client error without relying on browser-console output.

### 2. Replace the hand-rolled Markdown renderer safely

`app/utils/markdown.ts` and `SafeMarkdown.vue` deliberately support only
headings, flat lists, code, and paragraphs. The two Markdown TODOs are one
workstream, not separate implementations.

- Evaluate a maintained Vue/Nuxt-compatible renderer with a documented
  sanitisation path; choose it only if it supports the needed CommonMark/GFM
  subset (tables, emphasis/strong text, heading level 4, links, fenced code)
  without requiring unsafe raw HTML rendering.
- Keep generated OCR Markdown untrusted: do not introduce `v-html` over
  unsanitised output, validate protocols for links and images, and preserve
  local-relative image restrictions from commit sanitisation.
- Replace `markdownBlocks` and its component usage in one change, retaining
  raw-Markdown disclosure and accessible heading hierarchy.
- Add rendering tests for supported syntax and hostile input, including script
  tags, event handlers, unsafe URL schemes, malformed HTML, and remote image
  references.

**Exit criteria:** the preview supports the agreed feature set and no OCR
content can execute script, navigate to an unsafe protocol, or load a remote
image.

### 3. Establish coverage reporting and complete major-workflow tests

"All major functions" needs measurable ownership rather than an unbounded
promise.

- Configure Vitest coverage for the existing `app` and `server` projects,
  emitting text, LCOV, and HTML reports under the already ignored
  `coverage/` directory.
- Define major workflows as: config parsing and host guards; adapter registry
  and each adapter's request/response/error mapping; PDF/anydoc extraction;
  job persistence; rerun/accept/commit/discard; API error mapping; client
  review actions; Markdown safety; and the critical Playwright flow.
- Add missing focused tests, then record a baseline by directory and set
  ratcheting thresholds only after the baseline is known. Do not claim 100%
  coverage for rendering, filesystem, or model-server integration code that
  needs integration/e2e evidence instead.
- Publish the coverage summary and badge only after a CI-accessible report
  location is selected; otherwise keep the badge out of the README to avoid a
  misleading result.

**Exit criteria:** `pnpm test` remains the fast correctness suite, a separate
coverage command reports both projects, critical paths have explicit tests,
and coverage cannot regress below agreed thresholds.

#### Baseline (2026-08-12)

`pnpm test:coverage` writes text, LCOV, and HTML reports to `coverage/app/`
and `coverage/server/`. The initial app baseline is 74.82% statements, 56.60%
branches, 80.00% functions, and 79.54% lines. The server baseline is 76.61%
statements, 66.43% branches, 73.72% functions, and 85.71% lines.

No ratcheting threshold is set yet: API route, Nitro-plugin, and integration
orchestration coverage need their explicit workflow tests before a threshold
would be meaningful. The reports are deliberately local until CI exposes a
durable report location, so no coverage badge is published.

## P2: OCR engine capability

### 4. Create a reusable mlx-vlm OpenAI-compatible engine path

GLM-OCR and NuExtract3 already demonstrate the intended pattern. Refactor
only enough shared request, availability, timeout, and loopback-host
validation logic to make new mlx-vlm adapters consistent without weakening
the local-only guard.

- Preserve the strict Zod configuration schema in `server/core/config.ts` and
  the matching `EngineName`, engine config union, and `AppConfig` types in
  `server/core/types.ts` and `shared/ocr.ts`.
- Keep adapter registration in `server/ocr/adapters.ts`, server-side relative
  `.js` imports, service validation, and UI availability in sync.
- Use recorded fixture responses and local-host rejection tests; do not make
  hardware/model downloads part of unit tests.

### 5. Benchmark and adopt Chandra OCR

The TODO says "and/or", so make selection evidence-based before permanently
supporting multiple expensive local models.

- Define a representative local corpus: scanned text, native-text PDFs,
  tables, multi-column pages, figures, handwriting if relevant, and
  non-English content where required. Keep only distributable fixtures in the
  repository.
- Compare Chandra's supported serving interface with the existing
  mlx-vlm/OpenAI-compatible contract. Record Apple-Silicon memory, latency,
  failure rate, and Markdown fidelity alongside Tesseract, GLM-OCR, and
  NuExtract3.
- If Chandra meets the agreed threshold, add its schema/type, adapter,
  registry entry, service validation, selector option, example configuration,
  local launch script, README instructions, unit tests, and an opt-in e2e
  smoke procedure. If it does not, retain benchmark evidence and do not add a
  maintenance burden.

**Exit criteria:** a clearly documented keep/defer decision, and each adopted
engine follows the full configuration-to-UI-to-test integration path.

#### Recorded evaluation outcome (revised 2026-08-13)

`mlx-community/chandra-ocr-2-oQ8` is an MLX Qwen3.5 quantisation with an
image-aware chat template, making it a viable research benchmark candidate for
the existing local OpenAI-compatible adapter path. Research use is within the
user's declared purpose, so the model's modified OpenRAIL-M licence is not a
blocker for this evaluation.

The local `mlx_vlm.server` smoke test is complete: the model loaded, appeared
at `/v1/models`, and returned structured OCR content from a loopback image
chat-completions request, reporting 6.32 GB peak memory. Do not add a Chandra
adapter until a representative corpus measures memory, latency, failure rate,
and Markdown fidelity against the existing engines.

### 6. Migrate DeepSeek OCR from Ollama to mlx-vlm

Treat this as a compatibility migration, not a model-name substitution.

- Confirm that the target DeepSeek model exposes the required mlx-vlm
  serving/API behaviour and benchmark it using the same corpus.
- Add a dedicated mlx-vlm configuration kind and adapter, retaining
  loopback-only validation, timeouts, availability probe, and response-shape
  validation.
- Decide and document whether the existing `deepseek-ocr` Ollama key has a
  deprecation window or is a breaking replacement. Do not silently reinterpret
  existing YAML.
- Update the selector, `ocrtool.config.example.yaml`, launch script, README,
  and focused adapter/config/service tests together.

**Exit criteria:** DeepSeek uses a documented local mlx-vlm launch path and
existing configurations receive either compatibility support or a clear
migration error.

## P2: Structured and HTML output formats

### 7. Define an output-format contract before adding controls

Do not expose JSON or HTML as generic save formats until their provenance and
safety rules are clear.

- Extend the shared job/page/result contract with an explicit output format and
  engine capabilities; Markdown remains the default and canonical review
  format.
- Request JSON or HTML only from engines that advertise support. Define
  deterministic fallbacks and visible capability messaging for engines that
  do not.
- Add a format selector and review panels without rendering arbitrary HTML.
  HTML must be sanitised before preview and written only under the committed
  local output directory; JSON must be schema-validated or saved as a clearly
  labelled raw engine artefact.
- Extend commit tests for filenames, local-relative assets, partial commits,
  format frontmatter/provenance, and sanitisation. Add e2e coverage for
  selecting, reviewing, accepting, and committing each supported format.

**Exit criteria:** users can review and save only formats actually supported
by the selected engine, while HTML and assets remain safe and local.

## P3: Documentation and polish

### 8. Update project documentation

Refresh the README after the engine and container decisions, then add concise
docs for architecture, configuration, supported formats, model prerequisites,
security constraints, operation/recovery, and the test/coverage commands.

**Exit criteria:** a new developer can choose a supported engine, configure
it, run the app, understand its local-only guarantees, and troubleshoot the
common failures without reading source code.

### 9. Finish contained UI polish

- Use a distinct, readable content font only in the Markdown preview, with
  system fallbacks and no external font fetches.
- Replace button glyphs with the project’s chosen Nuxt icon integration,
  including accessible labels and unchanged keyboard behaviour.
- Re-run component and responsive e2e checks after each change.

**Exit criteria:** content is visually distinct from application chrome and
all icon-only controls have accessible names.

## P3: Obsidian pipeline model selection

Create a short decision record separate from this repository’s delivery work:
requirements, privacy constraints, target hardware, context-window and cost
limits, evaluation prompts, candidate models, and a selected model with
rationale. It must not add an OCR runtime dependency unless a later,
explicitly scoped integration requires one.

## Dependencies and sequencing

1. Deliver and document the native one-command startup path using an existing
   supported mlx-vlm engine.
2. Run the Docker feasibility spike; it must not block the native path.
3. Complete visible-error handling, safe Markdown rendering, and the coverage
   baseline before changing model integrations.
4. Establish the reusable mlx-vlm adapter path, benchmark candidates, then
   implement only engines that meet the selection criteria.
5. Add structured/HTML output after the final engine capability contract is
   known, and finish documentation and polish from the shipped behaviour.

## Top risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A richer renderer introduces XSS or remote asset loading | High | Treat OCR as untrusted, use an audited sanitisation path, and test hostile content. |
| Models differ in mlx-vlm support, memory use, or output quality | High | Benchmark before integration; keep model servers optional and fixtures local. |
| Coverage targets drive low-value tests | Medium | Measure first, test workflow seams, and use ratcheting rather than arbitrary 100% targets. |
| Docker cannot expose the required MLX/Metal runtime | High | Prove feasibility first; keep the native launcher as the supported accelerated path. |
| The backlog grows while engine decisions remain open | Medium | Time-box evaluation and record explicit keep/defer decisions. |

## Recommended first implementation slice

Deliver one startup slice: add a native launcher for one existing mlx-vlm
engine, with preflight checks, readiness probing, graceful shutdown, and
README instructions. This directly proves the confirmed outcome before
investing in optional Docker packaging or new model integrations.
