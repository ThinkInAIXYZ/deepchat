export class CommandPermissionCache {
  private sessionCache = new Map<string, Set<string>>()
  private onceCache = new Map<string, Set<string>>()

  approve(conversationId: string, signature: string, isSession: boolean): void {
    if (!conversationId || !signature) return
    const targetCache = isSession ? this.sessionCache : this.onceCache
    const existing = targetCache.get(conversationId) ?? new Set<string>()
    existing.add(signature)
    targetCache.set(conversationId, existing)
  }

  isApproved(conversationId: string, signature: string): boolean {
    if (!conversationId || !signature) return false
    const sessionAllowed = this.sessionCache.get(conversationId)?.has(signature) ?? false
    if (sessionAllowed) return true

    const onceSet = this.onceCache.get(conversationId)
    if (!onceSet?.has(signature)) {
      return false
    }

    onceSet.delete(signature)
    if (onceSet.size === 0) {
      this.onceCache.delete(conversationId)
    }
    return true
  }

  clearConversation(conversationId: string): void {
    this.sessionCache.delete(conversationId)
    this.onceCache.delete(conversationId)
  }

  /**
   * Copy session-scoped approvals only (not one-shot). Used for parent → subagent inheritance.
   */
  cloneConversation(sourceConversationId: string, targetConversationId: string): void {
    const sourceId = sourceConversationId?.trim()
    const targetId = targetConversationId?.trim()
    if (!sourceId || !targetId || sourceId === targetId) return
    const source = this.sessionCache.get(sourceId)
    if (!source || source.size === 0) return
    const target = this.sessionCache.get(targetId) ?? new Set<string>()
    for (const signature of source) {
      target.add(signature)
    }
    this.sessionCache.set(targetId, target)
  }

  clearAll(): void {
    this.sessionCache.clear()
    this.onceCache.clear()
  }
}
