import type { LLM_PROVIDER } from '@shared/types/provider'
import {
  XAI_GROK_API_BASE_URL,
  XAI_GROK_PROVIDER_ID,
  isTrustedXaiApiEndpoint
} from './auth/xaiGrok/constants'

export function shouldUseXaiGrokOAuthFetch(provider: LLM_PROVIDER): boolean {
  return (
    provider.id === XAI_GROK_PROVIDER_ID &&
    isTrustedXaiApiEndpoint(provider.baseUrl || XAI_GROK_API_BASE_URL)
  )
}
