import { ApimartProvider as CoreProvider } from '@deepchat/provider/providers/apimartProvider'
import type { LLM_PROVIDER } from '@deepchat/shared/types/provider'
import type { ProviderLocalePort } from '@deepchat/shared/provider/locale'
import type { ProviderSettingsPort } from '../settings'
import { createDesktopProviderHost } from '../desktopHost'
export * from '@deepchat/provider/providers/apimartProvider'
export class ApimartProvider extends CoreProvider {
  constructor(provider: LLM_PROVIDER, settings: ProviderSettingsPort, locale: ProviderLocalePort) {
    super(provider, settings, createDesktopProviderHost(locale))
  }
}
