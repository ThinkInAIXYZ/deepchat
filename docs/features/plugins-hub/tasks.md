# Plugins Hub Tasks

## 0. Review Gate

- [ ] Review `spec.md` with product/maintainers.
- [ ] Review `plan.md` main-route architecture, route compatibility, and sidebar layout.
- [ ] Confirm no unresolved clarification markers exist before implementation.
- [ ] Keep this SDD folder active until the feature lands or is deliberately abandoned.

## 1. Main Route Skeleton

- [ ] Add `/plugins` route family to the existing main renderer router.
- [ ] Add `PluginsHubPage.vue` inside `src/renderer/src/pages/plugins/`.
- [ ] Add top tab navigation for Plugins, Skills, MCP and Remote or the chosen first-increment subset.
- [ ] Add Codex-like catalog placeholder with title, subtitle, search, added strip and featured sections.
- [ ] Keep `WindowSideBar`, `AppBar`, global overlays, theme and i18n behavior intact.
- [ ] Add i18n keys for route, page title, subtitle, tabs and search placeholder.
- [ ] Add renderer tests proving `/plugins` renders inside the existing app shell.

## 2. Main-Process Navigation Compatibility

- [ ] Add or reuse a typed main-window focus/navigation route for main-process initiated navigation.
- [ ] Ensure the route can focus/create the normal main window and navigate to `/plugins...`.
- [ ] Do not add a Plugins BrowserWindow.
- [ ] Do not add `src/renderer/plugins` or a separate renderer entry.
- [ ] Add tests for focusing main and navigating to `/plugins/mcp`.

## 3. Settings Navigation Cleanup

- [ ] Hide or remove visible Settings navigation items for MCP, Remote, Plugins, and Skills.
- [ ] Keep compatibility routes or redirect handlers for old route names.
- [ ] Map old route names to main `/plugins...` routes.
- [ ] Remove MCP from Settings Overview primary metric.
- [ ] Remove or replace Settings Overview `start-mcp` quick task.
- [ ] Ensure Settings Overview search does not return hidden Plugins-owned pages.
- [ ] Update Settings activity click behavior for historical routes.
- [ ] Add tests for Settings navigation groups and hidden route handling.

## 4. MCP Section

- [ ] Create `/plugins/mcp` page using current MCP store/client behavior.
- [ ] Reuse `McpServers` for list/add/edit/toggle.
- [ ] Reuse MCP market view inside `/plugins/mcp?view=market`.
- [ ] Reuse NPM registry controls.
- [ ] Move MCP install deeplink target from Settings to main `/plugins/mcp`.
- [ ] Move MCP install event handling into the main app or Plugins route bootstrap.
- [ ] Keep plugin-owned MCP server read-only behavior.
- [ ] Add tests for deeplink route target and MCP page render.

## 5. Skills Section

- [ ] Create `/plugins/skills` page from current Skills settings behavior.
- [ ] Reuse skill list, search, install, edit, delete, sync import/export.
- [ ] Preserve draft suggestion toggle.
- [ ] Preserve first-launch sync prompt if still required.
- [ ] Ensure skill dialogs/sheets fit the main Plugins page shell.
- [ ] Add renderer tests for empty/list/search/install entry behavior.

## 6. Official Plugins Section

- [ ] Create official plugin list route from `PluginClient.listPlugins`.
- [ ] Add detail route `/plugins/official/:pluginId`.
- [ ] Keep enable/disable actions.
- [ ] Show runtime status, plugin-owned MCP status and last errors.
- [ ] Add native CUA detail sections for runtime status, permissions and permission guide actions.
- [ ] Add native Feishu/Lark Integration detail that distinguishes it from Feishu/Lark Remote.
- [ ] Stop first-party Plugins UI from calling `settings.open`.
- [ ] Keep `settings.open` only as temporary compatibility fallback.
- [ ] Add tests for list/detail action behavior.

## 7. Remote Virtual Plugins

- [ ] Build remote virtual cards from `remoteControl.listChannels`.
- [ ] Fetch and display per-channel status.
- [ ] Add `/plugins/remote` list route.
- [ ] Add `/plugins/remote/:channel` detail route.
- [ ] Extract only the needed RemoteSettings channel sections into reusable components.
- [ ] Preserve credentials fields and password reveal behavior.
- [ ] Preserve enable/disable save behavior.
- [ ] Preserve default agent and default workdir behavior.
- [ ] Preserve pairing flow for Telegram, Feishu/Lark, QQBot and Discord.
- [ ] Preserve binding/principal removal behavior.
- [ ] Preserve WeChat iLink login/account controls.
- [ ] Route sidebar remote status button to `/plugins/remote` or selected channel detail.
- [ ] Add tests for card mapping, save, pairing and bindings.

## 8. Main Sidebar Layout

- [ ] Replace expanded sidebar header/search area with command list.
- [ ] Keep `所有 Agents` title.
- [ ] Wire `New Chat` row to navigate to `/chat` and start a new conversation.
- [ ] Wire `Search` row to existing Spotlight behavior.
- [ ] Wire `Plugins` row to `router.push({ name: 'plugins' })`.
- [ ] Add a blank spacer after the `Plugins` command row.
- [ ] Render `Pinned` only when pinned sessions exist.
- [ ] Keep the `Chat` group after `Pinned`.
- [ ] Add `工作区` header before project groups.
- [ ] Move the existing group-mode/sort toggle to the `工作区` header.
- [ ] Keep Settings/theme/sidebar controls in the existing left rail, not in the expanded right column.
- [ ] Display shortcut badges only for existing shortcuts.
- [ ] Keep collapsed sidebar visual behavior unchanged.
- [ ] Preserve session list pagination, pinned section, project grouping and reorder.
- [ ] Add renderer tests for expanded rows and collapsed state.
- [ ] Capture before/after ASCII blocks in PR description.

## 9. Cross-Platform UI QA

- [ ] Verify macOS light/dark with app shell and sidebar.
- [ ] Verify Windows light/dark with app shell and sidebar.
- [ ] Verify Linux opaque background.
- [ ] Verify narrow main window layout with expanded sidebar.
- [ ] Verify narrow main window layout with collapsed sidebar.
- [ ] Verify long paths/tokens/errors do not overflow.
- [ ] Verify keyboard navigation and focus order.
- [ ] Verify Chinese and English labels.

## 10. Final Quality Gates

- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
- [ ] Run `pnpm run typecheck`.
- [ ] Run targeted renderer tests for Plugins route and sidebar.
- [ ] Run targeted main tests for navigation/deeplink behavior.
- [ ] Update durable docs or remove/archive active plan/tasks after implementation lands.
