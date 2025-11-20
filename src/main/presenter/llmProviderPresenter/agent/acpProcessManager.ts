import { spawn, type ChildProcessWithoutNullStreams, execSync } from 'child_process'
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
}

export type SessionNotificationHandler = (notification: schema.SessionNotification) => void

export type PermissionResolver = (
  request: schema.RequestPermissionRequest
) => Promise<schema.RequestPermissionResponse>

interface SessionListenerEntry {
  agentId: string
  handlers: Set<SessionNotificationHandler>
}

interface PermissionResolverEntry {
  agentId: string
  resolver: PermissionResolver
}

export class AcpProcessManager implements AgentProcessManager<AcpProcessHandle, AcpAgentConfig> {
  private readonly providerId: string
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
    const child = this.spawnAgentProcess(agent)
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

  private isCommandAvailable(command: string): boolean {
    try {
      if (process.platform === 'win32') {
        execSync(`where ${command}`, { stdio: 'ignore' })
      } else {
        execSync(`which ${command}`, { stdio: 'ignore' })
      }
      return true
    } catch {
      return false
    }
  }

  private replaceWithRuntimeCommand(command: string): string {
    const basename = path.basename(command)

    // UV command handling (all platforms)
    // Only replace if system command is not available
    if (['uv', 'uvx'].includes(basename)) {
      // Check if system command is available first
      if (this.isCommandAvailable(basename)) {
        return command
      }

      // Use runtime path if system command is not available
      if (this.uvRuntimePath) {
        const targetCommand = basename === 'uvx' ? 'uvx' : 'uv'
        if (process.platform === 'win32') {
          return path.join(this.uvRuntimePath, `${targetCommand}.exe`)
        } else {
          return path.join(this.uvRuntimePath, targetCommand)
        }
      }
    }

    // For other commands (node, npm, npx, bun), check system first
    if (['node', 'npm', 'npx', 'bun'].includes(basename)) {
      // Check if system command is available first
      if (this.isCommandAvailable(basename)) {
        return command
      }

      // Use runtime path if system command is not available
      if (process.platform === 'win32') {
        if (this.nodeRuntimePath) {
          if (basename === 'node') {
            return path.join(this.nodeRuntimePath, 'node.exe')
          } else if (basename === 'npm') {
            const npmCmd = path.join(this.nodeRuntimePath, 'npm.cmd')
            if (fs.existsSync(npmCmd)) {
              return npmCmd
            }
            return path.join(this.nodeRuntimePath, 'npm')
          } else if (basename === 'npx') {
            const npxCmd = path.join(this.nodeRuntimePath, 'npx.cmd')
            if (fs.existsSync(npxCmd)) {
              return npxCmd
            }
            return path.join(this.nodeRuntimePath, 'npx')
          }
        }
      } else {
        // Non-Windows platforms
        if (this.bunRuntimePath && ['node', 'npm', 'npx', 'bun'].includes(basename)) {
          return path.join(this.bunRuntimePath, 'bun')
        } else if (this.nodeRuntimePath) {
          let targetCommand: string
          if (basename === 'node') {
            targetCommand = 'node'
          } else if (basename === 'npm') {
            targetCommand = 'npm'
          } else if (basename === 'npx') {
            targetCommand = 'npx'
          } else if (basename === 'bun') {
            targetCommand = 'node'
          } else {
            targetCommand = basename
          }
          return path.join(this.nodeRuntimePath, 'bin', targetCommand)
        }
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

  private spawnAgentProcess(agent: AcpAgentConfig): ChildProcessWithoutNullStreams {
    // Initialize runtime paths if not already done
    this.setupRuntimes()

    // Replace command with runtime version if needed
    const processedCommand = this.replaceWithRuntimeCommand(agent.command)
    const processedArgs = (agent.args ?? []).map((arg) => this.replaceWithRuntimeCommand(arg))

    // Prepare environment variables
    const mergedEnv = agent.env ? { ...process.env, ...agent.env } : { ...process.env }

    // Add runtime paths to PATH for fallback
    const existingPaths: string[] = []
    Object.entries(mergedEnv).forEach(([key, value]) => {
      if (value !== undefined && ['PATH', 'Path', 'path'].includes(key)) {
        existingPaths.push(value)
      }
    })

    const allPaths = [...existingPaths]
    if (process.platform === 'win32') {
      if (this.uvRuntimePath) {
        allPaths.unshift(this.uvRuntimePath)
      }
      if (this.nodeRuntimePath) {
        allPaths.unshift(this.nodeRuntimePath)
      }
    } else {
      if (this.uvRuntimePath) {
        allPaths.unshift(this.uvRuntimePath)
      }
      if (this.nodeRuntimePath) {
        allPaths.unshift(path.join(this.nodeRuntimePath, 'bin'))
      }
      if (this.bunRuntimePath) {
        allPaths.unshift(this.bunRuntimePath)
      }
    }

    const { key, value } = this.normalizePathEnv(allPaths)
    mergedEnv[key] = value

    return spawn(processedCommand, processedArgs, {
      env: mergedEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    })
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
