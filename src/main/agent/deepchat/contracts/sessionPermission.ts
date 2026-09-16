import type { CommandShellProfile } from '@shared/commandShell'
import type { ToolPermissionLeaseCapability } from '@shared/types/tool'

export type SessionPermissionRequest = {
  permissionType: 'read' | 'write' | 'all' | 'command'
  serverName?: string
  toolName?: string
  command?: string
  commandSignature?: string
  shellProfile?: CommandShellProfile
  paths?: string[]
  commandInfo?: {
    command: string
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
    suggestion: string
    signature?: string
    baseCommand?: string
  }
  requestId?: string
}

export type SessionPermissionGrant =
  | Readonly<{
      kind: 'command'
      signature: string
      oneShotGrantId: string
    }>
  | Readonly<{
      kind: 'granted'
      lease?: Readonly<{
        capability?: ToolPermissionLeaseCapability
        finalize(): void
        revoke(): void
      }>
    }>

/**
 * Session permission authority surface the built-in kernel needs. Declared here so kernel modules
 * depend on this structural port instead of the Desktop permission service; the host implements
 * it.
 */
export interface SessionPermissionPort {
  clearSessionPermissions(sessionId: string): void
  cloneSessionPermissions?(sourceSessionId: string, targetSessionId: string): void
  approvePermission(
    sessionId: string,
    permission: SessionPermissionRequest
  ): Promise<SessionPermissionGrant>
  revokeOneShotCommandPermission(sessionId: string, signature: string, oneShotGrantId: string): void
  denyPermission?(sessionId: string, requestId: string): Promise<void>
}
