import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AgentBrowserToolPort } from '@/tool/runtimePorts'
import { getYoBrowserToolDefinitions } from '@/tool/browser/definitions'
import { YoBrowserUnavailableError } from '@/tool/browser/errors'
import {
  CoreBrowserEventSchema,
  coreBrowserError,
  type CoreBrowserAuthorization,
  type CoreBrowserCommand,
  type CoreBrowserOutcome
} from '@shared/harness/browser'
import { CORE_NATIVE_CALLS, CORE_NATIVE_QUEUED } from '@shared/harness/core'

type Call = {
  signal: AbortSignal
  authorize?: Parameters<AgentBrowserToolPort['callTool']>[4]
  authorized: boolean
  authorizationError?: unknown
  outcome: ReturnType<typeof Promise.withResolvers<CoreBrowserOutcome>>
}

export class CoreNativeBrowser implements AgentBrowserToolPort {
  private readonly calls = new Map<string, Call>()
  private readonly pending = new Set<Promise<unknown>>()
  private closing: Promise<void> | undefined
  private failure: Error | undefined

  constructor(
    private readonly invoke: (command: CoreBrowserCommand) => Promise<unknown>,
    private readonly failed: (error: Error) => void
  ) {}

  getToolDefinitions() {
    return getYoBrowserToolDefinitions()
  }

  callTool(...args: Parameters<AgentBrowserToolPort['callTool']>): Promise<string> {
    const operation = this.execute(...args)
    this.pending.add(operation)
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation)
    )
    return operation
  }

  async accept(input: unknown): Promise<CoreBrowserAuthorization | undefined> {
    const event = CoreBrowserEventSchema.parse(input)
    const call = this.calls.get(event.id)
    if (!call || this.failure) throw this.fail(new Error('Unknown Native browser call'))
    if (event.type === 'browser.completed') {
      call.outcome.resolve(event.outcome)
      return undefined
    }
    if (!call.authorize || call.authorized)
      throw this.fail(new Error('Unexpected Native browser authorization'))
    call.authorized = true
    try {
      call.signal.throwIfAborted()
      if (this.closing) throw new Error('Core browser is stopping')
      await call.authorize(event.args)
      call.signal.throwIfAborted()
      if (this.closing) throw new Error('Core browser is stopping')
      return { ok: true }
    } catch (error) {
      call.authorizationError = error
      return { ok: false, error: coreBrowserError(error) }
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closing = (async () => {
      await this.invoke({ operation: 'close' })
      for (const call of this.calls.values())
        call.outcome.reject(new Error('Native browser has stopped'))
      await Promise.allSettled(this.pending)
    })()
    return this.closing
  }

  private async execute(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string,
    runId?: string,
    authorize?: Parameters<AgentBrowserToolPort['callTool']>[4],
    signal: AbortSignal = new AbortController().signal
  ): Promise<string> {
    signal.throwIfAborted()
    if (this.failure || this.closing) throw this.failure ?? new Error('Core browser is stopping')
    if (this.calls.size >= CORE_NATIVE_QUEUED + CORE_NATIVE_CALLS - 2)
      throw new Error('Core browser call limit exceeded')
    const id = randomUUID()
    const command = z.enum(['get_browser_status', 'load_url', 'cdp_send']).parse(toolName)
    const call: Call = {
      signal,
      authorize,
      authorized: false,
      outcome: Promise.withResolvers<CoreBrowserOutcome>()
    }
    void call.outcome.promise.catch(() => {})
    this.calls.set(id, call)
    let admitted = false
    let cancellation: Promise<unknown> | undefined
    const abort = () => {
      if (!admitted || cancellation) return
      cancellation = this.invoke({ operation: 'cancel', id })
      void cancellation.catch((error) => this.fail(error))
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      z.object({ accepted: z.literal(true) })
        .strict()
        .parse(
          await this.invoke({
            operation: 'open',
            id,
            toolName: command,
            args,
            conversationId,
            runId,
            authorize: Boolean(authorize)
          })
        )
      admitted = true
      if (signal.aborted) abort()
      const outcome = await call.outcome.promise
      await cancellation
      signal.throwIfAborted()
      if ('authorizationError' in call) throw call.authorizationError
      if (!outcome.ok) {
        if (outcome.unavailable) throw new YoBrowserUnavailableError(outcome.unavailable)
        const error = new Error(outcome.error.message)
        error.name = outcome.error.name
        throw error
      }
      return outcome.value
    } catch (error) {
      if (!admitted) {
        try {
          await this.invoke({ operation: 'cancel', id })
        } catch (failure) {
          this.fail(failure)
        }
      }
      throw error
    } finally {
      signal.removeEventListener('abort', abort)
      this.calls.delete(id)
    }
  }

  private fail(input: unknown): Error {
    if (this.failure) return this.failure
    const error = input instanceof Error ? input : new Error('Core browser delivery failed')
    this.failure = error
    for (const call of this.calls.values()) call.outcome.reject(error)
    this.failed(error)
    return error
  }
}
