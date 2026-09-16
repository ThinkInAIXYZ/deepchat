export class InteractionParkingRegistry {
  private readonly messageIdsBySession = new Map<string, Set<string>>()

  park(sessionId: string, messageId: string): void {
    const messageIds = this.messageIdsBySession.get(sessionId) ?? new Set<string>()
    messageIds.add(messageId)
    this.messageIdsBySession.set(sessionId, messageIds)
  }

  isParked(sessionId: string, messageId: string): boolean {
    return this.messageIdsBySession.get(sessionId)?.has(messageId) === true
  }

  clearSession(sessionId: string): void {
    this.messageIdsBySession.delete(sessionId)
  }
}
