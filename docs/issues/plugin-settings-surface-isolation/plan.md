# Plugin Settings Surface Isolation Plan

## Implementation Approach

- Show the plugin settings action whenever the plugin list item exposes a settings contribution,
  regardless of whether the plugin is currently enabled.
- Remove the enablement guard from the dedicated plugin settings window flow.
- In development, prefer workspace plugin directories over user-data installation directories when
  discovering official plugins so stale local installs cannot mask newer settings metadata.
- In development, re-copy workspace directory plugins into userData installs during activation so
  script-only fixes land even when `plugin.json` is unchanged.
- Treat an installed official plugin as stale when its hydrated manifest differs from the current
  official manifest, even if the version string is unchanged.
- Preserve plugin-local `config.json` when reinstalling a stale official plugin so credentials do
  not disappear during self-healing.
- When discovery rejects an installed official plugin as unsupported or untrusted, remove the
  persisted installation record and disable plugin-owned MCP servers, settings resources, and tool
  policies before initialization tries to reactivate them.
- Keep Feishu's MCP bootstrap self-contained with only Node builtins in the installed entrypoint,
  and use a built-in stdio warning responder when credentials are missing.
- Clear the Feishu settings page message banner on non-error MCP states so prior failures do not
  linger after recovery.
- Pin the Feishu `npx` package invocation and only pass through an explicit registry override from
  the environment.
- Replace Feishu's blanket MCP auto-approval with an empty default allowlist.
- Resolve settings contributions from the current official manifest instead of trusting an older
  installed manifest copy, while still reusing installed file paths when those assets exist.
- Resolve plugin settings contributions from the installed plugin manifest when stored plugin
  resource records are absent or no longer point to valid files.
- Materialize packaged official plugin assets on demand when a settings contribution exists but no
  installed plugin directory is available yet.
- Reuse the same resolved settings contribution for plugin list serialization and for opening the
  dedicated plugin settings window.
- Filter plugin-owned MCP servers out of the existing global MCP settings renderer so plugin MCP
  remains a plugin-local concern while existing built-in and user-managed MCP behavior stays
  unchanged.

## Affected Areas

- `src/main/presenter/pluginPresenter/index.ts`
- `plugins/feishu/settings/assets/index.js`
- `plugins/feishu/mcp/serve.mjs`
- `plugins/feishu/plugin.json`
- `src/renderer/src/components/mcp-config/components/McpServers.vue`
- Focused presenter and renderer regression tests

## Test Strategy

- Add a renderer regression test covering a disabled plugin that still shows the settings action.
- Add a main-process regression test covering plugin settings availability and opening when stored
  resources are missing.
- Add a main-process regression test covering opening settings for a disabled packaged plugin.
- Add a main-process regression test covering startup self-heal for stale same-version installs.
- Add a main-process regression test covering dev-directory sync when only plugin files changed.
- Add a main-process regression test covering cleanup when discovery rejects a persisted official
  plugin installation.
- Add a regression assertion that the Feishu installed MCP bootstrap does not statically import host
  SDK packages.
- Add focused Feishu regression assertions for the pinned bootstrap package version, registry
  override behavior, safer auto-approve defaults, and stale settings error clearing.
- Add a renderer regression test covering plugin-owned MCP servers being hidden from the global MCP
  settings list.

## Risks

- Low to moderate. Manifest fallback must only return settings entries whose installed files exist,
  or the UI could expose an unusable settings action.
