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
import { eventBus, SendTarget } from '@/eventbus'
import { ACP_WORKSPACE_EVENTS } from '@/events'

export interface AcpProcessHandle extends AgentProcessHandle {
  child: ChildProcessWithoutNullStreams
  connection: ClientSideConnectionType
  agent: AcpAgentConfig
  readyAt: number
  state: 'warmup' | 'bound'
  boundConversationId?: string
  /** The working directory this process was spawned with */
  workdir: string
  availableModes?: Array<{ id: string; name: string; description: string }>
  currentModeId?: string
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
  private readonly boundHandles = new Map<string, AcpProcessHandle>()
  private readonly pendingHandles = new Map<string, Promise<AcpProcessHandle>>()
  private readonly sessionListeners = new Map<string, SessionListenerEntry>()
  private readonly permissionResolvers = new Map<string, PermissionResolverEntry>()
  private readonly runtimeHelper = RuntimeHelper.getInstance()
  private readonly terminalManager = new AcpTerminalManager()
  private readonly sessionWorkdirs = new Map<string, string>()
  private readonly fsHandlers = new Map<string, AcpFsHandler>()
  private readonly agentLocks = new Map<string, Promise<void>>()
  private readonly preferredModes = new Map<string, string>()
  private shuttingDown = false

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
      // Fallback: restrict to a temporary workspace instead of unrestricted access
      const fallbackWorkdir = this.getFallbackWorkdir()
      console.warn(
        `[ACP] No fs handler registered for session ${sessionId}, using fallback workdir: ${fallbackWorkdir}`
      )
      const fallbackHandler = new AcpFsHandler({ workspaceRoot: fallbackWorkdir })
      this.fsHandlers.set(sessionId, fallbackHandler)
      return fallbackHandler
    }
    return handler
  }

  /**
   * Provide a fallback workspace for sessions that haven't registered a workdir.
   * Keeps file access constrained to a temp directory rather than the entire filesystem.
   */
  private getFallbackWorkdir(): string {
    const tempDir = path.join(app.getPath('temp'), 'deepchat-acp', 'sessions')
    try {
      fs.mkdirSync(tempDir, { recursive: true })
    } catch (error) {
      console.warn('[ACP] Failed to create fallback workdir, defaulting to system temp:', error)
      return app.getPath('temp')
    }
    return tempDir
  }

  /**
   * Get or create a connection for the given agent.
   * If workdir is provided and differs from the existing process's workdir,
   * the existing process will be released and a new one spawned with the new workdir.
   */
  async getConnection(agent: AcpAgentConfig, workdir?: string): Promise<AcpProcessHandle> {
    return await this.warmupProcess(agent, workdir)
  }

  /**
   * Resolve workdir to an absolute path, using fallback if not provided.
   */
  private resolveWorkdir(workdir?: string): string {
    if (workdir && workdir.trim()) {
      return workdir.trim()
    }
    return this.getFallbackWorkdir()
  }

  /**
   * Build a stable key for warmup handles scoped by agent and workdir.
   */
  private getWarmupKey(agentId: string, workdir: string): string {
    return `${agentId}::${workdir}`
  }

  /**
   * Warm up a process for the given agent/workdir without binding it to a conversation.
   * Reuses an existing warmup handle when possible; never reuses bound handles.
   */
  async warmupProcess(agent: AcpAgentConfig, workdir?: string): Promise<AcpProcessHandle> {
    if (this.shuttingDown) {
      throw new Error('[ACP] Process manager is shutting down, refusing to spawn new process')
    }
    const resolvedWorkdir = this.resolveWorkdir(workdir)
    const warmupKey = this.getWarmupKey(agent.id, resolvedWorkdir)
    const preferredModeId = this.preferredModes.get(warmupKey)
    const releaseLock = await this.acquireAgentLock(agent.id)

    try {
      const warmupCount = this.getHandlesByAgent(agent.id).filter((handle) =>
        this.isHandleAlive(handle)
      ).length
      console.info(
        `[ACP] Warmup requested for agent ${agent.id} (workdir=${resolvedWorkdir}, warmups=${warmupCount})`
      )
      const reusable = this.findReusableHandle(agent.id, resolvedWorkdir)
      if (reusable && this.isHandleAlive(reusable)) {
        console.info(
          `[ACP] Reusing warmup process for agent ${agent.id} (pid=${reusable.pid}, workdir=${resolvedWorkdir})`
        )
        this.applyPreferredMode(reusable, preferredModeId)
        return reusable
      }

      const inflight = this.pendingHandles.get(warmupKey)
      if (inflight) {
        const inflightHandle = await inflight
        if (
          this.isHandleAlive(inflightHandle) &&
          inflightHandle.workdir === resolvedWorkdir &&
          inflightHandle.state === 'warmup'
        ) {
          console.info(
            `[ACP] Awaiting inflight warmup for agent ${agent.id} (pid=${inflightHandle.pid}, workdir=${resolvedWorkdir})`
          )
          this.applyPreferredMode(inflightHandle, preferredModeId)
          return inflightHandle
        }
        if (inflightHandle.state === 'warmup') {
          console.info(
            `[ACP] Discarding inflight warmup for agent ${agent.id} (workdir "${inflightHandle.workdir}") in favor of "${resolvedWorkdir}"`
          )
          await this.disposeHandle(inflightHandle)
        }
      } else {
        console.info(
          `[ACP] No inflight handle for agent ${agent.id} (workdir=${resolvedWorkdir}), spawning new warmup`
        )
      }

      const handlePromise = this.spawnProcess(agent, resolvedWorkdir)
      this.pendingHandles.set(warmupKey, handlePromise)

      try {
        const handle = await handlePromise
        handle.state = 'warmup'
        handle.boundConversationId = undefined
        handle.workdir = resolvedWorkdir
        this.handles.set(warmupKey, handle)
        void this.fetchProcessModes(handle).catch((error) => {
          console.warn(`[ACP] Failed to fetch modes during warmup for agent ${agent.id}:`, error)
        })
        this.applyPreferredMode(handle, preferredModeId)
        console.info(
          `[ACP] Warmup process ready for agent ${agent.id} (pid=${handle.pid}, workdir=${resolvedWorkdir})`
        )
        return handle
      } finally {
        this.pendingHandles.delete(warmupKey)
      }
    } finally {
      releaseLock()
    }
  }

  /**
   * Update preferred mode for future warmup processes and sessions.
   * The mode will be applied when a warmup process is created or when a session is created.
   */
  async setPreferredMode(agent: AcpAgentConfig, workdir: string, modeId: string): Promise<void> {
    const resolvedWorkdir = this.resolveWorkdir(workdir)
    const warmupKey = this.getWarmupKey(agent.id, resolvedWorkdir)
    this.preferredModes.set(warmupKey, modeId)

    // Apply to existing warmup handle if available
    const existingWarmup = this.findReusableHandle(agent.id, resolvedWorkdir)
    if (existingWarmup && this.isHandleAlive(existingWarmup)) {
      existingWarmup.currentModeId = modeId
      this.notifyModesReady(existingWarmup)
    }
  }

  getProcess(agentId: string): AcpProcessHandle | null {
    const warmupHandle = Array.from(this.handles.values()).find(
      (handle) => handle.agentId === agentId
    )
    if (warmupHandle) return warmupHandle

    for (const handle of this.boundHandles.values()) {
      if (handle.agentId === agentId) return handle
    }

    return null
  }

  listProcesses(): AcpProcessHandle[] {
    const seen = new Set<AcpProcessHandle>()
    const processes: AcpProcessHandle[] = []

    for (const handle of this.handles.values()) {
      if (!seen.has(handle)) {
        processes.push(handle)
        seen.add(handle)
      }
    }

    for (const handle of this.boundHandles.values()) {
      if (!seen.has(handle)) {
        processes.push(handle)
        seen.add(handle)
      }
    }

    return processes
  }

  async release(agentId: string): Promise<void> {
    const targets = this.getHandlesByAgent(agentId)
    if (!targets.length) return

    const releaseLock = await this.acquireAgentLock(agentId)
    try {
      await Promise.allSettled(targets.map((handle) => this.disposeHandle(handle)))
      this.clearSessionsForAgent(agentId)
    } finally {
      releaseLock()
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    // Kill eagerly so subprocesses don't survive app shutdown even if async cleanup is skipped
    this.forceKillAllProcesses('shutdown')
    const allAgents = new Set<string>()
    for (const handle of this.handles.values()) {
      allAgents.add(handle.agentId)
    }
    for (const handle of this.boundHandles.values()) {
      allAgents.add(handle.agentId)
    }
    const releases = Array.from(allAgents.values()).map((agentId) => this.release(agentId))
    await Promise.allSettled(releases)
    await this.terminalManager.shutdown()
    this.handles.clear()
    this.boundHandles.clear()
    this.sessionListeners.clear()
    this.permissionResolvers.clear()
    this.pendingHandles.clear()
    this.sessionWorkdirs.clear()
    this.fsHandlers.clear()
  }

  bindProcess(agentId: string, conversationId: string, workdir?: string): void {
    const resolvedWorkdir = this.resolveWorkdir(workdir)
    // Prefer warmup handle matching requested workdir if provided
    const warmupHandles = Array.from(this.handles.entries()).filter(
      ([, handle]) =>
        handle.agentId === agentId &&
        handle.state === 'warmup' &&
        (!workdir || !handle.workdir || handle.workdir === resolvedWorkdir)
    )
    const handle =
      warmupHandles.find(([, candidate]) => candidate.workdir === resolvedWorkdir)?.[1] ??
      warmupHandles[0]?.[1]
    if (!handle) {
      console.warn(`[ACP] No warmup handle to bind for agent ${agentId}`)
      return
    }
    if (handle.state !== 'warmup') {
      console.warn(
        `[ACP] Cannot bind handle in state "${handle.state}" for agent ${agentId}, expected warmup`
      )
      return
    }
    if (!this.isHandleAlive(handle)) {
      console.warn(`[ACP] Cannot bind dead handle for agent ${agentId}`)
      void this.disposeHandle(handle)
      return
    }

    handle.state = 'bound'
    handle.boundConversationId = conversationId
    // Remove from warmup map
    for (const [key, value] of this.handles.entries()) {
      if (value === handle) {
        this.handles.delete(key)
        break
      }
    }
    this.boundHandles.set(conversationId, handle)

    // Immediately notify renderer if modes are already known
    this.notifyModesReady(handle, conversationId)
    console.info(
      `[ACP] Bound process for agent ${agentId} to conversation ${conversationId} (pid=${handle.pid}, workdir=${handle.workdir})`
    )
  }

  async unbindProcess(agentId: string, conversationId: string): Promise<void> {
    const releaseLock = await this.acquireAgentLock(agentId)
    try {
      const handle = this.boundHandles.get(conversationId)
      if (!handle || handle.agentId !== agentId) return

      await this.disposeHandle(handle)
    } finally {
      releaseLock()
    }
  }

  getProcessModes(
    agentId: string,
    workdir?: string
  ):
    | {
        availableModes?: Array<{ id: string; name: string; description: string }>
        currentModeId?: string
      }
    | undefined {
    const resolvedWorkdir = this.resolveWorkdir(workdir)
    const candidates = this.getHandlesByAgent(agentId).filter(
      (handle) => handle.workdir === resolvedWorkdir && this.isHandleAlive(handle)
    )
    const handle = candidates[0]
    if (!handle) return undefined

    return {
      availableModes: handle.availableModes,
      currentModeId: handle.currentModeId
    }
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

  private async spawnProcess(agent: AcpAgentConfig, workdir: string): Promise<AcpProcessHandle> {
    const child = await this.spawnAgentProcess(agent, workdir)
    const stream = this.createAgentStream(child)
    const client = this.createClientProxy()
    const connection = new ClientSideConnection(() => client, stream)
    const handleSeed: Partial<AcpProcessHandle> = {}

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

      const initResult = await Promise.race([initPromise, timeoutPromise])
      console.info(`[ACP] Connection initialization completed successfully for agent ${agent.id}`)

      // Log Agent capabilities from initialization
      const resultData = initResult as unknown as {
        sessionId?: string
        models?: {
          availableModels?: Array<{ modelId: string }>
          currentModelId?: string
        }
        modes?: {
          availableModes?: Array<{ id: string }>
          currentModeId?: string
        }
      }

      if (resultData.sessionId) {
        console.info(`[ACP] Session ID: ${resultData.sessionId}`)
      }
      if (resultData.models) {
        console.info(`[ACP] Available models: ${resultData.models.availableModels?.length ?? 0}`)
        console.info(`[ACP] Current model: ${resultData.models.currentModelId}`)
      }
      const initAvailableModes = resultData.modes?.availableModes?.map(
        (m: { id: string; name?: string; description?: string }) => ({
          id: m.id,
          name: m.name ?? m.id,
          description: m.description ?? ''
        })
      )
      if (initAvailableModes) {
        console.info(
          `[ACP] Available modes: ${JSON.stringify(initAvailableModes.map((m) => m.id) ?? [])}`
        )
        console.info(`[ACP] Current mode: ${resultData.modes?.currentModeId}`)
      }
      handleSeed.availableModes = initAvailableModes
      handleSeed.currentModeId = resultData.modes?.currentModeId
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
      restarts: this.getRestartCount(agent.id) + 1,
      lastHeartbeatAt: Date.now(),
      metadata: { command: agent.command },
      child,
      connection,
      readyAt: Date.now(),
      state: 'warmup',
      boundConversationId: undefined,
      workdir,
      availableModes: handleSeed.availableModes,
      currentModeId: handleSeed.currentModeId
    }

    child.on('exit', (code, signal) => {
      console.warn(
        `[ACP] Agent process for ${agent.id} exited (PID: ${child.pid}, code=${code ?? 'null'}, signal=${signal ?? 'null'})`
      )
      this.removeHandleReferences(handle)
      this.clearSessionsForAgent(agent.id)
    })

    // child.stdout?.on('data', (chunk: Buffer) => {
    //   const output = chunk.toString().trim()
    //   if (output) {
    //     console.info(`[ACP] ${agent.id} stdout: ${output}`)
    //   }
    // })

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

  private async spawnAgentProcess(
    agent: AcpAgentConfig,
    workdir: string
  ): Promise<ChildProcessWithoutNullStreams> {
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

    // Use the provided workdir as cwd if it exists, otherwise fall back to home directory
    let cwd = workdir
    if (!fs.existsSync(workdir)) {
      console.warn(
        `[ACP] Workdir "${workdir}" does not exist for agent ${agent.id}, using HOME_DIR`
      )
      cwd = HOME_DIR
    }
    console.info(`[ACP] Using workdir as cwd for agent ${agent.id}: ${cwd}`)

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

  private async fetchProcessModes(handle: AcpProcessHandle): Promise<void> {
    if (!this.isHandleAlive(handle)) return
    try {
      const response = await handle.connection.newSession({
        cwd: handle.workdir,
        mcpServers: []
      })
      if (response.sessionId) {
        this.registerSessionWorkdir(response.sessionId, handle.workdir)
      }

      const modes = response.modes
      if (modes?.availableModes?.length) {
        handle.availableModes = modes.availableModes.map((mode) => ({
          id: mode.id,
          name: mode.name ?? mode.id,
          description: mode.description ?? ''
        }))
        // Preserve user-selected preferred mode if it exists in the available list
        if (
          handle.currentModeId &&
          handle.availableModes.some((m) => m.id === handle.currentModeId)
        ) {
          // keep preferred
        } else if (modes.currentModeId) {
          handle.currentModeId = modes.currentModeId
        } else {
          handle.currentModeId = handle.availableModes[0]?.id ?? handle.currentModeId
        }
        this.notifyModesReady(handle)
      }

      if (response.sessionId) {
        try {
          await handle.connection.cancel({ sessionId: response.sessionId })
          this.clearSession(response.sessionId)
        } catch (cancelError) {
          console.warn(
            `[ACP] Failed to cancel warmup session ${response.sessionId} for agent ${handle.agentId}:`,
            cancelError
          )
        }
      }
    } catch (error) {
      console.warn(`[ACP] Warmup session failed to fetch modes for agent ${handle.agentId}:`, error)
    }
  }

  private notifyModesReady(handle: AcpProcessHandle, conversationId?: string): void {
    if (!handle.availableModes || handle.availableModes.length === 0) return

    eventBus.sendToRenderer(ACP_WORKSPACE_EVENTS.SESSION_MODES_READY, SendTarget.ALL_WINDOWS, {
      conversationId: conversationId ?? handle.boundConversationId,
      agentId: handle.agentId,
      workdir: handle.workdir,
      current: handle.currentModeId ?? 'default',
      available: handle.availableModes
    })
  }

  private getHandlesByAgent(agentId: string): AcpProcessHandle[] {
    const handles: AcpProcessHandle[] = []
    for (const handle of this.handles.values()) {
      if (handle.agentId === agentId && !handles.includes(handle)) {
        handles.push(handle)
      }
    }
    for (const handle of this.boundHandles.values()) {
      if (handle.agentId === agentId && !handles.includes(handle)) {
        handles.push(handle)
      }
    }
    return handles
  }

  private getRestartCount(agentId: string): number {
    return this.getHandlesByAgent(agentId).reduce(
      (max, handle) => Math.max(max, handle.restarts ?? 0),
      0
    )
  }

  private removeHandleReferences(handle: AcpProcessHandle): void {
    for (const [key, warmupHandle] of this.handles.entries()) {
      if (warmupHandle === handle) {
        this.handles.delete(key)
      }
    }

    for (const [conversationId, boundHandle] of this.boundHandles.entries()) {
      if (boundHandle === handle) {
        this.boundHandles.delete(conversationId)
      }
    }
  }

  private async disposeHandle(handle: AcpProcessHandle): Promise<void> {
    this.removeHandleReferences(handle)
    this.killChild(handle.child, 'dispose')
  }

  private findReusableHandle(agentId: string, workdir: string): AcpProcessHandle | undefined {
    const candidates = this.getHandlesByAgent(agentId).filter(
      (handle) =>
        handle.workdir === workdir && handle.state === 'warmup' && this.isHandleAlive(handle)
    )
    return candidates[0]
  }

  private applyPreferredMode(handle: AcpProcessHandle, preferredModeId?: string): void {
    if (!preferredModeId) return
    handle.currentModeId = preferredModeId
    this.notifyModesReady(handle)
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

    for (const [conversationId, handle] of this.boundHandles.entries()) {
      if (handle.agentId === agentId) {
        this.boundHandles.delete(conversationId)
      }
    }
  }

  private forceKillAllProcesses(reason: string): void {
    const handles = this.listProcesses()
    handles.forEach((handle) => this.killChild(handle.child, reason))
  }

  private killChild(child: ChildProcessWithoutNullStreams, reason?: string): void {
    const pid = child.pid
    if (pid) {
      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/PID', `${pid}`, '/T', '/F'], { stdio: 'ignore' })
        } catch (error) {
          console.warn(`[ACP] Failed to taskkill process ${pid} (${reason ?? 'unknown'}):`, error)
        }
      } else {
        try {
          spawn('pkill', ['-TERM', '-P', `${pid}`], { stdio: 'ignore' })
        } catch (error) {
          console.warn(`[ACP] Failed to pkill children for process ${pid}:`, error)
        }
        try {
          process.kill(pid, 'SIGTERM')
        } catch (error) {
          console.warn(`[ACP] Failed to SIGTERM process ${pid}:`, error)
        }
      }
    }

    if (!child.killed) {
      try {
        child.kill()
      } catch (error) {
        console.warn(
          `[ACP] Failed to kill agent process${pid ? ` ${pid}` : ''} (${reason ?? 'unknown'}):`,
          error
        )
      }
    }
  }

  private async acquireAgentLock(agentId: string): Promise<() => void> {
    const previousLock = this.agentLocks.get(agentId) ?? Promise.resolve()

    let releaseResolver: (() => void) | undefined
    const currentLock = new Promise<void>((resolve) => {
      releaseResolver = resolve
    })

    this.agentLocks.set(agentId, currentLock)
    await previousLock

    return () => {
      releaseResolver?.()
      if (this.agentLocks.get(agentId) === currentLock) {
        this.agentLocks.delete(agentId)
      }
    }
  }

  private isHandleAlive(handle: AcpProcessHandle): boolean {
    return (
      !handle.child.killed && handle.child.exitCode === null && handle.child.signalCode === null
    )
  }
}
