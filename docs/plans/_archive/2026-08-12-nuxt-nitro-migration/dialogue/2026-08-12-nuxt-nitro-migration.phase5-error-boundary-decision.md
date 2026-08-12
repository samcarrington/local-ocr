# Phase 5 Error Boundary Decision

Date: 2026-08-12

## Decision

Nitro's native error envelope governs unsuccessful Nitro API responses. The
shared route boundary raises Nitro errors with the established status code,
safe status message, and legacy error object in `data`.

## Rationale

The legacy Express envelope, `{ "error": "message" }`, is not Nitro's native
response shape. Returning it directly instead of raising an H3 error suppresses
Nitro's standard error metadata and forces the new runtime to imitate legacy
behaviour. Aligning with Nitro preserves native framework semantics while
retaining status codes, sanitised unexpected failures, server-side logging, and
the legacy error object in `data`.

## Supersedes

This supersedes the Phase 5 plan and evidence statements requiring exact legacy
JSON error-envelope parity. URL and status-code compatibility remain Phase 5
requirements.
