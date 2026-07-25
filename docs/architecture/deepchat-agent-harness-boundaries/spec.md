# DeepChat Agent Harness Boundaries

## Context

DeepChat's tool runtime already has a conservative parallel fast path, but the scheduling policy is
encoded in `dispatch.ts` as an Agent tool-name allowlist. That makes execution safety depend on a
string convention instead of the tool catalog that owns tool capabilities. A rename, replacement,
or new read-only tool therefore requires runtime knowledge that does not belong in dispatch.

This architecture goal will establish stable contracts around the DeepChat Agent harness over
multiple short-lived pull requests. The current slice covers only the typed tool execution
contract. Coordinator decomposition, a Harness facade, typed hooks, and same-run steering remain
separate changes.

## Comparative Evidence

Pi places an optional `executionMode` on each Agent tool. Its loop executes a batch in parallel by
default unless global configuration or any tool requests sequential execution. This correctly puts
the capability on the tool, but its default-open policy is too permissive for DeepChat's mixed
built-in/MCP catalog, permission pauses, durable queue, and persisted tool settlement.

Bub's asynchronous executor applies `asyncio.gather` to every tool-call batch. It preserves input
result order and isolates declared tool errors, but it has no side-effect or scheduling contract.
That model cannot safely represent DeepChat tools that mutate files, settings, memory, Tape-visible
state, browser state, processes, or user interactions.

DeepChat will keep its existing fail-closed, all-or-nothing batch behavior while moving the
parallel decision from a name allowlist to an explicit catalog-owned contract.

## Goals

- Define one canonical, typed execution contract for every `MCPToolDefinition`.
- Make a tool's maximum side effect and concurrency permission explicit at its definition site.
- Make `write + parallel` unrepresentable in TypeScript.
- Admit external MCP tools with a conservative contract without trusting server-supplied hints.
- Keep current runtime behavior: only a multi-call batch composed entirely of explicitly parallel
  read tools may run concurrently, and only in `full_access` mode.
- Preserve tool-call result ordering, failure isolation, abort behavior, permission recovery,
  interaction pauses, output fitting, and durable execution-state updates.
- Keep execution-only metadata out of provider payloads, context-window token estimates, and
  provider-view tool-definition hashes.

## Execution Contract

The canonical definition uses a closed discriminated union:

```ts
type ToolExecutionMode = 'sequential' | 'parallel'
type ToolEffect = 'read' | 'write'

type ToolExecutionContract =
  | { effect: 'read'; mode: ToolExecutionMode }
  | { effect: 'write'; mode: 'sequential' }

type MCPToolDefinition = MCPToolDefinitionBase & {
  execution: ToolExecutionContract
}
```

`effect` describes the maximum observable capability of the tool, not the behavior of one selected
argument branch:

- `read` means the tool has no durable, external, user-interaction, or non-idempotent mutation that
  can conflict with another call.
- `write` includes any tool that can mutate state, incur an externally visible action, pause for an
  interaction, or select a mutating operation based on arguments.

`execution.mode` is a positive scheduling grant. A `read` tool may remain sequential because of
resource limits, internal mutable caches, ordering requirements, or because concurrency has not yet
been validated. Only an explicit `read + parallel` contract authorizes parallel execution.

A single deeply frozen `TOOL_EXECUTION` preset catalog represents the three valid contracts.
Definition sites assign one atomic `execution` value, for example `TOOL_EXECUTION.write` or
`TOOL_EXECUTION.read.parallel`, instead of spreading independent fields into the definition. Runtime
freezing prevents one definition from mutating the shared preset used by every other definition.
This keeps execution-only metadata namespaced, makes the classification concise and reviewable, and
lets provider-facing projections remove the complete contract when it evolves. `MCPToolDefinition`
has one canonical declaration under `src/shared/types/core`; the broader shared MCP module aliases
that declaration instead of maintaining a second structural copy.

## Trust And Classification

Built-in Agent definitions declare their contract at the owning definition site. For compatibility
with current behavior, only the filesystem `read` tool is initially `read + parallel`.

- Filesystem `glob` and `grep`, Tape queries, `skill_list`, and `get_browser_status` are
  `read + sequential` until their concurrency behavior is deliberately validated.
- File mutation, commands, processes, questions, plans, settings, image generation, cron jobs,
  subagents, skill activation/management/execution, and browser navigation/CDP are
  `write + sequential`.
- All memory tools are `write + sequential`; recall updates access metadata and is not a pure read.
- Parameter-dependent tools use their maximum capability. A tool that can either inspect or mutate
  is classified as `write`.

External MCP and plugin tools enter the catalog as `write + sequential`. MCP annotations such as
`readOnlyHint` are descriptive hints from an untrusted server and never grant local concurrency.
Supporting trusted per-server overrides would require a separate authenticated policy design.

## Batch Scheduling

A pure runtime policy selects `parallel` only when every condition holds:

1. the Session permission mode is `full_access`;
2. the batch contains at least two calls;
3. every call resolves to exactly one definition;
4. every resolved definition is `read + parallel`.

Missing, malformed, or duplicate definitions fail closed to `sequential`. Mixed batches remain
fully sequential; this change does not introduce segmented scheduling around write calls. Parallel
execution continues to settle independently and commit results in provider call order.

## Compatibility

- The runtime tool-definition shape gains one additive internal `execution` object, so structural
  readers and IPC consumers remain compatible. The contract is intentionally required in
  TypeScript, which is a source-level contract tightening for definition constructors; all
  in-repository constructors are updated atomically. No persisted format or database migration
  changes.
- Provider adapters continue projecting only model-visible function metadata. Legacy XML prompt
  generation also continues reading only function metadata.
- Context reserve estimation excludes the execution object so this internal contract does not
  reduce user-visible context capacity.
- Tape ViewManifest tool-definition hashes exclude the execution object, preserving their existing
  provider-view identity. Future execution-policy replay must use a separate versioned identity.
- Existing external MCP tools remain sequential. Existing built-in behavior remains unchanged:
  only Agent filesystem `read` batches gain the parallel path they already had.
- Permission preflight, auto-grant, post-call permission handling, and interaction semantics remain
  owned by dispatch.

## Non-Goals

- Do not parallelize additional built-in or MCP tools in this slice.
- Do not infer execution policy from MCP annotations, names, schemas, permission results, or call
  arguments.
- Do not add per-call dynamic effect classification or a segmented dependency scheduler.
- Do not rewrite tool dispatch or change durable queue and Tape semantics.
- Do not extract the coordinator or Harness facade and do not add typed hooks.
- Do not add same-run steering.
- Do not create or synchronize a GitHub issue for this architecture work.

## Acceptance Criteria

1. The canonical type rejects `write + parallel`, and all production definition ingress paths
   produce an explicit valid contract.
2. Two or more `read + parallel` calls run concurrently only in `full_access`, while result commits
   preserve call order.
3. A sequential read, write, missing definition, malformed contract, duplicate definition, or
   non-`full_access` permission mode makes the complete batch sequential.
4. External MCP definitions remain `write + sequential` even when `readOnlyHint` is true.
5. Parallel failures remain isolated per call; abort and already-returned-result settlement retain
   current behavior.
6. Execution metadata is absent from provider tool schemas and does not change the historical tool
   token reserve or ViewManifest tool-definition hash.
7. Focused tests, type checks, formatting, i18n validation, and lint pass before handoff.
