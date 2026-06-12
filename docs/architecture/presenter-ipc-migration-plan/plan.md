# Presenter IPC Migration Completion - Plan

## Target Architecture

```text
Renderer UI / stores / settings
  -> renderer/api domain clients
  -> window.deepchat.invoke/on
  -> shared/contracts routes + events
  -> src/main/routes handlers/services
  -> narrow presenter-backed ports
  -> presenter runtime owners
```

Rules for the remaining migration:

- Route and client names should follow product domains (`RemoteControlClient`, `KnowledgeClient`,
  `SkillSyncClient`) rather than presenter class names.
- `EventBus` may remain internal to main, but renderer-visible events should be emitted with
  `publishDeepchatEvent`.
- Long-running operations need explicit progress events or task IDs; do not rely on raw
  `eventBus.sendToRenderer` channels.
- Avoid exposing broad utility methods from `windowPresenter`, `configPresenter`, or
  `llmproviderPresenter`. Add narrow commands instead.

## Phase 0 - Make The Guard Honest

Status: complete for the active migration. The guard now scans settings, forbids renderer business
imports from `@api/legacy/**`, treats a recreated `src/renderer/api/legacy/**` directory as a
regression, has fixture tests for settings legacy/raw IPC, and the baseline reports show zero
renderer legacy counts.

Update the migration guard before migrating individual presenters:

| Change | Files |
| --- | --- |
| Add renderer roots to scan: settings, splash, floating, browser overlay, plugin settings | `scripts/architecture-guard.mjs`, `scripts/generate-architecture-baseline.mjs` | Done for settings/business roots and regenerated baseline |
| Keep allowlists explicit for `src/renderer/api/runtime.ts` and specialized preloads | same scripts | Done for the active guard |
| Add phase gates for settings renderer legacy counts | same scripts plus baseline JSON/MD | Done |
| Add tests that a fixture under settings fails on `useLegacyPresenter` and raw IPC | `test/main` or script tests | Done |

Side effect: the guard will initially fail. Land this with a temporary baseline or bridge register
that lists every active exception from `audit.md`, then remove exceptions as each phase lands.

## Presenter-by-Presenter Migration Plan

### `configPresenter`

Current legacy methods:

- ACP: `getAcpEnabled`, `setAcpEnabled`, `listAcpRegistryAgents`, `refreshAcpRegistry`,
  `ensureAcpAgentInstalled`, `repairAcpAgent`, `uninstallAcpRegistryAgent`,
  `setAcpAgentEnabled`, `setAcpAgentEnvOverride`, `listManualAcpAgents`, `addManualAcpAgent`,
  `updateManualAcpAgent`, `removeManualAcpAgent`.
- DeepChat agents: `listAgents`, `createDeepChatAgent`, `updateDeepChatAgent`,
  `deleteDeepChatAgent`, `getSystemPrompts`.
- Settings helpers: `getSetting`, `setSetting`, `getProxyMode`, `setProxyMode`,
  `getCustomProxyUrl`, `setCustomProxyUrl`, `getUpdateChannel`, `setUpdateChannel`,
  `openLoggingFolder`, `refreshProviderDb`.
- Hooks: `getHooksNotificationsConfig`, `setHooksNotificationsConfig`, `testHookCommand`.
- Skill draft suggestions: `getSkillDraftSuggestionsEnabled`,
  `setSkillDraftSuggestionsEnabled`.

Target:

- Extend existing `ConfigClient` where a compatible route already exists.
- Add narrow route groups for missing domains:
  - `config.acp.*` for ACP registry/manual-agent lifecycle.
  - `config.agents.create/update/delete` for DeepChat agent CRUD.
  - `config.hooksNotifications.get/set/test`.
  - `config.proxy.get/set`, `config.updateChannel.get/set`, `config.openLoggingFolder`.
  - Move `refreshProviderDb` to a provider/database route if possible, because it is not general
    config editing.
- Replace `CONFIG_EVENTS.AGENTS_CHANGED` direct listener in `AcpSettings.vue` with
  `ConfigClient.onAgentsChanged`.

Tests:

- Contract schema tests for ACP agent install state, manual agent input, hooks config, proxy mode.
- Route handler tests with mocked `configPresenter`.
- Renderer client tests for new methods.
- Component tests for `AcpSettings`, `DeepChatAgentsSettings`, `NotificationsHooksSettings`,
  proxy/logging/default-model sections.

Side effects:

- ACP install/repair/uninstall can be slow and writes to runtime directories. Preserve existing
  progress/state semantics and avoid route timeouts.
- Hooks config may contain command strings; schema should preserve existing values but reject
  malformed structures.
- Proxy changes trigger main-process network side effects through existing `CONFIG_EVENTS`.

Manual validation:

- Toggle ACP globally, install/repair/uninstall one registry agent, add/edit/remove one manual ACP
  agent, and confirm agent list refreshes in settings and new-thread surfaces.
- Create/edit/delete a DeepChat agent and verify session creation still resolves its config.
- Change proxy mode/custom URL and verify provider test connection uses the new proxy state.
- Open logging folder from settings on macOS/Windows/Linux.

### `llmproviderPresenter`

Current legacy methods:

- `getKeyStatus`, `refreshModels`.
- `getDimensions`.
- `syncModelScopeMcpServers`.
- `getProviderRateLimitStatus`, `updateProviderRateLimit`.
- `runAcpDebugAction`.

Target:

- Use existing `ProviderClient.refreshModels` and `ProviderClient.getProviderRateLimitStatus`
  where possible.
- Add:
  - `providers.getKeyStatus`.
  - `providers.updateRateLimit`.
  - `models.getEmbeddingDimensions` or extend `models.getCapabilities` if dimensions belong there.
  - `providers.modelScope.syncMcpServers`.
  - `providers.acp.debug.run` plus typed `providers.acp.debug.event`.
- Replace `RATE_LIMIT_EVENTS.*` and `ACP_DEBUG_EVENTS.EVENT` raw listeners with typed events.

Tests:

- Provider route handler tests for key status, rate-limit update, ModelScope sync, ACP debug action.
- Event contract tests for rate-limit and ACP debug events.
- Renderer tests for `ProviderApiConfig`, `ProviderRateLimitConfig`, `ModelScopeMcpSync`,
  `AcpDebugDialog`.

Side effects:

- Key status and ACP debug may touch credentials or subprocess state. Route outputs must stay
  redacted.
- Rate-limit events can be frequent; keep payload small and versioned.
- Model refresh can hit external providers; tests should mock provider runtime.

Manual validation:

- Refresh models for one configured provider.
- Toggle provider rate limiting and confirm queued/executed counters update.
- Run ACP debug action and confirm the debug dialog receives live logs without leaking secrets.

### `devicePresenter`

Current legacy methods:

- `getDeviceInfo`, `getAppVersion`, `selectDirectory`, `selectFiles`, `resetDataByType`.

Target:

- Replace `getDeviceInfo`, `getAppVersion`, and `selectDirectory` with existing `DeviceClient`.
- Add `device.selectFiles`.
- Add `device.resetDataByType` or a more explicit `data.reset` route.
- Move direct clipboard/open-external/file-path calls in components to `DeviceClient`,
  `BrowserClient`, or `FileClient` runtime wrappers.

Tests:

- Device route contract and handler tests.
- Renderer tests for file selection and data reset UI.

Side effects:

- `resetDataByType` is destructive. Route should require an explicit reset type enum and keep the
  existing confirmation UI unchanged.
- Native file dialogs are hard to automate; unit-test the route and manually verify dialog behavior.

Manual validation:

- Select files in skill install and knowledge file flows.
- Reset chat/config/knowledge data in a disposable profile and confirm app restarts or refreshes as
  expected.

### `windowPresenter`

Current legacy methods and patterns:

- `closeSettingsWindow`, `focusMainWindow`, `setPendingSettingsProviderInstall`,
  `consumePendingSettingsProviderInstall`, `sendToAllWindows`.
- Raw settings events: navigation, provider install preview, settings ready, update check.
- Several settings pages pass `windowPresenter` only to guided onboarding helpers.

Target:

- Replace onboarding helper dependency with `WindowClient.focusMainWindow` or a narrow
  `system.focusMainWindow` route.
- Add explicit settings routes/events:
  - `settings.closeCurrentWindow`.
  - `settings.providerInstall.consumePending`.
  - `settings.providerInstall.requested` typed event.
  - `settings.navigation.requested` typed event or use existing `system.openSettings`.
- Do not expose `sendToAllWindows`. Replace update check with `UpgradeClient.check` or a narrow
  `upgrade.check` call.
- Remove unused `windowPresenter` injections from settings pages.

Tests:

- Route context tests for current-window behavior using `webContentsId/windowId`.
- Settings app tests for navigation/provider install preview.
- Guided onboarding tests with a mocked narrow focus function.

Side effects:

- Settings is a separate BrowserWindow. Current-window routes must use the invoking webContents,
  not whichever main window is focused.
- Provider deeplink preview must still arrive if settings opens after the deeplink is received.

Manual validation:

- Open settings from main, navigate to provider/model/MCP/skills guided onboarding steps, then return
  focus to main.
- Trigger `deepchat://provider/install` and confirm preview opens in settings.
- Check for updates from About settings.

### `skillSyncPresenter`

Current legacy methods:

- `scanExternalTools`, `getNewDiscoveries`, `acknowledgeDiscoveries`, `getRegisteredTools`,
  `previewImport`, `executeImport`, `previewExport`, `executeExport`.
- Raw events: `SKILL_SYNC_EVENTS.NEW_DISCOVERIES`, scan/import/export progress.

Target:

- Add `skillSync.*` routes and `SkillSyncClient`.
- Add typed events:
  - `skillSync.discoveries.changed`.
  - `skillSync.scan.started/completed`.
  - `skillSync.import.progress/completed`.
  - `skillSync.export.progress/completed`.
- Keep payloads based on `@shared/types/skillSync`, but add route schemas for tool IDs, skill names,
  conflict strategy, export target, and result envelopes.

Tests:

- Route contract tests for import/export inputs.
- Handler tests with mocked scanner/converter.
- Renderer tests for sync prompt, status section, import wizard, export wizard.

Side effects:

- Import/export writes files outside app data. Preserve existing permission and path validation.
- Worker fallback behavior must stay the same.

Manual validation:

- Scan installed external tools.
- Import one skill with each conflict option in a temporary skills directory.
- Export one active skill to at least one supported external tool format.

### `projectPresenter`

Current legacy methods:

- `getRecentProjects`, `selectDirectory`, `pathExists`.

Target:

- Replace recent projects and directory selection with existing `ProjectClient.listRecent` and
  `ProjectClient.selectDirectory`.
- Add `project.pathExists`.

Tests:

- Project route handler test for `pathExists`.
- Renderer tests for environment/default workdir validation.

Side effects:

- `pathExists` can leak local filesystem existence. Keep it a user-initiated settings route and avoid
  returning extra metadata.

Manual validation:

- Remote-control default workdir picker and environment settings path validation.

### `knowledgePresenter`

Current legacy methods:

- `isSupported`, `getSupportedLanguages`, `getSeparatorsForLanguage`, `getSupportedFileExtensions`,
  `validateFile`, `addFile`, `deleteFile`, `reAddFile`, `listFiles`, `similarityQuery`,
  `pauseAllRunningTasks`, `resumeAllPausedTasks`.
- Raw events: `RAG_EVENTS.FILE_UPDATED`, `RAG_EVENTS.FILE_PROGRESS`.

Target:

- Add `knowledge.*` routes and `KnowledgeClient`.
- Add typed events:
  - `knowledge.file.updated`.
  - `knowledge.file.progress`.
- Reuse existing `config.getKnowledgeConfigs` / `config.setKnowledgeConfigs` for config list editing,
  but move runtime file/index operations to `KnowledgeClient`.

Tests:

- Route contract tests for file IDs, knowledge base IDs, query string, validation result.
- Main tests using mocked `knowledgePresenter` and `filePresenter`.
- Renderer tests for knowledge file upload/list/progress.

Side effects:

- File ingestion can trigger embeddings and vector DB writes. Keep operation status visible and avoid
  large progress payloads.
- Similarity query can expose indexed content. Preserve current UI-only access pattern.

Manual validation:

- Add a supported file, watch progress, pause/resume, re-add, delete, and run a similarity query.
- Verify unsupported file handling and file-size validation.

### `agentSessionPresenter`

Current legacy methods:

- `getAgents`, `getUsageDashboard`, `retryRtkHealthCheck`.

Target:

- Replace `getAgents` with existing `SessionClient.getAgents` or `ConfigClient.listAgents`,
  depending on UI need.
- Add `sessions.usageDashboard.get`.
- Add `sessions.rtkHealth.retry`.

Tests:

- Route handler tests for dashboard aggregation and RTK retry dispatch.
- Dashboard settings component tests.

Side effects:

- Usage dashboard may scan many sessions. Preserve pagination/aggregation performance.
- RTK health retry may start background checks; keep it explicit and user-triggered.

Manual validation:

- Open dashboard settings with a non-empty history.
- Trigger RTK health retry and verify status updates or logs.

### `remoteControlPresenter`

Current legacy methods:

- Generic channel methods: `listRemoteChannels`, `getChannelSettings`, `saveChannelSettings`,
  `getChannelStatus`, `getChannelBindings`, `removeChannelBinding`, `removeChannelPrincipal`,
  `getChannelPairingSnapshot`, `createChannelPairCode`, `clearChannelPairCode`.
- Legacy channel-specific methods still used by compatibility code for Telegram and Weixin iLink.
- `RemoteControlRuntime.ts` wraps `remoteControlPresenter:call`.

Target:

- Add `remoteControl.*` routes and `RemoteControlClient`.
- Prefer generic channel routes over channel-specific renderer methods:
  - `remoteControl.listChannels`
  - `remoteControl.getSettings`
  - `remoteControl.saveSettings`
  - `remoteControl.getStatus`
  - `remoteControl.listBindings`
  - `remoteControl.removeBinding`
  - `remoteControl.removePrincipal`
  - `remoteControl.getPairingSnapshot`
  - `remoteControl.createPairCode`
  - `remoteControl.clearPairCode`
  - `remoteControl.weixinIlink.startLogin/waitLogin/removeAccount/restartAccount`
- Delete `RemoteControlRuntime.ts` after `RemoteSettings.vue` uses the typed client.

Tests:

- Route schema tests for discriminated channel payloads.
- Handler tests with mocked `remoteControlPresenter`.
- Renderer tests for Telegram/Feishu/QQBot/Discord/Weixin settings panels.

Side effects:

- Remote control stores credentials and account bindings. Outputs must be redacted.
- Weixin login wait is long-running; route should support timeout and cancellation semantics.
- Some channels require network access and cannot be fully automated.

Manual validation:

- Telegram: save token, create/clear pair code, bind/unbind a chat.
- Feishu/QQBot/Discord: toggle remote control settings and verify status display.
- Weixin iLink: start login, wait for success/failure, restart/remove account.

### `skillPresenter`

Current legacy method:

- `readSkillFile`.

Target:

- Add `skills.readFile` or extend `SkillClient` with a read method.
- Keep name validation and path resolution inside `skillPresenter`; renderer passes only skill name.

Tests:

- Route schema rejects empty/traversal-like names.
- Skill editor test loads content through `SkillClient`.

Side effects:

- Reading arbitrary files must not be exposed. Only skill-owned files should be reachable.

Manual validation:

- Open an installed skill in the editor, edit, save, and reopen.

### `mcpPresenter`

Current legacy methods:

- MCP Router market helpers: `getMcpRouterApiKey`, `setMcpRouterApiKey`,
  `updateMcpRouterServersAuth`, `isServerInstalled`, `listMcpRouterServers`,
  `installMcpRouterServer`.

Target:

- Add `mcp.router.*` routes and `McpClient` methods.
- Keep API key storage and server install logic in main.
- Use existing MCP typed events for config/server status changes where possible.

Tests:

- Route handler tests for API key read/write with redaction as needed.
- Market install tests with mocked router manager/network.

Side effects:

- MCP Router calls can hit network and persist credentials.
- Installing a server modifies MCP config and can start/stop server processes.

Manual validation:

- Save MCP Router API key, list market servers, install one server, verify it appears in MCP settings.

### `exporter` / NowledgeMem

Current legacy methods:

- `getNowledgeMemConfig`, `updateNowledgeMemConfig`, `testNowledgeMemConnection`.

Target:

- Add `nowledgeMem.getConfig`, `nowledgeMem.updateConfig`, `nowledgeMem.testConnection` routes and
  a `NowledgeMemClient`, or place them under an `export` route group if preferred.

Tests:

- Route schema bounds timeout and URL fields.
- Handler tests mock `exporter`.
- Renderer test for `NowledgeMemSettings`.

Side effects:

- Test connection performs network I/O. Unit tests must mock it; manual validation should use a local
  disposable endpoint.

Manual validation:

- Save config, test connection success/failure, reload settings and confirm persistence.

### `filePresenter`

Current legacy methods:

- `getMimeType`, `prepareFile`.

Target:

- Replace with existing `FileClient.getMimeType` and `FileClient.prepareFile`.

Tests:

- Component test for prompt editor file upload can mock `FileClient`.

Side effects:

- None expected if method semantics are preserved.

Manual validation:

- Attach a prompt file and confirm text extraction/preview still works.

### `toolPresenter`

Current legacy method:

- `getAllToolDefinitions`.

Target:

- Replace with existing `ToolClient.getAllToolDefinitions`.

Tests:

- DeepChat agent settings component test with disabled tool selections.

Side effects:

- Tool definitions depend on MCP config and agent mode; make sure the typed call passes the same
  context as the legacy call.

Manual validation:

- Open DeepChat agent settings and toggle disabled agent tools.

### `sqlitePresenter`

Current legacy method:

- `repairSchema`.

Target:

- Add a narrow `database.repairSchema` or `databaseSecurity.repairSchema` route. Keep it separate
  from encryption routes if the semantics are operational repair rather than security.

Tests:

- Handler test with mocked repair report.
- Data settings component test for repair result display.

Side effects:

- Repair can mutate local database schema. Manual validation should use a copied test profile.

Manual validation:

- Trigger repair on a disposable profile and verify the report UI.

### `yoBrowserPresenter`

Current legacy method:

- `clearSandboxData`.

Target:

- Add `browser.clearSandboxData` to `BrowserClient`.

Tests:

- Browser route handler test with mocked presenter.
- Data settings component test.

Side effects:

- Clears browser sandbox/cache. Make the destructive action explicit in UI.

Manual validation:

- Clear sandbox data and verify browser sessions start cleanly.

### `oauthPresenter`

Current legacy methods:

- `startGitHubCopilotLogin`, `startGitHubCopilotDeviceFlowLogin`.

Target:

- Add `oauth.githubCopilot.startLogin` and `oauth.githubCopilot.startDeviceFlowLogin`, or place them
  under provider auth routes if provider ownership is preferred.
- Keep OAuth callback/deeplink handling in main.

Tests:

- Route handler tests with mocked `oauthPresenter`.
- Renderer test for `GitHubCopilotOAuth`.

Side effects:

- Opens external auth flow and writes credentials. Unit tests must mock shell/deeplink behavior.

Manual validation:

- Run both GitHub Copilot auth flows in a disposable account or mocked auth environment.

### `shortcutPresenter`

Current legacy methods:

- `registerShortcuts`, `destroy` through `ShortcutRuntime`.

Target:

- Prefer removing renderer control if main lifecycle already owns shortcut registration.
- If renderer control is still required, add narrow `shortcuts.register` and `shortcuts.unregister`
  routes and replace `ShortcutRuntime`.

Tests:

- Shortcut store test confirms it calls typed client or no longer calls main.
- Existing `shortcutPresenter` main tests stay as runtime behavior coverage.

Side effects:

- Global shortcuts affect the OS. Avoid duplicate registration when app focus changes.

Manual validation:

- Change shortcut settings, blur/focus app, and confirm shortcuts work once without duplicates.

## Event Migration Plan

| Raw event | Target |
| --- | --- |
| `STREAM_EVENTS.END/ERROR` fallback in `messageIpc.ts` | Remove after all terminal refresh paths publish `chat.stream.completed/failed`; add typed event for `emitMessageRefresh` if needed |
| `context-menu-translate`, `context-menu-ask-ai` | Add typed context-menu event or a narrow preload API; keep DOM CustomEvent inside renderer |
| `SETTINGS_EVENTS.NAVIGATE`, `SETTINGS_EVENTS.PROVIDER_INSTALL` | `settings.navigation.requested`, `settings.providerInstall.requested` typed events |
| `NOTIFICATION_EVENTS.SHOW_ERROR`, database repair suggested | Typed notification/settings events or explicit settings store action |
| `CONFIG_EVENTS.AGENTS_CHANGED` | Existing `config.agents.changed` |
| `ACP_DEBUG_EVENTS.EVENT` | `providers.acp.debug.event` |
| `RAG_EVENTS.FILE_UPDATED/FILE_PROGRESS` | `knowledge.file.updated/progress` |
| `RATE_LIMIT_EVENTS.*` | `providers.rateLimit.*` typed events |
| `SKILL_SYNC_EVENTS.*` | `skillSync.*` typed events |
| `skill:installed/uninstalled/metadata-updated` | Existing `skills.catalog.changed` |
| `acp-init:*`, `external-deps-required`, `acp-terminal:*` | ACP init/terminal typed specialized API or route/event group |

## Verification Strategy

Automated gates after each implementation PR:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm test -- test/main/routes test/main/contracts test/renderer/api
pnpm test -- test/renderer/components/<affected-component>.test.ts
node scripts/architecture-guard.mjs
```

Manual verification is required for:

- Native file/directory dialogs.
- OAuth login/device flow.
- ACP agent install/repair/uninstall and terminal interaction.
- Remote-control channel login/pairing with real services.
- Database reset/repair on a copied profile.
- Floating widget drag/open-session behavior.
- Splash database unlock flow.
