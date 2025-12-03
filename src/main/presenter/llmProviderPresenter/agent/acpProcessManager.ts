import spawn from 'cross-spawn'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { Readable, Writable } from 'node:stream'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk'
import type {
  ClientSideConnection as ClientSideConnectionType,
  Client
} from '@agentclientprotocol/sdk'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'
import type { Stream } from '@agentclientprotocol/sdk/dist/stream.js'
import type { AcpAgentConfig } from '@shared/presenter'
import type { AgentProcessHandle, AgentProcessManager } from './types'
import { getShellEnvironment } from './shellEnvHelper'
import { RuntimeHelper } from '@/lib/runtimeHelper'
import { buildClientCapabilities } from './acpCapabilities'
import { AcpFsHandler } from './acpFsHandler'
import { AcpTerminalManager } from './acpTerminalManager'

export interface AcpProcessHandle extends AgentProcessHandle {
  child: ChildProcessWithoutNullStreams
  connection: ClientSideConnectionType
  agent: AcpAgentConfig
  readyAt: number
}

interface AcpProcessManagerOptions {
  providerId: string
  getUseBuiltinRuntime: () => Promise<boolean>
  getNpmRegistry?: () => Promise<string | null>
  getUvRegistry?: () => Promise<string | null>
}

export type SessionNotificationHandler = (notification: schema.SessionNotification) => void

export type PermissionResolver = (
  request: schema.RequestPermissionRequest
) => Promise<schema.RequestPermissionResponse>

interface SessionListenerEntry {
  agentId: string
  handlers: Set<SessionNotificationHandler>
}

/**
 * Check if running in Electron environment.
 * Reference: @modelcontextprotocol/sdk/client/stdio.js
 */
function isElectron(): boolean {
  return 'type' in process
}

interface PermissionResolverEntry {
  agentId: string
  resolver: PermissionResolver
}

export class AcpProcessManager implements AgentProcessManager<AcpProcessHandle, AcpAgentConfig> {
  private readonly providerId: string
  private readonly getUseBuiltinRuntime: () => Promise<boolean>
  private readonly getNpmRegistry?: () => Promise<string | null>
  private readonly getUvRegistry?: () => Promise<string | null>
  private readonly handles = new Map<string, AcpProcessHandle>()
  private readonly pendingHandles = new Map<string, Promise<AcpProcessHandle>>()
  private readonly sessionListeners = new Map<string, SessionListenerEntry>()
  private readonly permissionResolvers = new Map<string, PermissionResolverEntry>()
  private readonly runtimeHelper = RuntimeHelper.getInstance()
  private readonly terminalManager = new AcpTerminalManager()
  private readonly sessionWorkdirs = new Map<string, string>()
  private readonly fsHandlers = new Map<string, AcpFsHandler>()

  constructor(options: AcpProcessManagerOptions) {
    this.providerId = options.providerId
    this.getUseBuiltinRuntime = options.getUseBuiltinRuntime
    this.getNpmRegistry = options.getNpmRegistry
    this.getUvRegistry = options.getUvRegistry
  }

  /**
   * Register a session's working directory for file system operations.
   * This must be called when a session is created, before any fs/terminal operations.
   */
  registerSessionWorkdir(sessionId: string, workdir: string): void {
    this.sessionWorkdirs.set(sessionId, workdir)
    // Create fs handler for this session
    this.fsHandlers.set(sessionId, new AcpFsHandler({ workspaceRoot: workdir }))
  }

  /**
   * Get the fs handler for a session.
   */
  private getFsHandler(sessionId: string): AcpFsHandler {
    const handler = this.fsHandlers.get(sessionId)
    if (!handler) {
      // Fallback: create handler with no workspace restriction
      console.warn(
        `[ACP] No fs handler registered for session ${sessionId}, using unrestricted handler`
      )
      return new AcpFsHandler({ workspaceRoot: null })
    }
    return handler
  }

  async getConnection(agent: AcpAgentConfig): Promise<AcpProcessHandle> {
    const existing = this.handles.get(agent.id)
    if (existing && this.isHandleAlive(existing)) {
      return existing
    }

    const inflight = this.pendingHandles.get(agent.id)
    if (inflight) {
      return inflight
    }

    const handlePromise = this.spawnProcess(agent)
    this.pendingHandles.set(agent.id, handlePromise)
    try {
      const handle = await handlePromise
      this.handles.set(agent.id, handle)
      return handle
    } finally {
      this.pendingHandles.delete(agent.id)
    }
  }

  getProcess(agentId: string): AcpProcessHandle | null {
    return this.handles.get(agentId) ?? null
  }

  listProcesses(): AcpProcessHandle[] {
    return Array.from(this.handles.values())
  }

  async release(agentId: string): Promise<void> {
    const handle = this.handles.get(agentId)
    if (!handle) return

    this.handles.delete(agentId)
    this.clearSessionsForAgent(agentId)

    this.killChild(handle.child)
  }

  async shutdown(): Promise<void> {
    const releases = Array.from(this.handles.keys()).map((agentId) => this.release(agentId))
    await Promise.allSettled(releases)
    await this.terminalManager.shutdown()
    this.handles.clear()
    this.sessionListeners.clear()
    this.permissionResolvers.clear()
    this.pendingHandles.clear()
    this.sessionWorkdirs.clear()
    this.fsHandlers.clear()
  }

  registerSessionListener(
    agentId: string,
    sessionId: string,
    handler: SessionNotificationHandler
  ): () => void {
    const entry = this.sessionListeners.get(sessionId)
    if (entry) {
      entry.handlers.add(handler)
    } else {
      this.sessionListeners.set(sessionId, { agentId, handlers: new Set([handler]) })
    }

    return () => {
      const existingEntry = this.sessionListeners.get(sessionId)
      if (!existingEntry) return
      existingEntry.handlers.delete(handler)
      if (existingEntry.handlers.size === 0) {
        this.sessionListeners.delete(sessionId)
      }
    }
  }

  registerPermissionResolver(
    agentId: string,
    sessionId: string,
    resolver: PermissionResolver
  ): () => void {
    if (this.permissionResolvers.has(sessionId)) {
      console.warn(
        `[ACP] Overwriting existing permission resolver for session "${sessionId}" (agent ${agentId})`
      )
    }
    this.permissionResolvers.set(sessionId, { agentId, resolver })

    return () => {
      const entry = this.permissionResolvers.get(sessionId)
      if (entry && entry.resolver === resolver) {
        this.permissionResolvers.delete(sessionId)
      }
    }
  }

  clearSession(sessionId: string): void {
    this.sessionListeners.delete(sessionId)
    this.permissionResolvers.delete(sessionId)
    this.sessionWorkdirs.delete(sessionId)
    this.fsHandlers.delete(sessionId)
    // Clean up terminals for this session
    void this.terminalManager.releaseSessionTerminals(sessionId)
  }

  private async spawnProcess(agent: AcpAgentConfig): Promise<AcpProcessHandle> {
    const child = await this.spawnAgentProcess(agent)
    const stream = this.createAgentStream(child)
    const client = this.createClientProxy()
    const connection = new ClientSideConnection(() => client, stream)

    // Add process health check before initialization
    if (child.killed) {
      throw new Error(
        `[ACP] Agent process ${agent.id} exited before initialization (PID: ${child.pid})`
      )
    }

    // Initialize connection with timeout and error handling
    console.info(`[ACP] Starting connection initialization for agent ${agent.id}`)
    const timeoutMs = 60 * 1000 * 5 // 5 minutes timeout for initialization

    try {
      const initPromise = connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: buildClientCapabilities({
          enableFs: true,
          enableTerminal: true
        }),
        clientInfo: { name: 'DeepChat', version: app.getVersion() }
      })

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `[ACP] Connection initialization timeout after ${timeoutMs}ms for agent ${agent.id}`
            )
          )
        }, timeoutMs)
      })

      await Promise.race([initPromise, timeoutPromise])
      console.info(`[ACP] Connection initialization completed successfully for agent ${agent.id}`)
    } catch (error) {
      console.error(`[ACP] Connection initialization failed for agent ${agent.id}:`, error)

      // Clean up the child process if initialization failed
      if (!child.killed) {
        try {
          child.kill()
          console.info(`[ACP] Killed process for failed agent ${agent.id} (PID: ${child.pid})`)
        } catch (killError) {
          console.warn(`[ACP] Failed to kill process for agent ${agent.id}:`, killError)
        }
      }

      throw error
    }

    const handle: AcpProcessHandle = {
      providerId: this.providerId,
      agentId: agent.id,
      agent,
      status: 'ready',
      pid: child.pid ?? undefined,
      restarts: (this.handles.get(agent.id)?.restarts ?? 0) + 1,
      lastHeartbeatAt: Date.now(),
      metadata: { command: agent.command },
      child,
      connection,
      readyAt: Date.now()
    }

    child.on('exit', (code, signal) => {
      console.warn(
        `[ACP] Agent process for ${agent.id} exited (PID: ${child.pid}, code=${code ?? 'null'}, signal=${signal ?? 'null'})`
      )
      if (this.handles.get(agent.id)?.child === child) {
        this.handles.delete(agent.id)
      }
      this.clearSessionsForAgent(agent.id)
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      const output = chunk.toString().trim()
      if (output) {
        console.info(`[ACP] ${agent.id} stdout: ${output}`)
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const error = chunk.toString().trim()
      if (error) {
        console.error(`[ACP] ${agent.id} stderr: ${error}`)
      }
    })

    // Add additional process monitoring
    child.on('error', (error) => {
      console.error(`[ACP] Agent process ${agent.id} encountered error:`, error)
    })

    console.info(`[ACP] Process monitoring set up for agent ${agent.id} (PID: ${child.pid})`)

    return handle
  }

  private async spawnAgentProcess(agent: AcpAgentConfig): Promise<ChildProcessWithoutNullStreams> {
    // Initialize runtime paths if not already done
    this.runtimeHelper.initializeRuntimes()

    // Get useBuiltinRuntime configuration
    const useBuiltinRuntime = await this.getUseBuiltinRuntime()

    // Validate command
    if (!agent.command || agent.command.trim().length === 0) {
      throw new Error(`[ACP] Invalid command for agent ${agent.id}: command is empty`)
    }

    // Handle path expansion (including ~ and environment variables)
    let expandedCommand = this.runtimeHelper.expandPath(agent.command)
    let expandedArgs = (agent.args ?? []).map((arg) =>
      typeof arg === 'string' ? this.runtimeHelper.expandPath(arg) : arg
    )

    // Replace command with runtime version if needed
    const processedCommand = this.runtimeHelper.replaceWithRuntimeCommand(
      expandedCommand,
      useBuiltinRuntime,
      true
    )

    // Validate processed command
    if (!processedCommand || processedCommand.trim().length === 0) {
      throw new Error(
        `[ACP] Invalid processed command for agent ${agent.id}: "${agent.command}" -> empty`
      )
    }

    // Log command processing for debugging
    console.info(`[ACP] Spawning process for agent ${agent.id}:`, {
      originalCommand: agent.command,
      processedCommand,
      args: agent.args ?? []
    })

    if (processedCommand !== agent.command) {
      console.info(
        `[ACP] Command replaced for agent ${agent.id}: "${agent.command}" -> "${processedCommand}"`
      )
    }

    // Use expanded args
    const processedArgs = expandedArgs

    const HOME_DIR = app.getPath('home')
    const env: Record<string, string> = {}
    Object.entries(process.env).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        env[key] = value
      }
    })
    let pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
    let pathValue = ''

    // Collect existing PATH values
    const existingPaths: string[] = []
    const pathKeys = ['PATH', 'Path', 'path']
    pathKeys.forEach((key) => {
      const value = env[key]
      if (value) {
        existingPaths.push(value)
      }
    })

    // Get shell environment variables for ALL commands (not just Node.js commands)
    // This ensures commands like kimi-cli can find their dependencies in Release builds
    let shellEnv: Record<string, string> = {}
    try {
      shellEnv = await getShellEnvironment()
      console.info(`[ACP] Retrieved shell environment variables for agent ${agent.id}`)
      Object.entries(shellEnv).forEach(([key, value]) => {
        if (value !== undefined && value !== '' && !pathKeys.includes(key)) {
          env[key] = value
        }
      })
    } catch (error) {
      console.warn(
        `[ACP] Failed to get shell environment variables for agent ${agent.id}, using fallback:`,
        error
      )
    }

    // Get shell PATH if available (priority: shell PATH > existing PATH)
    const shellPath = shellEnv.PATH || shellEnv.Path || shellEnv.path
    if (shellPath) {
      const shellPaths = shellPath.split(process.platform === 'win32' ? ';' : ':')
      existingPaths.unshift(...shellPaths)
      console.info(`[ACP] Using shell PATH for agent ${agent.id} (length: ${shellPath.length})`)
    }

    // Get default paths
    const defaultPaths = this.runtimeHelper.getDefaultPaths(HOME_DIR)

    // Merge all paths (priority: shell PATH > existing PATH > default paths)
    const allPaths = [...existingPaths, ...defaultPaths]

    // Add runtime paths only when using builtin runtime
    if (useBuiltinRuntime) {
      const uvRuntimePath = this.runtimeHelper.getUvRuntimePath()
      const nodeRuntimePath = this.runtimeHelper.getNodeRuntimePath()
      if (process.platform === 'win32') {
        // Windows platform only adds node and uv paths
        if (uvRuntimePath) {
          allPaths.unshift(uvRuntimePath)
          console.info(`[ACP] Added UV runtime path to PATH: ${uvRuntimePath}`)
        }
        if (nodeRuntimePath) {
          allPaths.unshift(nodeRuntimePath)
          console.info(`[ACP] Added Node runtime path to PATH: ${nodeRuntimePath}`)
        }
      } else {
        // Other platforms priority: node > uv
        if (uvRuntimePath) {
          allPaths.unshift(uvRuntimePath)
          console.info(`[ACP] Added UV runtime path to PATH: ${uvRuntimePath}`)
        }
        if (nodeRuntimePath) {
          const nodeBinPath = path.join(nodeRuntimePath, 'bin')
          allPaths.unshift(nodeBinPath)
          console.info(`[ACP] Added Node bin path to PATH: ${nodeBinPath}`)
        }
      }
    }

    // Normalize and set PATH
    const normalized = this.runtimeHelper.normalizePathEnv(allPaths)
    pathKey = normalized.key
    pathValue = normalized.value
    env[pathKey] = pathValue

    // Add custom environment variables
    if (agent.env) {
      Object.entries(agent.env).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          // If it's a PATH-related variable, merge into main PATH
          if (['PATH', 'Path', 'path'].includes(key)) {
            const currentPathKey = process.platform === 'win32' ? 'Path' : 'PATH'
            const separator = process.platform === 'win32' ? ';' : ':'
            env[currentPathKey] = env[currentPathKey]
              ? `${value}${separator}${env[currentPathKey]}`
              : value
          } else {
            env[key] = value
          }
        }
      })
    }

    // Add registry environment variables when using builtin runtime
    if (useBuiltinRuntime) {
      if (this.getNpmRegistry) {
        const npmRegistry = await this.getNpmRegistry()
        if (npmRegistry && npmRegistry !== '') {
          env.npm_config_registry = npmRegistry
        }
      }

      if (this.getUvRegistry) {
        const uvRegistry = await this.getUvRegistry()
        if (uvRegistry && uvRegistry !== '') {
          env.UV_DEFAULT_INDEX = uvRegistry
          env.PIP_INDEX_URL = uvRegistry
        }
      }
    }

    const mergedEnv = env

    console.info(`[ACP] Environment variables for agent ${agent.id}:`, {
      pathKey,
      pathValue,
      hasCustomEnv: !!agent.env,
      customEnvKeys: agent.env ? Object.keys(agent.env) : []
    })

    // Create isolated temp directory for each agent process to avoid conflicts
    // when multiple instances of the same agent (e.g., kimi-cli) are running
    const tempBase = app.getPath('temp')
    const agentTempDir = path.join(tempBase, 'deepchat-acp', agent.id)
    try {
      fs.mkdirSync(agentTempDir, { recursive: true })
    } catch (error) {
      console.warn(`[ACP] Failed to create temp directory for agent ${agent.id}:`, error)
    }
    const cwd = fs.existsSync(agentTempDir) ? agentTempDir : HOME_DIR

    console.info(`[ACP] Spawning process with options:`, {
      command: processedCommand,
      args: processedArgs,
      cwd,
      platform: process.platform
    })

    const child = spawn(processedCommand, processedArgs, {
      env: mergedEnv,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: process.platform === 'win32' && isElectron()
    }) as ChildProcessWithoutNullStreams

    console.info(`[ACP] Process spawned successfully for agent ${agent.id}, PID: ${child.pid}`)

    return child
  }

  private createAgentStream(child: ChildProcessWithoutNullStreams): Stream {
    // Add error handler for stdin to prevent EPIPE errors when process exits
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      // EPIPE errors occur when trying to write to a closed pipe (process already exited)
      // This is expected behavior and should be silently handled
      if (error.code !== 'EPIPE') {
        console.error('[ACP] write error:', error)
      }
    })

    const writable = Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>
    const readable = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>
    return ndJsonStream(writable, readable)
  }

  private createClientProxy(): Client {
    return {
      requestPermission: async (params) => this.dispatchPermissionRequest(params),
      sessionUpdate: async (notification) => {
        this.dispatchSessionUpdate(notification)
      },
      // File system operations
      readTextFile: async (params) => {
        const handler = this.getFsHandler(params.sessionId)
        return handler.readTextFile(params)
      },
      writeTextFile: async (params) => {
        const handler = this.getFsHandler(params.sessionId)
        return handler.writeTextFile(params)
      },
      // Terminal operations
      createTerminal: async (params) => {
        return this.terminalManager.createTerminal(params)
      },
      terminalOutput: async (params) => {
        return this.terminalManager.terminalOutput(params)
      },
      waitForTerminalExit: async (params) => {
        return this.terminalManager.waitForTerminalExit(params)
      },
      killTerminal: async (params) => {
        return this.terminalManager.killTerminal(params)
      },
      releaseTerminal: async (params) => {
        return this.terminalManager.releaseTerminal(params)
      }
    }
  }

  private dispatchSessionUpdate(notification: schema.SessionNotification): void {
    const entry = this.sessionListeners.get(notification.sessionId)
    if (!entry) {
      console.warn(`[ACP] Received session update for unknown session "${notification.sessionId}"`)
      return
    }

    entry.handlers.forEach((handler) => {
      try {
        handler(notification)
      } catch (error) {
        console.warn(`[ACP] Session handler threw for session ${notification.sessionId}:`, error)
      }
    })
  }

  private async dispatchPermissionRequest(
    params: schema.RequestPermissionRequest
  ): Promise<schema.RequestPermissionResponse> {
    const entry = this.permissionResolvers.get(params.sessionId)
    if (!entry) {
      console.warn(
        `[ACP] Missing permission resolver for session "${params.sessionId}", returning cancelled`
      )
      return { outcome: { outcome: 'cancelled' } }
    }

    try {
      return await entry.resolver(params)
    } catch (error) {
      console.error('[ACP] Permission resolver failed:', error)
      return { outcome: { outcome: 'cancelled' } }
    }
  }

  private clearSessionsForAgent(agentId: string): void {
    for (const [sessionId, entry] of this.sessionListeners.entries()) {
      if (entry.agentId === agentId) {
        this.sessionListeners.delete(sessionId)
      }
    }

    for (const [sessionId, entry] of this.permissionResolvers.entries()) {
      if (entry.agentId === agentId) {
        this.permissionResolvers.delete(sessionId)
      }
    }
  }

  private killChild(child: ChildProcessWithoutNullStreams): void {
    if (!child.killed) {
      try {
        child.kill()
      } catch (error) {
        console.warn('[ACP] Failed to kill agent process:', error)
      }
    }
  }

  private isHandleAlive(handle: AcpProcessHandle): boolean {
    return !handle.child.killed && !handle.connection.signal.aborted
  }
}
