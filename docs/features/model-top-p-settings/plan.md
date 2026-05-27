# Implementation Plan

## Approach

Implement `topP` as an optional generation setting, mirroring the existing session generation settings pipeline while avoiding a forced default.

## Affected Interfaces

- `src/shared/types/agent-interface.d.ts`: add optional `topP` to `SessionGenerationSettings`.
- `src/shared/contracts/common.ts`: add optional `topP` to route schemas.
- `src/shared/utils/generationSettingsValidation.ts`: validate `topP` as a finite number in `[0.1, 1]`.
- `src/main/presenter/sqlitePresenter/tables/deepchatSessions.ts`: add `top_p` storage and migration.
- `src/main/presenter/agentRuntimePresenter/index.ts`: sanitize, persist, and pass `topP` through runtime model config.
- `src/main/presenter/llmProviderPresenter/aiSdk/runtime.ts`: include `topP` in AI SDK `generateText` and `streamText` calls and request traces when defined.
- `src/renderer/src/stores/ui/draft.ts`: carry draft `topP` overrides for new sessions.
- `src/renderer/src/components/chat/ChatStatusBar.vue`: show and persist the compact `topP` control.
- i18n `chat.json` and `settings.json` files: add `topP` label, hover description, and validation.
- `topP` number inputs use min `0.1`, max `1`, and step `0.1` so values align with common AI SDK/provider constraints.

## Data Flow

1. User edits `topP` in ChatStatusBar.
2. Draft sessions store it in Pinia; active sessions call `sessions.updateGenerationSettings`.
3. Main process validates and stores `topP` as part of session generation settings.
4. Agent runtime adds `topP` to runtime `ModelConfig`.
5. AI SDK runtime includes `topP` only when defined.

## Compatibility

- Existing databases migrate by adding nullable `top_p`.
- Existing sessions return no `topP` unless previously set.
- Requests without `topP` preserve current behavior.

## Test Strategy

- Run formatting and i18n generation required by repository guidelines.
- Run lint to catch type/schema/template issues.
- Prefer focused type/lint validation over provider integration tests because this is a pass-through parameter.
