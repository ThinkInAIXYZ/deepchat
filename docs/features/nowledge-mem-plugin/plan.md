# Implementation plan

- [x] Inspect plugin, renderer, exporter, MCP and upstream connection contracts.
- [x] Implement typed connection state, destination-bound secrets, verification and explicit import.
- [x] Add native HTTP official-plugin registration and shared credential resolution.
- [x] Add the Nowledge Skill package and plugin settings; route legacy configuration to it.
- [x] Connect REST exports and package the plugin for supported targets.
- [x] Review lifecycle, migration, authentication and credential boundaries.
- [x] Add focused regression protection after implementation and run relevant suites.
- [x] Run format, i18n, lint, typecheck and package validation; verify UI.
- [x] Document local verification and prepare the change for a PR targeting dev.


## Validation

- Main-process regression suites: 33 files, 527 tests passed, including actual HTTP MCP verification,
  destination-bound credentials, import, recovery, conversation exports and packaging contracts.
- Renderer suites: 5 files, 78 tests passed, including settings drafts, JSON IPC serialization,
  explicit export confirmation and existing official-plugin pages.
- Electron smoke: authenticated local REST/MCP, redacted state, failed credential replacement and
  disable/enable recovery passed against an isolated fixture; the rendered settings were inspected.
- Read-only live verification of the existing remote Mem passed through the new host connection
  service (REST authentication, MCP initialization and context read). The temporary probe was
  removed. No remote conversation was uploaded and no CLI/AI-tool configuration was changed.
- Format, i18n, lint, typecheck and the production build passed. Nowledge plugin packages were
  bundled and verified for all six supported OS/architecture combinations. Production builds
  refreshed the provider catalog and ACP registry.
- Manual checks for real server exports, connect-link issuance, migration from existing user
  settings and full application restart are documented in [verification.md](verification.md).
