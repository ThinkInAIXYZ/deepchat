# Plugins Hub Implementation Plan

## Strategy

Do not build a new plugin platform and do not add a new window. Move the UI ownership boundary into
the existing main window.

The smallest reliable implementation is:

- Add `/plugins` routes to the existing main renderer router.
- Keep `WindowSideBar` and `AppBar` as the app shell around the Plugins page.
- Reuse current clients/stores/components where they already own behavior.
- Treat Remote channels as renderer-only virtual plugin cards backed by existing `remoteControl.*` routes.
- Hide Settings navigation entries for Plugins-owned areas, while keeping compatibility redirects.
- Update the main sidebar expanded layout only; keep collapsed behavior unchanged.

No data migration is required.

## Main Route Architecture

```text
Main window
  App.vue
    AppBar
    WindowSideBar
    RouterView
      /chat      -> ChatTabView
      /welcome   -> WelcomePage
      /plugins   -> PluginsHubPage
         /plugins
         /plugins/skills
         /plugins/mcp
         /plugins/:pluginId
```

Use the existing `src/renderer/src/router/index.ts`. Do not add `src/renderer/plugins`, a new Vite
entry, or a new BrowserWindow.

Route names can be:

```text
plugins
plugins-skills
plugins-mcp
plugins-detail
```

External/main-process callers should not know UI component internals. Reuse the existing app-runtime event path where possible. Only add a narrow route if a future main-process caller needs generic main-window navigation:

```text
system.openMainRoute({ routeName: 'plugins-mcp', params? }) -> { focused: boolean }
```

For the first increment, MCP install deeplinks reuse `DEEPLINK_EVENTS.MCP_INSTALL` and the main app deeplink handler routes the renderer to `/plugins/mcp`. Do not add a Plugins-specific window route.

## Affected Boundaries

| Boundary | Required change |
| --- | --- |
| `src/renderer/src/router/index.ts` | Add `/plugins` route family |
| `src/renderer/src/App.vue` | Keep existing shell; ensure `/plugins` receives same global overlays/theme/i18n |
| `WindowSideBar.vue` | Add expanded command list and route Plugins row to `/plugins` |
| `renderer/api` | Reuse existing clients; add a main-window navigation client only if a generic main-process caller appears |
| `shared/contracts/routes` | Add narrow focus/navigate route only if deeplink/main process cannot use existing event path |
| Settings renderer | Remove/hide Plugins-owned nav entries and overview links |
| Deeplink presenter | Route MCP install deeplink to main `/plugins/mcp` page |
| Plugin presenter | Stop using per-plugin BrowserWindow as primary UI path |

## Data Ownership

Do not create a persisted unified plugin table.

Use a renderer-only union for cards:

```text
CatalogItem =
  official plugin item from plugins.list
  Remote virtual item from remoteControl.listChannels + status
```

`MCP` and `Skills` are top-level sibling tabs under `/plugins`, not catalog cards. This union only drives plugin catalog rendering and search filtering. Writes go back to the current owner:

| User action | Owner route/client |
| --- | --- |
| Enable official plugin | `PluginClient.enablePlugin` |
| Disable official plugin | `PluginClient.disablePlugin` |
| CUA runtime/permission action | `PluginClient.invokeAction` existing runtime actions |
| MCP add/edit/toggle | `McpClient` / `useMcpStore` existing paths |
| Skill install/edit/delete/sync | `SkillClient` / `SkillSyncClient` / `useSkillsStore` |
| Remote enable/save/pair/remove binding | `RemoteControlClient` |

## Page Shell

Create the Plugins UI under the existing renderer:

```text
src/renderer/src/pages/plugins/
├── PluginsHubPage.vue
├── PluginsCatalogPage.vue
├── OfficialPluginDetailPage.vue
├── McpPluginsPage.vue
├── SkillsPluginsPage.vue
├── components/
│   ├── PluginsTopTabs.vue
│   ├── PluginCatalogGrid.vue
│   ├── PluginCatalogCard.vue
│   ├── AddedPluginsStrip.vue
│   └── PluginSearchBar.vue
└── composables/
    ├── usePluginCatalog.ts
    └── useRemotePluginItems.ts
```

Keep this list flexible during implementation; do not split files unless the component becomes hard to read.

Visual baseline:

- Main content starts with top tabs (`Plugins`, `Skills`, `MCP`).
- Catalog page uses the Codex-like layout: title, subtitle, search, added strip, segmented filters, sectioned list.
- Catalog cards include official plugins and Remote virtual plugins; MCP and Skills remain reachable through top tabs.
- Remote does not have a top tab or product list route. Each channel opens as a virtual plugin detail.
- Avoid settings-style full-width form pages for the catalog. Detail routes may use denser settings sections.
- Cards are individual repeated items only. Do not put page sections inside floating cards.

## Route and Navigation Behavior

Renderer-side navigation:

| Trigger | Behavior |
| --- | --- |
| Sidebar `Plugins` row | `router.push({ name: 'plugins' })` |
| Top tab `Skills` | `router.push({ name: 'plugins-skills' })` |
| Top tab `MCP` | `router.push({ name: 'plugins-mcp' })` |
| Plugin card/detail | `router.push({ name: 'plugins-detail', params: { pluginId } })` |
| Remote channel card/detail | `router.push({ name: 'plugins-detail', params: { pluginId: 'remote:<channel>' } })` |
| `New Chat` row while on `/plugins` | `router.push({ name: 'chat' })`, then start new conversation |

Main-process initiated navigation:

- MCP install deeplink must focus the main window and route to `/plugins/mcp`.
- Historical Settings route redirects can focus main and route to the matching `/plugins...` route.
- If the main window does not exist, create/focus the normal app window, not a Plugins window.

## Official Plugin Detail

Current behavior opens `PluginPresenter.openPluginSettingsWindow(pluginId)`.

Target behavior:

- List page opens `/plugins/:pluginId`.
- Detail page loads `plugins.get(pluginId)`.
- Enable/disable remains in detail and list.
- Runtime status and MCP status remain visible.
- Known first-party plugin actions are exposed as native detail sections:
  - `runtime.getStatus`
  - `runtime.checkPermissions`
  - `runtime.openPermissionGuide`

Do not add a generic embedded HTML settings host in the first increment. Current shipped plugins are first-party (`cua`, `feishu`), so native Vue detail pages are enough and safer than enabling arbitrary webview/iframe behavior.

Legacy fallback:

- Keep `settingsContributions` in manifests during migration.
- Keep `settings.open` action available only as a temporary compatibility path if some old package still calls it.
- The first-party UI must not call `settings.open`.

When to add a generic plugin settings host:

- Only when third-party plugin settings contributions are a supported product requirement.
- Use an isolated child WebContents/WebContentsView with the plugin-specific preload, not an iframe without preload.
- Keep external navigation denied.

## MCP Migration

`McpSettings.vue` already owns most behavior. Move by reuse, not rewrite.

Recommended first pass:

- Create `McpPluginsPage.vue`.
- Import/reuse `McpServers`, `McpBuiltinMarket`, NPM registry controls, guide overlay only if still needed.
- Preserve current route query shape for market view inside Plugins (`/plugins/mcp?view=market`).
- Move deeplink handler from Settings bootstrap to main app or Plugins page bootstrap for MCP install.

Compatibility:

- `deepchat://mcp/install` focuses main window and routes to `/plugins/mcp`.
- Hidden `settings-mcp` route can redirect/open main `/plugins/mcp` during transition.

Settings cleanup:

- Remove visible `settings-mcp` navigation item.
- Remove MCP Overview metric.
- Remove `start-mcp` quick task or replace it with a non-Plugins Settings task.

## Skills Migration

`SkillsSettings.vue` can become a Plugins page with minimal changes:

- Rename/wrap visually as `SkillsPluginsPage`.
- Keep `SkillCard`, `SkillInstallDialog`, `SkillEditorSheet`, `SkillSyncDialog`, `SyncStatusSection`.
- Keep draft suggestion toggle.
- Keep first-launch sync prompt if product still relies on it.

Avoid duplicating the skills store or install logic.

Compatibility:

- Hidden `settings-skills` route should route the main window to `/plugins/skills`.
- Settings Overview search should not list Skills.

## Remote Migration

First increment: reuse `RemoteSettings.vue` inside `/plugins/:pluginId` for virtual plugin ids such as `remote:telegram`. The detail shell owns the plugin-style enable/disable button, while single-channel mode hides the old Remote tab strip and the embedded channel toggle. Feishu/Lark Integration uses the same hide-toggle mode so its top-level plugin enable button controls both the official plugin and Feishu/Lark Remote. This keeps the existing credential, pairing, default agent/workdir, bindings and WeChat iLink behavior intact.

Follow-up refactor: extract channel sections from `RemoteSettings.vue` into reusable components. The file is already large, but splitting it before moving the route would increase regression risk and delay the user-visible entry-point cleanup.

Refactor only around real channel boundaries:

```text
PluginsCatalogPage
  -> virtual cards from listRemoteChannels()
PluginDetailPage(remote:<channel>)
  -> channel header/status/toggle
  -> credentials section
  -> default agent/workdir section
  -> pairing section when supportsPairing
  -> bindings section
  -> channel-specific section
```

Suggested extracted components:

| Component | Scope |
| --- | --- |
| `RemotePluginCard` | card summary for one channel |
| `PluginDetailPage(remote:<channel>)` | detail shell and save status |
| `RemoteCredentialsSection` | token/app secret fields; channel-specific props |
| `RemoteDefaultsSection` | default agent and default workdir |
| `RemotePairingSection` | pair code and principals for pairable channels |
| `RemoteBindingsSection` | bound chats/groups/topics |
| `WeixinIlinkAccountsSection` | WeChat iLink login/account controls |

Keep shared logic tiny:

- load channel settings
- save channel settings
- load channel status
- load bindings/pairing

Do not invent a generic form schema for all channels.

Virtual item mapping:

```text
remote:<channel id>
  kind: remote
  title: channel title + ' Remote' when needed
  description: descriptor.descriptionKey
  enabled: status.enabled
  state: status.state
  detailRoute: /plugins/:pluginId
```

## Settings Removal and Redirects

Change visible navigation source:

- Remove or mark hidden:
  - `settings-mcp`
  - `settings-remote`
  - `settings-plugins`
  - `settings-skills`

Because `settingsNavigation.ts` is the single source for Settings sidebar and Overview search, this should remove most visible Settings entries without scattered conditions.

Route compatibility options:

1. Keep hidden route items so old route names still exist.
2. When entered, focus main window and navigate to the mapped `/plugins...` route.
3. Do not show these items in Settings sidebar/search.

Mapping:

| Old Settings route | Main window target |
| --- | --- |
| `settings-mcp` | `/plugins/mcp` |
| `settings-remote` | `/plugins` |
| `settings-plugins` | `/plugins` |
| `settings-skills` | `/plugins/skills` |

`settings-acp` stays in Settings for this feature. ACP is an agent/provider configuration surface, not part of the four requested Plugins-owned areas.

## Sidebar Implementation Plan

Current `WindowSideBar.vue` should not be rewritten. Modify the expanded right column header area.

Before:

```text
right column
├── header row: selectedAgentName + group toggle + plus
├── search input
├── pinned section
└── session groups
```

After:

```text
right column
├── title row: selectedAgentName
├── command list
│   ├── New Chat
│   ├── Search
│   └── Plugins
├── blank spacer
├── pinned section when non-empty
├── Chat group
├── 工作区 header + existing group-mode/sort toggle
└── project groups
```

Command behavior:

| Row | Existing behavior to call |
| --- | --- |
| New Chat | `router.push({ name: 'chat' })` then `sessionStore.startNewConversation({ refresh: true })` |
| Search | `spotlightStore.toggleSpotlight()` |
| Plugins | `router.push({ name: 'plugins' })` |

Keep:

- Agent icon rail.
- Settings/theme/sidebar controls in the existing left rail.
- collapsed width and transitions.
- session pagination and fill checks.
- pinned collapse behavior.
- project grouping/reorder behavior.
- existing group-mode/sort behavior, moved to the `工作区` header.
- shortcut badge logic for sessions.

Question the old inline session search:

- First increment should remove the inline search input from expanded sidebar to match the requested command-list shape.
- Search row opens Spotlight, which already searches sessions/messages/settings/actions.
- If users later need local-only filtering, add it inside Spotlight or as a session-list filter command, not as a second persistent input.

Right column ordering:

```text
所有 Agents

New Chat
Search
Plugins

Pinned (only if any)
...
Chat
...
工作区                                      [group/sort toggle]
project groups
...
```

Do not add Settings, theme, collapse, remote status or other rail controls into this right column.

## Deeplinks and External Entry Points

Update callers:

| Current caller | New behavior |
| --- | --- |
| MCP install deeplink | focus main window, route to `/plugins/mcp`, dispatch MCP install event there |
| Settings sidebar old MCP/Skills/Plugins/Remote | no visible entry |
| Settings activity old route | focus main window and route to matching `/plugins...` page |
| Sidebar remote status button | route to the first enabled `remote:<channel>` plugin detail |
| Chat input MCP indicator `openSettings` text | route to `/plugins/mcp` |

Provider install deeplink stays in Settings Provider. Do not route provider/model setup to Plugins.

## i18n

Add route/page labels:

- `routes.plugins`
- `pluginsHub.title`
- `pluginsHub.subtitle`
- `pluginsHub.searchPlaceholder`
- `pluginsHub.tabs.plugins`
- `pluginsHub.tabs.skills`
- `pluginsHub.tabs.mcp`
- `pluginsHub.tabs.remote`
- sidebar command labels if existing `common.newChat` and spotlight labels are not enough.

Avoid moving existing `settings.mcp`, `settings.skills`, `settings.remote` keys in the first increment. Reuse them from Plugins pages to keep the diff smaller. Later cleanup can rename namespaces if the old naming becomes misleading.

## Testing Strategy

Small checks with high signal:

| Area | Tests |
| --- | --- |
| Main router | `/plugins` and child routes render inside app shell |
| Settings navigation | removed entries do not appear in `getSettingsNavigationGroups`; hidden redirects still resolve |
| Sidebar | expanded command rows render; collapsed state unchanged; Plugins row routes to `/plugins` |
| Remote virtual items | descriptors + status produce cards; detail saves via `remoteControl.saveChannelSettings` |
| Official plugin detail | list/detail enable-disable; settings button no longer calls `settings.open` |
| Deeplink | MCP install focuses main and routes to `/plugins/mcp` |

Manual visual QA:

- macOS light/dark with app sidebar and main content.
- Windows light/dark with main app shell.
- Linux opaque backgrounds.
- Narrow width with collapsed and expanded sidebar.
- Long remote token/error/path strings.
- Chinese and English labels.

Final implementation gates:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```

Renderer tests should be run for touched components. Full app smoke test should open Chat, Plugins and Settings separately.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Settings routes are used by deeplinks/onboarding | Keep hidden compatibility routes and redirect to main `/plugins...` |
| RemoteSettings monolith makes migration risky | Reuse it in single-channel mode; extract per-channel sections only when needed |
| Plugin settings HTML depends on plugin preload | Do not embed arbitrary HTML in first increment; build first-party native details |
| Feishu official plugin vs Feishu Remote naming collision | Merge Feishu Remote into the Feishu/Lark Integration detail page |
| Plugins page becomes another Settings | Catalog page stays Codex-like; detail pages are dense only where settings are unavoidable |
| Main route conflicts with chat internal `pageRouter` | Use Vue router for `/plugins`; keep `pageRouter` scoped to ChatTabView |
| Search behavior confusion | Sidebar Search row opens existing Spotlight; do not add a new search engine |

## Rollout Plan

1. Land `/plugins` main route skeleton with top tabs and catalog placeholder.
2. Move visible Settings entries out, with redirects to main Plugins routes.
3. Move MCP page and deeplink.
4. Move Skills page.
5. Add official plugin native list/detail and stop first-party UI from opening plugin settings windows.
6. Add Remote virtual plugin list/detail.
7. Update main sidebar expanded command list.
8. Run visual QA and clean up i18n/tests.

This order keeps each PR reviewable and avoids breaking every surface at once.
