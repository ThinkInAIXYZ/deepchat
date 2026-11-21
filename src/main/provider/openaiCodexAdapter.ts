import { OPENAI_CODEX_API_BASE_URL } from './auth/openaiCodex/constants'

export const OPENAI_CODEX_RECOMMENDED_MODEL_IDS = [
  'gpt-6.2-sol',
  'gpt-6.2-astra',
  'gpt-6.1-terra',
  'gpt-6.1-sol',
  'gpt-6-astra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
  'gpt-image-2'
]

function stripResponsesSuffix(pathname: string): string {
  return pathname.replace(/\/responses\/?$/i, '') || '/'
}

export function normalizeOpenAICodexBaseUrl(baseUrl: string | undefined): string {
  const normalized = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!normalized) {
    return OPENAI_CODEX_API_BASE_URL
  }

  try {
    const url = new URL(normalized)
    if (url.hostname === 'api.openai.com') {
      return OPENAI_CODEX_API_BASE_URL
    }
    url.pathname = stripResponsesSuffix(url.pathname).replace(/\/+$/, '')
    return url.toString().replace(/\/+$/, '')
  } catch {
    return normalized.replace(/\/responses\/?$/i, '')
  }
}

export function buildOpenAICodexResponsesEndpoint(baseUrl: string | undefined): string {
  return `${normalizeOpenAICodexBaseUrl(baseUrl)}/responses`
}
