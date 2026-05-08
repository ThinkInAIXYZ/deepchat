# Plan

## Source Review

- Compare upstream `trycua/cua` tags `cua-driver-v0.1.4` and
  `cua-driver-v0.1.5`.
- Confirm whether `libs/cua-driver/Skills/cua-driver` changed.
- Review local fork differences before applying upstream changes.

## Implementation

- Cherry-pick the small upstream source changes into
  `plugins/cua/vendor/cua-driver/source`.
- Update `plugins/cua/vendor/cua-driver/upstream.json` to record
  `cua-driver-v0.1.5`.
- Leave packaged `plugins/cua/skills/cua-driver` MCP-first guidance intact
  unless upstream skill files changed.

## Validation

- Run `pnpm run format`.
- Run `pnpm run i18n`.
- Run `pnpm run lint`.
- Run `pnpm run plugin:cua:validate`.

## Risk

The driver source is a maintained local fork, so direct upstream replacement
would risk losing DeepChat packaging, permissions, and MCP behavior. A focused
manual cherry-pick keeps the change auditable.
