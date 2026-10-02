# HTML preview isolation

## Scope and cause

Legacy HTML artifacts combined model-controlled `srcdoc` with `allow-scripts allow-same-origin`.
The frame inherited the app document's origin and could call the parent's native bridge. Built-in
artifact previews have already been retired; historical artifacts must remain literal source.

This change preserves that retirement and makes the remaining preview/native boundaries explicit.
It does not change image downloading, MCP installation deep links, updater trust, or MCP approval
semantics. It does not restore artifacts or introduce a general capability framework.

## Design

- Executable workspace previews load only from the registered `workspace-preview:` protocol, never
  from application-origin URLs, `srcdoc`, `data:`, or `blob:` documents. Preserve relative assets and
  ES modules by retaining the preview's own origin. Keep Chromium web security enabled in app windows.
- Broad preload APIs belong only to isolated top-level app documents. Navigation to an unrelated
  document must not expose them. Match exact app entry documents, including the configured development
  server, rather than accepting every file URL or every page on the development origin.
- Main-process IPC independently validates the live top-level sender and its document before
  dispatch. Preserve the splash language lookup and registered plugin settings' existing narrow
  routes without granting those documents the full application API.
- Sender checks are defense in depth, not a substitute for origin isolation: a same-origin child
  can call a parent's bridge, making the IPC sender appear to be the trusted parent.

No persistence migration, new user setting, dependency, or public route is required. Rollback is a
code revert only. Application documents remain trusted; this does not claim containment of arbitrary
JavaScript execution already inside the top-level application document.

## Acceptance

- HTML and SVG previews retain scripts, relative resources, and modules on their own preview origin,
  but cannot access the parent's DOM or native bridge.
- App-origin, inline, and malformed preview URLs never create executable preview frames.
- Unexpected documents and child frames cannot dispatch native app routes; normal chat, settings,
  splash, and scoped plugin settings flows continue to work.
- Browser-level tests exercise the isolation boundary rather than merely checking sandbox strings.

## Implementation and validation

- [x] Enforce preview document sources and Chromium same-origin checks; review and commit this slice.
- [x] Enforce preload and IPC document identity, preserving scoped callers; review and commit.
- [x] Run targeted regression tests and Electron isolation checks, including supported preview assets.
- [x] Complete P0–P3 and unnecessary-design review, format, i18n, lint, and typecheck.

Security test payloads use inert markers and read-only routes, not command execution or user data.
