# Agent MCP Allow-List Runtime Enforce

## Issue

DeepChat agent config and Plugins UI store per-agent `enabledMcpServerIds`, but session tool
discovery does not pass that allow-list into `ToolPresenter` / MCP catalog or call paths. Agents with
`enabledMcpServerIds: []` can still list and invoke globally running MCP servers.

## Impact

- Host-agent MCP isolation is a product lie: settings appear agent-scoped, runtime is global.
- Violates `agent-scoped-extensions` AC4.
- Concurrent multi-agent sessions share the full MCP surface.

## Root Cause

`resolveAgentExtensionPolicy` only returns `enabledSkillNames`.
`createSessionToolCatalogPort` omits `enabledMcpServerIds` from the tool definition context.
A regression test (`omits historical MCP and plugin policies`) incorrectly locked MCP omission
together with historical plugin policy removal.

## Fix Plan

- Extend extension policy with resolved `enabledMcpServerIds`.
- Pass allow-list into catalog context, fingerprint, execute options, and deferred execution.
- Rely on existing MCP `enabledServerIds` filtering for definitions and calls.
- Keep plugin-owned MCP exemption and omit `enabledPluginIds`.
- Replace the omit-MCP expectation with enforce expectations.

## Tasks

- [x] Runtime policy + catalog + fingerprint + dispatch/deferred wiring
- [x] Rewrite presenter tests for enforce semantics
- [x] format / i18n / lint / focused tests

## Validation

- Agent with `enabledMcpServerIds: []` yields no normal MCP tools in discovery context.
- Agent with a non-empty list passes that list into discovery.
- `enabledPluginIds` remains absent from discovery context.
