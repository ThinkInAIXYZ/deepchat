# Tasks: Remove Local SearchPresenter + ContentEnricher

1. Main: remove local-search execution path
   - Detach `StreamGenerationHandler` from `SearchHandler.startStreamSearch`
   - Remove `searchingMessages` and `searchManager.stopSearch` usage from `AgentPresenter`
   - Move `BaseHandler`/context types out of `searchPresenter` into a neutral module and update imports

2. Main: remove SearchPresenter module
   - Delete `src/main/presenter/searchPresenter/`
   - Remove SearchPresenter wiring from `src/main/presenter/index.ts`
   - Update any remaining imports in main

3. Renderer(Settings): remove local-search settings UI
   - Delete SearchEngine/SearchAssistant/WebContentLimit settings components
   - Update `src/renderer/settings/components/CommonSettings.vue`
   - Update `src/renderer/settings/App.vue` to stop initializing search stores

4. Renderer: remove local-search stores/composables
   - Delete `src/renderer/src/stores/searchEngineStore.ts` and `src/renderer/src/stores/searchAssistantStore.ts`
   - Delete `src/renderer/src/composables/search/*`
   - Remove any lifecycle/initializer hooks that reference these stores

5. Main: remove ConfigPresenter keys used only for local search
   - Remove `customSearchEngines`, `searchPreviewEnabled`, `webContentLengthLimit` API surface
   - Remove defaults and helper methods
   - Update renderer config adapter + uiSettingsStore accordingly

6. Main: remove ContentEnricher + MCP get_web_info
   - Delete `src/main/presenter/content/contentEnricher.ts`
   - Remove export in `src/main/presenter/content/index.ts`
   - Remove `get_web_info` from `src/main/presenter/mcpPresenter/inMemoryServers/powerpackServer.ts`

7. Shared types + i18n cleanup
   - Remove `searchPresenter` types and presenter map entries
   - Remove unused `SearchEngineTemplate` types if no longer referenced
   - Remove settings i18n keys across locales; update `src/types/i18n.d.ts`

8. Tests + quality gates
   - Update/replace failing tests affected by removed imports
   - Run: `pnpm run format && pnpm run lint && pnpm run typecheck && pnpm test`
