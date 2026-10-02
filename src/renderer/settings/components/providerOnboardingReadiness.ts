import type { AWS_BEDROCK_PROVIDER, LLM_PROVIDER, VERTEX_PROVIDER } from '@shared/types/provider'

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
  return Boolean(provider.apiKey?.trim() || provider.oauthToken)
}
