# Process Tool Implementation Plan

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      AgentToolManager                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  fileSystem     │  │  process        │  │  question       │  │
│  │  tools          │  │  tool (NEW)     │  │  tool           │  │
│  └────────┬────────┘  └────────┬────────┘  └─────────────────┘  │
│           │                    │                                 │
│  ┌────────▼────────────────────▼────────┐                        │
│  │      AgentBashHandler (modified)     │                        │
│  │  - executeCommand (foreground)       │                        │
│  │  - executeCommandBackground (NEW)    │                        │
│  └────────┬─────────────────────────────┘                        │
│           │                                                      │
│  ┌────────▼──────────────────────────────────────────┐           │
│  │      BackgroundExecSessionManager (NEW)           │           │
│  │  - Map<conversationId, Map<sessionId, Session>>   │           │
│  │  - spawn processes with stdio pipes               │           │
│  │  - poll/log/write/kill/clear/remove operations    │           │
│  │  - TTL cleanup timer                              │           │
│  │  - offload large outputs to files                 │           │
│  └───────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### Data Model

```typescript
interface BackgroundSession {
  sessionId: string
  conversationId: string
  command: string
  child: ChildProcess
  status: 'running' | 'done' | 'error' | 'killed'
  exitCode?: number
  createdAt: number
  lastAccessedAt: number
  outputBuffer: string        // In-memory buffer (<10KB)
  outputFilePath: string|null // Offloaded content (>10KB)
  totalOutputLength: number
}

interface SessionMeta {
  sessionId: string
  command: string
  status: 'running' | 'done' | 'error' | 'killed'
  createdAt: number
  lastAccessedAt: number
  pid?: number
  exitCode?: number
  outputLength: number
  offloaded: boolean
}
```

### Tool Schema

```typescript
// process tool
{
  action: z.enum(['list', 'poll', 'log', 'write', 'kill', 'clear', 'remove']),
  sessionId: z.string().optional(),
  offset: z.number().int().min(0).optional(),  // log only
  limit: z.number().int().min(1).optional(),    // log only
  data: z.string().optional(),                  // write only
  eof: z.boolean().optional()                   // write only
}

// execute_command modification
{
  command: z.string().min(1),
  timeout: z.number().min(100).optional(),
  description: z.string().min(5).max(100),
  background: z.boolean().optional(),  // NEW
  yieldMs: z.number().min(100).optional()  // NEW
}
```

## Event Flow

### Start Background Session

```
1. LLM calls execute_command with background=true
2. AgentToolManager routes to AgentBashHandler
3. AgentBashHandler calls BackgroundExecSessionManager.start()
4. Spawn child process with stdio pipes
5. Store session in Map
6. Return {status: "running", sessionId}
```

### Poll Output

```
1. LLM calls process with action="poll"
2. AgentToolManager routes to process tool handler
3. BackgroundExecSessionManager.poll() returns recent output
4. If offloaded, read last N chars from file
5. Return {status, output, exitCode?, offloaded?}
```

### Write Input

```
1. LLM calls process with action="write", data="..."
2. BackgroundExecSessionManager.write() writes to child.stdin
3. Optionally close stdin with eof=true
```

### Kill Session

```
1. LLM calls process with action="kill"
2. BackgroundExecSessionManager.kill() sends SIGTERM
3. Wait 2s, then SIGKILL if still running
4. Update session status
```

## File Structure

```
src/main/presenter/agentPresenter/acp/
├── backgroundExecSessionManager.ts    # NEW - Session manager
├── agentBashHandler.ts                # MODIFY - Add background support
├── agentToolManager.ts                # MODIFY - Add process tool
└── index.ts                           # MODIFY - Export new module

src/main/presenter/sessionPresenter/
└── sessionPaths.ts                    # EXISTING - Used for offload paths
```

## Offload Strategy

```
Output Collection:
1. Write to memory buffer initially
2. When buffer > 10KB threshold:
   - Write buffer to file: ~/.deepchat/sessions/<conversationId>/bgexec_<sessionId>.log
   - Clear memory buffer
3. Subsequent output appended directly to file

Poll Response:
- If offloaded: return last 500 chars from file
- Else: return last 500 chars from buffer

Log Response:
- If offloaded: read from file with offset/limit
- Else: slice from buffer with offset/limit
```

## Security Considerations

1. **Session Isolation**: Map key is `conversationId`, prevents cross-agent access
2. **Path Security**: Offload files use resolved session directory
3. **Resource Limits**: TTL cleanup prevents resource exhaustion
4. **Kill Safety**: SIGTERM before SIGKILL, timeout handling

## Error Handling

| Scenario | Response |
|----------|----------|
| Session not found | Error: "Session X not found" |
| Write to non-running session | Error: "Session X is not running" |
| Kill already dead session | No-op (idempotent) |
| Remove with cleanup failure | Log warning, continue removal |
| File read error | Return empty string, log warning |

## Testing Strategy

### Unit Tests (BackgroundExecSessionManager)

- `start()`: Verify session creation, process spawn
- `poll()`: Verify output retrieval, offloading behavior
- `log()`: Verify pagination with offset/limit
- `write()`: Verify stdin writing
- `kill()`: Verify process termination
- `clear()`: Verify buffer/file clearing
- `remove()`: Verify complete cleanup
- `cleanup timer`: Verify TTL expiration

### Integration Tests

- End-to-end: execute_command (background) → process:poll → process:kill
- Offload flow: Large output → file creation → file reading
- Error scenarios: Invalid sessionId, terminated process

## i18n Strings

```json
{
  "tools": {
    "process": {
      "sessionNotFound": "Session {sessionId} not found",
      "sessionNotRunning": "Session {sessionId} is not running",
      "stdinNotAvailable": "Session {sessionId} stdin is not available"
    }
  }
}
```

## Migration Notes

- No breaking changes to existing execute_command
- New parameters are optional with sensible defaults
- process tool is additive only
