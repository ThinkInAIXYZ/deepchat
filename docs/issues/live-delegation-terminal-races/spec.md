# Live Delegation Terminal Race Hardening

Status: implemented and validated.

GitHub issue: not requested or created; this is a local SDD record.

## Issue

Live delegation has three terminal-lifecycle gaps around child acquisition, mailbox waiting, and
successful completion:

1. `interrupt()` or service shutdown can settle a turn while an existing child lookup,
   `createSubagentSession()`, or initial child handoff is still in flight. The eventual child can
   then remain unbound or accept work after its parent turn is terminal, leaving a hidden live
   Subagent Session outside the terminal delegation's observable lifecycle.
2. `wait()` reads the durable mailbox before registering its in-memory waiter. A terminal event
   committed in that interval is durable but cannot wake that call, so the caller waits until its
   timeout before reading the event.
3. An idle child with no non-empty final assistant answer can settle as `completed`, even though the
   retained architecture defines the completed child assistant message as the canonical result.

The model-facing contract also needs to make two intentional V1 boundaries unambiguous: the current
`explicit | proactive` policy remains authoritative even though both executor tools are visible, and
`wait` consumes terminal mailbox events while `inspect` or `list` owns permission/question state.

## Impact

- A child created during cancellation can continue generating without an active delegation owner.
- A parent can pay the full wait timeout even though the requested result is already durable.
- Parents and UI can observe a successful child turn that has no usable result or result reference.
- Ambiguous guidance can encourage proactive delegation under `explicit`, premature interruption,
  or waiting for an interaction state that the completion mailbox does not publish.

## Root Cause

- The active turn records only a resolved `childSessionId`; it does not expose or drain pending
  child-acquisition and handoff promises. Terminal settlement can therefore finish before lookup,
  creation, binding, or accepted-handoff cleanup runs.
- The first mailbox read and waiter registration are not closed by a second durable read.
- `settle()` derives the handoff opportunistically but does not make a non-empty answer an invariant
  of `status=completed`.
- Shared Subagent guidance discusses proactive value but does not explicitly subordinate tool
  availability to the session policy or require every spawned child to reach an accounted terminal
  state.

## Fix Plan

1. Track child acquisition and initial handoff promises on the active turn, covering lookup,
   creation, durable binding, handoff acceptance, and post-handoff cancellation. Make both
   `interrupt()` and `stop()` drain that work before terminal settlement and returning.
2. Re-read the durable mailbox immediately after waiter registration. This closes the TOCTOU window
   without adding another state source or changing cursor semantics.
3. Convert a nominally completed turn with no non-empty final answer into `failed` with an actionable
   error. Preserve interrupted/cancelled semantics and link any started child Tape with the effective
   failed outcome.
4. State that orchestration policy is authoritative, account for every spawned child, constrain
   model-initiated interruption, and document that permission/question waits require `inspect` or
   `list` rather than terminal `wait`.

## Compatibility And Non-goals

- Do not hide executor tools under `explicit`; that would also remove the supported explicit user,
  Skill, and project-instruction path.
- Do not add transient waiting states to the durable mailbox by overloading the existing `message`
  event. A typed waiting-event protocol would require a deliberate schema migration and cursor
  contract beyond this reliability fix.
- Preserve completed child Sessions and their Tape. Only the acquisition/cancellation window gains
  binding and cancellation cleanup.
- Do not change Workflow runtime state, existing result references, or mailbox event identities.

## Acceptance Criteria

1. Interrupting or stopping while child lookup, creation, or handoff is unresolved cannot leave an
   unbound child or let accepted work escape terminal cancellation; the eventual child is durably
   bound and visible through the delegation.
2. An event committed between the initial mailbox read and waiter registration resolves `wait()`
   without waiting for the timeout.
3. `completed` always has a non-empty canonical child answer and bounded handoff; an empty terminal
   answer produces `failed` and an explanatory error.
4. Explicit/proactive policy precedence, terminal-only wait semantics, and interruption obligations
   are present in the model-facing contract and covered by focused tests.
5. Existing cancellation, recovery, handoff, effect evidence, and result paging behavior remains
   compatible.

## Task Checklist

- [x] Validate every reported finding against production code and retained architecture.
- [x] Drain child acquisition and handoff across interrupt and service stop.
- [x] Close the mailbox waiter registration race.
- [x] Enforce the completed-answer invariant.
- [x] Clarify policy, wait, and interruption guidance.
- [x] Add focused lifecycle and prompt/tool contract regressions.
- [x] Run formatting, i18n, lint, type checking, relevant tests, and pre-commit review.

## Validation

- `pnpm run format`: passed.
- `pnpm run i18n`: passed for all 20 locales.
- `pnpm run lint`: passed with zero cleanup-guard violations.
- `pnpm run typecheck`: passed for main and renderer projects.
- Native SQLite-backed orchestration and prompt/tool contract suites: 8 files and 63 tests passed
  under Electron's Node ABI.
- `pnpm run test:main`: 501 files and 5,883 tests passed; two pre-existing dispatcher fixture
  failures remain because mocked Session DTOs omit the required `orchestrationPolicy`. This change
  does not touch the dispatcher or those fixtures.
