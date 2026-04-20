import type { CreateSessionInput, SessionWithState } from '@shared/types/agent-interface'
import type { MessageRepository, SessionListFilters, SessionRepository } from '../hotPathPorts'
import type { Scheduler } from '../scheduler'

const SESSION_OPERATION_TIMEOUT_MS = 5_000

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

  async restoreSession(sessionId: string): Promise<{
    session: SessionWithState | null
    messages: Awaited<ReturnType<MessageRepository['listBySession']>>
  }> {
    const session = await this.deps.scheduler.retry({
      task: async () =>
        await this.deps.scheduler.timeout({
          task: this.deps.sessionRepository.get(sessionId),
          ms: SESSION_OPERATION_TIMEOUT_MS,
          reason: `sessions.restore:${sessionId}:session`
        }),
      maxAttempts: 2,
      initialDelayMs: 25,
      backoff: 1,
      reason: `sessions.restore:${sessionId}`
    })

    if (!session) {
      return {
        session: null,
        messages: []
      }
    }

    const messages = await this.deps.scheduler.timeout({
      task: this.deps.messageRepository.listBySession(sessionId),
      ms: SESSION_OPERATION_TIMEOUT_MS,
      reason: `sessions.restore:${sessionId}:messages`
    })

    return {
      session,
      messages
    }
  }

  async listSessions(filters?: SessionListFilters) {
    return await this.deps.scheduler.timeout({
      task: this.deps.sessionRepository.list(filters),
      ms: SESSION_OPERATION_TIMEOUT_MS,
      reason: 'sessions.list'
    })
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
    return await this.deps.scheduler.timeout({
      task: this.deps.sessionRepository.getActive(context.webContentsId),
      ms: SESSION_OPERATION_TIMEOUT_MS,
      reason: 'sessions.getActive'
    })
  }
}
