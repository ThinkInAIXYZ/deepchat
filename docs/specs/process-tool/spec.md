# Process Tool Specification

## Overview

Add a new agent tool `process` for managing background exec sessions. This tool allows agents to run long-running commands in the background and interact with them asynchronously.

## User Stories

### US-1: Start Background Command
As an AI agent, I want to start a command in the background so that I can run long-running tasks without blocking the conversation.

**Acceptance Criteria:**
- Agent can execute `execute_command` with `background: true` parameter
- Command returns immediately with a `sessionId` and `status: "running"`
- Process continues running after tool returns

### US-2: Monitor Background Output
As an AI agent, I want to poll the output of a background command so that I can monitor its progress.

**Acceptance Criteria:**
- `process` tool with `action: "poll"` returns recent output
- Output is truncated to last N characters (configurable, default 500)
- Returns current status: "running", "done", "error", or "killed"

### US-3: Read Full Output
As an AI agent, I want to read the full output of a completed command so that I can analyze the results.

**Acceptance Criteria:**
- `process` tool with `action: "log"` supports pagination via `offset` and `limit`
- Large outputs are automatically offloaded to files
- Agent can use file tools to read offloaded content

### US-4: Send Input to Background Process
As an AI agent, I want to send input to a running background process so that I can interact with interactive commands.

**Acceptance Criteria:**
- `process` tool with `action: "write"` sends data to stdin
- Optional `eof: true` closes stdin

### US-5: Manage Background Sessions
As an AI agent, I want to list, kill, and clean up background sessions so that I can manage resources.

**Acceptance Criteria:**
- `action: "list"` shows all sessions for current agent
- `action: "kill"` terminates a running session
- `action: "clear"` clears output buffer/file
- `action: "remove"` completely removes a session

## Constraints

### Security
- Sessions are isolated by `conversationId` (agent-scoped)
- Session IDs are cryptographically random (nanoid)
- No cross-agent session access

### Resource Management
- Sessions are in-memory only (lost on restart)
- Automatic TTL cleanup (default 30 minutes inactivity)
- Maximum runtime limit (default 30 minutes)
- Large outputs offloaded to files (>10KB threshold)

### Configuration
```typescript
interface ExecToolsConfig {
  backgroundMs: number      // Default yield window (10000)
  timeoutSec: number        // Max runtime (1800)
  cleanupMs: number         // Session TTL (1800000)
  maxOutputChars: number    // Poll output limit (500)
}
```

Environment variables:
- `PI_BASH_YIELD_MS`
- `PI_BASH_MAX_OUTPUT_CHARS`
- `OPENCLAW_BASH_PENDING_MAX_OUTPUT_CHARS` (compatibility)
- `PI_BASH_JOB_TTL_MS`

## Non-Goals

- PTY/terminal emulation (not needed - pipe mode is sufficient)
- Cross-agent session sharing
- Persistent sessions across restarts
- Real-time streaming output (poll-based only)

## Open Questions

| Question | Decision |
|----------|----------|
| PTY or pipe mode? | Pipe mode (agent-controlled) |
| Offload large outputs? | Yes, >10KB threshold |
| Always show process tool? | Yes, always visible |
| Default poll output size? | 500 characters |

## Business Value

Enables agents to:
1. Run long-running builds/tests without blocking
2. Monitor server processes
3. Handle interactive CLI tools
4. Better resource management for complex workflows
