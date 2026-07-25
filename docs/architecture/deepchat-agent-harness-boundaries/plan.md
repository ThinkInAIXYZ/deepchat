# DeepChat Agent Harness Boundaries Plan

## Current Slice

Implement the typed tool execution contract as an independently reviewable refactor. Keep the
observable scheduler behavior unchanged while replacing the runtime tool-name allowlist with
catalog-owned capability metadata.

## Type Model

1. Add `ToolEffect`, `ToolExecutionMode`, and the discriminated `ToolExecutionContract` union to the
   canonical core MCP types.
2. Add one required `execution` object to `MCPToolDefinition` so capability metadata remains atomic
   and namespaced from model-visible definition fields.
3. Export one deeply frozen `TOOL_EXECUTION` preset catalog for parallel read, sequential read, and
   sequential write contracts so shared preset references cannot be mutated at runtime.
4. Replace the duplicate `MCPToolDefinition` declaration in the broad shared MCP module with a type
   alias and re-exports from the canonical module.

This keeps one source of truth while preserving both existing import paths.

## Catalog Classification

Add an explicit contract at every production definition boundary:

- filesystem `read`: parallel read;
- filesystem `glob` and `grep`, Tape query tools, `skill_list`, and browser status: sequential read;
- every other built-in Agent tool: sequential write;
- MCP and plugin definitions: sequential write at the MCP discovery boundary, independent of MCP
  annotations.

Use a tool's maximum capability when its effect depends on arguments. Keep these classifications
close to definition construction rather than introducing a second name-to-policy registry.
Prompt-only fallback descriptors remain base definitions and do not fabricate execution metadata.

## Runtime Policy

Create a small pure module in the DeepChat runtime that selects a batch execution mode from:

- Session permission mode;
- ordered completed tool calls;
- current tool definitions.

Build a definition-name index once per decision. Treat duplicate names as ambiguous and fail closed.
Return `parallel` only for a multi-call, `full_access`, all-parallel-read batch. Integrate this
selector at the existing parallel branch in `dispatch.ts` without changing execution or commit
mechanics.

## Provider And Context Boundaries

Keep provider mapping explicit: AI SDK and legacy prompt paths consume function metadata only.
Change the DeepChat token estimator to measure the historical definition projection without
the complete `execution` object. Use the same projection for Tape ViewManifest tool-definition hashes
so execution policy does not redefine provider-view identity. Add regression coverage proving
execution metadata neither reaches the AI SDK tool schema nor changes the existing reserve or hash.

## Tests

Add a focused pure-policy suite for:

- homogeneous parallel reads;
- sequential reads and mixed effects;
- non-`full_access` modes;
- missing, malformed, and duplicate definitions;
- single-call batches.

Extend dispatch coverage to prove the policy drives real concurrency and serialization without
changing result order or failure isolation. Extend MCP catalog coverage to prove `readOnlyHint`
does not grant concurrency. Update production and test definition fixtures to satisfy the canonical
type.

## Validation

Run in increasing scope:

```bash
pnpm exec vitest run --config vitest.config.ts \
  test/main/agent/deepchat/runtime/toolExecutionPolicy.test.ts \
  test/main/agent/deepchat/runtime/dispatch.test.ts \
  test/main/agent/deepchat/runtime/contextBuilder.test.ts \
  test/main/provider/aiSdkToolMapper.test.ts \
  test/main/mcp/toolManager.test.ts \
  test/main/tool/toolService.test.ts \
  test/main/session/data/tapeViewManifest.test.ts
pnpm run typecheck
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run test:main
```

If the full main suite has unrelated environment-gated failures, reproduce them on `dev` and report
the distinction rather than weakening coverage.

## Commit And Review Strategy

Use two local commits:

1. `docs(agent): specify tool execution contract`
2. `refactor(agent): type tool execution policy`

Before each commit, inspect both staged and unstaged changes for hidden side effects, compatibility,
edge cases, performance, security, misleading names, missing tests, and future maintenance cost.
Fix all findings and repeat the relevant validation before committing. Do not push either commit.

## Later Slices

After this contract lands in `dev`, later branches may extend this architecture record for
coordinator boundaries, a thin Harness facade, and typed hook reduction. Those changes must not be
implemented or coupled to the current branch. Same-run steering remains a separate feature design.
