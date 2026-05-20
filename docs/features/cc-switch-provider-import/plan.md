# CC Switch Provider Import Plan

## Implementation

- Extend `ProviderImportService` with a `cc-switch` source that reads `~/.cc-switch/cc-switch.db` in readonly mode and uses the Windows HOME fallback only when the default profile path is missing.
- Put CC Switch first in the shared provider import source order.
- Keep scan results complete, but filter the first renderer source list to detected sources so missing apps are not shown.
- Query the `providers` table for supported CC Switch app types except `codex`.
- Parse app-specific JSON settings:
  - Claude and Claude Desktop: `env.ANTHROPIC_AUTH_TOKEN` or `env.ANTHROPIC_API_KEY`, `env.ANTHROPIC_BASE_URL`, model env values, and desktop route metadata.
  - Gemini: `env.GEMINI_API_KEY`, `env.GOOGLE_GEMINI_BASE_URL`, `env.GEMINI_MODEL`.
  - OpenCode: `options.apiKey`, `options.baseURL`, AI SDK package name, and model keys.
  - OpenClaw: `apiKey`, `baseUrl`, `api`, and `models`.
  - Hermes: `api_key`, `base_url`, `api_mode`, and `models`.
- Filter all import sources after raw read so blank/template API keys never reach the public preview list.
- Add mapping metadata for credential-only imports so built-in providers keep their configured endpoint and runtime when CC Switch exposes a different wire protocol.

## Compatibility

- Existing import sessions remain in-memory and short-lived.
- Existing Alma, Cherry Studio, Hermes, and OpenClaw parsing keeps the same file formats but now hides empty provider configs.
- Custom provider API type override remains available for custom rows.

## Risks

- CC Switch may add new app types or settings shapes. Unknown rows should fail closed by hiding unsupported rows rather than guessing.
- Some translated descriptions may not mention CC Switch yet, but the source row itself is localized by provider name.
