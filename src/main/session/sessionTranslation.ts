import { resolveAssistantModelSelection } from '@/agent/shared/assistantModelSelection'
import type { AgentSettingsPort } from '@/agent/settings'
import type { AgentManager } from '@/agent/manager/agentManager'
import type { ProviderRuntimePort } from '@shared/types/provider'

export function resolveTranslationLanguage(locale?: string): string {
  const normalized = locale?.trim().toLowerCase() || ''
  if (normalized.startsWith('zh-cn') || normalized.startsWith('zh-hans')) {
    return 'Simplified Chinese'
  }
  if (
    normalized.startsWith('zh-tw') ||
    normalized.startsWith('zh-hk') ||
    normalized.startsWith('zh-hant')
  ) {
    return 'Traditional Chinese'
  }
  const languages: Array<[string, string]> = [
    ['ja', 'Japanese'],
    ['ko', 'Korean'],
    ['fr', 'French'],
    ['de', 'German'],
    ['es', 'Spanish'],
    ['pt', 'Portuguese'],
    ['ru', 'Russian'],
    ['it', 'Italian'],
    ['tr', 'Turkish'],
    ['pl', 'Polish'],
    ['da', 'Danish'],
    ['fa', 'Persian'],
    ['he', 'Hebrew'],
    ['en', 'English']
  ]
  return languages.find(([prefix]) => normalized.startsWith(prefix))?.[1] ?? 'English'
}

export class SessionTranslation {
  constructor(
    private readonly dependencies: {
      agentManager: Pick<AgentManager, 'resolveBackend'>
      agentSettings: Pick<AgentSettingsPort, 'getDefaultModel' | 'resolveDeepChatAgentConfig'>
      providerRuntime: Pick<ProviderRuntimePort, 'generateCompletion'>
    }
  ) {}

  async translate(text: string, locale?: string, agentId?: string): Promise<string> {
    const input = text?.trim()
    if (!input) return ''

    const defaultModel = this.dependencies.agentSettings.getDefaultModel()
    const selection = await resolveAssistantModelSelection(
      this.dependencies,
      agentId ?? 'deepchat',
      defaultModel?.providerId || '',
      defaultModel?.modelId || ''
    )
    if (!selection.providerId || !selection.modelId) {
      throw new Error('No provider or model configured. Please set a default model in settings.')
    }

    const translated = await this.dependencies.providerRuntime.generateCompletion(
      selection.providerId,
      [
        {
          role: 'system',
          content: `You are a translation assistant. Translate the user input into ${resolveTranslationLanguage(locale)}. Return only the translated text with no explanations.`
        },
        { role: 'user', content: input }
      ],
      selection.modelId,
      0.2,
      1024
    )
    return translated.trim()
  }
}
