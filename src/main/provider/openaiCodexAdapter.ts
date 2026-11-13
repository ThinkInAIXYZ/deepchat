import { OPENAI_CODEX_API_BASE_URL } from './auth/openaiCodex/constants'

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
