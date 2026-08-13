# Implementation Ledger: TODO Backlog Delivery

## Ledger rules

- Status values: `not-started` | `in-progress` | `blocked` | `done`.
- Each completed item records concrete evidence: a commit, test output, or
  documented runtime observation.
- A workstream is done only when its delivery-plan exit criteria are met.

## Workstream ledger

| Workstream | Status | Evidence |
| --- | --- | --- |
| P0 native GLM-OCR launcher | done | `e74f5e1`; launcher tests and README procedure |
| P0 Docker feasibility | done | `e74f5e1`; native MLX/Metal remains the supported accelerated path because Docker Desktop cannot provide equivalent Metal acceleration |
| P1 visible API errors | done | `e74f5e1`; composable and AppShell failure-state tests |
| P1 safe Markdown rendering | done | `e74f5e1`; marked/DOMPurify renderer and hostile-input tests |
| P1 coverage reporting | done | `e74f5e1`; separate app/server V8 coverage reports |
| P2 shared mlx-vlm path | done | `6ee311a`; GLM-OCR and NuExtract3 adapter tests |
| P2 DeepSeek mlx-vlm adapter | done | `deepseek-ocr-vlm` passed the IDE end-to-end review flow. It supports modern and legacy mlx-vlm API fallbacks: `/v1/models` → `/models`, `/v1/chat/completions` → `/chat/completions`, and OpenAI `image_url` → mlx-vlm `input_image` payload retry. See `docs/deepseek-ocr-investigation/`; the legacy Ollama adapter remains available for comparison and recovery. |
| P2 generic mlx-vlm launcher | done | `998d15f`; `pnpm serve:mlx-vlm -- --engine <engine>` replaces duplicated standalone launchers for DeepSeek-OCR-2, GLM-OCR, and NuExtract3 while preserving configured loopback binding and `--model` overrides |
| P2 Chandra benchmark | done (deferred) | `DECISION-20260813-085330-372164`; fresh Chandra mlx-vlm server timed out on a simple OCR case |
| P2 structured and HTML output formats | done (capability-gated) | `f0ba10a`; Markdown-only current-engine path, with JSON/HTML deferred until an engine natively supports them |
| P3 documentation | done | README refresh on `feature/todo-p3-documentation` documents architecture, configuration, local-only guarantees, formats, recovery, coverage, and benchmarking |
| P3 UI polish | not-started | Contained visual work remains separate from completed documentation |

## Active work: Chandra benchmark

| Requirement | Status | Evidence / next action |
| --- | --- | --- |
| Local OpenAI-compatible compatibility | done | `mlx-community/chandra-ocr-2-oQ8` loaded, listed in `/v1/models`, and completed a loopback image request |
| Representative distributable corpus | deferred | Current Chandra mlx-vlm serving cannot complete the simple sanity case |
| Comparable metrics | deferred | The harness remains available when a compatible Chandra serving path exists |
| Adoption decision | done (deferred) | `DECISION-20260813-085330-372164`; do not adopt Chandra from the earlier smoke test |

## Completed work: output-format contract

| Requirement | Status | Evidence / next action |
| --- | --- | --- |
| Shared format and capability types | done | `markdown`, `json`, and `html` contract; all current engines advertise Markdown only |
| Persistent provenance | done | Draft pages retain selected and supported formats; commits write `output_format` frontmatter |
| Safe JSON/HTML support | deferred | Add only with an engine that provides native output, then validate JSON and sanitise HTML before preview or commit |

## Current decision boundary

Chandra is a research-only candidate and is not an application engine until
the representative benchmark supports adoption. The rejected alternatives are
adding its configuration, adapter, selector, and launch documentation from the
single smoke test, or adopting from synthetic-only scores; either would create
a support commitment without representative comparative evidence.
