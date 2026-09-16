import { randomUUID } from 'node:crypto'

export class CommandPermissionCache {
  private sessionCache = new Map<string, Set<string>>()
  private onceCache = new Map<string, Map<string, Set<string>>>()

  approve(conversationId: string, signature: string, isSession: boolean): string | null {
    if (!conversationId || !signature) return null
    if (isSession) {
      const existing = this.sessionCache.get(conversationId) ?? new Set<string>()
      existing.add(signature)
      this.sessionCache.set(conversationId, existing)
      return null
    }

    const existing = this.onceCache.get(conversationId) ?? new Map<string, Set<string>>()
    const grants = existing.get(signature) ?? new Set<string>()
    const grantId = `command_grant_${randomUUID()}`
    grants.add(grantId)
    existing.set(signature, grants)
    this.onceCache.set(conversationId, existing)
    return grantId
  }

  isApproved(conversationId: string, signature: string, oneShotGrantId?: string): boolean {
    if (!conversationId || !signature) return false
    const sessionAllowed = this.sessionCache.get(conversationId)?.has(signature) ?? false
    if (sessionAllowed) return true
    if (!oneShotGrantId) return false

    return this.consumeOnce(conversationId, signature, oneShotGrantId)
  }

  revokeOnce(conversationId: string, signature: string, oneShotGrantId: string): boolean {
    if (!conversationId || !signature) return false
    return this.consumeOnce(conversationId, signature, oneShotGrantId)
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

  private consumeOnce(conversationId: string, signature: string, oneShotGrantId: string): boolean {
    const signatureGrants = this.onceCache.get(conversationId)?.get(signature)
    if (!signatureGrants?.delete(oneShotGrantId)) return false

    if (signatureGrants.size === 0) {
      const conversationGrants = this.onceCache.get(conversationId)
      conversationGrants?.delete(signature)
      if (conversationGrants?.size === 0) this.onceCache.delete(conversationId)
    }
    return true
  }
}
