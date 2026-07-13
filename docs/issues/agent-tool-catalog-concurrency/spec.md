# Agent Tool Catalog Concurrency Regression

## Issue

Concurrent tool-catalog resolutions for the same DeepChat conversation can incorrectly remove every
Agent tool from one result. The affected provider request then contains an empty `tools` array, while
models may still emit textual tool-call markers that the renderer cannot associate with registered
tools.

Observed symptoms include:

- repeated `Tool name conflict ... preferring MCP tool` warnings for the complete Agent tool set;
- provider request traces with `tools: []`;
- raw provider-specific tool-call markup in assistant text;
- generic failed tool cards without tool names or arguments.

## Location and root cause

`ToolPresenter.getAllToolDefinitions` mutates a conversation-scoped `ToolMapper` while awaiting MCP
and Agent tool definitions. A second resolution for the same conversation reuses and clears that
mapper. When the first resolution registers its Agent tools before the second resolution performs
deduplication, the second resolution treats the first resolution's Agent mappings as MCP collisions
and filters out the entire Agent tool set.

The request trace is reporting the resulting empty catalog accurately. Provider request encoding and
renderer tool-card presentation are downstream symptoms rather than the source of the regression.

## Fix plan

- Build each catalog against a request-local `ToolMapper`.
- Resolve MCP-versus-Agent collisions only within that request-local catalog.
- Publish the completed mapping atomically to the conversation and fallback routing maps.
- Preserve existing MCP precedence, reserved Agent tool behavior, disabled-tool filtering, and tool
  execution routing.
- Add a deterministic regression test with overlapping catalog resolutions for one conversation.

## Compatibility boundaries

- No provider protocol or renderer schema changes.
- No changes to memory injection, memory recall, tape persistence, permission handling, or skill
  activation semantics.
- No change to the public `IToolPresenter` contract.

## Tasks

- [x] Reproduce the overlapping-resolution failure in a unit test.
- [x] Make tool mapping publication request-local and atomic.
- [x] Verify existing collision and routing behavior.
- [x] Run focused tests, formatting, i18n validation, lint, Node typecheck, and architecture lint.

## Validation

- Both overlapping resolutions return the same complete Agent tool catalog.
- A genuine MCP/Agent name collision still keeps the MCP definition.
- Tool calls continue to route through the source recorded for the conversation.
- Existing main-process tool presenter and catalog adapter tests pass.

## GitHub issue

Not linked. No GitHub issue sync was requested.
