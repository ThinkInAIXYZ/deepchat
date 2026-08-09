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

export function createSessionPermissionPort(dependencies: {
  agentCliTokenAuthority: Pick<AgentCliTokenAuthority, 'revokeConversation'>
  commandPermissionService: Pick<
    CommandPermissionService,
    'approve' | 'clearConversation' | 'cloneConversation' | 'revokeOnce'
  >
  filePermissionService: Pick<
    FilePermissionService,
    'approve' | 'clearConversation' | 'cloneConversation'
  >
  settingsPermissionService: Pick<
    SettingsPermissionService,
    'approve' | 'clearConversation' | 'cloneConversation'
  >
  toolPermissionBroker: Pick<ToolPermissionBroker, 'approve' | 'cancelConversation' | 'deny'>
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
        return { kind: 'granted' }
      }

      if (
        serverName === 'agent-filesystem' &&
        Array.isArray(permission.paths) &&
        permission.paths.length > 0
      ) {
        filePermissionService.approve(sessionId, permission.paths, permissionType, false)
        return { kind: 'granted' }
      }

      if (serverName === 'deepchat-settings' && toolName) {
        settingsPermissionService.approve(sessionId, toolName, false)
        return { kind: 'granted' }
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
