# Manual Compaction Command Spec

> Status: Draft
> Date: 2026-05-12

## Background

DeepChat Agent sessions already auto-compact old conversation history when context pressure reaches
the configured threshold. Users sometimes know a session should be compacted before the automatic
threshold is reached, especially before switching tasks or continuing a long-running agent thread.

ACP agents manage their own command and context policy, so this feature is DeepChat Agent only.

## Goals

- Add a DeepChat Agent-only `/compact` slash command.
- Let users trigger the same compaction behavior as auto compaction without checking the current
  threshold.
- Keep manual compaction available even when auto compaction is disabled.
- Hide `/compact` while a DeepChat session is generating, without disabling other slash suggestions.

## Acceptance Criteria

- In an idle DeepChat session, `/compact` appears in slash suggestions and triggers compaction.
- The command does not create a user message and is not sent to the model.
- Manual compaction reuses existing compaction messages, summary state updates, and renderer events.
- Manual compaction ignores `autoCompactionEnabled`, trigger threshold, and retain-recent-pairs
  settings; those settings only affect automatic compaction.
- Manual compaction summarizes all eligible history after the current summary cursor, and only
  returns no-op when there is no new persisted history to summarize.
- ACP sessions and new-thread drafts do not show or execute `/compact`.
- During generation, `/compact` is hidden and exact `/compact` submission is ignored; skills,
  prompts, and tools remain available in slash suggestions.

## Non-Goals

- Add manual compaction controls outside the slash command.
- Change ACP command handling.
- Change the automatic compaction threshold behavior.
