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
    const existing = this.activeTurns.get(input.conversationId)
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
    this.activeTurns.set(input.conversationId, turn)
    return turn
  }

  complete(sessionId: string, stopReason: string, conversationId?: string): AcpPromptTurn | null {
    return this.finish(sessionId, 'completed', stopReason, conversationId)
  }

  cancel(sessionId: string, conversationId?: string): AcpPromptTurn | null {
    return this.finish(sessionId, 'cancelled', 'cancelled', conversationId)
  }

  fail(sessionId: string, stopReason = 'error', conversationId?: string): AcpPromptTurn | null {
    return this.finish(sessionId, 'error', stopReason, conversationId)
  }

  getActiveTurn(sessionId: string, conversationId?: string): AcpPromptTurn | null {
    if (conversationId) {
      const turn = this.activeTurns.get(conversationId)
      return turn?.sessionId === sessionId ? turn : null
    }
    const matches = [...this.activeTurns.values()].filter((turn) => turn.sessionId === sessionId)
    return matches.length === 1 ? matches[0] : null
  }

  listCompletedTurns(): AcpPromptTurn[] {
    return [...this.completedTurns]
  }

  private finish(
    sessionId: string,
    status: Exclude<AcpPromptTurnStatus, 'active'>,
    stopReason: string,
    conversationId?: string
  ): AcpPromptTurn | null {
    const turn = this.getActiveTurn(sessionId, conversationId)
    if (!turn) return null

    this.activeTurns.delete(turn.conversationId)
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
