import { z } from 'zod'
import type { CoreKernelNative } from '../../harness/core/kernel'
import {
  CoreDesktopArguments,
  CoreDesktopCommandSchema,
  type CoreDesktopEvent,
  type CoreDesktopMethod
} from '@shared/harness/desktop'
import { CORE_NATIVE_CALLS } from '@shared/harness/core'

type Watch = { active: boolean; dispose(): void; delivery?: Promise<void> }

export class CoreDesktopNative {
  private readonly calls = new Map<
    string,
    { controller: AbortController; operation: Promise<unknown> }
  >()
  private readonly watches = new Map<string, Watch>()
  private readonly canceledCalls = new Set<string>()
  private closing: Promise<void> | undefined

  constructor(
    private readonly native: CoreKernelNative,
    private readonly deliver: (event: CoreDesktopEvent) => Promise<void>,
    private readonly retire: () => Promise<void>,
    private readonly failed: (error: Error) => void
  ) {}

  async invoke(input: unknown): Promise<unknown> {
    const [command] = z.tuple([CoreDesktopCommandSchema]).parse(input)
    if (this.closing && command.operation !== 'close' && command.operation !== 'retire')
      throw new Error('Native desktop is stopping')
    switch (command.operation) {
      case 'capabilities':
        return {
          preview: Boolean(this.native.mcpPreview),
          journal: Boolean(this.native.runJournalObserver)
        }
      case 'call': {
        if (this.calls.has(command.id)) throw new Error('Native desktop identity already exists')
        if (this.calls.size >= CORE_NATIVE_CALLS)
          throw new Error('Native desktop call limit exceeded')
        const args = CoreDesktopArguments[command.method].parse(command.args)
        const controller = new AbortController()
        const entry = { controller, operation: Promise.resolve<unknown>(undefined) }
        this.calls.set(command.id, entry)
        if (this.canceledCalls.delete(command.id))
          controller.abort(new Error('Native desktop call canceled'))
        entry.operation = Promise.resolve().then(async () => {
          controller.signal.throwIfAborted()
          const result = await this.call(command.method, args, controller.signal)
          controller.signal.throwIfAborted()
          return result
        })
        try {
          return await entry.operation
        } finally {
          this.calls.delete(command.id)
        }
      }
      case 'watch': {
        if (this.watches.has(command.id)) throw new Error('Native renderer watch already exists')
        if (this.watches.size >= 64) throw new Error('Native renderer watch limit exceeded')
        const entry: Watch = { active: true, dispose() {} }
        this.watches.set(command.id, entry)
        try {
          entry.dispose = this.native.onRendererDestroyed(command.webContentsId, () => {
            if (!entry.active || entry.delivery) return
            entry.delivery = this.deliver({ type: 'desktop.rendererDestroyed', id: command.id })
            void entry.delivery.catch((error) => this.failed(error))
          })
        } catch (error) {
          this.watches.delete(command.id)
          throw error
        }
        return undefined
      }
      case 'retire': {
        if (this.closing) return await this.closing
        for (const id of command.settledCalls) this.canceledCalls.delete(id)
        const calls = command.calls.map((id) => {
          const call = this.calls.get(id)
          if (!call) this.remember(this.canceledCalls, id)
          else call.controller.abort(new Error('Native desktop call canceled'))
          return call?.operation
        })
        const watches = command.watches.map(async (id) => {
          const watch = this.watches.get(id)
          if (watch) {
            watch.active = false
            watch.dispose()
            await watch.delivery?.catch(() => {})
            this.watches.delete(id)
          }
        })
        const results = await Promise.allSettled([...calls, ...watches])
        // A canceled operation's business error does not invalidate physical retirement.
        for (const result of results.slice(calls.length))
          if (result.status === 'rejected') throw result.reason
        return undefined
      }
      case 'close':
        return await this.close()
    }
  }

  publishRemoteAuthWindow(
    event: Extract<CoreDesktopEvent, { type: 'desktop.remoteAuthWindow' }>['event']
  ): void {
    void this.deliver({ type: 'desktop.remoteAuthWindow', event }).catch((error) =>
      this.failed(error)
    )
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    for (const call of this.calls.values())
      call.controller.abort(new Error('Native desktop is stopping'))
    this.closing = (async () => {
      const errors: unknown[] = []
      for (const watch of this.watches.values()) {
        try {
          watch.active = false
          watch.dispose()
        } catch (error) {
          errors.push(error)
        }
      }
      try {
        await this.retire()
      } catch (error) {
        errors.push(error)
      }
      await Promise.allSettled([...this.calls.values()].map((call) => call.operation))
      await Promise.allSettled([...this.watches.values()].map((watch) => watch.delivery))
      if (errors.length) throw new AggregateError(errors, 'Native desktop did not retire')
      this.watches.clear()
      this.canceledCalls.clear()
    })()
    return this.closing
  }

  private remember(set: Set<string>, id: string): void {
    if (set.has(id)) return
    if (set.size >= 80) {
      const error = new Error('Native desktop retirement identities exceeded')
      this.failed(error)
      throw error
    }
    set.add(id)
  }

  private async call(
    method: CoreDesktopMethod,
    args: unknown[],
    signal: AbortSignal
  ): Promise<unknown> {
    if (method.startsWith('copilotAuthorization.')) args[1] = signal
    else if (method === 'fetchRegistryIcon' || method === 'agentDesktop.readImageSize')
      args.push(signal)
    if (method === 'cacheImage') args[1] = { ...(args[1] as object | undefined), signal }
    const parts = method.split('.')
    let owner: object = this.native
    for (const part of parts.slice(0, -1)) {
      const next: unknown = Reflect.get(owner, part)
      if (!next || typeof next !== 'object')
        throw new Error('Native desktop capability is unavailable')
      owner = next
    }
    const target: unknown = Reflect.get(owner, parts.at(-1)!)
    if (method === 'mcpPreview.shouldCaptureAfterClick' && target === undefined) return false
    if (typeof target !== 'function') throw new Error('Native desktop capability is unavailable')
    return await Reflect.apply(target, owner, args)
  }
}
