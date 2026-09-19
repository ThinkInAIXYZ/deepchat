import type { ProviderHost } from '@deepchat/provider'
import type { ProviderLocalePort } from '@deepchat/shared/provider/locale'
import { createCapabilityResolver } from '@deepchat/provider/capabilityIdentity'
import { DeviceService } from '../device'
import { cacheImage, fetchRemoteFile } from '../platform/imageCache'
import { providerDbLoader } from './providerDbLoader'
import { modelCapabilities } from './modelCapabilities'
import { normalizeOpenAICodexBaseUrl, createOpenAICodexFetch } from './openaiCodexAdapter'
import { createXaiGrokFetch, shouldUseXaiGrokOAuthFetch } from './xaiGrokAuthAdapter'
import { getGlobalXaiGrokAuth } from './auth/xaiGrok'
import { isTrustedXaiApiEndpoint } from './auth/xaiGrok/constants'

export function createDesktopProviderHost(locale: ProviderLocalePort): ProviderHost {
  return {
    getLanguage: () => locale.getLanguage(),
    getDefaultHeaders: () => DeviceService.getDefaultHeaders(),
    catalog: providerDbLoader,
    capabilities: modelCapabilities,
    capabilityResolver: createCapabilityResolver(modelCapabilities),
    cacheImage,
    fetchRemoteFile,
    auth: {
      normalizeCodexBaseUrl: normalizeOpenAICodexBaseUrl,
      codexFetch: createOpenAICodexFetch,
      usesGrokOAuth: shouldUseXaiGrokOAuthFetch,
      grokFetch: createXaiGrokFetch,
      isTrustedGrokEndpoint: isTrustedXaiApiEndpoint,
      peekGrokToken: () => getGlobalXaiGrokAuth().peekAccessToken(),
      refreshGrokToken: () => getGlobalXaiGrokAuth().ensureAccessToken(),
      isGrokAuthenticated: () => getGlobalXaiGrokAuth().isAuthenticated()
    }
  }
}
