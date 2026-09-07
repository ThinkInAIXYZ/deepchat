import type { PermissionMode } from '@shared/types/agent-interface'

export function resolveToolPermissionMode(permissionMode: PermissionMode): PermissionMode {
  return permissionMode === 'auto_approve' ? 'full_access' : permissionMode
}
