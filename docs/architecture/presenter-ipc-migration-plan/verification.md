# Presenter IPC Migration Verification Plan

> Status: active execution checklist. Run the relevant slice after each presenter/domain migration,
> then run the full gate before declaring the legacy transport retired.

## Verification Levels

| Level | When to run | Required evidence |
| --- | --- | --- |
| Slice contract | Every new route/event/client | Contract schemas reject invalid payloads and accept valid legacy-equivalent payloads |
| Slice unit | Every changed main route/service/presenter adapter | Route handler calls the intended presenter method and returns typed output |
| Slice renderer | Every changed settings/component/store surface | Component/store uses typed client and keeps old UI behavior |
| Static gate | Every migration PR | No new legacy IPC outside allowlists; lint/typecheck pass |
| User-flow gate | After a slice passes static tests | E2E/manual checks for native dialogs, OAuth, ACP, remote channels, DB repair, or long-running tasks |
| Final gate | Before deleting legacy transport | All slice gates plus full `pnpm test` and zero business legacy hits |

## Standard Commands

Run after every code migration slice:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```

Run targeted tests for the touched slice:

```bash
pnpm test -- test/main/routes
pnpm test -- test/main/contracts
pnpm test -- test/renderer/api
pnpm test -- test/renderer/components/<affected-component>.test.ts
pnpm test -- test/renderer/stores/<affected-store>.test.ts
```

Run final transport-removal evidence:

```bash
rg "useLegacyPresenter|useLegacyRemoteControlPresenter|useLegacyShortcutPresenter" src/renderer
rg "@api/legacy|legacy/presenters|legacy/runtime" src
rg "presenter:call|remoteControlPresenter:call" src/main src/renderer
rg "DISPATCHABLE_PRESENTERS|REMOTE_CONTROL_METHODS|src/renderer/api/legacy" src/main src/renderer src/preload
node scripts/architecture-guard.mjs
pnpm test
```

Run smoke-level Electron user flows after a successful build:

```bash
pnpm exec playwright test -c test/e2e/playwright.config.ts \
  test/e2e/specs/01-launch.smoke.spec.ts \
  test/e2e/specs/04-settings-navigation.smoke.spec.ts \
  --reporter=list \
  --workers=1
```

Use `--workers=1` when combining Electron e2e specs because DeepChat enforces a single running app
instance with `SingletonLock`. Parallel workers can fail during launch even when the route behavior
under test is healthy.

Current raw IPC allowlist after transport retirement:

- `src/preload/createBridge.ts` because it is the typed bridge implementation.
- `src/preload/index.ts` for the current synchronous window/webContents id bridge and the narrow
  `window.api` runtime helpers still consumed through `src/renderer/api/runtime.ts`.
- `src/preload/plugin-settings-preload.ts` because it wraps `createBridge(ipcRenderer)` behind
  the specialized `window.deepchatPlugin` API.
- `src/preload/splash-preload.ts` for startup database unlock before the full route runtime is
  guaranteed available; renderer code must use `window.deepchatSplash`.
- `src/preload/floating-preload.ts` for the floating widget specialized API with shared channels,
  scoped unsubscribe, and payload validation.
- `src/preload/browser-overlay-preload.ts` for browser overlay activity with shared event schema
  validation.

Any new hit outside these paths should be treated as a migration regression.

## Presenter Slice Matrix

| Slice | Automated verification | User-flow / E2E verification |
| --- | --- | --- |
| Guard coverage | Script tests or fixture proving settings legacy usage fails guard; `node scripts/architecture-guard.mjs` with current baseline | None |
| Existing-client replacements | Affected renderer component tests; `test/renderer/api/clients.test.ts` if client changed | File picker, prompt file import, remote default workdir selection |
| `configPresenter` | Config route contract tests, handler tests, ACP/agent/settings component tests | ACP toggle/install/repair/uninstall/manual CRUD; DeepChat agent advanced editing; proxy/update channel/logging folder |
| `llmproviderPresenter` | Provider/model route tests, ACP debug/rate-limit event tests, affected component tests; Provider settings read-only e2e | Refresh models; update rate limit; ACP debug run; GitHub Copilot auth |
| `devicePresenter` | Device/data route tests, affected component tests; Data Settings device read-only e2e | Native select files/directories; destructive data reset in disposable profile |
| `windowPresenter` | Context-aware route tests, settings app/provider deeplink tests; main/settings window-state read-only e2e | Settings navigation, provider install deeplink preview, focus/minimize/maximize/close flows |
| `skillSyncPresenter` | Skill sync route/event tests, import/export wizard tests; SkillSync settings read-only route/event e2e | Import/export with conflict handling |
| `projectPresenter` | Project route tests, environment/remote settings tests; Environments settings read-only e2e | Missing default workdir validation, native path picker, and open directory |
| `knowledgePresenter` | Knowledge route/event tests, knowledge settings tests | Add/delete/re-add file, progress, pause/resume, similarity query |
| `agentSessionPresenter` | Dashboard/RTK route tests, dashboard settings tests | Dashboard display and RTK retry |
| `remoteControlPresenter` | Channel route schema/handler tests, remote settings tests | Telegram pair/bind/unbind; Feishu/QQBot/Discord settings; Weixin iLink login |
| `skillPresenter` | `skills.readFile` route and editor tests | Open/edit/save/reopen installed skill |
| `mcpPresenter` | MCP Router route tests with mocked network | Save key, list market, install server |
| `exporter` / NowledgeMem | NowledgeMem route tests and settings tests | Save config, test success/failure, reload settings |
| `sqlitePresenter` | Database repair route tests; Data Settings database-status read-only e2e | Repair copied profile and inspect report |
| `yoBrowserPresenter` | Browser sandbox route tests; Data Settings sandbox surface e2e | Clear sandbox and confirm fresh browser state |
| `oauthPresenter` | OAuth route tests with mocked shell/deeplink | GitHub Copilot login/device flow |
| `shortcutPresenter` | Shortcut store/client tests; existing main shortcut tests | Global shortcuts register once after focus changes |
| Secondary renderers | Preload/API tests for splash/floating/browser overlay/plugin settings | Splash DB unlock; floating drag/open session/theme/language; browser overlay activity |

## Current Verification Snapshot

Last updated: 2026-06-13.

Passed:

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run build`
- Full `pnpm test -- --silent --reporter=dot`: 376 files passed, 6 skipped; 3175 tests passed,
  41 skipped. The final full run used the project-level Vitest `maxWorkers: 2` setting to avoid
  false cold-start timeouts in large renderer component suites.
- Focused migration gate covering preload boundaries, floating presenter, browser overlay, route
  contracts, architecture guard, deeplink/error handlers, skill sync, splash, ACP debug, and message
  stream store: 13 files / 130 tests passed after the latest splash preload boundary addition.
- `pnpm exec vitest run test/renderer/api/preloadBoundaries.test.ts --silent --reporter=dot`
  passed with 1 file / 4 tests. The added splash case verifies that `window.deepchatSplash` exposes
  only the dedicated splash update/unlock methods, uses scoped `database-security:*` channels,
  returns unsubscribe functions, and rejects malformed submit/cancel payloads.
- Electron smoke e2e for launch and settings navigation: 2 tests passed.
- Electron settings IPC boundary e2e:
  `test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts` passed with 1 test. It checks the real
  settings renderer has `window.deepchat.invoke/on`, does not expose broad
  `window.electron` / `api.ipcRenderer`, rejects `presenter:call` as an unknown route, and opens
  migrated knowledge, skills, remote, MCP, and data settings surfaces.
- Electron floating IPC boundary e2e:
  `test/e2e/specs/07-floating-ipc-boundary.smoke.spec.ts` passed with 1 test. It toggles the real
  floating window through the typed config route, restores the previous user setting, checks the
  floating renderer loads in built/e2e mode, and verifies the scoped `floatingButtonAPI` boundary.
- Electron browser route e2e:
  `test/e2e/specs/08-browser-route.smoke.spec.ts` passed with 1 test. It exercises
  `browser.loadUrl`, `browser.getStatus`, typed `browser.status.changed`, and `browser.destroy`
  against a local `data:` page without clearing real profile sandbox data.
- Focused YoBrowser cleanup e2e:
  `test/e2e/specs/08-browser-route.smoke.spec.ts` passed after rebuilding and verifies typed
  browser route/event behavior. `test/e2e/specs/01-launch.smoke.spec.ts` and
  `test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts` also passed when rerun individually. The
  combined 3-spec run hit an app fixture setup timeout in `06-settings-ipc-boundary`, so the
  combination is not promoted as stable evidence for this slice.
- Electron main renderer IPC boundary e2e:
  `test/e2e/specs/09-main-ipc-boundary.smoke.spec.ts` passed with 1 test. It checks the real main
  chat renderer has `window.deepchat.invoke/on`, can call the typed `device.getAppVersion`,
  `remoteControl.listChannels`, and `remoteControl.getChannelStatus` routes, does not expose broad
  `window.electron` / `api.ipcRenderer`, and rejects `presenter:call` as an unknown route.
- Electron Data Settings privacy mode e2e:
  `test/e2e/specs/10-settings-privacy-route.smoke.spec.ts` passed with 1 test. It opens the real
  Data Settings page, toggles the Privacy Mode switch through the UI, verifies
  `settings.getSnapshot` reflects the typed `settings.update` result, and restores the original
  `privacyModeEnabled` value before exit.
- Electron Remote Control read-only route e2e:
  `test/e2e/specs/11-remote-control-readonly-route.smoke.spec.ts` passed with 1 test. It opens the
  real Remote Settings page, verifies the visible channel tabs for Telegram, Feishu, QQBot, Discord,
  and Weixin iLink, then reads `remoteControl.listChannels`, `getChannelSettings`,
  `getChannelStatus`, and `getChannelBindings` for every channel without requiring live accounts or
  mutating remote-control config.
- Focused Remote Control runtime cleanup e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `09-main-ipc-boundary.smoke.spec.ts`, and
  `11-remote-control-readonly-route.smoke.spec.ts` passed together with 3 tests using
  `--workers=1` after deleting `src/renderer/api/RemoteControlRuntime.ts` and moving the main
  `WindowSideBar` to `RemoteControlClient`.
- Focused Upgrade typed-event cleanup:
  `pnpm exec vitest run test/main/presenter/upgradePresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/components/AboutUsSettings.test.ts --silent --reporter=dot`
  passed with 4 files / 64 tests. The legacy renderer-visible
  `update:status-changed`, `update:error`, `update:progress`, and `update:will-restart` raw channels
  no longer appear in source or test code; `UPDATE_EVENTS` only keeps the main-internal
  `update:state-changed` lifecycle signal.
- Focused Dialog typed-event cleanup:
  `pnpm exec vitest run test/main/presenter/dialogPresenter.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/stores/dialogStore.test.ts --silent --reporter=dot`
  passed with 5 files / 82 tests. `DialogPresenter.showDialog` no longer sends the retired
  `dialog:request` raw event, renderer dialog state opens from typed `dialog.requested`, and dialog
  responses still return through `dialog.respond` / `dialog.error` routes.
- Focused Workspace invalidation cleanup:
  `pnpm exec vitest run test/main/presenter/workspacePresenter.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts --silent --reporter=dot`
  passed with 4 files / 94 tests. Workspace watchers no longer send the retired
  `workspace:files-changed` raw event; watcher invalidations are delivered as typed
  `workspace.invalidated` events.
- Focused Device reset completion cleanup:
  `pnpm exec vitest run test/main/presenter/devicePresenter.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/DataSettings.test.ts --silent --reporter=dot`
  passed with 5 files / 103 tests. The development reset completion path now publishes typed
  `appRuntime.dataResetCompleteDev` directly, the `WindowPresenter` legacy-channel translation case
  was removed, and source scan
  `rg "DATA_RESET_COMPLETE_DEV|notification:data-reset-complete-dev" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. The destructive reset itself remains excluded from automated e2e and must be
  verified in a disposable profile.
- Focused system notification click cleanup:
  `pnpm exec vitest run test/main/presenter/notificationPresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/components/App.startup.test.ts --silent --reporter=dot`
  passed with 4 files / 67 tests. Electron notification clicks now publish typed
  `appRuntime.systemNotificationClicked` directly with the existing `{ payload: id }` payload shape;
  the `WindowPresenter` legacy-channel translation case and `NOTIFICATION_EVENTS` constants were
  removed. Source scan
  `rg "NOTIFICATION_EVENTS|notification:sys-notify-clicked|SYS_NOTIFY_CLICKED" src/main src/renderer -g '*.ts' -g '*.vue'`
  returns no hits. Real OS notification display/click remains a platform manual check.
- Focused Ollama pull-progress cleanup:
  `pnpm exec vitest run test/main/presenter/llmProviderPresenter/ollamaManager.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/stores/ollamaStore.test.ts --silent --reporter=dot`
  passed with 4 files / 58 tests. Pull progress now emits only typed
  `providers.ollama.pull.progress`; the old `ollama:pull-model-progress` constants were removed
  from main and renderer event files. Source scan
  `rg "OLLAMA_EVENTS|ollama:pull-model-progress|PULL_MODEL_PROGRESS" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. Real model pulls remain an opt-in/manual check because they require a live Ollama
  daemon and download or reuse local model data.
- Focused Skill catalog/session cleanup:
  `pnpm exec vitest run test/main/presenter/skillPresenter/skillPresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/components/McpIndicator.test.ts test/renderer/components/SkillsSettings.test.ts test/renderer/components/SkillEditorSheet.test.ts --silent --reporter=dot`
  passed with 5 files / 151 tests. `SkillPresenter` no longer sends retired `skill:*` raw events;
  discovery, install/uninstall, session activation/deactivation, and watcher metadata changes are
  delivered through typed `skills.catalog.changed` and `skills.session.changed`. Source scan
  `rg "SKILL_EVENTS|skill:activated|skill:deactivated|skill:discovered|skill:installed|skill:uninstalled|skill:metadata-updated" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. Real skill install/edit/uninstall flows remain manual or dedicated e2e because
  they write skill files.
- Focused YoBrowser lifecycle/open cleanup:
  `pnpm exec vitest run test/main/presenter/YoBrowserPresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/components/BrowserPanel.test.ts --silent --reporter=dot`
  passed with 4 files / 71 tests. `YoBrowserPresenter` no longer sends retired `yo-browser:*` raw
  events; lifecycle/open/activity updates are delivered through typed `browser.status.changed`,
  `browser.open.requested`, and `browser.activity.changed`. The old window-count event had no
  business consumer and was retired. Source scan
  `rg "YO_BROWSER_EVENTS|yo-browser:" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. Browser sandbox clearing remains a separate destructive manual check.
- Focused MCP sampling cleanup:
  `pnpm exec vitest run test/main/presenter/mcpPresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/stores/mcpSampling.test.ts --silent --reporter=dot`
  passed with 4 files / 68 tests. `McpPresenter` no longer sends retired `mcp:sampling-*` raw
  channels; request, decision, and cancellation state is delivered through typed
  `mcp.sampling.request`, `mcp.sampling.decision`, and `mcp.sampling.cancelled` events. Source scan
  `rg "mcp:sampling-request|mcp:sampling-decision|mcp:sampling-cancelled|SAMPLING_REQUEST|SAMPLING_DECISION|SAMPLING_CANCELLED" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. The focused e2e group
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/13-mcp-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after rebuilding. A real approve/reject/cancel sampling dialog flow
  remains manual or future dedicated e2e because it requires a disposable MCP server that issues a
  sampling request and a runnable model path.
- Focused Config font-size cleanup:
  `pnpm exec vitest run test/main/presenter/configPresenter/fontSizeSettings.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/main/routes/settingsHandler.test.ts test/renderer/api/clients.test.ts test/renderer/stores/uiSettingsStore.test.ts --silent --reporter=dot`
  passed with 6 files / 88 tests. `fontSizeLevel` updates no longer send the retired
  `config:font-size-changed` raw channel; renderer UI state is hydrated and updated through typed
  `settings.changed`. Source scan
  `rg "config:font-size-changed|FONT_SIZE_CHANGED" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. The focused e2e group
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/23-config-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after rebuilding. Real display settings font-size changes and
  cross-window class synchronization remain manual or future dedicated e2e because the existing
  config smoke is read-only.
- Focused NowledgeMem config cleanup:
  `pnpm exec vitest run test/main/presenter/configPresenter/fontSizeSettings.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/NowledgeMemSettings.test.ts --silent --reporter=dot`
  passed with 5 files / 83 tests. `ConfigPresenter.setNowledgeMemConfig` no longer sends retired
  `config:nowledge-mem-config-updated`; renderer settings save/load behavior remains typed route
  based through `NowledgeMemClient`. Source scan
  `rg "config:nowledge-mem-config-updated|NOWLEDGE_MEM_CONFIG_UPDATED" src/main src/renderer test -g '*.ts' -g '*.vue'`
  returns no hits. The focused e2e group
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/14-nowledgemem-config-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after rebuilding and includes temporary config write/restore through
  the real settings UI. Live connection testing remains manual because it requires a running
  NowledgeMem service.
- Focused MCP config bridge cleanup:
  `pnpm exec vitest run test/main/presenter/configPresenter/mcpConfHelper.test.ts test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/stores/mcpStore.test.ts --silent --reporter=dot`
  passed with 5 files / 89 tests. `McpConfHelper.batchImportMcpServers` now emits
  `MCP_EVENTS.CONFIG_CHANGED` only on the main event bus; renderer updates continue through typed
  `mcp.config.changed` published by `legacyTypedEventBridge`. The unused renderer `MCP_EVENTS`
  constants were removed. The focused e2e group
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/13-mcp-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 smoke tests after rebuilding. External batch import remains manual or opt-in e2e
  because it mutates MCP server config and may depend on marketplace/network data.
- Focused ACP workspace/debug cleanup:
  `pnpm exec vitest run test/main/presenter/acpProvider.test.ts test/main/presenter/llmProviderPresenter/acp/acpProcessManager.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts test/renderer/components/ChatStatusBar.test.ts test/renderer/components/AcpDebugDialog.test.ts --silent --reporter=dot`
  passed with 6 files / 157 tests. ACP readiness events now use typed
  `sessions.acp.modes.ready`, `sessions.acp.commands.ready`, and
  `sessions.acp.configOptions.ready`; `acp-workspace:*` raw constants were retired. ACP debug
  events remain a main-internal `ACP_DEBUG_EVENTS.EVENT` bridge input and are renderer-visible only
  as typed `providers.acp.debug.event`. Source scan
  `rg "ACP_WORKSPACE_EVENTS|acp-workspace:|SESSION_MODES_READY|SESSION_COMMANDS_READY|SESSION_CONFIG_OPTIONS_READY|eventBus\\.sendToRenderer\\(" src/main/presenter/llmProviderPresenter src/main/events.ts src/renderer/src/events.ts test/main/presenter/acpProvider.test.ts test/main/presenter/llmProviderPresenter/acp/acpProcessManager.test.ts test/renderer/components/ChatStatusBar.test.ts -g '*.ts' -g '*.vue'`
  returns no hits. The focused e2e group
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/17-acp-readonly-route.smoke.spec.ts test/e2e/specs/18-provider-readonly-route.smoke.spec.ts --workers=1`
  passed with 4 smoke tests after rebuilding. Real ACP runtime warmup, debug action execution,
  mode/model selection, and config option changes remain manual or opt-in e2e because they require
  runnable ACP agents and local dependencies.
- Electron Knowledge read-only route e2e:
  `test/e2e/specs/12-knowledge-readonly-route.smoke.spec.ts` passed with 1 test. It opens the real
  Knowledge Settings page and reads `knowledge.isSupported`, `knowledge.getSupportedLanguages`,
  `knowledge.getSeparatorsForLanguage`, and `knowledge.getSupportedFileExtensions` without adding
  files, running ingestion, or mutating knowledge-base data.
- Electron MCP read-only route e2e:
  `test/e2e/specs/13-mcp-readonly-route.smoke.spec.ts` passed with 1 test. It opens the real MCP
  Settings page and reads `mcp.getEnabled`, `mcp.getServers`, `mcp.getClients`,
  `mcp.listToolDefinitions`, `mcp.listPrompts`, `mcp.listResources`, and
  `mcp.getNpmRegistryStatus` without toggling MCP, refreshing registry metadata, installing
  marketplace servers, or starting/stopping MCP servers.
- Electron NowledgeMem config route e2e:
  `test/e2e/specs/14-nowledgemem-config-route.smoke.spec.ts` passed with 1 test. It opens the real
  Knowledge Settings page, expands the NowledgeMem settings panel, saves a temporary base URL/API
  key through UI controls, verifies the typed `nowledgeMem.getConfig/updateConfig` routes, and
  restores the original config.
- Electron Dashboard read-only route e2e:
  `test/e2e/specs/15-dashboard-readonly-route.smoke.spec.ts` passed with 1 test. It opens the real
  Settings Overview dashboard and verifies the typed `sessions.getUsageDashboard` summary,
  calendar, provider/model breakdown, and RTK snapshot shape without triggering RTK retry.
- Electron Skills read-only route e2e:
  `test/e2e/specs/16-skills-readonly-route.smoke.spec.ts` passed with 1 test. It opens the real
  Skills Settings page, reads `skills.getDirectory` and `skills.listMetadata`, and, when an
  installed skill exists, verifies `skills.readFile`, `skills.getFolderTree`,
  `skills.getExtension`, and `skills.listScripts` without installing, uninstalling, or saving skill
  files.
- Focused Skills stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `16-skills-readonly-route.smoke.spec.ts` passed together with 3 tests after main-window detection
  was tightened to exclude floating/settings/splash renderer windows.
- Focused Skill catalog/session cleanup e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `16-skills-readonly-route.smoke.spec.ts` passed together with 3 tests after rebuilding. This
  verifies the real Skills settings surface after retiring `skill:*` raw events; it does not
  install, uninstall, save, or edit skill files.
- Electron ACP read-only route e2e:
  `test/e2e/specs/17-acp-readonly-route.smoke.spec.ts` passed with 1 test. It opens the real ACP
  Settings page and reads `config.getAcpState`, `config.listAcpRegistryAgents`,
  `config.listManualAcpAgents`, `config.getAcpSharedMcpSelections`, and `config.listAgents` for
  DeepChat/ACP views without toggling ACP, refreshing registry data, installing/repairing/
  uninstalling registry agents, or mutating manual agents.
- Focused ACP stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `17-acp-readonly-route.smoke.spec.ts` passed together with 3 tests.
- Electron Provider read-only route e2e:
  `test/e2e/specs/18-provider-readonly-route.smoke.spec.ts` passed with 1 test. It opens the real
  Model Providers settings page, waits for provider rows, and reads `providers.listSummaries`,
  `providers.listDefaults`, `providers.listModels`, and `providers.getRateLimitStatus` while only
  retaining redacted counts/types in the assertion snapshot. It does not save provider settings,
  refresh models, test live connectivity, run OAuth, sync ModelScope MCP servers, or start ACP
  debug actions.
- Focused Provider stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `18-provider-readonly-route.smoke.spec.ts` passed together with 3 tests.
- Focused Ollama pull-progress cleanup e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `18-provider-readonly-route.smoke.spec.ts` passed together with 3 tests after rebuilding. This
  verifies the real Provider settings surface after retiring `ollama:pull-model-progress`; it does
  not trigger a real Ollama pull.
- Electron SkillSync read-only route/event e2e:
  `test/e2e/specs/19-skill-sync-readonly-route.smoke.spec.ts` passed with 1 test after rebuilding
  the app. It opens the real Skills settings page, verifies the sync status surface, reads
  `skillSync.getRegisteredTools`, `skillSync.getNewDiscoveries`, and
  `skillSync.scanExternalTools`, and confirms typed `skillSync.scan.started/completed` events are
  delivered. It does not acknowledge discoveries or preview/execute import/export.
- Focused SkillSync stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `19-skill-sync-readonly-route.smoke.spec.ts` passed together with 3 tests.
- Electron Data Security read-only route e2e:
  `test/e2e/specs/20-data-security-readonly-route.smoke.spec.ts` passed with 1 test after
  rebuilding the app. It opens the real Data Settings page, verifies database encryption, database
  repair, and YoBrowser sandbox surfaces are visible, then reads `databaseSecurity.getStatus`,
  `device.getInfo`, and `device.getAppVersion` without enabling encryption, changing passwords,
  repairing schema, resetting data, or clearing browser sandbox data.
- Focused Data Security stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `20-data-security-readonly-route.smoke.spec.ts` passed together with 3 tests.
- Focused Device reset notification cleanup e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `20-data-security-readonly-route.smoke.spec.ts` passed together with 3 tests after rebuilding.
  This verifies the real Data Settings surface and read-only device/database routes after retiring
  `notification:data-reset-complete-dev`; it deliberately does not click reset-data actions.
- Focused system notification click cleanup e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts` and `09-main-ipc-boundary.smoke.spec.ts` passed together
  with 2 tests after rebuilding. This proves the real main renderer typed IPC boundary still starts
  cleanly after retiring `notification:sys-notify-clicked`; it deliberately does not depend on OS
  notification permissions.
- Electron Project read-only route e2e:
  `test/e2e/specs/21-project-readonly-route.smoke.spec.ts` passed with 1 test. It opens the real
  Environments Settings page and reads `project.listRecent`, `project.listEnvironments`, and
  `project.pathExists` for both an existing repository path and a generated missing path without
  opening directories or invoking the native directory picker.
- Focused Project stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `21-project-readonly-route.smoke.spec.ts` passed together with 3 tests.
- Electron Workspace read-only route e2e:
  `test/e2e/specs/29-workspace-readonly-route.smoke.spec.ts` passed with 1 test. It opens the real
  main renderer, registers the current repository through `workspace.register`, reads
  `workspace.readDirectory`, `workspace.searchFiles`, and `workspace.getGitStatus`, then unregisters
  the workspace in `finally` without starting watchers, opening files, or revealing paths.
- Focused Workspace stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `09-main-ipc-boundary.smoke.spec.ts`, and
  `29-workspace-readonly-route.smoke.spec.ts` passed together with 3 tests.
- Electron Window read-only route e2e:
  `test/e2e/specs/22-window-readonly-route.smoke.spec.ts` passed with 1 test. It reads
  `window.getCurrentState` from both the real main renderer and the real Settings renderer, proving
  the context-aware route returns distinct current window state snapshots without minimizing,
  maximizing, focusing, or closing either window.
- Focused Window stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `22-window-readonly-route.smoke.spec.ts` passed together with 3 tests.
- Electron Provider install preview e2e:
  `test/e2e/specs/25-window-provider-deeplink-preview.smoke.spec.ts` passed with 1 test. It queues
  a custom provider install preview through `window.requeuePendingSettingsProviderInstall`, opens
  the real Settings window, verifies the provider preview dialog renders the queued provider name,
  base URL, and masked key, and confirms the pending preview queue has been consumed without
  applying provider configuration.
- Focused Provider preview stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `25-window-provider-deeplink-preview.smoke.spec.ts` passed together with 3 tests.
- Electron Config settings read-only route e2e:
  `test/e2e/specs/23-config-readonly-route.smoke.spec.ts` passed with 1 test. It opens the real
  DeepChat Agents, Notifications Hooks, and Shortcuts settings pages and reads
  `config.listAgents`, `config.resolveDeepChatAgentConfig`, `config.getAgentMcpSelections`,
  `config.getHooksNotifications`, and `config.getShortcutKeys` without mutating agents, hooks, or
  shortcuts.
- Focused Config settings stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `23-config-readonly-route.smoke.spec.ts` passed together with 3 tests.
- Electron Shortcut config route/event e2e:
  `test/e2e/specs/28-shortcut-route-restore.smoke.spec.ts` passed with 1 test. It opens the real
  Settings Shortcuts page, writes a temporary `QuickSearch` shortcut through
  `config.setShortcutKeys` from the Settings renderer, receives
  `config.shortcutKeys.changed`, calls `shortcut.destroy`, `shortcut.register`, and
  `shortcut.unregister`, then restores the original shortcut config in `finally`.
- Focused Shortcut stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `28-shortcut-route-restore.smoke.spec.ts` passed together with 3 tests using `--workers=1`.
- Focused shortcut event bridge cleanup:
  `ConfigPresenter.setShortcutKey` and `ConfigPresenter.resetShortcutKeys` now publish
  `config.shortcutKeys.changed` directly, so `legacyTypedEventBridge` no longer monkey patches
  config presenter methods. The focused shortcut route/client/component test group passed with
  4 files / 81 tests, and the same 3-spec shortcut e2e group passed after rebuilding.
- Electron Hooks notification command e2e:
  `test/e2e/specs/27-hooks-notification-command.smoke.spec.ts` passed with 1 test. It saves a
  temporary hook through `config.setHooksNotifications`, verifies the real Notifications Hooks page
  renders it, executes a harmless local `node -e` command through `config.testHookCommand`, checks
  successful stdout/exit code, and restores the original hooks config in `finally`.
- Focused Hooks notification stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `27-hooks-notification-command.smoke.spec.ts` passed together with 3 tests.
- Electron DeepChat agent CRUD e2e:
  `test/e2e/specs/26-deepchat-agent-crud.smoke.spec.ts` passed with 1 test after rebuilding the app.
  It opens the real DeepChat Agents settings page, creates a uniquely named temporary agent through
  the UI, verifies it through `config.listAgents`, updates its name and description through the UI,
  deletes it through `config.deleteDeepChatAgent`, and performs best-effort cleanup in `finally`.
- Focused DeepChat agent CRUD stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `26-deepchat-agent-crud.smoke.spec.ts` passed together with 3 tests.
- Electron Config system read-only route e2e:
  `test/e2e/specs/24-config-system-readonly-route.smoke.spec.ts` passed with 1 test. It opens the
  real About settings page, then reads `config.getProxySettings`, `config.getUpdateChannel`,
  `config.getSyncSettings`, `config.getSkillDraftSuggestions`, `config.getEntries` for model
  defaults/file-size settings, and `upgrade.getStatus` without opening the General proxy section,
  checking for updates, downloading updates, or mutating config.
- Focused Config system stability e2e:
  `test/e2e/specs/01-launch.smoke.spec.ts`, `06-settings-ipc-boundary.smoke.spec.ts`, and
  `24-config-system-readonly-route.smoke.spec.ts` passed together with 3 tests.
- Focused Upgrade/About stability e2e:
  `pnpm exec playwright test test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/24-config-system-readonly-route.smoke.spec.ts --workers=1`
  passed with 3 tests after rebuilding with `pnpm exec electron-vite build`.
- Combined stable user-flow e2e for launch, settings navigation, settings IPC boundary, floating IPC
  boundary, browser route lifecycle, main renderer IPC boundary, and Data Settings privacy mode
  plus Remote Control, Knowledge, MCP, NowledgeMem, and Dashboard routes passed with 12 tests. The
  e2e launcher waits up to 60 seconds for the main window to avoid false cold-start failures in long
  sequential smoke runs.
- Candidate 13-test expansion including the Skills read-only spec is not yet promoted to stable:
  the long sequential run hit Electron app setup timeouts in `01-launch` and `08-browser-route`,
  while both specs passed when rerun individually. The failure is currently classified as e2e
  harness stability rather than presenter-route behavior.
- Source scans show no renderer/main/preload business usage of `@api/legacy/**`,
  `presenter:call`, `remoteControlPresenter:call`, `DISPATCHABLE_PRESENTERS`, or
  `REMOTE_CONTROL_METHODS`.
- Renderer test harness scan:
  `rg "@api/legacy|useLegacyPresenter|legacy/runtime" test/renderer test/main -n` reports only the
  intentional architecture guard fixture. Migrated component/store tests now mock typed clients
  directly instead of recreating virtual legacy modules.
- Session/conversation/stream cleanup source scans:
  `rg "eventBus\\.sendToRenderer\\(|eventBus\\.sendToRendererIfAvailable\\(" src/main src/renderer -g "*.ts" -g "*.vue"`
  reports only `src/main/routes/publishDeepchatEvent.ts`, and
  `rg "conversation:list-updated|conversation:activated|conversation:deactivated|conversation:message-edited|conversation:scroll-to-message|stream:response|stream:end|stream:error|session:list-updated|session:activated|session:deactivated|session:status-changed|session:pending-inputs-updated|session:compaction-updated" src/main src/renderer -g "*.ts" -g "*.vue"`
  is clean.
- Focused Session/Runtime typed-event gate:
  `pnpm exec vitest run test/main/presenter/configPresenter/fontSizeSettings.test.ts test/main/presenter/agentSessionPresenter/agentSessionPresenter.test.ts test/main/presenter/agentRuntimePresenter/echo.test.ts test/main/presenter/agentRuntimePresenter/pendingInputCoordinator.test.ts test/main/presenter/agentRuntimePresenter/dispatch.test.ts test/main/presenter/agentRuntimePresenter/process.test.ts test/main/presenter/agentRuntimePresenter/agentRuntimePresenter.test.ts test/main/routes/contracts.test.ts test/renderer/api/clients.test.ts --silent --reporter=dot`
  passed with 9 files / 339 tests. Coverage includes typed `chat.stream.updated/completed/failed`,
  `sessions.status.changed`, `sessions.pendingInputs.changed`, `sessions.compaction.changed`, and
  `sessions.updated` publication, plus renderer client subscription coverage.
- Session/Runtime final gate:
  `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm exec electron-vite build` passed. User-angle e2e evidence:
  `01-launch`, `09-main-ipc-boundary`, and `23-config-readonly-route` passed in the first focused
  run; `06-settings-ipc-boundary` timed out during Electron app fixture setup in that four-spec run,
  then passed when rerun alone; `01-launch + 09-main-ipc-boundary` passed together with
  `--workers=1`. The timeout is classified with the existing Electron harness cold-start/setup
  instability, because the failed spec did not reach assertions and passed independently.
- Final presenter event sweep:
  `rg "eventBus\\.send\\(" src/main src/renderer -g "*.ts" -g "*.vue"` and
  `rg "legacyTypedEventBridge|setupLegacyTypedEventBridge" src/main test/main -g "*.ts"` are clean.
  The last broad dead renderer broadcasts were removed from `WindowPresenter` and `TabPresenter`.
  `rg "setActiveTab|update-window-tabs|tab:title-updated|TITLE_UPDATED" src test -g "*.ts" -g "*.vue"`
  is clean. Remaining
  `webContents.send(...)` calls under `src/main/presenter` are limited to explicit secondary-window
  protocols: floating button preload channels, splash/database-unlock startup channels, browser
  overlay activity, and ACP terminal typed envelopes targeted at settings webContents.
- Final sweep focused tests:
  `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/api/preloadBoundaries.test.ts --silent --reporter=dot`
  passed with 4 files / 84 tests, and
  `pnpm exec vitest run test/main/presenter/windowPresenter.test.ts --silent --reporter=dot`
  passed with 1 file / 4 tests.
- Final sweep e2e:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/01-launch.smoke.spec.ts test/e2e/specs/06-settings-ipc-boundary.smoke.spec.ts test/e2e/specs/07-floating-ipc-boundary.smoke.spec.ts test/e2e/specs/09-main-ipc-boundary.smoke.spec.ts test/e2e/specs/22-window-readonly-route.smoke.spec.ts test/e2e/specs/23-config-readonly-route.smoke.spec.ts --workers=1`
  passed with 6 tests. The e2e fixture now launches built Electron against an isolated temporary
  `DEEPCHAT_E2E_USER_DATA_DIR` and seeds completed onboarding state, so automated smoke tests do not
  depend on the developer's real encrypted database profile or first-run onboarding state.
- Final local full-smoke e2e:
  `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/*.smoke.spec.ts --workers=1`
  passed with 26 tests and 3 skipped. The skipped specs are live provider/chat integration checks
  and require `RUN_PROVIDER_INTEGRATION=true` plus an explicitly configured provider/model/API key.
- Final full Vitest:
  `pnpm test -- --silent --reporter=dot` passed with 382 files passed, 6 skipped, 3192 tests
  passed, and 41 skipped. The final fixes updated stale tests to the typed session/chat event
  contracts and added complete EventBus mocks for Config helper publishers.
- Final renderer cleanup evidence:
  `rg "WINDOW_EVENTS|SYSTEM_EVENTS" src/renderer/src/events.ts src/renderer test/renderer -g "*.ts" -g "*.vue"`
  is clean, and `pnpm run typecheck` passes after explicitly declaring Vite env defaults, CSS
  imports, `?url` assets, and inline worker imports in `src/renderer/src/env.d.ts`.

Not yet passed:

- External-service/manual flows remain open: GitHub Copilot OAuth, provider live connection/model
  refresh/key-status/rate-limit update/ACP debug actions, live chat generation/session persistence
  with real provider credentials, Telegram/Weixin/Feishu/QQBot/Discord
  remote control, MCP Router marketplace install, NowledgeMem live connection, database encryption
  enable/change/disable in a disposable encrypted profile, database repair on a copied real profile,
  destructive data reset and browser sandbox reset in a disposable profile, advanced DeepChat agent
  editing paths such as model/default-project/tool/subagent controls, hooks notification command
  failure/custom-script scenarios, real hook event dispatch, Shortcut Settings UI edit/clear/reset
  plus actual OS global shortcut activation/focus/blur/duplicate-registration behavior,
  proxy/update-channel saves, logging-folder opening, provider DB refresh, real update
  check/download/restart install, Project native path picker/open-directory behavior, Window
  focus/minimize/maximize/close flows, OS-level `deepchat://provider/install` dispatch into the
  preview queue, and real encrypted-database splash unlock against a disposable encrypted
  profile/OS credential state.

## Evidence Rules

- A broad claim like "presenter migrated" requires both code search evidence and passing slice tests.
- A route/client replacement is incomplete if the renderer still imports the legacy presenter for the
  same behavior.
- A typed event migration is incomplete while any renderer business component listens to the old raw
  channel.
- Manual checks must name the OS/profile/service used. If a flow cannot be performed, record why and
  keep the slice open.
