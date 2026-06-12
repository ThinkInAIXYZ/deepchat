# Skill Draft Confirmation Card

## User Need

When the Agent creates a reusable skill draft after a task, users need an obvious in-chat confirmation card instead of having the draft disappear into a temp directory with no visible follow-up path.

## Goal

After a successful `skill_manage` draft creation, show a blocking question-style card in the chat:

- “已生成 skill draft：xxx”
- Options: 查看内容 / 安装为 Skill / 丢弃

The card should reuse the existing question interaction panel so it fits the current Agent interaction flow and pauses until the user chooses an action.

## Acceptance Criteria

1. A successful `skill_manage` `create` result produces an in-chat question interaction card before the Agent continues.
2. The card has three options: view content, install as Skill, discard.
3. Choosing “查看内容” shows the draft `SKILL.md` content and keeps the draft available for a later install/discard choice.
4. Choosing “安装为 Skill” installs the draft into the configured skills directory and resumes the Agent with a clear success/failure tool result.
5. Choosing “丢弃” deletes the draft and resumes the Agent with a clear result.
6. Existing `deepchat_question` interactions continue to work unchanged.
7. Draft install/delete operations remain scoped to the current conversation and opaque draft id.

## Constraints

- Follow existing presenter boundaries and typed route/contracts patterns where needed.
- Keep the UI change focused by reusing `ChatToolInteractionOverlay` and `question_request` blocks.
- Avoid exposing absolute temp paths to the renderer or the model.
- All user-facing strings must use i18n keys.

## Non-goals

- No full Drafts management list/page in Settings.
- No long-term draft persistence beyond the current temp draft retention policy.
- No automatic install without user confirmation.

## Open Questions

Resolved: Use the existing question panel and show a confirmation card immediately after draft creation.
