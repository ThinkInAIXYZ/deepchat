import type { MCPServerConfig } from '@shared/types/mcp'
import type {
  PluginMcpStartMode,
  PluginMcpSurface,
  PluginRuntimeLifecycleState
} from '@shared/types/plugin'
import { randomUUID } from 'node:crypto'
import type { PluginToolCatalog } from './toolCatalog'

export type { PluginRuntimeLifecycleState } from '@shared/types/plugin'

export type PluginRuntimeStartReason =
  | 'reconcile'
  | 'tool'
  | 'runtime-test'
  | 'authentication'
  | 'configuration'
  | 'external'

export interface PluginRuntimeAdapterInstance {
  start(
    reason: PluginRuntimeStartReason,
    safetyHooks?: PluginRuntimeSafetyHooks
  ): Promise<{ configOverride?: Partial<MCPServerConfig> } | void>
  stop(): Promise<void>
  recoverStaleLaunch?(context: PluginRuntimeLaunchContext): Promise<void>
}

export type PluginRuntimeFingerprint = {
  readonly value: string
  readonly pluginId: string
  readonly runtimeId: string
  readonly target: string
  readonly binarySha256: string
}

export interface PluginRuntimeLaunchGuard {
  verify(): Promise<PluginRuntimeFingerprint>
}

export type PluginRuntimeLaunchContext = Readonly<Record<string, string>>

export interface PluginRuntimeSafetyHooks {
  updateLaunchContext(context: PluginRuntimeLaunchContext): void
}

export type PluginRuntimeSentinel = {
  readonly schemaVersion: 1
  readonly attemptId: string
  readonly pluginId: string
  readonly runtimeId: string
  readonly serverName: string
  readonly fingerprint: PluginRuntimeFingerprint
  readonly launchContext?: PluginRuntimeLaunchContext
  readonly recordedAt: number
}

export interface PluginRuntimeSafetyStore {
  read(key: string): unknown
  write(key: string, sentinel: PluginRuntimeSentinel): void
  remove(key: string): void
}

export interface PluginOwnedServerRegistration {
  pluginId: string
  serverName: string
  displayName?: string
  runtimeId?: string
  startMode: PluginMcpStartMode
  surfaces: PluginMcpSurface[]
  toolCatalogPath?: string
  toolCatalog?: PluginToolCatalog
  adapter?: PluginRuntimeAdapterInstance
  launchGuard?: PluginRuntimeLaunchGuard
}

export interface PluginOwnedToolCatalogRegistration {
  readonly pluginId: string
  readonly serverName: string
  readonly displayName: string
  readonly toolCatalog: PluginToolCatalog
}

export interface PluginRuntimeProcessPort {
  isReady(): boolean
  isRunning(serverName: string): boolean
  isActive(serverName: string): boolean
  start(serverName: string, configOverride?: Partial<MCPServerConfig>): Promise<void>
  stop(serverName: string, mode: 'normal' | 'shutdown'): Promise<void>
}

type RuntimeEntry = {
  registration: PluginOwnedServerRegistration
  state: PluginRuntimeLifecycleState
  ready: boolean
  retiring: boolean
  adapterCleanupRequired: boolean
  activeSentinel?: PluginRuntimeSentinel
  quarantine?: PluginRuntimeSentinel
  integrityError?: string
  lastError?: string
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const LAUNCH_CONTEXT_KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,63}$/
const MAX_LAUNCH_CONTEXT_ENTRIES = 16
const MAX_LAUNCH_CONTEXT_VALUE_LENGTH = 4096

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseLaunchContext = (value: unknown): PluginRuntimeLaunchContext | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (!isRecord(value)) {
    throw new Error('Plugin runtime launch context must be an object')
  }
  const entries = Object.entries(value)
  if (
    entries.length === 0 ||
    entries.length > MAX_LAUNCH_CONTEXT_ENTRIES ||
    entries.some(
      ([key, item]) =>
        !LAUNCH_CONTEXT_KEY_PATTERN.test(key) ||
        typeof item !== 'string' ||
        !item ||
        item.length > MAX_LAUNCH_CONTEXT_VALUE_LENGTH
    )
  ) {
    throw new Error('Plugin runtime launch context is invalid')
  }
  return Object.freeze(Object.fromEntries(entries) as Record<string, string>)
}

const safetyKey = (registration: PluginOwnedServerRegistration): string =>
  JSON.stringify([
    registration.pluginId,
    registration.runtimeId ?? registration.serverName,
    registration.serverName
  ])

const parseSentinel = (
  value: unknown,
  registration: PluginOwnedServerRegistration
): PluginRuntimeSentinel => {
  if (!isRecord(value) || !isRecord(value.fingerprint)) {
    throw new Error(
      `Plugin runtime safety evidence is corrupt for "${registration.serverName}"; runtime start is blocked`
    )
  }
  const fingerprint = value.fingerprint
  const expectedRuntimeId = registration.runtimeId ?? registration.serverName
  let launchContext: PluginRuntimeLaunchContext | undefined
  try {
    launchContext = parseLaunchContext(value.launchContext)
  } catch {
    throw new Error(
      `Plugin runtime safety evidence has invalid launch context for "${registration.serverName}"; runtime start is blocked`
    )
  }
  if (
    value.schemaVersion !== 1 ||
    typeof value.attemptId !== 'string' ||
    !UUID_PATTERN.test(value.attemptId) ||
    value.pluginId !== registration.pluginId ||
    value.runtimeId !== expectedRuntimeId ||
    value.serverName !== registration.serverName ||
    typeof value.recordedAt !== 'number' ||
    !Number.isSafeInteger(value.recordedAt) ||
    value.recordedAt <= 0 ||
    typeof fingerprint.value !== 'string' ||
    !SHA256_PATTERN.test(fingerprint.value) ||
    fingerprint.pluginId !== registration.pluginId ||
    fingerprint.runtimeId !== expectedRuntimeId ||
    typeof fingerprint.target !== 'string' ||
    !fingerprint.target ||
    fingerprint.target !== fingerprint.target.trim() ||
    typeof fingerprint.binarySha256 !== 'string' ||
    !SHA256_PATTERN.test(fingerprint.binarySha256)
  ) {
    throw new Error(
      `Plugin runtime safety evidence is invalid for "${registration.serverName}"; runtime start is blocked`
    )
  }
  return {
    schemaVersion: 1,
    attemptId: value.attemptId,
    pluginId: registration.pluginId,
    runtimeId: expectedRuntimeId,
    serverName: registration.serverName,
    fingerprint: {
      value: fingerprint.value,
      pluginId: registration.pluginId,
      runtimeId: expectedRuntimeId,
      target: fingerprint.target,
      binarySha256: fingerprint.binarySha256
    },
    ...(launchContext ? { launchContext } : {}),
    recordedAt: value.recordedAt
  }
}

export class PluginRuntimeQuarantinedError extends Error {
  constructor(
    readonly serverName: string,
    readonly sentinel: PluginRuntimeSentinel
  ) {
    super(
      `Plugin runtime server "${serverName}" is quarantined after an unclean exit; use Retry runtime to authorize one controlled attempt`
    )
    this.name = 'PluginRuntimeQuarantinedError'
  }
}

export class PluginRuntimeSupervisor {
  private readonly entries = new Map<string, RuntimeEntry>()
  private readonly startPromises = new Map<string, Promise<void>>()
  private readonly stopPromises = new Map<string, Promise<void>>()
  private readonly adapterStopPromises = new Map<string, Promise<void>>()
  private readonly probePromises = new Map<string, Promise<void>>()
  private readonly registryListeners = new Set<() => void>()
  private processPort?: PluginRuntimeProcessPort
  private safetyStore?: PluginRuntimeSafetyStore
  private shuttingDown = false

  attachSafetyStore(safetyStore: PluginRuntimeSafetyStore): void {
    if (this.safetyStore && this.safetyStore !== safetyStore) {
      throw new Error('Plugin runtime safety store is already attached')
    }
    this.safetyStore = safetyStore
  }

  attachProcessPort(processPort: PluginRuntimeProcessPort): void {
    if (this.processPort && this.processPort !== processPort) {
      throw new Error('Plugin runtime process port is already attached')
    }
    this.processPort = processPort
  }

  subscribeRegistryChanged(listener: () => void): () => void {
    this.registryListeners.add(listener)
    return () => this.registryListeners.delete(listener)
  }

  registerServer(
    registration: PluginOwnedServerRegistration,
    options: { ready?: boolean } = {}
  ): void {
    if (this.shuttingDown) {
      throw new Error('Plugin runtime supervisor is shutting down')
    }
    const serverName = registration.serverName.trim()
    const pluginId = registration.pluginId.trim()
    if (!serverName || !pluginId) {
      throw new Error('Plugin runtime registration requires pluginId and serverName')
    }
    if (
      registration.startMode === 'onDemand' &&
      (registration.surfaces.length !== 1 ||
        registration.surfaces[0] !== 'tools' ||
        !registration.toolCatalog)
    ) {
      throw new Error(
        `On-demand plugin runtime server "${serverName}" requires a tools-only static catalog`
      )
    }
    if (registration.launchGuard && (!registration.runtimeId?.trim() || !this.safetyStore)) {
      throw new Error(
        `Guarded plugin runtime server "${serverName}" requires a runtimeId and persistent safety store`
      )
    }

    const existing = this.entries.get(serverName)
    if (existing) {
      const detail =
        existing.registration.pluginId === pluginId
          ? 'already has an active registration'
          : `is already registered by ${existing.registration.pluginId}`
      throw new Error(`Plugin-owned MCP server "${serverName}" ${detail}`)
    }

    const normalizedRegistration = {
      ...registration,
      pluginId,
      serverName,
      runtimeId: registration.runtimeId?.trim(),
      surfaces: [...registration.surfaces]
    }
    const quarantine = registration.launchGuard
      ? this.readSentinel(normalizedRegistration)
      : undefined
    this.entries.set(serverName, {
      registration: normalizedRegistration,
      state: quarantine ? 'quarantined' : 'registered',
      ready: options.ready ?? true,
      retiring: false,
      adapterCleanupRequired: false,
      quarantine
    })
    this.notifyRegistryChanged()
  }

  ownsServer(serverName: string): boolean {
    return this.entries.has(serverName)
  }

  isServerAvailable(serverName: string): boolean {
    const entry = this.entries.get(serverName)
    return Boolean(entry?.ready && !entry.retiring && !this.shuttingDown)
  }

  getRegistration(serverName: string): PluginOwnedServerRegistration | undefined {
    const entry = this.entries.get(serverName)
    return entry && entry.ready && !entry.retiring && !this.shuttingDown
      ? {
          ...entry.registration,
          surfaces: [...entry.registration.surfaces]
        }
      : undefined
  }

  getOwnerPluginId(serverName: string): string | undefined {
    return this.entries.get(serverName)?.registration.pluginId
  }

  getAvailableToolCatalogs(): PluginOwnedToolCatalogRegistration[] {
    if (this.shuttingDown) {
      return []
    }
    return Array.from(this.entries.values()).flatMap((entry) => {
      const { registration } = entry
      if (
        !entry.ready ||
        entry.retiring ||
        registration.startMode !== 'onDemand' ||
        !registration.toolCatalog
      ) {
        return []
      }
      return [
        {
          pluginId: registration.pluginId,
          serverName: registration.serverName,
          displayName: registration.displayName ?? registration.serverName,
          toolCatalog: registration.toolCatalog
        }
      ]
    })
  }

  getAvailableToolServerNames(): string[] {
    if (this.shuttingDown) {
      return []
    }
    return Array.from(this.entries.values()).flatMap((entry) => {
      const { registration } = entry
      return entry.ready && !entry.retiring && registration.surfaces.includes('tools')
        ? [registration.serverName]
        : []
    })
  }

  commitPluginRegistration(pluginId: string): void {
    let changed = false
    for (const entry of this.entries.values()) {
      if (entry.registration.pluginId === pluginId && !entry.retiring && !entry.ready) {
        entry.ready = true
        changed = true
      }
    }
    if (changed) {
      this.notifyRegistryChanged()
    }
  }

  getState(serverName: string):
    | {
        state: PluginRuntimeLifecycleState
        lastError?: string
        quarantine?: PluginRuntimeSentinel
        integrityError?: string
      }
    | undefined {
    const entry = this.entries.get(serverName)
    return entry
      ? {
          state: entry.state,
          lastError: entry.lastError,
          ...(entry.quarantine ? { quarantine: entry.quarantine } : {}),
          ...(entry.integrityError ? { integrityError: entry.integrityError } : {})
        }
      : undefined
  }

  async reconcileAll(): Promise<void> {
    if (!this.processPort?.isReady()) {
      return
    }
    const registrations = Array.from(this.entries.values())
      .filter((entry) => entry.ready && !entry.retiring)
      .map((entry) => entry.registration)
      .filter((registration) => registration.startMode === 'eager')
    await this.reconcileRegistrations(registrations, 'Failed to reconcile eager plugin runtimes')
  }

  async reconcilePlugin(pluginId: string): Promise<void> {
    if (!this.processPort?.isReady()) {
      return
    }
    const eagerServers = Array.from(this.entries.values())
      .filter((entry) => entry.ready && !entry.retiring)
      .map((entry) => entry.registration)
      .filter(
        (registration) => registration.pluginId === pluginId && registration.startMode === 'eager'
      )
    await this.reconcileRegistrations(
      eagerServers,
      `Failed to reconcile plugin runtimes for ${pluginId}`
    )
  }

  async ensureRunning(serverName: string, reason: PluginRuntimeStartReason): Promise<void> {
    if (this.probePromises.has(serverName)) {
      await this.waitForRuntimeProbe(serverName, true)
    }
    await this.ensureRunningAuthorized(serverName, reason, false)
  }

  private async ensureRunningAuthorized(
    serverName: string,
    reason: PluginRuntimeStartReason,
    allowQuarantinedFingerprint: boolean
  ): Promise<void> {
    let entry = this.getStartableEntry(serverName)
    const processPort = this.getProcessPort()
    if (!processPort.isReady()) {
      throw new Error(`Plugin runtime server "${serverName}" cannot start before MCP is ready`)
    }

    const stopping = this.stopPromises.get(serverName)
    if (stopping) {
      await stopping
      entry = this.getStartableEntry(serverName)
    }
    const existingStart = this.startPromises.get(serverName)
    if (existingStart) {
      return await existingStart
    }
    if (entry.quarantine && processPort.isActive(serverName)) {
      const error = new PluginRuntimeQuarantinedError(serverName, entry.quarantine)
      entry.state = 'quarantined'
      entry.lastError = error.message
      throw error
    }
    if (processPort.isRunning(serverName)) {
      entry.state = 'running'
      entry.lastError = undefined
      return
    }
    if (processPort.isActive(serverName)) {
      const error = new Error(
        `Plugin runtime server "${serverName}" still has an active process from an incomplete transition`
      )
      entry.state = 'error'
      entry.lastError = error.message
      throw error
    }

    const startPromise = this.startEntry(entry, reason, allowQuarantinedFingerprint)
    this.startPromises.set(serverName, startPromise)
    try {
      await startPromise
    } finally {
      if (this.startPromises.get(serverName) === startPromise) {
        this.startPromises.delete(serverName)
      }
    }
  }

  async requestExternalStart(serverName: string): Promise<void> {
    const registration = this.getStartableEntry(serverName).registration
    if (registration.startMode === 'onDemand') {
      throw new Error(
        `Plugin runtime server "${serverName}" is on-demand; use a plugin runtime test or invoke one of its tools`
      )
    }
    await this.ensureRunning(serverName, 'external')
  }

  async requestExternalStop(serverName: string): Promise<void> {
    if (!this.entries.has(serverName)) {
      throw new Error(`Plugin runtime server "${serverName}" is not registered`)
    }
    await this.stopServer(serverName)
  }

  async testRuntime(pluginId: string, serverName: string): Promise<void> {
    await this.runRuntimeProbe(serverName, async () => {
      const entry = this.getPluginStartableEntry(pluginId, serverName)
      if (entry.registration.startMode !== 'onDemand') {
        throw new Error(`Plugin runtime server "${serverName}" is not an on-demand runtime`)
      }
      const processPort = this.getProcessPort()
      const alreadyActive = processPort.isActive(serverName) || this.startPromises.has(serverName)
      await this.ensureRunningAuthorized(serverName, 'runtime-test', false)
      if (!alreadyActive) {
        await this.stopServer(serverName)
      }
    })
  }

  async retryRuntime(pluginId: string, serverName: string): Promise<void> {
    await this.runRuntimeProbe(serverName, async () => {
      const entry = this.getPluginStartableEntry(pluginId, serverName)
      if (!entry.quarantine) {
        throw new Error(`Plugin runtime server "${serverName}" is not quarantined`)
      }
      if (entry.integrityError) {
        throw new Error(
          `Plugin runtime server "${serverName}" failed integrity verification and cannot be retried; repair or reinstall it first: ${entry.integrityError}`
        )
      }
      const processPort = this.getProcessPort()
      if (
        processPort.isActive(serverName) ||
        this.startPromises.has(serverName) ||
        entry.adapterCleanupRequired
      ) {
        await this.stopServer(serverName)
      }
      if (!entry.registration.launchGuard) {
        throw new Error(`Plugin runtime server "${serverName}" does not support controlled retry`)
      }
      await this.ensureRunningAuthorized(serverName, 'runtime-test', true)
      await this.stopServer(serverName)
    })
  }

  async restartIfRunning(
    serverName: string,
    reason: Extract<PluginRuntimeStartReason, 'authentication' | 'configuration'>
  ): Promise<boolean> {
    const processPort = this.processPort
    const entry = this.entries.get(serverName)
    if (!entry) {
      return false
    }
    if (entry.retiring) {
      return true
    }
    if (
      !processPort ||
      (!processPort.isActive(serverName) && !this.startPromises.has(serverName))
    ) {
      if (entry.registration.startMode === 'eager') {
        await this.ensureRunning(serverName, reason)
      }
      return true
    }
    await this.stopServer(serverName)
    await this.ensureRunning(serverName, reason)
    return true
  }

  async unregisterPlugin(pluginId: string): Promise<void> {
    const entries = Array.from(this.entries.values()).filter(
      (entry) => entry.registration.pluginId === pluginId
    )
    for (const entry of entries) {
      entry.retiring = true
    }
    if (entries.length > 0) {
      this.notifyRegistryChanged()
    }

    const errors: unknown[] = []
    for (const entry of entries) {
      const { serverName } = entry.registration
      try {
        await this.stopServer(serverName)
        if (this.entries.get(serverName) === entry) {
          this.entries.delete(serverName)
        }
      } catch (error) {
        errors.push(error)
      }
    }
    if (entries.length > 0) {
      this.notifyRegistryChanged()
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `Failed to stop plugin runtime servers for ${pluginId}`)
    }
  }

  async shutdown(): Promise<void> {
    if (!this.shuttingDown) {
      this.shuttingDown = true
      if (this.entries.size > 0) {
        this.notifyRegistryChanged()
      }
    }
    const serverNames = Array.from(this.entries.keys())
    const results = await Promise.allSettled(
      serverNames.map((serverName) => this.stopServer(serverName, 'shutdown'))
    )
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Failed to stop all plugin runtime servers')
    }
  }

  private async startEntry(
    entry: RuntimeEntry,
    reason: PluginRuntimeStartReason,
    allowQuarantinedFingerprint: boolean
  ): Promise<void> {
    const processPort = this.getProcessPort()
    const { registration } = entry
    entry.state = 'starting'
    entry.lastError = undefined

    try {
      const initialFingerprint = registration.adapter
        ? await this.verifyLaunchArtifacts(entry)
        : undefined
      if (initialFingerprint) {
        await this.authorizeGuardedSpawn(entry, initialFingerprint, allowQuarantinedFingerprint)
      }
      if (registration.adapter) {
        entry.adapterCleanupRequired = true
      }
      const launch = await registration.adapter?.start(
        reason,
        entry.activeSentinel
          ? {
              updateLaunchContext: (context) =>
                this.updateActiveSentinelLaunchContext(entry, context)
            }
          : undefined
      )
      if (entry.retiring || this.shuttingDown) {
        throw new Error(
          `Plugin runtime server "${registration.serverName}" was stopped during startup`
        )
      }
      // The adapter spawn and the stdio proxy spawn are separate execution
      // boundaries. Re-verify the complete launch artifact contract here so a
      // replacement during daemon startup cannot become the proxy executable.
      const proxyFingerprint = await this.verifyLaunchArtifacts(entry)
      if (proxyFingerprint && !initialFingerprint) {
        await this.authorizeGuardedSpawn(entry, proxyFingerprint, allowQuarantinedFingerprint)
      }
      if (
        initialFingerprint &&
        proxyFingerprint &&
        initialFingerprint.value !== proxyFingerprint.value
      ) {
        throw this.integrityFailure(
          entry,
          `Plugin runtime server "${registration.serverName}" changed between launch checks`
        )
      }
      await processPort.start(registration.serverName, launch?.configOverride)
      if (!processPort.isRunning(registration.serverName)) {
        throw new Error(
          `Plugin runtime server "${registration.serverName}" did not reach running state`
        )
      }
      entry.state = 'running'
    } catch (error) {
      const cleanupErrors: unknown[] = []
      if (processPort.isActive(registration.serverName)) {
        try {
          await processPort.stop(registration.serverName, 'normal')
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      if (registration.adapter) {
        try {
          await this.stopAdapter(entry)
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      if (!(error instanceof PluginRuntimeQuarantinedError) && cleanupErrors.length === 0) {
        try {
          this.clearActiveSentinel(entry)
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      if (cleanupErrors.length > 0 && entry.activeSentinel) {
        entry.quarantine = entry.activeSentinel
      }
      entry.state =
        (error instanceof PluginRuntimeQuarantinedError && cleanupErrors.length === 0) ||
        entry.quarantine
          ? 'quarantined'
          : 'error'
      if (cleanupErrors.length > 0) {
        const aggregateError = new AggregateError(
          [error, ...cleanupErrors],
          `Plugin runtime server "${registration.serverName}" failed to start and cleanup was incomplete`
        )
        entry.lastError = aggregateError.message
        throw aggregateError
      }
      entry.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  private async stopServer(
    serverName: string,
    mode: 'normal' | 'shutdown' = 'normal'
  ): Promise<void> {
    const entry = this.entries.get(serverName)
    if (!entry) {
      return
    }
    const existingStop = this.stopPromises.get(serverName)
    if (existingStop) {
      if (mode === 'shutdown') {
        await this.escalateStopForShutdown(entry, existingStop)
        return
      }
      return await existingStop
    }

    const stopPromise = this.stopEntry(entry, mode)
    this.stopPromises.set(serverName, stopPromise)
    try {
      await stopPromise
    } finally {
      if (this.stopPromises.get(serverName) === stopPromise) {
        this.stopPromises.delete(serverName)
      }
    }
  }

  private async stopEntry(entry: RuntimeEntry, mode: 'normal' | 'shutdown'): Promise<void> {
    const { registration } = entry
    const startPromise = this.startPromises.get(registration.serverName)
    if (startPromise) {
      await startPromise.catch(() => undefined)
    }

    const processPort = this.processPort
    const errors: unknown[] = []
    entry.state = 'stopping'
    if (processPort?.isActive(registration.serverName)) {
      try {
        await processPort.stop(registration.serverName, mode)
      } catch (error) {
        errors.push(error)
      }
    }
    if (registration.adapter && entry.adapterCleanupRequired) {
      try {
        await this.stopAdapter(entry)
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length === 0) {
      try {
        this.clearActiveSentinel(entry)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) {
      if (entry.activeSentinel) {
        entry.quarantine = entry.activeSentinel
      }
      entry.state = entry.quarantine ? 'quarantined' : 'error'
      entry.lastError = errors.map((error) => String(error)).join('; ')
      throw new AggregateError(
        errors,
        `Plugin runtime server "${registration.serverName}" failed to stop cleanly`
      )
    }
    entry.state = entry.quarantine ? 'quarantined' : 'stopped'
    entry.lastError = undefined
  }

  private async authorizeGuardedSpawn(
    entry: RuntimeEntry,
    fingerprint: PluginRuntimeFingerprint,
    allowQuarantinedFingerprint: boolean
  ): Promise<void> {
    const { registration } = entry
    const expectedRuntimeId = registration.runtimeId ?? registration.serverName
    if (
      fingerprint.pluginId !== registration.pluginId ||
      fingerprint.runtimeId !== expectedRuntimeId ||
      !SHA256_PATTERN.test(fingerprint.value) ||
      !SHA256_PATTERN.test(fingerprint.binarySha256) ||
      typeof fingerprint.target !== 'string' ||
      !fingerprint.target.trim() ||
      fingerprint.target !== fingerprint.target.trim()
    ) {
      throw this.integrityFailure(
        entry,
        `Plugin runtime launch fingerprint does not match registration "${registration.serverName}"`
      )
    }

    const previous = this.readSentinel(registration)
    if (previous?.fingerprint.value === fingerprint.value && !allowQuarantinedFingerprint) {
      entry.quarantine = previous
      throw new PluginRuntimeQuarantinedError(registration.serverName, previous)
    }
    if (previous?.launchContext) {
      const recoverStaleLaunch = registration.adapter?.recoverStaleLaunch
      if (!recoverStaleLaunch) {
        throw new Error(
          `Plugin runtime server "${registration.serverName}" cannot safely recover its stale launch context`
        )
      }
      await recoverStaleLaunch.call(registration.adapter, previous.launchContext)
    }

    const sentinel: PluginRuntimeSentinel = {
      schemaVersion: 1,
      attemptId: randomUUID(),
      pluginId: registration.pluginId,
      runtimeId: expectedRuntimeId,
      serverName: registration.serverName,
      fingerprint: { ...fingerprint },
      recordedAt: Date.now()
    }
    this.getSafetyStore().write(safetyKey(registration), sentinel)
    entry.activeSentinel = sentinel
    entry.quarantine = undefined
  }

  private async verifyLaunchArtifacts(
    entry: RuntimeEntry
  ): Promise<PluginRuntimeFingerprint | undefined> {
    const { launchGuard, serverName } = entry.registration
    if (!launchGuard) {
      return undefined
    }
    try {
      const fingerprint = await launchGuard.verify()
      entry.integrityError = undefined
      return fingerprint
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      entry.integrityError = this.formatIntegrityError(serverName, detail)
      throw error
    }
  }

  private integrityFailure(entry: RuntimeEntry, detail: string): Error {
    entry.integrityError = this.formatIntegrityError(entry.registration.serverName, detail)
    return new Error(detail)
  }

  private formatIntegrityError(serverName: string, detail: string): string {
    return `Plugin runtime server "${serverName}" failed integrity verification: ${detail}`
  }

  private updateActiveSentinelLaunchContext(
    entry: RuntimeEntry,
    context: PluginRuntimeLaunchContext
  ): void {
    const active = entry.activeSentinel
    if (!active) {
      throw new Error(
        `Plugin runtime server "${entry.registration.serverName}" cannot persist launch context before authorization`
      )
    }
    const launchContext = parseLaunchContext(context)
    if (!launchContext) {
      throw new Error('Plugin runtime launch context is required')
    }
    const next: PluginRuntimeSentinel = {
      ...active,
      launchContext
    }
    this.getSafetyStore().write(safetyKey(entry.registration), next)
    entry.activeSentinel = next
  }

  private readSentinel(
    registration: PluginOwnedServerRegistration
  ): PluginRuntimeSentinel | undefined {
    const raw = this.getSafetyStore().read(safetyKey(registration))
    return raw === undefined ? undefined : parseSentinel(raw, registration)
  }

  private clearActiveSentinel(entry: RuntimeEntry): void {
    const active = entry.activeSentinel
    if (!active) {
      return
    }
    const key = safetyKey(entry.registration)
    const persisted = this.readSentinel(entry.registration)
    if (
      persisted?.fingerprint.value === active.fingerprint.value &&
      persisted.attemptId === active.attemptId
    ) {
      this.getSafetyStore().remove(key)
      if (entry.quarantine?.attemptId === active.attemptId) {
        entry.quarantine = undefined
      }
    } else if (persisted) {
      entry.quarantine = persisted
    }
    entry.activeSentinel = undefined
  }

  private async waitForRuntimeProbe(serverName: string, propagateFailure = false): Promise<void> {
    let probe = this.probePromises.get(serverName)
    while (probe) {
      if (propagateFailure) {
        await probe
      } else {
        await probe.catch(() => undefined)
      }
      probe = this.probePromises.get(serverName)
    }
  }

  private async runRuntimeProbe(serverName: string, operation: () => Promise<void>): Promise<void> {
    if (this.probePromises.has(serverName)) {
      await this.waitForRuntimeProbe(serverName)
    }
    const probe = operation()
    this.probePromises.set(serverName, probe)
    try {
      await probe
    } finally {
      if (this.probePromises.get(serverName) === probe) {
        this.probePromises.delete(serverName)
      }
    }
  }

  private getSafetyStore(): PluginRuntimeSafetyStore {
    if (!this.safetyStore) {
      throw new Error('Plugin runtime persistent safety store is not attached')
    }
    return this.safetyStore
  }

  private getProcessPort(): PluginRuntimeProcessPort {
    if (!this.processPort) {
      throw new Error('Plugin runtime process port is not attached')
    }
    return this.processPort
  }

  private getStartableEntry(serverName: string): RuntimeEntry {
    if (this.shuttingDown) {
      throw new Error('Plugin runtime supervisor is shutting down')
    }
    const entry = this.entries.get(serverName)
    if (!entry) {
      throw new Error(`Plugin runtime server "${serverName}" is not registered`)
    }
    if (entry.retiring) {
      throw new Error(`Plugin runtime server "${serverName}" is being disabled`)
    }
    if (!entry.ready) {
      throw new Error(`Plugin runtime server "${serverName}" registration is not ready`)
    }
    return entry
  }

  private getPluginStartableEntry(pluginId: string, serverName: string): RuntimeEntry {
    const entry = this.getStartableEntry(serverName)
    if (entry.registration.pluginId !== pluginId) {
      throw new Error(
        `Plugin ${pluginId} does not own runtime server "${serverName}"; runtime action is blocked`
      )
    }
    return entry
  }

  private async escalateStopForShutdown(
    entry: RuntimeEntry,
    existingStop: Promise<void>
  ): Promise<void> {
    const processPort = this.processPort
    const { serverName } = entry.registration
    if (!processPort?.isActive(serverName)) {
      await existingStop
      return
    }

    const winner = await Promise.race([
      existingStop.then(() => 'existing' as const),
      processPort.stop(serverName, 'shutdown').then(() => 'escalated' as const)
    ])
    if (winner === 'existing') {
      return
    }

    await this.stopAdapter(entry)
    this.clearActiveSentinel(entry)
    entry.state = entry.quarantine ? 'quarantined' : 'stopped'
    entry.lastError = undefined
  }

  private async stopAdapter(entry: RuntimeEntry): Promise<void> {
    const { adapter, serverName } = entry.registration
    if (!adapter || !entry.adapterCleanupRequired) {
      return
    }
    const existingStop = this.adapterStopPromises.get(serverName)
    if (existingStop) {
      return await existingStop
    }

    const stopPromise = (async () => {
      await adapter.stop()
      entry.adapterCleanupRequired = false
    })()
    this.adapterStopPromises.set(serverName, stopPromise)
    try {
      await stopPromise
    } finally {
      if (this.adapterStopPromises.get(serverName) === stopPromise) {
        this.adapterStopPromises.delete(serverName)
      }
    }
  }

  private async reconcileRegistrations(
    registrations: PluginOwnedServerRegistration[],
    aggregateMessage: string
  ): Promise<void> {
    const results = await Promise.allSettled(
      registrations.map((registration) => this.ensureRunning(registration.serverName, 'reconcile'))
    )
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    if (errors.length > 0) {
      throw new AggregateError(errors, aggregateMessage)
    }
  }

  private notifyRegistryChanged(): void {
    for (const listener of this.registryListeners) {
      try {
        listener()
      } catch (error) {
        console.error('[PluginRuntimeSupervisor] Registry listener failed:', error)
      }
    }
  }
}
