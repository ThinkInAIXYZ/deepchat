import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { Readable, Writable } from 'node:stream'
import { app } from 'electron'
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

  private spawnAgentProcess(agent: AcpAgentConfig): ChildProcessWithoutNullStreams {
    const mergedEnv = agent.env ? { ...process.env, ...agent.env } : { ...process.env }
    return spawn(agent.command, agent.args ?? [], {
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
