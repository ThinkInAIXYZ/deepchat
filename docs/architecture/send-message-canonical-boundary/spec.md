# Send Message Canonical Boundary

## Status

Implemented and validated.

## Problem

The typed chat routes accept the compatibility input `string | SendMessageInput`, and session
creation has a separate legacy shape. Before this contract was introduced, the same live turn was
normalized again inside the runtime presenter, turn coordinator, context construction, and ACP
compatibility projection after the session application layer had already converted it.

Those repeated conversions make each downstream module distrust its caller. They also hide the
actual ownership boundary: route and session-creation compatibility belongs to the session
application layer, while runtime ports should operate on one canonical object shape.

Pending queue and update ports now use the same canonical object below the application boundary.
The store serializes that object directly; persisted payloads are decoded with
`SendMessageInputSchema`. Invalid JSON or shape is reported as corrupt storage and degrades to the
raw payload as user text so one damaged record cannot block the pending queue.

## Goal

Make the session application turn coordinator the canonical boundary for live send, live steer,
and the initial session turn. After that boundary, runtime handles, backend ports, turn execution,
context construction, and ACP prompt resources consume `SendMessageInput` directly without
normalizing it again.

## Canonical Data Flow

```text
chat route string | SendMessageInput
  -> SessionTurnCoordinator.normalizeSendMessageInput()
  -> AgentSessionSendInput.content: SendMessageInput
  -> backend/runtime/turn/context: SendMessageInput

session create input
  -> SessionLifecycleCoordinator.normalizeCreateSessionInput()
  -> SessionInitialTurnInput.content: SendMessageInput
  -> AgentSessionSendInput.content: SendMessageInput
  -> backend/runtime/turn/context: SendMessageInput
```

## Acceptance Criteria

1. Chat route names, input schemas, output schemas, renderer behavior, and string compatibility are
   unchanged.
2. `SessionTurnCoordinator` converts live send and live steer input exactly once before resolving a
   runtime session.
3. `SessionLifecycleCoordinator` remains the sole converter for the initial create-session input;
   `SessionTurnCoordinator.startInitialTurn` does not normalize the result again.
4. `AgentSessionSendInput.content` and the live steer facets use `SendMessageInput`, not
   `string | SendMessageInput`.
5. Pending queue and update facets below the application boundary also use `SendMessageInput`.
6. Pending storage accepts only canonical objects. Invalid persisted JSON or shape is logged and
   degrades to raw user text so queue processing remains continuous.
7. DeepChat turn execution and ACP prompt resource resolution receive `SendMessageInput` directly.
8. Context construction does not normalize the current live user input. Persisted history decoding
   remains separate and unchanged.
9. The main-process live send, live steer, and initial-turn tests prove that text, files, active
   skills, and inline items arrive at the runtime in canonical form.
10. No new manager, service, framework, dependency, renderer code, database schema, or migration is
   introduced.

## Constraints

- Preserve the current normalization semantics at the application boundary: string input becomes
  `{ text, files: [] }`; active skills are trimmed and deduplicated; falsey file entries are removed;
  empty optional arrays are omitted.
- Keep persisted pending payload decoding at the storage boundary.
- Keep persisted user-message decoding tolerant in this iteration. It is a storage boundary, not a
  live-turn contract.
- Keep direct calls to the legacy `AgentRuntimePresenter.processMessage` test and compatibility
  facade working while ensuring canonical production calls are not re-normalized.

## Non-Goals

- Changing queue ordering, recovery, limits, or scheduling behavior.
- Changing permission mode, provider stop reason, cancellation, generation settings, or error
  behavior.
- Changing the public route compatibility union.
- Introducing a branded or second canonical message-input type.
- Cleaning unrelated normalizers in message history, compaction records, migrations, or renderer
  code.

## Decisions

- Reuse the existing `SendMessageInput` type. A second type would add conversion code without adding
  a trust boundary.
- Reuse `normalizeSendMessageInput` only at the session application boundary. Downstream code may
  validate business rules such as non-empty content, but it must not reshape the object.
- Retain a string-only compatibility conversion at the public `AgentRuntimePresenter` facade because
  it is called directly by existing main-process integrations. Object inputs pass through unchanged;
  internal runtime ports remain canonical.
- Narrow pending queue and update operations after the companion persistence-decoder work proved the
  supported stored format and removed write-side coercion.
- Decode persisted pending payloads with `SendMessageInputSchema`; on failure, report the integrity
  error and preserve the raw payload as user text because conversation continuity takes precedence
  over reconstructing optional structure.
- GitHub issue synchronization is not part of this work.

## Open Questions

None.
