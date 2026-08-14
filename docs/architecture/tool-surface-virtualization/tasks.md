# Tool Surface Virtualization Tasks

## Architecture SDD

- [x] Decide to virtualize exposure while preserving native target identity.
- [x] Define Run ceiling, per-View eligibility, Active Surface, candidate, and retry semantics.
- [x] Define ToolSearch, budget, Skill activation, anti-oracle, definition drift, and ACP boundaries.
- [x] Define View facts, strict/fail-open persistence, recovery, and compatibility rules.
- [x] Define prompt-cache measurement and default-enable Go/No-Go gates.
- [x] Review and commit the SDD slice.
- [x] Approve dual disjoint surfaces, three frozen adapters, Agent CLI protocol, nested Journal v2,
      Batch v1, Tape provenance, failure matrix, cache evaluation, and security boundaries.
- [x] Preserve V1 compatibility and resolve all architecture clarifications.

## P0-A: Canonical Domain And Shadow Measurement

- [x] Add canonical bounded Tool Surface domain types and deterministic hash recipes.
- [x] Build the Run owned definition universe across Agent, MCP, Plugin, and valid enabled Skills.
- [x] Resolve Skill requirements through execution source mapping and cover absent, ambiguous,
      unresolved, disabled, reserved, and Plugin-unavailable cases.
- [x] Add provider ordering and candidate merge utilities with focused tests.
- [x] Bound canonicalization bytes/depth and prohibit hash caching without proven immutable revision.
- [x] Compute Run-level shadow decisions without changing provider payloads or Tape.
- [x] Add bounded content-free diagnostics for tokens, triggers, overlap, and available cache fields.
- [x] Add a main-process-only aggregate diagnostics read path without public IPC exposure.
- [x] Review and commit the P0-A slice.

## P0-B: Native Activation (Retained HEAD Work)

- [x] Freeze the Run Tool Ceiling and virtualization mode.
- [x] Build one immutable ToolSurfaceSnapshot per requestSeq and reuse it for physical retries.
- [x] Preserve active order, append accepted candidates, and shrink on current revocation.
- [x] Keep V4 without ExecutionContract and bind V5 ceilings to active tools only.
- [x] Reserve/register native `tool_search` and search only its originating frozen catalog.
- [x] Return bounded metadata without schema or internal identifiers.
- [x] Release after durable outcome; ordinal-merge and deduplicate after complete batch settlement.
- [x] Discard pre-admission candidates across restart and activate only in the next View.
- [x] Enforce reserve, batch, Run, provider, and V5 budgets without eviction/full fallback.
- [x] Return bounded Skill activation failure and stage serialized no-I/O resource bundles.
- [x] Reject guessed inactive calls before target resolution and compare canonical definition hash
      before target T1.
- [x] Add bounded hash-valid catalog/provider surface facts and exclude them from View/Memory/search.
- [x] Atomically write strict V5 facts, keep honest V4 fail-open diagnostics, and recover strict
      deferred dispatch only from unique exact evidence.
- [x] Cover small/full, large/virtualized, retry, recovery, revocation, Skill, crash, and ACP cases.
- [x] Review and commit each Native Activation slice; do not push.

## Dual Surface

- [x] Freeze the Run Tool Ceiling and one adapter mode per Run.
- [x] Build one immutable snapshot per `requestSeq` and reuse it for physical retries.
- [x] Assemble mutually exclusive Provider Active and Programmatic surfaces with all exclusions.
- [x] Add `ProgrammaticToolCapabilityV1` with exact identity, hashes, projection, ceilings, quotas,
      and versions.
- [x] Keep the complete live Programmatic target/hash set within hard bounds; allow truncation only
      in the durable projection, and use the frozen Run ceiling to reject oversized sets before
      adapter admission so a later View cannot overflow.
- [x] Keep V5 ExecutionContract ceilings provider-visible only and ACP excluded.
- [x] Cover revocation, definition drift, recovery, and no-within-Run-adapter-switch behavior.
- [x] Perform a severity review before commit; do not push.

## CLI Programmatic and Three Adapters

- [x] Wire an explicit, default-off Native Activation assignment through Run setup and View
      assembly without inferring model capability.
- [x] Implement Direct Native, CLI Programmatic, and Native Activation route selection.
- [x] Add bounded process-live cross-Run adapter stickiness and enter/exit hysteresis hints.
- [x] Connect a default-off stable canary owner only to exact versioned model CLI capability
      evidence, without inferring from provider model metadata.
- [x] Add Agent-only `deepchat tool search|describe|call|batch` routes.
- [x] Add version-negotiated `CLI_SURFACE_V3` as a strict V2 superset and prove V2 cannot reach the
      new routes.
- [x] Mint exact outer-operation invocation tokens only for CLI Programmatic Runs.
- [x] Construct the per-View capability without `providerToolCallId`, then derive an exact
      provider-operation grant after the outer exec call exists.
- [x] Add bounded owned stdin for call/batch bodies and reject background/detached/yielded
      Programmatic commands before outer T1.
- [x] Keep prepared tokens inert until a new outer T1 receipt arms the grant; revoke on failure and
      prevent process spawn.
- [x] Bind route plus canonical stdin/scalar arguments, atomically consume once, and reject changed
      body/route, replay, expiry/revocation, and wrong principal/conversation.
- [x] Keep search/describe read-only with no authorization, activation, seen ledger, or target Journal
      fact.
- [x] Return only bounded invocation names, reviewed metadata, signatures/schemas, and copyable
      examples without internal stable IDs, server UUIDs, hashes, MCP metadata, or secrets.
- [x] Enforce direct call without search and one bounded anti-oracle unavailable shape.
- [x] Add fixed Skill-to-CLI adapter guidance without dynamic prefix churn.
- [x] Perform a severity review before commit; do not push.

## Journal v2

- [x] Add discriminated provider/nested operation identities with v1/v2 coexistence.
- [x] Persist only canonical hashes, status, and bounded provenance; reject conflicting payloads.
- [x] Add the process-live parent registry and route the loop and deferred Run terminal writers
      through its no-Tape-read causality fence.
- [x] Add process-live parent controller and settlement receipts across the CLI boundary.
- [x] Bind receipts to canonical outer-result hashes instead of trusting stdout for settlement.
- [x] Before opening any Agent tool route, make the process-live controller the sole production
      Programmatic outer-T2 path and call its terminal fence from the real Run terminal path without
      reading Tape.
- [x] Enforce parent/child T1/T2/terminal causality, including rejection of outer T2 and
      `run_terminal` while any Programmatic T1 is unmatched, and Run-fatal Journal failures.
- [x] Implement independent per-child preflight and default per-child approval.
- [x] Cover cancellation, crash, parking, explicit retry, and missing outer T2 failure states.
- [x] Perform a severity review before commit; do not push.

## Batch v1

- [x] Implement bounded fixed-count sequential fail-fast Batch v1 with controller-assigned contiguous
      plan-index ordinals and one-child `call`.
- [x] Support only bounded RFC 6901 bindings from existing argument destinations to prior immutable
      results; reject duplicate/overlapping destinations, interpolation, dynamic expansion,
      parallel/DAG, retry, recursion, sandboxing, and restart recovery.
- [x] Reapply per-child and aggregate byte/depth/entry/retention quotas after materialization.
- [x] Cover malformed/missing/type-mismatched references, amplification, and fail-fast
      `not_started` behavior.
- [x] Cover the complete cancellation/crash/parking/explicit-retry failure matrix.
- [x] Perform a severity review before commit; do not push.

## Tape, Context, and Canary

- [x] Add bounded `view/programmatic_tool_surface` with strict canonical conflict checking.
- [x] Bind strict V5 facts before provider admission; retain honest V4 fail-open provenance.
- [x] Keep normal dispatch free of Tape reads.
- [x] Aggregate bounded process-live automatic-assignment and actual-adapter cohorts for setup
      failures, schema churn, complete provider attempt/cache inputs, rounds, TTFT/end-to-end
      latency, outcomes, and metric availability without reading Tape.
- [x] Preserve outer exec only in provider Context and project real nested target truth through
      Journal/UI.
- [x] Add versioned provider pricing plus discovery, repeated-discovery, and quality evidence before
      evaluating billed cost and success gates.
- [x] Evaluate adapter routing as retain-default-off while reviewed production pricing and real
      canary/holdout evidence are unavailable; make no whole-prefix stability or Native Activation
      completion-percentage claim.
- [x] Perform a severity review before commit; do not push.

## Final Validation

- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
- [x] Run `pnpm run typecheck` and focused ToolService, Agent, CLI, Tape, Journal, provider-cache,
      retry, and supported crash suites when implementation lands.
- [x] Run the broadest relevant main-process suite and record reproduced baseline failures.
- [x] Review the complete diff by severity and fix all findings.
- [x] Confirm `index.js` and all unrelated worktree changes remain unmodified and uncommitted.
- [x] Confirm no push occurred.
