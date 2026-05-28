# Plan

## Approach

1. Extend skill presenter with draft action helpers that can read, install, and delete a draft by conversation id and draft id.
2. When `skill_manage` `create` succeeds, include structured metadata in the tool raw result.
3. In agent runtime dispatch, detect successful draft creation and append a synthetic `question_request` action block using the existing question interaction flow.
4. Handle the synthetic interaction in `respondToolInteraction`:
   - View: read draft content and keep the same card pending with content attached.
   - Install: install draft folder into the configured skills directory, resolve the card, and update the `skill_manage` tool response.
   - Discard: delete draft, resolve the card, and update the `skill_manage` tool response.
5. Update renderer question panel to render draft preview content and localized option labels.
6. Add/update tests for presenter draft actions, tool metadata, runtime interaction behavior, and renderer panel display.

## Affected Interfaces

- `SkillManageResult` gains optional `draftStatus` and supporting metadata only where useful.
- `ISkillPresenter` gains draft action methods scoped by conversation id/draft id.
- `MCPToolResponse.toolResult` carries structured draft result metadata for runtime-only detection.
- Question action block `extra` gains skill-draft-specific metadata fields.

## Data Flow

```text
Agent skill_manage create
  -> SkillPresenter.manageDraftSkill creates temp draft
  -> AgentToolManager returns rawData.toolResult
  -> dispatch detects draft metadata
  -> append question_request card
  -> renderer shows ChatToolInteractionOverlay
  -> user chooses option
  -> AgentRuntimePresenter handles draft action
  -> SkillPresenter view/install/delete draft
  -> update card/tool response and resume as needed
```

## Compatibility

Existing question and permission blocks remain unchanged. Draft-specific behavior is guarded by `extra.skillDraftAction === 'confirm'` and the `skill_manage` tool name.

## Test Strategy

- Unit test draft action helpers in `skillPresenter`.
- Unit test `AgentToolManager` raw metadata for `skill_manage create`.
- Unit/integration test runtime draft confirmation interactions.
- Renderer component test for draft preview rendering in `ChatToolInteractionOverlay`.
