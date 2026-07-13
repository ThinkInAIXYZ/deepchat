# Subagent Run Guardrails - Plan

## Runtime Changes

- Extend the run schema with `runTimeoutMs`, default it at run creation, and publish the property in
  the tool definition.
- Store `runTimeoutMs`, `deadlineAt`, and optional `cancellationReason` on each run and include them
  in serialized progress/final payloads.
- Race task execution against a deadline promise. When the deadline fires, abort the run, mark and
  resolve unfinished tasks, request cancellation for created child sessions, and resolve the run
  lifecycle without waiting for stalled child setup or generation.
- Clear the deadline timer when execution finishes first. Late child creation observes the aborted
  controller and is cancelled before handoff.
- Reject a fourth nonterminal run for the same parent before creating tasks or child sessions.

## Handoff Contract

- Always include a markdown template requiring the five standard result sections and `None` for
  empty sections.
- Append caller `expectedOutput` as an additional-requirements block so existing customization is
  retained.

## Compatibility

- Keep all existing operations, task fields, progress/final payload keys, and tape finalization
  decisions.
- Continue treating `timeoutMs` solely as the polling timeout for `operation=wait`.
- Do not add GitHub issue synchronization for this architecture slice.

## Test Strategy

- Use fake timers to prove a background run is cancelled and becomes waitable at its deadline.
- Hold child cancellation pending to prove tape discard cannot race ahead of cancellation while the
  deadline remains observable as terminal.
- Verify three active runs are accepted, a fourth is rejected, and a terminal run frees capacity.
- Assert timeout/deadline/cancellation fields in serialized status data and tool definition schema.
- Assert handoffs contain all mandatory sections plus caller-provided additions.
