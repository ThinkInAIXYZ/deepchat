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

  constructor(options: AcpProcessManagerOptions) {
    this.providerId = options.providerId
    this.getUseBuiltinRuntime = options.getUseBuiltinRuntime
    this.getNpmRegistry = options.getNpmRegistry
    this.getUvRegistry = options.getUvRegistry
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
    this.handles.clear()
    this.sessionListeners.clear()
    this.permissionResolvers.clear()
    this.pendingHandles.clear()
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
  }

  private async spawnProcess(agent: AcpAgentConfig): Promise<AcpProcessHandle> {
    const child = await this.spawnAgentProcess(agent)
    const stream = this.createAgentStream(child)
    const client = this.createClientProxy()
    const connection = new ClientSideConnection(() => client, stream)

    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: 'DeepChat', version: app.getVersion() }
    })

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
        `[ACP] Agent process for ${agent.id} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
      )
      if (this.handles.get(agent.id)?.child === child) {
        this.handles.delete(agent.id)
      }
      this.clearSessionsForAgent(agent.id)
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      console.warn(`[ACP] ${agent.id} stderr: ${chunk.toString()}`)
    })

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

    // Determine if it's Node.js/UV related command
    const isNodeCommand = ['node', 'npm', 'npx', 'uv', 'uvx'].some(
      (cmd) =>
        processedCommand.includes(cmd) ||
        processedArgs.some((arg) => typeof arg === 'string' && arg.includes(cmd))
    )

    // Define allowed environment variables whitelist for Node.js/UV commands
    const allowedEnvVars = [
      'PATH',
      'path',
      'Path',
      'npm_config_registry',
      'npm_config_cache',
      'npm_config_prefix',
      'npm_config_tmp',
      'NPM_CONFIG_REGISTRY',
      'NPM_CONFIG_CACHE',
      'NPM_CONFIG_PREFIX',
      'NPM_CONFIG_TMP',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_MODEL',
      'OPENAI_BASE_URL',
      'OPENAI_API_KEY'
    ]

    const HOME_DIR = app.getPath('home')
    const env: Record<string, string> = {}
    let pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
    let pathValue = ''

    if (isNodeCommand) {
      // Node.js/UV commands use whitelist processing
      if (process.env) {
        const existingPaths: string[] = []

        // Collect all PATH-related values
        Object.entries(process.env).forEach(([key, value]) => {
          if (value !== undefined && value !== '') {
            if (['PATH', 'Path', 'path'].includes(key)) {
              existingPaths.push(value)
            } else if (allowedEnvVars.includes(key) && !['PATH', 'Path', 'path'].includes(key)) {
              env[key] = value
            }
          }
        })

        // Get shell environment variables when not using builtin runtime
        // This ensures nvm/n/fnm/volta paths are available
        let shellEnv: Record<string, string> = {}
        if (!useBuiltinRuntime) {
          try {
            shellEnv = await getShellEnvironment()
            console.info(`[ACP] Retrieved shell environment variables for agent ${agent.id}`)

            // Merge shell environment variables (except PATH which we handle separately)
            Object.entries(shellEnv).forEach(([key, value]) => {
              if (!['PATH', 'Path', 'path'].includes(key) && value) {
                env[key] = value
              }
            })
          } catch (error) {
            console.warn(
              `[ACP] Failed to get shell environment variables for agent ${agent.id}, using fallback:`,
              error
            )
          }
        }

        // Get shell PATH if available (priority: shell PATH > existing PATH)
        const shellPath = shellEnv.PATH || shellEnv.Path
        if (shellPath) {
          // Use shell PATH as base, then merge existing paths
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
      }
    } else {
      // Non Node.js/UV commands, preserve all system environment variables, only supplement PATH
      Object.entries(process.env).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          env[key] = value
        }
      })

      // Supplement PATH
      const existingPaths: string[] = []
      if (env.PATH) {
        existingPaths.push(env.PATH)
      }
      if (env.Path) {
        existingPaths.push(env.Path)
      }

      // Get default paths
      const defaultPaths = this.runtimeHelper.getDefaultPaths(HOME_DIR)

      // Merge all paths
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
    }

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

    // Determine working directory (default to current working directory)
    let cwd = process.cwd()
    // Validate cwd exists
    if (!fs.existsSync(cwd)) {
      console.warn(`[ACP] Working directory does not exist: ${cwd}, using fallback`)
      cwd = process.platform === 'win32' ? 'C:\\' : '/'
    }

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
