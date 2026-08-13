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
| P2 DeepSeek mlx-vlm assessment | done (deferred) | `6bdf672`; model loads but image inference fails in mlx-vlm continuous batching with a GPU stream error |
| P2 Chandra benchmark | done (deferred) | `DECISION-20260813-085330-372164`; fresh Chandra mlx-vlm server timed out on a simple OCR case |
| P2 structured and HTML output formats | in-progress | `DECISION-20260813-085435-976865`; capability contract and Markdown-only current-engine path |
| P3 documentation and UI polish | not-started | Depends on the engine and output-format decisions |

## Active work: Chandra benchmark

| Requirement | Status | Evidence / next action |
| --- | --- | --- |
| Local OpenAI-compatible compatibility | done | `mlx-community/chandra-ocr-2-oQ8` loaded, listed in `/v1/models`, and completed a loopback image request |
| Representative distributable corpus | deferred | Current Chandra mlx-vlm serving cannot complete the simple sanity case |
| Comparable metrics | deferred | The harness remains available when a compatible Chandra serving path exists |
| Adoption decision | done (deferred) | `DECISION-20260813-085330-372164`; do not adopt Chandra from the earlier smoke test |

## Active work: output-format contract

| Requirement | Status | Evidence / next action |
| --- | --- | --- |
| Shared format and capability types | done | `markdown`, `json`, and `html` contract; all current engines advertise Markdown only |
| Persistent provenance | done | Draft pages retain selected and supported formats; commits write `output_format` frontmatter |
| Safe JSON/HTML support | not-started | Add only with an engine that provides native output, then validate JSON and sanitise HTML before preview or commit |

## Current decision boundary

Chandra is a research-only candidate and is not an application engine until
the representative benchmark supports adoption. The rejected alternatives are
adding its configuration, adapter, selector, and launch documentation from the
single smoke test, or adopting from synthetic-only scores; either would create
a support commitment without representative comparative evidence.
