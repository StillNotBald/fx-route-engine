# Security Policy

## Reporting a vulnerability

Email **hello@stillnotbald.com** with details and reproduction steps. Please do not open a public issue for security reports. This is a reference implementation shared as-is: there is no SLA, but reports are read and acknowledged on a best-effort basis.

## Scope

- The engine in `src/core` (arithmetic correctness counts: a wrong number that could mislead a decision is a valid report).
- The read-only source adapters in `src/adapters` (request handling, parsing of untrusted responses, timeouts).

## Security model

- The engine makes outbound GET requests only, to public APIs that need no key. It holds no credentials and stores nothing.
- Responses from sources are untrusted input. A source that returns garbage must be rejected or fail visibly, never silently shown (outlier rejection and per-call timeouts exist for this).
- The engine never moves money.

## Not a security boundary

Nothing in this repository is financial, legal or tax advice. Do not run it against production money flows without your own review.
