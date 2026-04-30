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

  getApprovedPaths(
    conversationId?: string,
    requiredPermission: FilePermissionLevel = 'read'
  ): string[] {
    if (!conversationId) return []
    return Array.from(this.approvals.get(conversationId)?.entries() ?? [])
      .filter(([, permissionType]) => this.allows(permissionType, requiredPermission))
      .map(([filePath]) => filePath)
  }

  clearConversation(conversationId: string): void {
    this.approvals.delete(conversationId)
  }

  clearAll(): void {
    this.approvals.clear()
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
