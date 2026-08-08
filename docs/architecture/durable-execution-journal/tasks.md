# Durable Execution Journal Tasks

## 1. Architecture Contract

- [x] Record the DeepChat failure model, authority boundary, commit contract, and non-goals.
- [x] Define v1 fact names, structured identities, failure semantics, and compatibility constraints.
- [x] Define implementation order, recovery policy, test strategy, and commit review requirements.
- [x] Review the SDD before source implementation.
- [x] Commit the reviewed SDD before source implementation.

## 2. Journal Domain And Persistence

- [x] Add protocol constants, fact types, identity validation, parsers, errors, and classifier.
- [x] Add collision-safe provenance derivation and canonical payload hashing.
- [x] Add strict same-payload idempotency and conflicting-payload corruption detection.
- [x] Add the journal event query and supporting SQLite index.
- [x] Expose narrow writer and recovery-reader capabilities through `SessionTape`.
- [x] Add pure and native SQLite tests.
- [x] Review and commit the persistence slice.

## 3. Normal Run Lifecycle

- [x] Replace process-local loop Run IDs with UUIDs.
- [x] Commit `run_started` before Run registration.
- [x] Pass structured operation identity into each tool execution.
- [x] Commit T2 before staged result projection for known success and failure outcomes.
- [x] Commit all terminal outcomes before transcript, status, hooks, and UI projection.
- [x] Prevent a post-terminal projection failure from attempting a conflicting terminal fact or
  error projection.
- [x] Add loop ordering and failure tests for Run start and terminal boundaries.
- [x] Review and commit the lifecycle slice.

## 4. Resolved Tool Boundaries

- [x] Add the per-call dispatch commit callback without introducing a Tape dependency in tools.
- [x] Commit MCP T1 after final policy, binding, target, argument, and abort checks.
- [x] Commit Agent T1 at each persistent or external side-effect boundary.
- [x] Ensure local refusal and permission paths produce no T1.
- [x] Ensure duplicate claims and journal failures prevent physical invocation.
- [x] Add MCP and representative Agent boundary tests.
- [x] Review and commit the tool-boundary slice.

## 5. Deferred Execution And Recovery

- [x] Give deferred approval execution a fresh UUID Run and request sequence `1`.
- [x] Apply run start, T1, T2, and terminal ordering to deferred execution.
- [x] Classify native v1 journal facts before pending transcript recovery at startup.
- [x] Keep `indeterminate` and `corruption` parked with no automatic tool retry.
- [x] Add failpoints and restart/crash tests around T1, T2, and terminal boundaries.
- [x] Reject a paused terminal projection while any non-interaction block remains unresolved.
- [x] Update maintained architecture documentation for the final implemented contract.
- [x] Review and commit the recovery slice.

## 6. Final Validation

- [x] Run formatting and i18n checks.
- [x] Run lint and typecheck.
- [x] Run relevant unit, integration, native SQLite, and platform-supported crash tests.
- [x] Perform a final severity-ordered review of the complete branch diff.
- [x] Fix findings and rerun affected validation.
- [x] Confirm no remote Git operation was performed.

## 7. Review Hardening

- [x] Settle claimed inputs and transient runtime state after Journal lifecycle failures without
  fabricating an uncommitted terminal projection.
- [x] Reject one pre-dispatch invalid model call without terminating its sibling batch.
- [x] Move cron, process, memory, and delegation T1 callbacks after every refusal/no-op check and
  outside rollback-capable host transactions.
- [x] Unify strict canonical hashing/equality and reject duplicate T2 projection.
- [x] Reserve `execution/*` for the strict writer and exclude it from fork merge.
- [x] Normalize inherited unresolved blocks and correct deferred pre-dispatch terminal semantics.
- [x] Add focused regression tests and rerun the full required validation.
- [x] Review unstaged and staged diffs, fix findings, commit, and do not push.
- [x] Consume visible steer claims when their follow-up Run cannot commit `run_started`.
- [x] Preserve completed process-session ownership through explicit or host cleanup.
- [x] Keep T2 authoritative across skill activation failures and causal cancellation races.
- [x] Remove native Journal append from the generic Context Tape storage capability.
- [x] Retain deferred parking across runtime cleanup after projection failure.
- [x] Document complete recovery scanning and defer durable acknowledgement/retention.

## 8. Connection And Projection Consistency

- [x] Resolve the strict Journal store lazily across application database reopen.
- [x] Reconcile completed process ownership with utility-host TTL cleanup.
- [x] Append atomic Tape replacements for compaction-driven transcript order shifts.
- [x] Preserve both Run and terminal-commit failures without erasing Journal corruption identity.
- [x] Add focused connection-reopen, TTL-race, and effective-order regression tests.
- [x] Run required validation, review unstaged and staged diffs, commit, and do not push.
- [x] Preserve compaction-indicator semantics when order correction shifts a placeholder.
- [x] Cite the owning reconstruction anchor from synthetic summary checkpoint manifests.

## 9. Follow-up Hardening

- [x] Replace reason/correction inference with an explicit record-vs-order replacement contract.
- [x] Materialize only shifted messages in batches of at most 500 inside the compaction transaction.
- [x] Stop order-only live replacements from rewriting tool facts.
- [x] Derive effective tool order from the effective message with a legacy payload fallback.
- [x] Skip backfill tool facts only when their non-order content matches the current effective
  revision.
- [x] Cover repeated shift, shift-then-backfill, recall ordering, legacy fallback, and content
  revision behavior with focused regressions.
- [ ] Preserve any future non-corruption Journal failure subtype through terminal error wrapping.
- [ ] Align linked SQL Tape search for tool facts with the effective message-derived `orderSeq`
  search corpus.
- [ ] Replace the low-frequency full-session Tape read used by production assistant `record`
  revisions with a targeted tool revision index.
- [ ] If profiling shows revision-index hashing is material, select winning terminal entries before
  computing SHA-256 fingerprints.
- [ ] When next revising the spec, clarify that production effective reads filter orphan tool facts
  before the legacy payload-order fallback can apply.

## 10. Review Scope And Startup Cost

- [x] Re-specify synchronous startup around unterminated Runs instead of complete Journal history.
- [x] Add an indexed store query that returns facts only for Runs without `run_terminal`.
- [x] Remove response text and temporary offload paths from durable outcome facts.
- [x] Require the dispatch commit capability in the harness-internal execution port type.
- [x] Add focused query, payload-minimization, and port-contract coverage.
- [x] Run required validation, review unstaged and staged diffs, commit, and push normally.
