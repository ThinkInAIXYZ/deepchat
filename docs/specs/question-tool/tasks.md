# Tasks: Question Tool (Agent-to-User Choices)

## 0) Spec & plan quality gate

1. Resolve all `[NEEDS CLARIFICATION]` items in `docs/specs/question-tool/spec.md`.
2. Confirm acceptance criteria map to tests in main/renderer.
3. Confirm runtime constraint: standalone + last tool call for `question`.

## 1) Shared types & contracts

1. Extend `AssistantMessageBlock['action_type']` to include `question_request`.
2. Add shared `QuestionInfo` / `QuestionAnswer` types (and optional zod schema) under `src/shared/**`.
3. Add/extend shared typing for `AssistantMessageBlock.extra` question fields.

## 2) Main process (Agent tool + pause/resume)

1. Add `question` tool definition to `AgentToolManager.getAllToolDefinitions`.
2. Implement `question` tool execution to:
   - validate input
   - create a `question_request` action block (pending)
   - pause the session and stop tool execution for the current turn
3. Enforce “standalone + last tool call” constraints during tool execution; surface errors as error blocks.
4. Track `pendingQuestion` in session runtime (optional but recommended).
5. Implement main-side auto-resolve on the next user message when a question is pending.
6. Add main tests under `test/main/**` covering pause/resume and constraints.

## 3) Preload / IPC surface

1. Add typed presenter methods for resolving/rejecting a pending question.
2. Ensure context isolation and minimal surface (no direct Node APIs in renderer).

## 4) Renderer (UI + integration)

1. Add i18n keys for the question block UI.
2. Add `MessageBlockQuestionRequest.vue`:
   - pending view with options (single/multi) + custom input + reject
   - resolved view showing question + answer/rejected
3. Render the block from `MessageItemAssistant.vue`.
4. Insert user message on selection/submit (reuse existing send flow).
5. Add renderer tests under `test/renderer/**` for critical paths.

## 5) Quality gates

1. Run `pnpm run format`.
2. Run `pnpm run lint`.
3. Run `pnpm run typecheck`.
4. Run `pnpm test` (or targeted suites).

