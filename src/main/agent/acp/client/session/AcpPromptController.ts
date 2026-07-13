import { nanoid } from 'nanoid'

export type AcpPromptTurnStatus = 'active' | 'completed' | 'cancelled' | 'error'

export interface AcpPromptTurn {
  id: string
  sessionId: string
  conversationId: string
  userMessageId?: string | null
  status: AcpPromptTurnStatus
  stopReason?: string | null
  startedAt: number
  completedAt?: number | null
}

export class AcpPromptController {
  private readonly activeTurns = new Map<string, AcpPromptTurn>()
  private readonly completedTurns: AcpPromptTurn[] = []

  begin(input: {
    sessionId: string
    conversationId: string
    userMessageId?: string | null
  }): AcpPromptTurn {
    const existing = this.activeTurns.get(input.sessionId)
    if (existing) {
      throw new Error(`[ACP] Session ${input.sessionId} already has an active prompt turn`)
    }

    const turn: AcpPromptTurn = {
      id: nanoid(),
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      userMessageId: input.userMessageId ?? null,
      status: 'active',
      stopReason: null,
      startedAt: Date.now(),
      completedAt: null
    }
    this.activeTurns.set(input.sessionId, turn)
    return turn
  }

  complete(sessionId: string, stopReason: string): AcpPromptTurn | null {
    return this.finish(sessionId, 'completed', stopReason)
  }

  cancel(sessionId: string): AcpPromptTurn | null {
    return this.finish(sessionId, 'cancelled', 'cancelled')
  }

  fail(sessionId: string, stopReason = 'error'): AcpPromptTurn | null {
    return this.finish(sessionId, 'error', stopReason)
  }

  getActiveTurn(sessionId: string): AcpPromptTurn | null {
    return this.activeTurns.get(sessionId) ?? null
  }

  listCompletedTurns(): AcpPromptTurn[] {
    return [...this.completedTurns]
  }

  private finish(
    sessionId: string,
    status: Exclude<AcpPromptTurnStatus, 'active'>,
    stopReason: string
  ): AcpPromptTurn | null {
    const turn = this.activeTurns.get(sessionId)
    if (!turn) return null

    this.activeTurns.delete(sessionId)
    const completed: AcpPromptTurn = {
      ...turn,
      status,
      stopReason,
      completedAt: Date.now()
    }
    this.completedTurns.push(completed)
    return completed
  }
}
