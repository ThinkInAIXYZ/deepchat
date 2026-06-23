# CUA Sidecar-Only Runtime Plan

## Approach

Update the CUA plugin MCP server declaration to pass `--no-daemon-relaunch` after the `mcp`
subcommand and set `CUA_DRIVER_RS_MCP_NO_RELAUNCH=1` in the server environment. Keep
`CUA_DRIVER_MCP_MODE=1` and the existing DeepChat runtime path variables unchanged.

Mirror the same declaration in the standalone MCP preset JSON so future consumers do not drift from
the official plugin manifest.

Extend `scripts/package-plugin.mjs` CUA validation to enforce the no-relaunch argument and
environment variable. Update package plugin tests to use the stricter fixture and cover rejection of
daemon-relaunch-enabled manifests.

## Affected Files

- `plugins/cua/plugin.json`
- `plugins/cua/mcp/cua-driver.json`
- `scripts/package-plugin.mjs`
- `test/main/scripts/packagePlugin.test.ts`

## Compatibility

The change relies on upstream `cua-driver 0.5.5`, whose bundled help advertises both
`--no-daemon-relaunch` and `CUA_DRIVER_RS_MCP_NO_RELAUNCH=1`. Runtime detection, platform targets,
tool policies, and plugin visibility remain unchanged.

## Test Strategy

- Run the package plugin unit test for CUA manifest packaging validation.
- Run required repository hygiene commands: `pnpm run format`, `pnpm run i18n`, and
  `pnpm run lint`.
