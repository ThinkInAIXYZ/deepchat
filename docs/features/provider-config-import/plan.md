# Provider Config Import Plan

## Architecture

- Add provider import route contracts in `providers.routes.ts`:
  - `providers.import.scan` returns a scan session, source statuses, provider previews, mappings, default selections, and warnings.
  - `providers.import.apply` takes the scan session and selected source/provider IDs, then returns an import result summary.
- Add a main-process `ProviderImportService` owned by the provider routes area.
- Wire service into `MainKernelRouteRuntime` and `dispatchProviderRoute`.
- Add `ProviderImportClient` methods to `ProviderClient` for renderer use.
- Keep scan sessions in memory and short lived. Scan responses only include masked API keys.

## Source Readers

- Alma:
  - Path: `~/Library/Application Support/alma/chat_threads.db`
  - Query: `providers` table, skip `type='acp'`
  - Use read-only `better-sqlite3-multiple-ciphers`.
- Cherry Studio:
  - Path: `~/Library/Application Support/CherryStudio/Local Storage/leveldb`
  - Read `persist:cherry-studio`, parse nested `llm.providers`
  - Use `level` dependency.
  - Copy a temporary LevelDB snapshot and skip `LOCK` before reading, so import can work while Cherry Studio is running.
- Hermes:
  - Path: `~/.hermes/config.yaml`
  - Parse `llm.providers` with `yaml`.
- OpenClaw:
  - Path: `~/.openclaw/gateway.yaml`
  - Parse `providers` with `yaml`.

## Mapping

Fixed processing order: Alma, Cherry Studio, Hermes, OpenClaw.

| Source type / id / api_format | DeepChat target |
| --- | --- |
| `openai`, `openai-chat`, `openai-compatible`, Alma `openai-chat` | built-in `openai` if source id/name is OpenAI, otherwise custom provider with `apiType='openai-completions'` |
| `openai-response`, `openai-responses` | built-in `openai-responses` |
| `anthropic` | built-in `anthropic` |
| `gemini` | built-in `gemini` |
| `ollama` | built-in `ollama` |
| `new-api` | built-in `new-api` |
| `silicon`, `siliconflow`, `siliconcloud` | built-in `silicon` |
| `deepseek` | built-in `deepseek` |
| `ppio`, `ppinfra`, base URL containing `ppinfra.com` | built-in `ppio` |
| `volcengine`, `ark` | built-in `doubao` |
| known built-in ids | matching built-in provider id |
| unknown provider with API key and `http(s)` base URL | custom provider, source name retained, `apiType='openai-completions'` |
| custom/openai-compatible provider with base URL but no API key | custom provider row, not selected by default; user can switch API type to `ollama` before importing |
| unsupported credential-only shapes without a usable base URL | visible as unsupported and not selectable |

Configured DeepChat providers default to unchecked. A forced checked row updates the matching provider.

## Write Behavior

- Built-in target:
  - Update `apiKey`, `baseUrl`, `enable`.
  - Preserve existing provider metadata and websites.
  - Replace or upsert custom model entries imported from that row.
- Custom target:
  - Create stable id from source prefix and source provider id, with suffix on collision.
  - Set `custom: true`, `enable: true`, user-selected `apiType`, `apiKey`, `baseUrl`, and name.
  - When updating an existing custom provider matched by fingerprint, preserve unrelated provider metadata such as rate limits, custom models, websites, and capability ids.
  - Add source models as custom models and enable them.
- Apply selected rows in fixed source order. If multiple selected rows map to the same target provider, later rows overwrite earlier rows and earlier result rows are marked overwritten.

## UI Integration

- Add `ProviderConfigImportDialog.vue` under settings components.
- Add a Data Settings row and section target id `provider-import`.
- Add welcome page import action inside the provider selection grid; it opens settings route `settings-database` with section `provider-import` and resumes the onboarding guide on the next provider setup step without completing setup until import succeeds.
- Keep scan source rows text-first and compact, without per-agent icons.
- Add an API type selector for custom provider rows; default to the mapping result and submit the override with the provider selection.
- On successful import during onboarding, complete provider setup steps that are satisfied by imported config.

## Test Strategy

- Main tests for readers, mapping, default selection, scan session, apply overwrite order, and model writes.
- Renderer tests for Data Settings entry, section auto-open, dialog flow, empty/error states, and welcome button navigation.
- Verify with local real scans on installed Alma and Cherry Studio after tests pass.
