import path from 'path'

export interface FilePermissionRequest {
  toolName: string
  serverName: string
  permissionType: 'write'
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

export class FilePermissionService {
  private readonly approvals = new Map<string, Set<string>>()

  approve(conversationId: string, paths: string[], _remember: boolean): void {
    if (!conversationId || paths.length === 0) return
    const existing = this.approvals.get(conversationId) ?? new Set<string>()
    for (const filePath of paths) {
      existing.add(this.normalizePath(filePath))
    }
    this.approvals.set(conversationId, existing)
  }

  getApprovedPaths(conversationId?: string): string[] {
    if (!conversationId) return []
    return Array.from(this.approvals.get(conversationId) ?? [])
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
}
