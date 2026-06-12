# Presenter IPC Migration Completion - Tasks

> Status: active execution record. Each checked item must have static or test evidence below it.

## T0 - Documentation And Audit

- [x] Create branch `codex/presenter-ipc-migration-plan`.
- [x] Audit typed routes/events and legacy renderer IPC usage.
- [x] Write spec, audit, plan, and tasks.

Verification:

- `node scripts/architecture-guard.mjs` currently passes, confirming the guard gap rather than
  proving migration completion.

## T1 - Architecture Guard Coverage

- [x] Extend guard scans to all renderer roots, especially `src/renderer/settings` and
  `src/renderer/splash`.
- [x] Add explicit allowlists for runtime wrappers and specialized preload APIs.
- [x] Treat retired `src/renderer/api/legacy/**` as forbidden instead of quarantine.
- [x] Regenerate baseline reports with current legacy exceptions recorded.
- [x] Add a test or fixture proving settings-level `useLegacyPresenter` fails the guard.
- [x] Define the per-slice verification matrix in
  [verification.md](./verification.md).

Side effect:

- CI may begin failing until the baseline/bridge register is updated. Treat that as intentional
  visibility, not a migration failure.

Evidence:

- `node scripts/architecture-guard.mjs` passed after the guard began scanning
  `src/renderer/settings` and after `src/renderer/api/legacy/**` was deleted.
- Source scan: `rg "@api/legacy|legacy/presenters|legacy/runtime" src -g '*.ts' -g '*.vue' -g '*.d.ts'`
  returns no hits.
- `node scripts/generate-architecture-baseline.mjs` regenerated
  `docs/architecture/baselines/main-kernel-boundary-baseline.md` and
  `docs/architecture/baselines/main-kernel-migration-scoreboard.*` with `renderer.*` legacy counts
  at `0`.
- Evidence: `pnpm exec vitest run test/main/scripts/architectureGuard.test.ts --silent --reporter=dot`
  passed with 1 file / 2 tests.

## T2 - Easy Replacements Using Existing Clients

- [x] Replace `filePresenter.getMimeType/prepareFile` with `FileClient`.
- [x] Replace `toolPresenter.getAllToolDefinitions` with `ToolClient`.
- [x] Replace `projectPresenter.getRecentProjects/selectDirectory` with `ProjectClient`.
- [x] Replace `devicePresenter.getAppVersion/getDeviceInfo/selectDirectory` with `DeviceClient`.
- [x] Replace `agentSessionPresenter.getAgents` with `SessionClient.getAgents` or
  `ConfigClient.listAgents`.
- [x] Replace direct `window.api.copyText/readClipboardText/openExternal/getPathForFile` with
  existing runtime wrapper methods through `DeviceClient`, `BrowserClient`, or `FileClient`.
- [x] Remove unused legacy `windowPresenter`/`configPresenter` injections where no method is needed.

Automated tests:

- Renderer component tests for prompt editor, DeepChat agent settings, remote settings path picker,
  About settings, and data settings.
- `node scripts/architecture-guard.mjs`.

Manual tests:

- File picker, prompt file import, and remote default workdir selection.

Project/environment evidence:

- Runtime read-only evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/21-project-readonly-route.smoke.spec.ts`
  passed with 1 smoke test. It opens the real Environments Settings page and reads
  `project.listRecent`, `project.listEnvironments`, and `project.pathExists` for both an existing
  repository path and a generated missing path without opening directories or invoking the native
  directory picker.
- Focused stability evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/21-project-readonly-route.smoke.spec.ts`
  passed with 3 smoke tests.
- Manual follow-up remains required for native directory picker, open-directory behavior, and
  remote/default-workdir flows because those depend on OS dialogs and shell integration.

Agent session evidence:

- Added `sessions.getUsageDashboard` and `sessions.retryRtkHealthCheck`.
- Replaced Dashboard usage and Remote settings agent list with `SessionClient`.
- Evidence: `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/DashboardSettings.test.ts test/renderer/components/RemoteSettings.test.ts`
  passed with 5 files / 84 tests.
- Runtime read-only evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/15-dashboard-readonly-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. It opens the real Settings Overview dashboard surface and verifies the
  typed `sessions.getUsageDashboard` route shape without triggering `sessions.retryRtkHealthCheck`
  or mutating session data.

## T3 - Typed Events Before Heavy Route Work

- [x] Remove legacy stream terminal fallback in `messageIpc.ts` or add the missing typed refresh event.
- [x] Migrate context-menu raw channels to a typed event or narrow preload API.
- [x] Migrate settings navigation/provider-install/notification raw events.
- [x] Migrate `CONFIG_EVENTS.AGENTS_CHANGED`, `RAG_EVENTS.*`, `RATE_LIMIT_EVENTS.*`,
  `SKILL_SYNC_EVENTS.*`, `ACP_DEBUG_EVENTS.EVENT`, and `skill:*` listeners.
- [x] Migrate ACP terminal/init raw channels to typed routes/events.
- [x] Remove legacy dialog request and workspace invalidation raw renderer events after typed
  events had consumers.
- [x] Remove legacy device reset completion raw notification after typed app-runtime event had a
  consumer.
- [x] Remove legacy system notification click raw notification after typed app-runtime event had a
  consumer.
- [x] Remove legacy Ollama pull-progress raw event after typed provider event had a consumer.
- [x] Remove legacy skill catalog/session raw events after typed skill events had consumers.
- [x] Remove legacy YoBrowser raw lifecycle/open events after typed browser events had consumers.
- [x] Remove legacy MCP sampling raw events after typed MCP sampling events had consumers.
- [x] Remove legacy config font-size raw event after typed settings changed event had a consumer.
- [x] Remove legacy NowledgeMem config raw event after typed config routes had consumers.
- [x] Remove legacy MCP config renderer send while keeping main-internal MCP config event and typed
      bridge.
- [x] Remove legacy ACP workspace raw events after typed session ACP ready events had consumers.

Automated tests:

- `test/renderer/api/createBridge.test.ts`.
- New event contract tests.
- Affected store/component tests.

Manual tests:

- Send a chat message and ensure terminal refresh is stable.
- Use selected text context menu for translate and ask-AI.
- Open settings via deeplink/provider install.
- ACP terminal initialization/input/kill and external dependency prompt.

Settings/window/notification/ACP evidence:

- Added typed events for settings navigation, provider install, update check, notification error,
  database repair suggestion, and ACP terminal lifecycle/output/dependency events.
- Added `window.notifySettingsReady`, `acpTerminal.input`, and `acpTerminal.kill` routes.
- Replaced settings shell, About update check, ACP settings reload, Skills catalog reload, and ACP
  terminal listeners with typed clients.
- Evidence: `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/SettingsApp.test.ts test/renderer/components/SettingsApp.providerDeeplink.test.ts test/renderer/components/AboutUsSettings.test.ts`
  passed with 6 files / 92 tests.
- Additional evidence: `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/AcpSettings.test.ts`
  passed with 4 files / 77 tests.
- Upgrade typed-event cleanup evidence:
  `pnpm exec vitest run test/main/presenter/upgradePresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/components/AboutUsSettings.test.ts --silent --reporter=dot`
  passed with 4 files / 64 tests. `upgradePresenter` no longer sends renderer-visible
  `UPDATE_EVENTS.STATUS_CHANGED`, `PROGRESS`, `WILL_RESTART`, or `ERROR` raw channels; renderer
  update state is delivered through typed `upgrade.status.changed`, `upgrade.progress`,
  `upgrade.willRestart`, and `upgrade.error` events. `UPDATE_EVENTS.STATE_CHANGED` remains only as a
  main-internal upgrade/lifecycle signal.
- Dialog typed-event cleanup evidence:
  `pnpm exec vitest run test/main/presenter/dialogPresenter.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/stores/dialogStore.test.ts --silent --reporter=dot`
  passed with 5 files / 82 tests. `DialogPresenter.showDialog` now emits only typed
  `dialog.requested`; retired `dialog:request` / `dialog:response` constants were removed from main
  and renderer event files. Runtime stability evidence:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts --workers=1`
  passed with 2 smoke tests after rebuilding.
- Workspace invalidation cleanup evidence:
  `pnpm exec vitest run test/main/presenter/workspacePresenter.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts --silent --reporter=dot`
  passed with 4 files / 94 tests. Workspace watchers now emit only typed `workspace.invalidated`;
  retired `workspace:files-changed` invalidation constants were removed from main and renderer
  event files. User-flow route evidence:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/09-main-ipc-boundary.smoke.spec.ts test/e2e/specs/29-workspace-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after rebuilding. The e2e opens the real main renderer, registers the
  current repository as an allowed workspace, reads directory/search/git status routes, and
  unregisters in `finally` without starting watchers, opening files, or revealing paths.
- Device reset completion cleanup evidence:
  `pnpm exec vitest run test/main/presenter/devicePresenter.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/DataSettings.test.ts --silent --reporter=dot`
  passed with 5 files / 103 tests. `DevicePresenter` now publishes typed
  `appRuntime.dataResetCompleteDev` directly in the development reset completion branch; the retired
  `notification:data-reset-complete-dev` constant was removed from main and renderer event files,
  and the `WindowPresenter` legacy-channel translation case was removed. Source scan:
  `rg "DATA_RESET_COMPLETE_DEV|notification:data-reset-complete-dev" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. User-flow stability evidence:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/20-data-security-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after rebuilding. The e2e opens the real Data Settings page and reads
  read-only device/database routes without triggering destructive data reset. The actual reset
  button flow remains a disposable-profile manual check.
- System notification click cleanup evidence:
  `pnpm exec vitest run test/main/presenter/notificationPresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/components/App.startup.test.ts --silent --reporter=dot`
  passed with 4 files / 67 tests. `NotificationPresenter` now publishes typed
  `appRuntime.systemNotificationClicked` directly when an Electron system notification is clicked;
  the retired `notification:sys-notify-clicked` translation case was removed from
  `WindowPresenter`, and the old `NOTIFICATION_EVENTS` constants were removed from main and
  renderer event files. Source scan:
  `rg "NOTIFICATION_EVENTS|notification:sys-notify-clicked|SYS_NOTIFY_CLICKED" src/main src/renderer -g '*.ts' -g '*.vue'`
  returns no hits. User-flow stability evidence:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/09-main-ipc-boundary.smoke.spec.ts --workers=1`
  passed with 2 smoke tests after rebuilding. Actual OS notification display/click behavior remains
  a platform manual check because it depends on notification permissions and desktop environment.
- Ollama pull-progress cleanup evidence:
  `pnpm exec vitest run test/main/presenter/llmProviderPresenter/ollamaManager.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/stores/ollamaStore.test.ts --silent --reporter=dot`
  passed with 4 files / 58 tests. `OllamaManager` now emits only typed
  `providers.ollama.pull.progress`; the retired `ollama:pull-model-progress` constants were
  removed from main and renderer event files. Source scan:
  `rg "OLLAMA_EVENTS|ollama:pull-model-progress|PULL_MODEL_PROGRESS" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. User-flow stability evidence:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/18-provider-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after rebuilding. The e2e opens the real Model Providers settings
  surface without pulling a model or requiring a live Ollama daemon.
- Skill catalog/session cleanup evidence:
  `pnpm exec vitest run test/main/presenter/skillPresenter/skillPresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/components/McpIndicator.test.ts test/renderer/components/SkillsSettings.test.ts test/renderer/components/SkillEditorSheet.test.ts --silent --reporter=dot`
  passed with 5 files / 151 tests. `SkillPresenter` now emits only typed
  `skills.catalog.changed` and `skills.session.changed` for discovery, install/uninstall,
  activation/deactivation, and watcher metadata changes; retired `skill:*` constants were removed
  from main and renderer event files. Source scan:
  `rg "SKILL_EVENTS|skill:activated|skill:deactivated|skill:discovered|skill:installed|skill:uninstalled|skill:metadata-updated" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. User-flow stability evidence:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/16-skills-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after rebuilding. The e2e opens the real Skills settings surface and
  reads skill routes without installing, uninstalling, saving, or editing skill files.
- YoBrowser lifecycle/open cleanup evidence:
  `pnpm exec vitest run test/main/presenter/YoBrowserPresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/components/BrowserPanel.test.ts --silent --reporter=dot`
  passed with 4 files / 71 tests. `YoBrowserPresenter` now emits only typed
  `browser.status.changed`, `browser.open.requested`, and `browser.activity.changed`; retired
  `yo-browser:*` constants were removed from main and renderer event files. The old
  `yo-browser:window-count-changed` event had no business consumer and was retired without a typed
  replacement. Source scan:
  `rg "YO_BROWSER_EVENTS|yo-browser:" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. User-flow evidence: `test/e2e/specs/08-browser-route.smoke.spec.ts` passed in
  the 3-spec run and validated browser typed routes. `01-launch` and `06-settings-ipc-boundary`
  passed individually after the same build; a 3-spec rerun hit an app fixture setup timeout in
  `06-settings-ipc-boundary`, which is recorded as existing e2e harness startup instability rather
  than a browser route failure.
- MCP sampling cleanup evidence:
  `pnpm exec vitest run test/main/presenter/mcpPresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/stores/mcpSampling.test.ts --silent --reporter=dot`
  passed with 4 files / 68 tests. `McpPresenter` no longer sends retired
  `mcp:sampling-request`, `mcp:sampling-decision`, or `mcp:sampling-cancelled` raw renderer
  channels; sampling approval, decision, and cancellation notifications are delivered through typed
  `mcp.sampling.request`, `mcp.sampling.decision`, and `mcp.sampling.cancelled` events. Source scan:
  `rg "mcp:sampling-request|mcp:sampling-decision|mcp:sampling-cancelled|SAMPLING_REQUEST|SAMPLING_DECISION|SAMPLING_CANCELLED" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. User-flow stability evidence:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/13-mcp-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after rebuilding. The e2e opens the real MCP Settings page and verifies
  typed MCP read-only routes, but it does not exercise a live MCP sampling request because that
  requires a test MCP server and model invocation path.
- Config font-size cleanup evidence:
  `pnpm exec vitest run test/main/presenter/configPresenter/fontSizeSettings.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/main/routes/settingsHandler.test.ts test/renderer/api/clients.test.ts test/renderer/stores/uiSettingsStore.test.ts --silent --reporter=dot`
  passed with 6 files / 88 tests. `ConfigPresenter.setSetting('fontSizeLevel', value)` now relies
  on typed `settings.changed` only; retired `config:font-size-changed` constants were removed from
  main and renderer event files. Source scan:
  `rg "config:font-size-changed|FONT_SIZE_CHANGED" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. User-flow stability evidence:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/23-config-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after rebuilding. Actual font-size UI adjustment and cross-window class
  synchronization remain manual or future dedicated e2e because the current config e2e is
  read-only.
- NowledgeMem config cleanup evidence:
  `pnpm exec vitest run test/main/presenter/configPresenter/fontSizeSettings.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/NowledgeMemSettings.test.ts --silent --reporter=dot`
  passed with 5 files / 83 tests. `ConfigPresenter.setNowledgeMemConfig` no longer sends retired
  `config:nowledge-mem-config-updated`; NowledgeMem settings save/load behavior is carried by typed
  `nowledgeMem.updateConfig` and `nowledgeMem.getConfig` routes. Source scan:
  `rg "config:nowledge-mem-config-updated|NOWLEDGE_MEM_CONFIG_UPDATED" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. User-flow evidence:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/14-nowledgemem-config-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after rebuilding. The e2e opens real Knowledge Settings, writes a
  temporary NowledgeMem config through UI/typed routes, verifies persistence, and restores the
  original config; live Test Connection remains manual because it requires a running NowledgeMem
  service.
- MCP config bridge cleanup evidence:
  `pnpm exec vitest run test/main/presenter/configPresenter/mcpConfHelper.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/stores/mcpStore.test.ts --silent --reporter=dot`
  passed with 5 files / 89 tests. `McpConfHelper.batchImportMcpServers` no longer sends
  `MCP_EVENTS.CONFIG_CHANGED` directly to renderer; it emits the main-internal MCP config event,
  and `legacyTypedEventBridge` publishes typed `mcp.config.changed`. The unused renderer
  `MCP_EVENTS` raw constants were removed. Source scan over the touched files confirms no
  `eventBus.sendToRenderer` remains in `mcpConfHelper`. User-flow evidence:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/13-mcp-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after rebuilding. Batch import from external marketplaces still needs
  manual or opt-in e2e because it mutates MCP server config and can depend on network data.
- ACP workspace/debug cleanup evidence:
  `pnpm exec vitest run test/main/presenter/acpProvider.test.ts test/main/presenter/llmProviderPresenter/acp/acpProcessManager.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/components/ChatStatusBar.test.ts test/renderer/components/AcpDebugDialog.test.ts --silent --reporter=dot`
  passed with 6 files / 157 tests. ACP workspace readiness now uses typed
  `sessions.acp.modes.ready`, `sessions.acp.commands.ready`, and
  `sessions.acp.configOptions.ready`; retired `acp-workspace:*` constants were removed from main,
  renderer, and tests. ACP debug events now enter the main event bus as `ACP_DEBUG_EVENTS.EVENT`
  and are published to renderer through typed `providers.acp.debug.event` by the bridge. Source
  scan:
  `rg "ACP_WORKSPACE_EVENTS|acp-workspace:|SESSION_MODES_READY|SESSION_COMMANDS_READY|SESSION_CONFIG_OPTIONS_READY|eventBus\\.sendToRenderer\\(" src/main/presenter/llmProviderPresenter src/main/events.ts src/renderer/src/events.ts test/main/presenter/acpProvider.test.ts test/main/presenter/llmProviderPresenter/acp/acpProcessManager.test.ts test/renderer/components/ChatStatusBar.test.ts -g '*.ts' -g '*.vue'`
  returns no hits. User-flow evidence:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/17-acp-readonly-route.smoke.spec.ts test/e2e/specs/18-provider-readonly-route.smoke.spec.ts --workers=1`
  passed with 4 smoke tests after rebuilding. Real ACP process warmup, debug actions, mode/model
  selection, and config option changes remain manual or opt-in e2e because they require runnable
  ACP agents and local runtime dependencies.
- Runtime window-state evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/22-window-readonly-route.smoke.spec.ts`
  passed with 1 smoke test. It reads `window.getCurrentState` from both the real main renderer and
  the real Settings renderer, proving the context-aware route returns distinct current-window state
  snapshots without minimizing, maximizing, focusing, or closing either window.
- Focused window stability evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/22-window-readonly-route.smoke.spec.ts`
  passed with 3 smoke tests.
- Runtime provider preview evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/25-window-provider-deeplink-preview.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. It queues a custom provider install preview through the typed
  `window.requeuePendingSettingsProviderInstall` route, opens the real Settings window, verifies the
  Provider settings preview dialog shows the provider name, base URL, and masked key, and confirms
  `window.consumePendingSettingsProviderInstall` is empty afterward without clicking confirm or
  applying provider configuration.
- Focused provider preview stability evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/25-window-provider-deeplink-preview.smoke.spec.ts --reporter=list`
  passed with 3 smoke tests.

Context-menu/app-runtime/chat stream evidence:

- Added typed app runtime and context-menu events.
- Replaced main-window deeplink/MCP install/shortcut/notification/context-menu sends with typed
  event envelopes while preserving existing renderer UI behavior.
- Removed `messageIpc.ts` legacy `STREAM_EVENTS.END/ERROR` fallback.
- Evidence: `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/App.startup.test.ts test/renderer/components/SettingsApp.test.ts test/renderer/lib/storeInitializer.test.ts test/renderer/components/message/SelectedTextContextMenu.test.ts --silent --reporter=dot`
  passed with 7 files / 102 tests.
- Additional final-slice evidence: `test/renderer/stores/messageStore.test.ts` passed in the final
  focused migration gate, proving the store no longer depends on the removed legacy stream fallback.

## T4 - Config, ACP, Agent, And Settings Route Gaps

- [x] Add typed ACP config/registry/manual-agent routes and `ConfigClient` methods.
- [x] Add DeepChat agent CRUD routes.
- [x] Add hooks notifications routes.
- [x] Add proxy/update-channel/logging-folder routes.
- [x] Add provider DB refresh route in the best owning domain.
- [x] Replace `AcpSettings`, `DeepChatAgentsSettings`, `NotificationsHooksSettings`,
  `AboutUsSettings`, proxy/logging/default-model/common settings sections.

Automated tests:

- Contract tests for new route schemas.
- Route handler tests with mocked `configPresenter`.
- Component tests for ACP and agent settings.

Manual tests:

- ACP install/repair/uninstall/manual-agent CRUD.
- DeepChat agent advanced editing: model selection, default project, tool toggles, subagent slots,
  and auto-compaction controls.
- Proxy/update channel/logging folder.

Config/ACP read-only evidence:

- Added typed ACP config/registry/manual-agent/shared-MCP routes and `ConfigClient` methods.
- Replaced `AcpSettings` with typed `ConfigClient` calls.
- Runtime read-only evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/17-acp-readonly-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. It opens the real ACP Settings page and reads
  `config.getAcpState`, `config.listAcpRegistryAgents`, `config.listManualAcpAgents`,
  `config.getAcpSharedMcpSelections`, and `config.listAgents` for DeepChat/ACP views without
  toggling ACP, refreshing the registry, installing/repairing/uninstalling registry agents, or
  mutating manual agents.
- Focused stability evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/17-acp-readonly-route.smoke.spec.ts --reporter=list`
  passed with 3 smoke tests.
- Config settings read-only runtime evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/23-config-readonly-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. It opens the real DeepChat Agents, Notifications Hooks, and Shortcuts
  settings pages, then reads `config.listAgents`, `config.resolveDeepChatAgentConfig`,
  `config.getAgentMcpSelections`, `config.getHooksNotifications`, and `config.getShortcutKeys`
  without creating/updating/deleting agents, saving hooks, testing hook commands, resetting
  shortcuts, or changing global shortcut registration.
- Config settings focused stability evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/23-config-readonly-route.smoke.spec.ts --reporter=list`
  passed with 3 smoke tests.
- Hooks notification command runtime evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/27-hooks-notification-command.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. It saves a temporary hook through `config.setHooksNotifications`,
  verifies the real Notifications Hooks settings page renders it, runs a harmless local
  `node -e` command through `config.testHookCommand`, checks the successful stdout/exit code, and
  restores the original hooks config in `finally`.
- Hooks notification focused stability evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/27-hooks-notification-command.smoke.spec.ts --reporter=list`
  passed with 3 smoke tests.
- DeepChat agent CRUD runtime evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/26-deepchat-agent-crud.smoke.spec.ts --reporter=list`
  passed with 1 smoke test after rebuilding the app. It opens the real DeepChat Agents settings
  page, creates a uniquely named temporary agent through the UI, verifies it through
  `config.listAgents`, updates its name/description through the UI, deletes it through
  `config.deleteDeepChatAgent`, and performs best-effort cleanup in `finally`.
- DeepChat agent CRUD focused stability evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/26-deepchat-agent-crud.smoke.spec.ts --reporter=list`
  passed with 3 smoke tests.
- Config system read-only runtime evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/24-config-system-readonly-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. It opens the real About settings page, then reads
  `config.getProxySettings`, `config.getUpdateChannel`, `config.getSyncSettings`,
  `config.getSkillDraftSuggestions`, `config.getEntries` for model/default file-size settings, and
  `upgrade.getStatus` without opening the General proxy section, changing proxy mode, checking for
  updates, downloading updates, opening the logging folder, refreshing the provider database, or
  changing the update channel.
- Config system focused stability evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/24-config-system-readonly-route.smoke.spec.ts --reporter=list`
  passed with 3 smoke tests.
- Manual follow-up remains required for ACP install/repair/uninstall, manual-agent CRUD, and
  external dependency terminal interaction because those write runtime directories or start
  subprocess flows. DeepChat agent advanced editing paths, such as model selection, default project
  path, tool toggles, subagent slots, and auto-compaction controls, remain manual or future
  disposable-profile checks. Custom hook scripts/failure scenarios and real event dispatch remain
  manual or future opt-in checks because user commands can touch local files or external services.
  Shortcut Settings UI edit/clear/reset and OS-level global shortcut activation remain
  manual/disposable-profile checks because they mutate user settings and depend on platform global
  shortcut registration state.
  Proxy/update-channel saves, logging-folder opening, and provider DB refresh also remain manual or
  opt-in checks because they write configuration, invoke OS shell behavior, or touch network-backed
  provider metadata.

## T5 - Provider, Model, OAuth, And ACP Debug

- [x] Add provider key status and rate-limit update routes.
- [x] Add embedding dimensions route or extend model capabilities route.
- [x] Add ModelScope MCP sync route.
- [x] Add ACP debug action route and typed debug event.
- [x] Add GitHub Copilot OAuth routes.
- [x] Replace `ProviderApiConfig`, `BuiltinKnowledgeSettings`, `ModelScopeMcpSync`,
  `ProviderRateLimitConfig`, `AcpDebugDialog`.
- [x] Replace `GitHubCopilotOAuth`.

Automated tests:

- Provider/model route handler tests with mocked provider runtime.
- Renderer API and component tests.
- OAuth evidence: `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/GitHubCopilotOAuth.test.ts`
  passed with 4 files / 57 tests.
- Provider read-only runtime evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/18-provider-readonly-route.smoke.spec.ts`
  passed with 1 smoke test. It opens the real Model Providers settings page, waits for provider
  rows, and reads `providers.listSummaries`, `providers.listDefaults`, `providers.listModels`, and
  `providers.getRateLimitStatus` without saving provider settings, refreshing models, testing live
  connectivity, running OAuth, syncing ModelScope MCP servers, or starting ACP debug actions.
- Focused provider stability evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/18-provider-readonly-route.smoke.spec.ts`
  passed with 3 smoke tests.

Manual tests:

- Refresh models, update provider rate limit, run ACP debug, live provider connection checks, and
  provider key-status reads that depend on real credentials/network state.
- GitHub Copilot auth: in Settings -> Provider -> GitHub Copilot, run device flow and traditional
  OAuth against a real GitHub account, then verify the provider shows connected and model
  verification can use the saved token. This is not fully automatable because it depends on an
  external browser/device-code consent flow.

## T6 - Knowledge Routes And Events

- [x] Add `knowledge.*` routes and `KnowledgeClient`.
- [x] Add typed `knowledge.file.updated/progress` events.
- [x] Replace `KnowledgeBaseSettings`, `KnowledgeFile`, `KnowledgeFileItem`,
  `BuiltinKnowledgeSettings` knowledge calls.

Automated tests:

- Route contract and handler tests.
- Knowledge settings component tests.
- Evidence: `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/BuiltinKnowledgeSettings.test.ts test/renderer/components/KnowledgeFile.test.ts test/renderer/components/KnowledgeFileItem.test.ts`
  passed with 6 files / 54 tests.
- E2E read-only evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/12-knowledge-readonly-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. It opens the real Knowledge Settings page and reads
  `knowledge.isSupported`, `knowledge.getSupportedLanguages`,
  `knowledge.getSeparatorsForLanguage`, and `knowledge.getSupportedFileExtensions` without adding
  files, running ingestion, or mutating knowledge-base data.

Manual tests:

- Add/delete/re-add a file, pause/resume ingestion, run similarity query.

## T7 - Skill Sync Routes And Events

- [x] Add `skillSync.*` routes and `SkillSyncClient`.
- [x] Add typed discovery/scan/import/export events.
- [x] Replace sync prompt/status/import/export components.

Automated tests:

- Contract tests for import/export input.
- Handler tests with mocked scanner/converter.
- Wizard component tests.
- Evidence: `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/SkillSyncSettings.test.ts`
  passed with 4 files / 53 tests.
- Runtime read-only evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/19-skill-sync-readonly-route.smoke.spec.ts`
  passed with 1 smoke test after rebuilding the app. It opens the real Skills settings page, verifies
  the sync status surface is present, reads `skillSync.getRegisteredTools`,
  `skillSync.getNewDiscoveries`, and `skillSync.scanExternalTools`, and confirms the typed
  `skillSync.scan.started/completed` events are delivered. It does not acknowledge discoveries or
  preview/execute import/export.
- Focused stability evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/19-skill-sync-readonly-route.smoke.spec.ts`
  passed with 3 smoke tests.

Manual tests:

- Import skills, export skills, and resolve conflicts against real external tool directories.

## T8 - Remote Control Routes

- [x] Add `remoteControl.*` routes and `RemoteControlClient`.
- [x] Replace `RemoteControlRuntime.ts` and `RemoteSettings.vue`.
- [x] Remove `remoteControlPresenter:call` after no consumers remain.

Automated tests:

- Route schema/handler tests for all channels.
- Remote settings component tests.

Manual tests:

- Telegram pair/bind/unbind.
- Feishu/QQBot/Discord status and settings.
- Weixin iLink login/restart/remove.

Evidence:

- Added typed routes for channel list/settings/status/bindings/pairing and Weixin iLink account
  operations.
- Replaced `RemoteControlRuntime`, `RemoteSettings`, and the main-window `WindowSideBar` remote
  status polling with `RemoteControlClient`; `src/renderer/api/RemoteControlRuntime.ts` has been
  deleted.
- Evidence:
  `pnpm exec vitest run test/renderer/components/WindowSideBar.test.ts test/renderer/components/RemoteSettings.test.ts test/renderer/api/clients.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts --silent --reporter=dot`
  passed with 5 files / 126 tests.
- Main-window runtime evidence:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/09-main-ipc-boundary.smoke.spec.ts test/e2e/specs/11-remote-control-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests. The main renderer IPC boundary smoke now reads
  `remoteControl.listChannels` and `remoteControl.getChannelStatus` from the real main chat
  renderer, covering the same typed route family used by `WindowSideBar` without mutating remote
  control settings.
- Manual follow-up: exercise Telegram pairing and Weixin iLink login against real services. Unit
  tests validate route wiring and component state only.
- Final transport evidence: source scans for `RemoteControlRuntime`, `createRemoteControlRuntime`,
  and `remoteControlPresenter:call` return no hits in `src/main`, `src/renderer`, `src/preload`, or
  renderer tests.

## T9 - Remaining Operational Domains

- [x] Add `skills.readFile` route and replace skill editor.
- [x] Add MCP Router market routes and replace `McpBuiltinMarket`.
- [x] Add NowledgeMem routes and replace `NowledgeMemSettings`.
- [x] Add database repair route and replace `sqlitePresenter.repairSchema`.
- [x] Add browser sandbox clear route and replace `yoBrowserPresenter.clearSandboxData`.
- [x] Decide whether renderer shortcut registration should be removed or typed.

Automated tests:

- Focused route handler/client/component tests.

Manual tests:

- Skill editor read/save.
- MCP Router API key/list/install.
- NowledgeMem config/test.
- Database repair on copied profile.
- Browser sandbox clear.
- Global shortcut enable/disable behavior.

MCP Router evidence:

- Added MCP Router API key/list/install/auth routes and `McpClient` methods.
- Replaced `McpBuiltinMarket` with typed client calls.
- Evidence: `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/McpBuiltinMarket.test.ts`
  passed with 4 files / 70 tests.
- MCP read-only runtime evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/13-mcp-readonly-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. It opens the real MCP Settings page and reads `mcp.getEnabled`,
  `mcp.getServers`, `mcp.getClients`, `mcp.listToolDefinitions`, `mcp.listPrompts`,
  `mcp.listResources`, and `mcp.getNpmRegistryStatus` without toggling MCP, refreshing registry
  metadata, installing marketplace servers, or starting/stopping MCP servers.
- Manual follow-up: save a real MCP Router API key, list marketplace servers, install one server,
  and verify it appears in MCP settings. This depends on network and live credentials.

Shortcut evidence:

- Added `shortcut.register`, `shortcut.unregister`, and `shortcut.destroy` routes.
- Replaced `ShortcutRuntime` legacy presenter dependency with `ShortcutClient`; the renderer
  shortcut store imports `ShortcutClient` directly and `src/renderer/api/ShortcutRuntime.ts` has
  been deleted.
- Moved `config.shortcutKeys.changed` publishing into `ConfigPresenter.setShortcutKey` and
  `ConfigPresenter.resetShortcutKeys`; `legacyTypedEventBridge` no longer monkey patches
  `configPresenter` shortcut methods.
- Evidence: `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/AcpSettings.test.ts`
  passed with 4 files / 81 tests after the direct shortcut event publish cleanup.
- Runtime route/event evidence:
  `pnpm exec playwright test test/e2e/specs/28-shortcut-route-restore.smoke.spec.ts` passed with 1
  smoke test. It opens the real Settings Shortcuts page, writes a temporary `QuickSearch` shortcut
  through the typed `config.setShortcutKeys` route from the Settings renderer, verifies
  `config.shortcutKeys.changed`, calls `shortcut.destroy`, `shortcut.register`, and
  `shortcut.unregister`, and restores the original shortcut config in `finally`.
- Focused shortcut stability evidence:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/28-shortcut-route-restore.smoke.spec.ts --workers=1`
  passed with 3 smoke tests before and after removing the shortcut monkey patch from the legacy
  typed event bridge. The `--workers=1` flag is required for combined Electron specs because the app
  enforces a single-instance `SingletonLock`.
- Manual follow-up: use the real Shortcut Settings UI to edit, clear, reset, and save shortcuts;
  focus/blur the app; press the configured OS global shortcut; and confirm duplicate registration or
  accelerator conflicts are handled on the target OS. The automated route smoke proves IPC reachability
  and restoration, not the platform global-shortcut side effect.

Data settings evidence:

- Added `databaseSecurity.repairSchema` and `browser.clearSandboxData`.
- Replaced Data Settings repair/sandbox actions with `DatabaseSecurityClient` and `BrowserClient`.
- Evidence: `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/DataSettings.test.ts`
  passed with 4 files / 80 tests.
- Runtime read-only evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/20-data-security-readonly-route.smoke.spec.ts`
  passed with 1 smoke test after rebuilding the app. It opens the real Data Settings page, verifies
  the database encryption, database repair, and YoBrowser sandbox surfaces are visible, then reads
  `databaseSecurity.getStatus`, `device.getInfo`, and `device.getAppVersion` without enabling
  encryption, changing passwords, repairing schema, resetting data, or clearing browser sandbox
  data.
- Focused stability evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/20-data-security-readonly-route.smoke.spec.ts`
  passed with 3 smoke tests.
- Manual follow-up: enable/change/disable database encryption in a disposable encrypted profile, run
  database repair against a copied real profile, reset each data type in a disposable profile, and
  clear YoBrowser sandbox, then confirm browser state/cookies are reset. These require local
  profile/browser state and are not fully automatable in unit tests.

NowledgeMem evidence:

- Added `nowledgeMem.getConfig`, `nowledgeMem.updateConfig`, and
  `nowledgeMem.testConnection`.
- Replaced `NowledgeMemSettings` with `NowledgeMemClient`.
- Evidence: `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/NowledgeMemSettings.test.ts`
  passed with 4 files / 64 tests.
- Runtime UI evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/14-nowledgemem-config-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. It opens the real Knowledge Settings page, expands the NowledgeMem
  panel, saves a temporary base URL/API key through the UI, verifies
  `nowledgeMem.getConfig/updateConfig`, and restores the original config in `finally`.
- Manual follow-up: configure a real NowledgeMem endpoint/API key and run Test Connection. This
  depends on a running external service, so automated tests only validate routing, config
  persistence, restore behavior, and component state.

Skill editor evidence:

- Added `skills.readFile` and `SkillClient.readSkillFile`.
- Replaced `SkillEditorSheet` file loading with `SkillClient`.
- Evidence: `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/SkillEditorSheet.test.ts`
  passed with 4 files / 67 tests.
- Runtime read-only evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/16-skills-readonly-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. It opens the real Skills Settings page, reads
  `skills.getDirectory` and `skills.listMetadata`, and, when an installed skill exists, reads
  `skills.readFile`, `skills.getFolderTree`, `skills.getExtension`, and `skills.listScripts`
  without installing, uninstalling, or saving skill files.
- Focused stability evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/16-skills-readonly-route.smoke.spec.ts --reporter=list`
  passed with 3 smoke tests after tightening main-window detection so floating/settings/splash
  windows are not treated as the main chat window.
- Manual follow-up: open an installed skill, edit/save/reopen it, and verify script/runtime
  settings persist. Unit tests validate loading and IPC routing only.

## T10 - Secondary Renderer Hardening

- [x] Replace splash `exposeElectronAPI()` usage with dedicated typed splash API.
- [x] Add payload validation to browser overlay activity API or move it to `createBridge`.
- [x] Move floating widget channel constants to shared contracts and validate payloads.
- [x] Keep plugin settings as typed-route backed specialized API; add tests if missing.

Automated tests:

- Preload bridge tests for splash/floating/browser overlay APIs.
- Existing floating presenter tests.

Manual tests:

- Splash database unlock.
- Floating widget drag/open session/language/theme.
- Browser overlay activity display.
- Plugin settings enable/disable/action invocation.

Evidence:

- Splash renderer now uses `window.deepchatSplash`; raw splash IPC remains only inside
  `src/preload/splash-preload.ts`. The preload boundary test verifies that the exposed API is
  limited to splash update/unlock methods, uses scoped `database-security:*` channels, returns
  unsubscribe functions, and drops invalid submit/cancel payloads.
- Floating widget now uses shared `FLOATING_BUTTON_EVENTS`, validates renderer-to-main payloads,
  validates main-to-renderer events, and returns scoped unsubscribe functions instead of exposing
  `removeAllListeners`.
- Browser overlay validates `browser.activity.changed` with the shared event schema before invoking
  renderer callbacks.
- Plugin settings preload is covered by `test/renderer/api/preloadBoundaries.test.ts`, which verifies
  `window.deepchatPlugin` calls typed plugin routes through `createBridge`.
- Floating button and floating chat windows now load the dev renderer only when
  `ELECTRON_RENDERER_URL` is present; built/e2e mode falls back to bundled renderer files instead of
  `http://localhost:5173/*`.
- Evidence: `pnpm exec vitest run test/renderer/api/preloadBoundaries.test.ts test/main/presenter/floatingButtonPresenter/index.test.ts test/renderer/components/BrowserActivityOverlay.test.ts test/renderer/api/clients.test.ts test/main/routes/contracts.test.ts test/main/scripts/architectureGuard.test.ts --silent --reporter=dot`
  passed before the latest splash boundary addition with 6 files / 68 tests. The full focused gate
  below includes the new splash boundary case.
- User-flow evidence: `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/04-settings-navigation.smoke.spec.ts --reporter=list`
  passed with 2 tests, covering Electron launch and settings control-center navigation.
- Additional user-flow evidence:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts --reporter=list`
  passed with 1 test, covering the real settings window typed bridge, legacy
  `presenter:call` rejection, and migrated knowledge/skills/remote/MCP/data settings surfaces.

## T11 - Retire Legacy Transport

- [x] Verify no renderer business imports `@api/legacy/presenters` or `@api/legacy/runtime`.
- [x] Delete or empty `RemoteControlRuntime.ts` and `ShortcutRuntime.ts` legacy dependencies.
- [x] Remove `presenter:call` and `remoteControlPresenter:call` handlers.
- [x] Remove `Presenter.DISPATCHABLE_PRESENTERS` and `Presenter.REMOTE_CONTROL_METHODS` if unused.
- [x] Delete `src/renderer/api/legacy/**` once there are no consumers.
- [x] Update `docs/ARCHITECTURE.md`, `docs/FLOWS.md`, `docs/guides/code-navigation.md`, and baseline
  reports to reflect the real final state.

Final automated gate:

```bash
rg "useLegacyPresenter|useLegacyRemoteControlPresenter|useLegacyShortcutPresenter" src/renderer
rg "window\\.electron|window\\.api" src/renderer
node scripts/architecture-guard.mjs
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm test
```

Current scan evidence:

- `rg "window\\.electron(\\?|\\.)\\.ipcRenderer|useLegacyPresenter|useLegacyRemoteControlPresenter|useLegacyShortcutPresenter|legacy/presenters" src/renderer src/main src/preload`
  shows raw IPC only inside preload/bridge internals and no source legacy presenter bridge.
- `rg "presenter:call|remoteControlPresenter:call|DISPATCHABLE_PRESENTERS|REMOTE_CONTROL_METHODS|src/renderer/api/legacy" src/main src/renderer src/preload -g '*.ts' -g '*.vue' -g '*.d.ts'`
  returns no hits.
- `rg "UPDATE_EVENTS\\.(STATUS_CHANGED|PROGRESS|WILL_RESTART|ERROR)|update:status-changed|update:error|update:progress|update:will-restart" src test -g '*.ts' -g '*.vue'`
  returns no hits. `UPDATE_EVENTS` now only exposes `STATE_CHANGED`, which is used inside main by
  `upgradePresenter` and `lifecyclePresenter`.
- `rg "DIALOG_EVENTS|dialog:request|dialog:response|eventBus\\.sendToRenderer\\(DIALOG_EVENTS" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits; dialog requests now use the typed deepchat event channel and respond/error routes.
- `rg "WORKSPACE_EVENTS\\.INVALIDATED|workspace:files-changed|eventBus\\.sendToRenderer\\(WORKSPACE_EVENTS" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits; workspace invalidation now uses typed `workspace.invalidated`. The remaining
  `WORKSPACE_EVENTS.INSERT_REFERENCE_REQUESTED` is a renderer-local DOM event, not main IPC.
- `rg "originalSetShortcutKey|originalResetShortcutKeys|configPresenter\\.setShortcutKey|configPresenter\\.resetShortcutKeys" src/main/routes/legacyTypedEventBridge.ts`
  returns no hits; shortcut typed event publishing now lives with the owning config presenter.
- Renderer test harness cleanup: `rg "@api/legacy|useLegacyPresenter|legacy/runtime" test/renderer test/main -n`
  now reports only the intentional failing fixture in `test/main/scripts/architectureGuard.test.ts`.
  Migrated component/store tests mock typed clients instead of recreating virtual legacy modules.
- `pnpm exec vitest run test/renderer/api/preloadBoundaries.test.ts test/main/presenter/floatingButtonPresenter/index.test.ts test/renderer/components/BrowserActivityOverlay.test.ts test/renderer/api/clients.test.ts test/main/routes/contracts.test.ts test/main/scripts/architectureGuard.test.ts test/main/presenter/toolPresenter/agentTools/chatSettingsTools.test.ts test/main/presenter/deeplinkPresenter.test.ts test/main/presenter/presenterCallErrorHandler.test.ts test/main/presenter/skillSyncPresenter/index.test.ts test/main/presenter/lifecyclePresenter/SplashWindowManager.display.test.ts test/renderer/components/AcpDebugDialog.test.ts test/renderer/stores/messageStore.test.ts --silent --reporter=dot`
  passed with 13 files / 130 tests after adding the splash preload boundary case.
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and `pnpm run build`
  passed in the full migration gate. During the later RemoteControlRuntime cleanup,
  `pnpm run typecheck` passed and `pnpm exec electron-vite build` passed after a duplicate
  `pnpm run build` typecheck sub-process hung in `vue-tsgo`; the hung build process was stopped
  before rerunning the bundler directly.
- Later upgrade raw-event cleanup evidence: `pnpm run typecheck` and `pnpm exec electron-vite build`
  passed; `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/24-config-system-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests.
- Latest cleanup gate after the upgrade raw-event and shortcut bridge cleanup slices:
  `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck` passed. Targeted
  scans for legacy presenter imports, retired presenter channels, `RemoteControlRuntime`,
  `ShortcutRuntime`, old renderer update raw events, and shortcut bridge monkey patching returned no
  hits.
- Full `pnpm test -- --silent --reporter=dot` passed after project-level Vitest worker concurrency
  was capped at `maxWorkers: 2`: 376 files passed, 6 skipped; 3175 tests passed, 41 skipped.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/04-settings-navigation.smoke.spec.ts --reporter=list`
  passed with 2 smoke tests.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. The test evaluates the real settings renderer window and proves
  `window.deepchat.invoke/on` are present, broad `window.electron` / `api.ipcRenderer` are absent,
  and `window.deepchat.invoke('presenter:call', {})` is rejected as an unknown route.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/09-main-ipc-boundary.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. The test evaluates the real main chat renderer window, calls the typed
  `device.getAppVersion`, `remoteControl.listChannels`, and `remoteControl.getChannelStatus`
  routes, proves `window.deepchat.invoke/on` are present, verifies broad `window.electron` /
  `api.ipcRenderer` are absent, and confirms `presenter:call` is rejected as an unknown route.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/10-settings-privacy-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. The test opens the real Data Settings page, toggles Privacy Mode through
  the UI, verifies the typed `settings.getSnapshot/settings.update` route state, and restores the
  original `privacyModeEnabled` value.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/11-remote-control-readonly-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. The test opens the real Remote Settings page, verifies visible channel
  tabs for Telegram, Feishu, QQBot, Discord, and Weixin iLink, and reads
  `remoteControl.listChannels`, `remoteControl.getChannelSettings`,
  `remoteControl.getChannelStatus`, and `remoteControl.getChannelBindings` for each channel without
  live remote accounts or config mutation.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/12-knowledge-readonly-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. The test opens the real Knowledge Settings page and verifies
  read-only knowledge support, language, separator, and file-extension routes.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/13-mcp-readonly-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. The test opens the real MCP Settings page and verifies read-only MCP
  server/client/tool/prompt/resource and NPM registry-status routes.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/14-nowledgemem-config-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. The test opens the real Knowledge Settings page, saves a temporary
  NowledgeMem config through UI controls, verifies the typed config routes, and restores the
  original config.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/15-dashboard-readonly-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. The test opens the real Settings Overview dashboard and verifies
  `sessions.getUsageDashboard` summary, calendar, provider/model breakdown, and RTK snapshot shape
  without triggering RTK retry.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/16-skills-readonly-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. The test opens the real Skills Settings page and verifies read-only
  skill directory, metadata, file, folder tree, extension, and script routes when installed skill
  data is available.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/17-acp-readonly-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test. The test opens the real ACP Settings page and verifies read-only ACP
  state, registry-agent, manual-agent, shared-MCP, and DeepChat/ACP agent list routes.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/18-provider-readonly-route.smoke.spec.ts`
  passed with 1 smoke test. The test opens the real Model Providers settings page and verifies
  read-only provider summary/default/model catalog and rate-limit status routes without provider
  mutation or live external actions.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/19-skill-sync-readonly-route.smoke.spec.ts`
  passed with 1 smoke test after rebuilding the app. The test opens the real Skills Settings page,
  verifies SkillSync read-only routes, and confirms typed scan started/completed events.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/20-data-security-readonly-route.smoke.spec.ts`
  passed with 1 smoke test after rebuilding the app. The test opens the real Data Settings page and
  verifies database-security/device read-only routes plus visible repair/sandbox surfaces without
  running destructive actions.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/21-project-readonly-route.smoke.spec.ts`
  passed with 1 smoke test. The test opens the real Environments Settings page and verifies
  project recent/environments/path-existence routes without opening native dialogs.
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/22-window-readonly-route.smoke.spec.ts`
  passed with 1 smoke test. The test reads current window state from the real main and Settings
  renderers without changing window state.
- Focused ACP stability gate:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/17-acp-readonly-route.smoke.spec.ts --reporter=list`
  passed with 3 smoke tests.
- Focused Provider stability gate:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/18-provider-readonly-route.smoke.spec.ts`
  passed with 3 smoke tests.
- Focused SkillSync stability gate:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/19-skill-sync-readonly-route.smoke.spec.ts`
  passed with 3 smoke tests.
- Focused Data Security stability gate:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/20-data-security-readonly-route.smoke.spec.ts`
  passed with 3 smoke tests.
- Focused Device reset notification cleanup gate:
  `pnpm exec vitest run test/main/presenter/devicePresenter.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/DataSettings.test.ts --silent --reporter=dot`
  passed with 5 files / 103 tests, and
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/20-data-security-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after `pnpm exec electron-vite build`.
- Focused system notification click cleanup gate:
  `pnpm exec vitest run test/main/presenter/notificationPresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/components/App.startup.test.ts --silent --reporter=dot`
  passed with 4 files / 67 tests, and
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/09-main-ipc-boundary.smoke.spec.ts --workers=1`
  passed with 2 smoke tests after `pnpm exec electron-vite build`.
- Focused Ollama pull-progress cleanup gate:
  `pnpm exec vitest run test/main/presenter/llmProviderPresenter/ollamaManager.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/stores/ollamaStore.test.ts --silent --reporter=dot`
  passed with 4 files / 58 tests, and
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/18-provider-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after `pnpm exec electron-vite build`.
- Focused Skill catalog/session cleanup gate:
  `pnpm exec vitest run test/main/presenter/skillPresenter/skillPresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/components/McpIndicator.test.ts test/renderer/components/SkillsSettings.test.ts test/renderer/components/SkillEditorSheet.test.ts --silent --reporter=dot`
  passed with 5 files / 151 tests, and
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/16-skills-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after `pnpm exec electron-vite build`.
- Focused YoBrowser cleanup gate:
  `pnpm exec vitest run test/main/presenter/YoBrowserPresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/components/BrowserPanel.test.ts --silent --reporter=dot`
  passed with 4 files / 71 tests. `test/e2e/specs/08-browser-route.smoke.spec.ts` passed as part
  of the focused run after `pnpm exec electron-vite build`; `01-launch` and
  `06-settings-ipc-boundary` passed when rerun individually after a combined-run app fixture setup
  timeout.
- Focused Project stability gate:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/21-project-readonly-route.smoke.spec.ts`
  passed with 3 smoke tests.
- Focused Window stability gate:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/22-window-readonly-route.smoke.spec.ts`
  passed with 3 smoke tests.
- Combined stable user-flow gate:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/04-settings-navigation.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/07-floating-ipc-boundary.smoke.spec.ts test/e2e/specs/08-browser-route.smoke.spec.ts test/e2e/specs/09-main-ipc-boundary.smoke.spec.ts test/e2e/specs/10-settings-privacy-route.smoke.spec.ts test/e2e/specs/11-remote-control-readonly-route.smoke.spec.ts test/e2e/specs/12-knowledge-readonly-route.smoke.spec.ts test/e2e/specs/13-mcp-readonly-route.smoke.spec.ts test/e2e/specs/14-nowledgemem-config-route.smoke.spec.ts test/e2e/specs/15-dashboard-readonly-route.smoke.spec.ts --reporter=list`
  passed with 12 smoke tests after the e2e launcher main-window wait was increased to 60 seconds to
  avoid false cold-start failures in long sequential smoke runs.
- Candidate 13-smoke expansion including `16-skills-readonly-route.smoke.spec.ts` was run but is
  not promoted to stable yet: `01-launch` and `08-browser-route` hit Electron app setup timeouts in
  the long sequential run, while the same two specs passed when rerun individually and the focused
  `01 + 06 + 16` gate passed. This is tracked as e2e harness stability, not a skill route failure.
- Floating user-flow gate:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/07-floating-ipc-boundary.smoke.spec.ts --reporter=list`
  passed with 1 smoke test after verifying the real floating renderer window loads from bundled
  files in built/e2e mode, exposes only `floatingButtonAPI`, returns a valid widget snapshot, and
  does not expose broad `window.electron`, `window.deepchat`, or `api.ipcRenderer`.
- Browser route user-flow gate:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/08-browser-route.smoke.spec.ts --reporter=list`
  passed with 1 smoke test after loading a local `data:` page through `browser.loadUrl`, polling
  `browser.getStatus` until ready, receiving typed `browser.status.changed` events, and destroying
  the session browser. This deliberately avoids destructive sandbox clearing in the real profile.
- Upper-level docs now describe `src/renderer/api/legacy/**` as retired/deleted instead of an active
  quarantine. `docs/FLOWS.md` already describes the current typed chat stream and had no active
  legacy transport references.
- Focused Session/Conversation/Stream runtime cleanup:
  `AgentSessionPresenter` no longer double-sends old `session:*` renderer events; `AgentRuntimePresenter`,
  `dispatch`, `echo`, and `PendingInputCoordinator` publish `chat.stream.*`,
  `sessions.status.changed`, `sessions.pendingInputs.changed`, and the new
  `sessions.compaction.changed` typed event only; legacy `sessionPresenter` conversation/tab/message
  managers no longer broadcast unused `conversation:*` renderer channels; and
  `LifecycleManager.notifyMessage` no longer exposes a dynamic raw renderer escape hatch.
- Source scan now shows `eventBus.sendToRenderer` in runtime code only at
  `src/main/routes/publishDeepchatEvent.ts`, the typed event publisher. Source scans for old
  `conversation:*`, `stream:*`, and `session:*` renderer channel strings under `src/main` and
  `src/renderer` are clean.
- Focused session/runtime verification:
  `pnpm exec vitest run test/main/presenter/configPresenter/fontSizeSettings.test.ts test/main/presenter/agentSessionPresenter/agentSessionPresenter.test.ts test/main/presenter/agentRuntimePresenter/echo.test.ts test/main/presenter/agentRuntimePresenter/pendingInputCoordinator.test.ts test/main/presenter/agentRuntimePresenter/dispatch.test.ts test/main/presenter/agentRuntimePresenter/process.test.ts test/main/presenter/agentRuntimePresenter/agentRuntimePresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts --silent --reporter=dot`
  passed with 9 files / 339 tests before the final repository-wide format/lint/typecheck/build/e2e
  gate.
- Final session/runtime cleanup gate passed:
  `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm exec electron-vite build` all passed. Electron e2e `01-launch`, `09-main-ipc-boundary`,
  and `23-config-readonly-route` passed in the first focused run; `06-settings-ipc-boundary` hit an
  Electron app fixture setup timeout in that four-spec run, then passed when rerun alone, and
  `01-launch + 09-main-ipc-boundary` passed together with `--workers=1`.

## T16 - Final Presenter Event Sweep

- [x] Remove the remaining broad `eventBus.send(...)` usage from main/renderer source.
- [x] Delete `legacyTypedEventBridge` after every migrated publisher emits typed events directly.
- [x] Replace the last `sendToRenderer` runtime usage with `publishDeepchatEvent` only.
- [x] Remove dead window/tab renderer broadcasts with no consumer:
  `system-theme-updated`, `window:maximized`, `window:unmaximized`,
  `window:enter-full-screen`, `window:leave-full-screen`, `setActiveTab`,
  `update-window-tabs`, and `tab:title-updated`.
- [x] Keep only explicit secondary-window/private preload protocols:
  floating button `FLOATING_BUTTON_EVENTS.*`, splash/database-unlock startup channels,
  browser overlay activity, and ACP terminal envelopes sent to a concrete settings webContents.

Evidence:

- `rg "eventBus\\.send\\(" src/main src/renderer -g "*.ts" -g "*.vue"` is clean.
- `rg "legacyTypedEventBridge|setupLegacyTypedEventBridge" src/main test/main -g "*.ts"` is clean.
- `rg "setActiveTab|update-window-tabs|tab:title-updated|TITLE_UPDATED" src test -g "*.ts" -g "*.vue"`
  is clean after removing the dead tab IPC constants and sends.
- `rg "WINDOW_EVENTS|SYSTEM_EVENTS" src/renderer/src/events.ts src/renderer test/renderer -g "*.ts" -g "*.vue"`
  is clean after removing the renderer-side dead window/system event constants. Main-process
  `WINDOW_EVENTS.*` remain only as EventBus-internal presenter coordination for BrowserView bounds.
- `rg "webContents\\.send\\(" src/main/presenter -g "*.ts"` now reports only the private-window
  allowlist above, plus ACP terminal typed envelopes.
- Focused boundary gate:
  `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/api/preloadBoundaries.test.ts --silent --reporter=dot`
  passed with 4 files / 84 tests.
- Focused window gate:
  `pnpm exec vitest run test/main/presenter/windowPresenter.test.ts --silent --reporter=dot`
  passed with 1 file / 4 tests.
- User-flow e2e gate:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/07-floating-ipc-boundary.smoke.spec.ts test/e2e/specs/09-main-ipc-boundary.smoke.spec.ts test/e2e/specs/22-window-readonly-route.smoke.spec.ts test/e2e/specs/23-config-readonly-route.smoke.spec.ts --workers=1`
  passed with 6 tests after the e2e fixture was moved to an isolated temporary `userData` profile
  and seeded with completed onboarding state. The earlier failure mode was the local real profile's
  encrypted database splash blocking app startup, followed by first-run onboarding intercepting
  settings clicks in a blank profile.
- Full local smoke e2e:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/*.smoke.spec.ts --workers=1`
  passed with 26 tests and 3 skipped. The skipped tests are the live provider/chat integration
  checks (`02-chat-basic`, `03-session-persistence`, and `05-settings-provider`), which require
  `RUN_PROVIDER_INTEGRATION=true` plus a configured provider/model/API key outside the default
  isolated temporary profile.
- Final local gates after the renderer event cleanup and e2e fixture update:
  `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/api/preloadBoundaries.test.ts test/main/presenter/windowPresenter.test.ts --silent --reporter=dot`
  passed. `src/renderer/src/env.d.ts` now explicitly declares Vite env defaults, CSS imports,
  `?url` assets, and inline worker imports so `vue-tsgo` typecheck does not depend on implicit
  `vite/client` merge behavior.
- Full Vitest gate:
  `pnpm test -- --silent --reporter=dot` passed with 382 files passed, 6 skipped, 3192 tests
  passed, and 41 skipped. During this final run, stale test expectations were updated so
  AgentSession integration asserts typed `sessions.updated` / `chat.stream.completed` publication
  instead of retired `session:activated` / `stream:end` channels, and Config helper tests mock both
  `sendToMain` and typed renderer publication paths.

Side effect:

- TabPresenter still maintains its internal tab state, but no longer sends tab-list/title updates to
  the main renderer because there is no subscriber. If a tab shell UI is reintroduced later, define
  a shared typed event contract first instead of reusing raw tab channels.
- Floating, splash, and browser-overlay IPC remain intentionally scoped to their preload APIs. A
  future convergence pass can move them onto `DEEPCHAT_EVENT_CHANNEL`, but that should be done as a
  secondary-renderer contract migration with dedicated preload/e2e coverage rather than as a
  presenter-only edit.
- Electron e2e now sets `DEEPCHAT_E2E_USER_DATA_DIR` to a temporary directory by default. This keeps
  smoke tests deterministic and avoids reading or modifying the developer's real DeepChat profile,
  including encrypted database state and onboarding progress.
- Live chat/provider smoke tests no longer run by default under the temporary profile. Run them with
  `RUN_PROVIDER_INTEGRATION=true` and an explicit configured e2e profile/provider when verifying
  real external model behavior.

Final manual gate:

- Complete all manual checks listed in `plan.md`.
