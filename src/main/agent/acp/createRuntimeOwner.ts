import type { ConfigServicePort } from '@shared/presenter'
import type { DeepChatEventPublisher } from '@/agent/deepchat/runtime/types'
import { AcpClientRuntime, AcpRuntimeOwner, type AcpRegistryPort } from './client'
import { AcpSessionPersistence } from './runtime'
import type { McpSettings } from '@/mcp/settings'

export interface AcpRuntimeOwnerDependencies {
  configService: ConfigServicePort
  mcpSettings: McpSettings
  sessionPersistence: AcpSessionPersistence
  registry: AcpRegistryPort
  publishEvent: DeepChatEventPublisher
}

export function createAcpRuntimeOwner(dependencies: AcpRuntimeOwnerDependencies): AcpRuntimeOwner {
  return new AcpRuntimeOwner(() => {
    const provider = dependencies.configService.getProviderById('acp')
    if (!provider) throw new Error('[ACP] Provider configuration not found')
    return new AcpClientRuntime({
      publishEvent: dependencies.publishEvent,
      provider,
      configService: dependencies.configService,
      mcpSettings: dependencies.mcpSettings,
      sessionPersistence: dependencies.sessionPersistence,
      registry: dependencies.registry,
      capabilityEvents: {
        modesReady: (input) =>
          dependencies.publishEvent('sessions.acp.modes.ready', {
            ...input,
            version: Date.now()
          }),
        configOptionsReady: (input) =>
          dependencies.publishEvent('sessions.acp.configOptions.ready', {
            ...input,
            version: Date.now()
          }),
        commandsReady: (input) =>
          dependencies.publishEvent('sessions.acp.commands.ready', {
            ...input,
            version: Date.now()
          })
      }
    })
  })
}
