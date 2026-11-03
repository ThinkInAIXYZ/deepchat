import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { deserialize, serialize } from 'node:v8'
import logger from '@shared/logger'
import {
  CoreDesktopArguments,
  CoreDesktopCapabilitiesSchema,
  CoreDesktopEventSchema,
  CoreWindowTargetSchema,
  CoreProxySnapshotSchema,
  type CoreDesktopCommand,
  type CoreDesktopMethod
} from '@shared/harness/desktop'
import type { CoreKernelNative } from './kernel'
import { CORE_VALUE_BYTES, CORE_PRESENTATION_QUEUED } from '@shared/harness/core'
import type { RemoteAuthWindowEvent } from '@/remote/ports'
import { computerUseSetPreviewModeRoute } from '@shared/contracts/routes'
import { startupWorkloadChangedEvent, liveDelegationChangedEvent } from '@shared/contracts/events'

type Watch = {
  id: string
  webContentsId: number
  listeners: Set<() => void>
  registration: Promise<unknown>
  destroyed: boolean
}
type Retirement = {
  kind: 'calls' | 'watches' | 'settledCalls'
  id: string
  receipt: ReturnType<typeof Promise.withResolvers<void>>
}

export class CoreNativeDesktop {
  private readonly pending = new Set<Promise<unknown>>()
  private readonly watches = new Map<string, Watch>()
  private readonly byRenderer = new Map<number, Watch>()
  private readonly authWindows = new Set<string>()
  private readonly retirements: Retirement[] = []
  private retiring = false
  private closing: Promise<void> | undefined
  private eventTail: Promise<void> = Promise.resolve()
  private eventCount = 0
  private eventBytes = 0
  private readonly snapshots = new Map<
    string,
    {
      snapshot: unknown[]
      bytes: number
      operation: Promise<unknown>
      version?: { revision: number; updatedAt: number }
    }
  >()
  private failure: Error | undefined
  private retired = false
  private used = false

  constructor(
    private readonly invoke: (command: CoreDesktopCommand) => Promise<unknown>,
    private readonly remoteEvent: (event: RemoteAuthWindowEvent) => void,
    private readonly failed: (error: Error) => void
  ) {}

  async createPorts(paths: {
    temporaryDirectory: string
    profileDirectory: string
  }): Promise<CoreKernelNative> {
    this.used = true
    const capabilities = CoreDesktopCapabilitiesSchema.parse(
      await this.invoke({ operation: 'capabilities' })
    )
    const ports: Record<string, unknown> = {}
    for (const method of Object.keys(CoreDesktopArguments) as CoreDesktopMethod[]) {
      const parts = method.split('.')
      let target = ports
      for (const part of parts.slice(0, -1))
        target = (target[part] ??= {}) as Record<string, unknown>
      const event =
        method.startsWith('renderer.') ||
        method === 'sendToRenderer' ||
        method === 'publishMcpConsent' ||
        method === 'observeDelegation' ||
        method === 'runJournalObserver' ||
        method === 'mcpReadinessChanged' ||
        method === 'reportStartupFailure' ||
        method === 'onSessionInactive' ||
        method.startsWith('semanticNotifications.') ||
        (method.startsWith('mcpPreview.') && method !== 'mcpPreview.shouldCaptureAfterClick')
      target[parts.at(-1)!] = (...args: unknown[]) => {
        let signal: AbortSignal | undefined
        if (
          (method === 'fetchRegistryIcon' ||
            method === 'agentDesktop.readImageSize' ||
            (method === 'approvalPresentation.present' && args.length === 3) ||
            method.startsWith('copilotAuthorization.')) &&
          args.length > 1
        )
          signal = args.pop() as AbortSignal | undefined
        if (method === 'cacheImage') {
          const options = args[1] as
            | { signal?: AbortSignal; allowPrivateNetwork?: boolean }
            | undefined
          signal = options?.signal
          args[1] = options ? { allowPrivateNetwork: options.allowPrivateNetwork } : undefined
        }
        if (event) {
          const delivery = this.enqueue(method, args)
          // Renderer updates must not retain one Promise waiter per coalesced publication.
          return method.startsWith('renderer.') ? undefined : delivery
        }
        return this.call(method, args, signal)
      }
    }
    const native = ports as unknown as CoreKernelNative
    Object.assign(native.agentDesktop, {
      tempDirectory: paths.temporaryDirectory,
      profileTempDirectory: path.join(paths.profileDirectory, 'temp')
    })
    native.onRendererDestroyed = (webContentsId, listener) => {
      if (this.closing || this.failure) throw this.failure ?? new Error('Core desktop is stopping')
      let watch = this.byRenderer.get(webContentsId)
      if (watch?.destroyed) {
        listener()
        return () => {}
      }
      if (!watch) {
        watch = {
          id: randomUUID(),
          webContentsId,
          listeners: new Set([listener]),
          registration: Promise.resolve(),
          destroyed: false
        }
        this.byRenderer.set(webContentsId, watch)
        this.watches.set(watch.id, watch)
        watch.registration = this.invoke({ operation: 'watch', id: watch.id, webContentsId })
        void watch.registration.catch((error) => this.fail(error))
      }
      watch.listeners.add(listener)
      const owned = watch
      return () => {
        owned.listeners.delete(listener)
        if (owned.listeners.size || this.byRenderer.get(webContentsId) !== owned) return
        this.byRenderer.delete(webContentsId)
        void owned.registration
          .then(() => this.retire('watches', owned.id))
          .then(
            () => this.watches.delete(owned.id),
            (error) => this.fail(error)
          )
      }
    }
    const openAuth = native.remoteAuthWindows.open
    native.remoteAuthWindows.open = async (input) => {
      this.authWindows.add(input.id)
      try {
        await openAuth(input)
      } catch (error) {
        this.authWindows.delete(input.id)
        throw error
      }
    }
    if (!capabilities.preview) native.mcpPreview = undefined
    if (!capabilities.journal) native.runJournalObserver = undefined
    return native
  }

  accept(input: unknown): void {
    const event = CoreDesktopEventSchema.parse(input)
    if (event.type === 'desktop.remoteAuthWindow') {
      if (!this.authWindows.has(event.event.id))
        throw this.fail(new Error('Unknown Native auth window'))
      this.remoteEvent(event.event)
      if (event.event.type === 'closed') this.authWindows.delete(event.event.id)
      return
    }
    const watch = this.watches.get(event.id)
    if (!watch) throw this.fail(new Error('Unknown Native renderer subscription'))
    if (watch.destroyed) throw this.fail(new Error('Repeated Native renderer destruction'))
    watch.destroyed = true
    watch.listeners.forEach((listener) => listener())
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    if (!this.used) return Promise.resolve()
    this.closing = (async () => {
      await this.invoke({ operation: 'close' })
      this.retired = true
      for (const retirement of this.retirements.splice(0)) retirement.receipt.resolve()
      await Promise.allSettled(this.pending)
      await this.eventTail
      this.watches.clear()
      this.byRenderer.clear()
      this.authWindows.clear()
    })()
    return this.closing
  }

  private call(method: CoreDesktopMethod, args: unknown[], signal?: AbortSignal): Promise<unknown> {
    if (this.failure || this.closing)
      return Promise.reject(this.failure ?? new Error('Core desktop is stopping'))
    signal?.throwIfAborted()
    const id = randomUUID()
    let retirement: Promise<void> | undefined
    const abort = () => {
      retirement ??= this.retire('calls', id)
      void retirement.catch((error) => this.fail(error))
    }
    signal?.addEventListener('abort', abort, { once: true })
    const operation = (async () => {
      try {
        const result = await this.invoke({ operation: 'call', id, method, args })
        signal?.throwIfAborted()
        if (
          [
            'isSettingsWindow',
            'isMainWindowContext',
            'hasTrustedRenderer',
            'applyProxy',
            'remoteSessionWindow.present',
            'sessionPresentation.focusBrowser',
            'sessionPresentation.dismissComputerUsePreview'
          ].includes(method)
        )
          return z.boolean().parse(result)
        if (method === 'sessionPresentation.setComputerUsePreview')
          return computerUseSetPreviewModeRoute.output.parse(result)
        if (method === 'remoteSessionWindow.select')
          return CoreWindowTargetSchema.nullable().parse(result)
        if (method === 'getProxySnapshot') return CoreProxySnapshotSchema.parse(result)
        if (method === 'pluginSettingsWindow.getPluginIdForWebContents')
          return z.string().nullable().parse(result)
        return result
      } catch (error) {
        signal?.throwIfAborted()
        throw error
      } finally {
        signal?.removeEventListener('abort', abort)
        await retirement
        if (retirement) await this.retire('settledCalls', id)
      }
    })()
    this.pending.add(operation)
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation)
    )
    return operation
  }

  private enqueue(method: CoreDesktopMethod, args: unknown[]): Promise<unknown> {
    const encoded = serialize(args)
    let snapshotKey: string | undefined
    let version: { revision: number; updatedAt: number } | undefined
    if (method === 'renderer.broadcast') {
      const [event] = CoreDesktopArguments['renderer.broadcast'].parse(args)
      if (event.name === startupWorkloadChangedEvent.name)
        snapshotKey = JSON.stringify([
          event.name,
          startupWorkloadChangedEvent.payload.parse(event.payload).target
        ])
      else if (event.name === liveDelegationChangedEvent.name) {
        const payload = liveDelegationChangedEvent.payload.parse(event.payload)
        snapshotKey = JSON.stringify([event.name, payload.parentSessionId, payload.delegation.id])
        version = { revision: payload.delegation.revision, updatedAt: payload.delegation.updatedAt }
      }
    }
    const previous = snapshotKey ? this.snapshots.get(snapshotKey) : undefined
    if (previous) {
      if (
        version &&
        previous.version &&
        (previous.version.revision > version.revision ||
          (previous.version.revision === version.revision &&
            previous.version.updatedAt > version.updatedAt))
      )
        return previous.operation
      if (this.eventBytes - previous.bytes + encoded.length > CORE_VALUE_BYTES)
        throw this.fail(new Error('Core presentation queue exceeded'))
      this.eventBytes += encoded.length - previous.bytes
      previous.snapshot = deserialize(encoded)
      previous.bytes = encoded.length
      previous.version = version
      return previous.operation
    }
    if (
      this.eventCount >= CORE_PRESENTATION_QUEUED ||
      this.eventBytes + encoded.length > CORE_VALUE_BYTES
    )
      throw this.fail(new Error('Core presentation queue exceeded'))
    const entry = {
      snapshot: deserialize(encoded) as unknown[],
      bytes: encoded.length,
      version,
      operation: Promise.resolve<unknown>(undefined)
    }
    this.eventCount++
    this.eventBytes += encoded.length
    const operation = this.eventTail.then(async () => {
      if (snapshotKey && this.snapshots.get(snapshotKey) === entry)
        this.snapshots.delete(snapshotKey)
      try {
        return await this.call(method, entry.snapshot)
      } finally {
        this.eventCount--
        this.eventBytes -= entry.bytes
      }
    })
    entry.operation = operation
    if (snapshotKey) this.snapshots.set(snapshotKey, entry)
    this.eventTail = operation.then(
      () => {},
      (error) => logger.warn('[Core] Native presentation failed', { method, error })
    )
    return operation
  }

  private retire(kind: Retirement['kind'], id: string): Promise<void> {
    if (this.retired) return Promise.resolve()
    const receipt = Promise.withResolvers<void>()
    this.retirements.push({ kind, id, receipt })
    if (!this.retiring) {
      this.retiring = true
      queueMicrotask(() => {
        void this.retireBatch()
      })
    }
    return receipt.promise
  }

  private async retireBatch(): Promise<void> {
    try {
      while (this.retirements.length) {
        if (this.closing) {
          await this.closing
          continue
        }
        const batch = this.retirements.slice(0, 32)
        await this.invoke({
          operation: 'retire',
          calls: batch.filter((x) => x.kind === 'calls').map((x) => x.id),
          watches: batch.filter((x) => x.kind === 'watches').map((x) => x.id),
          settledCalls: batch.filter((x) => x.kind === 'settledCalls').map((x) => x.id)
        })
        this.retirements.splice(0, batch.length)
        for (const item of batch) item.receipt.resolve()
      }
    } catch (error) {
      for (const item of this.retirements.splice(0)) item.receipt.reject(error)
      this.fail(error)
    } finally {
      this.retiring = false
    }
  }

  private fail(input: unknown): Error {
    if (this.failure) return this.failure
    this.failure = input instanceof Error ? input : new Error('Core desktop failed')
    this.failed(this.failure)
    return this.failure
  }
}
