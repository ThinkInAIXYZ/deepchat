# Auto-Tools Implementation Plan (DeepChat)

## 0) Constraints & Agreements
- Dual-mode: traditional (default) vs auto-tools (metadata + JS orchestration). ACP unchanged.
- Providers: no allowlist/gating; rely on strong function wrap and existing parsing. Works with OpenAI/Anthropic/Ollama/etc.
- Sandbox: JavaScript only (reuse Powerpack-style Node runtime). No Python.
- UX: prompt hint + manual toggle per conversation; dev mode emits logs; no noisy prod logs.

## 1) Architecture Fit (with current code)
- Entry: `src/main/presenter/agentPresenter/loop/agentLoopHandler.ts`
  - Decide mode via `ConfigPresenter.getAutoToolsConfig()` and provider ≠ `acp`.
  - Build tool defs: traditional → `ToolPresenter.getAllToolDefinitions`; auto → metadata builder + synthetic `run_auto_tool`.
  - Detect `run_auto_tool` tool call; execute sandbox; append tool result as tool message; continue loop.
- Tool aggregation: `src/main/presenter/toolPresenter/index.ts` + `toolMapper.ts`
  - Add metadata transformation (name, truncated description, category/tags, required param names, `deferParams` flag).
  - Inject `AUTO_TOOL_DEFINITION` into returned list when auto-tools mode.
- Tool execution: reuse `toolPresenter` → `mcpPresenter` / `agentToolManager` for `callTool` invoked from sandbox.
- Sandbox: new `src/main/presenter/toolPresenter/autoToolsSandbox.ts`
  - In-memory search index built from current tool defs.
  - API exposed to JS: `searchTools` (returns matches and can inline full schema/examples when `includeSchema=true` to avoid extra lookups), `callTool`, `batchCall`, `log`, `getWorkspacePath`, `getConversationId`.
  - Security: forbidden modules/patterns, timeout, parallel cap, memory/iteration caps.
  - Permissions: reuse `CommandPermissionService` + MCP permission checks; auto-approve read if configured.
- Data models: extend `MCPToolDefinition.metadata`; add `AutoToolsConfig`, `ToolSearchResult` (includes optional schema/examples when requested), `AutoToolsExecutionResult`.

- Events (optional): `AUTO_TOOLS_*` for renderer progress/logging (progress, search results, warnings, permission requests).




## 2) Auto-Tools Execution Flow (Agent loop)
1) AgentLoop builds metadata tool list + `run_auto_tool`, sends to provider.
2) LLM emits `run_auto_tool` with JS code (no provider gating required).
3) `toolCallProcessor` spots `run_auto_tool` → `AutoToolsSandbox.execute(code, ctx)`.
4) Sandbox code can call:
   - `searchTools(q, {limit, category, tags, includeSchema?})` → returns matches and (optionally) full schema/examples in the same call to reduce round-trips.
   - `callTool(name, params)` / `batchCall(...)` (respect `parallelLimit`).

5) Before each call: permission check; write/execute prompt; read may auto-approve per config.
6) Sandbox returns compact summary (tools searched/called, key data, truncated outputs, errors). Intermediate data stays in sandbox.
7) AgentLoop appends tool message with summary and continues conversation.
8) Dev mode: log sandbox execution (timings, tools used, token-save estimate) to console/log file only.

## 3) UI Plan
- Settings (renderer Advanced/Agent): toggle `enableAutoTools`; fields: max results, timeout, parallel limit, auto-approve-read, debug.
- Prompt hint: when auto-tools on, prepend small system hint and show mode chip/header control; allow manual switch per conversation.
- Message block: show auto-tools progress (search → calls → summary) with collapsible detail; debug mode shows generated JS + logs.
- Permission dialog: mention "Auto-Tools" context; allow approve-all for category/session when appropriate.

## 4) Data & Config
- Config defaults: `enableAutoTools=false`, `maxResults=10 (≤50)`, `defaultTimeout=30000 (max 60000)`, `parallelLimit=5 (≤10)`, `autoApproveRead=true`, `debugMode=false`, `allowedCategories?` optional.
- Metadata enrichment:
  - category inferred from name/description/server (filesystem/browser/network/utils/agent/mcp).
  - capabilities from verb heuristics (read/write/execute); risk level derived.
  - parameters: keep names; mark `deferParams=true`; `searchTools(includeSchema=true)` can return full schema/examples when needed (no separate lookup).

## 5) Safety & Limits
- Security: forbid `require/import/eval/Function`, `process/global`, fs/child_process/path/net/http/etc; cap runtime (≤60s), memory, iterations, pending promises.
- Output controls: truncate long strings/arrays; redact sensitive patterns; cap batch size by `parallelLimit`.
- Error policy: on sandbox error return partial result + error; do not auto-switch mode; let LLM decide next action.
- Logging: dev mode only; no automatic token-based disabling (only log savings).

## 6) Testing Strategy
- Unit: sandbox security/timeout; search ranking; permission integration; metadata transformer.
- Integration: agent loop auto-tools flow (non-ACP); multi-tool orchestration; permission prompts; fallback paths.
- UI: settings toggles wire to config; conversation shows mode chip; progress block renders states; permission dialog copy.
- Performance: benchmark vs traditional (token + latency); ensure <2s sandbox overhead typical.

## 7) Rollout
- Default off; feature flag via config.
- Dev mode logs token savings; no auto-disable.
- Escape hatch: global `forceTraditionalMode`.
