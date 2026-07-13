# CUA Driver 0.7.1 Update

## Issue

DeepChat pins the bundled CUA runtime to `cua-driver-rs v0.6.7`, while upstream now publishes
`cua-driver-rs v0.7.1`. Packaged users cannot update DeepChat's managed helper through their own
PATH-installed `cua-driver`, so the bundled runtime metadata, minimum version, and tool policy need
to track the latest verified upstream release.

GitHub issue: https://github.com/ThinkInAIXYZ/deepchat/issues/1898

## Impact

- Packaged CUA can report itself stale even though the user cannot update the bundled helper.
- New read-only desktop capture support in `v0.7.1` is unavailable unless the policy allows it.
- Obsolete tool names remain in the allowlist/asklist if the policy is not synced.

## Root Cause

The official CUA plugin consumes pinned GitHub release assets from
`plugins/cua/vendor/cua-driver/upstream.json`. The pin and conservative tool policy are still based
on `cua-driver-rs-v0.6.7`.

## Fix Plan

- Update the pinned upstream metadata to `cua-driver-rs-v0.7.1`.
- Keep the existing DeepChat target matrix unchanged.
- Update the plugin runtime `minVersion`.
- Sync CUA tool policy with the `cua-driver 0.7.1 list-tools` output.
- Update the maintained CUA cross-platform contract docs.
- Run focused CUA checks plus required format, i18n, and lint commands.

## Tasks

- [x] Update release metadata and plugin minimum version.
- [x] Sync CUA policy and tests with the v0.7.1 tool surface.
- [x] Update maintained SDD contract docs.
- [x] Validate plugin runtime staging for representative targets.
- [x] Run required repository checks.

## Validation

- `pnpm exec vitest run test/main/presenter/pluginPresenter.test.ts`
- `pnpm run plugin:cua:build:mac:arm64`
- `pnpm run plugin:cua:build:win:x64`
- `pnpm run plugin:cua:build:linux:x64`
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
