import type { ProviderModelResolutionPort } from '@/provider/settings'
import type { AgentSettingsPort } from '@/agent/settings'
import type { DeepChatEventPublisher } from '@/agent/deepchat/runtime/types'
import { AcpClientRuntime, AcpRuntimeOwner, type AcpRegistryPort } from './client'
import { AcpSessionPersistence } from './runtime'
import type { McpSettings } from '@/mcp/settings'

export interface AcpRuntimeOwnerDependencies {
  providerConfig: Pick<ProviderModelResolutionPort, 'getProviderById'>
  agentSettings: AgentSettingsPort
  mcpSettings: McpSettings
  sessionPersistence: AcpSessionPersistence
  registry: AcpRegistryPort
  titles?: {
    get(conversationId: string): string | undefined
    apply(conversationId: string, expected: string, title: string): boolean
  }
  publishEvent: DeepChatEventPublisher
}

export function createAcpRuntimeOwner(dependencies: AcpRuntimeOwnerDependencies): AcpRuntimeOwner {
  return new AcpRuntimeOwner(() => {
    const provider = dependencies.providerConfig.getProviderById('acp')
    if (!provider) throw new Error('[ACP] Provider configuration not found')
    return new AcpClientRuntime({
      publishEvent: dependencies.publishEvent,
      provider,
      agentSettings: dependencies.agentSettings,
      mcpSettings: dependencies.mcpSettings,
      sessionPersistence: dependencies.sessionPersistence,
      registry: dependencies.registry,
      capabilityEvents: {
        getLocalTitle: dependencies.titles?.get,
        applyTitle: dependencies.titles?.apply,
        extensionsChanged: (input) => dependencies.publishEvent('acp.extensions.changed', input),
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
