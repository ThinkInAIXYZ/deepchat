# Memory Configuration ABA Execution Fence — Implementation Plan

Status: Implemented

Artifacts: [Specification](./spec.md) · [Task record](./tasks.md)

## Design Decisions

### One Execution Epoch per Agent

Retain a single per-Agent generation and broaden its meaning to an execution epoch. Destructive
invalidation and effective execution-configuration changes advance the same generation. Read epochs
remain independent because they protect a different boundary: invalidation after committed memory
mutations.

The effective execution identity contains only:

- the resolved `memoryEnabled` value;
- the resolved embedding provider and model identity.

Extraction, consolidation, assistant, preset, and persona model changes retain their existing
in-flight completion semantics.

### Centralized Identity Synchronization

Operation-fence capture in `MemoryRuntimeContext` is an O(1) state read. Presenter admission and
configuration notifications resolve the effective Agent config once and synchronize both runtime
execution identity and vector-store embedding identity together. Shared identity helpers normalize
embedding extraction and fingerprint encoding so the two stores cannot drift. In-memory execution
identity uses a collision-free provider/model tuple; the existing colon-delimited SQLite
`embedding_model` value remains unchanged for storage compatibility.

The first observation seeds the fingerprint without advancing the epoch. Each later effective
identity transition advances it exactly once and aborts Agent-scoped provider requests.

### Builtin Inheritance Propagation

Custom Agent notifications synchronize only that Agent. A builtin notification first synchronizes
the builtin Agent; if its execution identity did not change, managed-Agent fan-out is skipped.

When fan-out is required, all resolved DeepChat Agent configs are loaded in one repository read,
including disabled Agents. Each candidate is synchronized independently so one malformed or failing
Agent cannot suppress the remaining invalidations. Enumeration failure falls back to observed
execution states, and maintenance scheduling runs regardless of synchronization failure.

### Queue Admission Boundary

`MemoryRuntimePort` carries a typed `{ agentId, generation }` execution token. Extraction work binds
the current session Agent identity, session epoch, and token when it enters the queue. Both ordinary
tasks and continuations retain that admission epoch, while continuations also retain the original
execution token.

Cursor and Tape-anchor writes occur in the same synchronous JavaScript segment as the immediately
preceding validation, so no redundant same-tick fence checks are required. A stale task performs no
commit and schedules no continuation; a later normal admission scans again from the retained cursor.

Session Agent reassignment temporarily blocks new ingestion for the session, advances its session
epoch, and drains the existing extraction chain before publishing the new Agent identity. Admission
resumes in a `finally` path after the transfer attempt, so old-Agent persistence cannot complete
under a newly published identity.

### Retrieval and Injection Boundary

Recall, search, and injection retain the admission fence across every asynchronous boundary. Stale
results cannot be returned, recorded as access, appended to the prompt, or written as Tape anchors.

Cancellation handling distinguishes control-flow cancellation from real failures:

- provider cancellation, deadline, and capacity use distinct internal error codes;
- tagged Memory provider cancellation is discarded only when the execution fence is stale;
- a vector lease explicitly stopped during presenter disposal is treated as lifecycle cancellation;
- deadlines, capacity rejection, ordinary `AbortError`, storage failures, and quarantined vector
  stores preserve their existing propagation or degradation behavior.

## Affected Components

- `MemoryRuntimeContext`: execution state, fingerprint observation, fence capture and validation.
- `MemoryPresenter`: admission synchronization, custom/builtin config notifications, maintenance
  isolation, and runtime-port implementation.
- `DeepChatAgentRepository` and `AgentRepository`: batch resolved-config enumeration.
- `MemoryRuntimeCoordinator`: queue admission token, Agent identity, continuation, and commit guards.
- Retrieval, provider gateway, and vector-store services: read fences, cancellation classification,
  and shared embedding identity.
- Memory architecture guard, architecture contract, and focused regression suites.

## Implementation Sequence

1. Add the canonical execution token and embedding/execution identity helpers.
2. Generalize `MemoryRuntimeContext` generation state and keep fence capture allocation-free apart
   from first Agent observation.
3. Synchronize runtime and vector identities through one Presenter admission path.
4. Add batch resolved-Agent enumeration and exception-isolated builtin propagation.
5. Bind Coordinator queue items and continuations to the captured Agent/token pair.
6. Extend the same fence through retrieval and injection await boundaries.
7. Remove same-tick checks and duplicate identity/token declarations made obsolete by the unified
   boundary.
8. Add ABA, inheritance, queue, lifecycle, error-propagation, and test-isolation regressions.
9. Update the maintained Agent Memory architecture contract and complete repository validation.

## Interfaces and Compatibility

- Extend only main-process `MemoryRuntimePort`, `MemoryAgentPolicyPort`, and the internal Agent
  repository facade.
- Keep configuration notifications as `(agentId: string)`; no pre/post diff is added to
  `ConfigPresenter`.
- Do not change renderer APIs, IPC contracts, database schemas, persistence formats, or public
  protocols.
- Do not add migration or rollback steps because no persisted representation changes.

## Test Strategy

### Runtime Context

- Verify first observation and repeated identical observation do not advance the epoch.
- Verify enabled and embedding A-to-B-to-A transitions each advance exactly once, invalidate every
  older fence, and abort provider work once per transition.
- Verify Agent cleanup preserves the advanced generation.

### Configuration Propagation

- Verify inheriting custom Agents observe builtin enabled/embedding changes.
- Verify explicit overrides whose effective identity is unchanged are not invalidated.
- Verify disabled Agents remain in the full managed enumeration.
- Verify enumeration and individual Agent failures do not suppress later invalidations or
  maintenance scheduling.
- Verify non-execution builtin changes avoid managed-Agent scans.

### Runtime Work and Reads

- Use deferred extraction and retrieval responses to reproduce enabled ABA.
- Verify queued stale work, stale continuations, and changed session Agent identity do not execute or
  commit.
- Verify ordinary queue work retains its admission epoch and Agent reassignment drains old-Agent
  persistence before identity publication.
- Verify fresh post-transition admissions execute normally.
- Verify stale recall/search/injection results produce no response, access accounting, prompt
  content, or Tape side effect.
- Verify real retrieval failures still propagate while tagged stale cancellation and disposal are
  safely discarded.
- Verify separator-containing execution identities do not collide while persisted fingerprints stay
  compatible, and provider capacity rejection is not suppressed as stale cancellation.

### Repository Validation

- Run focused Memory/runtime Vitest suites first.
- Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck`.
- Run the full `pnpm test` suite and record unrelated baseline failures explicitly.
