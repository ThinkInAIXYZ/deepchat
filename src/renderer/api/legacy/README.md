# Renderer Legacy Quarantine

`src/renderer/api/legacy/**` is the only allowed quarantine path for temporary renderer-main
legacy transport.

Rules:

- Only capability adapters may live here.
- Temporary calls to `useLegacyPresenter()`, `window.electron`, or `window.api` must stay in this path.
- Do not move business state, store ownership, or page-level orchestration into this directory.
- Do not create sibling quarantine directories such as `compat/`, `legacy2/`, or `v1/`.
- Keep this directory at `<= 3` source files. Additions are not allowed without updating the
  single-track baseline and merge gate.

Current retained files:

- `presenters.ts`: quarantine-only `useLegacyPresenter()` entry used by settings compatibility surfaces.
- `presenterTransport.ts`: legacy presenter reflection transport.
- `runtime.ts`: legacy `window.electron` / `window.api` runtime wrapper.

Delete condition:

- Remove this directory once the remaining settings compatibility surfaces no longer import
  `@api/legacy/presenters` or `@api/legacy/runtime`.

`P0` fixes this path. `P1+` may add adapters here while business modules are being migrated to
typed clients or runtime wrappers.
