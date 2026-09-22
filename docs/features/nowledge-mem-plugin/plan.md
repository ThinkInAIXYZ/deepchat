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

Run the focused commands in [verification.md](verification.md), plus format, i18n, lint and
production build checks. Cover the two-field settings form, HTTP LAN and HTTPS addresses with
optional keys, previous profile selection and credential retention, REST/MCP authentication,
export destination confirmation, plugin lifecycle recovery and packaging contracts.

Verified: 42 main-process files / 618 tests, 6 renderer files / 82 tests, and all three Electron
smoke tests. Format, i18n, lint, typecheck, production build, plugin validation and six-target
bundling passed. The rendered two-field form was inspected.
