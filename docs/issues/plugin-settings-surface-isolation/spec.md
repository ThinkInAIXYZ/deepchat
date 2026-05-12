# Plugin Settings Surface Isolation

## User Need

As a user enabling the Feishu plugin, I need an immediate settings entry on the plugin card so I can
configure the plugin, and I need the plugin-owned MCP server to stay inside the plugin experience
instead of being mixed into the existing global settings or MCP settings surfaces.

## Acceptance Criteria

- Plugins with a declared settings contribution expose their settings action even while disabled so
  users can configure required credentials before enabling the plugin.
- Plugin settings contributions still resolve when an older installed plugin copy lags behind the
  current official manifest metadata.
- In development, when a workspace plugin and an installed plugin directory share the same official
  plugin id, settings metadata resolves from the workspace plugin before the stale installed copy.
- Official plugins reinstall when a same-version installed copy is stale, so outdated MCP entrypoints
  cannot survive on version equality alone.
- In development, official plugin directory installs stay synchronized with workspace files even when
  only non-manifest files changed.
- Enabling an official plugin with a declared settings contribution exposes the plugin settings
  action on the Plugins settings page without depending on previously persisted resource records.
- Opening plugin settings still works when persisted plugin resource records are missing or stale,
  as long as the installed plugin manifest still declares a valid settings contribution.
- Reinstalling a stale official plugin preserves plugin-local configuration such as `config.json`.
- Plugin-owned MCP entrypoints remain runnable after installation into userData and must not rely on
  static imports from the workspace or app-level `node_modules`.
- Global MCP settings do not render plugin-owned MCP servers identified by `source: plugin`.
- Plugin-owned MCP runtime status remains available from plugin-specific settings/status surfaces.

## Constraints

- Keep plugin-owned MCP server configs in the existing MCP config store for runtime compatibility.
- Preserve the existing plugin settings window flow and plugin manifest contract.
- Packaged official plugins may need to materialize their settings assets before the plugin is
  enabled so the settings window can load from a real file path.

## Non-goals

- Redesigning plugin installation, runtime detection, or plugin settings UX.
- Changing core MCP lifecycle behavior beyond renderer visibility for plugin-owned servers.

## Open Questions

None.
