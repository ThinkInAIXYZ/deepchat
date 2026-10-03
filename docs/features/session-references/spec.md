# Explicit session references

## Context and scope

Implements the local-session reference flow described in #2388. EnsoCode supplies an interaction
reference; Obelisk supplies retrieval principles, not a dependency. Tape remains the fact authority,
and the existing transcript/search projections remain the read models. No second history database,
automatic memory extraction, external transcript importer, or second compaction policy is added.

## Interaction and persistence

`@` groups session-title matches separately from workspace files. Session candidates are regular,
non-draft sessions in the exact current workspace; a null workspace matches only null-workspace
sessions. Title filtering happens before limiting results. Explicit sidebar drag permits another
workspace, and inserts into the actual receiving composer. ACP composers report that the native
reader is unavailable instead of promising an unusable tool.

Both entry points resolve canonical source metadata through renderer-only typed IPC and create the
same `session` inline item: offset, sessionId, title, projectDir, and tapeIncarnationId. It survives
draft persistence, queueing, sending, and transcript display through the existing inline-items
path. Labels are snapshots; rename never changes identity. Source reset invalidates the reference.
References do not copy, summarize, or inject the source history.
For pre-incarnation Tapes, the reference's `tapeIncarnationId` is an opaque `legacy:` identity
derived from the unchanged canonical bootstrap row using Tape's existing identity hash. Only a
genuinely absent marker qualifies; malformed metadata or a present invalid marker is rejected.
This read-only compatibility path does not stamp old anchors, alter linked histories, or grant
UUID-only runtime capabilities. Reset replaces it with a new UUID and invalidates old references.
Search, clipboard text, and text exports retain the reference title and source ID. Editing message
text preserves attached session references and places them after the replacement text; the existing
text-only editor does not implicitly remove source grants. Deleting the referencing message removes
that message's grant.
Queue text edits apply the same reference re-anchoring rule. Reference-only queued inputs display
their source titles and remain saveable without adding placeholder text.
Merging steer inputs preserves their original text so inline offsets remain valid. If a draft is
edited while submission is pending, acceptance preserves its inline session references along with
its text; source identity alone cannot distinguish a submitted node from a newly pasted copy.
Initial attachment recovery reconstructs reference nodes at their original text offsets, including
when the editor mounts later. Keeping the recovered draft must not hide or discard its references.

## Reading and authorization

The native `read_session` tool supports scoped search, chronological cursor pages, message detail
continuation, and bounded neighboring messages. Its service permits the current regular session or
sources explicitly referenced by persisted user messages in the caller session. Text mentioning an
ID, source assistant text, and references nested in source content do not grant access. Existing
Tape finalized-direct-child authorization is unchanged.

Source identity is checked before reading. Deletion, reset, missing message, invalid cursor, and
unavailable tools are errors rather than empty successful histories. A cursor is bound to source
incarnation, query/role, and a fixed transcript high-water mark. Appends do not change the page set;
edits/deletions can change current evidence and do not resurrect old messages. Message IDs and Tape
entry IDs are not interchangeable.
The high-water includes its boundary message identity. Compaction that shifts that boundary, or
deletion/retry that removes it, rejects continuation with an instruction to restart without a cursor;
it never silently continues against reused or moved positions.

List/search/context read existing search-text projections with SQL-level text bounds. Details read
bounded slices of stored message JSON and identify their format and character-offset semantics.
Detail continuation requires the first chunk's revision token, bound to source incarnation and the
message's latest Tape entry. A replaced message requires restarting at offset zero, including
same-timestamp replacements; unrelated appended messages do not invalidate the continuation.
If the projected content disagrees with that Tape entry, detail reads fail instead of mixing versions.
Revision lookup uses the existing per-source index, not a backward scan of the session's messages.
Session consumes the narrow `TapeSessionReferenceReader` capability, never the physical Tape table.
Tape's SQLite adapter compares the latest message fact against transcript content and returns only
the matching revision ID. The bounded transcript slice and revision check share a read transaction;
full-content comparison stays inside SQLite and cannot observe a different snapshot from the slice.
Filtering occurs before pagination. Limits bound row count and output size; FTS is preferred for
search, with scoped literal fallback. No read path loads an entire source transcript into JavaScript.
Search text is a locator, not necessarily an assistant conclusion; detail preserves block types.
Returned source material is reference data, never an instruction or permission grant.

## Ownership and compatibility

Session owns the reader and its transcript queries. Composition supplies existing database and Tape
identity capabilities. Agent tools own the model schema/dispatch; the composer owns selection,
chips, and display. Existing Code Mode can compose this tool without a new execution runtime.
Existing messages and drafts without session items remain unchanged. No schema migration is needed;
removing the feature does not delete source history.

## Acceptance

- Workspace title matches include older sessions, while existing file mentions continue to work.
- `@` and cross-workspace drag produce the same removable, source-identifiable reference.
- While a selected reference resolves, send, queue, steer, and command submission wait. Editing
  the draft or changing its target cancels the insertion and releases the wait; stale completions
  cannot insert into a new draft or release another pending reference's submission gate.
- Concurrent drops survive other reference insertions because they use the live selection;
  pending mentions still cancel when their captured replacement range becomes stale.
- Draft reload and sent-message rendering preserve stable identity and open the source by ID.
- Model input contains references and accurate native reader guidance, not source history.
- Search, role filtering, cursors, detail continuation, and neighboring context compose correctly.
- Arbitrary or transitive IDs cannot widen access; deletion/reset cannot silently retarget reads.
- Long sessions and oversized messages use bounded database result materialization.
- No external dependency, additional history store, or replacement compaction policy is introduced.

## Review surface

Before: `@ → files`; sidebar sessions navigate/reorder only.
After: `@ → sessions | files`; sidebar session → receiving composer → `[Session · title ×]`.
Each implementation slice receives P0–P3 review, simplification/ablation, and targeted verification
before a local commit. No push is authorized.
