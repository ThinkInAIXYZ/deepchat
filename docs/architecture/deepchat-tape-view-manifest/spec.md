# DeepChat Tape ViewManifest Shadow Mode - Spec

Status: implemented SDD. This goal records the shadow-mode architecture and implementation tasks.

## Problem

DeepChat already persists append-only tape facts and request traces. The runtime lacks a persisted
context-selection decision for each LLM request. Debugging a long session currently requires
correlating message rows, compaction anchors, context-budget behavior, and provider request JSON by
hand.

`ViewManifest` shadow mode records that decision while keeping the existing context builder as the
production path.

## Current Code Baseline

| Area | Current file | Role in this goal |
| --- | --- | --- |
| Tape table | `src/main/presenter/sqlitePresenter/tables/deepchatTapeEntries.ts` | Stores append-only events and anchors. |
| Tape service | `src/main/presenter/agentRuntimePresenter/tapeService.ts` | Existing Tape boundary; new manifest methods belong here or next to it. |
| Effective tape view | `src/main/presenter/agentRuntimePresenter/tapeEffectiveView.ts` | Reconstructs current message facts from tape entries. |
| Context builder | `src/main/presenter/agentRuntimePresenter/contextBuilder.ts` | Production path that shadow manifests must describe. |
| Runtime send path | `src/main/presenter/agentRuntimePresenter/index.ts` | Calls `ensureSessionTapeReady()`, `buildContext()`, and `runStreamForMessage()`. |
| Message trace | `src/main/presenter/sqlitePresenter/tables/deepchatMessageTraces.ts` | Existing request trace storage shown in the renderer. |
| Trace dialog | `src/renderer/src/components/trace/TraceDialog.vue` | First UI surface for ViewManifest inspection. |

## Goals

1. Persist one `ViewManifest` for every DeepChat LLM request attempt.
2. Keep `buildContext()` and request preflight behavior unchanged.
3. Explain included and excluded conversation facts with stable IDs and reasons.
4. Link each manifest to the assistant message and request sequence.
5. Support trace-dialog inspection while keeping raw prompt text out of the manifest.
6. Create parity tests that compare existing context output to manifest metadata.

## Deferred Scope

- Replacing `buildContext()` with a new assembler.
- Introducing a second TapeStore abstraction.
- Migrating old sessions eagerly.
- Adding embedding memory, topic clustering, or cross-session recall.
- Running live LLM replay in CI.
- Storing raw provider request bodies in tape events.

## User Stories

- As a developer, I can open a traced assistant message and see why each context entry was included
  or excluded.
- As a maintainer, I can change context selection code and run tests that detect manifest/context
  divergence.
- As an agent-runtime debugger, I can inspect the latest anchor, summary cursor, and token budget
  used for a request.
- As a privacy-conscious user, I get manifest metadata while raw prompt content stays in its current
  storage path.

## Acceptance Criteria

1. A normal chat turn appends a `view/assembled` tape event before the provider request is sent.
2. A resume turn appends a `view/assembled` tape event with `taskType = "resume"`.
3. A tool-loop provider request appends a request-level manifest with a monotonic `requestSeq` for
   the assistant message.
4. If context-pressure recovery changes the provider request messages, a new manifest revision is
   appended with `policy = "context_pressure_recovery_shadow"` and `policyVersion = null`.
5. The manifest records selected message IDs, source tape entry IDs when available, excluded message
   IDs, exclusion reasons, token-budget inputs, prompt hash, and tool-definition hash.
6. The manifest stores IDs, hashes, token estimates, policies, policy versions, and reasons. Raw
   user text, raw assistant text, raw tool output, image data, audio data, file content, API
   headers, and API keys stay in existing storage paths.
7. Trace UI can show Request and View Manifest tabs for a traced assistant message.
8. Existing trace behavior remains compatible when a manifest is absent.
9. Tests prove that the selected history represented by the manifest matches `buildContext()` for
   normal chat and resume paths.
10. Tests prove request-level manifest ordering across tool-loop provider calls.

## ViewManifest Contract

The first version is a shadow contract. It describes what the current runtime did.

```ts
export type DeepChatTapeViewManifest = {
  schemaVersion: 1
  viewId: string
  sessionId: string
  messageId: string
  requestSeq: number

  taskType: 'chat' | 'resume' | 'tool_loop'
  policy:
    | 'legacy_context_v1'
    | 'legacy_context_shadow'
    | 'resume_shadow'
    | 'tool_loop_shadow'
    | 'context_pressure_recovery_shadow'
  policyVersion: number | null

  contextBuilderVersion: 'legacy-v1'
  latestEntryId: number
  anchorEntryIds: number[]

  included: DeepChatTapeViewEntryRef[]
  excluded: DeepChatTapeViewExcludedRef[]

  tokenBudget: {
    contextLength: number
    requestedMaxTokens: number
    effectiveMaxTokens: number
    reserveTokens: number
    toolReserveTokens: number
    estimatedPromptTokens: number
  }

  hashes: {
    promptHash: string
    toolDefinitionsHash: string
    manifestHash: string
  }

  meta: {
    providerId: string
    modelId: string
    summaryCursorOrderSeq: number
    supportsVision: boolean
    supportsAudioInput: boolean
    traceDebugEnabled: boolean
  }

  assembledAt: number
}

export type DeepChatTapeViewEntryRef = {
  entryId: number | null
  messageId: string | null
  orderSeq: number | null
  role: 'system' | 'user' | 'assistant' | 'tool' | null
  source: 'tape' | 'synthetic'
  reason:
    | 'system_prompt'
    | 'selected_history'
    | 'new_user_input'
    | 'resume_target'
    | 'tool_loop_message'
}

export type DeepChatTapeViewExcludedRef = {
  entryId: number | null
  messageId: string | null
  orderSeq: number | null
  reason:
    | 'before_summary_cursor'
    | 'compaction_indicator'
    | 'pending_not_context_history'
    | 'out_of_budget'
    | 'empty_after_formatting'
    | 'superseded'
    | 'retracted'
}
```

## Persistence Contract

Manifests are append-only tape events:

```json
{
  "kind": "event",
  "name": "view/assembled",
  "source_type": "runtime_event",
  "source_id": "<assistant-message-id>",
  "source_seq": 1,
  "payload_json": {
    "name": "view/assembled",
    "data": {
      "manifest": "<DeepChatTapeViewManifest>"
    }
  }
}
```

The manifest lookup key is `(sessionId, messageId, requestSeq)`. Existing tape indexes support this
through `source_type`, `source_id`, and `source_seq`.

## UI Contract

The first UI increment extends the existing trace dialog.

```text
+-------------------------------------------------------------------+
| Trace #1   Request | View Manifest | Tape Entries | Budget         |
+-------------------------------------------------------------------+
| View view_01        Policy legacy_context_v1  Version 1            |
| Anchor #42          Summary cursor 17                              |
+------------------+------------------------------------------------+
| Included         | #43 user order=17 selected_history              |
|                  | #44 assistant order=18 selected_history         |
| Excluded         | #1 user order=1 before_summary_cursor           |
|                  | #29 assistant order=12 out_of_budget            |
+------------------+------------------------------------------------+
```

States:

- Loading: dialog shows the existing spinner.
- Empty: Request tab stays available, View Manifest tab shows an empty state for this trace.
- Error: Request tab stays available during View Manifest loading failures.
- Legacy trace: the manifest tab explains that older traces have empty manifest state.

## Privacy and Security

- Store hashes and IDs in the manifest.
- Store raw provider request previews only in `deepchat_message_traces`.
- Reuse existing redaction for request traces.
- Keep file contents, image data, audio data, tool output, headers, and prompts in their existing
  storage paths.

## Compatibility

- Old sessions keep lazy backfill through `DeepChatTapeService.ensureSessionTapeReady()`.
- Old traces render with an empty manifest state.
- Missing tape table remains a supported fallback for existing runtime code.
- The manifest feature preserves chat generation behavior, request ordering, and token-budget
  decisions.
- Manifest append failures are logged and request execution continues.

## Success Criteria

- Shadow manifest generation is covered by unit tests for normal chat, resume, and tool-loop
  request sequencing.
- Trace UI can display manifest data when present and degrade cleanly when absent.
- `buildContext()` output remains unchanged in existing tests.
- The SDD can support a later replacement phase where a real `TapeViewAssembler` becomes the
  production path.
