# DeepChat Tape System - Implementation Baseline

Status: current implementation baseline. Retained Tape implementation specs are
[deepchat-tape-view-manifest](../deepchat-tape-view-manifest/spec.md),
[deepchat-tape-replay-contract](../deepchat-tape-replay-contract/spec.md),
[deepchat-tape-view-assembler](../deepchat-tape-view-assembler/spec.md),
[deepchat-tape-view-policy](../deepchat-tape-view-policy/spec.md),
[deepchat-tape-policy-provenance](../deepchat-tape-policy-provenance/spec.md),
[deepchat-tape-policy-selector](../deepchat-tape-policy-selector/spec.md), and
[subagent-tape-lineage](../subagent-tape-lineage/spec.md).

This document keeps the Tape vision aligned with the current DeepChat codebase. The implementation
path is:

```text
Existing DeepChat runtime
  -> existing DeepChatTapeService
  -> ViewManifest shadow mode
  -> Inspector and replay contracts
  -> TapeViewAssembler production entry
  -> TapeViewPolicy boundary
  -> ViewManifest policy provenance
  -> TapeViewPolicy registry and selector
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
| Context assembly | `tapeViewAssembler.ts` | Production entry that assembles provider context from tape-effective records. |
| View policy | `tapeViewPolicy.ts` | Registry and selector boundary; `legacy_context_v1` delegates to the current selector. |
| Context selection | `contextBuilder.ts` | Legacy token-budget selector used by `legacy_context_v1`. |
| Request trace | `deepchat_message_traces` | Stores redacted provider request previews for the trace dialog. |
| Tape lineage | `DeepChatTapeService` + `new_sessions` | Keeps true forks as copy-on-merge branches and production subagents as independently readable, frozen-head Tape links. |
| Model recall tools | `agentTapeTools.ts` | Exposes the atomic `tape_search` / `tape_context` pair only when both runtime ports are available for a persisted DeepChat session; linked-subagent recall is an explicit scope on the same pair. |
| Diagnostic/runtime APIs | `DeepChatTapeService` + `SessionProjectionCoordinator` | Retains info, anchor listing, and handoff below the model-tool boundary; these capabilities are not user-configurable Agent tools. |

The first implementation step uses this baseline as the single runtime path. `DeepChatTapeService`
remains the Tape service boundary.

## Retained Specs

The retained Tape specs are:

```text
docs/architecture/deepchat-tape-view-manifest/
└── spec.md
docs/architecture/deepchat-tape-replay-contract/
└── spec.md
docs/architecture/deepchat-tape-view-assembler/
└── spec.md
docs/architecture/deepchat-tape-view-policy/
└── spec.md
docs/architecture/deepchat-tape-policy-provenance/
└── spec.md
docs/architecture/deepchat-tape-policy-selector/
└── spec.md
docs/architecture/subagent-tape-lineage/
└── spec.md
```

The retained scopes are `Existing TapeService + ViewManifest shadow mode`, replay/export
contracts, `TapeViewAssembler` as the production context assembly entry, and `TapeViewPolicy` as
the policy replacement boundary, `ViewManifest` policy provenance, policy selector registry, and
the distinction between true fork merge and production subagent Tape links.

## Scope Boundary

### In scope

- Generate a `ViewManifest` for each DeepChat LLM request while `TapeViewAssembler` remains
  provider-message equivalent with the legacy context selector.
- Persist manifests as `view/assembled` tape events.
- Link manifests to request traces by `messageId` and request sequence.
- Add Inspector support that explains included/excluded context entries.
- Add parity tests proving shadow manifests describe the same context that the existing runtime
  sends.
- Export replay slices from manifest, trace metadata, and referenced tape entries.
- Route chat and resume production context assembly through `TapeViewAssembler`.
- Route context selection through `TapeViewPolicy` with `legacy_context_v1` as the default policy.
- Persist the active Tape view policy id and version in initial chat and resume manifests.
- Resolve active Tape view policies through a registry-backed selector.

### Deferred scope for the first increment

- Creating a separate TapeStore abstraction.
- Memory graph retrieval, embedding-backed topic clustering, and unrestricted or recursive
  cross-session recall. Explicit recall of finalized direct-subagent Tape links is implemented.
- Live LLM replay in CI.
- Full eval pipeline and training exports.

## Implementation Rules

1. Keep `DeepChatTapeService` as the Tape service boundary.
2. Store manifest data as append-only tape events.
3. Keep raw prompt and provider request bodies in existing trace storage only.
4. Store IDs, hashes, token estimates, policy names, policy versions, and exclusion reasons in the
   manifest.
5. Keep old sessions compatible through existing lazy backfill and bootstrap anchors.
6. Treat `ViewManifest` as an explanation and regression artifact until parity is proven.
7. Treat persisted session ownership as the authorization source for linked Tape reads. Link events
   freeze readable child heads but never copy child entries into the parent effective view.

## Subagent Tape Lineage

Production subagents own durable, independent Tapes. Finalization appends one idempotent
`subagent/tape_linked` event to the parent with a closed lifecycle outcome and frozen child head;
missing capability or failed persistence leaves finalization retryable. The parent can explicitly
search finalized direct children through `linked_subagents` or `current_and_linked`, and can expand
context within one authorized source Tape by `sourceSessionId`. These reads are bounded by the link
head and the linked child Tape incarnation; clearing and rebuilding a child cannot reuse entry IDs
to impersonate the snapshot. Reads do not bootstrap, backfill, repair projections, or mutate Memory
state.

True forks retain different semantics: their selected delta and `fork/merge` receipt append to the
parent in one SQLite transaction, retries reuse the committed receipt, and branch-local control
anchors are excluded. Legacy external `fork/merge` records remain readable as child links;
`fork/discard` remains audit-only. No database schema migration or third model tool was added.

## Target Flow

```text
sendMessage / resume
  -> ensureSessionTapeReady()
  -> TapeViewAssembler.buildChatView() / buildResumeView()
  -> TapeViewPolicy selector
  -> legacy_context_v1 TapeViewPolicy
  -> assemble ViewManifest shadow event with legacy_context_v1@1 provenance
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
| View view_01                    Policy legacy_context_v1@1         |
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
