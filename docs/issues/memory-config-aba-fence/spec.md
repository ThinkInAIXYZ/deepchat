# Memory Configuration ABA Execution Fence

Status: Implemented

Artifacts: [Implementation plan](./plan.md) · [Task record](./tasks.md)

## Problem

Memory operations captured a per-Agent generation, but memory configuration updates advanced that
generation only when the vector-store embedding identity changed. `canContinueOperation()` checked
only that the captured generation still matched and that memory was currently enabled. An operation
admitted before `memoryEnabled: true -> false -> true` could therefore become valid again and commit
after the second transition.

The same boundary was missing above the presenter layer:

- A `MemoryRuntimeCoordinator` extraction waiting in a per-session queue captured the current
  generation only when it started, so work admitted before a configuration transition could run
  under the new generation.
- Continuation tasks did not retain the generation of the original admission.
- Injection, recall, and search used current-state enablement checks around asynchronous work, which
  could not distinguish the original enabled period from a later one.
- A builtin DeepChat configuration change could alter the effective configuration of inheriting
  custom Agents without invalidating their in-flight work.

## Impact

- A stale extraction response could write memory rows and publish memory events after an enabled
  ABA transition.
- Queued extraction could advance the ingestion cursor or write a Tape anchor under an execution
  configuration different from the one at admission.
- Stale injection or retrieval results could enter the prompt, access accounting, a Tape anchor, or
  a caller-visible response.
- Invalidating only the builtin Agent left inheriting custom Agents exposed, while indiscriminate
  fan-out would unnecessarily invalidate Agents with explicit overrides.

## Root Cause

The existing operation generation represented destructive invalidation but not effective execution
configuration. Runtime configuration observation and vector-store embedding identity were tracked
separately. Builtin update handling synchronized only the builtin Agent, while the existing
maintenance enumeration excluded Agents disabled by the new configuration. Coordinator admission
stored a session epoch but not the resolved Agent identity or its memory execution generation.

## Goals

- Use one per-Agent execution epoch for both destructive invalidation and effective memory execution
  configuration changes.
- Define execution configuration identity as the resolved `memoryEnabled` value plus the resolved
  `memoryEmbedding` identity.
- Permanently invalidate old work across every A-to-B-to-A execution configuration transition.
- Bind extraction queue work to the Agent identity and execution epoch captured at admission.
- Prevent stale injection, recall, and search results from escaping after asynchronous boundaries.
- Propagate builtin execution-identity changes to every affected inheriting DeepChat Agent without
  invalidating Agents whose effective configuration did not change.

## Requirements

### Execution State

- `MemoryRuntimeContext` owns one execution state per Agent containing the current generation and an
  optional effective configuration fingerprint.
- The first effective-configuration observation seeds the fingerprint without advancing the
  generation.
- Every later `memoryEnabled` or embedding identity transition advances the generation exactly once
  and aborts the Agent's provider requests.
- Destructive invalidation uses the same generation. Read epochs remain independent.
- Agent cleanup clears the observed configuration fingerprint but retains the advanced generation,
  so a previously captured fence cannot become valid after state recreation.

### Configuration Propagation

- Custom Agent updates synchronize only that Agent's resolved execution configuration and vector
  embedding identity.
- Builtin updates examine the union of the builtin Agent, all observed execution states, and all
  managed DeepChat Agents, including currently disabled Agents.
- Each candidate is evaluated from its resolved inherited configuration. Only a real effective
  identity change invalidates its execution generation.
- Maintenance scheduling remains separate from execution invalidation.
- Extraction model, consolidation model, assistant model, default model preset, and persona policy
  changes do not invalidate already-admitted execution.

### Runtime Admission and Reads

- `MemoryRuntimePort` exposes a typed `{ agentId, generation }` execution token capture/validation
  contract.
- Extraction queue admission binds the current session Agent identity, session epoch, and execution
  token.
- A task validates its token before starting and after each asynchronous extraction response. The
  cursor and Tape-anchor commits follow in the same synchronous JavaScript segment.
- Ordinary tasks and continuations retain the session epoch captured at admission. Continuations
  also retain the original execution token.
- A session Agent identity change makes queued work stale.
- Before publishing a new session Agent identity, admission for that session is paused, its session
  epoch is advanced, and the old extraction chain is drained. No old-Agent persistence can cross
  the identity publication boundary.
- Stale work does not advance the cursor, write an anchor, or enqueue another continuation.
- Injection, recall, and search validate the same execution boundary across their awaits and before
  returning results or recording access.
- Execution identities use collision-free tuple encoding even when provider or model identifiers
  contain separators. Existing persisted embedding fingerprints retain their legacy encoding.
- Provider cancellation, deadline, and capacity failures use distinct internal classifications;
  only true lifecycle/configuration cancellation is eligible for stale-fence suppression.

## Non-Goals

- Do not add a second configuration epoch.
- Do not change extraction, consolidation, or persona model semantics for already-admitted work.
- Do not permanently exclude conversation produced while memory is disabled. Stale extraction
  leaves the cursor unchanged so a later normal admission can scan from the retained cursor.
- Do not alter current-state maintenance timers, prewarm behavior, or embedding-drain scheduling.
- Do not change renderer APIs, IPC contracts, database schemas, persistence formats, or public
  protocols.
- Do not create or synchronize a GitHub issue.

## Acceptance Criteria

- Enabled and embedding A-to-B-to-A transitions advance the execution generation on every effective
  transition; every older fence remains invalid.
- The first observation and repeated observation of the same effective configuration do not advance
  the generation.
- Model- or persona-only configuration changes do not advance the execution generation.
- A deferred extraction admitted before enabled ABA resolves with `ok: false` and produces no row or
  event.
- Queued stale extraction and stale continuations do not run or commit; a fresh post-transition
  admission runs normally.
- A session Agent change drops work admitted for the previous Agent.
- A session Agent reassignment waits for old-Agent persistence before publishing the new identity.
- An inheriting custom Agent is invalidated by relevant builtin changes, while an Agent with an
  effective explicit override is not.
- Stale recall and search return no results or access accounting, and stale injection cannot enter
  the prompt or Tape.
- Separator-containing embedding identities do not collide, and stale capacity/deadline failures
  remain observable rather than being classified as cancellation.
- Focused regressions, formatting, i18n checks, lint and architecture guards, and node/web typechecks
  pass. Any unrelated full-suite failure is recorded in `tasks.md`.
