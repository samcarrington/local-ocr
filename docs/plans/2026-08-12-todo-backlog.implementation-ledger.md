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
| P2 Chandra benchmark | in-progress | `b02af36`; loopback-only benchmark harness and scoring tests |
| P2 structured and HTML output formats | not-started | Blocked on the selected-engine capability decision |
| P3 documentation and UI polish | not-started | Depends on the engine and output-format decisions |

## Active work: Chandra benchmark

| Requirement | Status | Evidence / next action |
| --- | --- | --- |
| Local OpenAI-compatible compatibility | done | `mlx-community/chandra-ocr-2-oQ8` loaded, listed in `/v1/models`, and completed a loopback image request |
| Representative distributable corpus | in-progress | Benchmark harness accepts paired `<name>.png` and `<name>.txt` fixtures; each required category must be explicitly mapped to a fixture, with generated sanity cases kept distinct |
| Comparable metrics | in-progress | Harness records latency, failures, normalised character fidelity, optional peak memory, raw output, and qualitative layout review |
| Adoption decision | not-started | Run every required category against Chandra, Tesseract, GLM-OCR, and NuExtract3; review evidence rather than applying an automatic numeric threshold |

## Current decision boundary

Chandra is a research-only candidate and is not an application engine until
the representative benchmark supports adoption. The rejected alternatives are
adding its configuration, adapter, selector, and launch documentation from the
single smoke test, or adopting from synthetic-only scores; either would create
a support commitment without representative comparative evidence.
