# Phase 6 Runtime Configuration Evidence

Date: 2026-08-12

## Governing decision

All retained listener entry points, including the legacy Express compatibility
server, exclusively use `NITRO_HOST` and `NITRO_PORT`. YAML remains limited to
OCR and storage configuration. Existing YAML `host` and `port` inputs are
ignored with one process-level deprecation warning for this release.

This avoids two competing listener configuration sources while allowing
existing configuration files to remain usable during the transition. Keeping
YAML listener ownership was rejected because it would conflict with Nitro's
runtime contract. This supersedes the delivery plan's implicit assumption that
the preserved Express entry point could retain independent listener ownership.

## Development watcher decision

Nuxt development mode uses the builder watcher, with Vite configured to
allow-list `app/`, `server/`, `shared/`, and `src/`. This prevents generated
and runtime-only directories from exhausting file-watch descriptors while
retaining discovery of Nitro routes. Using Nuxt's `ignore` setting was rejected
because it also suppresses route discovery.

## Delivered artefacts

- `server/plugins/config.server.ts` loads and validates YAML as Nitro starts.
- `server/core/config.ts` removes the deprecated listener keys before strict
  domain validation and emits a single compatibility warning per process.
- `ocrtool.config.example.yaml`, `README.md`, and package scripts describe the
  Nitro-owned listener configuration.
- `nuxt.config.ts` selects the builder watcher and applies the Vite source-tree
  allow-list; `src/nuxt-watch.ts` provides its path predicate.

## Validation

- `pnpm test:server` passed: 14 files, 131 tests, including deprecated-key
  compatibility and one-warning assertions.
- `pnpm test:src` passed: 4 files, 38 tests.
- `pnpm exec tsc --noEmit` passed.
- `pnpm build:nuxt` passed with the startup plugin included.
- A copied `.output` server started with `NITRO_HOST=127.0.0.1` and
  `NITRO_PORT=14005`; `GET /api/phase2/health` returned
  `{"ok":true,"phase":2,"runtime":"nuxt-nitro"}`.
- The same copied runtime with `nativeTextMinChars: invalid` in YAML terminated
  at startup with `Invalid input: expected number, received string`.
- `pnpm dev` initially reproduced `EMFILE: too many open files, watch` because
  the repository source root included 31,561 `.build-cache` files. After the
  builder-watcher change, the server started on port 14005, returned the Phase
  2 health response, and emitted no watcher errors.
