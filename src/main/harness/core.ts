import {
  CoreConfigurationCommandSchema,
  type CoreConfigurationCommand
} from '@shared/harness/configuration'
import { rm } from 'node:fs/promises'
import { deserialize, serialize } from 'node:v8'
import { z } from 'zod'
import { CoreHelperEventsSchema, type CoreHelperEvent } from '@shared/harness/helpers'
import { CoreBrowserEventSchema, type CoreBrowserEvent } from '@shared/harness/browser'
import { CoreDesktopEventSchema, type CoreDesktopEvent } from '@shared/harness/desktop'
import type { HarnessRuntime } from './runtime'
import type { RouteContext } from '@/routes/routeRegistry'
import type { CoreProfileHost } from '@/app/profileStartup'
import type { DatabaseSecurityCryptoPort } from '@/app/databaseSecurity'
import { DATABASE_STARTUP_FAILURE_KINDS } from '@shared/contracts/databaseSecurity'
import { CorePayloadStore } from '../../harness/core/payload'
import {
  CORE_ORDINARY_CALLS,
  CORE_ROUTE_QUEUED,
  CORE_CONTROL_CALLS,
  CORE_NATIVE_CALLS,
  CORE_NATIVE_QUEUED,
  CORE_VALUE_BYTES,
  isCoreNativeDrain,
  CoreStatusSchema,
  CoreKernelBootstrapSchema,
  CoreRouteInvocationSchema,
  isCoreControlRoute,
  type CoreKernelBootstrap,
  type CoreStatus,
  type CoreMethod,
  type CoreFrame,
  type CoreNativeMethod,
  type CorePayload,
  type CoreRequest
} from '@shared/harness/core'

type NativeHandler = (method: CoreNativeMethod, args: unknown) => Promise<unknown>

export function createCoreProfileNative(
  crypto: DatabaseSecurityCryptoPort,
  host: CoreProfileHost
): NativeHandler {
  return async (method, input) => {
    switch (method) {
      case 'crypto.available':
        z.tuple([]).parse(input)
        return await crypto.isAvailable()
      case 'crypto.backend':
        z.tuple([]).parse(input)
        return await crypto.getBackend()
      case 'crypto.encrypt':
        return await crypto.encrypt(...z.tuple([z.string()]).parse(input))
      case 'crypto.decrypt':
        return await crypto.decrypt(...z.tuple([z.string()]).parse(input))
      case 'profile.logging':
        return await host.setLoggingEnabled(...z.tuple([z.boolean()]).parse(input))
      case 'profile.progress':
        return await host.showDatabaseUnlockProgress(
          ...z
            .tuple([
              z.object({ active: z.boolean(), safeStorageAvailable: z.boolean() }).strict(),
              z.object({ skipDelay: z.boolean().optional() }).strict().optional()
            ])
            .parse(input)
        )
      case 'profile.unlock':
        return await host.requestDatabaseUnlock(
          ...z
            .tuple([
              z
                .object({
                  reason: z.enum([
                    'manual-required',
                    'safe-storage-unavailable',
                    'system-key-missing',
                    'invalid'
                  ]),
                  safeStorageAvailable: z.boolean()
                })
                .strict()
            ])
            .parse(input)
        )
      case 'profile.recovery':
        return await host.requestDatabaseRecovery(
          ...z
            .tuple([
              z
                .object({
                  kind: z.enum(DATABASE_STARTUP_FAILURE_KINDS),
                  preservedPath: z.string(),
                  invalidPassword: z.boolean().optional(),
                  quarantineFailed: z.boolean().optional()
                })
                .strict()
            ])
            .parse(input)
        )
      case 'profile.quit':
        z.tuple([]).parse(input)
        return await host.quit()
      default:
        throw new Error('Unsupported Native profile capability')
    }
  }
}

export class CoreRuntimeConnection {
  private readonly ready = Promise.withResolvers<CoreStatus>()
  private readonly pending = new Map<
    number,
    { method: CoreMethod; resolve(value: unknown): void; reject(error: Error): void }
  >()
  private readonly nativeCalls = new Set<Promise<void>>()
  private readonly nativeIds = new Set<number>()
  private nextNativeId = 1
  private identity: CoreStatus | undefined
  private send!: (request: CoreRequest) => void
  private nextId = 0
  private failure: Error | undefined
  private ordinary = 0
  private routeControl = 0
  private readonly routeQueues: Array<
    Array<{
      snapshot: Uint8Array
      assertCallerActive(): void
      resolve(value: unknown): void
      reject(error: Error): void
    }>
  > = [[], []]
  private routeQueued = 0
  private routeQueuedBytes = 0
  private control = 0
  private statusPending = false
  private themeObservationPending = false
  private nativeEventsPending = false
  private nativeEventTail: Promise<void> = Promise.resolve()
  private nativeEventQueued = 0
  private nativeEventBytes = 0
  private themeObservation: Promise<void> | undefined
  private themeObservationDirty = false
  private stopped = false
  private stopPromise: Promise<CoreStatus> | undefined

  private constructor(
    private readonly runtime: Pick<HarnessRuntime, 'connectCore' | 'stop'>,
    readonly payloads: CorePayloadStore,
    private readonly native: NativeHandler
  ) {}

  static async connect(options: {
    runtime: Pick<HarnessRuntime, 'connectCore' | 'stop'>
    temporaryDirectory: string
    native: NativeHandler
  }): Promise<CoreRuntimeConnection> {
    const payloads = await CorePayloadStore.create(options.temporaryDirectory)
    const connection = new CoreRuntimeConnection(options.runtime, payloads, options.native)
    try {
      connection.send = options.runtime.connectCore(payloads.config, {
        message: (frame) => connection.receive(frame),
        failed: (error) => connection.fail(error)
      })
      const timeout = setTimeout(() => connection.fail(new Error('Core startup timed out')), 15_000)
      timeout.unref()
      try {
        await connection.ready.promise
      } finally {
        clearTimeout(timeout)
      }
      return connection
    } catch (error) {
      if (error instanceof Error && error.name === 'CoreGenerationAlreadyAdoptedError') {
        await payloads.close()
        await rm(payloads.config.directory, { recursive: true, force: true })
        throw error
      }
      await options.runtime.stop()
      await connection.closeAfterHostExit()
      throw error
    }
  }

  async openProfile(options: {
    userDataDirectory: string
    homeDirectory: string
    currentAppVersion: string
    systemLocale: string
    appPath: string
    isPackaged: boolean
  }): Promise<CoreStatus> {
    return CoreStatusSchema.parse(await this.request('openProfile', options))
  }

  async configure(command: CoreConfigurationCommand): Promise<unknown> {
    return await this.request('configure', CoreConfigurationCommandSchema.parse(command))
  }

  async assembleKernel(input: CoreKernelBootstrap): Promise<CoreStatus> {
    return CoreStatusSchema.parse(
      await this.request('assembleKernel', CoreKernelBootstrapSchema.parse(input))
    )
  }

  async startKernel(): Promise<CoreStatus> {
    const status = CoreStatusSchema.parse(await this.request('startKernel', undefined))
    if (status.phase !== 'running' || !status.businessReady)
      throw new Error('Core Kernel did not acknowledge business readiness')
    return status
  }

  async invokeRoute(
    routeName: string,
    input: unknown,
    context: RouteContext,
    assertCallerActive: () => void
  ): Promise<unknown> {
    assertCallerActive()
    if (this.failure || this.stopped || this.stopPromise)
      throw this.failure ?? new Error('Core is stopping')
    const snapshot = serialize(CoreRouteInvocationSchema.parse({ routeName, input, context }))
    if (snapshot.length > CORE_VALUE_BYTES) throw new Error('Core route queue exceeded')
    const control = isCoreControlRoute(routeName)
    // Only unsent work may yield capacity to cancellation or a human answer.
    while (
      control &&
      this.routeQueues[0].length &&
      (this.routeQueued >= CORE_ROUTE_QUEUED ||
        this.routeQueuedBytes + snapshot.length > CORE_VALUE_BYTES)
    ) {
      const displaced = this.routeQueues[0].pop()!
      this.routeQueued--
      this.routeQueuedBytes -= displaced.snapshot.length
      displaced.reject(new Error('Core route queue yielded to a control request'))
    }
    if (
      this.routeQueued >= CORE_ROUTE_QUEUED ||
      this.routeQueuedBytes + snapshot.length > CORE_VALUE_BYTES
    )
      throw new Error('Core route queue exceeded')
    return await new Promise((resolve, reject) => {
      this.routeQueues[control ? 1 : 0].push({ snapshot, assertCallerActive, resolve, reject })
      this.routeQueued++
      this.routeQueuedBytes += snapshot.length
      this.pumpRoutes()
    })
  }

  private pumpRoutes(): void {
    if (this.failure || this.stopped || this.stopPromise) return
    for (const lane of [1, 0]) {
      const queue = this.routeQueues[lane]
      while (queue.length && (lane ? this.routeControl < 1 : this.ordinary < CORE_ORDINARY_CALLS)) {
        const request = queue.shift()!
        this.routeQueued--
        this.routeQueuedBytes -= request.snapshot.length
        void this.request(
          lane ? 'invokeControlRoute' : 'invokeRoute',
          deserialize(request.snapshot),
          request.assertCallerActive
        ).then(request.resolve, request.reject)
      }
    }
  }

  private rejectQueuedRoutes(error: Error): void {
    for (const queue of this.routeQueues)
      for (const request of queue.splice(0)) request.reject(error)
    this.routeQueued = 0
    this.routeQueuedBytes = 0
  }

  async deliverDesktopEvent(event: CoreDesktopEvent): Promise<void> {
    await this.deliverNative(CoreDesktopEventSchema.parse(event))
  }

  async deliverNativeEvents(events: CoreHelperEvent[]): Promise<void> {
    await this.deliverNative(CoreHelperEventsSchema.parse(events))
  }

  async deliverBrowserEvent(event: CoreBrowserEvent): Promise<unknown> {
    return await this.deliverNative(CoreBrowserEventSchema.parse(event))
  }

  private async deliverNative(event: unknown): Promise<unknown> {
    try {
      const encoded = serialize(event)
      if (
        this.nativeEventQueued >= CORE_NATIVE_QUEUED ||
        this.nativeEventBytes + encoded.length > CORE_VALUE_BYTES
      )
        throw new Error('Core Native event queue exceeded')
      const snapshot: unknown = deserialize(encoded)
      this.nativeEventQueued++
      this.nativeEventBytes += encoded.length
      const operation = this.nativeEventTail.then(async () => {
        try {
          return await this.request('nativeEvents', snapshot)
        } finally {
          this.nativeEventQueued--
          this.nativeEventBytes -= encoded.length
        }
      })
      this.nativeEventTail = operation.then(
        () => undefined,
        () => undefined
      )
      return await operation
    } catch (error) {
      this.invalidateNative(
        error instanceof Error ? error : new Error('Core Native event delivery failed')
      )
      throw error
    }
  }

  invalidateNative(error: Error): void {
    if (!this.failure) this.fail(error)
    void this.stop().catch(() => {})
  }

  observeSystemTheme(): Promise<void> {
    if (this.stopPromise || this.stopped || this.failure)
      return Promise.reject(this.failure ?? new Error('Core is stopping'))
    this.themeObservationDirty = true
    if (this.themeObservation) return this.themeObservation
    this.themeObservation = (async () => {
      try {
        while (this.themeObservationDirty && !this.stopPromise) {
          this.themeObservationDirty = false
          await this.request('observeSystemTheme', undefined)
        }
      } finally {
        this.themeObservation = undefined
        this.themeObservationDirty = false
      }
    })()
    return this.themeObservation
  }

  async status(): Promise<CoreStatus> {
    return CoreStatusSchema.parse(
      await this.observe(this.request('status', undefined), 5_000, 'CoreUnavailableError')
    )
  }

  stop(): Promise<CoreStatus> {
    if (this.stopPromise) return this.stopPromise
    this.rejectQueuedRoutes(new Error('Core is stopping'))
    const stopped = (async () => {
      const status = CoreStatusSchema.parse(await this.request('stop', undefined))
      if (status.phase !== 'stopped') throw new Error('Core did not acknowledge profile closure')
      this.stopped = true
      this.rejectPending(new Error('Core stopped before the operation outcome was received'))
      await Promise.allSettled(this.nativeCalls)
      await this.payloads.close()
      await rm(this.payloads.config.directory, { recursive: true, force: true })
      return status
    })()
    this.stopPromise = this.observe(stopped, 30_000, 'CoreOperationOutcomeUnknownError')
    return this.stopPromise
  }

  async closeAfterHostExit(): Promise<void> {
    await this.runtime.stop()
    this.stopped = true
    this.rejectQueuedRoutes(new Error('Core generation is stopped'))
    this.rejectPending(new Error('Core stopped before the operation outcome was received'))
    await Promise.allSettled(this.nativeCalls)
    await this.payloads.close()
    await rm(this.payloads.config.directory, { recursive: true, force: true })
  }

  private async request(
    method: CoreMethod,
    args: unknown,
    assertCallerActive?: () => void
  ): Promise<unknown> {
    if ((this.failure && method !== 'stop') || this.stopped)
      throw this.failure ?? new Error('Core generation is stopped')
    const control = method === 'status' || method === 'stop'
    const observation = method === 'observeSystemTheme'
    const nativeEvent = method === 'nativeEvents'
    const routeControl = method === 'invokeControlRoute'
    if (!control && !nativeEvent && this.stopPromise) throw new Error('Core is stopping')
    if (method === 'status' && this.statusPending) throw new Error('Core status request is pending')
    if (observation && this.themeObservationPending)
      throw new Error('Core theme observation is pending')
    if (nativeEvent && this.nativeEventsPending)
      throw new Error('Core Native event delivery is pending')
    if (
      !observation &&
      !nativeEvent &&
      (control
        ? this.control >= CORE_CONTROL_CALLS
        : routeControl
          ? this.routeControl >= 1
          : this.ordinary >= CORE_ORDINARY_CALLS)
    )
      throw new Error('Core request limit exceeded')
    if (nativeEvent) this.nativeEventsPending = true
    else if (observation) this.themeObservationPending = true
    else if (control) this.control++
    else if (routeControl) this.routeControl++
    else this.ordinary++
    if (method === 'status') this.statusPending = true
    let ref: CorePayload | undefined
    try {
      assertCallerActive?.()
      ref = await this.payloads.encode(args)
      assertCallerActive?.()
      if ((this.failure && method !== 'stop') || this.stopped)
        throw this.failure ?? new Error('Core generation is stopped')
      if (!control && !nativeEvent && this.stopPromise) throw new Error('Core is stopping')
      const id = ++this.nextId
      return await new Promise((resolve, reject) => {
        this.pending.set(id, { method, resolve, reject })
        try {
          this.send({ type: 'coreCall', id, method, args: ref! })
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error('Core write failed'))
        }
      })
    } finally {
      if (nativeEvent) this.nativeEventsPending = false
      else if (observation) this.themeObservationPending = false
      else if (control) this.control--
      else if (routeControl) this.routeControl--
      else this.ordinary--
      if (method === 'status') this.statusPending = false
      if (ref && !this.failure)
        await this.payloads.release(ref).catch((error: unknown) => {
          this.fail(error instanceof Error ? error : new Error('Core payload retirement failed'))
          throw error
        })
      this.pumpRoutes()
    }
  }

  private receive(frame: CoreFrame): void {
    if (this.stopped) return
    if (frame.type === 'coreStopped') {
      this.fail(new Error(frame.message))
      return
    }
    if (frame.type === 'coreReady') {
      if (
        this.identity ||
        frame.runtime.generation !== this.payloads.config.generation ||
        frame.runtime.modules !== process.versions.modules
      ) {
        this.fail(new Error('Core runtime generation or ABI mismatch'))
        return
      }
      this.identity = frame.runtime
      this.ready.resolve(frame.runtime)
      return
    }
    if (frame.type === 'coreNativeCall') {
      if (
        this.stopped ||
        frame.generation !== this.payloads.config.generation ||
        frame.id < this.nextNativeId ||
        frame.id - this.nextNativeId >= CORE_NATIVE_CALLS ||
        this.nativeIds.has(frame.id) ||
        this.nativeCalls.size >= CORE_NATIVE_CALLS
      ) {
        this.fail(new Error('Invalid Core Native request'))
        return
      }
      this.nativeIds.add(frame.id)
      while (this.nativeIds.delete(this.nextNativeId)) this.nextNativeId++
      const task = this.runNative(frame)
      this.nativeCalls.add(task)
      void task.then(
        () => this.nativeCalls.delete(task),
        () => this.nativeCalls.delete(task)
      )
      return
    }
    const request = this.pending.get(frame.id)
    if (!request) {
      if (this.failure) return
      this.fail(new Error('Unknown Core reply'))
      return
    }
    if ('error' in frame && frame.error.name === 'HarnessTransportError') {
      this.fail(new Error(frame.error.message))
      return
    }
    this.pending.delete(frame.id)
    if ('error' in frame) {
      const error = new Error(frame.error.message)
      error.name = frame.error.name
      request.reject(error)
    } else void this.payloads.decode(frame.value).then(request.resolve, request.reject)
  }

  private async runNative(frame: Extract<CoreFrame, { type: 'coreNativeCall' }>): Promise<void> {
    try {
      const args = await this.payloads.decode(frame.args)
      if (this.stopped) return
      const drain = isCoreNativeDrain(frame.method, args)
      if ((this.failure || this.stopPromise) && !drain)
        throw new Error('Core Native admission is stopping')
      const result = await this.native(frame.method, args)
      if (this.failure && !drain) {
        const error = new Error('Core Native outcome belongs to a retired generation')
        error.name = 'CoreNativeOperationOutcomeUnknownError'
        throw error
      }
      const value = await this.payloads.encode(result)
      this.send({ type: 'coreNativeReply', id: frame.id, generation: frame.generation, value })
    } catch (error) {
      if (!this.stopped) {
        try {
          this.send({
            type: 'coreNativeReply',
            id: frame.id,
            generation: frame.generation,
            error: {
              name: error instanceof Error ? error.name.slice(0, 256) : 'CoreNativeError',
              message:
                error instanceof Error ? error.message.slice(0, 8192) : 'Core Native effect failed'
            }
          })
        } catch {
          this.fail(new Error('Core Native reply was lost'))
        }
      }
    }
  }

  private fail(error: Error): void {
    if (!this.failure) {
      this.failure = error
      this.ready.reject(error)
    }
    this.rejectPending(this.failure)
    this.rejectQueuedRoutes(this.failure)
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      const failure = new Error(error.message)
      failure.name =
        request.method === 'status' ? 'CoreUnavailableError' : 'CoreOperationOutcomeUnknownError'
      request.reject(failure)
    }
    this.pending.clear()
  }

  private observe<T>(operation: Promise<T>, milliseconds: number, name: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('Core reply deadline elapsed; owner retirement is not confirmed')
        error.name = name
        reject(error)
      }, milliseconds)
      timer.unref()
    })
    return Promise.race([operation, deadline]).finally(() => clearTimeout(timer))
  }
}
