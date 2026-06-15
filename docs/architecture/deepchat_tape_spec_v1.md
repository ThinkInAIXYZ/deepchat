# DeepChat Tape System - Implementation Baseline

Status: current implementation direction. The active SDD goal is
[deepchat-tape-view-manifest](deepchat-tape-view-manifest/spec.md).

This document keeps the Tape vision aligned with the current DeepChat codebase. The implementation
path is:

```text
Existing DeepChat runtime
  -> existing DeepChatTapeService
  -> ViewManifest shadow mode
  -> Inspector and replay contracts
  -> later policy replacement
```

## Current Baseline

DeepChat already has the main Tape primitives.

| Tape concept | Current owner | Notes |
| --- | --- | --- |
| Tape store | `DeepChatTapeEntriesTable` | Append-only `deepchat_tape_entries` with per-session monotonic `entry_id`. |
| Tape service | `DeepChatTapeService` | Backfills message facts, exposes info/search/anchors/handoff/fork metadata. |
| Message facts | `DeepChatMessageStore` + `tapeFacts.ts` | User, assistant, tool call, tool result, replacement, and retraction facts. |
| Anchor | `kind = "anchor"` entries | `session/start`, `compaction/*`, `handoff/*`, `auto_handoff/*`, `fork/start`. |
| Effective view | `tapeEffectiveView.ts` | Reconstructs current message records from append-only facts. |
| Context build | `contextBuilder.ts` | Current production context assembler and token-budget selector. |
| Request trace | `deepchat_message_traces` | Stores redacted provider request previews for the trace dialog. |
| Agent tools | `agentTapeTools.ts` | Exposes `tape_info`, `tape_search`, `tape_anchors`, `tape_handoff`. |

The first implementation step uses this baseline as the single runtime path. `DeepChatTapeService`
remains the Tape service boundary.

## Active SDD

The active SDD folder is:

```text
docs/architecture/deepchat-tape-view-manifest/
├── spec.md
├── plan.md
└── tasks.md
```

The SDD scope is `Existing TapeService + ViewManifest shadow mode`.

## Scope Boundary

### In scope

- Generate a `ViewManifest` for each DeepChat LLM request while `buildContext` remains the source
  of model messages.
- Persist manifests as `view/assembled` tape events.
- Link manifests to request traces by `messageId` and request sequence.
- Add Inspector support that explains included/excluded context entries.
- Add parity tests proving shadow manifests describe the same context that the existing runtime
  sends.

### Deferred scope for the first increment

- Replacing `buildContext` as the production context builder.
- Creating a separate TapeStore abstraction.
- Memory graph retrieval, embedding-backed topic clustering, and cross-session recall.
- Live LLM replay in CI.
- Full eval pipeline and training exports.

## Implementation Rules

1. Keep `DeepChatTapeService` as the Tape service boundary.
2. Store manifest data as append-only tape events.
3. Keep raw prompt and provider request bodies in existing trace storage only.
4. Store IDs, hashes, token estimates, policy names, and exclusion reasons in the manifest.
5. Keep old sessions compatible through existing lazy backfill and bootstrap anchors.
6. Treat `ViewManifest` as an explanation and regression artifact until parity is proven.

## Target Flow

```text
sendMessage / resume
  -> ensureSessionTapeReady()
  -> buildContext()
  -> assemble ViewManifest shadow event
  -> runStreamForMessage()
  -> preflight provider request
  -> assemble request-level ViewManifest revision if context changed
  -> provider.coreStream()
  -> optional request trace linked to ViewManifest
  -> message/tool facts appended
```

## Inspector Shape

```text
+-------------------------------------------------------------------+
| Trace #1   Request | View Manifest | Tape Entries | Budget         |
+-------------------------------------------------------------------+
| Provider openai                 Model gpt-4.1                     |
| View view_01                    Policy legacy_context_shadow       |
+-----------------------------+-------------------------------------+
| Included                    | message/user #12                    |
|                             | message/assistant #13               |
| Excluded                    | #1-#8 compressed by anchor #42       |
| Budget                      | 23k estimated / 64k context         |
+-----------------------------+-------------------------------------+
```

## Expected Benefits

- Every LLM request can explain which conversation facts were included.
- Context compaction and handoff behavior becomes auditable through anchor and manifest metadata.
- Trace debugging gains policy-level context instead of only raw request JSON.
- Future context-policy changes get a parity baseline.
- Evaluation and replay can be derived from existing runtime facts after the manifest contract is
  stable.
