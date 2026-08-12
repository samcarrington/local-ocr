# Scope Statement: Nuxt/Nitro Migration

## Topic

Nuxt/Nitro migration for local-ocr runtime unification.

## Objectives

- Replace Express plus static frontend with one Nuxt 4 full-stack runtime.
- Preserve current API and OCR workflow behavior.
- Preserve Hallmark UI behavior and accessibility semantics.
- Keep runtime security controls for local-only serving.

## Success criteria

- Production runs with `pnpm build` and `pnpm start` using `node .output/server/index.mjs`.
- Listener defaults to `127.0.0.1:4312`; non-loopback bind host is rejected.
- Host header validation allows only loopback host forms.
- Existing API contracts remain stable for status, payloads, and error shape.
- Preview serving enforces realpath containment and safe file checks.
- Vue frontend preserves current behavior and parity on desktop/mobile.
- Legacy Express/static stack removed only after parity test gates pass.

## In scope

- Nuxt scaffolding and Nitro route implementation.
- Mechanical domain module move from `src/` to `server/`.
- Service extraction from API orchestration.
- Runtime config migration to `NITRO_HOST` and `NITRO_PORT`.
- Frontend port from static JS to Vue components/composables.
- Test and verification updates for unit, integration, component, and e2e.
- Removal of legacy architecture after verification gate.

## Out of scope

- Dockerization of local model servers.
- New OCR engine features unrelated to migration parity.
- New markdown capability expansion beyond existing safe subset.
- Product feature changes unrelated to framework migration.

## Constraints

- Preserve URL paths and API contract shape exactly.
- No `v-html`; markdown rendered via typed Vue nodes.
- No regression in rerun/accept/commit/discard semantics.
- Keep Python model servers external to Nuxt runtime.
- Use pnpm only.

## Assumptions and information debt

- Objectives are explicit in current plan and user request.
- Success criteria were made explicit from existing plan intent and confirmed for execution.

## Top risk

Nitro build output may externalize or miss OCR/runtime assets when copied outside the repo, causing production-only failures.

## Chosen engagement depth

Deep planning, staged by phase gates and contract-first verification.

## Approach

Contract-first migration with early runtime proof, then mechanical moves, service extraction, route parity, frontend parity, and controlled legacy removal.
