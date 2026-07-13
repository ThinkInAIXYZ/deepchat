import spawn from 'cross-spawn'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { Readable, Writable } from 'node:stream'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { ClientSideConnection, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type {
  ClientSideConnection as ClientSideConnectionType,
  Client
} from '@agentclientprotocol/sdk'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { Stream } from '@agentclientprotocol/sdk/dist/stream.js'
import type {
  AcpDebugEventEntry,
  AcpAgentConfig,
  AcpAgentState,
  AcpConfigState,
  AcpResolvedLaunchSpec
} from '@shared/presenter'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import type { AgentProcessHandle, AgentProcessManager } from './types'
import {
  getPathEntriesFromEnv,
  getShellEnvironment,
  mergeCommandEnvironment,
  setPathEntriesOnEnv
} from '@/lib/agentRuntime/shellEnvHelper'
import { RuntimeHelper } from '@/lib/runtimeHelper'
import {
  buildCapabilitySnapshot,
  buildClientCapabilities,
  type AcpCapabilitySnapshot
} from './acpCapabilities'
import { AcpFsHandler } from './acpFsHandler'
import { AcpTerminalManager } from './acpTerminalManager'
import {
  createEmptyAcpConfigState,
  getAcpConfigOptionByCategory,
  getLegacyModeState,
  normalizeAcpConfigState,
  updateAcpConfigStateValue
} from './acpConfigState'
import { AcpDebugLog } from '@/presenter/acpClientPresenter/connection/AcpDebugLog'

export interface AcpProcessHandle extends AgentProcessHandle {
  child: ChildProcessWithoutNullStreams
  connection: ClientSideConnectionType
  agent: AcpAgentConfig
  readyAt: number
  state: 'warmup' | 'bound'
  boundConversationId?: string
  /** The working directory this process was spawned with */
  workdir: string
  configState?: AcpConfigState
  availableModes?: Array<{ id: string; name: string; description: string }>
  currentModeId?: string
  agentCapabilities?: schema.AgentCapabilities
  agentInfo?: schema.Implementation | null
  capabilitySnapshot?: AcpCapabilitySnapshot
  sessionCapabilities?: schema.SessionCapabilities
  promptCapabilities?: schema.PromptCapabilities
  authMethods?: schema.AuthMethod[]
  mcpCapabilities?: schema.McpCapabilities
  supportsLoadSession?: boolean
  supportsSessionList?: boolean
  supportsSessionResume?: boolean
  supportsSessionClose?: boolean
  supportsSessionFork?: boolean
  launchSignature: string
}

interface AcpProcessManagerOptions {
  providerId: string
  resolveLaunchSpec: (agentId: string, workdir?: string) => Promise<AcpResolvedLaunchSpec>
  getAgentState?: (agentId: string) => Promise<AcpAgentState | null>
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

interface NpxCacheRepairTarget {
  packageJsonPath: string
  cacheDir: string
  npxRoot: string
}

interface NpxCacheRepairResult {
  repaired: boolean
  message: string
  target?: NpxCacheRepairTarget
  movedTo?: string
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

interface BufferedSessionUpdate {
  notification: schema.SessionNotification
  receivedAt: number
}

type JsonRpcId = string | number
type JsonRpcMessageRecord = Record<string, unknown>
type ProtocolDirection = 'in' | 'out'
type ErrorWithAcpStderr = Error & { acpStderr?: string }

interface ProtocolMessageSummary {
  direction: ProtocolDirection
  kind: 'request' | 'notification' | 'response' | 'unknown'
  id?: JsonRpcId
  method?: string
  paramsKeys?: string[]
  resultKeys?: string[]
  error?: {
    code?: unknown
    message?: string
  }
  keys: string[]
  label: string
}

const MAX_PROTOCOL_LOG_LINE_LENGTH = 4000
const IMPORTANT_PROTOCOL_METHODS = new Set([
  'initialize',
  'authenticate',
  'session/new',
  'session/load',
  'session/list',
  'session/resume',
  'session/close',
  'session/fork',
  'session/prompt',
  'session/cancel'
])

const SESSION_UPDATE_BUFFER_TTL_MS = 30_000
const MAX_BUFFERED_SESSION_UPDATES = 100

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const truncateForLog = (value: string): string =>
  value.length > MAX_PROTOCOL_LOG_LINE_LENGTH
    ? `${value.slice(0, MAX_PROTOCOL_LOG_LINE_LENGTH)}...<truncated ${value.length - MAX_PROTOCOL_LOG_LINE_LENGTH} chars>`
    : value

export const parseLoadSessionCapability = (initializeResult: unknown): boolean | undefined => {
  if (!initializeResult || typeof initializeResult !== 'object') {
    return undefined
  }

  const resultRecord = initializeResult as {
    agentCapabilities?: { loadSession?: unknown }
  }
  const loadSession = resultRecord.agentCapabilities?.loadSession
  if (loadSession === undefined) {
    return undefined
  }
  return Boolean(loadSession)
}

const createLaunchSignature = (launchSpec: AcpResolvedLaunchSpec): string =>
  JSON.stringify({
    command: launchSpec.command,
    args: launchSpec.args ?? [],
    env: launchSpec.env ?? {},
    cwd: launchSpec.cwd ?? null,
    distributionType: launchSpec.distributionType,
    version: launchSpec.version ?? null,
    installDir: launchSpec.installDir ?? null
  })

export class AcpProcessManager implements AgentProcessManager<AcpProcessHandle, AcpAgentConfig> {
  private readonly providerId: string
  private readonly resolveLaunchSpec: (
    agentId: string,
    workdir?: string
  ) => Promise<AcpResolvedLaunchSpec>
  private readonly getAgentState?: (agentId: string) => Promise<AcpAgentState | null>
  private readonly getNpmRegistry?: () => Promise<string | null>
  private readonly getUvRegistry?: () => Promise<string | null>
  private readonly handles = new Map<string, AcpProcessHandle>()
  private readonly boundHandles = new Map<string, AcpProcessHandle>()
  private readonly pendingHandles = new Map<string, Promise<AcpProcessHandle>>()
  private readonly sessionListeners = new Map<string, SessionListenerEntry>()
  private readonly bufferedSessionUpdates = new Map<string, BufferedSessionUpdate[]>()
  private readonly permissionResolvers = new Map<string, PermissionResolverEntry>()
  private readonly runtimeHelper = RuntimeHelper.getInstance()
  private readonly terminalManager = new AcpTerminalManager()
  private readonly sessionWorkdirs = new Map<string, string>()
  private readonly sessionConversations = new Map<string, string>()
  private readonly fsHandlers = new Map<string, AcpFsHandler>()
  private readonly agentLocks = new Map<string, Promise<void>>()
  private readonly preferredModes = new Map<string, string>()
  private readonly latestConfigStates = new Map<string, AcpConfigState>()
  private readonly latestModeSnapshots = new Map<
    string,
    {
      availableModes?: Array<{ id: string; name: string; description: string }>
      currentModeId?: string
    }
  >()
  private readonly debugLog = new AcpDebugLog()
  private readonly protocolRequestsToAgent = new Map<string, Map<JsonRpcId, string>>()
  private readonly protocolRequestsFromAgent = new Map<string, Map<JsonRpcId, string>>()
  private shuttingDown = false

  constructor(options: AcpProcessManagerOptions) {
    this.providerId = options.providerId
    this.resolveLaunchSpec = options.resolveLaunchSpec
    this.getAgentState = options.getAgentState
    this.getNpmRegistry = options.getNpmRegistry
    this.getUvRegistry = options.getUvRegistry
  }

  /**
   * Register a session's working directory for file system operations.
   * This must be called when a session is created, before any fs/terminal operations.
   */
  registerSessionWorkdir(sessionId: string, workdir: string, conversationId?: string): void {
    this.sessionWorkdirs.set(sessionId, workdir)
    if (conversationId) {
      this.sessionConversations.set(sessionId, conversationId)
    }
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

  private resolveTerminalCwd(sessionId: string, requestedCwd?: string | null): string {
    const sessionWorkdir = this.sessionWorkdirs.get(sessionId)?.trim()
    if (sessionWorkdir) {
      const explicitCwd = requestedCwd?.trim()
      if (explicitCwd) {
        const safeCwd = this.resolveCwdInsideWorkdir(sessionWorkdir, explicitCwd)
        if (safeCwd) {
          return safeCwd
        }
        console.warn(
          `[ACP] Terminal cwd "${explicitCwd}" escapes session workdir "${sessionWorkdir}", using session workdir.`
        )
      }
      return sessionWorkdir
    }

    const fallbackWorkdir = this.getFallbackWorkdir()
    const conversationId = this.sessionConversations.get(sessionId)
    console.warn(
      `[ACP] Missing session workdir for terminal session ${sessionId}${conversationId ? ` (conversation ${conversationId})` : ''}, using fallback workdir: ${fallbackWorkdir}`
    )
    return fallbackWorkdir
  }

  private resolveCwdInsideWorkdir(workdir: string, cwd: string): string | null {
    const resolvedWorkdir = path.resolve(workdir)
    const resolvedCwd = path.isAbsolute(cwd)
      ? path.resolve(cwd)
      : path.resolve(resolvedWorkdir, cwd)
    if (!this.isPathInside(resolvedWorkdir, resolvedCwd)) {
      return null
    }

    let realpathSync: typeof fs.realpathSync | null = null
    try {
      realpathSync = typeof fs.realpathSync === 'function' ? fs.realpathSync.bind(fs) : null
    } catch {
      realpathSync = null
    }

    if (!realpathSync) {
      return resolvedCwd
    }

    try {
      const realWorkdir = realpathSync(resolvedWorkdir)
      const realCwd = realpathSync(resolvedCwd)
      return this.isPathInside(realWorkdir, realCwd) ? realCwd : null
    } catch (error) {
      console.warn(`[ACP] Failed to resolve terminal cwd "${cwd}":`, error)
      return resolvedCwd
    }
  }

  private isPathInside(root: string, target: string): boolean {
    const relative = path.relative(root, target)
    return !(relative.startsWith('..') || path.isAbsolute(relative))
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
    const trimmed = workdir?.trim()
    if (!trimmed) {
      return this.getFallbackWorkdir()
    }

    try {
      if (fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory()) {
        return trimmed
      }
    } catch (error) {
      console.warn(`[ACP] workdir "${trimmed}" is not accessible; using fallback workdir.`, error)
      return this.getFallbackWorkdir()
    }

    console.warn(`[ACP] workdir "${trimmed}" does not exist; using fallback workdir.`)
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
      const launchSpec = await this.resolveLaunchSpec(agent.id, resolvedWorkdir)
      const launchSignature = createLaunchSignature(launchSpec)
      const warmupCount = this.getHandlesByAgent(agent.id).filter((handle) =>
        this.isHandleAlive(handle)
      ).length
      console.info(
        `[ACP] Warmup requested for agent ${agent.id} (workdir=${resolvedWorkdir}, warmups=${warmupCount})`
      )
      const reusable = this.findReusableHandle(agent.id, resolvedWorkdir)
      if (reusable && this.isHandleAlive(reusable)) {
        if (reusable.launchSignature !== launchSignature) {
          console.info(
            `[ACP] Discarding warmup process for agent ${agent.id} because launch spec changed (pid=${reusable.pid}, workdir=${resolvedWorkdir})`
          )
          await this.disposeHandle(reusable)
        } else {
          console.info(
            `[ACP] Reusing warmup process for agent ${agent.id} (pid=${reusable.pid}, workdir=${resolvedWorkdir})`
          )
          this.applyPreferredMode(reusable, preferredModeId)
          return reusable
        }
      }

      const inflight = this.pendingHandles.get(warmupKey)
      if (inflight) {
        const inflightHandle = await inflight
        if (
          this.isHandleAlive(inflightHandle) &&
          inflightHandle.workdir === resolvedWorkdir &&
          inflightHandle.state === 'warmup' &&
          inflightHandle.launchSignature === launchSignature
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

      const handlePromise = this.spawnProcess(agent, resolvedWorkdir, launchSpec, launchSignature)
      this.pendingHandles.set(warmupKey, handlePromise)

      try {
        const handle = await handlePromise
        handle.state = 'warmup'
        handle.boundConversationId = undefined
        handle.workdir = resolvedWorkdir
        this.handles.set(warmupKey, handle)
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
      const modeOption = getAcpConfigOptionByCategory(existingWarmup.configState, 'mode')
      if (modeOption?.type === 'select') {
        existingWarmup.configState =
          updateAcpConfigStateValue(existingWarmup.configState, modeOption.id, modeId) ??
          existingWarmup.configState
        this.notifyConfigOptionsReady(existingWarmup)
      }
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

  getBoundProcess(conversationId: string): AcpProcessHandle | null {
    return this.boundHandles.get(conversationId) ?? null
  }

  updateBoundProcessMode(conversationId: string, modeId: string): boolean {
    const handle = this.boundHandles.get(conversationId)
    if (!handle || !this.isHandleAlive(handle)) {
      return false
    }
    handle.currentModeId = modeId
    const modeOption = getAcpConfigOptionByCategory(handle.configState, 'mode')
    if (modeOption?.type === 'select') {
      handle.configState =
        updateAcpConfigStateValue(handle.configState, modeOption.id, modeId) ?? handle.configState
      this.notifyConfigOptionsReady(handle, conversationId)
    }
    this.syncAgentCache(handle)
    return true
  }

  updateBoundProcessConfigState(conversationId: string, configState: AcpConfigState): boolean {
    const handle = this.boundHandles.get(conversationId)
    if (!handle || !this.isHandleAlive(handle)) {
      return false
    }
    handle.configState = configState
    const legacyModeState = getLegacyModeState(configState)
    handle.availableModes = legacyModeState?.availableModes
    handle.currentModeId = legacyModeState?.currentModeId ?? handle.currentModeId
    this.syncAgentCache(handle)
    this.notifyConfigOptionsReady(handle, conversationId)
    return true
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
    this.sessionConversations.clear()
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
    this.notifyConfigOptionsReady(handle, conversationId)
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
    const handle = this.getScopedHandle(agentId, workdir)
    if (!handle) {
      return this.latestModeSnapshots.get(agentId)
    }

    const legacyModeState = getLegacyModeState(handle.configState)
    if (legacyModeState) {
      return {
        availableModes: legacyModeState.availableModes,
        currentModeId: legacyModeState.currentModeId ?? handle.currentModeId
      }
    }

    return {
      availableModes: handle.availableModes,
      currentModeId: handle.currentModeId
    }
  }

  getProcessConfigState(agentId: string, workdir?: string): AcpConfigState | undefined {
    const handle = this.getScopedHandle(agentId, workdir)
    if (handle) {
      return handle.configState ?? createEmptyAcpConfigState('legacy')
    }
    return this.latestConfigStates.get(agentId)
  }

  getDebugEvents(agentId: string): AcpDebugEventEntry[] {
    return this.debugLog.list(agentId)
  }

  appendDebugEvent(
    agentId: string,
    entry: Omit<AcpDebugEventEntry, 'id' | 'timestamp' | 'agentId'>
  ): AcpDebugEventEntry {
    return this.debugLog.append(agentId, entry)
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

    this.flushBufferedSessionUpdates(sessionId)

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
    this.sessionConversations.delete(sessionId)
    this.fsHandlers.delete(sessionId)
    this.bufferedSessionUpdates.delete(sessionId)
    // Clean up terminals for this session
    void this.terminalManager.releaseSessionTerminals(sessionId)
  }

  private async spawnProcess(
    agent: AcpAgentConfig,
    workdir: string,
    launchSpec: AcpResolvedLaunchSpec,
    launchSignature: string
  ): Promise<AcpProcessHandle> {
    try {
      return await this.spawnProcessOnce(agent, workdir, launchSpec, launchSignature)
    } catch (error) {
      const repairResult = this.repairNpxCacheIfNeeded(agent.id, launchSpec, error)
      if (!repairResult.repaired) {
        throw error
      }

      console.warn(
        `[ACP] Retrying npx agent ${agent.id} after cache repair: ${repairResult.message}`
      )
      try {
        return await this.spawnProcessOnce(agent, workdir, launchSpec, launchSignature)
      } catch (retryError) {
        throw this.createNpxRepairRetryError(agent.id, error, retryError, repairResult)
      }
    }
  }

  private async spawnProcessOnce(
    agent: AcpAgentConfig,
    workdir: string,
    launchSpec: AcpResolvedLaunchSpec,
    launchSignature: string
  ): Promise<AcpProcessHandle> {
    const child = await this.spawnAgentProcess(agent, workdir, launchSpec)
    const stderrChunks: string[] = []
    const stream = this.createAgentStream(agent.id, child)
    const client = this.createClientProxy()
    const connection = new ClientSideConnection(() => client, stream)
    const handleSeed: Partial<AcpProcessHandle> = {}
    let readyHandle: AcpProcessHandle | null = null

    const handleProcessExit = (code: number | null, signal: NodeJS.Signals | null) => {
      console.warn(
        `[ACP] Agent process for ${agent.id} exited (PID: ${child.pid}, code=${code ?? 'null'}, signal=${signal ?? 'null'})`
      )
      this.debugLog.append(agent.id, {
        kind: 'lifecycle',
        action: 'process.exit',
        payload: { pid: child.pid, code, signal, workdir }
      })
      if (readyHandle) {
        this.removeHandleReferences(readyHandle)
        this.clearSessionsForAgent(agent.id)
      }
    }

    child.on('exit', handleProcessExit)
    child.stderr?.on('data', (chunk: Buffer) => {
      const error = chunk.toString().trim()
      if (error) {
        stderrChunks.push(error)
        console.error(`[ACP] ${agent.id} stderr: ${error}`)
        this.debugLog.append(agent.id, {
          kind: 'stderr',
          action: 'process.stderr',
          message: error,
          payload: error
        })
      }
    })
    child.on('error', (error) => {
      console.error(`[ACP] Agent process ${agent.id} encountered error:`, error)
      this.debugLog.append(agent.id, {
        kind: 'error',
        action: 'process.error',
        message: error.message,
        payload: { name: error.name, stack: error.stack, workdir }
      })
    })
    console.info(`[ACP] Process monitoring set up for agent ${agent.id} (PID: ${child.pid})`)
    this.debugLog.append(agent.id, {
      kind: 'lifecycle',
      action: 'process.spawned',
      payload: {
        pid: child.pid,
        workdir,
        command: launchSpec.command,
        argsCount: launchSpec.args?.length ?? 0,
        distributionType: launchSpec.distributionType
      }
    })

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
      const initPayload = {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: buildClientCapabilities({
          enableFs: true,
          enableTerminal: true
        }),
        clientInfo: { name: 'DeepChat', version: app.getVersion() }
      }
      this.debugLog.append(agent.id, {
        kind: 'request',
        action: 'initialize',
        payload: initPayload
      })
      const initPromise = connection.initialize(initPayload)

      let timeoutHandle: NodeJS.Timeout | null = null
      let initializationSettled = false
      let cleanupInitExitListener: (() => void) | null = null
      const processExitPromise = new Promise<never>((_, reject) => {
        const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
          reject(
            new Error(
              `[ACP] Agent process ${agent.id} exited during initialization (PID: ${child.pid}, code=${code ?? 'null'}, signal=${signal ?? 'null'})`
            )
          )
        }
        child.once('exit', onExit)
        cleanupInitExitListener = () => child.removeListener('exit', onExit)
      })
      const connectionClosedPromise = connection.closed.then(() => {
        if (!initializationSettled) {
          throw new Error(
            `[ACP] Protocol stream closed before initialization completed for agent ${agent.id}`
          )
        }
        return new Promise<never>(() => {})
      })
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `[ACP] Connection initialization timeout after ${timeoutMs}ms for agent ${agent.id}`
            )
          )
        }, timeoutMs)
      })

      const initResult = await Promise.race([
        initPromise,
        timeoutPromise,
        processExitPromise,
        connectionClosedPromise
      ]).finally(() => {
        initializationSettled = true
        cleanupInitExitListener?.()
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
        }
      })
      console.info(`[ACP] Connection initialization completed successfully for agent ${agent.id}`)

      // Log Agent capabilities from initialization
      const resultData = initResult as unknown as {
        sessionId?: string
        configOptions?: schema.SessionConfigOption[] | null
        models?: schema.SessionModelState | null
        modes?: schema.SessionModeState | null
        protocolVersion?: schema.ProtocolVersion
        agentInfo?: schema.Implementation | null
        agentCapabilities?: {
          mcpCapabilities?: schema.McpCapabilities
          promptCapabilities?: schema.PromptCapabilities
          sessionCapabilities?: schema.SessionCapabilities
          loadSession?: boolean
        }
        authMethods?: schema.AuthMethod[]
      }
      this.debugLog.append(agent.id, {
        kind: 'response',
        action: 'initialize',
        payload: initResult
      })

      const capabilitySnapshot = buildCapabilitySnapshot(initResult)
      handleSeed.capabilitySnapshot = capabilitySnapshot
      handleSeed.agentInfo = capabilitySnapshot.agentInfo
      handleSeed.agentCapabilities = capabilitySnapshot.agentCapabilities
      handleSeed.sessionCapabilities = capabilitySnapshot.sessionCapabilities
      handleSeed.promptCapabilities = capabilitySnapshot.promptCapabilities
      handleSeed.authMethods = capabilitySnapshot.authMethods
      handleSeed.supportsLoadSession = capabilitySnapshot.supports.loadSession
      handleSeed.supportsSessionList = capabilitySnapshot.supports.sessionList
      handleSeed.supportsSessionResume = capabilitySnapshot.supports.sessionResume
      handleSeed.supportsSessionClose = capabilitySnapshot.supports.sessionClose
      handleSeed.supportsSessionFork = capabilitySnapshot.supports.sessionFork
      if (capabilitySnapshot.mcpCapabilities) {
        handleSeed.mcpCapabilities = capabilitySnapshot.mcpCapabilities
        console.info('[ACP] MCP capabilities:', capabilitySnapshot.mcpCapabilities)
      }
      console.info('[ACP] Capability support:', capabilitySnapshot.supports)

      if (resultData.sessionId) {
        console.info(`[ACP] Session ID: ${resultData.sessionId}`)
      }
      if (resultData.models) {
        console.info(`[ACP] Available models: ${resultData.models.availableModels?.length ?? 0}`)
        console.info(`[ACP] Current model: ${resultData.models.currentModelId}`)
      }
      const initAvailableModes = resultData.modes?.availableModes?.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        description: m.description ?? ''
      }))
      if (initAvailableModes) {
        console.info(
          `[ACP] Available modes: ${JSON.stringify(initAvailableModes.map((m) => m.id) ?? [])}`
        )
        console.info(`[ACP] Current mode: ${resultData.modes?.currentModeId}`)
      }
      handleSeed.configState = normalizeAcpConfigState({
        configOptions: resultData.configOptions,
        models: resultData.models,
        modes: resultData.modes
      })
      handleSeed.availableModes = initAvailableModes
      handleSeed.currentModeId = resultData.modes?.currentModeId
    } catch (error) {
      console.error(`[ACP] Connection initialization failed for agent ${agent.id}:`, error)
      this.debugLog.append(agent.id, {
        kind: 'error',
        action: 'initialize',
        message: error instanceof Error ? error.message : String(error),
        payload: error instanceof Error ? { name: error.name, stack: error.stack } : error
      })

      // Clean up the child process if initialization failed
      if (!child.killed) {
        try {
          child.kill()
          console.info(`[ACP] Killed process for failed agent ${agent.id} (PID: ${child.pid})`)
        } catch (killError) {
          console.warn(`[ACP] Failed to kill process for agent ${agent.id}:`, killError)
        }
      }

      this.attachStderrToError(error, stderrChunks)
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
      configState: handleSeed.configState ?? createEmptyAcpConfigState('legacy'),
      availableModes: handleSeed.availableModes,
      currentModeId: handleSeed.currentModeId,
      agentInfo: handleSeed.agentInfo,
      capabilitySnapshot: handleSeed.capabilitySnapshot,
      agentCapabilities: handleSeed.agentCapabilities,
      sessionCapabilities: handleSeed.sessionCapabilities,
      promptCapabilities: handleSeed.promptCapabilities,
      authMethods: handleSeed.authMethods,
      mcpCapabilities: handleSeed.mcpCapabilities,
      supportsLoadSession: handleSeed.supportsLoadSession,
      supportsSessionList: handleSeed.supportsSessionList,
      supportsSessionResume: handleSeed.supportsSessionResume,
      supportsSessionClose: handleSeed.supportsSessionClose,
      supportsSessionFork: handleSeed.supportsSessionFork,
      launchSignature
    }
    readyHandle = handle
    if (!this.isHandleAlive(handle)) {
      this.removeHandleReferences(handle)
      this.clearSessionsForAgent(agent.id)
      throw new Error(
        `[ACP] Agent process ${agent.id} exited before becoming ready (PID: ${child.pid})`
      )
    }
    this.debugLog.append(agent.id, {
      kind: 'lifecycle',
      action: 'process.ready',
      payload: { pid: child.pid, workdir }
    })

    return handle
  }

  private attachStderrToError(error: unknown, stderrChunks: string[]): void {
    if (!stderrChunks.length || !(error instanceof Error)) {
      return
    }
    ;(error as ErrorWithAcpStderr).acpStderr = stderrChunks.join('\n')
  }

  private repairNpxCacheIfNeeded(
    agentId: string,
    launchSpec: AcpResolvedLaunchSpec,
    error: unknown
  ): NpxCacheRepairResult {
    if (launchSpec.distributionType !== 'npx') {
      return { repaired: false, message: 'agent distribution is not npx' }
    }

    const target = this.findNpxCacheRepairTarget(error)
    if (!target) {
      return { repaired: false, message: 'error is not a _npx package.json ENOENT' }
    }

    const result = this.repairNpxCacheDirectory(target)
    this.debugLog.append(agentId, {
      kind: result.repaired ? 'lifecycle' : 'error',
      action: 'npx.cache.repair',
      message: result.message,
      payload: {
        packageJsonPath: target.packageJsonPath,
        cacheDir: target.cacheDir,
        movedTo: result.movedTo,
        repaired: result.repaired
      }
    })
    return result
  }

  private findNpxCacheRepairTarget(error: unknown): NpxCacheRepairTarget | null {
    const text = this.stringifyErrorWithStderr(error)
    if (!/\bENOENT\b/i.test(text)) {
      return null
    }

    const packageJsonPathPattern =
      /((?:[A-Za-z]:)?[\\/][^'"\r\n]*[\\/]_npx[\\/][^\\/ "'\r\n]+[\\/]package\.json)/i
    const packageJsonPath = text.match(packageJsonPathPattern)?.[1]
    if (!packageJsonPath) {
      return null
    }

    const normalizedPackageJsonPath = path.normalize(packageJsonPath)
    if (path.basename(normalizedPackageJsonPath) !== 'package.json') {
      return null
    }

    const cacheDir = path.dirname(normalizedPackageJsonPath)
    const npxRoot = path.dirname(cacheDir)
    if (path.basename(npxRoot) !== '_npx') {
      return null
    }

    const relativeCacheDir = path.relative(npxRoot, cacheDir)
    if (
      !relativeCacheDir ||
      relativeCacheDir.startsWith('..') ||
      path.isAbsolute(relativeCacheDir) ||
      relativeCacheDir.includes(path.sep)
    ) {
      return null
    }

    return {
      packageJsonPath: normalizedPackageJsonPath,
      cacheDir,
      npxRoot
    }
  }

  private repairNpxCacheDirectory(target: NpxCacheRepairTarget): NpxCacheRepairResult {
    let cacheStat: fs.Stats | null = null
    try {
      cacheStat = fs.statSync(target.cacheDir)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return {
          repaired: true,
          message: `npx cache directory was already missing: ${target.cacheDir}`,
          target
        }
      }
      return {
        repaired: false,
        message: `failed to inspect npx cache directory "${target.cacheDir}": ${error instanceof Error ? error.message : String(error)}`,
        target
      }
    }

    if (!cacheStat.isDirectory()) {
      return {
        repaired: false,
        message: `npx cache path is not a directory: ${target.cacheDir}`,
        target
      }
    }

    const movedTo = this.createBadNpxCachePath(target.cacheDir)
    try {
      fs.renameSync(target.cacheDir, movedTo)
      return {
        repaired: true,
        message: `moved broken npx cache directory "${target.cacheDir}" to "${movedTo}"`,
        target,
        movedTo
      }
    } catch (error) {
      return {
        repaired: false,
        message: `failed to move npx cache directory "${target.cacheDir}": ${error instanceof Error ? error.message : String(error)}`,
        target
      }
    }
  }

  private createBadNpxCachePath(cacheDir: string): string {
    const base = `${cacheDir}.bad-${Date.now()}`
    let candidate = base
    let suffix = 1
    while (fs.existsSync(candidate)) {
      candidate = `${base}-${suffix}`
      suffix += 1
    }
    return candidate
  }

  private createNpxRepairRetryError(
    agentId: string,
    originalError: unknown,
    retryError: unknown,
    repairResult: NpxCacheRepairResult
  ): Error {
    const error = new Error(
      `[ACP] npx cache repair for agent ${agentId} was attempted but retry failed. Repair: ${repairResult.message}. Original error: ${this.stringifyErrorWithStderr(originalError)}. Retry error: ${this.stringifyErrorWithStderr(retryError)}`
    )
    ;(error as Error & { cause?: unknown }).cause = retryError
    return error
  }

  private stringifyErrorWithStderr(error: unknown): string {
    if (error instanceof Error) {
      const stderr = (error as ErrorWithAcpStderr).acpStderr
      return [error.message, stderr].filter(Boolean).join('\n')
    }
    return String(error)
  }

  private validateSpawnCwd(agentId: string, cwd: string, source: 'configured cwd' | 'workdir') {
    if (!fs.existsSync(cwd)) {
      throw new Error(`[ACP] ${source} "${cwd}" does not exist for agent ${agentId}`)
    }

    let stat: fs.Stats
    try {
      stat = fs.statSync(cwd)
    } catch (error) {
      throw new Error(
        `[ACP] ${source} "${cwd}" is not accessible for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    if (!stat.isDirectory()) {
      throw new Error(`[ACP] ${source} "${cwd}" is not a directory for agent ${agentId}`)
    }
  }

  private async spawnAgentProcess(
    agent: AcpAgentConfig,
    workdir: string,
    launchSpec: AcpResolvedLaunchSpec
  ): Promise<ChildProcessWithoutNullStreams> {
    // Initialize runtime paths if not already done
    this.runtimeHelper.initializeRuntimes()
    const agentState = await this.getAgentState?.(agent.id)

    // Validate command
    if (!launchSpec.command || launchSpec.command.trim().length === 0) {
      throw new Error(`[ACP] Invalid command for agent ${agent.id}: command is empty`)
    }

    // Handle path expansion (including ~ and environment variables)
    const useBundledRuntime =
      launchSpec.distributionType === 'npx' || launchSpec.distributionType === 'uvx'
    const expandedCommand = this.runtimeHelper.expandPath(launchSpec.command)
    const expandedArgs = (launchSpec.args ?? []).map((arg) =>
      typeof arg === 'string' ? this.runtimeHelper.expandPath(arg) : arg
    )

    // Replace command with runtime version if needed
    const processedCommand = this.runtimeHelper.replaceWithRuntimeCommand(
      expandedCommand,
      useBundledRuntime,
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
      originalCommand: launchSpec.command,
      processedCommand,
      args: launchSpec.args ?? [],
      distributionType: launchSpec.distributionType
    })

    if (processedCommand !== launchSpec.command) {
      console.info(
        `[ACP] Command replaced for agent ${agent.id}: "${launchSpec.command}" -> "${processedCommand}"`
      )
    }

    // Use expanded args
    const processedArgs = expandedArgs

    let env = mergeCommandEnvironment()

    let shellEnv: Record<string, string> = {}
    try {
      shellEnv = await getShellEnvironment()
      console.info(`[ACP] Retrieved shell environment variables for agent ${agent.id}`)
      env = mergeCommandEnvironment({ shellEnv })
    } catch (error) {
      console.warn(
        `[ACP] Failed to get shell environment variables for agent ${agent.id}, using fallback:`,
        error
      )
    }

    const shellPath = shellEnv.PATH || shellEnv.Path || shellEnv.path
    if (shellPath) {
      console.info(`[ACP] Using shell PATH for agent ${agent.id} (length: ${shellPath.length})`)
    }

    // Merge distribution/base environment variables first.
    if (launchSpec.env) {
      Object.entries(launchSpec.env).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          if (!['PATH', 'Path', 'path'].includes(key)) {
            env[key] = value
          }
        }
      })
    }

    if (useBundledRuntime) {
      const withRuntimePaths = this.runtimeHelper.prependBundledRuntimeToEnv(env)
      Object.assign(env, withRuntimePaths)

      env.ACP_IDE = 'deepchat'
      env.DEEPCHAT_ACP_AGENT_ID = agent.id

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

    const userEnvOverride = agentState?.envOverride
    if (userEnvOverride) {
      Object.entries(userEnvOverride).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          if (!['PATH', 'Path', 'path'].includes(key)) {
            env[key] = value
          }
        }
      })
    }

    setPathEntriesOnEnv(
      env,
      [
        getPathEntriesFromEnv(userEnvOverride),
        getPathEntriesFromEnv(launchSpec.env),
        getPathEntriesFromEnv(env)
      ],
      {
        includeDefaultPaths: false
      }
    )

    const mergedEnv = env
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
    const pathValue = mergedEnv[pathKey] || mergedEnv.PATH || ''

    console.info(`[ACP] Environment variables for agent ${agent.id}:`, {
      pathKey,
      pathValue,
      distributionEnvKeys: Object.keys(launchSpec.env ?? {}),
      userOverrideKeys: Object.keys(userEnvOverride ?? {})
    })

    const configuredCwd = launchSpec.cwd?.trim()
    const cwd = configuredCwd || workdir
    this.validateSpawnCwd(agent.id, cwd, configuredCwd ? 'configured cwd' : 'workdir')
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

  private createAgentStream(agentId: string, child: ChildProcessWithoutNullStreams): Stream {
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
    return this.createTracedNdJsonStream(agentId, writable, readable)
  }

  private createTracedNdJsonStream(
    agentId: string,
    output: WritableStream<Uint8Array>,
    input: ReadableStream<Uint8Array>
  ): Stream {
    const textEncoder = new TextEncoder()
    const textDecoder = new TextDecoder()

    const readable = new ReadableStream<JsonRpcMessageRecord>({
      start: async (controller) => {
        let content = ''
        let didError = false
        const reader = input.getReader()

        const emitLine = (line: string, action: string) => {
          const trimmedLine = line.trim()
          if (!trimmedLine) return
          try {
            const message = JSON.parse(trimmedLine) as JsonRpcMessageRecord
            this.logProtocolMessage(agentId, 'in', message)
            controller.enqueue(message)
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            console.error(`[ACP] ${agentId} protocol parse error from stdout:`, {
              error: errorMessage,
              line: truncateForLog(trimmedLine),
              length: trimmedLine.length
            })
            this.debugLog.append(agentId, {
              kind: 'error',
              action,
              message: errorMessage,
              payload: {
                line: truncateForLog(trimmedLine),
                length: trimmedLine.length
              }
            })
          }
        }

        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) {
              break
            }
            if (!value) {
              continue
            }
            content += textDecoder.decode(value, { stream: true })
            const lines = content.split('\n')
            content = lines.pop() || ''
            lines.forEach((line) => emitLine(line, 'protocol.stdout.parse'))
          }

          if (content.trim()) {
            emitLine(content, 'protocol.stdout.trailing_parse')
          }
        } catch (error) {
          didError = true
          console.error(`[ACP] ${agentId} protocol stdout stream failed:`, error)
          this.debugLog.append(agentId, {
            kind: 'error',
            action: 'protocol.stdout.stream',
            message: error instanceof Error ? error.message : String(error),
            payload: error instanceof Error ? { name: error.name, stack: error.stack } : error
          })
          controller.error(error)
        } finally {
          reader.releaseLock()
          if (!didError) {
            controller.close()
          }
        }
      }
    })

    const writable = new WritableStream<JsonRpcMessageRecord>({
      write: async (message) => {
        this.logProtocolMessage(agentId, 'out', message)
        const content = `${JSON.stringify(message)}\n`
        const writer = output.getWriter()
        try {
          await writer.write(textEncoder.encode(content))
        } finally {
          writer.releaseLock()
        }
      }
    })

    return { readable, writable } as unknown as Stream
  }

  private getProtocolRequestMap(
    store: Map<string, Map<JsonRpcId, string>>,
    agentId: string
  ): Map<JsonRpcId, string> {
    const existing = store.get(agentId)
    if (existing) return existing

    const created = new Map<JsonRpcId, string>()
    store.set(agentId, created)
    return created
  }

  private summarizeProtocolMessage(
    agentId: string,
    direction: ProtocolDirection,
    message: unknown
  ): ProtocolMessageSummary {
    const record = isRecord(message) ? message : {}
    const keys = Object.keys(record)
    const idValue = record.id
    const id = typeof idValue === 'string' || typeof idValue === 'number' ? idValue : undefined
    const directMethod = typeof record.method === 'string' ? record.method : undefined
    const paramsKeys = isRecord(record.params) ? Object.keys(record.params) : undefined
    const resultKeys = isRecord(record.result) ? Object.keys(record.result) : undefined
    const errorRecord = isRecord(record.error) ? record.error : undefined
    const error = errorRecord
      ? {
          code: errorRecord.code,
          message: typeof errorRecord.message === 'string' ? errorRecord.message : undefined
        }
      : undefined

    let kind: ProtocolMessageSummary['kind'] = 'unknown'
    let method = directMethod
    if (directMethod && id !== undefined) {
      kind = 'request'
      const store =
        direction === 'out' ? this.protocolRequestsToAgent : this.protocolRequestsFromAgent
      this.getProtocolRequestMap(store, agentId).set(id, directMethod)
    } else if (directMethod) {
      kind = 'notification'
    } else if (id !== undefined) {
      kind = 'response'
      const store =
        direction === 'in' ? this.protocolRequestsToAgent : this.protocolRequestsFromAgent
      const requests = store.get(agentId)
      method = requests?.get(id)
      requests?.delete(id)
    }

    const labelParts: string[] = [kind]
    if (method) {
      labelParts.push(method)
    }
    if (id !== undefined) {
      labelParts.push(`#${id}`)
    }
    if (error?.message) {
      labelParts.push(`error=${error.message}`)
    }

    return {
      direction,
      kind,
      id,
      method,
      paramsKeys,
      resultKeys,
      error,
      keys,
      label: labelParts.join(' ')
    }
  }

  private logProtocolMessage(
    agentId: string,
    direction: ProtocolDirection,
    message: unknown
  ): void {
    const summary = this.summarizeProtocolMessage(agentId, direction, message)
    const route = direction === 'out' ? 'client->agent' : 'agent->client'
    const isImportant =
      Boolean(summary.error) ||
      (summary.method ? IMPORTANT_PROTOCOL_METHODS.has(summary.method) : false)
    const logMessage = `[ACP] ${agentId} protocol ${route}: ${summary.label}`

    if (isImportant) {
      console.info(logMessage, summary)
    } else {
      console.debug(logMessage, summary)
    }

    this.debugLog.append(agentId, {
      kind: 'lifecycle',
      action: `protocol.${direction}`,
      message: summary.label,
      payload: summary
    })
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
        return await handler.readTextFile(params)
      },
      writeTextFile: async (params) => {
        const handler = this.getFsHandler(params.sessionId)
        return await handler.writeTextFile(params)
      },
      // Terminal operations
      createTerminal: async (params) => {
        return this.terminalManager.createTerminal({
          ...params,
          cwd: this.resolveTerminalCwd(params.sessionId, params.cwd)
        })
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
      this.bufferSessionUpdate(notification)
      return
    }
    this.deliverSessionUpdate(entry, notification)
  }

  private deliverSessionUpdate(
    entry: SessionListenerEntry,
    notification: schema.SessionNotification
  ): void {
    this.debugLog.append(entry.agentId, {
      kind: 'notification',
      action: 'session/update',
      sessionId: notification.sessionId,
      payload: notification
    })

    entry.handlers.forEach((handler) => {
      try {
        handler(notification)
      } catch (error) {
        console.warn(`[ACP] Session handler threw for session ${notification.sessionId}:`, error)
      }
    })
  }

  private bufferSessionUpdate(notification: schema.SessionNotification): void {
    const now = Date.now()
    this.pruneBufferedSessionUpdates(now)
    const sessionId = notification.sessionId
    const existing = this.bufferedSessionUpdates.get(sessionId) ?? []
    const next = [
      ...existing,
      {
        notification,
        receivedAt: now
      }
    ].slice(-MAX_BUFFERED_SESSION_UPDATES)
    this.bufferedSessionUpdates.set(sessionId, next)
    console.warn(
      `[ACP] Buffered session update for unbound session "${sessionId}" (${next.length} pending)`
    )
  }

  private flushBufferedSessionUpdates(sessionId: string): void {
    const entry = this.sessionListeners.get(sessionId)
    if (!entry) return

    this.pruneBufferedSessionUpdates()
    const buffered = this.bufferedSessionUpdates.get(sessionId)
    if (!buffered?.length) return

    this.bufferedSessionUpdates.delete(sessionId)
    this.debugLog.append(entry.agentId, {
      kind: 'lifecycle',
      action: 'session/update.buffer.flush',
      sessionId,
      payload: { count: buffered.length }
    })
    buffered.forEach(({ notification }) => this.deliverSessionUpdate(entry, notification))
  }

  private pruneBufferedSessionUpdates(now = Date.now()): void {
    for (const [sessionId, updates] of this.bufferedSessionUpdates.entries()) {
      const fresh = updates.filter(
        (update) => now - update.receivedAt <= SESSION_UPDATE_BUFFER_TTL_MS
      )
      if (fresh.length === updates.length) continue
      if (fresh.length) {
        this.bufferedSessionUpdates.set(sessionId, fresh)
      } else {
        this.bufferedSessionUpdates.delete(sessionId)
      }
    }
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
      this.debugLog.append(entry.agentId, {
        kind: 'permission',
        action: 'session/request_permission',
        sessionId: params.sessionId,
        payload: params
      })
      return await entry.resolver(params)
    } catch (error) {
      console.error('[ACP] Permission resolver failed:', error)
      return { outcome: { outcome: 'cancelled' } }
    }
  }

  private notifyModesReady(handle: AcpProcessHandle, conversationId?: string): void {
    if (!handle.availableModes || handle.availableModes.length === 0) return

    publishDeepchatEvent('sessions.acp.modes.ready', {
      conversationId: conversationId ?? handle.boundConversationId ?? undefined,
      agentId: handle.agentId,
      workdir: handle.workdir,
      current: handle.currentModeId ?? 'default',
      available: handle.availableModes,
      version: Date.now()
    })
  }

  private notifyConfigOptionsReady(handle: AcpProcessHandle, conversationId?: string): void {
    const configState = handle.configState ?? createEmptyAcpConfigState('legacy')
    publishDeepchatEvent('sessions.acp.configOptions.ready', {
      conversationId: conversationId ?? handle.boundConversationId ?? undefined,
      agentId: handle.agentId,
      workdir: handle.workdir,
      configState,
      version: Date.now()
    })
  }

  private getScopedHandle(agentId: string, workdir?: string): AcpProcessHandle | undefined {
    const aliveHandles = this.getHandlesByAgent(agentId).filter((handle) =>
      this.isHandleAlive(handle)
    )
    if (!aliveHandles.length) {
      return undefined
    }

    const trimmedWorkdir = workdir?.trim()
    if (!trimmedWorkdir) {
      return aliveHandles[0]
    }

    const resolvedWorkdir = this.resolveWorkdir(trimmedWorkdir)
    return aliveHandles.find((handle) => handle.workdir === resolvedWorkdir)
  }

  private syncAgentCache(
    handle: Pick<AcpProcessHandle, 'agentId' | 'configState' | 'availableModes' | 'currentModeId'>
  ): void {
    if (handle.configState) {
      this.latestConfigStates.set(handle.agentId, handle.configState)
    }

    const legacyModeState = getLegacyModeState(handle.configState)
    const availableModes = legacyModeState?.availableModes ?? handle.availableModes
    const currentModeId = legacyModeState?.currentModeId ?? handle.currentModeId

    if (!availableModes?.length && !currentModeId) {
      return
    }

    this.latestModeSnapshots.set(handle.agentId, {
      availableModes,
      currentModeId
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
    const modeOption = getAcpConfigOptionByCategory(handle.configState, 'mode')
    if (modeOption?.type === 'select') {
      handle.configState =
        updateAcpConfigStateValue(handle.configState, modeOption.id, preferredModeId) ??
        handle.configState
      this.notifyConfigOptionsReady(handle)
    }
    this.syncAgentCache(handle)
    this.notifyModesReady(handle)
  }

  private clearSessionsForAgent(agentId: string): void {
    this.protocolRequestsToAgent.delete(agentId)
    this.protocolRequestsFromAgent.delete(agentId)

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
