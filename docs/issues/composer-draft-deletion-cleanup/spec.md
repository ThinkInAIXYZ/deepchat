# Composer Draft Cleanup on Deletion

Status: open follow-up. Priority: P3.

Tracking: local issue record; no GitHub issue linked.

## Problem

Deleting an agent or session leaves its composer draft in localStorage. New-thread drafts use
`deepchat.composerDraft.v1.new-thread:<agentId>`; existing-session drafts use
`deepchat.composerDraft.v1.<sessionId>`. Orphaned entries retain unsent text and attachment metadata
and consume storage after their owner is gone.

## Reproduction

1. Create an agent, enter an unsent new-thread draft, and wait for the persistence debounce.
2. Delete the agent through settings.
3. Inspect localStorage: the agent's new-thread draft key remains.
4. Repeat with an unsent draft in an existing session, then delete that session.

## Ownership and Constraints

- `composerDraftPersistence.ts` owns storage keys and exports `clearComposerDraftFromStorage`,
  which has no production callers.
- `stores/ui/draft.ts` owns the in-memory new-thread draft cache;
  `useComposerSubmit.ts` owns existing-session draft caches.
- `stores/ui/session.ts` receives confirmed session deletions through `sessionIpc.ts`.
- Agent catalog updates also represent disabled ACP support, unavailable agents and refreshes;
  catalog absence alone must not authorize draft deletion.
- A mounted composer can persist again during debounce, pagehide, beforeunload or unmount.
  Accepted submissions can also write their originating draft after navigation. Removing the
  storage key alone does not prevent a stale writer from recreating it.

## Acceptance Criteria

- Confirmed permanent deletion removes the matching persisted draft and invalidates every live
  in-memory owner before pending callbacks can write it back.
- Agent deletion cleans its new-thread draft. Session deletion, including bulk agent-session
  deletion, cleans every deleted session's draft.
- Moving sessions to another agent preserves drafts belonging to those surviving sessions.
- Failed deletion, temporary agent disablement, catalog refresh failure and partial or paginated
  list responses preserve drafts.
- Deletion from another application window takes effect in windows holding the affected draft;
  later debounce, submission completion, unmount or reload cannot resurrect it.
- Existing orphan keys are removed only after authoritative owner-existence checks, with storage
  errors handled through the existing best-effort persistence boundary.

## Validation

Use focused lifecycle regressions for active and inactive draft deletion, late submission and
debounce callbacks, failed deletion, agent disablement, and surviving moved sessions. Add an
isolated Electron check for deletion across windows followed by reload, verifying that unrelated
drafts remain intact.
