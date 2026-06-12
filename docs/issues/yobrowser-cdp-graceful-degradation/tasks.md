# Tasks

- [x] Review GitHub issue #1734 and confirm the requested graceful-degradation
      direction.
- [x] Inspect the current YoBrowser CDP call path and agent tool error
      propagation.
- [x] Write SDD spec, plan, and task breakdown before code changes.
- [x] Define the YoBrowser recoverable error contract in the smallest suitable
      module.
- [x] Map unavailable-browser `cdp_send` failures to the recoverable
      `yobrowser_unavailable` error.
- [x] Propagate the recoverable error as an errored agent tool result with
      structured model-visible content.
- [x] Add focused unit tests for YoBrowser handler behavior and agent runtime
      propagation.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
