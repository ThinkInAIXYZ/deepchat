import { deserialize, serialize } from 'node:v8'
import { z } from 'zod'
import type {
  BackgroundExecHost,
  BackgroundExecRpcRequest
} from '@/agent/shared/process/backgroundExecSessionManager'
import type { CodeModeHost } from '@/tool/codeMode/runCodeRuntimeManager'
import type { SchedulerHost } from '@/scheduler/schedulerProcessManager'
import type { SpawnFileWatcherHost } from '@/platform/fileWatcher/watcherHostClient'
import type { FileWatcherRpcRequest } from '@/platform/fileWatcher/watcherTypes'
import type { RunCodeParentMessage } from '@shared/codeModeProtocol'
import type { SchedulerCommand } from '@shared/cronJobs'
import {
  CORE_HELPER_BATCH,
  CORE_HELPER_QUEUE,
  CORE_HELPER_QUEUE_BYTES,
  CoreHelperCommandSchema,
  parseCoreHelperMessage,
  type CoreHelperEvent,
  type CoreHelperKind
} from '@shared/harness/helpers'

type Factories = {
  exec(signal: AbortSignal): Promise<BackgroundExecHost>
  code(signal: AbortSignal): Promise<CodeModeHost>
  scheduler(signal: AbortSignal): Promise<SchedulerHost>
  watcher: SpawnFileWatcherHost
}

type Host = {
  pid(): number | undefined
  postMessage(message: unknown): void
  onMessage(listener: (message: unknown) => void): void
  onExit(listener: (code: number) => void): void
  onError(listener: (kind: string, location: string) => void): void
  stop(): void | Promise<void>
  rss?(signal: AbortSignal): Promise<number | null>
}
type Helper = {
  id: string
  kind: CoreHelperKind
  controller: AbortController
  opening: Promise<void>
  host?: Host
  exited: ReturnType<typeof Promise.withResolvers<void>>
  exitReceipt?: Promise<void>
  startReceipt?: Promise<void>
  startupFailed: boolean
  retired?: Promise<void>
  dead: boolean
  termination?: Promise<void>
  reads: Set<Promise<unknown>>
}
type PendingEvent = {
  value: CoreHelperEvent
  bytes: number
  receipt: ReturnType<typeof Promise.withResolvers<void>>
}

export class CoreHelperNative {
  private readonly helpers = new Map<string, Helper>()
  private readonly events: PendingEvent[] = []
  private sequence = 0
  private bytes = 0
  private sending = false
  private closed = false
  private closing: Promise<void> | undefined
  private failure: Error | undefined

  constructor(
    private readonly factories: Factories,
    private readonly deliver: (events: CoreHelperEvent[]) => Promise<void>,
    private readonly failed: (error: Error) => void
  ) {}

  async invoke(args: unknown): Promise<unknown> {
    const [command] = z.tuple([CoreHelperCommandSchema]).parse(args)
    switch (command.operation) {
      case 'open': {
        if (this.closed || this.closing || this.failure)
          throw this.failure ?? new Error('Native helpers are stopping')
        if (this.helpers.has(command.id)) throw new Error('Native helper identity already used')
        const helper: Helper = {
          id: command.id,
          kind: command.kind,
          controller: new AbortController(),
          opening: Promise.resolve(),
          exited: Promise.withResolvers<void>(),
          dead: false,
          startupFailed: false,
          reads: new Set()
        }
        this.helpers.set(helper.id, helper)
        helper.opening = Promise.resolve().then(async () => {
          try {
            helper.controller.signal.throwIfAborted()
            helper.host = await this.spawn(helper.kind, helper.controller.signal)
            const host = helper.host
            host.onMessage((message) => {
              if (!helper.dead)
                void this.enqueue(helper, { type: 'message', message }).catch(() => {})
            })
            host.onError((kind, location) => {
              if (!helper.dead)
                void this.enqueue(helper, { type: 'error', kind, location }).catch(() => {})
            })
            host.onExit((code) => {
              if (helper.dead) return
              helper.dead = true
              helper.exited.resolve()
              helper.exitReceipt = this.enqueue(helper, { type: 'exit', code })
              void helper.exitReceipt.catch(() => {})
              queueMicrotask(() => {
                void this.completeRetirement(helper)
              })
            })
            if (helper.controller.signal.aborted) {
              await this.stopHost(helper)
              helper.controller.signal.throwIfAborted()
            }
            helper.startReceipt = this.enqueue(helper, { type: 'opened' })
            void helper.startReceipt.catch(() => {})
          } catch (error) {
            helper.startupFailed = true
            helper.startReceipt = this.enqueue(helper, {
              type: 'openFailed',
              name: error instanceof Error ? error.name.slice(0, 256) : 'NativeHelperStartupError',
              message:
                error instanceof Error
                  ? error.message.slice(0, 8192)
                  : 'Native helper startup failed'
            })
            void helper.startReceipt.catch(() => {})
            queueMicrotask(() => {
              void this.completeRetirement(helper)
            })
          }
        })
        return { accepted: true }
      }
      case 'send': {
        if (this.failure || this.closed)
          throw this.failure ?? new Error('Native helpers are closed')
        const helper = this.require(command.id)
        await helper.opening
        if (helper.dead || helper.termination || helper.startupFailed)
          throw new Error('Native helper is retired')
        helper.host!.postMessage(parseCoreHelperMessage(helper.kind, command.message))
        return undefined
      }
      case 'terminate': {
        const results = await Promise.allSettled(
          command.ids.map(async (id) => {
            const helper = this.helpers.get(id)
            if (helper) await this.terminate(helper)
          })
        )
        for (const result of results) if (result.status === 'rejected') throw result.reason
        return undefined
      }
      case 'rss': {
        const helper = this.helpers.get(command.id)
        if (!helper || helper.dead) return null
        if (helper.kind !== 'code')
          throw new Error('RSS is only available for an owned Code Mode helper')
        const read = Promise.resolve().then(async () => {
          await helper.opening
          if (helper.startupFailed) throw new Error('Native helper startup failed')
          helper.controller.signal.throwIfAborted()
          const value = await helper.host!.rss!(helper.controller.signal)
          helper.controller.signal.throwIfAborted()
          return value
        })
        helper.reads.add(read)
        try {
          return await read
        } finally {
          helper.reads.delete(read)
        }
      }
      case 'close':
        await this.close()
        return undefined
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    const helpers = [...this.helpers.values()]
    for (const helper of helpers) helper.controller.abort(new Error('Native helpers are stopping'))
    this.closing = (async () => {
      const results = await Promise.allSettled(helpers.map((helper) => this.terminate(helper)))
      for (const result of results) if (result.status === 'rejected') throw result.reason
      this.helpers.clear()
    })()
    return this.closing
  }

  private require(id: string): Helper {
    const helper = this.helpers.get(id)
    if (!helper) throw new Error('Unknown Native helper')
    return helper
  }

  private terminate(helper: Helper): Promise<void> {
    helper.controller.abort(new Error('Native helper startup canceled'))
    helper.termination ??= (async () => {
      await helper.opening.catch(() => undefined)
      await Promise.allSettled(helper.reads)
      if (helper.host) await this.stopHost(helper)
      await helper.startReceipt?.catch(() => {})
    })()
    return helper.termination
  }

  private stopHost(helper: Helper): Promise<void> {
    helper.retired ??= (async () => {
      try {
        if (!helper.dead || helper.kind === 'exec') await helper.host!.stop()
      } catch (error) {
        if (helper.kind === 'exec') throw error
      }
      await helper.exited.promise
      await helper.exitReceipt?.catch(() => {})
    })()
    return helper.retired
  }

  private async completeRetirement(helper: Helper): Promise<void> {
    try {
      await helper.opening
      if (helper.host) await this.stopHost(helper)
      await helper.startReceipt?.catch(() => {})
      this.helpers.delete(helper.id)
    } catch (error) {
      this.fail(error)
    }
  }

  private enqueue(helper: Helper, event: CoreHelperEvent['event']): Promise<void> {
    if (this.failure) return Promise.reject(this.failure)
    let encoded: Buffer
    try {
      encoded = serialize(event)
    } catch (error) {
      return Promise.reject(this.fail(error))
    }
    if (
      this.events.length >= CORE_HELPER_QUEUE ||
      this.bytes + encoded.length > CORE_HELPER_QUEUE_BYTES
    ) {
      const error = this.fail(new Error('Native helper event queue exceeded'))
      return Promise.reject(error)
    }
    const pending: PendingEvent = {
      value: {
        id: helper.id,
        sequence: ++this.sequence,
        pid: helper.host?.pid() ?? null,
        event: deserialize(encoded)
      },
      bytes: encoded.length,
      receipt: Promise.withResolvers<void>()
    }
    this.events.push(pending)
    this.bytes += pending.bytes
    if (!this.sending) {
      this.sending = true
      queueMicrotask(() => {
        void this.sendEvents()
      })
    }
    return pending.receipt.promise
  }

  private async sendEvents(): Promise<void> {
    try {
      while (this.events.length && !this.failure) {
        const batch = this.events.slice(0, CORE_HELPER_BATCH)
        await this.deliver(batch.map((value) => value.value))
        if (this.failure) throw this.failure
        this.events.splice(0, batch.length)
        for (const value of batch) {
          this.bytes -= value.bytes
          value.receipt.resolve()
        }
      }
    } catch (error) {
      this.fail(error)
    } finally {
      this.sending = false
    }
  }

  private fail(value: unknown): Error {
    if (this.failure) return this.failure
    const error = value instanceof Error ? value : new Error('Native helper event delivery failed')
    this.failure = error
    for (const event of this.events.splice(0)) event.receipt.reject(error)
    this.bytes = 0
    this.failed(error)
    return error
  }

  private async spawn(kind: CoreHelperKind, signal: AbortSignal): Promise<Host> {
    if (kind === 'content' || kind === 'git') {
      const host = await this.factories.watcher(kind, signal)
      return {
        pid: () => undefined,
        postMessage: (message) => host.postMessage(message as FileWatcherRpcRequest),
        onMessage: (listener) => host.onMessage(listener),
        onExit: (listener) => host.onExit(listener),
        onError: (listener) => host.onError(listener),
        stop: () => host.terminate()
      }
    }
    if (kind === 'code') {
      const host = await this.factories.code(signal)
      return {
        pid: () => host.pid,
        postMessage: (message) => host.postMessage(message as RunCodeParentMessage),
        onMessage: (listener) => host.on('message', listener),
        onExit: (listener) => host.on('exit', listener),
        onError: (listener) => host.on('error', listener),
        stop: () => host.kill(),
        rss: (requestSignal) => host.getRssBytes(requestSignal)
      }
    }
    if (kind === 'exec') {
      const host = await this.factories.exec(signal)
      return {
        pid: () => host.pid,
        postMessage: (message) => host.postMessage(message as BackgroundExecRpcRequest),
        onMessage: (listener) => host.onMessage(listener),
        onExit: (listener) => host.onExit(listener),
        onError: (listener) => host.onError(listener),
        stop: () => host.kill()
      }
    }
    const host = await this.factories.scheduler(signal)
    return {
      pid: () => host.pid,
      postMessage: (message) => host.postMessage(message as SchedulerCommand),
      onMessage: (listener) => host.onMessage(listener),
      onExit: (listener) => host.onExit(listener),
      onError: (listener) => host.onError(listener),
      stop: () => host.kill()
    }
  }
}
