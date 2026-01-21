export class SettingsPermissionService {
  private readonly sessionApprovals = new Map<string, Set<string>>()
  private readonly oneTimeApprovals = new Map<string, Set<string>>()

  approve(conversationId: string, toolName: string, remember: boolean): void {
    if (!conversationId) return
    const normalized = toolName.trim()
    if (!normalized) return

    if (remember) {
      const existing = this.sessionApprovals.get(conversationId) ?? new Set<string>()
      existing.add(normalized)
      this.sessionApprovals.set(conversationId, existing)
      return
    }

    const existing = this.oneTimeApprovals.get(conversationId) ?? new Set<string>()
    existing.add(normalized)
    this.oneTimeApprovals.set(conversationId, existing)
  }

  consumeApproval(conversationId: string, toolName: string): boolean {
    if (!conversationId) return false
    const normalized = toolName.trim()
    if (!normalized) return false

    const session = this.sessionApprovals.get(conversationId)
    if (session?.has(normalized)) {
      return true
    }

    const oneTime = this.oneTimeApprovals.get(conversationId)
    if (!oneTime?.has(normalized)) {
      return false
    }

    oneTime.delete(normalized)
    if (oneTime.size === 0) {
      this.oneTimeApprovals.delete(conversationId)
    }
    return true
  }

  clearConversation(conversationId: string): void {
    this.sessionApprovals.delete(conversationId)
    this.oneTimeApprovals.delete(conversationId)
  }

  clearAll(): void {
    this.sessionApprovals.clear()
    this.oneTimeApprovals.clear()
  }
}
