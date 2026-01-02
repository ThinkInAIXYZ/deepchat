# ACP Protocol Gap Analysis - DeepChat

This document evaluates DeepChat's ACP implementation against the official protocol docs:
- https://agentclientprotocol.com/protocol/prompt-turn
- https://agentclientprotocol.com/protocol/content
- https://agentclientprotocol.com/protocol/tool-calls
- https://agentclientprotocol.com/protocol/file-system
- https://agentclientprotocol.com/protocol/terminals
- https://agentclientprotocol.com/protocol/agent-plan
- https://agentclientprotocol.com/protocol/session-modes
- https://agentclientprotocol.com/protocol/slash-commands

The goal is to focus on what matters for a reliable ACP coding agent, mark optional items, and drop non-protocol or low-value tasks.

## Current State Snapshot
- Core prompt turn flow (`session/prompt`, `session/update`, `session/cancel`, stop reasons) works.
- Tool calls + permission requests work; tool output content formatting is only partial.
- Content mapping covers text/image/resource links; audio is degraded to text; annotations are absent.
- No ACP file-system or terminal tool handlers.
- Capability declaration during initialization is incomplete.
- Plans are flattened to reasoning text; session modes and slash commands are not wired.

## Priority Legend
- **Must**: Required for a functioning ACP coding agent.
- **Should**: Strongly recommended; improves fidelity to the spec.
- **Optional**: Nice to have or UX-only; not required for protocol correctness.

## Feature Matrix

| Area | Feature | Status | Priority | Notes |
| --- | --- | --- | --- | --- |
| Prompt turn | `session/prompt`, `session/update`, `session/cancel`, stop reasons | ✅ Implemented | Must | Keep parity with spec stop reasons. |
| Tool calls | Lifecycle + streaming + permission request | ✅ Implemented | Must | Ensure tool output content blocks are mapped. |
| Tool calls | Tool output as structured content blocks | ⚠️ Partial | Should | Map `tool_response` / `tool_error` blocks. |
| Content | Text, image, resource link | ✅ Implemented | Must | Verify resource URIs are preserved. |
| Content | `input_resource` (embedded) | ⚠️ Partial | Should | Needed for inline context. |
| Content | Audio blocks | ⚠️ Fallback | Optional | Implement only if audio upload matters. |
| Content | Annotations | ❌ Missing | Optional | Metadata only; low risk to defer. |
| File system | `fs/read_text_file`, `fs/write_text_file` | ❌ Missing | **Must** | Core to coding agent workflows. |
| Terminals | `terminal/create`/`output`/`wait_for_exit`/`kill`/`release` | ❌ Missing | **Must** | Enables command execution + logs. |
| Capabilities | Client capability declaration | ⚠️ Partial | **Must** | Advertise fs/terminal/content/modes. |
| Agent plan | Structured `plan` updates | ⚠️ Flattened | Should | Use `entries` with status/priority. |
| Session modes | Mode definition + `session/set_mode` + `current_mode_update` | ❌ Missing | Should | Optional per spec but valuable. |
| Slash commands | `available_commands_update` + UI | ❌ Missing | Optional | UX feature; not required for baseline. |

## Must-Haves (Protocol Correctness)
1. **Client capabilities**
   - Declare `fs.read_text_file`, `fs.write_text_file`, `terminal`, content types (text/image/resource/audio if supported), `modes`, `slash_commands` during initialization.
   - Reflect UI/setting toggles so agents can adapt.

2. **File system tools**
   - Implement `fs/read_text_file` and `fs/write_text_file` handlers with workspace boundary checks and path validation.
   - Surface permission prompts using existing permission flow.
   - Map responses to ACP `content_block` structure (text content for reads, empty response for writes).

3. **Terminal tools**
   - Implement `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, `terminal/release`.
   - Use PTY (`node-pty`) with output buffering + truncation logic that respects byte limits and UTF-8 boundaries.
   - Emit output via tool responses (no proprietary streaming format).

4. **Tool output content mapping**
   - Support `tool_response` and `tool_error` content blocks; ensure IDs line up with `tool_call_id`.
   - Preserve `is_error`, `text`, and `content` fields so agents can parse results.

## Should-Haves (High Value, Spec-Aligned)
1. **Structured agent plans**
   - Parse `plan` session updates into entries `{content, priority, status}` instead of flattening to reasoning text.
   - Minimal UI: list with status and priority badges; live replace on each plan update.

2. **Session modes**
   - Track available modes from session initialization.
   - Handle `session/set_mode` requests and `current_mode_update` notifications.
   - UI affordance can be basic (selector + current mode indicator); advanced gating is optional.

3. **Embedded resources**
   - Accept and render `input_resource` blocks (embedded content payload) in prompt turns.
   - Maintain `uri` + `mime_type`; avoid silently dropping large payloads—enforce limits and warn.

## Optional / UX-Only
- **Audio blocks**: Implement `input_audio` only if audio upload is a product goal; otherwise keep text fallback.
- **Annotations**: Pass through `annotations` on content blocks when present; do not block other work.
- **Slash commands**: Support `available_commands_update` plus minimal `/` autocomplete. Safe to defer.
- **UI polish**: Live terminal widgets inside tool calls, command palette modal, diff visualization. Non-protocol; optional.

## Removed / De-scoped
- Items not in ACP spec (e.g., bespoke diff tooling, "mode-specific UI" requirements) are out of scope for protocol compliance and can be treated as optional UX experiments.

## Recommended Order of Work
1. Capabilities: send accurate `clientCapabilities` during initialization.
2. File system: implement handlers + permission checks + workspace sandboxing.
3. Terminals: PTY manager, output buffering, kill/release handling.
4. Tool outputs: ensure structured `tool_response` / `tool_error` mapping.
5. Plans + embedded resources: structured plan updates; input_resource handling.
6. Session modes: mode tracking + set/update wiring.
7. Optional: audio, annotations, slash commands, UI polish.

## Testing Focus
- Unit: path validation + workspace guard; terminal lifecycle (create/output/wait/kill/release); plan parsing; mode state transitions.
- Integration: prompt → file read/write → tool output blocks; terminal command with incremental output; mode switch affecting tool access.
- E2E (as available): agent edits a file, runs a command, updates plan, and reflects mode changes without crashes.

## Security Notes
- Enforce workspace boundaries and normalize paths before fs operations.
- Clamp terminal output size and sanitize ANSI where rendered.
- Use existing permission prompts for fs/terminal; include "allow once/always" behavior if already supported.

---

# Technical Implementation Plan

## 1. Architecture Overview

### 1.1 Current Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DeepChat (Client)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────────────┐  │
│  │   AcpProvider   │───>│ AcpSessionManager│───>│   AcpProcessManager    │  │
│  │                 │    │                  │    │                        │  │
│  │ - coreStream()  │    │ - sessions[]     │    │ - handles[]            │  │
│  │ - permissions   │    │ - persistence    │    │ - spawn process        │  │
│  └────────┬────────┘    └────────┬─────────┘    │ - createClientProxy()  │  │
│           │                      │              └───────────┬────────────┘  │
│           │                      │                          │               │
│           v                      v                          v               │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────────────┐  │
│  │AcpContentMapper │    │AcpSessionPersist │    │   ClientSideConnection │  │
│  │                 │    │                  │    │    (SDK provided)      │  │
│  │ - map events    │    │ - SQLite storage │    └───────────┬────────────┘  │
│  └─────────────────┘    └──────────────────┘                │               │
│                                                             │ JSON-RPC      │
└─────────────────────────────────────────────────────────────│───────────────┘
                                                              │
                                                              v
                                          ┌───────────────────────────────────┐
                                          │         ACP Agent Process         │
                                          │  (claude-code-acp, kimi-cli, etc) │
                                          └───────────────────────────────────┘
```

### 1.2 Target Architecture (with new components)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                DeepChat (Client)                                 │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────┐    ┌──────────────────┐    ┌──────────────────────────────┐ │
│  │   AcpProvider   │───>│ AcpSessionManager│───>│      AcpProcessManager       │ │
│  │                 │    │                  │    │                              │ │
│  │ - coreStream()  │    │ + modeState      │    │ + createClientProxy() ──────>│─┼─┐
│  │ - permissions   │    │ + availableModes │    │   returns Client interface   │ │ │
│  │ + setMode()     │    │                  │    │                              │ │ │
│  └────────┬────────┘    └────────┬─────────┘    └──────────────────────────────┘ │ │
│           │                      │                                               │ │
│           v                      v              ┌──────────────────────────────┐ │ │
│  ┌─────────────────┐    ┌──────────────────┐    │      NEW: Client Impl        │ │ │
│  │AcpContentMapper │    │ + AcpModeManager │    ├──────────────────────────────┤ │ │
│  │                 │    │                  │    │  ┌────────────────────────┐  │<┘ │
│  │ + plan entries  │    │ - track modes    │    │  │    AcpFsHandler        │  │   │
│  │ + current_mode  │    │ - switch modes   │    │  │  - readTextFile()      │  │   │
│  └─────────────────┘    └──────────────────┘    │  │  - writeTextFile()     │  │   │
│                                                 │  │  - workspace guard     │  │   │
│                                                 │  └────────────────────────┘  │   │
│                                                 │  ┌────────────────────────┐  │   │
│                                                 │  │  AcpTerminalManager    │  │   │
│                                                 │  │  - createTerminal()    │  │   │
│                                                 │  │  - terminalOutput()    │  │   │
│                                                 │  │  - waitForExit()       │  │   │
│                                                 │  │  - kill / release      │  │   │
│                                                 │  │  - PTY management      │  │   │
│                                                 │  └────────────────────────┘  │   │
│                                                 │  ┌────────────────────────┐  │   │
│                                                 │  │  AcpCapabilities       │  │   │
│                                                 │  │  - fs flags            │  │   │
│                                                 │  │  - terminal flag       │  │   │
│                                                 │  │  - prompt types        │  │   │
│                                                 │  └────────────────────────┘  │   │
│                                                 └──────────────────────────────┘   │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              │ JSON-RPC over stdio
                                              v
                              ┌───────────────────────────────────┐
                              │         ACP Agent Process         │
                              │                                   │
                              │  Agent calls:                     │
                              │  - readTextFile(path)             │
                              │  - writeTextFile(path, content)   │
                              │  - createTerminal(cmd, args)      │
                              │  - terminalOutput(id)             │
                              │  - waitForTerminalExit(id)        │
                              │  - killTerminal(id)               │
                              │  - releaseTerminal(id)            │
                              └───────────────────────────────────┘
```

---

## 2. New File Structure

```
src/main/presenter/agentPresenter/acp/
├── acpProcessManager.ts      # MODIFY: update createClientProxy()
├── acpSessionManager.ts      # MODIFY: add mode tracking
├── acpContentMapper.ts       # MODIFY: structured plan, mode updates
├── acpCapabilities.ts        # NEW: capability constants
├── acpFsHandler.ts           # NEW: file system operations
├── acpTerminalManager.ts     # NEW: terminal lifecycle
└── acpModeManager.ts         # NEW: session mode state (optional)

src/shared/presenter/
└── acpTypes.ts               # MODIFY: add fs/terminal/mode types if needed
```

---

## 3. Detailed Component Design

### 3.1 AcpCapabilities (NEW)

**Purpose:** Centralize client capability flags for initialization.

```typescript
// src/main/presenter/agentPresenter/acp/acpCapabilities.ts

import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'

export interface AcpCapabilityOptions {
  enableFs?: boolean
  enableTerminal?: boolean
  enableModes?: boolean
  enableSlashCommands?: boolean
}

export function buildClientCapabilities(
  options: AcpCapabilityOptions = {}
): schema.ClientCapabilities {
  const caps: schema.ClientCapabilities = {
    prompt: {
      text: true,
      image: true,
      // audio: false, // enable when supported
      embeddedContext: true
    }
  }

  if (options.enableFs !== false) {
    caps.fs = {
      readTextFile: true,
      writeTextFile: true
    }
  }

  if (options.enableTerminal !== false) {
    caps.terminal = true
  }

  if (options.enableModes) {
    caps.modes = true
  }

  if (options.enableSlashCommands) {
    caps.slashCommands = true
  }

  return caps
}
```

### 3.2 AcpFsHandler (NEW)

**Purpose:** Handle `fs/read_text_file` and `fs/write_text_file` requests from agents.

```typescript
// src/main/presenter/agentPresenter/acp/acpFsHandler.ts

import * as fs from 'fs/promises'
import * as path from 'path'
import { RequestError } from '@agentclientprotocol/sdk'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'

export interface FsHandlerOptions {
  /** Session's working directory (workspace root). Null = allow all. */
  workspaceRoot: string | null
  /** Maximum file size in bytes to read (default: 10MB) */
  maxReadSize?: number
}

export class AcpFsHandler {
  private readonly workspaceRoot: string | null
  private readonly maxReadSize: number

  constructor(options: FsHandlerOptions) {
    this.workspaceRoot = options.workspaceRoot
      ? path.resolve(options.workspaceRoot)
      : null
    this.maxReadSize = options.maxReadSize ?? 10 * 1024 * 1024
  }

  /**
   * Validate that the path is within the workspace boundary.
   * Throws RequestError if path escapes workspace.
   */
  private validatePath(filePath: string): string {
    const resolved = path.resolve(filePath)

    if (this.workspaceRoot) {
      const relative = path.relative(this.workspaceRoot, resolved)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw RequestError.invalidParams(
          { path: filePath },
          `Path escapes workspace: ${filePath}`
        )
      }
    }

    return resolved
  }

  async readTextFile(
    params: schema.ReadTextFileRequest
  ): Promise<schema.ReadTextFileResponse> {
    const filePath = this.validatePath(params.path)

    try {
      const stat = await fs.stat(filePath)
      if (stat.size > this.maxReadSize) {
        throw RequestError.invalidParams(
          { path: params.path, size: stat.size },
          `File too large: ${stat.size} bytes exceeds limit`
        )
      }

      const content = await fs.readFile(filePath, 'utf-8')
      const lines = content.split('\n')

      // Handle optional line/limit parameters
      const startLine = params.line ?? 1
      const limit = params.limit ?? lines.length

      const startIndex = Math.max(0, startLine - 1)
      const endIndex = startIndex + limit
      const selectedLines = lines.slice(startIndex, endIndex)

      return { content: selectedLines.join('\n') }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw RequestError.resourceNotFound(params.path)
      }
      throw error
    }
  }

  async writeTextFile(
    params: schema.WriteTextFileRequest
  ): Promise<schema.WriteTextFileResponse> {
    const filePath = this.validatePath(params.path)

    // Ensure parent directory exists
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    await fs.writeFile(filePath, params.content, 'utf-8')
    return {}
  }
}
```

### 3.3 AcpTerminalManager (NEW)

**Purpose:** Manage PTY-based terminals for agent command execution.

```typescript
// src/main/presenter/agentPresenter/acp/acpTerminalManager.ts

import * as pty from 'node-pty'
import { nanoid } from 'nanoid'
import { RequestError } from '@agentclientprotocol/sdk'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'

interface TerminalState {
  id: string
  sessionId: string
  ptyProcess: pty.IPty
  outputBuffer: string
  maxOutputBytes: number
  truncated: boolean
  exitStatus: { exitCode: number; signal?: string } | null
  exitPromise: Promise<{ exitCode: number; signal?: string }>
  exitResolve: (status: { exitCode: number; signal?: string }) => void
  killed: boolean
  released: boolean
}

export class AcpTerminalManager {
  private readonly terminals = new Map<string, TerminalState>()
  private readonly defaultMaxOutputBytes = 1024 * 1024 // 1MB

  async createTerminal(
    params: schema.CreateTerminalRequest
  ): Promise<schema.CreateTerminalResponse> {
    const id = `term_${nanoid(12)}`
    const maxOutputBytes = params.maxOutputBytes ?? this.defaultMaxOutputBytes

    let exitResolve!: (status: { exitCode: number; signal?: string }) => void
    const exitPromise = new Promise<{ exitCode: number; signal?: string }>(
      (resolve) => { exitResolve = resolve }
    )

    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
    const shellArgs = process.platform === 'win32'
      ? ['-NoLogo', '-Command', params.command, ...(params.args ?? [])]
      : ['-c', [params.command, ...(params.args ?? [])].join(' ')]

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: params.cwd ?? process.cwd(),
      env: { ...process.env, ...params.env } as Record<string, string>
    })

    const state: TerminalState = {
      id,
      sessionId: params.sessionId,
      ptyProcess,
      outputBuffer: '',
      maxOutputBytes,
      truncated: false,
      exitStatus: null,
      exitPromise,
      exitResolve,
      killed: false,
      released: false
    }

    // Collect output
    ptyProcess.onData((data) => {
      if (state.released) return

      const currentBytes = Buffer.byteLength(state.outputBuffer, 'utf-8')
      const newBytes = Buffer.byteLength(data, 'utf-8')

      if (currentBytes + newBytes <= state.maxOutputBytes) {
        state.outputBuffer += data
      } else {
        // Truncate at UTF-8 boundary
        const remaining = state.maxOutputBytes - currentBytes
        if (remaining > 0) {
          state.outputBuffer += this.truncateAtCharBoundary(data, remaining)
        }
        state.truncated = true
      }
    })

    // Handle exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      state.exitStatus = { exitCode, signal: signal !== undefined ? String(signal) : undefined }
      exitResolve(state.exitStatus)
    })

    this.terminals.set(id, state)
    return { terminalId: id }
  }

  async terminalOutput(
    params: schema.TerminalOutputRequest
  ): Promise<schema.TerminalOutputResponse> {
    const state = this.getTerminal(params.terminalId)

    return {
      output: state.outputBuffer,
      truncated: state.truncated,
      exitStatus: state.exitStatus ?? undefined
    }
  }

  async waitForTerminalExit(
    params: schema.WaitForTerminalExitRequest
  ): Promise<schema.WaitForTerminalExitResponse> {
    const state = this.getTerminal(params.terminalId)
    const status = await state.exitPromise
    return status
  }

  async killTerminal(
    params: schema.KillTerminalCommandRequest
  ): Promise<schema.KillTerminalResponse> {
    const state = this.getTerminal(params.terminalId)

    if (!state.killed && !state.exitStatus) {
      state.ptyProcess.kill()
      state.killed = true
    }

    return {}
  }

  async releaseTerminal(
    params: schema.ReleaseTerminalRequest
  ): Promise<schema.ReleaseTerminalResponse> {
    const state = this.terminals.get(params.terminalId)
    if (!state) return {} // Already released, idempotent

    if (!state.killed && !state.exitStatus) {
      state.ptyProcess.kill()
    }

    state.released = true
    this.terminals.delete(params.terminalId)
    return {}
  }

  /** Clean up all terminals for a session */
  async releaseSessionTerminals(sessionId: string): Promise<void> {
    const toRelease = Array.from(this.terminals.values())
      .filter((t) => t.sessionId === sessionId)
      .map((t) => t.id)

    await Promise.all(
      toRelease.map((id) => this.releaseTerminal({ terminalId: id }))
    )
  }

  /** Shutdown all terminals */
  async shutdown(): Promise<void> {
    await Promise.all(
      Array.from(this.terminals.keys()).map((id) =>
        this.releaseTerminal({ terminalId: id })
      )
    )
  }

  private getTerminal(id: string): TerminalState {
    const state = this.terminals.get(id)
    if (!state) {
      throw RequestError.resourceNotFound(id)
    }
    return state
  }

  private truncateAtCharBoundary(str: string, maxBytes: number): string {
    const buf = Buffer.from(str, 'utf-8')
    if (buf.length <= maxBytes) return str

    // Find valid UTF-8 boundary
    let truncated = buf.slice(0, maxBytes)
    while (truncated.length > 0) {
      try {
        return truncated.toString('utf-8')
      } catch {
        truncated = truncated.slice(0, -1)
      }
    }
    return ''
  }
}
```

---

## 4. Integration Changes

### 4.1 Modify AcpProcessManager.createClientProxy()

**File:** `src/main/presenter/agentPresenter/acp/acpProcessManager.ts`

**Current:**
```typescript
private createClientProxy(): Client {
  return {
    requestPermission: async (params) => this.dispatchPermissionRequest(params),
    sessionUpdate: async (notification) => {
      this.dispatchSessionUpdate(notification)
    }
  }
}
```

**Target:**
```typescript
private createClientProxy(
  fsHandler: AcpFsHandler,
  terminalManager: AcpTerminalManager
): Client {
  return {
    // Existing
    requestPermission: async (params) => this.dispatchPermissionRequest(params),
    sessionUpdate: async (notification) => this.dispatchSessionUpdate(notification),

    // NEW: File system
    readTextFile: async (params) => fsHandler.readTextFile(params),
    writeTextFile: async (params) => fsHandler.writeTextFile(params),

    // NEW: Terminals
    createTerminal: async (params) => terminalManager.createTerminal(params),
    terminalOutput: async (params) => terminalManager.terminalOutput(params),
    waitForTerminalExit: async (params) => terminalManager.waitForTerminalExit(params),
    killTerminal: async (params) => terminalManager.killTerminal(params),
    releaseTerminal: async (params) => terminalManager.releaseTerminal(params)
  }
}
```

### 4.2 Update initialize() call with capabilities

**File:** `src/main/presenter/agentPresenter/acp/acpProcessManager.ts`

**Current:**
```typescript
const initPromise = connection.initialize({
  protocolVersion: PROTOCOL_VERSION,
  clientCapabilities: {},  // <-- Empty!
  clientInfo: { name: 'DeepChat', version: app.getVersion() }
})
```

**Target:**
```typescript
import { buildClientCapabilities } from './acpCapabilities'

const initPromise = connection.initialize({
  protocolVersion: PROTOCOL_VERSION,
  clientCapabilities: buildClientCapabilities({
    enableFs: true,
    enableTerminal: true,
    enableModes: true
  }),
  clientInfo: { name: 'DeepChat', version: app.getVersion() }
})
```

---

## 5. Sequence Diagrams

### 5.1 File Read Flow

```
┌──────────┐          ┌────────────────┐          ┌───────────────┐
│  Agent   │          │  DeepChat      │          │  File System  │
│          │          │  (AcpFsHandler)│          │               │
└────┬─────┘          └───────┬────────┘          └───────┬───────┘
     │                        │                           │
     │  fs/read_text_file     │                           │
     │  {path, line?, limit?} │                           │
     │───────────────────────>│                           │
     │                        │                           │
     │                        │  validatePath(path)       │
     │                        │  ─────────────────────>   │
     │                        │                           │
     │                        │  (check workspace bounds) │
     │                        │  <─────────────────────   │
     │                        │                           │
     │                        │  fs.readFile(path)        │
     │                        │──────────────────────────>│
     │                        │                           │
     │                        │  <file content>           │
     │                        │<──────────────────────────│
     │                        │                           │
     │                        │  slice lines if needed    │
     │                        │  ─────────────────────>   │
     │                        │                           │
     │  { content: string }   │                           │
     │<───────────────────────│                           │
     │                        │                           │
```

### 5.2 Terminal Execution Flow

```
┌──────────┐       ┌─────────────────────┐       ┌─────────┐
│  Agent   │       │AcpTerminalManager   │       │  PTY    │
└────┬─────┘       └──────────┬──────────┘       └────┬────┘
     │                        │                       │
     │  terminal/create       │                       │
     │  {cmd, args, cwd}      │                       │
     │───────────────────────>│                       │
     │                        │  pty.spawn(cmd)       │
     │                        │──────────────────────>│
     │                        │                       │
     │  { terminalId }        │  <pid>                │
     │<───────────────────────│<──────────────────────│
     │                        │                       │
     │                        │  onData(chunk)        │
     │                        │<──────────────────────│
     │                        │  buffer += chunk      │
     │                        │                       │
     │  terminal/output       │                       │
     │  { terminalId }        │                       │
     │───────────────────────>│                       │
     │                        │                       │
     │  { output, truncated,  │                       │
     │    exitStatus? }       │                       │
     │<───────────────────────│                       │
     │                        │                       │
     │                        │  onExit(code, signal) │
     │                        │<──────────────────────│
     │                        │                       │
     │  terminal/wait_for_exit│                       │
     │───────────────────────>│                       │
     │                        │                       │
     │  { exitCode, signal }  │                       │
     │<───────────────────────│                       │
     │                        │                       │
     │  terminal/release      │                       │
     │───────────────────────>│                       │
     │                        │  pty.kill()           │
     │                        │──────────────────────>│
     │                        │  cleanup state        │
     │  { }                   │                       │
     │<───────────────────────│                       │
```

### 5.3 Session Mode Switch Flow

```
┌────────────┐     ┌─────────────┐     ┌──────────────────┐     ┌──────────┐
│  Renderer  │     │ AcpProvider │     │ AcpSessionManager│     │  Agent   │
└─────┬──────┘     └──────┬──────┘     └────────┬─────────┘     └────┬─────┘
      │                   │                     │                    │
      │  setMode(modeId)  │                     │                    │
      │──────────────────>│                     │                    │
      │                   │                     │                    │
      │                   │  session/set_mode   │                    │
      │                   │  { sessionId, modeId }                   │
      │                   │─────────────────────────────────────────>│
      │                   │                     │                    │
      │                   │                     │    (agent updates  │
      │                   │                     │     internal mode) │
      │                   │                     │                    │
      │                   │  { }                │                    │
      │                   │<─────────────────────────────────────────│
      │                   │                     │                    │
      │                   │  updateModeState    │                    │
      │                   │────────────────────>│                    │
      │                   │                     │                    │
      │  modeChanged event│                     │                    │
      │<──────────────────│                     │                    │
      │                   │                     │                    │
```

### 5.4 Agent-Initiated Mode Change

```
┌──────────┐     ┌─────────────────────┐     ┌─────────────┐     ┌────────────┐
│  Agent   │     │ AcpProcessManager   │     │ AcpProvider │     │  Renderer  │
└────┬─────┘     └──────────┬──────────┘     └──────┬──────┘     └─────┬──────┘
     │                      │                       │                  │
     │  session/update      │                       │                  │
     │  { sessionUpdate:    │                       │                  │
     │    "current_mode_update",                    │                  │
     │    modeId }          │                       │                  │
     │─────────────────────>│                       │                  │
     │                      │                       │                  │
     │                      │  dispatchSessionUpdate│                  │
     │                      │──────────────────────>│                  │
     │                      │                       │                  │
     │                      │                       │  map to event    │
     │                      │                       │  ─────────────>  │
     │                      │                       │                  │
     │                      │                       │  modeChanged     │
     │                      │                       │  event           │
     │                      │                       │─────────────────>│
     │                      │                       │                  │
     │                      │                       │                  │  Update
     │                      │                       │                  │  mode UI
```

---

## 6. Content Mapper Updates

### 6.1 Structured Plan Parsing

**Current behavior:** Plan entries flattened to text.

**Target behavior:** Emit structured plan data.

```typescript
// In acpContentMapper.ts

private handlePlanUpdate(
  update: Extract<schema.SessionNotification['update'], { sessionUpdate: 'plan' }>,
  payload: MappedContent
) {
  const entries = update.entries ?? []

  // Emit structured plan event (new event type)
  payload.events.push({
    type: 'plan',
    entries: entries.map((e) => ({
      content: e.content,
      priority: e.priority,
      status: e.status
    }))
  })

  // Also emit as reasoning for backwards compatibility
  if (entries.length > 0) {
    const summary = entries.map((e) => `[${e.status}] ${e.content}`).join('\n')
    payload.events.push(createStreamEvent.reasoning(`Plan:\n${summary}`))
  }
}
```

### 6.2 Mode Update Handling

```typescript
// Add to switch in map()

case 'current_mode_update':
  this.handleModeUpdate(update, payload)
  break

// New method
private handleModeUpdate(
  update: Extract<schema.SessionNotification['update'], { sessionUpdate: 'current_mode_update' }>,
  payload: MappedContent
) {
  payload.events.push({
    type: 'mode_change',
    modeId: update.modeId
  })
}
```

---

## 7. UI Components (Renderer)

### 7.1 Plan Display Component

```
┌────────────────────────────────────────────────────────────┐
│ Agent Plan                                         [─][×] │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ● Analyze project structure                    [done]     │
│  ◐ Implement file handler                       [in progress]
│  ○ Add unit tests                               [pending]  │
│  ○ Update documentation                         [pending]  │
│                                                            │
│  Progress: ████████░░░░░░░░ 25%                           │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 7.2 Mode Selector

```
┌──────────────────────────────────────────────────────────────────────┐
│ Chat Input Area                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ [Mode: Code ▼]  Type your message...                    [Send] │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│        │                                                             │
│        └─> ┌────────────────────┐                                    │
│            │ ○ Ask              │                                    │
│            │ ● Code             │ <-- current                        │
│            │ ○ Architect        │                                    │
│            └────────────────────┘                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 7.3 Terminal Output in Tool Call

```
┌────────────────────────────────────────────────────────────────┐
│ 🔧 Tool: execute_command                           [running]   │
├────────────────────────────────────────────────────────────────┤
│ Command: npm test                                              │
├────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ $ npm test                                                 │ │
│ │                                                            │ │
│ │ > deepchat@0.5.1 test                                      │ │
│ │ > vitest run                                               │ │
│ │                                                            │ │
│ │ ✓ acpFsHandler.test.ts (3 tests) 45ms                      │ │
│ │ ✓ acpTerminalManager.test.ts (5 tests) 120ms               │ │
│ │                                                            │ │
│ │ Test Files  2 passed (2)                                   │ │
│ │ Tests       8 passed (8)                                   │ │
│ │                                                            │ │
│ │ Process exited with code 0                                 │ │
│ └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

---

## 8. Error Handling Strategy

| Error Scenario | Response | User Feedback |
|----------------|----------|---------------|
| Path escapes workspace | `RequestError.invalidParams` | "File access denied: path outside workspace" |
| File not found | `RequestError.resourceNotFound` | "File not found: {path}" |
| File too large | `RequestError.invalidParams` | "File too large ({size} bytes)" |
| Terminal not found | `RequestError.resourceNotFound` | "Terminal {id} not found" |
| Terminal already released | Return `{}` (idempotent) | None |
| Write permission denied | OS error passthrough | "Permission denied: {path}" |
| PTY spawn failed | Error with details | "Failed to start terminal: {reason}" |

---

## 9. Testing Strategy

### 9.1 Unit Tests

```typescript
// test/main/presenter/llmProviderPresenter/acpFsHandler.test.ts

describe('AcpFsHandler', () => {
  describe('validatePath', () => {
    it('allows paths within workspace')
    it('rejects paths escaping workspace with ..')
    it('rejects absolute paths outside workspace')
    it('allows any path when workspaceRoot is null')
  })

  describe('readTextFile', () => {
    it('reads entire file when no line/limit specified')
    it('respects line offset (1-based)')
    it('respects limit parameter')
    it('throws resourceNotFound for missing files')
    it('throws invalidParams for files exceeding maxReadSize')
  })

  describe('writeTextFile', () => {
    it('writes content to new file')
    it('overwrites existing file')
    it('creates parent directories if missing')
    it('validates path before writing')
  })
})
```

```typescript
// test/main/presenter/llmProviderPresenter/acpTerminalManager.test.ts

describe('AcpTerminalManager', () => {
  describe('createTerminal', () => {
    it('spawns PTY process and returns terminalId')
    it('uses provided cwd and env')
    it('buffers output up to maxOutputBytes')
    it('sets truncated flag when exceeding limit')
  })

  describe('terminalOutput', () => {
    it('returns current buffer without blocking')
    it('includes exitStatus when process has exited')
    it('throws for unknown terminalId')
  })

  describe('waitForTerminalExit', () => {
    it('blocks until process exits')
    it('returns exitCode and signal')
  })

  describe('killTerminal', () => {
    it('kills running process')
    it('is idempotent for already-killed terminals')
  })

  describe('releaseTerminal', () => {
    it('kills process if still running')
    it('removes terminal from manager')
    it('is idempotent for already-released terminals')
  })
})
```

### 9.2 Integration Tests

```typescript
describe('ACP Integration', () => {
  it('agent reads file, modifies content, writes back', async () => {
    // 1. Start agent process
    // 2. Create session
    // 3. Send prompt requesting file modification
    // 4. Verify agent calls readTextFile
    // 5. Verify agent calls writeTextFile
    // 6. Verify file was modified correctly
  })

  it('agent runs terminal command and observes output', async () => {
    // 1. Send prompt requesting command execution
    // 2. Verify createTerminal called
    // 3. Verify terminalOutput returns expected data
    // 4. Verify waitForTerminalExit returns exit code
    // 5. Verify releaseTerminal cleans up
  })

  it('session mode switch affects agent behavior', async () => {
    // 1. Create session, note initial mode
    // 2. Call setSessionMode
    // 3. Verify agent acknowledges mode change
    // 4. Verify subsequent behavior reflects new mode
  })
})
```

---

## 10. Migration / Rollout Plan

### Phase 1: Foundation (Week 1-2)
1. Implement `AcpCapabilities` module
2. Update `initialize()` to send proper capabilities
3. Implement `AcpFsHandler` with tests
4. Wire `readTextFile`/`writeTextFile` into `createClientProxy()`
5. Test with claude-code-acp agent

### Phase 2: Terminal Support (Week 2-3)
1. Implement `AcpTerminalManager` with tests
2. Wire terminal methods into `createClientProxy()`
3. Test with agents that use terminal commands
4. Add terminal output display in tool call UI

### Phase 3: Session Features (Week 3-4)
1. Update `AcpContentMapper` for structured plans
2. Add plan display UI component
3. Implement mode tracking in session manager
4. Wire `setSessionMode` through provider
5. Add mode selector UI

### Phase 4: Polish (Week 4+)
1. Slash command support (optional)
2. Audio content handling (optional)
3. Improve error messages and user feedback
4. Performance optimization (output buffering, etc.)

---

## 11. Open Questions

1. **Workspace Resolution:** Should workspace root come from session's `cwd`, or should there be a separate config? Current plan: use session's workdir.

2. **Permission Integration:** Should fs/terminal operations go through the existing permission flow, or trust the agent's own permission checks? Current plan: trust agent (it already requested permission before calling these).

3. **Terminal Output Streaming:** Should we stream terminal output to the UI in real-time, or only show on-demand? Current plan: buffer in manager, show in tool call block.

4. **Mode Persistence:** Should the current mode be persisted per conversation? Current plan: start with agent's default mode each session.

5. **Capability Toggles:** Should users be able to disable fs/terminal capabilities in settings? Current plan: enable all by default, consider settings later.
