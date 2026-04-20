# Renderer Legacy Quarantine

`src/renderer/api/legacy/**` is the only allowed quarantine path for temporary renderer-main
legacy transport.

Rules:

- Only capability adapters may live here.
- Temporary calls to `usePresenter()`, `window.electron`, or `window.api` must stay in this path.
- Do not move business state, store ownership, or page-level orchestration into this directory.
- Do not create sibling quarantine directories such as `compat/`, `legacy2/`, or `v1/`.

`P0` fixes this path. `P1+` may add adapters here while business modules are being migrated to
typed clients or runtime wrappers.
