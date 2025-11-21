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

export interface AcpProcessHandle extends AgentProcessHandle {
  child: ChildProcessWithoutNullStreams
  connection: ClientSideConnectionType
  agent: AcpAgentConfig
  readyAt: number
}

interface AcpProcessManagerOptions {
  providerId: string
  getUseBuiltinRuntime: () => Promise<boolean>
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
  private readonly handles = new Map<string, AcpProcessHandle>()
  private readonly pendingHandles = new Map<string, Promise<AcpProcessHandle>>()
  private readonly sessionListeners = new Map<string, SessionListenerEntry>()
  private readonly permissionResolvers = new Map<string, PermissionResolverEntry>()
  private bunRuntimePath: string | null = null
  private nodeRuntimePath: string | null = null
  private uvRuntimePath: string | null = null
  private runtimesInitialized: boolean = false

  constructor(options: AcpProcessManagerOptions) {
    this.providerId = options.providerId
    this.getUseBuiltinRuntime = options.getUseBuiltinRuntime
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

  private setupRuntimes(): void {
    if (this.runtimesInitialized) {
      return
    }

    const runtimeBasePath = path
      .join(app.getAppPath(), 'runtime')
      .replace('app.asar', 'app.asar.unpacked')

    // Check if bun runtime file exists
    const bunRuntimePath = path.join(runtimeBasePath, 'bun')
    if (process.platform === 'win32') {
      const bunExe = path.join(bunRuntimePath, 'bun.exe')
      if (fs.existsSync(bunExe)) {
        this.bunRuntimePath = bunRuntimePath
      } else {
        this.bunRuntimePath = null
      }
    } else {
      const bunBin = path.join(bunRuntimePath, 'bun')
      if (fs.existsSync(bunBin)) {
        this.bunRuntimePath = bunRuntimePath
      } else {
        this.bunRuntimePath = null
      }
    }

    // Check if node runtime file exists
    const nodeRuntimePath = path.join(runtimeBasePath, 'node')
    if (process.platform === 'win32') {
      const nodeExe = path.join(nodeRuntimePath, 'node.exe')
      if (fs.existsSync(nodeExe)) {
        this.nodeRuntimePath = nodeRuntimePath
      } else {
        this.nodeRuntimePath = null
      }
    } else {
      const nodeBin = path.join(nodeRuntimePath, 'bin', 'node')
      if (fs.existsSync(nodeBin)) {
        this.nodeRuntimePath = nodeRuntimePath
      } else {
        this.nodeRuntimePath = null
      }
    }

    // Check if uv runtime file exists
    const uvRuntimePath = path.join(runtimeBasePath, 'uv')
    if (process.platform === 'win32') {
      const uvExe = path.join(uvRuntimePath, 'uv.exe')
      const uvxExe = path.join(uvRuntimePath, 'uvx.exe')
      if (fs.existsSync(uvExe) && fs.existsSync(uvxExe)) {
        this.uvRuntimePath = uvRuntimePath
      } else {
        this.uvRuntimePath = null
      }
    } else {
      const uvBin = path.join(uvRuntimePath, 'uv')
      const uvxBin = path.join(uvRuntimePath, 'uvx')
      if (fs.existsSync(uvBin) && fs.existsSync(uvxBin)) {
        this.uvRuntimePath = uvRuntimePath
      } else {
        this.uvRuntimePath = null
      }
    }

    this.runtimesInitialized = true
  }

  private replaceWithRuntimeCommand(command: string, useBuiltinRuntime: boolean): string {
    // If useBuiltinRuntime is false, return original command
    if (!useBuiltinRuntime) {
      return command
    }

    // Get command basename (remove path)
    const basename = path.basename(command)

    // Choose corresponding runtime path based on command type
    if (process.platform === 'win32') {
      // Windows platform only replaces Node.js related commands, let system handle bun commands automatically
      if (this.nodeRuntimePath) {
        if (basename === 'node') {
          const nodeExe = path.join(this.nodeRuntimePath, 'node.exe')
          if (fs.existsSync(nodeExe)) {
            return nodeExe
          }
          // If doesn't exist, return original command to let system find it via PATH
          return command
        } else if (basename === 'npm') {
          // Windows usually has npm as .cmd file
          const npmCmd = path.join(this.nodeRuntimePath, 'npm.cmd')
          if (fs.existsSync(npmCmd)) {
            return npmCmd
          }
          // Check if npm exists without .cmd extension
          const npmPath = path.join(this.nodeRuntimePath, 'npm')
          if (fs.existsSync(npmPath)) {
            return npmPath
          }
          // If doesn't exist, return original command to let system find it via PATH
          return command
        } else if (basename === 'npx') {
          // On Windows, npx is typically a .cmd file
          const npxCmd = path.join(this.nodeRuntimePath, 'npx.cmd')
          if (fs.existsSync(npxCmd)) {
            return npxCmd
          }
          // Check if npx exists without .cmd extension
          const npxPath = path.join(this.nodeRuntimePath, 'npx')
          if (fs.existsSync(npxPath)) {
            return npxPath
          }
          // If doesn't exist, return original command to let system find it via PATH
          return command
        }
      }
    } else {
      // Non-Windows platforms handle all commands
      if (['node', 'npm', 'npx', 'bun'].includes(basename)) {
        // Prefer Bun if available, otherwise use Node.js
        if (this.bunRuntimePath) {
          // For node/npm/npx, uniformly replace with bun
          const bunPath = path.join(this.bunRuntimePath, 'bun')
          if (fs.existsSync(bunPath)) {
            return bunPath
          }
          // If doesn't exist, return original command to let system find it via PATH
          return command
        } else if (this.nodeRuntimePath) {
          // Use Node.js runtime
          let targetCommand: string
          if (basename === 'node') {
            targetCommand = 'node'
          } else if (basename === 'npm') {
            targetCommand = 'npm'
          } else if (basename === 'npx') {
            targetCommand = 'npx'
          } else if (basename === 'bun') {
            targetCommand = 'node' // Map bun command to node
          } else {
            targetCommand = basename
          }
          const nodePath = path.join(this.nodeRuntimePath, 'bin', targetCommand)
          if (fs.existsSync(nodePath)) {
            return nodePath
          }
          // If doesn't exist, return original command to let system find it via PATH
          return command
        }
      }
    }

    // UV command handling (all platforms)
    if (['uv', 'uvx'].includes(basename)) {
      if (!this.uvRuntimePath) {
        return command
      }

      // Both uv and uvx use their corresponding commands
      const targetCommand = basename === 'uvx' ? 'uvx' : 'uv'

      if (process.platform === 'win32') {
        const uvPath = path.join(this.uvRuntimePath, `${targetCommand}.exe`)
        if (fs.existsSync(uvPath)) {
          return uvPath
        }
        // If doesn't exist, return original command to let system find it via PATH
        return command
      } else {
        const uvPath = path.join(this.uvRuntimePath, targetCommand)
        if (fs.existsSync(uvPath)) {
          return uvPath
        }
        // If doesn't exist, return original command to let system find it via PATH
        return command
      }
    }

    return command
  }

  private normalizePathEnv(paths: string[]): { key: string; value: string } {
    const isWindows = process.platform === 'win32'
    const separator = isWindows ? ';' : ':'
    const pathKey = isWindows ? 'Path' : 'PATH'
    const pathValue = paths.filter(Boolean).join(separator)
    return { key: pathKey, value: pathValue }
  }

  private getDefaultPaths(homeDir: string): string[] {
    if (process.platform === 'darwin') {
      return [
        '/bin',
        '/usr/bin',
        '/usr/local/bin',
        '/usr/local/sbin',
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/opt/node/bin',
        '/opt/local/bin',
        `${homeDir}/.cargo/bin`
      ]
    } else if (process.platform === 'linux') {
      return ['/bin', '/usr/bin', '/usr/local/bin', `${homeDir}/.cargo/bin`]
    } else {
      // Windows
      return [`${homeDir}\\.cargo\\bin`, `${homeDir}\\.local\\bin`]
    }
  }

  private async spawnAgentProcess(agent: AcpAgentConfig): Promise<ChildProcessWithoutNullStreams> {
    // Initialize runtime paths if not already done
    this.setupRuntimes()

    // Get useBuiltinRuntime configuration
    const useBuiltinRuntime = await this.getUseBuiltinRuntime()

    // Validate command
    if (!agent.command || agent.command.trim().length === 0) {
      throw new Error(`[ACP] Invalid command for agent ${agent.id}: command is empty`)
    }

    // Replace command with runtime version if needed
    const processedCommand = this.replaceWithRuntimeCommand(agent.command, useBuiltinRuntime)

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

    // Keep args as-is, do not replace them
    const processedArgs = agent.args ?? []

    // Determine if it's Node.js/Bun/UV related command
    const isNodeCommand = ['node', 'npm', 'npx', 'bun', 'uv', 'uvx'].some(
      (cmd) =>
        processedCommand.includes(cmd) ||
        processedArgs.some((arg) => typeof arg === 'string' && arg.includes(cmd))
    )

    // Define allowed environment variables whitelist for Node.js/Bun/UV commands
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
      'NPM_CONFIG_TMP'
    ]

    const HOME_DIR = app.getPath('home')
    const env: Record<string, string> = {}
    let pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
    let pathValue = ''

    if (isNodeCommand) {
      // Node.js/Bun/UV commands use whitelist processing
      if (process.env) {
        const existingPaths: string[] = []

        // Collect all PATH-related values
        Object.entries(process.env).forEach(([key, value]) => {
          if (value !== undefined) {
            if (['PATH', 'Path', 'path'].includes(key)) {
              existingPaths.push(value)
            } else if (allowedEnvVars.includes(key) && !['PATH', 'Path', 'path'].includes(key)) {
              env[key] = value
            }
          }
        })

        // Get default paths
        const defaultPaths = this.getDefaultPaths(HOME_DIR)

        // Merge all paths
        const allPaths = [...existingPaths, ...defaultPaths]
        // Add runtime paths
        if (process.platform === 'win32') {
          // Windows platform only adds node and uv paths
          if (this.uvRuntimePath) {
            allPaths.unshift(this.uvRuntimePath)
            console.info(`[ACP] Added UV runtime path to PATH: ${this.uvRuntimePath}`)
          }
          if (this.nodeRuntimePath) {
            allPaths.unshift(this.nodeRuntimePath)
            console.info(`[ACP] Added Node runtime path to PATH: ${this.nodeRuntimePath}`)
          }
        } else {
          // Other platforms priority: bun > node > uv
          if (this.uvRuntimePath) {
            allPaths.unshift(this.uvRuntimePath)
            console.info(`[ACP] Added UV runtime path to PATH: ${this.uvRuntimePath}`)
          }
          if (this.nodeRuntimePath) {
            const nodeBinPath = path.join(this.nodeRuntimePath, 'bin')
            allPaths.unshift(nodeBinPath)
            console.info(`[ACP] Added Node bin path to PATH: ${nodeBinPath}`)
          }
          if (this.bunRuntimePath) {
            allPaths.unshift(this.bunRuntimePath)
            console.info(`[ACP] Added Bun runtime path to PATH: ${this.bunRuntimePath}`)
          }
        }

        // Normalize and set PATH
        const normalized = this.normalizePathEnv(allPaths)
        pathKey = normalized.key
        pathValue = normalized.value
        env[pathKey] = pathValue
      }
    } else {
      // Non Node.js/Bun/UV commands, preserve all system environment variables, only supplement PATH
      Object.entries(process.env).forEach(([key, value]) => {
        if (value !== undefined) {
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
      const defaultPaths = this.getDefaultPaths(HOME_DIR)

      // Merge all paths
      const allPaths = [...existingPaths, ...defaultPaths]
      // Add runtime paths
      if (process.platform === 'win32') {
        // Windows platform only adds node and uv paths
        if (this.uvRuntimePath) {
          allPaths.unshift(this.uvRuntimePath)
          console.info(`[ACP] Added UV runtime path to PATH: ${this.uvRuntimePath}`)
        }
        if (this.nodeRuntimePath) {
          allPaths.unshift(this.nodeRuntimePath)
          console.info(`[ACP] Added Node runtime path to PATH: ${this.nodeRuntimePath}`)
        }
      } else {
        // Other platforms priority: bun > node > uv
        if (this.uvRuntimePath) {
          allPaths.unshift(this.uvRuntimePath)
          console.info(`[ACP] Added UV runtime path to PATH: ${this.uvRuntimePath}`)
        }
        if (this.nodeRuntimePath) {
          const nodeBinPath = path.join(this.nodeRuntimePath, 'bin')
          allPaths.unshift(nodeBinPath)
          console.info(`[ACP] Added Node bin path to PATH: ${nodeBinPath}`)
        }
        if (this.bunRuntimePath) {
          allPaths.unshift(this.bunRuntimePath)
          console.info(`[ACP] Added Bun runtime path to PATH: ${this.bunRuntimePath}`)
        }
      }

      // Normalize and set PATH
      const normalized = this.normalizePathEnv(allPaths)
      pathKey = normalized.key
      pathValue = normalized.value
      env[pathKey] = pathValue
    }

    // Add custom environment variables
    if (agent.env) {
      Object.entries(agent.env).forEach(([key, value]) => {
        if (value !== undefined) {
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
