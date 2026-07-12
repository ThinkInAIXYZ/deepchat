import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { AcpAgentConfig } from '@shared/presenter'
import type { MessageStartResult, SendMessageInput } from '@shared/types/agent-interface'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AcpSessionManager, AcpSessionRecord } from '@/agent/acp/runtime/acpSessionManager'
import {
  AcpPromptController,
  type AcpPromptTurn
} from '@/agent/acp/client/session/AcpPromptController'
import { AcpMessageFormatter } from '@/agent/acp/runtime/acpMessageFormatter'
import { AcpContentMapper } from '@/agent/acp/runtime/acpContentMapper'
import { AcpPermissionBridge } from '@/agent/acp/runtime/acpPermissionBridge'
import type {
  AcpCompatibilityProjectionPort,
  AcpCompatibilityPromptPort,
  AcpDebugPort,
  AcpInstanceScope,
  AcpProjectionHandle,
  AcpPromptResourcePort,
  AcpRateGatePort,
  AcpRequestTracePort,
  AcpTurnPersistencePort
} from './ports'

interface ActivePrompt {
  controller: AbortController
  projection?: AcpProjectionHandle
  session?: AcpSessionRecord
}

class AcpPromptTimeoutError extends Error {
  readonly code = 'ACP_PROMPT_TIMEOUT'

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`)
    this.name = 'AbortError'
  }
}

export interface AcpAgentInstanceDependencies {
  sessionManager: Pick<AcpSessionManager, 'getOrCreateSession' | 'clearSession'>
  promptResources: AcpPromptResourcePort
  promptBuilder: AcpCompatibilityPromptPort
  projection: AcpCompatibilityProjectionPort
  trace: AcpRequestTracePort
  rateGate: AcpRateGatePort
  turns: AcpTurnPersistencePort
  debug: AcpDebugPort
}

export interface AcpAgentInstanceOptions {
  sessionId: AppSessionId
  agent: AcpAgentConfig
  workdir: string
  scope: AcpInstanceScope
}

export class AcpAgentInstance {
  readonly kind = 'acp' as const
  readonly sessionId: AppSessionId
  private readonly promptController: AcpPromptController
  private readonly messageFormatter: AcpMessageFormatter
  private readonly contentMapper: AcpContentMapper
  private readonly permissionBridge: AcpPermissionBridge
  private active?: ActivePrompt
  private closed = false

  constructor(
    private readonly options: AcpAgentInstanceOptions,
    private readonly dependencies: AcpAgentInstanceDependencies
  ) {
    this.sessionId = options.sessionId
    this.promptController = new AcpPromptController()
    this.messageFormatter = new AcpMessageFormatter()
    this.contentMapper = new AcpContentMapper()
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

  async send(content: string | SendMessageInput): Promise<MessageStartResult> {
    if (this.closed) throw new Error(`ACP session ${this.sessionId} is closed`)
    if (this.active) throw new Error(`ACP session ${this.sessionId} is already generating`)

    const active: ActivePrompt = { controller: new AbortController() }
    this.active = active
    const { signal } = active.controller
    const { agent, scope, workdir } = this.options
    let turn: AcpPromptTurn | null = null
    let turnFinished = false
    let projectionResult: AcpProjectionHandle | undefined

    this.dependencies.projection.setStatus('generating')
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
      await this.attemptViewManifest({
        sessionId: this.sessionId,
        messageId: active.projection.messageId,
        requestSeq: active.projection.requestSeq,
        providerId: 'acp',
        modelId: agent.id,
        messages: builtPrompt.messages,
        localToolDefinitions: builtPrompt.localToolDefinitions
      })
      this.throwIfAborted(signal)
      await this.dependencies.rateGate.wait(signal)
      this.throwIfAborted(signal)

      const session = await this.dependencies.sessionManager.getOrCreateSession(
        this.sessionId,
        agent,
        {
          onSessionUpdate: (notification) => this.handleSessionUpdate(notification),
          onPermission: (request) => this.handlePermissionRequest(request),
          onProcessExit: (remoteSessionId) => this.handleProcessExit(remoteSessionId)
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
      active.projection = undefined
      const settlement = this.dependencies.projection.complete(
        completedProjection,
        response.stopReason
      )
      this.dependencies.projection.setStatus(settlement.status === 'completed' ? 'idle' : 'error')
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
        if (aborted) this.dependencies.projection.cancel(failedProjection)
        else this.dependencies.projection.fail(failedProjection, error)
      }
      this.dependencies.projection.setStatus(aborted ? 'idle' : 'error')
      return {
        requestId: projectionResult?.requestId ?? null,
        messageId: projectionResult?.messageId ?? null
      }
    } finally {
      if (active.session) {
        this.permissionBridge.cancelSession(active.session.sessionId)
        this.contentMapper.clearSession(active.session.sessionId)
        try {
          await active.session.connection.cancel({ sessionId: active.session.sessionId })
        } catch (error) {
          console.warn('[ACP] cancel failed:', error)
        }
      }
      if (this.active === active) this.active = undefined
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
  }

  resolvePermissionRequest(requestId: string, granted: boolean): boolean {
    return this.permissionBridge.resolve(requestId, granted)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.cancel()
    this.permissionBridge.close()
    await this.dependencies.sessionManager.clearSession(this.sessionId)
  }

  private handleSessionUpdate(notification: schema.SessionNotification): void {
    const active = this.active
    if (!active?.projection) return
    const mapped = this.contentMapper.map(notification)
    if (mapped.events.length > 0) {
      this.dependencies.projection.applyEvents(active.projection, mapped.events)
    }

    const session = active.session ?? null
    if (session) {
      if (mapped.currentModeId) session.currentModeId = mapped.currentModeId
      if (mapped.availableCommands) session.availableCommands = mapped.availableCommands
      if (mapped.configState) session.configState = mapped.configState
    }
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
    if (!active) return
    this.permissionBridge.cancelSession(remoteSessionId)
    active.controller.abort()
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
