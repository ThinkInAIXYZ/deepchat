# Plan: Remove Local SearchPresenter + ContentEnricher

## Overview

We will remove the legacy local search stack (SearchPresenter/SearchManager/SearchHandler and its Electron BrowserWindow-based implementation) and all settings that exist to configure it.

We will keep the "search results" display pipeline that is fed by MCP tool calls (and/or YoBrowser) because it is a different mechanism and is required for historical compatibility.

## Architecture Changes

### 1) Main: detach Agent streaming from local search

Current state:

- `StreamGenerationHandler` triggers local search via `SearchHandler.startStreamSearch(...)` when user message content indicates `search: true`.
- `AgentPresenter` depends on `SearchPresenter` to get `SearchManager`, constructs `SearchHandler`, and uses `searchManager.stopSearch(...)` during cancel.
- `BaseHandler/ThreadHandlerContext` are located under `searchPresenter/handlers/` and include `searchManager`, causing unrelated agent modules to depend on the search module.

Target state:

- Remove local-search execution from the generation pipeline.
- Keep the MCP tool-call search results pipeline:
  - `ToolCallHandler.processSearchResultsFromToolCall` remains.
  - `SessionPresenter.getSearchResults` remains.

Implementation approach:

- Remove `SearchHandler` usage from `StreamGenerationHandler`.
- Remove `searchingMessages`/`searchManager.stopSearch` integration from `AgentPresenter`.
- Introduce a small shared base handler in `src/main/presenter/agentPresenter/` (or `src/main/presenter/shared/`) so that `PermissionHandler`, `UtilityHandler`, and `StreamGenerationHandler` no longer import from `searchPresenter`.
  - New context type should not include `searchManager`.

### 2) Main: delete SearchPresenter module and wiring

- Delete `src/main/presenter/searchPresenter/`.
- Update `src/main/presenter/index.ts` to remove:
  - import
  - instance creation
  - exposure via presenter container
- Remove any remaining references in `agentPresenter/*` and tests.

### 3) Settings + renderer: remove search-related configuration UI

Remove Settings components:

- `src/renderer/settings/components/common/SearchEngineSettingsSection.vue`
- `src/renderer/settings/components/common/SearchAssistantModelSection.vue`
- `src/renderer/settings/components/common/WebContentLimitSetting.vue`

Update Settings composition:

- `src/renderer/settings/components/CommonSettings.vue`
  - remove the above components
  - remove `searchPreviewEnabled` toggle

- `src/renderer/settings/App.vue`
  - remove initialization of `searchEngineStore` / `searchAssistantStore`
  - remove search engine event listeners

Remove renderer runtime artifacts that only serve SearchPresenter:

- `src/renderer/src/stores/searchEngineStore.ts`
- `src/renderer/src/stores/searchAssistantStore.ts`
- `src/renderer/src/composables/search/*`
- `src/renderer/src/composables/useSearchEngineStoreLifecycle.ts` (if unused after deletion)
- Remove search-related initialization hooks from `src/renderer/src/lib/storeInitializer.ts`.

### 4) Main: remove ConfigPresenter settings used only for local search

Remove local-search-only keys and API surface:

- `customSearchEngines` getters/setters
- `searchPreviewEnabled` getter/setter
- `webContentLengthLimit` default + usage
- Any search-assistant selection that only existed for local search (if it is not used elsewhere)

Also remove corresponding renderer bindings:

- `src/renderer/src/stores/uiSettingsStore.ts` remove `searchPreviewEnabled`
- `src/renderer/src/composables/config/useSettingsConfigAdapter.ts` remove `searchPreviewEnabled`

Migration note:

- We can leave stored keys in ElectronStore without reading them.
- If desired, add a non-destructive migration path later.

### 5) Main: remove ContentEnricher and dependent MCP tool

- Delete `src/main/presenter/content/contentEnricher.ts`
- Update `src/main/presenter/content/index.ts` exports
- Update `src/main/presenter/mcpPresenter/inMemoryServers/powerpackServer.ts`:
  - remove `get_web_info` tool definition from `ListToolsRequestSchema` handler
  - remove `get_web_info` case from `CallToolRequestSchema` handler
  - remove `ContentEnricher` import

Rationale:

- This functionality overlaps with YoBrowser-based browsing and typically performs worse.

### 6) Shared types: remove SearchPresenter IPC surface while keeping SearchResult

Remove:

- `ISearchPresenter` types and `searchPresenter` from presenter maps.
- `SearchEngineTemplate` types only if unused after Settings removal.

Keep:

- `SearchResult` (used for attachments + UI rendering).

### 7) i18n cleanup

- Remove settings keys related to removed UI sections across all locales.
- Update `src/types/i18n.d.ts` to match.

## Event Flow After Change

- Search results still arrive via MCP tool calls:
  - MCP tool returns resources with `application/deepchat-webpage`
  - `ToolCallHandler.processSearchResultsFromToolCall` persists `search_result` attachments
  - Renderer fetches via `SessionPresenter.getSearchResults`

- No main-process local search preview windows are created.

## Test Strategy

- Main tests:
  - Update any tests importing `ThreadHandlerContext/SearchManager` from removed path.
  - Add/adjust tests to ensure cancellation does not call removed search stop logic.

- Renderer tests (if present for Settings):
  - Ensure Settings routes render without the removed components.

## Risks & Mitigations

- Risk: Hidden runtime dependency on `searchPresenter/handlers/baseHandler.ts` via `BaseHandler`.
  - Mitigation: move base handler to a neutral location and update imports.

- Risk: Removing config keys breaks snapshot loading.
  - Mitigation: treat missing keys as defaults; avoid strict required fields.

- Risk: i18n type generation mismatch.
  - Mitigation: remove keys across locales + update `src/types/i18n.d.ts` in same change.

## Rollback

- Revert the commits introducing these deletions; no data migration is required.
