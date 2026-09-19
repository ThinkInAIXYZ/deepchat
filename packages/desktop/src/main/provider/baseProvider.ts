import { BaseLLMProvider as CoreBaseLLMProvider } from '@deepchat/provider/baseProvider'
import type { LLM_PROVIDER } from '@deepchat/shared/types/provider'
import type { ProviderLocalePort } from '@deepchat/shared/provider/locale'
import type { ProviderSettingsPort } from './settings'
import { createDesktopProviderHost } from './desktopHost'
export * from '@deepchat/provider/baseProvider'
export abstract class BaseLLMProvider extends CoreBaseLLMProvider {
  constructor(provider: LLM_PROVIDER, settings: ProviderSettingsPort, locale: ProviderLocalePort) {
    super(provider, settings, createDesktopProviderHost(locale))
  }
}
