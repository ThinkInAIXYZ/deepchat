# Tape Contract Lineage Implementation Plan

## 1. Establish Canonical Contract Domains

- Add shared, bounded schemas for prompt-section provenance, TaskContract, TaskContract references,
  ExecutionContract, and Handoff format evaluation.
- Add main-process canonical builders and versioned hashes using the existing canonical JSON helper.
- Define stable tool target identity and typed ceiling comparison without importing runtime services
  into the domain layer.
- Add focused domain tests for canonical ordering, hash exclusion rules, bounds, typed meet, and
  evaluation invariants.

## 2. Make Prompt Assembly Constructive

- Introduce a structured prompt assembly result while retaining the existing string-returning helper
  as a compatibility wrapper for narrow callers and tests.
- Give each system-prompt contribution a stable kind, source reference, inclusion state, content
  hash, and bounded degradation list.
- Expose AGENTS.md cache provenance, including fresh, cached, deferred, missing, and read-error
  states, without copying AGENTS.md into the manifest.
- Record pinned-skill load omissions and tooling/environment construction failures as provenance.
- Thread the structured result through BasePromptAssembler, turn setup, compaction rebuild, and loop
  recovery without changing the provider-visible prompt text.

## 3. Build And Persist ExecutionContract At View

- Construct one immutable ExecutionContract after final provider messages, tools, model identity,
  token budget, runtime settings, and TaskContract context are known.
- Store the value on the request/run path; do not add a per-Session latest-contract cache.
- Upgrade contract-bearing DeepChat child ViewManifest writes to schema 5 and the next hash version
  while preserving v1-v4 readers and schema-v4 writes for ordinary interactive chat and ACP.
- Include full ExecutionContract content in `view/assembled`; reference the TaskContract by durable
  local/origin identity where present.
- Keep ordinary interactive writes fail-open and make contract-bearing DeepChat child View writes
  fail closed before provider request admission.

## 4. Enforce The Frozen View Ceiling

- Carry ExecutionContract identity through the exact logical round and tool batch that consumed the
  provider response.
- Persist a bounded View binding on paused permission actions, retain the exact value in the live
  batch projection, and recover it from a hash-verified v5 manifest only after runtime loss.
- Validate stable tool target, reviewed effect class, exact normalized View workdir binding, and
  nesting ceiling before crossing ToolService dispatch.
- Retain existing live permission, workdir identity, deletion, and Subagent-authority checks as the
  current runtime side of the meet; do not represent the workdir binding as argument-level path
  authorization.
- Reject stale, missing, or mismatched contract identity for contract-bearing child dispatch.
- Add tests for mid-run revocation, permission relaxation, tool-catalog expansion, workdir change,
  transient provider retry, and multiple logical rounds.

## 5. Add Strict Contract Tape Capabilities

- Reserve `contract/*` in the generic Tape writer.
- Add a contract writer/reader with canonical payload conflict checking and transaction-aware append.
- Expose complete Tape identity for contract references without making repositories query concrete
  Tape tables.
- Keep ExecutionJournalService's independent-transaction prohibition unchanged.
- Add architecture guards that permit contract persistence only through its application capability.

## 6. Persist TaskContract Runtime Projection

- Add a forward-only database migration for nullable TaskContract value/reference, inherited
  reference, and evaluation value/reference columns on `live_delegation_turns`.
- Extend shared orchestration schemas with nullable projections for historical compatibility.
- Build a TaskContract from the parent request, resolved slot, stable target, default or configured
  Handoff format, and optional predecessor evaluation.
- Coordinate parent contract append and initial/follow-up turn creation in one MainDatabase
  transaction.
- Keep a canonical runtime projection on the turn so restart and parent Tape reset do not erase the
  in-flight task semantics.
- Re-anchor the same hash-verified canonical projection into a new parent Tape incarnation before a
  strict operation and atomically update only its runtime reference.

## 7. Inherit TaskContract Into Child Tape

- Append the canonical value to the child Tape with complete origin identity before marking the
  Handoff deliverable.
- Persist the child-local reference on the turn projection and make repeated recovery idempotent.
- Re-inherit the same hash-verified projection after a child Tape reset before another provider
  request can start.
- Expose the active child TaskContract context to prompt/View assembly through a narrow read port.
- Reconcile legacy active turns by freezing an explicitly degraded compatibility contract before
  continuation.
- Fail closed on origin hash conflict, child-local content conflict, or missing contract projection.

## 8. Evaluate And Atomically Settle

- Parse the persisted complete child answer, not its bounded Handoff projection.
- Implement required-section evaluation with the existing fence-aware Markdown rules.
- Create `valid`, `invalid`, or `indeterminate` Handoff format evaluation with bounded evidence and
  reason codes; do not represent it as task success or parent acceptance.
- Replace terminal fallback paths that can commit without evaluation.
- Commit evaluation fact, evaluation projection, execution status, delegation projection, and
  mailbox event in one transaction.
- Preserve `executionStatus=completed`, `formatStatus=invalid`, and `delegationStatus=idle` for
  format-invalid but successfully generated results.

## 9. Surface Evaluation To The Parent

- Add evaluation summary/reference to turn inspection, wait event projection, and result pages.
- Keep evaluation metadata outside the untrusted child text in the child-result envelope.
- Include predecessor evaluation identity when a parent starts a follow-up turn.
- Do not add automatic repair, retry, override, or a new persisted parked status.

## 10. Documentation And Validation

- Update the maintained proactive multi-Agent specification and `tape-system.md` write-discipline,
  ViewManifest, lineage, and evaluation sections.
- Add migration tests from pre-contract schema versions and fresh-install schema tests.
- Run focused prompt, ViewManifest, Tape, dispatch, orchestration repository/service, and integration
  suites after their owning slices.
- Before each commit, review the staged diff for hidden side effects, compatibility, edge cases,
  performance, security, naming, test gaps, and maintenance cost; fix findings before committing.
- Before handoff, run format, i18n, lint, Node/web typecheck, and the relevant main-process suites.
