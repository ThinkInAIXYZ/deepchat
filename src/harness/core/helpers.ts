import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { deserialize, serialize } from 'node:v8'
import type { BackgroundExecHost } from '@/agent/shared/process/backgroundExecSessionManager'
import type { CodeModeHost } from '@/tool/codeMode/runCodeRuntimeManager'
import type { SchedulerHost } from '@/scheduler/schedulerProcessManager'
import type {
  FileWatcherHost,
  SpawnFileWatcherHost
} from '@/platform/fileWatcher/watcherHostClient'
import {
  CORE_HELPER_QUEUE,
  CORE_HELPER_BATCH,
  CORE_HELPER_QUEUE_BYTES,
  CoreHelperEventsSchema,
  CoreHelperAdmissionSchema,
  parseCoreHelperMessage,
  type CoreHelperCommand,
  type CoreHelperEvent,
  type CoreHelperKind
} from '@shared/harness/helpers'

type Helper = {
  id: string
  kind: CoreHelperKind
  pid: number | undefined
  events: EventEmitter
  backlog: Array<{ event: CoreHelperEvent['event']; bytes: number }>
  flushing: boolean
  dead: boolean
  opened: ReturnType<typeof Promise.withResolvers<void>>
  closing?: Promise<void>
}

export class CoreNativeHelpers {
  private readonly helpers = new Map<string, Helper>()
  private sequence = 1
  private queued = 0
  private queuedBytes = 0
  private buffered = 0
  private bufferedBytes = 0
  private outgoing: Promise<void> = Promise.resolve()
  private closed = false
  private used = false
  private closing: Promise<void> | undefined
  private failure: Error | undefined
  private readonly terminations = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
  private terminating = false

  constructor(
    private readonly invoke: (command: CoreHelperCommand) => Promise<unknown>,
    private readonly failed: (error: Error) => void
  ) {}

  async spawnBackgroundExecHost(signal: AbortSignal): Promise<BackgroundExecHost> {
    return this.channel(await this.open('exec', signal))
  }

  async spawnSchedulerHost(signal: AbortSignal): Promise<SchedulerHost> {
    return this.channel(await this.open('scheduler', signal))
  }

  readonly spawnFileWatcherHost: SpawnFileWatcherHost = async (kind, signal) => {
    const helper = await this.open(kind, signal)
    const channel = this.channel(helper)
    return {
      ...channel,
      terminate: async () => await this.terminate(helper)
    } satisfies FileWatcherHost
  }

  async spawnCodeModeHost(signal: AbortSignal): Promise<CodeModeHost> {
    const helper = await this.open('code', signal)
    return {
      get pid() {
        return helper.pid
      },
      postMessage: (message) => this.post(helper, message),
      kill: () => this.kill(helper),
      on: (event, listener) => {
        helper.events.on(event, listener)
        this.flush(helper)
      },
      off: (event, listener) => {
        helper.events.off(event, listener)
      },
      getRssBytes: async (requestSignal) => {
        requestSignal.throwIfAborted()
        if (this.failure || this.closing)
          throw this.failure ?? new Error('Core helpers are stopping')
        const value = await this.invoke({ operation: 'rss', id: helper.id })
        requestSignal.throwIfAborted()
        if (value === null) return null
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
          throw new Error('Invalid owned helper RSS sample')
        return value
      }
    }
  }

  accept(input: unknown): void {
    if (this.failure || this.closed) throw this.failure ?? new Error('Core helpers are closed')
    const parsed = CoreHelperEventsSchema.safeParse(input)
    if (!parsed.success) throw this.fail(parsed.error)
    const batch = parsed.data
    for (const value of batch) {
      const helper = this.helpers.get(value.id)
      if (!helper || value.sequence !== this.sequence++)
        throw this.fail(new Error('Unknown or out-of-order Native helper event'))
      if (value.event.type === 'opened') {
        helper.pid = value.pid ?? helper.pid
        helper.opened.resolve()
        continue
      }
      if (value.event.type === 'openFailed') {
        const error = new Error(value.event.message)
        error.name = value.event.name
        helper.opened.reject(error)
        continue
      }
      const bytes = serialize(value.event).length
      if (
        this.buffered >= CORE_HELPER_QUEUE ||
        this.bufferedBytes + bytes > CORE_HELPER_QUEUE_BYTES
      )
        throw this.fail(new Error('Core helper event queue exceeded'))
      helper.backlog.push({ event: value.event, bytes })
      this.buffered++
      this.bufferedBytes += bytes
      if (value.event.type === 'exit') {
        helper.dead = true
        helper.pid = undefined
        helper.opened.reject(new Error('Native helper exited during startup'))
      } else helper.pid = value.pid ?? helper.pid
      this.flush(helper)
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closing = (async () => {
      await this.outgoing
      if (this.used) await this.invoke({ operation: 'close' })
      this.closed = true
      for (const helper of this.helpers.values()) this.remove(helper)
    })()
    return this.closing
  }

  private async open(kind: CoreHelperKind, signal: AbortSignal): Promise<Helper> {
    signal.throwIfAborted()
    if (this.failure || this.closing) throw this.failure ?? new Error('Core helpers are stopping')
    const opened = Promise.withResolvers<void>()
    void opened.promise.catch(() => {})
    const helper: Helper = {
      id: randomUUID(),
      kind,
      pid: undefined,
      events: new EventEmitter(),
      backlog: [],
      flushing: false,
      dead: false,
      opened
    }
    this.helpers.set(helper.id, helper)
    this.used = true
    let admitted = false
    const abort = () => {
      if (admitted) this.kill(helper)
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      CoreHelperAdmissionSchema.parse(await this.invoke({ operation: 'open', id: helper.id, kind }))
      admitted = true
      if (signal.aborted) signal.throwIfAborted()
      await opened.promise
      if (helper.dead || this.closing || this.failure)
        throw this.failure ?? new Error('Native helper startup was retired')
      return helper
    } catch (error) {
      try {
        await this.terminate(helper)
      } catch (failure) {
        this.fail(failure)
      }
      this.remove(helper)
      throw signal.aborted ? signal.reason : error
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  private channel(helper: Helper) {
    return {
      get pid() {
        return helper.pid
      },
      postMessage: (message: unknown) => this.post(helper, message),
      kill: () => this.kill(helper),
      onMessage: (listener: (message: unknown) => void) => {
        helper.events.on('message', listener)
        this.flush(helper)
      },
      onExit: (listener: (code: number) => void) => {
        helper.events.on('exit', listener)
        this.flush(helper)
      },
      onError: (listener: (kind: string, location: string) => void) => {
        helper.events.on('error', listener)
        this.flush(helper)
      }
    }
  }

  private post(helper: Helper, message: unknown): void {
    if (this.failure || this.closing || helper.dead)
      throw this.failure ?? new Error('Native helper is stopping')
    const encoded = serialize(parseCoreHelperMessage(helper.kind, message))
    const snapshot: unknown = deserialize(encoded)
    const bytes = encoded.length
    if (this.queued >= CORE_HELPER_QUEUE || this.queuedBytes + bytes > CORE_HELPER_QUEUE_BYTES)
      throw this.fail(new Error('Core helper command queue exceeded'))
    this.queued++
    this.queuedBytes += bytes
    const operation = this.outgoing.then(async () => {
      try {
        if (this.failure) throw this.failure
        await this.invoke({ operation: 'send', id: helper.id, message: snapshot })
      } finally {
        this.queued--
        this.queuedBytes -= bytes
      }
    })
    this.outgoing = operation.catch((error) => {
      this.fail(error)
    })
  }

  private kill(helper: Helper): void {
    void this.terminate(helper).catch((error) => this.fail(error))
  }

  private terminate(helper: Helper): Promise<void> {
    if (helper.closing) return helper.closing
    if (this.closing) return this.closing
    const receipt = Promise.withResolvers<void>()
    helper.closing = receipt.promise
    this.terminations.set(helper.id, receipt)
    if (!this.terminating) {
      this.terminating = true
      queueMicrotask(() => {
        void this.terminateBatch()
      })
    }
    return helper.closing
  }

  private async terminateBatch(): Promise<void> {
    try {
      await this.outgoing
      while (this.terminations.size) {
        const batch = [...this.terminations.entries()].slice(0, CORE_HELPER_BATCH)
        if (this.closing) await this.closing
        else await this.invoke({ operation: 'terminate', ids: batch.map(([id]) => id) })
        for (const [id, receipt] of batch) {
          this.terminations.delete(id)
          receipt.resolve()
        }
      }
    } catch (error) {
      for (const receipt of this.terminations.values()) receipt.reject(error)
      this.terminations.clear()
      this.fail(error)
    } finally {
      this.terminating = false
    }
  }

  private flush(helper: Helper): void {
    if (helper.flushing || !helper.events.eventNames().length) return
    helper.flushing = true
    queueMicrotask(() => {
      helper.flushing = false
      try {
        while (helper.backlog.length) {
          const value = helper.backlog[0]
          helper.backlog.shift()
          this.buffered--
          this.bufferedBytes -= value.bytes
          switch (value.event.type) {
            case 'message':
              helper.events.emit('message', value.event.message)
              break
            case 'exit':
              helper.events.emit('exit', value.event.code)
              this.remove(helper)
              break
            case 'error':
              helper.events.emit('error', value.event.kind, value.event.location)
              break
          }
        }
      } catch (error) {
        this.fail(error)
      }
    })
  }

  private remove(helper: Helper): void {
    helper.opened.reject(this.failure ?? new Error('Native helper is retired'))
    this.helpers.delete(helper.id)
    this.buffered -= helper.backlog.length
    for (const value of helper.backlog) this.bufferedBytes -= value.bytes
    helper.backlog = []
  }

  private fail(input: unknown): Error {
    if (this.failure) return this.failure
    const error = input instanceof Error ? input : new Error('Core Native helper failed')
    this.failure = error
    for (const helper of this.helpers.values()) helper.opened.reject(error)
    this.failed(error)
    return error
  }
}
