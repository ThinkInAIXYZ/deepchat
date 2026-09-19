import { ProviderInstanceManager as CoreInstanceManager } from '@deepchat/provider/managers/providerInstanceManager'
import type { ProviderLocalePort } from '@deepchat/shared/provider/locale'
import type { ProviderSettingsPort } from '../settings'
import type { AgentSettingsPort } from '@/agent/settings'
import type { AcpRuntimeOwner } from '@/agent/acp/client'
import type { DeepchatEventPublisher } from '@deepchat/shared/contracts/events'
import { createDesktopProviderHost } from '../desktopHost'
import { AcpProvider } from '../providers/acpProvider'
import { GithubCopilotProvider } from '../providers/githubCopilotProvider'
import { OllamaProvider } from '../providers/ollamaProvider'

type CoreOptions = ConstructorParameters<typeof CoreInstanceManager>[0]
export class ProviderInstanceManager extends CoreInstanceManager {
  constructor(
    options: Omit<CoreOptions, 'host' | 'createExtension' | 'providerSettings'> & {
      providerSettings: ProviderSettingsPort
      locale: ProviderLocalePort
      agentSettings: Pick<AgentSettingsPort, 'getAcpEnabled' | 'getAcpAgents'>
      acpRuntimeOwner: AcpRuntimeOwner
      publishEvent: DeepchatEventPublisher
    }
  ) {
    super({
      ...options,
      host: createDesktopProviderHost(options.locale),
      createExtension: (provider) => {
        if (provider.id === 'acp')
          return new AcpProvider(
            provider,
            options.providerSettings,
            options.locale,
            options.agentSettings,
            options.acpRuntimeOwner,
            options.publishEvent
          )
        if (provider.id === 'github-copilot')
          return new GithubCopilotProvider(provider, options.providerSettings, options.locale)
        if (provider.id === 'ollama' || provider.apiType === 'ollama')
          return new OllamaProvider(provider, options.providerSettings, options.locale)
        return undefined
      }
    })
  }
}
