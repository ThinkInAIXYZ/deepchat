import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { AcpAgentConfig } from '@shared/types/acp'
import type { MessageStartResult, SendMessageInput } from '@shared/types/agent-interface'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AcpSessionRecord } from '@/agent/acp/runtime/acpSessionManager'
import {
  AcpPromptController,
  type AcpPromptTurn
} from '@/agent/acp/client/session/AcpPromptController'
import { AcpMessageFormatter } from '@/agent/acp/runtime/acpMessageFormatter'
import { AcpPermissionBridge } from '@/agent/acp/runtime/acpPermissionBridge'
import type {
  AcpAgentSessionHandle,
  AcpAgentSnapshot,
  AcpAgentStatus,
  AcpCompatibilityProjectionPort,
  AcpCompatibilityPromptPort,
  AcpDebugPort,
  AcpInstanceScope,
  AcpObserverPort,
  AcpPermissionFacet,
  AcpProjectionHandle,
  AcpPromptResourcePort,
  AcpRateGatePort,
  AcpRequestTracePort,
  AcpSessionCapabilityFacet,
  AcpSessionLifecycleFacet,
  AcpSessionRuntimePort,
  AcpTurnPersistencePort
} from './ports'

interface ActivePrompt {
  controller: AbortController
  settled: Promise<void>
  settle(): void
  projection?: AcpProjectionHandle
  session?: AcpSessionRecord
}

interface ActivePreparation {
  controller: AbortController
  settled: Promise<void>
  settle(): void
}

class AcpPromptTimeoutError extends Error {
  readonly code = 'ACP_PROMPT_TIMEOUT'

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`)
    this.name = 'AbortError'
  }
}

export interface AcpAgentInstanceDependencies {
  sessions: AcpSessionRuntimePort
  promptController: AcpPromptController
  promptResources: AcpPromptResourcePort
  promptBuilder: AcpCompatibilityPromptPort
  projection: AcpCompatibilityProjectionPort
  trace: AcpRequestTracePort
  rateGate: AcpRateGatePort
  turns: AcpTurnPersistencePort
  debug: AcpDebugPort
  observer: AcpObserverPort
  onProcessExit?: (instance: AcpAgentInstance) => void
  onClosed?: (instance: AcpAgentInstance) => void
}

export interface AcpAgentInstanceOptions {
  sessionId: AppSessionId
  agent: AcpAgentConfig
  workdir: string
  scope: AcpInstanceScope
}

export class AcpAgentInstance
  implements
    AcpAgentSessionHandle,
    AcpSessionLifecycleFacet,
    AcpSessionCapabilityFacet,
    AcpPermissionFacet
{
  readonly kind = 'acp' as const
  readonly sessionId: AppSessionId
  private readonly promptController: AcpPromptController
  private readonly messageFormatter: AcpMessageFormatter
  private readonly permissionBridge: AcpPermissionBridge
  private workdir: string
  private status: AcpAgentStatus = 'idle'
  private firstTurnReady = false
  private readonly firstTurnReadyWaiters = new Set<(ready: boolean) => void>()
  private active?: ActivePrompt
  private preparing?: ActivePreparation
  private closed = false
  private closePromise?: Promise<void>

  constructor(
    private readonly options: AcpAgentInstanceOptions,
    private readonly dependencies: AcpAgentInstanceDependencies
  ) {
    this.sessionId = options.sessionId
    this.workdir = options.workdir
    this.promptController = dependencies.promptController
    this.messageFormatter = new AcpMessageFormatter()
    this.permissionBridge = new AcpPermissionBridge({
      presentation: {
        present: (payload) => {
          const projection = this.active?.projection
          if (projection) dependencies.projection.presentPermission(projection, payload)
        },
        settle: (requestId, granted) => {
          const projection = this.active?.projection
          if (projection) dependencies.projection.settlePermission(projection, requestId, granted)
        }
      }
    })
  }

  async send(content: SendMessageInput): Promise<MessageStartResult> {
    if (this.closed) throw new Error(`ACP session ${this.sessionId} is closed`)
    if (this.active) throw new Error(`ACP session ${this.sessionId} is already generating`)

    let settleActive!: () => void
    const active: ActivePrompt = {
      controller: new AbortController(),
      settled: new Promise<void>((resolve) => {
        settleActive = resolve
      }),
      settle: () => settleActive()
    }
    this.active = active
    const { signal } = active.controller
    const { agent, scope } = this.options
    const workdir = this.workdir
    let turn: AcpPromptTurn | null = null
    let turnFinished = false
    let projectionResult: AcpProjectionHandle | undefined

    this.setStatus('generating')
    try {
      this.throwIfAborted(signal)
      const resources = await this.dependencies.promptResources.resolve({
        sessionId: this.sessionId,
        agent,
        scope,
        workdir,
        content,
        signal
      })
      this.throwIfAborted(signal)

      const builtPrompt = this.dependencies.promptBuilder.build({
        scope,
        latestUserMessage: resources.latestUserMessage,
        sections: resources.sections,
        localToolDefinitions: resources.localToolDefinitions
      })
      active.projection = this.dependencies.projection.begin({
        sessionId: this.sessionId,
        userContent: resources.userContent
      })
      projectionResult = active.projection
      this.dependencies.observer.userPromptSubmitted({
        sessionId: this.sessionId,
        messageId: active.projection.messageId,
        promptPreview: resources.userContent.text,
        agentId: agent.id,
        workdir
      })
      await this.attemptViewManifest({
        sessionId: this.sessionId,
        messageId: active.projection.messageId,
        requestSeq: active.projection.requestSeq,
        providerId: 'acp',
        modelId: agent.id,
        messages: builtPrompt.messages,
        localToolDefinitions: builtPrompt.localToolDefinitions,
        ...resources.viewManifest
      })
      this.markFirstTurnReady()
      this.throwIfAborted(signal)
      try {
        await this.dependencies.rateGate.wait(signal)
      } finally {
        this.dependencies.rateGate.clearWaiting()
      }
      this.throwIfAborted(signal)

      const session = await this.dependencies.sessions.open(
        this.sessionId,
        agent,
        {
          onEvents: (events) => {
            const projection = this.active?.projection
            if (projection && events.length > 0) {
              this.dependencies.projection.applyEvents(projection, events)
            }
          },
          onPermission: (request) => this.handlePermissionRequest(request),
          onProcessExit: (remoteSessionId) => this.handleProcessExit(remoteSessionId),
          signal
        },
        workdir
      )
      active.session = session
      this.throwIfAborted(signal)

      const formatted = this.messageFormatter.format(builtPrompt.messages, {
        promptCapabilities: session.promptCapabilities,
        includeSystemPrompt: !session.systemPromptSent
      })
      turn = this.promptController.begin({
        sessionId: session.sessionId,
        conversationId: this.sessionId
      })
      await this.persistTurnStart(turn)

      const requestBody = { sessionId: session.sessionId, prompt: formatted.blocks }
      this.appendDebug('request', session, {
        sessionId: session.sessionId,
        conversationId: this.sessionId,
        agentId: agent.id,
        turnId: turn.id,
        blockCount: formatted.blocks.length,
        timeoutMs: resources.requestTimeoutMs ?? null
      })
      await this.writeTraceFailOpen({
        enabled: resources.traceEnabled,
        sessionId: this.sessionId,
        messageId: active.projection.messageId,
        providerId: 'acp',
        modelId: agent.id,
        requestSeq: active.projection.requestSeq,
        remoteSessionId: session.sessionId,
        prompt: formatted.blocks
      })

      const response = await this.awaitPrompt(
        session.connection.prompt(requestBody),
        signal,
        resources.requestTimeoutMs
      )
      if (formatted.includedSystemPrompt) session.systemPromptSent = true
      this.appendDebug('response', session, {
        sessionId: session.sessionId,
        conversationId: this.sessionId,
        agentId: agent.id,
        turnId: turn.id,
        stopReason: response.stopReason
      })

      const completedTurn = this.promptController.complete(session.sessionId, response.stopReason)
      if (completedTurn) {
        await this.persistTurnFinish(completedTurn)
        turnFinished = true
      }
      const completedProjection = active.projection
      const settlement = this.dependencies.projection.complete(
        completedProjection,
        response.stopReason
      )
      active.projection = undefined
      this.setStatus(settlement.status === 'completed' ? 'idle' : 'error')
      this.dependencies.observer.terminal({
        sessionId: this.sessionId,
        agentId: agent.id,
        workdir,
        ...settlement
      })
      return {
        requestId: completedProjection.requestId,
        messageId: completedProjection.messageId
      }
    } catch (error) {
      const timedOut = error instanceof AcpPromptTimeoutError
      const aborted = !timedOut && signal.aborted
      if (timedOut && active.session) {
        try {
          await active.session.connection.cancel({ sessionId: active.session.sessionId })
        } catch (cancelError) {
          console.warn('[ACP] cancel after timeout failed:', cancelError)
        }
      }
      if (active.session && turn && !turnFinished) {
        const finished = aborted
          ? this.promptController.cancel(active.session.sessionId)
          : this.promptController.fail(active.session.sessionId)
        if (finished) await this.persistTurnFinish(finished)
      }
      if (active.session) {
        this.appendDebug('error', active.session, error)
        this.permissionBridge.cancelSession(active.session.sessionId)
      }
      if (active.projection) {
        const failedProjection = active.projection
        active.projection = undefined
        let settlement
        try {
          settlement = aborted
            ? this.dependencies.projection.cancel(failedProjection)
            : this.dependencies.projection.fail(failedProjection, error)
        } catch (projectionError) {
          console.warn('[ACP] Failed to settle projection:', projectionError)
          settlement = {
            status: 'error' as const,
            stopReason: 'error' as const,
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        }
        this.markFirstTurnReady()
        this.dependencies.observer.terminal({
          sessionId: this.sessionId,
          agentId: agent.id,
          workdir,
          ...settlement
        })
      }
      this.setStatus(aborted ? 'idle' : 'error')
      return {
        requestId: projectionResult?.requestId ?? null,
        messageId: projectionResult?.messageId ?? null
      }
    } finally {
      if (active.session) {
        this.permissionBridge.cancelSession(active.session.sessionId)
        this.dependencies.sessions.clearMappedSession(active.session.sessionId)
        try {
          await active.session.connection.cancel({ sessionId: active.session.sessionId })
        } catch (error) {
          console.warn('[ACP] cancel failed:', error)
        }
      }
      if (this.active === active) this.active = undefined
      active.settle()
    }
  }

  async cancel(): Promise<void> {
    const active = this.active
    if (!active) return
    active.controller.abort()
    if (active.session) {
      this.permissionBridge.cancelSession(active.session.sessionId)
      try {
        await active.session.connection.cancel({ sessionId: active.session.sessionId })
      } catch (error) {
        console.warn('[ACP] cancel failed:', error)
      }
    }
    await active.settled
  }

  getActiveGeneration(): { eventId: string; runId: string } | null {
    const projection = this.active?.projection
    if (!projection) return null
    return { eventId: projection.messageId, runId: projection.requestId }
  }

  async cancelGenerationByEventId(eventId: string): Promise<boolean> {
    const active = this.getActiveGeneration()
    if (!active || active.eventId !== eventId) return false
    await this.cancel()
    return true
  }

  resolvePermissionRequest(requestId: string, granted: boolean): boolean {
    return this.permissionBridge.resolve(requestId, granted)
  }

  async prepare(): Promise<void> {
    if (this.closed) throw new Error(`ACP session ${this.sessionId} is closed`)
    if (this.active) throw new Error(`ACP session ${this.sessionId} is already generating`)
    if (this.preparing) throw new Error(`ACP session ${this.sessionId} is already preparing`)
    let settlePreparation!: () => void
    const preparing: ActivePreparation = {
      controller: new AbortController(),
      settled: new Promise<void>((resolve) => {
        settlePreparation = resolve
      }),
      settle: () => settlePreparation()
    }
    this.preparing = preparing
    this.setStatus('initializing')
    try {
      await this.dependencies.sessions.prepare(this.sessionId, this.options.agent, this.workdir, {
        onProcessExit: (remoteSessionId) => this.handleProcessExit(remoteSessionId),
        signal: preparing.controller.signal
      })
      this.throwIfAborted(preparing.controller.signal)
      this.setStatus('idle')
    } catch (error) {
      this.setStatus('error')
      throw error
    } finally {
      if (this.preparing === preparing) this.preparing = undefined
      preparing.settle()
    }
  }

  async updateWorkdir(workdir: string | null): Promise<string> {
    if (this.closed) throw new Error(`ACP session ${this.sessionId} is closed`)
    await this.cancel()
    const resolved = await this.dependencies.sessions.updateWorkdir(
      this.sessionId,
      this.options.agent.id,
      workdir
    )
    this.workdir = resolved
    return resolved
  }

  getWorkdir(): string {
    return this.workdir
  }

  getModes() {
    return this.dependencies.sessions.getModes(this.sessionId)
  }

  async setMode(modeId: string): Promise<void> {
    await this.dependencies.sessions.setMode(this.sessionId, modeId)
  }

  getConfigOptions() {
    return this.dependencies.sessions.getConfigOptions(this.sessionId)
  }

  async setConfigOption(configId: string, value: string | boolean) {
    return await this.dependencies.sessions.setConfigOption(this.sessionId, configId, value)
  }

  getCommands() {
    return this.dependencies.sessions.getCommands(this.sessionId)
  }

  async snapshot(): Promise<AcpAgentSnapshot> {
    return {
      sessionId: this.sessionId,
      agentId: this.options.agent.id,
      scope: this.options.scope,
      workdir: this.workdir,
      status: this.status,
      ready: this.firstTurnReady,
      active: Boolean(this.active),
      remoteSessionId: this.dependencies.sessions.getSession(this.sessionId)?.sessionId ?? null
    }
  }

  async waitForFirstTurnReady(options?: { timeoutMs?: number }): Promise<boolean> {
    if (this.firstTurnReady) return true
    const timeoutMs = Math.max(0, options?.timeoutMs ?? 30_000)
    if (timeoutMs === 0 || this.closed) return false
    return await new Promise<boolean>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const settle = (ready: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.firstTurnReadyWaiters.delete(settle)
        resolve(ready)
      }
      this.firstTurnReadyWaiters.add(settle)
      timer = setTimeout(() => settle(false), timeoutMs)
    })
  }

  async close(): Promise<void> {
    if (this.closePromise) return await this.closePromise
    this.closed = true
    this.preparing?.controller.abort()
    this.closePromise = (async () => {
      try {
        await this.cancel()
        await this.preparing?.settled
        this.permissionBridge.close()
        this.setStatus('closed')
        this.settleFirstTurnReadyWaiters(false)
        await this.dependencies.sessions.clear(this.sessionId)
      } finally {
        try {
          this.dependencies.onClosed?.(this)
        } catch (error) {
          console.warn('[ACP] Failed to notify instance close:', error)
        }
      }
    })()
    return await this.closePromise
  }

  private async handlePermissionRequest(
    request: schema.RequestPermissionRequest
  ): Promise<schema.RequestPermissionResponse> {
    const active = this.active
    if (
      !active?.projection ||
      (active.session !== undefined && active.session.sessionId !== request.sessionId)
    ) {
      return { outcome: { outcome: 'cancelled' } }
    }
    return await this.permissionBridge.request(request, {
      providerId: 'acp',
      providerName: 'ACP',
      conversationId: this.sessionId,
      agent: this.options.agent
    })
  }

  private handleProcessExit(remoteSessionId: string): void {
    const active = this.active
    this.permissionBridge.cancelSession(remoteSessionId)
    active?.controller.abort()
    this.dependencies.onProcessExit?.(this)
  }

  private setStatus(status: AcpAgentStatus): void {
    this.status = status
    if (status === 'generating' || status === 'idle' || status === 'error') {
      this.dependencies.projection.setStatus(status)
    }
  }

  private markFirstTurnReady(): void {
    if (this.firstTurnReady) return
    this.firstTurnReady = true
    this.settleFirstTurnReadyWaiters(true)
  }

  private settleFirstTurnReadyWaiters(ready: boolean): void {
    const waiters = Array.from(this.firstTurnReadyWaiters)
    this.firstTurnReadyWaiters.clear()
    waiters.forEach((resolve) => resolve(ready))
  }

  private async attemptViewManifest(
    input: Parameters<AcpCompatibilityProjectionPort['attemptViewManifest']>[0]
  ): Promise<void> {
    try {
      await this.dependencies.projection.attemptViewManifest(input)
    } catch (error) {
      console.warn('[ACP] Failed to persist prompt ViewManifest:', error)
    }
  }

  private async writeTraceFailOpen(
    input: Parameters<AcpRequestTracePort['writePrompt']>[0]
  ): Promise<void> {
    try {
      await this.dependencies.trace.writePrompt(input)
    } catch (error) {
      console.warn('[ACP] Failed to persist request trace:', error)
    }
  }

  private async persistTurnStart(turn: AcpPromptTurn): Promise<void> {
    try {
      await this.dependencies.turns.startTurn({
        id: turn.id,
        acpSessionId: turn.sessionId as AcpSessionRecord['sessionId'],
        conversationId: this.sessionId,
        userMessageId: null,
        startedAt: turn.startedAt
      })
    } catch (error) {
      console.warn('[ACP] Failed to persist turn start:', error)
    }
  }

  private async persistTurnFinish(turn: AcpPromptTurn): Promise<void> {
    try {
      await this.dependencies.turns.finishTurn({
        id: turn.id,
        status: turn.status === 'active' ? 'error' : turn.status,
        stopReason: turn.stopReason ?? null,
        completedAt: turn.completedAt ?? Date.now()
      })
    } catch (error) {
      console.warn('[ACP] Failed to persist turn finish:', error)
    }
  }

  private appendDebug(
    kind: 'request' | 'response' | 'error',
    session: AcpSessionRecord,
    payload: unknown
  ): void {
    try {
      this.dependencies.debug.appendDebugEvent(this.options.agent.id, {
        kind,
        action: 'session/prompt',
        sessionId: session.sessionId,
        ...(kind === 'error'
          ? { message: payload instanceof Error ? payload.message : String(payload) }
          : {}),
        payload: payload instanceof Error ? { name: payload.name, stack: payload.stack } : payload
      })
    } catch (error) {
      console.warn('[ACP] Failed to append debug event:', error)
    }
  }

  private async awaitPrompt(
    prompt: Promise<schema.PromptResponse>,
    signal: AbortSignal,
    timeoutMs?: number
  ): Promise<schema.PromptResponse> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    const competitors: Array<Promise<schema.PromptResponse>> = [prompt]

    competitors.push(
      new Promise<never>((_, reject) => {
        onAbort = () => reject(this.createAbortError('ACP prompt cancelled'))
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      })
    )
    if (timeoutMs && timeoutMs > 0) {
      competitors.push(
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new AcpPromptTimeoutError(timeoutMs)), timeoutMs)
        })
      )
    }

    try {
      return await Promise.race(competitors)
    } finally {
      if (timeout) clearTimeout(timeout)
      if (onAbort) signal.removeEventListener('abort', onAbort)
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw this.createAbortError('ACP prompt cancelled')
  }

  private createAbortError(message: string): Error {
    const error = new Error(message)
    error.name = 'AbortError'
    return error
  }
}
