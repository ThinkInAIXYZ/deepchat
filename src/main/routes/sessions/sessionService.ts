import type {
  ChatMessagePageResult,
  MessagePageCursor,
  SessionWithState
} from '@shared/types/agent-interface'
import type { ActiveSessionResolution, SessionResolutionResult } from '@shared/presenter'
import type { PublicSessionResolution } from '@shared/contracts/routes'
import type {
  SessionCreateOutput,
  SessionCreateRouteInput
} from '@shared/contracts/routes/sessions.routes'
import {
  getAvailableSession,
  reportTerminalSessionResolution
} from '@/presenter/agentSessionPresenter/sessionResolution'
import type { MessageRepository, SessionListFilters, SessionRepository } from '../hotPathPorts'
import type { OperationRunner } from '../operationRunner'
import {
  CreateOperationConflictError,
  ExistingCreateOperationError
} from '@/presenter/agentSessionPresenter/createSessionOperation'

const SESSION_OPERATION_TIMEOUT_MS = 5_000
const DEFAULT_RESTORE_MESSAGE_LIMIT = 100

class RetryableSessionReadError extends Error {
  constructor(
    readonly resolution: Extract<SessionResolutionResult, { availability: 'transient_error' }>
  ) {
    super('Session resolution read is retryable')
    this.name = 'RetryableSessionReadError'
  }
}

function toPublicSessionResolution(resolution: SessionResolutionResult): PublicSessionResolution {
  switch (resolution.availability) {
    case 'available':
      return {
        availability: 'available',
        session: resolution.session
      }
    case 'unavailable':
      return {
        availability: 'unavailable',
        sessionId: resolution.sessionId,
        record: resolution.record,
        reason: resolution.reason
      }
    case 'missing':
      return {
        availability: 'missing',
        sessionId: resolution.sessionId
      }
    case 'transient_error':
      return {
        availability: 'transient_error',
        sessionId: resolution.sessionId,
        record: resolution.record,
        error: {
          code: resolution.error.code,
          stage: resolution.error.stage,
          retryable: true
        }
      }
  }
}

export type SessionRouteContext = {
  webContentsId: number
  windowId: number | null
}

export class SessionService {
  constructor(
    private readonly deps: {
      sessionRepository: SessionRepository
      messageRepository: MessageRepository
      scheduler: OperationRunner
    }
  ) {}

  async createSession(input: SessionCreateRouteInput): Promise<SessionCreateOutput> {
    const { operationId, ...createInput } = input
    try {
      const task = this.deps.sessionRepository.create(createInput, operationId)
      let timer: ReturnType<typeof setTimeout> | undefined
      const observationDeadline = new Promise<{ settled: false }>((resolve) => {
        timer = setTimeout(() => resolve({ settled: false }), SESSION_OPERATION_TIMEOUT_MS)
      })
      let observed: { settled: true; session: SessionWithState | null } | { settled: false }
      try {
        observed = await Promise.race([
          task.then((session) => ({ settled: true as const, session })),
          observationDeadline
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }

      if (!observed.settled) {
        const operation = this.deps.sessionRepository.getCreateOperationSnapshot(operationId)
        if (!operation) {
          throw new Error('Session create operation journal entry is missing')
        }
        return {
          kind: 'operation',
          operation,
          session: null
        }
      }

      const result = await this.deps.sessionRepository.getCreateOperation(operationId)
      if (!result.operation) {
        throw new Error('Session create operation journal entry is missing')
      }
      return {
        kind: 'operation',
        operation: result.operation,
        session: observed.session
      }
    } catch (error) {
      if (error instanceof ExistingCreateOperationError) {
        return {
          kind: 'existing',
          code: error.code,
          operation: error.operation
        }
      }
      if (error instanceof CreateOperationConflictError) {
        return {
          kind: 'conflict',
          code: error.code,
          operation: error.operation
        }
      }
      throw error
    }
  }

  async getCreateOperation(operationId: string) {
    return await this.deps.sessionRepository.getCreateOperation(operationId)
  }

  listCreateOperations(input: {
    limit: number
    cursor?: { createdAt: number; operationId: string } | null
  }) {
    return this.deps.sessionRepository.listCreateOperations(input)
  }

  dismissCreateOperation(operationId: string) {
    return this.deps.sessionRepository.dismissCreateOperation(operationId)
  }

  async restoreSession(
    sessionId: string,
    limit?: number
  ): Promise<
    {
      session: SessionWithState | null
      resolution: PublicSessionResolution
    } & ChatMessagePageResult
  > {
    const effectiveLimit = limit ?? DEFAULT_RESTORE_MESSAGE_LIMIT
    const { resolution, attemptCount } = await this.resolveSessionWithRetry(
      sessionId,
      `sessions.restore:${sessionId}`
    )
    const session = getAvailableSession(resolution)

    if (!session) {
      reportTerminalSessionResolution('sessions.restore', resolution, attemptCount)
      return {
        session: null,
        resolution: toPublicSessionResolution(resolution),
        messages: [],
        nextCursor: null,
        hasMore: false
      }
    }

    const page = await this.deps.scheduler.observeIdempotent({
      task: async () =>
        await this.deps.messageRepository.listPageBySession(sessionId, {
          limit: effectiveLimit
        }),
      deadlineMs: SESSION_OPERATION_TIMEOUT_MS,
      reason: `sessions.restore:${sessionId}:messages`
    })

    return {
      session,
      resolution: toPublicSessionResolution(resolution),
      ...page
    }
  }

  async listMessagesPage(
    sessionId: string,
    options?: {
      limit?: number
      cursor?: MessagePageCursor | null
    }
  ): Promise<ChatMessagePageResult> {
    return await this.deps.scheduler.observeIdempotent({
      task: async () => await this.deps.messageRepository.listPageBySession(sessionId, options),
      deadlineMs: SESSION_OPERATION_TIMEOUT_MS,
      reason: `sessions.listMessagesPage:${sessionId}`
    })
  }

  async listSessions(
    filters?: SessionListFilters
  ): Promise<{ sessions: SessionWithState[]; results: PublicSessionResolution[] }> {
    const resolutions = await this.deps.scheduler.observeIdempotent({
      task: async () => await this.deps.sessionRepository.resolveList(filters),
      deadlineMs: SESSION_OPERATION_TIMEOUT_MS,
      reason: 'sessions.list'
    })

    const sessions: SessionWithState[] = []
    for (const resolution of resolutions) {
      const session = getAvailableSession(resolution)
      if (session) {
        sessions.push(session)
      } else {
        reportTerminalSessionResolution('sessions.list', resolution)
      }
    }
    return {
      sessions,
      results: resolutions.map(toPublicSessionResolution)
    }
  }

  async activateSession(context: SessionRouteContext, sessionId: string): Promise<void> {
    await this.deps.sessionRepository.activate(context.webContentsId, sessionId)
  }

  async deactivateSession(context: SessionRouteContext): Promise<void> {
    await this.deps.sessionRepository.deactivate(context.webContentsId)
  }

  async getActiveSession(
    context: SessionRouteContext
  ): Promise<{ session: SessionWithState | null; resolution: PublicSessionResolution | null }> {
    let attemptCount = 0
    let active: ActiveSessionResolution

    try {
      active = await this.deps.scheduler.retryIdempotent({
        task: async () => {
          attemptCount += 1
          const result = await this.deps.sessionRepository.resolveActive(context.webContentsId)
          if (result.binding === 'bound' && result.resolution.availability === 'transient_error') {
            throw new RetryableSessionReadError(result.resolution)
          }
          return result
        },
        maxAttempts: 2,
        initialDelayMs: 25,
        backoff: 1,
        overallDeadlineMs: SESSION_OPERATION_TIMEOUT_MS,
        shouldRetry: (error) => error instanceof RetryableSessionReadError,
        reason: 'sessions.getActive'
      })
    } catch (error) {
      if (!(error instanceof RetryableSessionReadError)) {
        throw error
      }
      active = {
        binding: 'bound',
        sessionId: error.resolution.sessionId,
        resolution: error.resolution
      }
    }

    if (active.binding === 'none') {
      return { session: null, resolution: null }
    }

    const session = getAvailableSession(active.resolution)
    if (!session) {
      reportTerminalSessionResolution('sessions.getActive', active.resolution, attemptCount)
    }
    return {
      session,
      resolution: toPublicSessionResolution(active.resolution)
    }
  }

  private async resolveSessionWithRetry(
    sessionId: string,
    reason: string
  ): Promise<{ resolution: SessionResolutionResult; attemptCount: number }> {
    let attemptCount = 0
    try {
      const read = await this.deps.scheduler.retryIdempotent({
        task: async () => {
          attemptCount += 1
          const result = await this.deps.sessionRepository.resolve(sessionId)
          if (result.availability === 'transient_error') {
            throw new RetryableSessionReadError(result)
          }
          return result
        },
        maxAttempts: 2,
        initialDelayMs: 25,
        backoff: 1,
        overallDeadlineMs: SESSION_OPERATION_TIMEOUT_MS,
        shouldRetry: (error) => error instanceof RetryableSessionReadError,
        reason
      })
      return { resolution: read, attemptCount }
    } catch (error) {
      if (!(error instanceof RetryableSessionReadError)) {
        throw error
      }
      return { resolution: error.resolution, attemptCount }
    }
  }
}
