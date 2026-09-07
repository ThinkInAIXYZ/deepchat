import { CommandShellProfileSchema } from '@shared/commandShell'
import type { SessionPermissionPort } from '@/session/contracts'
import type { AgentCliTokenAuthority } from '@/cli/agentTokenAuthority'
import {
  isCommandSignatureForProfile,
  type CommandPermissionService,
  type FilePermissionService,
  type SettingsPermissionService,
  type ToolPermissionBroker
} from '@/tool/permission'
import type { ToolPermissionLeaseCapability } from '@shared/types/tool'

function createPermissionGrantLease(
  finalize: () => void,
  revoke: () => void,
  capability?: ToolPermissionLeaseCapability
) {
  let active = true
  return Object.freeze({
    ...(capability ? { capability } : {}),
    finalize: () => {
      if (!active) return
      active = false
      finalize()
    },
    revoke: () => {
      if (!active) return
      active = false
      revoke()
    }
  })
}

export function createSessionPermissionPort(dependencies: {
  agentCliTokenAuthority: Pick<AgentCliTokenAuthority, 'revokeConversation'>
  commandPermissionService: Pick<
    CommandPermissionService,
    'approve' | 'clearConversation' | 'cloneConversation' | 'revokeOnce'
  >
  filePermissionService: Pick<
    FilePermissionService,
    | 'approveProvisional'
    | 'clearConversation'
    | 'cloneConversation'
    | 'finalizeProvisional'
    | 'revokeProvisional'
  >
  settingsPermissionService: Pick<
    SettingsPermissionService,
    | 'approveProvisional'
    | 'clearConversation'
    | 'cloneConversation'
    | 'finalizeProvisional'
    | 'revokeProvisional'
  >
  toolPermissionBroker: Pick<
    ToolPermissionBroker,
    'approve' | 'cancel' | 'cancelConversation' | 'deny'
  >
}): SessionPermissionPort {
  const {
    agentCliTokenAuthority,
    commandPermissionService,
    filePermissionService,
    settingsPermissionService,
    toolPermissionBroker
  } = dependencies

  return {
    clearSessionPermissions: (sessionId) => {
      agentCliTokenAuthority.revokeConversation(sessionId)
      commandPermissionService.clearConversation(sessionId)
      filePermissionService.clearConversation(sessionId)
      settingsPermissionService.clearConversation(sessionId)
      toolPermissionBroker.cancelConversation(sessionId)
    },
    cloneSessionPermissions: (sourceSessionId, targetSessionId) => {
      // Tool approvals are one-time and intentionally never inherited.
      toolPermissionBroker.cancelConversation(targetSessionId)
      commandPermissionService.cloneConversation(sourceSessionId, targetSessionId)
      filePermissionService.cloneConversation(sourceSessionId, targetSessionId)
      settingsPermissionService.cloneConversation(sourceSessionId, targetSessionId)
    },
    approvePermission: async (sessionId, permission) => {
      const permissionType = permission.permissionType
      const serverName = permission.serverName || ''
      const toolName = permission.toolName || ''

      if (permissionType === 'command') {
        const signature = permission.commandSignature?.trim()
        const shellProfile = CommandShellProfileSchema.safeParse(permission.shellProfile)
        if (
          !signature ||
          !shellProfile.success ||
          !isCommandSignatureForProfile(signature, shellProfile.data)
        ) {
          throw new Error('Command approval is missing a valid shell profile and signature.')
        }
        const oneShotGrantId = commandPermissionService.approve(sessionId, signature, false)
        if (!oneShotGrantId) {
          throw new Error('Command approval did not return a one-shot grant lease.')
        }
        return { kind: 'command', signature, oneShotGrantId }
      }

      if (permission.requestId && toolPermissionBroker.approve(permission.requestId, sessionId)) {
        const requestId = permission.requestId
        return {
          kind: 'granted',
          lease: createPermissionGrantLease(
            () => {},
            () => {
              toolPermissionBroker.cancel(requestId, sessionId)
            }
          )
        }
      }

      if (
        serverName === 'agent-filesystem' &&
        Array.isArray(permission.paths) &&
        permission.paths.length > 0
      ) {
        const leaseId = filePermissionService.approveProvisional(
          sessionId,
          permission.paths,
          permissionType
        )
        return {
          kind: 'granted',
          lease: createPermissionGrantLease(
            () => filePermissionService.finalizeProvisional(sessionId, leaseId),
            () => filePermissionService.revokeProvisional(sessionId, leaseId),
            { kind: 'file', leaseId }
          )
        }
      }

      if (serverName === 'deepchat-settings' && toolName) {
        const leaseId = settingsPermissionService.approveProvisional(sessionId, toolName)
        return {
          kind: 'granted',
          lease: createPermissionGrantLease(
            () => settingsPermissionService.finalizeProvisional(sessionId, leaseId),
            () => settingsPermissionService.revokeProvisional(sessionId, leaseId),
            { kind: 'settings', leaseId }
          )
        }
      }

      // MCP execution uses the one-time request handled above.
      return { kind: 'granted' }
    },
    denyPermission: async (sessionId, requestId) => {
      toolPermissionBroker.deny(requestId, sessionId)
    },
    revokeOneShotCommandPermission: (sessionId, signature, oneShotGrantId) => {
      commandPermissionService.revokeOnce(sessionId, signature, oneShotGrantId)
    }
  }
}
