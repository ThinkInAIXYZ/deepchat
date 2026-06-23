# CUA Driver Rs 0.6.5 Sync Plan

## Approach

Use the existing CUA release-asset staging pipeline. Only update the metadata consumed by that
pipeline and the reviewed plugin policy surface.

## Affected Files

- `plugins/cua/vendor/cua-driver/upstream.json`
- `plugins/cua/plugin.json`
- `plugins/cua/policies/tool-policy.json`
- `test/main/presenter/pluginPresenter.test.ts`

## Test Strategy

- Run the focused plugin presenter test suite.
- Run CUA runtime staging for the host target to verify download, checksum, extraction, and smoke
  check.
- Run project format, i18n, and lint commands before handoff.
