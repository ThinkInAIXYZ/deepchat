# New Agent Architecture v2 — Tool Calling / MCP Integration

## Status: Complete (superseded by v3 refactor)

> The v2 implementation has been refactored into the v3 module structure. See `v3-spec.md` for the current architecture. This spec is retained for historical context on design decisions.
> Note: the historical MCP UI resource exploration mentioned below is no longer supported in the current codebase.

## Overview

v0 proved single-turn chat, v1 added multi-turn context assembly. The LLM currently receives `tools: []` — no tool definitions, no tool execution. v2 adds MCP tool calling so the LLM can invoke tools and receive results in an agent loop.

## Goals

1. **Tool definition discovery** — fetch MCP tool definitions via `ToolPresenter.getAllToolDefinitions()` and pass to `coreStream`
2. **Agent loop** — when `coreStream` stops with `stop_reason: 'tool_use'`, execute tools and re-call `coreStream` with results
3. **Tool execution** — call tools via `ToolPresenter.callTool()`, format results as `role: 'tool'` messages
4. **Tool call rendering** — emit `tool_call` blocks so the renderer displays tool invocations and results
5. **Safety limit** — cap tool calls at MAX_TOOL_CALLS per processMessage invocation

## Non-Goals (deferred)

- Permission pre-checking / user approval
- Question tool — halting the loop for user input
- ACP agent tool routing — ACP handles tools internally
- Search result extraction from tool responses
- Tool system prompt injection (`ToolPresenter.buildToolSystemPrompt`)

## Data Model

No new DB tables. Changes to existing types:

- `AssistantBlockType` gains `'tool_call'` variant
- `AssistantMessageBlock` gains optional `tool_call` field for tool metadata
- Tool results are transient within the agent loop's `conversationMessages` array — not persisted as separate DB records (tool_call blocks in the assistant message capture the tool name, params, and response for display)

## Architecture (current — v3 module structure)

The v2 goals are implemented in the v3 module structure. The original `streamHandler.ts` + `agentLoop.ts` were refactored into five focused modules:

```
deepchatAgentPresenter/
  index.ts           — session lifecycle + single processStream() call
  process.ts         — unified loop: stream → accumulate → echo → dispatch
  accumulator.ts     — accumulate(state, event): pure block mutations
  echo.ts            — interval-based flush to renderer + DB
  dispatch.ts        — executeTools() + finalize() + finalizeError()
  types.ts           — StreamState, IoParams, ProcessParams
  contextBuilder.ts  — DB records to ChatMessage[], truncation
  messageStore.ts    — SQLite wrapper
  sessionStore.ts    — SQLite wrapper
```

### Tool Call Flow

```
processMessage(sessionId, content)
  ├── buildContext(...)                          → ChatMessage[]
  ├── toolPresenter.getAllToolDefinitions(...)    → MCPToolDefinition[]
  └── processStream(params)
        │
        ├── LOOP:
        │   ├── coreStream(conversation, model, config, temp, maxTokens, tools)
        │   ├── for await (event of stream): accumulate(state, event)
        │   │
        │   ├── if stopReason !== 'tool_use' → BREAK
        │   │
        │   ├── executeTools(state, conversation, prevBlockCount, ...)
        │   │     ├── build assistant message (content + tool_calls + reasoning_content)
        │   │     ├── for each tool call:
        │   │     │     callTool() → push tool result to conversation → update block
        │   │     └── enrich blocks with server info
        │   ├── echo.flush()
        │   │
        │   └── if toolCallCount > MAX_TOOL_CALLS → BREAK
        │
        ├── finalize(state, io)
        └── (catch) finalizeError(state, io, err)
```

### Stream Event Mapping

| LLMCoreStreamEvent | Action |
|---|---|
| `tool_call_start` | Create `tool_call` block with `status: 'pending'`, record id + name |
| `tool_call_chunk` | Accumulate arguments into pending tool call |
| `tool_call_end` | Finalize arguments, move to completedToolCalls |
| `stop` with `stop_reason: 'tool_use'` | Break out of stream, enter tool execution |
| `stop` with other reason | Break out of loop, finalize |

### Tool Call Block Format

```typescript
{
  type: 'tool_call',
  content: '',  // unused for tool_call type
  status: 'pending' | 'success' | 'error',
  timestamp: number,
  tool_call: {
    id: string,
    name: string,
    params: string,          // JSON arguments
    response: string,        // tool result text
    server_name?: string,
    server_icons?: string,
    server_description?: string
  }
}
```

## Key Dependencies

- `IToolPresenter` — `src/shared/types/presenters/tool.presenter.d.ts`
  - `getAllToolDefinitions(context)` → `MCPToolDefinition[]`
  - `callTool(request: MCPToolCall)` → `{ content, rawData: MCPToolResponse }`
- `MCPToolDefinition`, `MCPToolCall`, `MCPToolResponse` — `src/shared/types/core/mcp.ts`
- `ChatMessage` with `tool_calls` and `tool_call_id` — `src/shared/types/core/chat-message.ts`
- `StopStreamEvent.stop_reason: 'tool_use'` — `src/shared/types/core/llm-events.ts`
- `ToolPresenter` already instantiated at `src/main/presenter/index.ts:191`

## Acceptance Criteria

- [x] Tool definitions passed to `coreStream` when tools are available
- [x] `tool_call_start/chunk/end` events create `tool_call` blocks in the stream
- [x] `stop_reason: 'tool_use'` triggers tool execution via `ToolPresenter.callTool()`
- [x] Tool results appended as `role: 'tool'` messages and loop re-invokes `coreStream`
- [x] Multi-turn tool loop works: LLM calls tools, gets results, calls more tools or produces final answer
- [x] Max tool calls limit (128) stops the loop
- [x] Abort signal cancels the loop mid-execution
- [x] Tool call blocks rendered in the UI with name, params, and response
- [x] `pnpm run typecheck` passes
- [x] All tests pass
- [x] `pnpm run lint && pnpm run format` passes
