export type ProviderTransportKind =
  | 'openai-compatible'
  | 'openai-responses'
  | 'deepseek-open-responses'
  | 'openai-codex'
  | 'azure'
  | 'anthropic'
  | 'gemini'
  | 'vertex'
  | 'aws-bedrock'

export function normalizeGeminiBaseUrl(baseUrl: string | undefined): string {
  const normalized = (baseUrl || '').trim().replace(/\/+$/, '')

  if (!normalized) {
    return 'https://generativelanguage.googleapis.com/v1beta'
  }

  if (/\/v1beta1$/i.test(normalized) || /\/v1beta$/i.test(normalized)) {
    return normalized
  }

  if (/\/v1$/i.test(normalized)) {
    return normalized.replace(/\/v1$/i, '/v1beta')
  }

  return `${normalized}/v1beta`
}

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'

function normalizeOllamaInputBaseUrl(baseUrl: string | undefined): URL | null {
  const normalized = (baseUrl || DEFAULT_OLLAMA_BASE_URL).trim()
  if (!normalized) {
    return new URL(DEFAULT_OLLAMA_BASE_URL)
  }

  try {
    if (normalized.startsWith(':')) {
      return new URL(`http://127.0.0.1${normalized}`)
    }

    return new URL(normalized.includes('://') ? normalized : `http://${normalized}`)
  } catch {
    return null
  }
}

function stripOllamaEndpointSuffix(pathname: string): string {
  return pathname.replace(/\/+$/, '').replace(/\/(?:api|v1)$/i, '') || '/'
}

export function normalizeOllamaSdkHost(baseUrl: string | undefined): string {
  const parsed = normalizeOllamaInputBaseUrl(baseUrl)
  if (!parsed) {
    const fallback = (baseUrl || DEFAULT_OLLAMA_BASE_URL).trim().replace(/\/+$/, '')
    return fallback.replace(/\/(?:api|v1)$/i, '') || DEFAULT_OLLAMA_BASE_URL
  }

  parsed.search = ''
  parsed.hash = ''
  parsed.pathname = stripOllamaEndpointSuffix(parsed.pathname)

  return parsed.toString().replace(/\/+$/, '')
}

export function normalizeOllamaOpenAIBaseUrl(baseUrl: string | undefined): string {
  const parsed = normalizeOllamaInputBaseUrl(baseUrl)
  if (!parsed) {
    const fallback = normalizeOllamaSdkHost(baseUrl)
    return `${fallback.replace(/\/+$/, '')}/v1`
  }

  parsed.search = ''
  parsed.hash = ''
  parsed.pathname = `${stripOllamaEndpointSuffix(parsed.pathname).replace(/\/+$/, '')}/v1`

  return parsed.toString().replace(/\/+$/, '')
}

const DEFAULT_AZURE_V1_API_VERSION = 'v1'

const DEFAULT_AZURE_DEPLOYMENT_API_VERSION = '2024-02-01'

export interface NormalizedAzureBaseUrl {
  baseURL?: string
  apiVersion: string
  useDeploymentBasedUrls: boolean
  deploymentName?: string
}

export function normalizeAnthropicBaseUrl(baseUrl: string | undefined): string {
  const normalized = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')

  if (normalized.endsWith('/v1/messages')) {
    return normalized.slice(0, -'/messages'.length)
  }

  if (normalized.endsWith('/messages')) {
    return normalized.slice(0, -'/messages'.length)
  }

  if (normalized.endsWith('/v1')) {
    return normalized
  }

  return `${normalized}/v1`
}

export function normalizeAzureBaseUrl(
  baseUrl: string | undefined,
  apiVersion: string | undefined
): NormalizedAzureBaseUrl {
  const normalizedBaseUrl = baseUrl?.trim()
  const normalizedApiVersion = apiVersion?.trim()

  if (!normalizedBaseUrl) {
    return {
      apiVersion: normalizedApiVersion || DEFAULT_AZURE_V1_API_VERSION,
      useDeploymentBasedUrls: false
    }
  }

  try {
    const url = new URL(normalizedBaseUrl)
    url.search = ''
    url.hash = ''

    let pathname = url.pathname.replace(/\/+$/, '')
    let deploymentName: string | undefined

    const deploymentMatch = pathname.match(/\/openai\/deployments\/([^/]+)(?:\/.*)?$/i)
    if (deploymentMatch?.[1]) {
      deploymentName = decodeURIComponent(deploymentMatch[1])
      pathname = pathname.slice(0, deploymentMatch.index ?? pathname.length) || '/openai'
    } else if (/\/openai\/v1$/i.test(pathname)) {
      pathname = pathname.replace(/\/openai\/v1$/i, '/openai')
    } else if (!/\/openai$/i.test(pathname)) {
      pathname = pathname ? `${pathname}/openai` : '/openai'
    }

    url.pathname = pathname || '/openai'

    return {
      baseURL: url.toString().replace(/\/+$/, ''),
      apiVersion:
        normalizedApiVersion ||
        (deploymentName ? DEFAULT_AZURE_DEPLOYMENT_API_VERSION : DEFAULT_AZURE_V1_API_VERSION),
      useDeploymentBasedUrls: Boolean(deploymentName),
      deploymentName
    }
  } catch {
    const fallbackBaseUrl = normalizedBaseUrl.replace(/\/+$/, '')

    return {
      baseURL: fallbackBaseUrl.endsWith('/openai')
        ? fallbackBaseUrl
        : fallbackBaseUrl.endsWith('/openai/v1')
          ? fallbackBaseUrl.slice(0, -'/v1'.length)
          : `${fallbackBaseUrl}/openai`,
      apiVersion: normalizedApiVersion || DEFAULT_AZURE_V1_API_VERSION,
      useDeploymentBasedUrls: false
    }
  }
}
