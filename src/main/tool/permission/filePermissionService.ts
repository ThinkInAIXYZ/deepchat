import { randomUUID } from 'node:crypto'
import path from 'path'

export interface FilePermissionRequest {
  toolName: string
  serverName: string
  permissionType: 'read' | 'write' | 'all'
  description: string
  paths?: string[]
  conversationId?: string
  rememberable?: boolean
}

export class FilePermissionRequiredError extends Error {
  readonly permissionRequest: FilePermissionRequest
  readonly responseContent: string

  constructor(responseContent: string, permissionRequest: FilePermissionRequest) {
    super('File permission required')
    this.responseContent = responseContent
    this.permissionRequest = permissionRequest
  }
}

export type FilePermissionLevel = FilePermissionRequest['permissionType']

export class FilePermissionService {
  private readonly approvals = new Map<string, Map<string, FilePermissionLevel>>()
  private readonly provisionalApprovals = new Map<
    string,
    Map<string, Map<string, FilePermissionLevel>>
  >()

  approve(
    conversationId: string,
    paths: string[],
    permissionType: FilePermissionLevel,
    _remember: boolean
  ): void {
    if (!conversationId || paths.length === 0) return
    const existing = this.approvals.get(conversationId) ?? new Map<string, FilePermissionLevel>()
    for (const filePath of paths) {
      const normalizedPath = this.normalizePath(filePath)
      existing.set(
        normalizedPath,
        this.mergePermission(existing.get(normalizedPath), permissionType)
      )
    }
    this.approvals.set(conversationId, existing)
  }

  approveProvisional(
    conversationId: string,
    paths: string[],
    permissionType: FilePermissionLevel
  ): string {
    if (!conversationId || paths.length === 0) {
      throw new Error('Provisional file approval requires a conversation and at least one path.')
    }
    const leaseId = randomUUID()
    const approvedPaths = new Map<string, FilePermissionLevel>()
    for (const filePath of paths) {
      approvedPaths.set(this.normalizePath(filePath), permissionType)
    }
    const leases = this.provisionalApprovals.get(conversationId) ?? new Map()
    leases.set(leaseId, approvedPaths)
    this.provisionalApprovals.set(conversationId, leases)
    return leaseId
  }

  finalizeProvisional(conversationId: string, leaseId: string): void {
    const approvedPaths = this.takeProvisional(conversationId, leaseId)
    if (!approvedPaths) return
    const existing = this.approvals.get(conversationId) ?? new Map<string, FilePermissionLevel>()
    for (const [filePath, permissionType] of approvedPaths) {
      existing.set(filePath, this.mergePermission(existing.get(filePath), permissionType))
    }
    this.approvals.set(conversationId, existing)
  }

  revokeProvisional(conversationId: string, leaseId: string): void {
    this.takeProvisional(conversationId, leaseId)
  }

  getApprovedPaths(
    conversationId?: string,
    requiredPermission: FilePermissionLevel = 'read',
    provisionalLeaseId?: string
  ): string[] {
    if (!conversationId) return []
    const provisional = this.provisionalApprovals.get(conversationId)
    const effective = new Map(this.approvals.get(conversationId) ?? [])
    if (provisionalLeaseId) {
      const approvedPaths = provisional?.get(provisionalLeaseId)
      if (!approvedPaths) return []
      for (const [filePath, permissionType] of approvedPaths) {
        effective.set(filePath, this.mergePermission(effective.get(filePath), permissionType))
      }
    }
    return Array.from(effective.entries())
      .filter(([, permissionType]) => this.allows(permissionType, requiredPermission))
      .map(([filePath]) => filePath)
  }

  clearConversation(conversationId: string): void {
    this.approvals.delete(conversationId)
    this.provisionalApprovals.delete(conversationId)
  }

  /**
   * Copy remembered path approvals from one conversation to another (e.g. parent → subagent).
   */
  cloneConversation(sourceConversationId: string, targetConversationId: string): void {
    const sourceId = sourceConversationId?.trim()
    const targetId = targetConversationId?.trim()
    if (!sourceId || !targetId || sourceId === targetId) return
    const source = this.approvals.get(sourceId)
    if (!source || source.size === 0) return
    const target = this.approvals.get(targetId) ?? new Map<string, FilePermissionLevel>()
    for (const [filePath, permissionType] of source.entries()) {
      target.set(filePath, this.mergePermission(target.get(filePath), permissionType))
    }
    this.approvals.set(targetId, target)
  }

  clearAll(): void {
    this.approvals.clear()
    this.provisionalApprovals.clear()
  }

  private takeProvisional(
    conversationId: string,
    leaseId: string
  ): Map<string, FilePermissionLevel> | undefined {
    const leases = this.provisionalApprovals.get(conversationId)
    const approvedPaths = leases?.get(leaseId)
    if (!approvedPaths || !leases) return undefined
    leases.delete(leaseId)
    if (leases.size === 0) this.provisionalApprovals.delete(conversationId)
    return approvedPaths
  }

  private normalizePath(targetPath: string): string {
    const normalized = path.normalize(path.resolve(targetPath))
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }

  private mergePermission(
    existing: FilePermissionLevel | undefined,
    next: FilePermissionLevel
  ): FilePermissionLevel {
    if (!existing) return next
    return this.permissionRank(next) > this.permissionRank(existing) ? next : existing
  }

  private allows(granted: FilePermissionLevel, required: FilePermissionLevel): boolean {
    return this.permissionRank(granted) >= this.permissionRank(required)
  }

  private permissionRank(permissionType: FilePermissionLevel): number {
    const ranks: Record<FilePermissionLevel, number> = {
      read: 1,
      write: 2,
      all: 3
    }
    return ranks[permissionType]
  }
}
