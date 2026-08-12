# Phase 2 Runtime Viability Evidence

Date: 2026-08-12

## Build evidence

- Command: `pnpm build:nuxt`
- Result: success, Nitro preset `node-server`
- Generated route chunks include:
  - `api/phase2/health.get`
  - `api/phase2/probe.post`

## Copied-output execution evidence

- Copied output root: `/tmp/local-ocr-phase2-run/.output`
- Runtime command:
  - `NITRO_HOST=127.0.0.1 NITRO_PORT=4520 OCRTOOL_CONFIG_PATH=/Users/samcarrington/dev/frog/local-ocr/ocrtool.config.yaml node .output/server/index.mjs`
- Server startup output: `Listening on http://127.0.0.1:4520`

## Host and API checks

### Health endpoint

- Request: `GET /api/phase2/health`
- Status: `200`
- Body:

```json
{ "ok": true, "phase": 2, "runtime": "nuxt-nitro" }
```

### Host guard rejection

- Request: `GET /api/phase2/health` with `Host: evil.example`
- Status: `403 Host header rejected`
- Body contains:
  - `statusCode: 403`
  - `statusMessage: Host header rejected`

### OCR/preview/anydoc probe

- Request: `POST /api/phase2/probe`
- Status: `200`
- Probe confirms in copied runtime:
  - PDF draft job created (`pageCount: 34`)
  - preview file generated/read (`previewBytes: 106939`)
  - first page markdown generated (`firstPageMarkdownChars: 576`)
  - anydoc conversion executed (`markdownChars: 35`)

## No fallback check

- Copied runtime executed from `/tmp/local-ocr-phase2-run` outside repository tree.
- Initial failure reproduced missing `pdf.worker.mjs` in copied output.
- Fix applied by Nitro trace include in `nuxt.config.ts`:
  - `node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`
  - `node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs`
- Rebuild + recopy showed worker files present under copied output and probe passed.

## After-action notes for Phase 3 handoff

- Host guard logic moved to tested helper module (`src/phase2/host-guard-utils.ts`) and validated with unit tests.
- Probe helpers moved to tested module (`src/phase2/probe-utils.ts`) to keep Nitro route focused and reduce regression risk.
- Probe route error messages sanitized to avoid leaking filesystem paths.
- Timeout wrappers added around PDF and anydoc probe operations to avoid unbounded hangs during gate checks.
- Probe fallback RTF now created in system temp path, not inbox, to avoid polluting user content directories.

## Captured temp artifacts

- `/tmp/local-ocr-phase2-health.headers`
- `/tmp/local-ocr-phase2-health.body`
- `/tmp/local-ocr-phase2-hostguard.headers`
- `/tmp/local-ocr-phase2-hostguard.body`
- `/tmp/local-ocr-phase2-probe.headers`
- `/tmp/local-ocr-phase2-probe.body`

## Result

Phase 2 copied-output runtime viability gate passed.
