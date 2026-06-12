# Plan

## Source Review

- Compare upstream `trycua/cua` tags `cua-driver-v0.1.5` and
  `cua-driver-v0.2.0`.
- Apply the Swift driver delta with a three-way merge against DeepChat's
  maintained fork.
- Keep upstream Rust driver changes out of this sync.

## Implementation

- Merge upstream Swift runtime changes into
  `plugins/cua/vendor/cua-driver/source`.
- Adapt new upstream TCC, doctor, and MCP daemon-proxy text and commands to
  `DeepChat Computer Use.app` and `com.wefonk.deepchat.computeruse`.
- Preserve DeepChat-only CLI behavior: `deepchat-permission-probe`, nonblocking
  MCP startup, and DeepChat-managed `update`.
- Update `plugins/cua/vendor/cua-driver/upstream.json` to `cua-driver-v0.2.0`.
- Leave packaged skills unchanged unless validation shows upstream skill content
  changed in the Swift release.

## Validation

- Run `swift build --package-path plugins/cua/vendor/cua-driver/source --product cua-driver`.
- Run `pnpm run format`.
- Run `pnpm run i18n`.
- Run `pnpm run lint`.
- Run `git diff --check`.
- Run `pnpm run plugin:cua:build:mac:arm64`.
- Run `pnpm run plugin:validate -- --name cua --platform darwin --arch arm64`.

## Risk

The vendored driver is a local fork with DeepChat-specific TCC and packaging
behavior. A direct replacement with upstream source would risk regressing the
helper identity, permission flow, and plugin-managed update path, so the sync is
kept as an explicit fork merge.
