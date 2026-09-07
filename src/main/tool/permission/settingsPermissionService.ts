import { randomUUID } from 'node:crypto'

type ProvisionalSettingsApproval = {
  readonly toolName: string
  consumed: boolean
}

export class SettingsPermissionService {
  private readonly sessionApprovals = new Map<string, Set<string>>()
  private readonly oneTimeApprovals = new Map<string, Set<string>>()
  private readonly provisionalApprovals = new Map<
    string,
    Map<string, ProvisionalSettingsApproval>
  >()

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

  approveProvisional(conversationId: string, toolName: string): string {
    const normalized = toolName.trim()
    if (!conversationId || !normalized) {
      throw new Error('Provisional settings approval requires a conversation and tool name.')
    }
    const leaseId = randomUUID()
    const leases = this.provisionalApprovals.get(conversationId) ?? new Map()
    leases.set(leaseId, { toolName: normalized, consumed: false })
    this.provisionalApprovals.set(conversationId, leases)
    return leaseId
  }

  finalizeProvisional(conversationId: string, leaseId: string): void {
    const approval = this.takeProvisional(conversationId, leaseId)
    if (approval && !approval.consumed) {
      this.approve(conversationId, approval.toolName, false)
    }
  }

  revokeProvisional(conversationId: string, leaseId: string): void {
    this.takeProvisional(conversationId, leaseId)
  }

  consumeApproval(conversationId: string, toolName: string, provisionalLeaseId?: string): boolean {
    if (!conversationId) return false
    const normalized = toolName.trim()
    if (!normalized) return false

    const provisional = this.provisionalApprovals.get(conversationId)
    if (provisionalLeaseId) {
      const approval = provisional?.get(provisionalLeaseId)
      if (!approval || approval.consumed || approval.toolName !== normalized) return false
      approval.consumed = true
      return true
    }

    const session = this.sessionApprovals.get(conversationId)
    if (session?.has(normalized)) {
      return true
    }

    const oneTime = this.oneTimeApprovals.get(conversationId)
    if (oneTime?.has(normalized)) {
      oneTime.delete(normalized)
      if (oneTime.size === 0) {
        this.oneTimeApprovals.delete(conversationId)
      }
      return true
    }
    return false
  }

  clearConversation(conversationId: string): void {
    this.sessionApprovals.delete(conversationId)
    this.oneTimeApprovals.delete(conversationId)
    this.provisionalApprovals.delete(conversationId)
  }

  cloneConversation(sourceConversationId: string, targetConversationId: string): void {
    const sourceId = sourceConversationId?.trim()
    const targetId = targetConversationId?.trim()
    if (!sourceId || !targetId || sourceId === targetId) return
    const source = this.sessionApprovals.get(sourceId)
    if (!source || source.size === 0) return
    const target = this.sessionApprovals.get(targetId) ?? new Set<string>()
    for (const toolName of source) {
      target.add(toolName)
    }
    this.sessionApprovals.set(targetId, target)
  }

  clearAll(): void {
    this.sessionApprovals.clear()
    this.oneTimeApprovals.clear()
    this.provisionalApprovals.clear()
  }

  private takeProvisional(
    conversationId: string,
    leaseId: string
  ): ProvisionalSettingsApproval | undefined {
    const leases = this.provisionalApprovals.get(conversationId)
    const approval = leases?.get(leaseId)
    if (!approval || !leases) return undefined
    leases.delete(leaseId)
    if (leases.size === 0) this.provisionalApprovals.delete(conversationId)
    return approval
  }
}
