import type { AWS_BEDROCK_PROVIDER, LLM_PROVIDER, VERTEX_PROVIDER } from '@shared/types/provider'

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

// The local OpenLLM daemon authenticates with its saved login, so a loopback base URL
// needs no key. The hosted endpoint still requires one.
const isKeylessLocalOpenLLM = (provider: LLM_PROVIDER) => {
  if (provider.id !== 'openllm') return false
  try {
    const url = new URL(provider.baseUrl?.trim() ?? '')
    return url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

export const isProviderReadyForOnboarding = (provider: LLM_PROVIDER) => {
  if (!provider.enable) return false

  if (provider.apiType === 'ollama') {
    return Boolean(provider.baseUrl?.trim())
  }

  if (provider.apiType === 'aws-bedrock') {
    const credential = (provider as AWS_BEDROCK_PROVIDER).credential
    if (!credential?.region?.trim()) return false
    return credential.authMode === 'profile'
      ? Boolean(credential.profile?.trim())
      : Boolean(credential.accessKeyId?.trim() && credential.secretAccessKey?.trim())
  }

  if (provider.apiType === 'vertex') {
    const vertex = provider as VERTEX_PROVIDER
    return Boolean(
      vertex.projectId?.trim() &&
      vertex.location?.trim() &&
      (vertex.apiKey?.trim() ||
        (vertex.accountClientEmail?.trim() && vertex.accountPrivateKey?.trim()))
    )
  }

  if (provider.custom && !provider.baseUrl?.trim()) return false
  if (provider.id === 'openai' && provider.openaiAuthMode === 'chatgpt') {
    return Boolean(provider.oauthToken)
  }
  if (isKeylessLocalOpenLLM(provider)) return true
  return Boolean(provider.apiKey?.trim() || provider.oauthToken)
}
