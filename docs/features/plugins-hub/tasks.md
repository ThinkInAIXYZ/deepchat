# Plugins Hub Tasks

## 0. Review Gate

- [x] Review `spec.md` with product/maintainers.
- [x] Review `plan.md` main-route architecture, route compatibility, and sidebar layout.
- [x] Confirm no unresolved clarification markers exist before implementation.
- [ ] Keep this SDD folder active until the feature lands or is deliberately abandoned.

## 1. Main Route Skeleton

- [x] Add `/plugins` route family to the existing main renderer router.
- [x] Add `PluginsHubPage.vue` inside `src/renderer/src/pages/plugins/`.
- [x] Add top tab navigation for Plugins, Skills and MCP.
- [x] Add Codex-like catalog placeholder with title, subtitle, search, added strip and featured sections.
- [x] Keep MCP and Skills as top tabs only, not plugin catalog cards.
- [x] Keep `WindowSideBar`, `AppBar`, global overlays, theme and i18n behavior intact.
- [x] Add i18n keys for route, page title, subtitle, tabs and search placeholder.
- [ ] Add renderer tests proving `/plugins` renders inside the existing app shell.

## 2. Main-Process Navigation Compatibility

- [x] Reuse existing deeplink event handling for main-process initiated MCP navigation.
- [x] Ensure MCP install deeplink can focus/create the normal main window and navigate to `/plugins/mcp`.
- [x] Do not add a Plugins BrowserWindow.
- [x] Do not add `src/renderer/plugins` or a separate renderer entry.
- [ ] Add tests for focusing main and navigating to `/plugins/mcp`.

## 3. Settings Navigation Cleanup

- [x] Hide or remove visible Settings navigation items for MCP, Remote, Plugins, and Skills.
- [x] Keep compatibility routes or redirect handlers for old route names.
- [ ] Map every old route name to main `/plugins...` routes.
- [x] Remove MCP from Settings Overview primary metric.
- [x] Remove or replace Settings Overview `start-mcp` quick task.
- [x] Ensure Settings Overview search does not return hidden Plugins-owned pages.
- [ ] Update Settings activity click behavior for historical routes.
- [ ] Add tests for Settings navigation groups and hidden route handling.

## 4. MCP Section

- [x] Create `/plugins/mcp` page using current MCP store/client behavior.
- [x] Reuse `McpSettings`/current MCP components for list/add/edit/toggle.
- [x] Reuse MCP market view inside `/plugins/mcp?view=market`.
- [x] Reuse NPM registry controls.
- [x] Move MCP install deeplink target from Settings to main `/plugins/mcp`.
- [x] Move MCP install event handling into the main app or Plugins route bootstrap.
- [x] Keep plugin-owned MCP server read-only behavior.
- [ ] Add tests for deeplink route target and MCP page render.

## 5. Skills Section

- [x] Create `/plugins/skills` page from current Skills settings behavior.
- [x] Reuse skill list, search, install, edit, delete, sync import/export.
- [x] Preserve draft suggestion toggle.
- [x] Preserve first-launch sync prompt if still required.
- [x] Ensure skill dialogs/sheets fit the main Plugins page shell.
- [ ] Add renderer tests for empty/list/search/install entry behavior.

## 6. Official Plugins Section

- [x] Create official plugin list route from `PluginClient.listPlugins`.
- [x] Add unified detail route `/plugins/:pluginId`.
- [x] Keep enable/disable actions.
- [x] Show runtime status, plugin-owned MCP status and last errors.
- [ ] Add native CUA detail sections for runtime status, permissions and permission guide actions.
- [x] Merge Feishu/Lark Remote configuration into the Feishu/Lark Integration detail page.
- [x] Use the Feishu/Lark Integration top-level enable/disable button to control both the official plugin and Feishu/Lark Remote.
- [x] Stop first-party Plugins UI from calling `settings.open`.
- [x] Keep `settings.open` only as temporary compatibility fallback.
- [ ] Add tests for list/detail action behavior.

## 7. Remote Virtual Plugins

- [x] Build remote virtual cards from `remoteControl.listChannels`.
- [x] Fetch and display per-channel status.
- [x] Route remote virtual plugin cards through `/plugins/:pluginId` using `remote:<channel>` ids.
- [x] Remove the Remote top tab/product list route.
- [x] Reuse `RemoteSettings` in single-channel mode inside plugin detail pages.
- [x] Use the plugin detail top-level enable/disable button for remote virtual plugin state.
- [x] Auto-enable configured legacy channels when the explicit enabled flag is missing.
- [x] Preserve credentials fields and password reveal behavior.
- [x] Preserve enable/disable save behavior.
- [x] Preserve default agent and default workdir behavior.
- [x] Preserve pairing flow for Telegram, Feishu/Lark, QQBot and Discord.
- [x] Preserve binding/principal removal behavior.
- [x] Preserve WeChat iLink login/account controls.
- [x] Route sidebar remote status button to the first enabled remote plugin detail.
- [ ] Add tests for card mapping, save, pairing and bindings.

## 8. Main Sidebar Layout

- [x] Replace expanded sidebar header/search area with command list.
- [x] Keep `所有 Agents` title.
- [x] Wire `New Chat` row to navigate to `/chat` and start a new conversation.
- [x] Wire `Search` row to existing Spotlight behavior.
- [x] Localize the `Search` command label for Chinese locales.
- [x] Wire `Plugins` row to `router.push({ name: 'plugins' })`.
- [x] Add a blank spacer after the `Plugins` command row.
- [x] Render `Pinned` only when pinned sessions exist.
- [x] Keep the `Chat` group after `Pinned`.
- [x] Add `工作区` header before project groups.
- [x] Move the existing group-mode/sort toggle to the `工作区` header.
- [x] Keep Settings/theme/sidebar controls in the existing left rail, not in the expanded right column.
- [x] Display shortcut badges only for existing shortcuts.
- [x] Keep collapsed sidebar visual behavior unchanged.
- [x] Preserve session list pagination, pinned section, project grouping and reorder.
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

- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [ ] Run targeted renderer tests for Plugins route and sidebar.
- [ ] Run targeted main tests for navigation/deeplink behavior.
- [ ] Update durable docs or remove/archive active plan/tasks after implementation lands.
