# CUA Driver 0.6.7 Update Plan

## Release Source

Use the upstream GitHub release:

- Tag: `cua-driver-rs-v0.6.7`
- Commit: `2cba1e769264a18f5a9d5f4e419729eb7fc17962`
- Release URL: `https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.6.7`
- Published checksums are read from the release `checksums.txt` asset during build.

## Implementation

1. Update `plugins/cua/vendor/cua-driver/upstream.json`.
2. Update the CUA plugin manifest minimum version.
3. Update tests that lock the pinned upstream release metadata.
4. Keep `linux/arm64` unsupported until DeepChat has an explicit package/build matrix target for it.
5. Run the CUA bundle command for `darwin/x64` to verify the metadata and checksum path.

## Validation

- `pnpm run plugin:bundle -- --name cua --platform darwin --arch x64`
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- focused CUA tests
- `pnpm run typecheck`
