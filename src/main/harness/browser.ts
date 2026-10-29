import { z } from 'zod'
import type { AgentBrowserToolPort } from '@/tool/runtimePorts'
import { isYoBrowserUnavailableError } from '@/tool/browser/errors'
import {
  CoreBrowserCommandSchema,
  CoreBrowserAuthorizationSchema,
  coreBrowserError,
  type CoreBrowserEvent,
  type CoreBrowserOutcome
} from '@shared/harness/browser'
import { CORE_NATIVE_CALLS } from '@shared/harness/core'

export class CoreBrowserNative {
  private readonly calls = new Map<
    string,
    { controller: AbortController; operation: Promise<void> }
  >()
  private closing: Promise<void> | undefined
  private failure: Error | undefined

  constructor(
    private readonly browser: AgentBrowserToolPort,
    private readonly deliver: (event: CoreBrowserEvent) => Promise<unknown>,
    // Includes physical Browser closure and any effects that outlived a canceled client wait.
    private readonly retire: () => Promise<void>,
    private readonly failed: (error: Error) => void
  ) {}

  async invoke(input: unknown): Promise<unknown> {
    const [command] = z.tuple([CoreBrowserCommandSchema]).parse(input)
    switch (command.operation) {
      case 'open': {
        if (this.failure || this.closing)
          throw this.failure ?? new Error('Native browser is stopping')
        if (this.calls.has(command.id)) throw new Error('Native browser call already exists')
        if (this.calls.size >= CORE_NATIVE_CALLS - 2)
          throw new Error('Native browser call limit exceeded')
        const call = { controller: new AbortController(), operation: Promise.resolve() }
        this.calls.set(command.id, call)
        call.operation = Promise.resolve().then(async () => {
          let outcome: CoreBrowserOutcome
          try {
            call.controller.signal.throwIfAborted()
            const value = await this.browser.callTool(
              command.toolName,
              command.args,
              command.conversationId,
              command.runId,
              command.authorize
                ? async (args) => {
                    call.controller.signal.throwIfAborted()
                    const result = CoreBrowserAuthorizationSchema.parse(
                      await this.deliver({ type: 'browser.authorize', id: command.id, args })
                    )
                    call.controller.signal.throwIfAborted()
                    if (!result.ok) {
                      const error = new Error(result.error.message)
                      error.name = result.error.name
                      throw error
                    }
                  }
                : undefined,
              call.controller.signal
            )
            call.controller.signal.throwIfAborted()
            outcome = { ok: true, value }
          } catch (error) {
            outcome = {
              ok: false,
              error: coreBrowserError(error),
              ...(isYoBrowserUnavailableError(error) ? { unavailable: error.payload } : {})
            }
          }
          try {
            await this.deliver({ type: 'browser.completed', id: command.id, outcome })
            this.calls.delete(command.id)
          } catch (error) {
            this.fail(error)
          }
        })
        return { accepted: true }
      }
      case 'cancel': {
        const call = this.calls.get(command.id)
        if (!call) return undefined
        call.controller.abort(new Error('Native browser call canceled'))
        await call.operation
        return undefined
      }
      case 'close':
        return await this.close()
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    const calls = [...this.calls.values()]
    for (const call of calls) call.controller.abort(new Error('Native browser is stopping'))
    this.closing = (async () => {
      // Native closure also releases a target that ignored its caller's cancellation.
      await this.retire()
      await Promise.allSettled(calls.map((call) => call.operation))
      this.calls.clear()
    })()
    return this.closing
  }

  private fail(input: unknown): void {
    if (this.failure) return
    this.failure = input instanceof Error ? input : new Error('Native browser delivery failed')
    this.failed(this.failure)
  }
}
