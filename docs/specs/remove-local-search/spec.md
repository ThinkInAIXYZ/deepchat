# Remove Local SearchPresenter + ContentEnricher

## Context

DeepChat previously included a local "simulated browser" search implementation under `src/main/presenter/searchPresenter/`. This functionality is now effectively superseded by YoBrowser + MCP tooling.

The renderer-side entry has already been removed from the main UI, but remnants still exist in Settings and in main-process runtime (SearchPresenter/SearchManager/SearchHandler + search preview + content enrichment).

This spec defines a clean removal of the legacy local search stack and its derived utilities.

## Goals

- Remove the legacy local search implementation (`searchPresenter`) and all runtime wiring.
- Remove Settings UI and persisted settings that exist solely to support local search.
- Remove the legacy webpage content enrichment implementation (`ContentEnricher`) and any MCP tools that depend on it.
- Keep historical data compatibility: do not break existing stored messages/attachments that contain search results.
- Stop producing/consuming the conversation-level "search" toggle/flags for local search.

## Non-Goals

- Do not remove `SearchResult` message blocks, search-result attachments, or search-results display UI.
- Do not remove MCP/YoBrowser search capabilities; those remain the supported path.
- Do not do destructive user-data cleanup by default (we may leave old config keys in ElectronStore if not read anymore).

## User Stories

1. As a user, I can upgrade to a new version and the app still opens Settings without any broken search-related sections.
2. As a user, I can continue to view historical search results in existing conversations.
3. As a developer, I can remove the local search code without leaving dead presenter wiring, orphan IPC types, or unreachable settings.

## Acceptance Criteria

- App builds and runs without any reference to `src/main/presenter/searchPresenter/`.
- Settings no longer show:
  - search engine selection / custom search engines
  - search assistant model
  - search preview toggle
  - web content length limit
- Main process no longer:
  - creates/keeps a BrowserWindow to perform local search
  - performs query rewrite for local search
  - enriches web pages via `ContentEnricher`
- MCP `powerpackServer` no longer exposes `get_web_info` (or any equivalent wrapper that uses `ContentEnricher`).
- Historical messages that already contain:
  - `search` message blocks
  - `search_result` attachments
  continue to render correctly.
- The conversation/message pipeline no longer triggers local search based on any "search" flag.

## Compatibility & Migration

- Historical data:
  - Keep parsing/rendering stored `search_result` attachments via `SessionPresenter.getSearchResults`.
  - Keep `ToolCallHandler.processSearchResultsFromToolCall` behavior unchanged.

- Stored settings:
  - We stop reading/writing local-search-only keys (`customSearchEngines`, `searchPreviewEnabled`, `webContentLengthLimit`, and any search-assistant selection used only by local search).
  - Optional: add a one-time migration to delete these keys (not required by default).

## Open Questions

- None.
