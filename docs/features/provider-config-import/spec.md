# Provider Config Import

## Goal

Help new and existing DeepChat users import model provider configuration from other local Agent clients so they can start using DeepChat without manually retyping API keys, base URLs, and model names.

## User Stories

- As a new user, I can choose "Import from other agents" from the welcome provider setup and continue in the settings import guide.
- As an existing user, I can open Data Settings and start an "Import from other agents" guide.
- As a user with multiple Agent clients installed, I can select one or more detected sources and review provider rows before importing.
- As a user with existing DeepChat provider config, I can see which rows would overwrite existing config before I opt in.
- As a user, I can see a final import summary with a scrollable list of imported, updated, overwritten, and skipped providers.

## Acceptance Criteria

- The import entry appears in Data Settings and opens a step-by-step dialog.
- The welcome Select a Provider choices include an "Import from other agents" action in the same highlighted selection area; the coachmark dialog does not own that action, and the highlighted area remains clickable.
- Clicking the welcome import action resumes the guide on the next provider setup step after settings opens; setup steps are marked complete only after an import succeeds.
- Scan checks macOS default paths for Alma, Cherry Studio, Hermes, and OpenClaw.
- Source order is fixed: Alma, Cherry Studio, Hermes, OpenClaw.
- Users can multi-select detected sources; selected sources are processed in fixed source order.
- Each selected source screen lists detected provider config, the DeepChat mapping, masked API key, base URL, model count, and default selection state.
- Providers already configured in DeepChat are not selected by default and show an overwrite warning.
- Unknown provider types with an API key and `http(s)` base URL import as custom providers, preserving the source name and using `apiType='openai-completions'`.
- Custom provider rows allow the user to override the DeepChat API type before import, because automatic protocol matching can be wrong.
- Custom rows with a base URL but no API key can be imported after selecting an API type that does not require an API key, such as Ollama; non-Ollama custom imports require both API key and endpoint.
- If later selected sources map to the same target provider, later sources overwrite earlier selected sources.
- Import reads source data only and never modifies other Agent application files.
- Renderer never receives raw API keys during scan; raw keys stay in the main process scan session until import is applied.

## Non-Goals

- Importing conversations, messages, attachments, MCP config, prompts, skills, or Agent definitions.
- Windows and Linux automatic source path discovery in this first increment.
- Exporting DeepChat provider config to other clients.
- Network validation of imported API keys.

## UX Notes

Keep the interface clean and operational:

```text
Data & Privacy
────────────────────────────────────────
Provider Config Import
Import API keys, base URLs, and models from other Agent clients.
                                      [Import from other agents]
────────────────────────────────────────
Database Repair                         [Check and repair]
Provider DB                             [Refresh provider DB]
```

```text
┌─ Import Provider Configs ───────────────────────────────┐
│  Scan → Alma → Cherry Studio → Hermes → OpenClaw → Done  │
│                                                          │
│  Select sources                                          │
│  Alma          Found 1 provider      ~/Library/...   [x] │
│  Cherry Studio Found 1 configured    ~/Library/...   [x] │
│  Hermes        Not found                            [ ] │
│  OpenClaw      Invalid config                       [ ] │
│                                                          │
│                         [Cancel] [Rescan] [Next]         │
└──────────────────────────────────────────────────────────┘
```

```text
┌─ Alma: choose providers ────────────────────────────────┐
│  [x] nextapi        → Custom / openai-completions        │
│      API type: [OpenAI Chat Completions v]               │
│      sk-1234...abcd · 8 models · https://.../v1          │
│  [ ] OpenAI         → OpenAI                             │
│      Already configured in DeepChat; not selected        │
│                                                          │
│                         [Back] [Next source]             │
└──────────────────────────────────────────────────────────┘
```

```text
┌─ Import Complete ───────────────────────────────────────┐
│  Imported 4 providers · 2 updated · 1 skipped           │
│                                                          │
│  Scrollable results                                     │
│  ✓ Alma / nextapi        Created custom provider         │
│  ✓ Cherry / new-api      Updated New API                 │
│  ↷ Hermes / PPInfra      Overwritten by OpenClaw         │
│  ! OpenClaw / broken     Skipped: missing API key        │
│                                                          │
│                                             [Done]       │
└──────────────────────────────────────────────────────────┘
```

## Constraints

- Use DeepChat typed route / typed event architecture for renderer-main communication.
- Use i18n keys for user-facing strings.
- Apply provider writes through `ConfigPresenter` and existing provider/model events, not direct `app-settings.json` edits.
- Use existing dependencies where possible; Cherry Studio LevelDB reading may add `level`.
