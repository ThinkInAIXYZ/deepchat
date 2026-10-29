import {
  CoreConfigurationCommandSchema,
  type CoreConfigurationCommand
} from '@shared/harness/configuration'
import { rm } from 'node:fs/promises'
import { z } from 'zod'
import type { HarnessRuntime } from './runtime'
import type { CoreProfileHost } from '@/app/profileStartup'
import type { DatabaseSecurityCryptoPort } from '@/app/databaseSecurity'
import { DATABASE_STARTUP_FAILURE_KINDS } from '@shared/contracts/databaseSecurity'
import { CorePayloadStore } from '../../harness/core/payload'
import {
  CORE_CALLS,
  CORE_CONTROL_CALLS,
  CORE_NATIVE_CALLS,
  CoreStatusSchema,
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
  private control = 0
  private statusPending = false
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
  }): Promise<CoreStatus> {
    return CoreStatusSchema.parse(await this.request('openProfile', options))
  }

  async configure(command: CoreConfigurationCommand): Promise<unknown> {
    return await this.request('configure', CoreConfigurationCommandSchema.parse(command))
  }

  async status(): Promise<CoreStatus> {
    return CoreStatusSchema.parse(
      await this.observe(this.request('status', undefined), 5_000, 'CoreUnavailableError')
    )
  }

  stop(): Promise<CoreStatus> {
    if (this.stopPromise) return this.stopPromise
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
    await Promise.allSettled(this.nativeCalls)
    await this.payloads.close()
    await rm(this.payloads.config.directory, { recursive: true, force: true })
  }

  private async request(method: CoreMethod, args: unknown): Promise<unknown> {
    if (this.failure || this.stopped) throw this.failure ?? new Error('Core generation is stopped')
    const control = method === 'status' || method === 'stop'
    if (!control && this.stopPromise) throw new Error('Core is stopping')
    if (method === 'status' && this.statusPending) throw new Error('Core status request is pending')
    if (control ? this.control >= CORE_CONTROL_CALLS : this.ordinary >= CORE_CALLS)
      throw new Error('Core request limit exceeded')
    if (control) this.control++
    else this.ordinary++
    if (method === 'status') this.statusPending = true
    let ref: CorePayload | undefined
    try {
      ref = await this.payloads.encode(args)
      if (this.failure || this.stopped)
        throw this.failure ?? new Error('Core generation is stopped')
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
      if (control) this.control--
      else this.ordinary--
      if (method === 'status') this.statusPending = false
      if (ref && !this.failure) await this.payloads.release(ref)
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
        this.failure ||
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
      this.fail(new Error('Unknown Core reply'))
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
      if (this.failure || this.stopped) return
      if (this.stopPromise) throw new Error('Core Native admission is stopping')
      const result = await this.native(frame.method, args)
      if (this.failure) return
      const value = await this.payloads.encode(result)
      if (!this.failure)
        this.send({ type: 'coreNativeReply', id: frame.id, generation: frame.generation, value })
    } catch (error) {
      if (!this.failure) {
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
    if (this.failure) return
    this.failure = error
    this.ready.reject(error)
    this.rejectPending(error)
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
