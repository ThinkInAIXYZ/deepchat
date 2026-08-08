# Configurable Agent Output Limits Tasks

## 1. Specification

- [x] Assess issue #2102 against the current runtime.
- [x] Separate effective inline limits from internal spooling constants.
- [x] Define defaults, bounds, ownership, compatibility, and non-goals.
- [x] Record the Settings UI before/after layout.

## 2. Shared contract

- [x] Add the three optional fields to `DeepChatAgentConfig`.
- [x] Validate integer bounds in `DeepChatAgentConfigSchema`.
- [x] Add shared defaults and defensive normalization.
- [x] Add focused normalization contract coverage.

## 3. Runtime

- [x] Apply the per-Agent read limit to raw text and prepared document reads.
- [x] Apply the per-Agent generic tool limit in `ToolOutputGuard`.
- [x] Apply the per-Agent command limit to `exec` and `skill_run` foreground previews.
- [x] Preserve full overflow output through bounded disk spooling.
- [x] Reuse command log paths during context fallback and avoid nested offloads.
- [x] Preserve custom values through the production Agent repository merge path.
- [x] Apply Agent command limits to background session completion and `process` polling previews.
- [x] Cancel stale deferred-result fitting before persistence and clean only guard-owned files.
- [x] Keep context preflight and terminal fallback behavior intact.

## 4. Renderer

- [x] Add the collapsed advanced output limits section under Tools.
- [x] Load, normalize, diff, save, and reset all three values.
- [x] Add complete locale key coverage.
- [x] Provide native output-limit copy in every supported locale.
- [x] Add one persistence/normalization component regression test.

## 5. Verification and cleanup

- [x] Run focused shared, main runtime, tool manager, command, and renderer tests.
- [x] Remove temporary implementation-only tests and artifacts.
- [x] Run `pnpm format` and review the diff.
- [x] Run `pnpm i18n`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm typecheck`.
- [x] Mark the feature documents implemented with final verification evidence.
