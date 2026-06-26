# Tasks

- [x] Inspect existing remote Feishu/Lark settings, runtime, storage, routes, and tests.
- [x] Review initial Feishu OAuth callback approach and preserve it as a fallback.
- [x] Investigate Kun's Feishu/Lark install flow and identify the PersonalAgent app registration endpoint.
- [x] Update spec and plan to make official PersonalAgent install the primary setup path.
- [x] Add shared install session/result types and typed route contracts.
- [x] Implement Feishu/Lark PersonalAgent registration helper in main process.
- [x] Add RemoteControlPresenter start/wait/cancel install methods and route dispatch.
- [x] Add renderer API client methods.
- [x] Split Feishu/Lark install UI into web-page install and in-app QR install buttons.
- [x] Generate an in-app QR code directly from the returned install URL.
- [x] Combine Feishu/Lark `/pair` and OAuth scan authorization guidance in the UI.
- [x] Add or update i18n keys for web install, QR install, and combined authorization guidance.
- [x] Add or update renderer tests for the two install modes and combined authorization guidance.
- [x] Fix review findings for Feishu/Lark auth/install cancellation, timeout, and late async side effects.
- [x] Add regression tests for cancelling in-flight OAuth auth and PersonalAgent install polling.
- [x] Run targeted tests, format, i18n, and lint.
