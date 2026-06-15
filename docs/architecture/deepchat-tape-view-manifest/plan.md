# DeepChat Tape ViewManifest Shadow Mode - Plan

## Architecture Decision

Use the existing `DeepChatTapeService` and `deepchat_tape_entries` table. The first increment adds a
shadow manifest layer that observes context construction and request preflight results. It records
metadata as tape events and leaves production message assembly unchanged.

`DeepChatTapeService` remains the single Tape service boundary.

## Event Flow

```text
AgentRuntimePresenter.processMessage()
  -> tapeService.ensureSessionTapeReady()
  -> messageStore.createUserMessage()
  -> buildContext()
  -> tapeViewManifestService.assembleInitialManifest()
  -> tapeService.appendViewManifest()
  -> messageStore.createAssistantMessage()
  -> runStreamForMessage()
       -> processStream()
       -> coreStream(requestMessages, requestTools)
            -> preflightRequestContext()
            -> optional recoverRequestContextPressure()
            -> tapeViewManifestService.assembleRequestManifest()
            -> tapeService.appendViewManifest()
            -> provider.coreStream()
            -> optional request trace persists with matching requestSeq
```

Resume flow uses the same service with `taskType = "resume"` and `policy = "resume_shadow"`.

## Module Changes

| Module | Change |
| --- | --- |
| `src/shared/types/agent-interface.d.ts` or a new shared type file | Add public manifest result types for route/UI use. |
| `src/main/presenter/agentRuntimePresenter/tapeViewManifest.ts` | New pure assembler for manifest metadata and hashes. |
| `src/main/presenter/agentRuntimePresenter/tapeService.ts` | Append and list `view/assembled` events. |
| `src/main/presenter/agentRuntimePresenter/index.ts` | Call manifest assembly at initial context and request-level preflight points. |
| `src/shared/contracts/routes/sessions.routes.ts` | Add route for manifests by message ID. |
| `src/renderer/api/SessionClient.ts` | Add `listMessageViewManifests(messageId)`. |
| `src/renderer/src/components/trace/TraceDialog.vue` | Add tabs for Request, View Manifest, Tape Entries, and Budget. |

## Data Model

Phase 1 stores manifests as tape events. This avoids a schema migration and uses the existing source
index:

```text
deepchat_tape_entries
  session_id = session id
  kind = event
  name = view/assembled
  source_type = runtime_event
  source_id = assistant message id
  source_seq = request sequence
  payload_json.data.manifest = DeepChatTapeViewManifest
```

The route resolves `messageId -> sessionId`, then reads matching tape events.

## Request Sequence

`runStreamForMessage()` owns an in-memory request sequence counter for the assistant message:

```text
assistant message m1
  requestSeq 1 -> initial provider request
  requestSeq 2 -> provider request after a tool result
  requestSeq 3 -> provider request after another tool result
```

The same sequence is used for the manifest and the request trace. If trace debug is disabled, the
manifest still records the sequence.

## Hashing

- `promptHash`: stable hash of provider-bound `ChatMessage[]` after preflight and recovery.
- `toolDefinitionsHash`: stable hash of provider-bound tool definitions.
- `manifestHash`: stable hash of the manifest with `manifestHash` omitted.

Use deterministic JSON stringification for hash inputs.

## Exclusion Reason Rules

| Reason | Source |
| --- | --- |
| `before_summary_cursor` | Message order is below `summaryCursorOrderSeq`. |
| `compaction_indicator` | Message metadata marks a compaction indicator. |
| `pending_not_context_history` | Message status is pending outside the resume target. |
| `out_of_budget` | Turn was eligible but removed by token-budget selection. |
| `empty_after_formatting` | Record formatting produced zero provider messages. |
| `superseded` | Effective tape view replaced an older fact revision. |
| `retracted` | Effective tape view removed a message through a retraction event. |

## UI Layout

```text
TraceDialog
+-------------------------------------------------------------------+
| Header                                                            |
|   Title                                                           |
+-------------------------------------------------------------------+
| Trace selector                                                    |
+-------------------------------------------------------------------+
| Tabs: Request | View Manifest | Tape Entries | Budget             |
+-------------------------------------------------------------------+
| Request tab                                                       |
|   Endpoint / provider / model                                     |
|   JSON editor                                                     |
+-------------------------------------------------------------------+
| View Manifest tab                                                 |
|   View id / policy / request seq                                  |
|   Included and excluded entry list                                |
+-------------------------------------------------------------------+
| Tape Entries tab                                                  |
|   Matching event and anchor refs                                  |
+-------------------------------------------------------------------+
| Budget tab                                                        |
|   Context length / max tokens / estimated prompt tokens           |
+-------------------------------------------------------------------+
| Footer                                                            |
+-------------------------------------------------------------------+
```

The dialog remains compact and developer-focused, with explanatory copy kept to empty and error
states.

## Test Strategy

| Test area | Required checks |
| --- | --- |
| Manifest assembler | Includes selected records, excludes cursor/budget drops, hashes deterministically. |
| Context parity | Existing `buildContext()` messages match manifest included refs for normal chat. |
| Resume parity | `buildResumeContext()` target and protected tail are represented. |
| Request sequence | Tool-loop provider calls create monotonically increasing request manifests. |
| Tape service | Append/list manifest events by message ID and request sequence. |
| Route/client | Legacy messages with an absent manifest return an empty list. |
| Renderer | Trace dialog renders Request tab and View Manifest empty/data states. |

## Rollout

1. Land shadow manifest assembly and tape persistence as headless runtime metadata.
2. Add route/client and tests.
3. Add trace-dialog tabs.
4. Add context parity coverage.
5. Use collected manifest data to design the later `TapeViewAssembler` production path.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Manifest diverges from actual provider request after preflight recovery. | Append request-level manifest after preflight and recovery for provider-bound context. |
| Storage growth from per-request events. | Store metadata and hashes only; avoid raw content duplication. |
| UI fails on old traces. | Treat missing manifest as an empty state. |
| Request sequence drifts from trace sequence. | Runtime owns the sequence and passes it to both manifest and trace persistence. |
| Context mapping misses synthetic system/new-user messages. | Represent them with `source = "synthetic"` and `entryId = null`. |

## Verification Commands

Run focused tests during implementation:

```bash
pnpm vitest run test/main/presenter/agentRuntimePresenter/contextBuilder.test.ts
pnpm vitest run test/main/presenter/agentRuntimePresenter/tapeService.test.ts
pnpm vitest run test/main/presenter/sqlitePresenter/deepchatTapeEntriesTable.test.ts
pnpm vitest run test/renderer/components/trace/TraceDialog.test.ts
```

Before completing the feature, run:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```
