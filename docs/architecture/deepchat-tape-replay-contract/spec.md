# DeepChat Tape Replay Contract - Spec

Status: implemented SDD. This goal extends the completed ViewManifest shadow-mode increment with a
stable replay/export contract.

## Problem

ViewManifest records which context facts participated in each provider request. The next Tape
architecture layer needs a typed export shape that joins a manifest, matching trace metadata, and
referenced tape entries into one deterministic slice. Without this slice, Inspector debugging and
future eval/replay tools still need to reimplement lookup rules.

## Goals

1. Export a `DeepChatTapeReplaySlice` for a message request sequence.
2. Reuse `DeepChatTapeService` and existing `deepchat_tape_entries` / `deepchat_message_traces`
   storage.
3. Keep metadata-only export as the default.
4. Allow explicit inclusion of existing tape payloads and trace payloads for developer replay.
5. Produce stable hashes for slice, tape entry payloads, tape entry metadata, and trace payloads.
6. Return `null` when no manifest exists for the requested message or request sequence.

## Non-Goals

- Running live LLM replay.
- Replacing `buildContext()` or request preflight behavior.
- Adding a dedicated replay table.
- Adding cross-session memory retrieval.

## User Stories

- As a runtime debugger, I can export one request's manifest, trace metadata, and referenced tape
  entries with one typed call.
- As an eval author, I can identify the exact manifest hash and request hash for a historical
  request.
- As a privacy-conscious maintainer, I can inspect replay structure without duplicating raw prompt
  or message content by default.

## Acceptance Criteria

1. `DeepChatTapeService` can export the latest replay slice for a message.
2. `DeepChatTapeService` can export a replay slice for an explicit `requestSeq`.
3. The slice includes the manifest record, matching trace metadata when present, referenced tape
   entry snapshots, anchor refs, and stable hashes.
4. The default export omits tape `payload` / `meta` and trace `headersJson` / `bodyJson`.
5. Explicit options can include tape payloads and trace payloads from their existing storage paths.
6. A typed route and renderer client method expose the export by `messageId`.
7. Tests cover default privacy behavior, explicit payload inclusion, missing manifests, and
   request-sequence selection.

## Contract

```ts
export interface DeepChatTapeReplaySlice {
  schemaVersion: 1
  sliceId: string
  sessionId: string
  messageId: string
  requestSeq: number
  mode: 'manifest_only' | 'trace_bound'
  manifestRecord: DeepChatTapeViewManifestRecord
  trace: DeepChatTapeReplayTraceSnapshot | null
  entries: DeepChatTapeReplayEntrySnapshot[]
  refs: {
    manifestEntryId: number
    includedEntryIds: number[]
    excludedEntryIds: number[]
    anchorEntryIds: number[]
  }
  hashes: {
    manifestHash: string
    sliceHash: string
  }
  createdAt: number
}
```

## Privacy

Default export is metadata-only. It contains IDs, timestamps, names, source refs, and hashes.
Payload inclusion is opt-in and reads from existing storage:

- tape entry payload/meta from `deepchat_tape_entries`
- trace headers/body from `deepchat_message_traces`

No new raw-content storage path is introduced.
