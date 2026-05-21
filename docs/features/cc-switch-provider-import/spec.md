# CC Switch Provider Import

## Goal

Allow users to import configured provider credentials from CC Switch through the existing provider import dialog, without copying API keys by hand.

## User Stories

- As a DeepChat user, I can see CC Switch as a detected provider import source when `~/.cc-switch/cc-switch.db` exists.
- As a user with CC Switch providers, I only see rows that contain a real API key.
- As a user importing Claude-compatible CC Switch providers, I do not accidentally switch DeepChat built-in providers to the wrong runtime.

## Acceptance Criteria

- CC Switch appears first in the provider import source order.
- The first import page only lists detected sources, hiding sources whose config files are missing.
- The scan reads CC Switch provider rows for `claude`, `claude-desktop`, `gemini`, `opencode`, `openclaw`, and `hermes`.
- CC Switch `codex` rows are intentionally ignored; DeepChat does not parse TOML from CC Switch.
- Rows with blank API keys or placeholder/template API keys are not shown in scan results.
- DeepSeek rows exposed as Anthropic-compatible endpoints import only the API key into DeepChat's built-in `deepseek` provider, preserving its existing runtime and base URL.
- MiniMax rows map to DeepChat's built-in `minimax` provider and keep Anthropic runtime behavior.
- Unknown importable rows with an API key and HTTP endpoint import as custom providers with the safest inferred API type.
- Raw API keys stay in the main process scan session and are never returned to the renderer during preview.

## Non-Goals

- Importing CC Switch Codex providers.
- Reading CC Switch custom data directories.
- Importing CC Switch conversations, prompts, MCP servers, skills, usage data, or failover settings.
- Network validation of imported credentials.
