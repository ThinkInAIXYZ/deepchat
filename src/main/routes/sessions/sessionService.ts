import type {
  ChatMessagePageResult,
  CreateSessionInput,
  MessagePageCursor,
  SessionWithState
} from '@shared/types/agent-interface'
import type { ActiveSessionResolution, SessionResolutionResult } from '@shared/presenter'
import {
  getAvailableSession,
  reportTerminalSessionResolution
} from '@/presenter/agentSessionPresenter/sessionResolution'
import type { MessageRepository, SessionListFilters, SessionRepository } from '../hotPathPorts'
import type { Scheduler } from '../scheduler'

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

class NonRetryableSessionReadFailure {
  constructor(readonly error: unknown) {}
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
      scheduler: Scheduler
    }
  ) {}

  async createSession(
    input: CreateSessionInput,
    context: SessionRouteContext
  ): Promise<SessionWithState> {
    return await this.deps.scheduler.timeout({
      task: this.deps.sessionRepository.create(input, context.webContentsId),
      ms: SESSION_OPERATION_TIMEOUT_MS,
      reason: 'sessions.create'
    })
  }

  async restoreSession(
    sessionId: string,
    limit?: number
  ): Promise<
    {
      session: SessionWithState | null
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
        messages: [],
        nextCursor: null,
        hasMore: false
      }
    }

    const page = await this.deps.scheduler.timeout({
      task: this.deps.messageRepository.listPageBySession(sessionId, {
        limit: effectiveLimit
      }),
      ms: SESSION_OPERATION_TIMEOUT_MS,
      reason: `sessions.restore:${sessionId}:messages`
    })

    return {
      session,
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
    return await this.deps.scheduler.timeout({
      task: this.deps.messageRepository.listPageBySession(sessionId, options),
      ms: SESSION_OPERATION_TIMEOUT_MS,
      reason: `sessions.listMessagesPage:${sessionId}`
    })
  }

  async listSessions(filters?: SessionListFilters) {
    const resolutions = await this.deps.scheduler.timeout({
      task: this.deps.sessionRepository.resolveList(filters),
      ms: SESSION_OPERATION_TIMEOUT_MS,
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
    return sessions
  }

  async activateSession(context: SessionRouteContext, sessionId: string): Promise<void> {
    await this.deps.scheduler.timeout({
      task: this.deps.sessionRepository.activate(context.webContentsId, sessionId),
      ms: SESSION_OPERATION_TIMEOUT_MS,
      reason: `sessions.activate:${sessionId}`
    })
  }

  async deactivateSession(context: SessionRouteContext): Promise<void> {
    await this.deps.scheduler.timeout({
      task: this.deps.sessionRepository.deactivate(context.webContentsId),
      ms: SESSION_OPERATION_TIMEOUT_MS,
      reason: 'sessions.deactivate'
    })
  }

  async getActiveSession(context: SessionRouteContext): Promise<SessionWithState | null> {
    let attemptCount = 0
    let active: ActiveSessionResolution

    try {
      const read = await this.deps.scheduler.retry<
        ActiveSessionResolution | NonRetryableSessionReadFailure
      >({
        task: async () => {
          attemptCount += 1
          let result: ActiveSessionResolution
          try {
            result = await this.deps.scheduler.timeout({
              task: this.deps.sessionRepository.resolveActive(context.webContentsId),
              ms: SESSION_OPERATION_TIMEOUT_MS,
              reason: 'sessions.getActive'
            })
          } catch (error) {
            return new NonRetryableSessionReadFailure(error)
          }
          if (result.binding === 'bound' && result.resolution.availability === 'transient_error') {
            throw new RetryableSessionReadError(result.resolution)
          }
          return result
        },
        maxAttempts: 2,
        initialDelayMs: 25,
        backoff: 1,
        reason: 'sessions.getActive'
      })
      if (read instanceof NonRetryableSessionReadFailure) {
        throw read.error
      }
      active = read
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
      return null
    }

    const session = getAvailableSession(active.resolution)
    if (!session) {
      reportTerminalSessionResolution('sessions.getActive', active.resolution, attemptCount)
    }
    return session
  }

  private async resolveSessionWithRetry(
    sessionId: string,
    reason: string
  ): Promise<{ resolution: SessionResolutionResult; attemptCount: number }> {
    let attemptCount = 0
    try {
      const read = await this.deps.scheduler.retry<
        SessionResolutionResult | NonRetryableSessionReadFailure
      >({
        task: async () => {
          attemptCount += 1
          let result: SessionResolutionResult
          try {
            result = await this.deps.scheduler.timeout({
              task: this.deps.sessionRepository.resolve(sessionId),
              ms: SESSION_OPERATION_TIMEOUT_MS,
              reason: `${reason}:session`
            })
          } catch (error) {
            return new NonRetryableSessionReadFailure(error)
          }
          if (result.availability === 'transient_error') {
            throw new RetryableSessionReadError(result)
          }
          return result
        },
        maxAttempts: 2,
        initialDelayMs: 25,
        backoff: 1,
        reason
      })
      if (read instanceof NonRetryableSessionReadFailure) {
        throw read.error
      }
      return { resolution: read, attemptCount }
    } catch (error) {
      if (!(error instanceof RetryableSessionReadError)) {
        throw error
      }
      return { resolution: error.resolution, attemptCount }
    }
  }
}
