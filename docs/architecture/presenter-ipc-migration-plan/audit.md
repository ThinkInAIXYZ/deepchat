# Presenter IPC Migration Completion - Audit

Audit snapshot: 2026-06-10.

Execution snapshot: 2026-06-11.

- Renderer settings business surfaces have been migrated off `@api/legacy/presenters` and direct
  `window.electron.ipcRenderer` for the audited slices.
- Completed typed domains now include Knowledge, Skill Sync, OAuth, NowledgeMem, database repair,
  browser sandbox clear, MCP Router, Remote Control, settings/window notifications, ACP settings
  reload, Skills catalog reload, ACP terminal command/events, Shortcut runtime, chat stream
  terminal events, context menu events, app runtime events, and secondary renderer preload
  hardening.
- Current source scan still shows raw IPC in startup/specialized preload boundaries only:
  `src/preload/index.ts`, `src/preload/plugin-settings-preload.ts`,
  `src/preload/splash-preload.ts`, `src/preload/floating-preload.ts`,
  `src/preload/browser-overlay-preload.ts`, and `src/preload/createBridge.ts`.
- `presenter:call`, `remoteControlPresenter:call`, `Presenter.DISPATCHABLE_PRESENTERS`,
  `Presenter.REMOTE_CONTROL_METHODS`, and `src/renderer/api/legacy/**` have been removed from
  source.

## Commands Used

```bash
rg "useLegacyPresenter|window\\.electron|window\\.api" src/renderer src/preload
rg "ipcMain\\.|ipcRenderer\\.|webContents\\.send|sendSync" src/main src/preload src/renderer
rg "eventBus\\.send|eventBus\\.sendToRenderer|eventBus\\.on" src/main
node scripts/architecture-guard.mjs
```

`node scripts/architecture-guard.mjs` passed after the guard was expanded to settings and after
`src/renderer/api/legacy/**` was retired.

## Existing Typed Boundary

The shared contract catalog currently contains broad coverage:

| Contract area | Current coverage |
| --- | --- |
| Routes | 271 typed routes across browser, chat, config, database security, device, dialog, file, MCP, models, onboarding, plugins, project, providers, scheduled tasks, sessions, settings, skills, startup, sync, system, tab, tools, upgrade, window, workspace |
| Events | 54 typed events across browser, chat, config, dialog, MCP, models, providers, sessions, settings, skills, startup, sync, upgrade, window, workspace |
| Bridge | `src/preload/createBridge.ts` validates route input/output and typed event envelopes |
| Main dispatcher | `src/main/routes/index.ts` owns `deepchat:route:invoke` |
| Renderer clients | `src/renderer/api/*Client.ts` covers the main chat/session/provider/model/MCP/settings path |

## Generic Presenter Dispatchers Retired

`src/main/presenter/index.ts` no longer registers:

| IPC handler | Current role | Risk |
| --- | --- | --- |
| `presenter:call` | Removed | Generic method reflection is no longer renderer-callable |
| `remoteControlPresenter:call` | Removed | Remote control now uses typed `remoteControl.*` routes |

The generic dispatcher allowlists `Presenter.DISPATCHABLE_PRESENTERS` and
`Presenter.REMOTE_CONTROL_METHODS` have also been removed.

## Initial Legacy Presenter Call Inventory

The following table records the 2026-06-10 audit baseline before the execution work in this branch.
It is intentionally kept as a migration source map, not as the current remaining source scan.

Initial named `useLegacyPresenter('...')` hits:

| Presenter | Count | Main callers and methods |
| --- | ---: | --- |
| `configPresenter` | 12 | ACP registry/manual agent management, DeepChat agent CRUD, hooks notifications, skill draft suggestions, update channel, proxy settings, logging folder, provider DB refresh, generic get/set setting |
| `windowPresenter` | 5 | settings window close/provider-install state, main-window focus for onboarding, update check broadcast, guided onboarding helper injection |
| `llmproviderPresenter` | 5 | key status, refresh models, embedding dimensions, ModelScope MCP sync, provider rate limit update/status, ACP debug action |
| `devicePresenter` | 5 | app/device info, select directory/files, data reset |
| `skillSyncPresenter` | 4 | scan, discovery acknowledgement, import/export preview and execution |
| `projectPresenter` | 3 | recent projects, select directory, path exists |
| `knowledgePresenter` | 3 | knowledge file CRUD, query, validation, supported languages/separators |
| `agentSessionPresenter` | 2 | agents list, usage dashboard, RTK health retry |
| `oauthPresenter` | 1 | GitHub Copilot OAuth/device flow |
| `mcpPresenter` | 1 | MCP Router market/API key/install helpers |
| `toolPresenter` | 1 | tool definitions for agent settings |
| `skillPresenter` | 1 | read skill file |
| `filePresenter` | 1 | prompt editor file preparation |
| `sqlitePresenter` | 1 | repair schema |
| `yoBrowserPresenter` | 1 | clear browser sandbox data |
| `exporter` | 1 | NowledgeMem config/test/update |
| `shortcutPresenter` | 1 | renderer shortcut runtime helper |

There were also wrapper-level usages:

| Wrapper | File | Current role |
| --- | --- | --- |
| `RemoteControlRuntime` | `src/renderer/api/RemoteControlRuntime.ts` | Wraps `useLegacyRemoteControlPresenter()` |
| `ShortcutRuntime` | `src/renderer/api/ShortcutRuntime.ts` | Wraps `useLegacyShortcutPresenter()` |
| `src/renderer/api/legacy/**` | quarantine | Contains the generic legacy transport and runtime wrappers |

## Initial Direct Raw IPC And Window Runtime Inventory

The following inventory is also the pre-execution baseline. The 2026-06-11 execution snapshot above
is the authoritative current state for remaining raw IPC exceptions.

| Area | Files | Channels or APIs |
| --- | --- | --- |
| Chat stream compatibility | `src/renderer/src/stores/ui/messageIpc.ts` | listens to legacy `STREAM_EVENTS.END` and `STREAM_EVENTS.ERROR` even though `chat.stream.completed/failed` exists |
| Context menu bridge | `src/renderer/src/components/message/SelectedTextContextMenu.vue`, `src/main/contextMenuHelper.ts` | raw `context-menu-translate`, `context-menu-ask-ai` |
| Settings shell | `src/renderer/settings/App.vue` | `SETTINGS_EVENTS.NAVIGATE`, `SETTINGS_EVENTS.PROVIDER_INSTALL`, `SETTINGS_EVENTS.READY`, notification events |
| ACP settings/debug/terminal | `AcpSettings.vue`, `AcpDebugDialog.vue`, `AcpTerminalDialog.vue` | `CONFIG_EVENTS.AGENTS_CHANGED`, `ACP_DEBUG_EVENTS.EVENT`, `acp-init:*`, `external-deps-required`, `acp-terminal:*` |
| Knowledge base | `KnowledgeFile.vue`, `KnowledgeFileItem.vue` | `RAG_EVENTS.FILE_UPDATED`, `RAG_EVENTS.FILE_PROGRESS` |
| Provider rate limit | `ProviderRateLimitConfig.vue` | `RATE_LIMIT_EVENTS.CONFIG_UPDATED`, `REQUEST_EXECUTED`, `REQUEST_QUEUED` |
| Skill sync/catalog | `SyncPromptDialog.vue`, `SkillsSettings.vue` | `SKILL_SYNC_EVENTS.NEW_DISCOVERIES`, `skill:installed`, `skill:uninstalled`, `skill:metadata-updated` |
| Direct `window.api` | settings components | copy text, read clipboard, open external, file path extraction |
| Splash renderer | `src/renderer/splash/loading.vue` | database unlock submit/cancel/progress/request through raw Electron API |

## Secondary Renderer And Preload Inventory

| Renderer | Boundary today | Recommendation |
| --- | --- | --- |
| Main renderer | `window.deepchat` plus narrow `window.api` runtime helpers | Keep `window.api` behind `src/renderer/api/runtime.ts`; no component-level raw IPC |
| Settings renderer | same preload as main renderer | Migrated to `renderer/api/*Client`; no component-level legacy IPC |
| Plugin settings renderer | `deepchatPlugin` backed by `createBridge(ipcRenderer)` | Keep specialized API, already typed-route backed |
| Browser overlay | `yoBrowserOverlay.onActivityChanged` using typed event name and schema validation | Keep specialized API unless moved to `createBridge` later |
| Floating widget | `floatingButtonAPI` with shared custom channels and payload validation | Keep specialized API; listeners return scoped unsubscribe functions |
| Splash | `window.deepchatSplash` dedicated startup API | Keep raw IPC inside preload only because unlock can run before route runtime |

## Guard Gap

`scripts/architecture-guard.mjs` now scans `src/renderer/src` and `src/renderer/settings`, forbids
business-layer imports from `@api/legacy/**`, and treats a recreated `src/renderer/api/legacy/**`
directory as a regression. Remaining work is to regenerate the architecture baseline reports and add
a dedicated fixture/test proving settings-level legacy imports fail the guard.
