# Changelog

## 0.3.0 — 2026-09-15

- Targets Node.js 22+ and Bun with NodeNext-compatible package output.
- Reads direct post JSON and returns article `body_html`; archive summaries hydrate before full metadata/content access.
- Adds cookie-jar authentication with domain/path/secure/expiry scoping and awaited cookie-file readiness through `Auth.create()` or `ready()`.
- Handles bounded archive pagination, short pages, true EOF, and client-side podcast media filtering with an explicit scan bound.
- Preserves the existing exported classes, static `substack` facade, and snake_case methods while retaining unknown wire metadata.
- Paid-post access remains controlled by Substack; authenticated behavior and entitlement were not independently verified with a real paid session.
