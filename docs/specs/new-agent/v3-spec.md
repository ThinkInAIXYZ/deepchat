# New Agent Architecture v3 — Stream Processing Refactor

## Status: Complete

## Overview

v2 added MCP tool calling via an agent loop. The implementation worked but had tangled responsibilities: `streamHandler.ts` (336 lines) mixed stream parsing, block accumulation, flush scheduling, and message finalization. `agentLoop.ts` shared ownership of blocks and finalization with `streamHandler`, leading to the `initialBlocks` hack and conditional `!context.initialBlocks` branching. Two code paths diverged in `index.ts` (tools vs no-tools).

v3 refactored the stream processing into five focused pieces with clear boundaries, no shared ownership, and a single code path.

## Goals

1. **Separate stream accumulation from side effects** — event handling is pure block mutation, flush is independent
2. **Single loop, single code path** — no tools-vs-no-tools branching (zero tools = loop runs once)
3. **Throttled flush as a utility** — reusable throttle function, not embedded timers
4. **Each module does one thing** — accumulate, echo, dispatch, process, types
5. **No `initialBlocks` hack** — the loop owns the state, passes it down, nobody round-trips it

## Non-Goals

- Changing the block data model or DB schema
- Changing renderer event contracts (STREAM_EVENTS.RESPONSE/END/ERROR)
- Changing the LLMCoreStreamEvent types or provider coreStream interface
- Adding new features (permissions, retry, parallel tool exec)

## Current Structure

```
deepchatAgentPresenter/
  index.ts           — session lifecycle only (init, destroy, getState, cancel, getMessages)
  process.ts         — the loop: stream → accumulate → echo → dispatch
  accumulator.ts     — accumulate(state, event): mutate blocks by event type
  echo.ts            — start/stop throttled flush to renderer + DB
  dispatch.ts        — executeTools() + finalize() + finalizeError()
  contextBuilder.ts  — (unchanged from v1)
  messageStore.ts    — (unchanged)
  sessionStore.ts    — (unchanged)
  types.ts           — StreamState, IoParams, ProcessParams

src/shared/utils/
  throttle.ts        — createThrottle(fn, interval): reusable throttle utility
```

## Architecture

### Shared State

All modules operate on a single mutable `StreamState` object owned by `process.ts`:

```typescript
// types.ts
interface ToolCallResult {
  id: string
  name: string
  arguments: string
  serverName?: string
  serverIcons?: string
  serverDescription?: string
}

interface StreamState {
  blocks: AssistantMessageBlock[]
  metadata: MessageMetadata
  startTime: number
  firstTokenTime: number | null
  pendingToolCalls: Map<string, { name: string; arguments: string; blockIndex: number }>
  completedToolCalls: ToolCallResult[]
  stopReason: 'complete' | 'tool_use' | 'error' | 'abort' | 'max_tokens'
  dirty: boolean
}

interface IoParams {
  sessionId: string
  messageId: string
  messageStore: DeepChatMessageStore
  abortSignal: AbortSignal
}

interface ProcessParams {
  io: IoParams
  coreStream: (...) => AsyncGenerator<LLMCoreStreamEvent>
  tools: MCPToolDefinition[]
  toolPresenter: IToolPresenter | null
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  messages: ChatMessage[]
}
```

### Module Responsibilities

#### `accumulator.ts` — event → block mutation

Pure block mutation. No DB, no renderer, no control flow decisions.

```typescript
function accumulate(state: StreamState, event: LLMCoreStreamEvent): void
```

| Event | Action |
|---|---|
| `text` | Append to current content block (coalesce consecutive) |
| `reasoning` | Append to current reasoning_content block |
| `tool_call_start` | Push new tool_call block, add to pendingToolCalls map |
| `tool_call_chunk` | Append to pending args + update block params |
| `tool_call_end` | Finalize args, move to completedToolCalls, remove from pending |
| `usage` | Set metadata fields |
| `stop` | Set stopReason |
| `error` | Push error block (status `'error'`) |

New blocks are always created with `status: 'pending'`. The accumulator never transitions existing blocks to `'success'` or `'error'` — that's `dispatch.ts`'s job. The only exception is the `error` event handler, which creates a *new* error block with `status: 'error'`.

Sets `state.dirty = true` on any block mutation. Sets `state.firstTokenTime` on the first `text` or `reasoning` event if not already set.

#### `echo.ts` — interval-based flush to renderer + DB

Two `setInterval` timers drive periodic flushing. Each interval callback checks `state.dirty` before doing work. The shared `createThrottle` utility wraps each callback to prevent overlapping flushes if a write takes longer than the interval.

```typescript
interface EchoHandle {
  flush(): void    // immediate flush (after tool results)
  stop(): void     // clear intervals + cancel pending throttles
}

function startEcho(state: StreamState, io: IoParams): EchoHandle
```

- Renderer interval: 120ms — when `state.dirty`, emit `STREAM_EVENTS.RESPONSE` with deep-cloned blocks
- DB interval: 600ms — when `state.dirty`, call `messageStore.updateAssistantContent()`
- `flush()`: immediate renderer + DB write, clears `state.dirty`
- `stop()`: clears both intervals, cancels pending throttles (called in `finally` block of process)

#### `dispatch.ts` — tool execution + finalization

```typescript
async function executeTools(
  state: StreamState,
  conversation: ChatMessage[],
  prevBlockCount: number,
  tools: MCPToolDefinition[],
  toolPresenter: IToolPresenter,
  modelId: string,
  io: IoParams
): Promise<number>

function finalize(state: StreamState, io: IoParams): void
function finalizeError(state: StreamState, io: IoParams, error: unknown): void
```

Three independent functions in one module. They share no internal state — all coordination goes through `StreamState` and the arguments passed in.

`executeTools` responsibilities:
- Use `prevBlockCount` to slice `state.blocks` and extract only the current iteration's content/reasoning/tool_call blocks
- Build assistant message from current iteration blocks (content + tool_calls)
- Include `reasoning_content` for interleaved thinking models (deepseek-reasoner, kimi-k2-thinking, glm-4.7)
- Push assistant message to conversation
- For each tool call: check `abortSignal` → call `toolPresenter.callTool()` → push tool result to conversation → update tool_call block response + status
- Enrich tool_call blocks with server info from tool definitions
- Flush to renderer + DB after each tool execution
- Returns the number of tools executed
- Does NOT enforce MAX_TOOL_CALLS (that's the loop's job in `process.ts`)

`finalize` responsibilities:
- Mark all pending blocks as `'success'`
- Compute metadata using `state.startTime` and `state.firstTokenTime` (generationTime, firstTokenTime, tokensPerSecond)
- Call `messageStore.finalizeAssistantMessage()`
- Emit `STREAM_EVENTS.RESPONSE` (final blocks) + `STREAM_EVENTS.END`

`finalizeError` responsibilities:
- Push error block
- Mark all pending blocks as `'error'`
- Call `messageStore.setMessageError()`
- Emit `STREAM_EVENTS.ERROR`

#### `process.ts` — the loop

Single entry point, single code path. No tools-vs-no-tools branching.

```typescript
async function processStream(params: ProcessParams): Promise<void>
```

```
processStream(params)
  state = createState()
  conversation = [...params.messages]
  echo = startEcho(state, params.io)
  toolCallCount = 0

  try {
    LOOP:
      prevBlockCount = state.blocks.length
      stream = coreStream(conversation, ...)
      reset completedToolCalls + pendingToolCalls

      for await (event of stream):
        if aborted → mark blocks error, setMessageError, emit ERROR, return
        accumulate(state, event)

      if aborted → break LOOP
      if stopReason ≠ 'tool_use' → break LOOP
      if no completedToolCalls → break LOOP
      if toolCallCount + completedToolCalls > MAX_TOOL_CALLS → break LOOP

      executed = executeTools(state, conversation, prevBlockCount, ...)
      toolCallCount += executed
      echo.flush()

      if aborted → break LOOP

    finalize(state, params.io)
  catch (err):
    finalizeError(state, params.io, err)
  finally:
    echo.stop()
```

MAX_TOOL_CALLS = 128.

#### `index.ts` — session lifecycle

`processMessage` is thin: build context, resolve provider, construct `ProcessParams`, call `processStream`.

```
processMessage(sessionId, content)
  ├── resolve provider + model config
  ├── buildContext(...)
  ├── persist user message + create assistant placeholder
  ├── fetch tool definitions (no conversationId — new agent doesn't use skills)
  └── processStream(params)    ← single call, no branching
```

### Throttle Utility

```typescript
// src/shared/utils/throttle.ts
interface ThrottledFn {
  (): void           // invoke (throttled — skips if called within interval of last execution)
  flush(): void      // invoke immediately, reset interval
  cancel(): void     // cancel pending invocation
}

function createThrottle(fn: () => void, interval: number): ThrottledFn
```

`echo.ts` uses `createThrottle` to wrap its flush callbacks, then drives them via `setInterval`. The throttle prevents overlapping flushes — if a DB write takes >600ms, the next interval tick is a no-op instead of stacking. Available for reuse elsewhere in the codebase.

## Migration (completed)

This was a pure refactor. External contracts unchanged:
- `IAgentImplementation` interface: unchanged
- Renderer events (`STREAM_EVENTS.RESPONSE/END/ERROR`): unchanged
- DB schema: unchanged
- Block format (`AssistantMessageBlock`): unchanged
- `contextBuilder.ts`, `messageStore.ts`, `sessionStore.ts`: unchanged

Files created: `throttle.ts`, `types.ts`, `accumulator.ts`, `echo.ts`, `dispatch.ts`, `process.ts`
Files deleted: `streamHandler.ts`, `agentLoop.ts`
Files modified: `index.ts`

## Acceptance Criteria

- [x] All existing behavior preserved (tool calling, reasoning, abort, error handling)
- [x] No `initialBlocks` or conditional caller-detection in any module
- [x] Single code path in `processMessage` (no tools-vs-no-tools branch)
- [x] `streamHandler.ts` and `agentLoop.ts` deleted
- [x] Throttle utility in `src/shared/utils/` and used by `echo.ts`
- [x] All existing tests pass (updated for new module structure)
- [x] `pnpm run typecheck` passes
- [x] `pnpm run lint && pnpm run format` passes
