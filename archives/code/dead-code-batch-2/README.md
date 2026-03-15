# Dead Code Batch 2

- Purpose: archive dead code that no longer participates in the active renderer or main runtime.
- Archived at: 2026-03-15
- Rationale: static inspection confirmed these files have no live code references and are kept in
  source form for precise rollback only.

## Archived Paths

- `src/renderer/src/components/NewThreadMock.vue`
- `src/renderer/src/components/mock/MockChatPage.vue`
- `src/renderer/src/components/mock/MockInputBox.vue`
- `src/renderer/src/components/mock/MockInputToolbar.vue`
- `src/renderer/src/components/mock/MockMessageList.vue`
- `src/renderer/src/components/mock/MockStatusBar.vue`
- `src/renderer/src/components/mock/MockTopBar.vue`
- `src/renderer/src/components/mock/MockWelcomePage.vue`
- `src/renderer/src/composables/useMockViewState.ts`
- `src/main/presenter/agentPresenter/tools/questionTool.ts`
- `src/main/presenter/agentPresenter/message/systemEnvPromptBuilder.ts`
- `src/main/presenter/agentPresenter/events.ts`
- `src/main/presenter/agentPresenter/message/index.ts`
- `src/main/presenter/agentPresenter/permission/index.ts`
- `src/main/presenter/agentPresenter/session/index.ts`
- `src/main/presenter/agentPresenter/streaming/index.ts`
- `src/main/presenter/agentPresenter/tool/index.ts`
- `src/main/presenter/agentPresenter/utility/index.ts`
- `src/main/presenter/searchPrompts/index.ts`
- `src/main/presenter/sessionPresenter/persistence/index.ts`
- `src/main/presenter/sessionPresenter/tab/index.ts`

## Notes

- This directory is not part of the runtime, build, typecheck, or test target set.
- Restore by moving files back to their original paths if a later audit proves they are still
  needed.
