import type {
  ChatMessagePageResult,
  ChatMessageRecord,
  CreateDetachedSessionInput,
  MessagePageCursor,
  MessageStartResult,
  SessionRecord,
  SessionWithState
} from '@shared/types/agent-interface'
import {
  eventsSubscribeRoute,
  RUN_MESSAGE_MAX_TEXT_BYTES,
  runsCancelRoute,
  runsGetRoute,
  sessionsRunDetachedRoute,
  type EventsSubscribeInput,
  type PublicRunMessage,
  type PublicRunSnapshot,
  type RunDetachedInput,
  type RunGetInput
} from '@shared/contracts/routes'
import { AssistantMessageBlockSchema } from '@shared/contracts/common'
import {
  runsCancelRequestedEvent,
  runsCreatedEvent,
  runsSnapshotEvent,
  runsTurnAcceptedEvent,
  runsTurnFailedEvent
} from '@shared/contracts/events'
import { extractUserMessageInput } from '@/session/data/userMessageContent'
import { hasWaitingInteraction } from '@/agent/deepchat/runtime/sessionUpdates'
import { projectFinalAssistantAnswer } from '@shared/lib/assistantDeliverySegments'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import {
  createRouteMap,
  type CliRouteCaller,
  type DeepchatRouteMap,
  type RouteCaller
} from '@/routes/routeRegistry'
import type { TypedEventHub } from '@/events/typedEventHub'
import { TypedEventHubCapacityError, TypedEventHubOverflowError } from '@/events/typedEventHub'
import { CliRequestError } from './errors'
import type { CliStreamEmitter } from './server'

const DEFAULT_MESSAGE_LIMIT = 50
const RUN_SNAPSHOT_MESSAGE_BUDGET_BYTES = 8 * 1024 * 1024
const RUN_START_FAILURE_MESSAGE = 'Detached Agent run could not start'
const AssistantMessageBlocksSchema = AssistantMessageBlockSchema.array()

type RunLifecyclePort = Readonly<{
  createDetachedSession(input: CreateDetachedSessionInput): Promise<SessionWithState>
}>

type RunTurnPort = Readonly<{
  sendMessage(
    sessionId: string,
    content: string,
    options?: { maxProviderRounds?: number }
  ): Promise<MessageStartResult>
  cancelGeneration(sessionId: string): Promise<void>
}>

type RunProjectionPort = Readonly<{
  getSession(sessionId: string): Promise<SessionWithState | null>
  listMessagesPage(
    sessionId: string,
    options?: { limit?: number; cursor?: MessagePageCursor | null }
  ): Promise<ChatMessagePageResult>
}>

type RunSessionStorePort = Readonly<{
  get(sessionId: string): SessionRecord | null
}>

export type CliRunServiceOptions = Readonly<{
  lifecycle: RunLifecyclePort
  turn: RunTurnPort
  projection: RunProjectionPort
  sessions: RunSessionStorePort
  getPendingAssistantMessages(runId: string): ChatMessageRecord[]
  hasWaitingDescendantInteraction(runId: string): boolean
  eventHub: TypedEventHub
  now?: () => number
  log?: Pick<Console, 'warn'>
}>

function requireCliCaller(caller: RouteCaller): CliRouteCaller {
  if (caller.kind !== 'cli') {
    throw new CliRequestError('permission_denied', 'Run routes require a CLI caller', {
      httpStatus: 403
    })
  }
  return caller
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return { value, truncated: false }
  const output: string[] = []
  let bytes = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (bytes + characterBytes > maxBytes) break
    output.push(character)
    bytes += characterBytes
  }
  return { value: output.join(''), truncated: true }
}

function messageText(message: ChatMessageRecord): string {
  if (message.role === 'user') return extractUserMessageInput(message.content).text
  if (message.status !== 'sent') return ''
  try {
    const blocks = AssistantMessageBlocksSchema.safeParse(JSON.parse(message.content))
    if (!blocks.success) return ''
    const validatedBlocks = blocks.data as AssistantMessageBlock[]
    if (validatedBlocks.some((block) => block.type === 'content' && block.status !== 'success')) {
      return ''
    }
    return projectFinalAssistantAnswer(validatedBlocks)
  } catch {
    return ''
  }
}

function runPhase(
  status: SessionWithState['status'],
  messages: readonly ChatMessageRecord[],
  hasWaitingDescendantInteraction: boolean
): PublicRunSnapshot['phase'] {
  if (status !== 'generating') return 'terminal'
  if (hasWaitingDescendantInteraction) return 'awaiting_interaction'
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    try {
      const blocks = JSON.parse(message.content) as AssistantMessageBlock[]
      if (Array.isArray(blocks) && hasWaitingInteraction(blocks)) {
        return 'awaiting_interaction'
      }
    } catch {
      // A malformed transcript cannot manufacture an interaction wait.
    }
  }
  return 'running'
}

function toPublicMessage(message: ChatMessageRecord): PublicRunMessage {
  const text = truncateUtf8(messageText(message), RUN_MESSAGE_MAX_TEXT_BYTES)
  return {
    id: message.id,
    role: message.role,
    status: message.status,
    text: text.value,
    textTruncated: text.truncated,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt
  }
}

function projectMessagePage(
  page: ChatMessagePageResult
): Pick<PublicRunSnapshot, 'messages' | 'nextCursor' | 'hasMore'> {
  const messages: PublicRunMessage[] = []
  let serializedBytes = 2
  let firstIncludedIndex = page.messages.length

  for (let index = page.messages.length - 1; index >= 0; index -= 1) {
    const message = toPublicMessage(page.messages[index])
    const messageBytes = Buffer.byteLength(JSON.stringify(message), 'utf8')
    const separatorBytes = messages.length > 0 ? 1 : 0
    if (serializedBytes + separatorBytes + messageBytes > RUN_SNAPSHOT_MESSAGE_BUDGET_BYTES) break
    messages.unshift(message)
    serializedBytes += separatorBytes + messageBytes
    firstIncludedIndex = index
  }

  const omittedFromPage = firstIncludedIndex > 0
  const hasMore = page.hasMore || omittedFromPage
  const firstIncluded = page.messages[firstIncludedIndex]
  const nextCursor = omittedFromPage
    ? firstIncluded
      ? { orderSeq: firstIncluded.orderSeq, id: firstIncluded.id }
      : page.nextCursor
    : page.nextCursor

  return { messages, nextCursor: hasMore ? nextCursor : null, hasMore }
}

export class CliRunService {
  private readonly now: () => number
  private readonly log: Pick<Console, 'warn'>

  constructor(private readonly options: CliRunServiceOptions) {
    this.now = options.now ?? Date.now
    this.log = options.log ?? console
  }

  createRoutes(): DeepchatRouteMap {
    return createRouteMap([
      [
        sessionsRunDetachedRoute.name,
        async (rawInput, context) =>
          await this.startDetachedRun(
            sessionsRunDetachedRoute.input.parse(rawInput),
            requireCliCaller(context.caller)
          )
      ],
      [
        runsGetRoute.name,
        async (rawInput, context) =>
          await this.getRun(runsGetRoute.input.parse(rawInput), requireCliCaller(context.caller))
      ],
      [
        runsCancelRoute.name,
        async (rawInput, context) =>
          await this.cancelRun(
            runsCancelRoute.input.parse(rawInput),
            requireCliCaller(context.caller)
          )
      ]
    ])
  }

  handlesStream(method: string): boolean {
    return method === eventsSubscribeRoute.name
  }

  async dispatchStream(
    method: string,
    rawInput: unknown,
    caller: CliRouteCaller,
    signal: AbortSignal,
    emit: CliStreamEmitter
  ): Promise<unknown> {
    if (method !== eventsSubscribeRoute.name) {
      throw new CliRequestError('not_found', 'Run streaming method is not implemented', {
        httpStatus: 404
      })
    }
    return await this.subscribeToRun(
      eventsSubscribeRoute.input.parse(rawInput),
      caller,
      signal,
      emit
    )
  }

  private async startDetachedRun(
    input: RunDetachedInput,
    caller: CliRouteCaller
  ): Promise<unknown> {
    if (caller.principal !== 'human') {
      throw new CliRequestError('permission_denied', 'Agents cannot create detached Agent runs', {
        httpStatus: 403
      })
    }

    const session = await this.options.lifecycle.createDetachedSession({
      ...(input.agentId ? { agentId: input.agentId } : {}),
      title: input.title ?? 'CLI Run',
      ...(input.projectDir ? { projectDir: input.projectDir } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}),
      permissionMode: 'default',
      ...(input.activeSkills ? { activeSkills: input.activeSkills } : {}),
      ...(input.disabledAgentTools ? { disabledAgentTools: input.disabledAgentTools } : {}),
      ...(input.systemPrompt !== undefined
        ? { generationSettings: { systemPrompt: input.systemPrompt } }
        : {}),
      metadata: { source: 'cli_run' }
    })
    const runId = session.id
    this.options.eventHub.publish(
      runsCreatedEvent.name,
      {
        runId,
        sessionId: session.id,
        status: session.status,
        createdAt: session.createdAt
      },
      { kind: 'run', runId }
    )

    let initialTurn: MessageStartResult
    try {
      initialTurn = await this.options.turn.sendMessage(
        session.id,
        input.prompt,
        input.maxTurns ? { maxProviderRounds: input.maxTurns } : undefined
      )
    } catch (error) {
      this.log.warn('[CLI] Failed to start detached Agent run', {
        runId,
        failure: { name: error instanceof Error ? error.name : typeof error }
      })
      this.options.eventHub.publish(
        runsTurnFailedEvent.name,
        {
          runId,
          sessionId: session.id,
          failedAt: this.now(),
          error: RUN_START_FAILURE_MESSAGE
        },
        { kind: 'run', runId }
      )
      throw new CliRequestError('conflict', RUN_START_FAILURE_MESSAGE, {
        httpStatus: 409,
        details: { runId, sessionId: session.id }
      })
    }

    const acceptedAt = this.now()
    this.options.eventHub.publish(
      runsTurnAcceptedEvent.name,
      {
        runId,
        sessionId: session.id,
        requestId: initialTurn.requestId,
        messageId: initialTurn.messageId,
        acceptedAt
      },
      { kind: 'run', runId }
    )
    const acceptedSession = await this.requireRunSnapshot(runId)
    return sessionsRunDetachedRoute.output.parse({
      runId,
      sessionId: session.id,
      status: acceptedSession.status,
      requestId: initialTurn.requestId,
      messageId: initialTurn.messageId,
      createdAt: session.createdAt
    })
  }

  private async getRun(input: RunGetInput, caller: CliRouteCaller): Promise<PublicRunSnapshot> {
    this.requireOwnedRun(input.runId, caller)
    return await this.buildSnapshot(input.runId, input.limit, input.cursor)
  }

  private async cancelRun(input: { runId: string }, caller: CliRouteCaller): Promise<unknown> {
    this.requireOwnedRun(input.runId, caller)
    const before = await this.requireRunSnapshot(input.runId)
    const cancelRequested = before.status === 'generating'
    if (cancelRequested) {
      await this.options.turn.cancelGeneration(input.runId)
      this.options.eventHub.publish(
        runsCancelRequestedEvent.name,
        {
          runId: input.runId,
          sessionId: input.runId,
          requestedAt: this.now()
        },
        { kind: 'run', runId: input.runId }
      )
    }
    const after = cancelRequested ? await this.requireRunSnapshot(input.runId) : before
    return runsCancelRoute.output.parse({
      runId: input.runId,
      cancelRequested,
      status: after.status
    })
  }

  private async subscribeToRun(
    input: EventsSubscribeInput,
    caller: CliRouteCaller,
    signal: AbortSignal,
    emit: CliStreamEmitter
  ): Promise<unknown> {
    const session = this.requireOwnedRun(input.runId, caller)
    if (session.metadata?.source !== 'cli_run') {
      throw new CliRequestError('not_found', 'Run was not found', { httpStatus: 404 })
    }
    let subscription
    try {
      subscription = this.options.eventHub.subscribe(
        { kind: 'run', runId: input.runId },
        { ...(input.cursor ? { afterCursor: input.cursor } : {}), signal }
      )
    } catch (error) {
      if (error instanceof TypedEventHubCapacityError) {
        throw new CliRequestError('rate_limited', 'Too many active event subscribers', {
          httpStatus: 429,
          retriable: true
        })
      }
      throw error
    }

    let lastCursor = subscription.initialCursor
    try {
      const currentRun = await this.buildSnapshot(input.runId, input.messageLimit)
      const terminalAtSubscribe = currentRun.status !== 'generating'
      if (subscription.recoveryReason) {
        const snapshot = runsSnapshotEvent.payload.parse({
          cursor: subscription.initialCursor,
          recoveryReason: subscription.recoveryReason,
          run: currentRun
        })
        await emit(runsSnapshotEvent.name, snapshot, {
          runId: input.runId,
          cursor: subscription.initialCursor
        })
        if (terminalAtSubscribe) {
          return eventsSubscribeRoute.output.parse({ runId: input.runId, lastCursor })
        }
      }

      let caughtUp =
        subscription.recoveryReason !== null || input.cursor === subscription.initialCursor
      if (terminalAtSubscribe && caughtUp) {
        return eventsSubscribeRoute.output.parse({ runId: input.runId, lastCursor })
      }
      for await (const event of subscription.events) {
        await emit(event.event, event.data, {
          runId: input.runId,
          cursor: event.cursor
        })
        lastCursor = event.cursor
        if (!caughtUp && event.cursor === subscription.initialCursor) {
          caughtUp = true
          if (terminalAtSubscribe) break
          continue
        }
        if (caughtUp && this.isTerminalEvent(input.runId, event.event, event.data)) break
      }
    } catch (error) {
      if (error instanceof TypedEventHubOverflowError) {
        throw new CliRequestError('result_too_large', 'Event subscriber could not keep up', {
          httpStatus: 409,
          retriable: true,
          details: { runId: input.runId, lastCursor }
        })
      }
      throw error
    } finally {
      subscription.close()
    }

    return eventsSubscribeRoute.output.parse({ runId: input.runId, lastCursor })
  }

  private isTerminalEvent(runId: string, event: string, data: unknown): boolean {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false
    const payload = data as { runId?: unknown; sessionId?: unknown; status?: unknown }
    if (event === runsTurnFailedEvent.name) return payload.runId === runId
    if (payload.sessionId !== runId) return false
    if (event !== 'sessions.status.changed') return false
    const status = payload.status
    return status === 'idle' || status === 'error'
  }

  private requireOwnedRun(runId: string, caller: CliRouteCaller): SessionRecord {
    const session = this.options.sessions.get(runId)
    if (!session) {
      throw new CliRequestError('not_found', 'Run was not found', { httpStatus: 404 })
    }
    const owned =
      caller.principal === 'human'
        ? session.metadata?.source === 'cli_run'
        : caller.conversationId === runId
    if (!owned) {
      throw new CliRequestError('not_found', 'Run was not found', { httpStatus: 404 })
    }
    return session
  }

  private async requireRunSnapshot(runId: string): Promise<SessionWithState> {
    const session = await this.options.projection.getSession(runId)
    if (!session) {
      throw new CliRequestError('not_found', 'Run was not found', { httpStatus: 404 })
    }
    return session
  }

  private async buildSnapshot(
    runId: string,
    limit = DEFAULT_MESSAGE_LIMIT,
    cursor?: MessagePageCursor | null
  ): Promise<PublicRunSnapshot> {
    const [session, page] = await Promise.all([
      this.requireRunSnapshot(runId),
      this.options.projection.listMessagesPage(runId, { limit, cursor: cursor ?? null })
    ])
    const phaseMessages =
      session.status === 'generating' && (cursor != null || page.hasMore)
        ? this.options.getPendingAssistantMessages(runId)
        : page.messages
    const projectedPage = projectMessagePage(page)
    return runsGetRoute.output.parse({
      runId,
      sessionId: session.id,
      agentId: session.agentId,
      title: session.title,
      status: session.status,
      phase: runPhase(
        session.status,
        phaseMessages,
        session.status === 'generating' && this.options.hasWaitingDescendantInteraction(runId)
      ),
      providerId: session.providerId,
      modelId: session.modelId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      ...projectedPage
    })
  }
}
